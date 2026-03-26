/**
 * Process Lifecycle Runner
 *
 * Owns the full process lifecycle for a queued task:
 * - Cancellation check (pre-execution)
 * - Follow-up routing (reuses an existing process)
 * - AIProcess creation and store registration
 * - executeByType dispatch (delegated via callback)
 * - Conversation turn assembly (user + assistant)
 * - Cold-resume historical turn prepending
 * - Process status update (completed / failed)
 * - Fire-and-forget title generation
 * - Output persistence in finally
 *
 * Extracted from CLITaskExecutor so the bridge becomes a thin routing facade.
 * Extends BaseExecutor for shared streaming/session plumbing (sessions map,
 * cleanupSession, flushConversationTurn, persistOutput).
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import type {
    AIProcess,
    Attachment,
    ConversationTurn,
    ProcessStore,
    QueuedTask,
    TaskExecutionResult,
} from '@plusplusoneplusplus/forge';
import {
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    modelMetadataStore,
} from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../task-types';
import {
    extractPrompt,
    applySkillContent,
} from './prompt-builder';
import { cleanupTempDir, rehydrateImagesIfNeeded } from './image-store';
import {
    isChatFollowUp,
    isChatPayload,
    isRunWorkflowPayload,
} from '../task-types';
import { recordUserMessage } from '../memory/conversation-recorder';
import { BaseExecutor } from './base-executor';

// ============================================================================
// Constants
// ============================================================================

/** Statuses that represent a terminal (non-overwritable) process state. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export { TERMINAL_STATUSES };

// ============================================================================
// Types
// ============================================================================

export interface LifecycleRunnerOptions {
    /** Set of task IDs that have been cancelled (shared with the bridge). */
    cancelledTasks: Set<string>;
    /** Delegate follow-up execution to the FollowUpExecutor. */
    executeFollowUpFn: (
        processId: string,
        message: string,
        attachments?: Attachment[],
        mode?: string,
        deliveryMode?: string,
        images?: string[],
    ) => Promise<void>;
    /** Dispatch execution by task type (chat/workflow/script). */
    executeByTypeFn: (task: QueuedTask, prompt: string) => Promise<unknown>;
    /** Resolve the working directory for a given task. */
    getWorkingDirectoryFn: (task: QueuedTask) => string | undefined;
}

// ============================================================================
// ProcessLifecycleRunner
// ============================================================================

export class ProcessLifecycleRunner extends BaseExecutor {
    private readonly onGenerateTitle: (processId: string, turns: ConversationTurn[]) => void;

    constructor(
        store: ProcessStore,
        dataDir: string | undefined,
        onGenerateTitle: (processId: string, turns: ConversationTurn[]) => void,
    ) {
        super(store, dataDir);
        this.onGenerateTitle = onGenerateTitle;
    }

    /**
     * Run a queued task through the full process lifecycle.
     *
     * Handles: cancellation, follow-up routing, process creation,
     * executeByType dispatch, conversation assembly, status update,
     * and output persistence.
     */
    async run(task: QueuedTask, opts: LifecycleRunnerOptions): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();
        logger.debug(LogCategory.AI, `[QueueExecutor] Starting task ${task.id} (type: ${task.type}, name: ${task.displayName || 'unnamed'})`);

