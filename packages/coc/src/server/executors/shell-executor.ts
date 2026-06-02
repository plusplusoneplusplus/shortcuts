/**
 * Shell Executor
 *
 * Concrete executor that owns shell-script execution: spawning child processes,
 * capturing stdout/stderr, writing output to disk, and handling exit codes.
 *
 * Extends BaseExecutor so it inherits the shared streaming/cancellation
 * plumbing, output-file management, and session lifecycle helpers.
 *
 * Must NOT import or reference chat/autopilot logic.
 */

import { spawn } from 'child_process';
import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { RunScriptPayload } from '../tasks/task-types';
import { BaseExecutor } from './base-executor';
import { formatScriptResponse } from '../task-strategies/run-script-strategy';

// ============================================================================
// Types
// ============================================================================

export interface ShellExecutionResult {
    success: boolean;
    response: string;
    result: { stdout: string; stderr: string; exitCode: number | null };
    durationMs: number;
    timedOut: boolean;
}

// ============================================================================
// ShellExecutor
// ============================================================================

export class ShellExecutor extends BaseExecutor {
    private readonly defaultWorkingDirectory?: string;

    constructor(store: ProcessStore, dataDir?: string, defaultWorkingDirectory?: string) {
        super(store, dataDir);
        this.defaultWorkingDirectory = defaultWorkingDirectory;
    }

    /**
     * Execute a run-script task: spawn the shell command, capture output,
     * persist it to disk, and return a structured result.
     */
    async execute(task: QueuedTask): Promise<ShellExecutionResult> {
        const payload = task.payload as unknown as RunScriptPayload;
        const processId = toQueueProcessId(task.id);
        const cwd = payload.workingDirectory || this.defaultWorkingDirectory;

        const shellResult = await this.spawnScript(payload.script, cwd, task);

        // Persist accumulated output to disk (non-fatal)
        await this.persistOutput(processId, shellResult.response);

        return shellResult;
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    private spawnScript(
        script: string,
        cwd: string | undefined,
        task: QueuedTask,
    ): Promise<ShellExecutionResult> {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const child = spawn(script, [], { shell: true, cwd });

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
                const response = formatScriptResponse(
                    script, cwd, success, stdout, stderr, exitCode, timedOut, durationMs,
                );
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
