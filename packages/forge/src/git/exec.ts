/**
 * Synchronous git command execution helper.
 *
 * Uses `child_process.execSync` with `git -C <repoRoot>` to run git commands.
 */

import { execSync } from 'child_process';

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

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT = 30_000;               // 30 s

/**
 * Execute a git command synchronously.
 *
 * @param args     Git sub-command and arguments (e.g. `['log', '--oneline']`).
 * @param repoRoot Absolute path to the repository root (passed via `git -C`).
 * @param options  Optional overrides for buffer size, timeout, and cwd.
 * @returns        Trimmed stdout output.
 */
export function execGit(args: string[], repoRoot: string, options?: ExecGitOptions): string {
    const cmd = ['git', '-C', repoRoot, ...args].join(' ');
    try {
        const output = execSync(cmd, {
            maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
            timeout: options?.timeout ?? DEFAULT_TIMEOUT,
            encoding: 'utf-8',
            cwd: options?.cwd,
        });
        // Strip trailing newline(s)
        return output.replace(/\r?\n$/, '');
    } catch (err: unknown) {
        const stderr = (err as { stderr?: string | Buffer })?.stderr?.toString().trim() ?? '';
        throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
    }
}
