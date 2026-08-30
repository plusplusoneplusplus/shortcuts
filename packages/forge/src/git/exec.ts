/**
 * Running `git -C <repoRoot> <args>` for the rest of forge.
 *
 * There is one helper and it is async. It dispatches on where the repository
 * lives: WSL repos keep their `wsl.exe` shell-out here in TypeScript,
 * everything else runs in the native addon on a libuv worker. Nothing in forge
 * spawns git from the event-loop thread any more.
 */

import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { execFileAsync } from '../utils/exec-utils';
import { ensureGitSafeDirectoryAsync } from './safe-directory';
import {
    buildWslCommandArgs,
    getWslExecutablePath,
    resolveWorkspaceExecutionContext,
    translatePathForExecution,
} from '../utils/workspace-execution';
import type { WslExecutionContext } from '../utils/workspace-execution';

/**
 * Options for `execGitAsync`.
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

/**
 * Render a failed git command the way routes and the UI already display it.
 *
 * Shared with `BranchService`, whose WSL path produces a Node `execFile`
 * rejection that has to reach a caller wearing the same words as the native
 * path's `git <args> failed: <stderr>`.
 */
export function createGitExecError(args: string[], err: unknown): Error {
    const stderr = (err as { stderr?: string | Buffer })?.stderr?.toString().trim() ?? '';
    return new Error(`git ${args.join(' ')} failed: ${stderr}`);
}

/**
 * Per-call overrides for {@link runGitViaWsl}.
 *
 * Every field is optional and every default is Node's, not this module's: the
 * three callers spell out different subsets today, and the point of sharing the
 * runner is that none of their command lines change.
 */
export interface WslGitOptions {
    /** Milliseconds before the command is killed. Defaults to 30 000. */
    timeout?: number;
    /** Bytes of stdout kept. Omitted means Node's own default. */
    maxBuffer?: number;
    /** Working directory for `wsl.exe` itself; the distro's own is `--cd`. */
    cwd?: string;
    /** Environment overrides layered on the one this process already has. */
    env?: Record<string, string>;
    /**
     * The arguments to name in a failure message, when they are not the ones
     * being run. Callers that address the repository with `-C` report the
     * sub-command the caller asked for instead, which is what the UI shows.
     */
    errorArgs?: string[];
}

/**
 * Run `git <args>` inside a WSL distro.
 *
 * The one git runner in forge that still starts a child process from Node, and
 * the only part of the move that stays in TypeScript: the native addon runs git
 * on the host and never learns that WSL exists. `--cd` puts git in the
 * repository, so a caller only passes `-C` when it always has.
 *
 * Returns stdout with one trailing line ending removed and rejects with
 * `git <args> failed: <stderr>`, so it is indistinguishable from the native
 * runner to everything above it.
 */
export async function runGitViaWsl(
    executionContext: WslExecutionContext,
    args: string[],
    options: WslGitOptions = {},
): Promise<string> {
    try {
        const { stdout } = await execFileAsync(
            getWslExecutablePath(),
            buildWslCommandArgs(executionContext, ['git', ...args]),
            {
                timeout: options.timeout ?? DEFAULT_TIMEOUT,
                maxBuffer: options.maxBuffer,
                cwd: options.cwd,
                windowsHide: true,
                ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
            },
        );
        return stdout.replace(/\r?\n$/, '');
    } catch (err: unknown) {
        throw createGitExecError(options.errorArgs ?? args, err);
    }
}

/**
 * Translate the path-shaped arguments of a git command into a distro's
 * namespace, leaving everything else alone.
 *
 * A file path Node built is a Windows path that git inside the distro cannot
 * open. Sub-commands, flags and refs are not paths, and
 * `translatePathForExecution` throws for them rather than returning them
 * unchanged — so the throw is what identifies them.
 */
export function translateWslArgs(args: string[], executionContext: WslExecutionContext): string[] {
    return args.map(value => {
        try {
            return translatePathForExecution(value, executionContext);
        } catch {
            return value;
        }
    });
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
        // The safe.directory check runs its two `git config --global` calls in
        // the addon now, so a missing or stale binary can fail here — before
        // the WSL dispatch that would otherwise never touch native. That is a
        // NativeAddonLoadError naming the rebuild, and rendering it as a failed
        // git command would hide the fix.
        if (err instanceof NativeAddonLoadError) {
            throw err;
        }
        throw createGitExecError(args, err);
    }

    const executionContext = resolveWorkspaceExecutionContext(repoRoot);
    if (executionContext.kind === 'wsl') {
        const execRepoRoot = translatePathForExecution(repoRoot, executionContext);
        // Only the repository path is translated here. The rest of `args` is
        // passed through untouched, because this helper's callers have always
        // addressed files by whatever string they were handed.
        return runGitViaWsl(
            executionContext,
            ['-C', execRepoRoot, ...args],
            { maxBuffer, timeout, cwd: options?.cwd, errorArgs: args },
        );
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
