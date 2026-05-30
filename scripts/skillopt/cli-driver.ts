/**
 * AC-01: Copilot CLI driver.
 *
 * Runs the GitHub Copilot CLI headlessly:
 *   copilot -p <prompt> --allow-all-tools -C <workdir> --model <model>
 *           --output-format text --no-color
 *
 * Returns stdout, exit code, and the post-run git diff of workdir.
 * Non-zero exits surface as CliError (never silently pass).
 */

import { spawn } from 'child_process';
import { execSync } from 'child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CliResult {
    stdout: string;
    exitCode: number;
    diff: string;
}

export interface CopilotCliOptions {
    /** Milliseconds before the CLI call is forcibly killed. 0 = no timeout. Default: 300_000 */
    timeoutMs?: number;
    /** Additional flags appended verbatim to the CLI invocation. */
    extraArgs?: string[];
}

export class CliError extends Error {
    readonly exitCode: number;
    readonly stdout: string;

    constructor(message: string, exitCode: number, stdout: string) {
        super(message);
        this.name = 'CliError';
        this.exitCode = exitCode;
        this.stdout = stdout;
    }
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Runs the Copilot CLI non-interactively with the given prompt.
 *
 * @param prompt   The full prompt string passed via `-p`.
 * @param workdir  The working directory for the CLI (`-C`) and for git-diff capture.
 * @param model    The model to use (`--model`).
 * @param options  Optional timeout and extra args.
 */
export async function runCopilotCli(
    prompt: string,
    workdir: string,
    model: string,
    options: CopilotCliOptions = {}
): Promise<CliResult> {
    const { timeoutMs = 300_000, extraArgs = [] } = options;

    const args: string[] = [
        '-p', prompt,
        '--allow-all-tools',
        '-C', workdir,
        '--model', model,
        '--output-format', 'text',
        '--no-color',
        ...extraArgs,
    ];

    const stdout = await spawnCopilot(args, workdir, timeoutMs);
    const diff = captureGitDiff(workdir);

    return { stdout, exitCode: 0, diff };
}

/** Spawns the copilot binary and resolves with stdout, or rejects with CliError. */
async function spawnCopilot(args: string[], cwd: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let proc: ReturnType<typeof spawn>;
        try {
            proc = spawn('copilot', args, { cwd });
        } catch (err) {
            reject(new CliError(
                'copilot binary not found on PATH. Install the GitHub Copilot CLI and authenticate before running skillopt.',
                -1,
                ''
            ));
            return;
        }

        let output = '';
        let timer: ReturnType<typeof setTimeout> | undefined;

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                try { proc.kill(); } catch { /* ignore */ }
                reject(new CliError(
                    `Copilot CLI timed out after ${timeoutMs}ms`,
                    -1,
                    output
                ));
            }, timeoutMs);
        }

        proc.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        proc.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });

        proc.on('error', (err: NodeJS.ErrnoException) => {
            if (timer) clearTimeout(timer);
            if (err.code === 'ENOENT') {
                reject(new CliError(
                    'copilot binary not found on PATH. Install the GitHub Copilot CLI and authenticate before running skillopt.',
                    -1,
                    ''
                ));
            } else {
                reject(err);
            }
        });

        proc.on('close', (code: number | null) => {
            if (timer) clearTimeout(timer);
            const exitCode = code ?? -1;
            if (exitCode !== 0) {
                reject(new CliError(
                    `Copilot CLI exited with code ${exitCode}`,
                    exitCode,
                    output
                ));
            } else {
                resolve(output);
            }
        });
    });
}

/** Returns the current `git diff HEAD` in workdir, or '' on failure. */
export function captureGitDiff(workdir: string): string {
    try {
        return execSync('git diff HEAD', { cwd: workdir, encoding: 'utf-8' });
    } catch {
        return '';
    }
}
