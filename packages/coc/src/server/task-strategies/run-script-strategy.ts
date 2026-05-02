/**
 * RunScriptStrategy
 *
 * Spawns a shell command as a child process and streams stdout/stderr.
 * Extracted from CLITaskExecutor.executeRunScript.
 */

import { spawn } from 'child_process';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import type { RunScriptPayload } from '../tasks/task-types';
import type { ExecutionContext, TaskResult, TaskStrategy } from './index';

export class RunScriptStrategy implements TaskStrategy {
    execute(task: QueuedTask, context: ExecutionContext): Promise<TaskResult> {
        const payload = task.payload as unknown as RunScriptPayload;
        const startTime = Date.now();
        const cwd = context.workingDirectory || undefined;

        return new Promise((resolve, reject) => {
            const child = spawn(payload.script, [], {
                shell: true,
                cwd,
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const timeoutMs = (task.config as any)?.timeoutMs;
            let timer: NodeJS.Timeout | undefined;
            if (timeoutMs != null && timeoutMs > 0) {
                timer = setTimeout(() => {
                    timedOut = true;
                    child.kill();
                }, timeoutMs);
            }

            child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            child.on('error', (err) => {
                if (timer) clearTimeout(timer);
                reject(err);
            });

            child.on('close', (exitCode) => {
                if (timer) clearTimeout(timer);
                const durationMs = Date.now() - startTime;
                const success = !timedOut && exitCode === 0;
                const response = formatScriptResponse(payload.script, cwd, success, stdout, stderr, exitCode, timedOut, durationMs);
                resolve({
                    success,
                    response,
                    result: { stdout, stderr, exitCode: timedOut ? null : exitCode },
                    durationMs,
                    timedOut,
                });
            });
        });
    }
}

export function formatScriptResponse(
    script: string,
    cwd: string | undefined,
    success: boolean,
    stdout: string,
    stderr: string,
    exitCode: number | null,
    timedOut: boolean,
    durationMs: number,
): string {
    const parts: string[] = [];
    const status = timedOut ? '⏱️ Timed out' : success ? '✅ Success' : `❌ Failed (exit code ${exitCode})`;
    parts.push(`**Script:** \`${script}\``);
    if (cwd) parts.push(`**Working directory:** \`${cwd}\``);
    parts.push(`**Status:** ${status}`);
    parts.push(`**Duration:** ${durationMs}ms`);
    if (stdout.trim()) parts.push(`\n**stdout:**\n\`\`\`\n${stdout.trim()}\n\`\`\``);
    if (stderr.trim()) parts.push(`\n**stderr:**\n\`\`\`\n${stderr.trim()}\n\`\`\``);
    return parts.join('\n');
}
