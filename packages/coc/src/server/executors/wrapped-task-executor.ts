/**
 * Wrapped Task Executor
 *
 * Orchestrates before-script → AI task → after-script execution.
 * The after-script always runs, even if the AI task or before-script fails.
 * Emits hook-step events to the process store for real-time UI tracking.
 */

import { spawn } from 'child_process';
import type { ProcessStore, QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../task-types';

// ============================================================================
// Types
// ============================================================================

export interface ScriptResult {
    success: boolean;
    output: string;
    durationMs: number;
}

export interface InnerExecutor {
    execute(task: QueuedTask, prompt: string): Promise<unknown>;
}

// ============================================================================
// WrappedTaskExecutor
// ============================================================================

export class WrappedTaskExecutor {
    constructor(
        private readonly innerExecutor: InnerExecutor,
        private readonly store: ProcessStore,
    ) {}

    async execute(task: QueuedTask, prompt: string): Promise<unknown> {
        const payload = task.payload as unknown as ChatPayload;
        const processId = `queue_${task.id}`;

        // Step 1: before-script
        if (payload.beforeScript) {
            this.emitHookStep(processId, 'before', 'running', payload.beforeScript);
            const result = await this.runScript(payload.beforeScript, payload.workingDirectory);
            if (!result.success) {
                this.emitHookStep(processId, 'before', 'failed', payload.beforeScript, result.output, result.durationMs);
                // Still run after-script before throwing
                await this.runAfterScript(payload, processId);
                throw new Error(`Before-script failed: ${result.output}`);
            }
            this.emitHookStep(processId, 'before', 'done', payload.beforeScript, undefined, result.durationMs);
        }

        // Step 2: AI task
        let aiError: unknown;
        let aiResult: unknown;
        try {
            aiResult = await this.innerExecutor.execute(task, prompt);
        } catch (err) {
            aiError = err;
        }

        // Step 3: after-script (always runs)
        await this.runAfterScript(payload, processId);

        if (aiError) throw aiError;
        return aiResult;
    }

    private async runAfterScript(payload: ChatPayload, processId: string): Promise<void> {
        if (!payload.afterScript) return;
        this.emitHookStep(processId, 'after', 'running', payload.afterScript);
        const result = await this.runScript(payload.afterScript, payload.workingDirectory);
        const status = result.success ? 'done' : 'failed';
        this.emitHookStep(processId, 'after', status, payload.afterScript, result.output, result.durationMs);
    }

    private emitHookStep(
        processId: string,
        step: 'before' | 'after',
        status: 'running' | 'done' | 'failed',
        script: string,
        output?: string,
        durationMs?: number,
    ): void {
        this.store.emitProcessEvent(processId, {
            type: 'hook-step',
            hookStep: { step, status, script, output, durationMs },
        });
    }

    runScript(script: string, cwd?: string): Promise<ScriptResult> {
        const startTime = Date.now();
        return new Promise((resolve, reject) => {
            const child = spawn(script, [], { shell: true, cwd });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            child.on('error', (err) => {
                reject(err);
            });

            child.on('close', (exitCode) => {
                const durationMs = Date.now() - startTime;
                const output = (stdout + stderr).trim();
                resolve({
                    success: exitCode === 0,
                    output,
                    durationMs,
                });
            });
        });
    }
}
