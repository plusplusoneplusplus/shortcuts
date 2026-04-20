/**
 * Synchronous git command execution helper.
 *
 * Uses `child_process.execSync` with `git -C <repoRoot>` to run git commands.
 */

import { execFileSync } from 'child_process';
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
 * Execute a git command synchronously.
 *
 * @param args     Git sub-command and arguments (e.g. `['log', '--oneline']`).
 * @param repoRoot Absolute path to the repository root (passed via `git -C`).
 * @param options  Optional overrides for buffer size, timeout, and cwd.
 * @returns        Trimmed stdout output.
 */
/**
 * Execute a git command asynchronously.
 *
 * Async counterpart to {@link execGit}.  Uses `child_process.exec` so the
 * Node.js event loop is not blocked while the git process runs.
 */
export function execGitAsync(args: string[], repoRoot: string, options?: ExecGitOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        ensureGitSafeDirectoryAsync(repoRoot)
            .then(() => {
                const executionContext = resolveWorkspaceExecutionContext(repoRoot);
                if (executionContext.kind === 'wsl') {
                    const execRepoRoot = translatePathForExecution(repoRoot, executionContext);
                    execFileAsync(
                        getWslExecutablePath(),
                        buildWslCommandArgs(executionContext, ['git', '-C', execRepoRoot, ...args]),
                        {
                            maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
                            timeout: options?.timeout ?? DEFAULT_TIMEOUT,
                            cwd: options?.cwd,
                            windowsHide: true,
                        },
                    )
                        .then(({ stdout }) => resolve(stdout.replace(/\r?\n$/, '')))
                        .catch(err => reject(createGitExecError(args, err)));
                    return;
                }

                execFileAsync('git', ['-C', repoRoot, ...args], {
                    maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
                    timeout: options?.timeout ?? DEFAULT_TIMEOUT,
                    encoding: 'utf-8',
                    cwd: options?.cwd,
                    windowsHide: true,
                })
                    .then(({ stdout }) => resolve(stdout.replace(/\r?\n$/, '')))
                    .catch(err => reject(createGitExecError(args, err)));
            })
            .catch(err => reject(createGitExecError(args, err)));
    });
}

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
        });
        // Strip trailing newline(s)
        return output.replace(/\r?\n$/, '');
    } catch (err: unknown) {
        throw createGitExecError(args, err);
    }
}
