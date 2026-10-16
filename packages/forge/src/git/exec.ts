/**
 * Running `git -C <repoRoot> <args>` for the rest of forge.
 *
 * Text and raw-byte helpers dispatch on where the repository lives: WSL
 * repositories use `wsl.exe` in TypeScript; host repositories use the native
 * addon on a libuv worker.
 */

import { loadNativeGit, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { spawn } from 'child_process';
import { execFileAsync } from '../utils/exec-utils';
import { ensureGitSafeDirectoryAsync } from './safe-directory';
import {
    buildWslCommandArgs,
    getWslExecutablePath,
    resolveWorkspaceExecutionContext,
    translatePathForExecution,
} from '../utils/workspace-execution';
import type { WslExecutionContext } from '../utils/workspace-execution';

export interface ExecGitOptions {
    /** Maximum buffer size for stdout/stderr in bytes (default: 10 MB). */
    maxBuffer?: number;
    /** Timeout in milliseconds (default: 30 000). */
    timeout?: number;
    /** Working directory override (rarely needed; `-C` is preferred). */
    cwd?: string;
    /** Environment overrides inherited by the Git process on host and WSL. */
    env?: Record<string, string>;
    /** Cancellation for TypeScript WSL transport; unsupported for host execution. */
    signal?: AbortSignal;
}

const DEFAULT_MAX_BUFFER = 50 * 1024 * 1024; // 50 MB
const DEFAULT_TIMEOUT = 30_000;               // 30 s

export class GitBlobTooLargeError extends Error {
    readonly code = 'GIT_BLOB_TOO_LARGE';

    constructor(readonly maxBytes: number) {
        super(`Git blob exceeds ${maxBytes} bytes`);
        this.name = 'GitBlobTooLargeError';
    }
}

export interface ReadGitBlobOptions {
    maxBytes: number;
    /** Milliseconds before termination; zero disables the deadline. */
    timeout?: number;
}

/** Stream raw WSL output, terminating the child as soon as the byte cap is exceeded. */
export function runGitViaWslBytes(
    context: WslExecutionContext,
    args: string[],
    options: ReadGitBlobOptions,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const child = spawn(getWslExecutablePath(), buildWslCommandArgs(context, ['git', ...args]), {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks: Buffer[] = [];
        let size = 0;
        let stderr = Buffer.alloc(0);
        let failure: Error | undefined;
        const timeout = options.timeout ?? DEFAULT_TIMEOUT;
        const timer = timeout > 0 ? setTimeout(() => {
            failure ??= new Error(`git ${args.join(' ')} failed: timed out`);
            child.kill();
        }, timeout) : undefined;
        child.stdout.on('data', (chunk: Buffer) => {
            if (failure) return;
            size += chunk.length;
            if (size > options.maxBytes) {
                failure = new GitBlobTooLargeError(options.maxBytes);
                chunks.length = 0;
                child.kill();
                return;
            }
            chunks.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
            // Diagnostics have a separate bound; they never consume the blob's budget.
            stderr = Buffer.concat([stderr, chunk.subarray(0, Math.max(0, 64 * 1024 - stderr.length))]);
        });
        child.once('error', error => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('close', code => {
            clearTimeout(timer);
            if (failure) reject(failure);
            else if (code !== 0) reject(createGitExecError(args, { stderr }));
            else resolve(Buffer.concat(chunks, size));
        });
    });
}

/** Read an object by SHA without decoding or trimming, including index-only blobs. */
export async function readGitBlob(repoRoot: string, sha: string, options: ReadGitBlobOptions): Promise<Buffer> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    for (const [name, value] of [['maxBytes', options.maxBytes], ['timeout', timeout]] as const) {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
            throw new RangeError(`${name} must be an unsigned 32-bit integer`);
        }
    }
    const args = ['cat-file', 'blob', sha];
    try {
        await ensureGitSafeDirectoryAsync(repoRoot);
    } catch (error) {
        if (error instanceof NativeAddonLoadError) throw error;
        throw createGitExecError(args, error);
    }
    const context = resolveWorkspaceExecutionContext(repoRoot);
    if (context.kind === 'wsl') {
        return runGitViaWslBytes(context, ['-C', translatePathForExecution(repoRoot, context), ...args], options);
    }
    try {
        return await loadNativeGit().gitReadBlob(repoRoot, sha, { maxBytes: options.maxBytes, timeout });
    } catch (error) {
        if ((error as { code?: string })?.code === 'GIT_BLOB_TOO_LARGE') {
            throw new GitBlobTooLargeError(options.maxBytes);
        }
        throw error;
    }
}

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
    signal?: AbortSignal;
}

/**
 * Run `git <args>` inside a WSL distro.
 *
 * WSL transport stays in TypeScript: the native addon runs git
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
            buildWslCommandArgs(executionContext, [
                ...(options.env ? ['env', ...Object.entries(options.env).map(([key, value]) => `${key}=${value}`)] : []),
                'git', ...args,
            ]),
            {
                timeout: options.timeout ?? DEFAULT_TIMEOUT,
                maxBuffer: options.maxBuffer,
                cwd: options.cwd,
                windowsHide: true,
                signal: options.signal,
                ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
            },
        );
        return stdout.replace(/\r?\n$/, '');
    } catch (err: unknown) {
        if (options.signal?.aborted) throw options.signal.reason;
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
            { maxBuffer, timeout, cwd: options?.cwd, errorArgs: args, signal: options?.signal, env: options?.env },
        );
    }

    // Deliberately outside the try: a missing or capability-stale binary is a
    // NativeAddonLoadError naming the fix, and dressing it up as a failed git
    // command would hide that.
    const native = loadNativeGit();
    if (options?.signal) throw new Error('AbortSignal is supported only for WSL Git transport');
    return native.execGit(args, repoRoot, {
        maxBuffer: toUint32(maxBuffer, DEFAULT_MAX_BUFFER),
        timeout: toUint32(timeout, DEFAULT_TIMEOUT),
        cwd: options?.cwd,
        env: options?.env,
    });
}
