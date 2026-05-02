/**
 * Wrapped Task Executor
 *
 * Orchestrates before-script → AI task → after-script → post-actions execution.
 * The after-script and post-actions always run, even if the AI task or before-script fails.
 * Emits hook-step events to the process store for real-time UI tracking.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { ProcessStore, QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import { resolveSkill, SkillResolverError, getLogger, LogCategory, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import type { ITaskExecutor } from './executor-types';

// ============================================================================
// Types
// ============================================================================

export interface ScriptResult {
    success: boolean;
    output: string;
    durationMs: number;
}

/** Callback for executing a skill prompt via the AI service. */
export type SkillExecuteFn = (prompt: string, workingDirectory?: string, model?: string) => Promise<string>;

/** Async resolver for skill directories (lazy-loaded when needed). */
export type ResolveSkillConfigFn = (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;

/** @deprecated Use {@link ITaskExecutor} from `./executor-types` instead. */
export type InnerExecutor = ITaskExecutor;

// ============================================================================
// Utilities
// ============================================================================

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// WrappedTaskExecutor
// ============================================================================

export class WrappedTaskExecutor {
    constructor(
        private readonly innerExecutor: ITaskExecutor,
        private readonly store: ProcessStore,
        private readonly resolveSkillConfigFn?: ResolveSkillConfigFn,
        private readonly executeSkill?: SkillExecuteFn,
    ) {}

    async execute(task: QueuedTask, prompt: string): Promise<unknown> {
        const payload = task.payload as unknown as ChatPayload;
        const processId = toQueueProcessId(task.id);

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

        // Step 4: post-actions (always run, even if AI failed)
        await this.runPostActions(payload, processId, aiResult, aiError);

        if (aiError) throw aiError;
        return aiResult;
    }

    // ========================================================================
    // After-script
    // ========================================================================

    private async runAfterScript(payload: ChatPayload, processId: string): Promise<void> {
        if (!payload.afterScript) return;
        this.emitHookStep(processId, 'after', 'running', payload.afterScript);
        const result = await this.runScript(payload.afterScript, payload.workingDirectory);
        const status = result.success ? 'done' : 'failed';
        this.emitHookStep(processId, 'after', status, payload.afterScript, result.output, result.durationMs);
    }

    // ========================================================================
    // Post-actions
    // ========================================================================

    private async runPostActions(
        payload: ChatPayload,
        processId: string,
        aiResult: unknown,
        aiError: unknown,
    ): Promise<void> {
        if (!payload.postActions?.length) return;

        const taskContext = this.buildTaskContext(payload, aiResult, aiError);

        for (let i = 0; i < payload.postActions.length; i++) {
            const action = payload.postActions[i];
            const stepName = `post-action-${i}`;

            if (action.type === 'script') {
                this.emitHookStep(processId, stepName, 'running', action.script, undefined, undefined, i, 'script');
                const result = await this.runScript(action.script, payload.workingDirectory);
                const status = result.success ? 'done' : 'failed';
                this.emitHookStep(processId, stepName, status, action.script, result.output, result.durationMs, i, 'script');
            } else if (action.type === 'skill') {
                this.emitHookStep(processId, stepName, 'running', action.skillName, undefined, undefined, i, 'skill', action.skillName);
                const startTime = Date.now();
                try {
                    if (!this.executeSkill) {
                        throw new Error('Skill execution is not configured');
                    }
                    const skillContent = await this.resolveSkillContent(action.skillName, payload.workingDirectory);
                    if (!skillContent) {
                        throw new Error(`Skill "${action.skillName}" not found`);
                    }

                    const skillPrompt = [
                        taskContext,
                        `<skill name="${action.skillName}">\n${skillContent}\n</skill>`,
                        action.prompt || '',
                    ].filter(Boolean).join('\n\n');

                    const response = await this.executeSkill(skillPrompt, payload.workingDirectory, payload.model);
                    const durationMs = Date.now() - startTime;
                    this.emitHookStep(processId, stepName, 'done', action.skillName, response, durationMs, i, 'skill', action.skillName);
                } catch (err) {
                    const durationMs = Date.now() - startTime;
                    const msg = err instanceof Error ? err.message : String(err);
                    getLogger().warn(LogCategory.AI, `[WrappedTaskExecutor] Skill post-action failed: ${action.skillName}: ${msg}`);
                    this.emitHookStep(processId, stepName, 'failed', action.skillName, msg, durationMs, i, 'skill', action.skillName);
                }
            }
        }
    }

    private buildTaskContext(
        payload: ChatPayload,
        aiResult: unknown,
        aiError: unknown,
    ): string {
        const result = aiResult as { response?: string } | undefined;
        const status = aiError ? 'failed' : 'success';
        const errorMsg = aiError instanceof Error ? aiError.message : aiError ? String(aiError) : undefined;

        return [
            '<task-context>',
            `  <status>${status}</status>`,
            `  <original-prompt>${escapeXml(payload.prompt)}</original-prompt>`,
            `  <mode>${payload.mode}</mode>`,
            payload.model ? `  <model>${payload.model}</model>` : '',
            payload.workingDirectory ? `  <working-directory>${payload.workingDirectory}</working-directory>` : '',
            result?.response ? `  <response>${escapeXml(result.response)}</response>` : '',
            errorMsg ? `  <error>${escapeXml(errorMsg)}</error>` : '',
            '</task-context>',
        ].filter(Boolean).join('\n');
    }

    private async resolveSkillContent(
        skillName: string,
        workingDirectory: string | undefined,
    ): Promise<string | undefined> {
        // 1. Try workspace-local .github/skills/
        if (workingDirectory) {
            try {
                return await resolveSkill(skillName, workingDirectory);
            } catch (err) {
                if (!(err instanceof SkillResolverError)) throw err;
            }
        }
        // 2. Fall back to skill directories (global, extra folders)
        if (this.resolveSkillConfigFn) {
            const { skillDirectories } = await this.resolveSkillConfigFn(undefined, workingDirectory);
            if (skillDirectories) {
                for (const dir of skillDirectories) {
                    const skillMdPath = path.join(dir, skillName, 'SKILL.md');
                    try {
                        const content = await fs.promises.readFile(skillMdPath, 'utf-8');
                        return content.replace(/^---[\s\S]*?---\s*/m, '').trim();
                    } catch {
                        // Not in this directory, try next
                    }
                }
            }
        }
        return undefined;
    }

    // ========================================================================
    // Event emission
    // ========================================================================

    private emitHookStep(
        processId: string,
        step: string,
        status: 'running' | 'done' | 'failed',
        script: string,
        output?: string,
        durationMs?: number,
        index?: number,
        actionType?: 'script' | 'skill',
        skillName?: string,
    ): void {
        this.store.emitProcessEvent(processId, {
            type: 'hook-step',
            hookStep: { step, status, script, output, durationMs, index, actionType, skillName },
        });
    }

    // ========================================================================
    // Script execution
    // ========================================================================

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
