/**
 * Running `git -C <repoRoot> <args>` for the rest of forge.
 *
 * The async helper dispatches on where the repository lives: WSL repos keep
 * their `wsl.exe` shell-out here in TypeScript, everything else runs in the
 * native addon on a libuv worker. The sync helper still spawns a child process
 * and is on its way out.
 */

import { execFileSync } from 'child_process';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import { execFileAsync } from '../utils/exec-utils';
import { ensureGitSafeDirectoryAsync, ensureGitSafeDirectorySync } from './safe-directory';
import {
    buildWslCommandArgs,
    getWslExecutablePath,
    resolveWorkspaceExecutionContext,
    translatePathForExecution,
} from '../utils/workspace-execution';

/**
 * Options for `execGit`.
 */
export interface ExecGitOptions {
    /** Maximum buffer size for stdout/stderr in bytes (default: 10 MB). */
    maxBuffer?: number;
    /** Timeout in milliseconds (default: 30 000). */
    timeout?: number;
    /** Working directory override (rarely needed; `-C` is preferred). */
    cwd?: string;
}

const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024; // 50 MB
const DEFAULT_TIMEOUT = 30_000;               // 30 s

function createGitExecError(args: string[], err: unknown): Error {
    const stderr = (err as { stderr?: string | Buffer })?.stderr?.toString().trim() ?? '';
    return new Error(`git ${args.join(' ')} failed: ${stderr}`);
}

/**
 * Coerce an option to the unsigned 32-bit integer the native boundary takes.
 *
 * Node accepted a float or a value past 2^32 here and simply behaved oddly;
 * N-API rejects the conversion, so clamping keeps a sloppy caller working
 * rather than turning it into a new failure mode.
 */
function toUint32(value: number, fallback: number): number {
    if (!Number.isFinite(value) || value < 0) return fallback;
    return Math.min(Math.floor(value), 0xffffffff);
}

/**
 * Execute a git command asynchronously.
 *
 * Two paths, chosen by where the repository lives:
 *
 * - A repo inside a WSL distro still goes through `wsl.exe` from Node. WSL
 *   routing stays in TypeScript on purpose — the native addon runs git on the
 *   host and never learns that WSL exists.
 * - Everything else runs in the native addon, on a libuv worker rather than by
 *   spawning a child process from the event-loop thread.
 *
 * The signature, the defaults, the trimmed stdout and the
 * `git <args> failed: <stderr>` rejection are identical on both paths, so a
 * caller cannot tell which one served it.
 */
export async function execGitAsync(
    args: string[],
    repoRoot: string,
    options?: ExecGitOptions,
): Promise<string> {
    const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

    try {
        await ensureGitSafeDirectoryAsync(repoRoot);
    } catch (err: unknown) {
        throw createGitExecError(args, err);
    }

    const executionContext = resolveWorkspaceExecutionContext(repoRoot);
    if (executionContext.kind === 'wsl') {
        const execRepoRoot = translatePathForExecution(repoRoot, executionContext);
        try {
            const { stdout } = await execFileAsync(
                getWslExecutablePath(),
                buildWslCommandArgs(executionContext, ['git', '-C', execRepoRoot, ...args]),
                { maxBuffer, timeout, cwd: options?.cwd, windowsHide: true },
            );
            return stdout.replace(/\r?\n$/, '');
        } catch (err: unknown) {
            throw createGitExecError(args, err);
        }
    }

    // Deliberately outside the try: a missing or capability-stale binary is a
    // NativeAddonLoadError naming the fix, and dressing it up as a failed git
    // command would hide that.
    const native = loadNativeGit();
    return native.execGit(args, repoRoot, {
        maxBuffer: toUint32(maxBuffer, DEFAULT_MAX_BUFFER),
        timeout: toUint32(timeout, DEFAULT_TIMEOUT),
        cwd: options?.cwd,
    });
}

/**
 * Execute a git command synchronously.
 *
 * @param args     Git sub-command and arguments (e.g. `['log', '--oneline']`).
 * @param repoRoot Absolute path to the repository root (passed via `git -C`).
 * @param options  Optional overrides for buffer size, timeout, and cwd.
 * @returns        Trimmed stdout output.
 */
export function execGit(args: string[], repoRoot: string, options?: ExecGitOptions): string {
    try {
        ensureGitSafeDirectorySync(repoRoot);
        const executionContext = resolveWorkspaceExecutionContext(repoRoot);
        if (executionContext.kind === 'wsl') {
            const execRepoRoot = translatePathForExecution(repoRoot, executionContext);
            const output = execFileSync(
                getWslExecutablePath(),
                buildWslCommandArgs(executionContext, ['git', '-C', execRepoRoot, ...args]),
                {
                    maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
                    timeout: options?.timeout ?? DEFAULT_TIMEOUT,
                    encoding: 'utf-8',
                    cwd: options?.cwd,
                    windowsHide: true,
                },
            );
            return output.replace(/\r?\n$/, '');
        }

        const output = execFileSync('git', ['-C', repoRoot, ...args], {
            maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
            timeout: options?.timeout ?? DEFAULT_TIMEOUT,
            encoding: 'utf-8',
            cwd: options?.cwd,
            windowsHide: true,
        }) as string;
        // Strip trailing newline(s)
        return output.replace(/\r?\n$/, '');
    } catch (err: unknown) {
        throw createGitExecError(args, err);
    }
}