        // Check if cancelled before starting
        if (opts.cancelledTasks.has(task.id)) {
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} was cancelled before starting`);
            if (isChatFollowUp(task.payload)) {
                const payload = task.payload as unknown as ChatPayload;
                task.processId = payload.processId;
                const imageTempDir = payload.imageTempDir;
                try {
                    await this.store.updateProcess(payload.processId!, { status: 'completed' });
                } catch {
                    // Non-fatal: process may already be cleaned up
                }
                if (imageTempDir) { cleanupTempDir(imageTempDir); }
            }
            return { success: false, error: new Error('Task cancelled'), durationMs: 0 };
        }

        // Follow-up: reuse the existing process
        if (isChatFollowUp(task.payload)) {
            const followUpPayload = task.payload as unknown as ChatPayload;
            task.processId = followUpPayload.processId;
            const imageTempDir = followUpPayload.imageTempDir;
            await rehydrateImagesIfNeeded(task.payload as any);
            try {
                await opts.executeFollowUpFn(
                    followUpPayload.processId!,
                    followUpPayload.prompt,
                    followUpPayload.attachments,
                    followUpPayload.mode,
                    (followUpPayload as any).deliveryMode,
                    (followUpPayload as any).images,
                );
                const duration = Date.now() - startTime;
                logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} completed in ${duration}ms`);
                return { success: true, durationMs: duration };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                const duration = Date.now() - startTime;
                logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} failed in ${duration}ms: ${errorMsg}`);
                return { success: false, error: error instanceof Error ? error : new Error(errorMsg), durationMs: duration };
            } finally {
                if (imageTempDir) { cleanupTempDir(imageTempDir); }
            }
        }

        // New task: create a process entry
        const processId = `queue_${task.id}`;
        const prompt = applySkillContent(extractPrompt(task), task);
        const workingDirectory = opts.getWorkingDirectoryFn(task);
        const seededTokenLimit = task.config.model !== undefined
            ? modelMetadataStore.getContextWindow(task.config.model)
            : undefined;

        const process: AIProcess = {
            id: processId,
            type: task.type,
            promptPreview: prompt.length > 80 ? prompt.substring(0, 77) + '...' : prompt,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            workingDirectory,
            tokenLimit: seededTokenLimit,
            metadata: {
                type: task.type,
                queueTaskId: task.id,
                priority: task.priority,
                model: task.config.model,
                mode: (task.payload as any)?.mode,
                workspaceId: (task.payload as any)?.workspaceId,
                workflowName: isRunWorkflowPayload(task.payload)
                    ? path.basename(task.payload.workflowPath)
                    : undefined,
            },
        };

        const payload = task.payload as any;
        await rehydrateImagesIfNeeded(payload);

        const payloadImages = Array.isArray(payload?.images)
            ? payload.images.filter((img: unknown) => typeof img === 'string')
            : undefined;
        const initialTurns: ConversationTurn[] = [
            {
                role: 'user',
                content: prompt,
                timestamp: process.startTime,
                turnIndex: 0,
                timeline: [],
                images: payloadImages?.length > 0 ? payloadImages : undefined,
            },
        ];
        process.conversationTurns = initialTurns;

        // Record initial prompt to memory (skip scheduled/template-generated runs)
        const isScheduledRun = isChatPayload(task.payload) && !!task.payload.context?.scheduleId;
        if (this.dataDir && task.type === 'chat' && !isScheduledRun) {
            const wsId = (process.metadata?.workspaceId as string) ?? '';
            if (wsId) {
                try { recordUserMessage(this.dataDir, wsId, prompt); } catch { /* never block */ }
            }
        }

        try {
            await this.store.addProcess(process);
        } catch {
            // Non-fatal: store may be a stub
        }

        task.processId = processId;

        try {
            const result = await opts.executeByTypeFn(task, prompt);
            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} completed in ${duration}ms`);

            const sessionId = (result as any)?.sessionId;
            const responseText = (result as any)?.response ?? '';

            const finalTimeline = (result as any)?.timeline
                ?? mergeConsecutiveContentItems(this.sessions.get(processId)?.timelineBuffer || []);

            const currentProcess = await this.store.getProcess(
                processId,
                (task.payload as any)?.workspaceId as string | undefined,
            );
            const existingTurns = currentProcess?.conversationTurns?.length
                ? currentProcess.conversationTurns
                : initialTurns;

            const finalTurns: ConversationTurn[] = [
                existingTurns[0],
                {
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                    turnIndex: 1,
                    toolCalls: (result as any)?.toolCalls || undefined,
                    timeline: finalTimeline,
                    suggestions: (result as any)?.pendingSuggestions ?? this.sessions.get(processId)?.pendingSuggestions,
                },
            ];

            // Cold resume: prepend historical turns from the original session
            const resumedFrom = (task.payload as any)?.resumedFrom;
            let combinedTurns = finalTurns;
            if (resumedFrom && typeof resumedFrom === 'string') {
                try {
                    const oldProcess = await this.store.getProcess(
                        resumedFrom,
                        (task.payload as any)?.workspaceId as string | undefined,
                    );
                    if (oldProcess?.conversationTurns?.length) {
                        const historicalTurns: ConversationTurn[] = oldProcess.conversationTurns.map((t, i) => ({
                            ...t,
                            historical: true,
                            turnIndex: i,
                        }));
                        const offset = historicalTurns.length;
                        combinedTurns = [
                            ...historicalTurns,
                            ...finalTurns.map((t, i) => ({ ...t, turnIndex: offset + i })),
                        ];
                    }
                } catch {
                    // Non-fatal: old process may be gone
                }
            }

            try {
                const currentProc = await this.store.getProcess(
                    processId,
                    (task.payload as any)?.workspaceId as string | undefined,
                );
                if (!TERMINAL_STATUSES.has(currentProc?.status ?? '')) {
                    await this.store.updateProcess(processId, {
                        status: 'completed',
                        endTime: new Date(),
                        result: typeof result === 'string' ? result : JSON.stringify(result),
                        ...(sessionId ? { sdkSessionId: sessionId } : {}),
                        conversationTurns: combinedTurns,
                    });
                    this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);
                }
            } catch {
                // Non-fatal
            }

            // Schedule title generation as a macrotask so it runs AFTER the queue
            // executor fires taskCompleted and after the caller's synchronous code.
            setTimeout(() => this.onGenerateTitle(processId, combinedTurns), 0);

            return { success: true, result, durationMs: Date.now() - startTime };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} failed in ${duration}ms: ${errorMsg}`);

            try {
                const currentProcess = await this.store.getProcess(
                    processId,
                    (task.payload as any)?.workspaceId as string | undefined,
                );
                const existingTurns = currentProcess?.conversationTurns || initialTurns;
                if (!TERMINAL_STATUSES.has(currentProcess?.status ?? '')) {
                    await this.store.updateProcess(processId, {
                        status: 'failed',
                        endTime: new Date(),
                        error: errorMsg,
                        conversationTurns: existingTurns,
                    });
                    this.store.emitProcessComplete(processId, 'failed', `${duration}ms`);
                }
            } catch {
                // Non-fatal
            }

            return {
                success: false,
                error: error instanceof Error ? error : new Error(errorMsg),
                durationMs: Date.now() - startTime,
            };
        } finally {
            const buffer = this.sessions.get(processId)?.outputBuffer ?? '';
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer);
        }
    }
}
