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
import { existsSync } from 'fs';
import * as path from 'path';

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
 * Resolves how to invoke the Copilot CLI for the current platform.
 *
 * On Windows the `copilot` command is an npm shim (`copilot.cmd`), not a real
 * executable. Node's `spawn` cannot launch a `.cmd` without `shell: true`, and
 * `shell: true` would mangle multi-line / special-character prompts. To stay
 * robust we instead locate the npm package's Node entrypoint
 * (`node_modules/@github/copilot/npm-loader.js`, a sibling of the shim on the
 * Windows global prefix) and run it directly with the current `node` binary —
 * no shell, no argument escaping.
 *
 * If the loader cannot be found (or on non-Windows platforms, where `copilot`
 * is directly spawnable), we fall back to invoking `copilot` on PATH.
 */
export function resolveCopilotInvocation(
    baseArgs: string[],
    deps: {
        platform?: NodeJS.Platform;
        pathEnv?: string;
        nodePath?: string;
        fileExists?: (p: string) => boolean;
    } = {}
): { command: string; args: string[] } {
    const platform = deps.platform ?? process.platform;
    const pathEnv = deps.pathEnv ?? process.env.PATH ?? '';
    const nodePath = deps.nodePath ?? process.execPath;
    const fileExists = deps.fileExists ?? existsSync;

    if (platform === 'win32') {
        for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
            const loader = path.join(dir, 'node_modules', '@github', 'copilot', 'npm-loader.js');
            if (fileExists(loader)) {
                return { command: nodePath, args: [loader, ...baseArgs] };
            }
        }
    }

    return { command: 'copilot', args: baseArgs };
}

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
            const { command, args: spawnArgs } = resolveCopilotInvocation(args);
            proc = spawn(command, spawnArgs, { cwd });
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
