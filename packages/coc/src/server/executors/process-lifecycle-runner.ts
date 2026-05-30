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
    TurnSource,
} from '@plusplusoneplusplus/forge';
import {
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    modelMetadataStore,
    toQueueProcessId,
} from '@plusplusoneplusplus/forge';
import type { ChatPayload, PrClassificationPayload } from '../tasks/task-types';
import {
    extractPrompt,
    applySkillContent,
    prependSelectedSkillsDirective,
} from './prompt-builder';
import { cleanupTempDir, rehydrateImagesIfNeeded } from './image-store';
import {
    isChatFollowUp,
    isChatPayload,
    isPrClassificationPayload,
    isRunWorkflowPayload,
    isRunScriptPayload,
    hasNoteChatContext,
    isRalphMode,
    serializeRalphMetadata,
} from '../tasks/task-types';
import { deriveScriptTitle } from './title-generator';
import { BaseExecutor } from './base-executor';

// ============================================================================
// Constants
// ============================================================================

/** Statuses that represent a terminal (non-overwritable) process state. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export { TERMINAL_STATUSES };

/** Tool names that create files (mirrors client-side conversationScan.ts). */
const CREATE_TOOL_NAMES = new Set(['create', 'write_file', 'create_file', 'apply_patch']);

/**
 * Scan conversation turns for a created `.plan.md` file.
 * Mirrors the client-side detection in ChatDetail.tsx.
 */
export function scanTurnsForPlanFile(turns: ConversationTurn[]): string | undefined {
    for (const turn of turns) {
        for (const item of turn.timeline ?? []) {
            if (item.type !== 'tool-complete' || !item.toolCall) continue;
            const toolName = item.toolCall.name || '';
            if (!CREATE_TOOL_NAMES.has(toolName)) continue;

            // Handle apply_patch: check result "Added N file(s): ..." and string args "*** Add File: ..."
            if (toolName === 'apply_patch') {
                const paths: string[] = [];
                const result = item.toolCall.result;
                if (typeof result === 'string') {
                    const addedMatch = /Added \d+ file\(s\): (.+)/.exec(result);
                    if (addedMatch) paths.push(...addedMatch[1].split(',').map(s => s.trim()));
                }
                const rawArgs = item.toolCall.args as Record<string, unknown>;
                const patchText = typeof rawArgs?.diff === 'string' ? rawArgs.diff : '';
                for (const m of patchText.matchAll(/^\*\*\* Add File: (.+)$/gm)) {
                    paths.push(m[1].trim());
                }
                const planPath = paths.find(p => p.endsWith('.plan.md'));
                if (planPath) return planPath;
                continue;
            }

            const args = item.toolCall.args ?? {};
            const filePath = String(args.path || args.filePath || '');
            if (filePath.endsWith('.plan.md')) return filePath;
        }
    }
    return undefined;
}

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
        selectedSkillNames?: string[],
        model?: string,
        turnSource?: TurnSource,
        /** Per-turn reasoning-effort override, when provided by the caller. */
        reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh',
    ) => Promise<void>;
    /** Dispatch execution by task type (chat/workflow/script). */
    executeByTypeFn: (task: QueuedTask, prompt: string) => Promise<unknown>;
    /** Resolve the working directory for a given task. */
    getWorkingDirectoryFn: (task: QueuedTask) => string | undefined;
    /** Drain one pending message after task completes (server-side follow-up drain). */
    onDrainPendingMessages?: (processId: string, taskId: string) => Promise<void>;
    /**
     * Called after a ralph-mode task completes successfully.
     * The bridge uses this to parse RALPH_NEXT/RALPH_COMPLETE and enqueue the
     * next iteration (or emit a session-complete event).
     */
    onRalphNext?: (processId: string, task: QueuedTask, responseText: string) => void | Promise<void>;
    /**
     * Called after a loop-originated follow-up task finishes (success or failure).
     * The bridge uses this to invoke `LoopExecutor.onTickComplete()` so the
     * loop's tickCount/lastTickAt advance and the next timer is armed.
     *
     * Only invoked when the follow-up's payload context identifies a loop
     * (`context.source === 'loop'` and `typeof context.loopId === 'string'`).
     */
    onLoopTickComplete?: (loopId: string, success: boolean) => Promise<void> | void;
}

/**
 * Invoke `opts.onLoopTickComplete` when the follow-up's payload context
 * identifies a loop-originated tick. Errors are logged but never rethrown,
 * so that bookkeeping failures cannot mask the follow-up's actual outcome.
 */
async function notifyLoopTickComplete(
    opts: LifecycleRunnerOptions,
    ctx: Record<string, unknown> | undefined,
    success: boolean,
    logger: ReturnType<typeof getLogger>,
): Promise<void> {
    if (!opts.onLoopTickComplete) return;
    if (!ctx || ctx.source !== 'loop') return;
    if (typeof ctx.loopId !== 'string' || ctx.loopId.length === 0) return;
    try {
        await opts.onLoopTickComplete(ctx.loopId, success);
    } catch (err) {
        logger.warn(
            LogCategory.AI,
            `[QueueExecutor] onLoopTickComplete(${ctx.loopId}, success=${success}) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

// ============================================================================
// ProcessLifecycleRunner
// ============================================================================

export class ProcessLifecycleRunner extends BaseExecutor {
    private readonly onGenerateTitle: (processId: string, turns: ConversationTurn[]) => void;
    /** Active AI provider recorded on new processes for attribution ('copilot' | 'codex' | 'claude'). */
    private readonly provider: 'copilot' | 'codex' | 'claude';

    constructor(
        store: ProcessStore,
        dataDir: string | undefined,
        onGenerateTitle: (processId: string, turns: ConversationTurn[]) => void,
        provider?: 'copilot' | 'codex' | 'claude',
    ) {
        super(store, dataDir);
        this.onGenerateTitle = onGenerateTitle;
        this.provider = provider ?? 'copilot';
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
                } catch (err) {
                    logger.debug(LogCategory.AI, `[QueueExecutor] Failed to update process status for cancelled task ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
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
            // Extract turnSource from payload context for loop/wakeup-triggered follow-ups
            const ctx = followUpPayload.context as Record<string, unknown> | undefined;
            let turnSource: TurnSource | undefined;
            if (ctx?.source === 'loop' || ctx?.source === 'wakeup') {
                turnSource = {
                    source: ctx.source as 'loop' | 'wakeup',
                    ...(typeof ctx.loopId === 'string' ? { loopId: ctx.loopId } : {}),
                    ...(typeof ctx.wakeupId === 'string' ? { wakeupId: ctx.wakeupId } : {}),
                };
            }
            // Mark the target process as running BEFORE invoking the follow-up
            // executor. This closes a race where the queue has already broadcast
            // that this task is running while the process row still reads as
            // 'completed' from the prior turn, which caused the same conversation
            // to briefly appear in both Running Tasks and Completed Tasks in the
            // Activity view. Fail loud — proceeding with inconsistent state would
            // reintroduce the duplicate.
            try {
                await this.store.updateProcess(followUpPayload.processId!, { status: 'running' });
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                logger.warn(LogCategory.AI, `[QueueExecutor] Failed to mark follow-up process ${followUpPayload.processId} as running: ${errorMsg}`);
                await notifyLoopTickComplete(opts, ctx, false, logger);
                if (imageTempDir) { cleanupTempDir(imageTempDir); }
                return { success: false, error: err instanceof Error ? err : new Error(errorMsg), durationMs: Date.now() - startTime };
            }
            try {
                // Per-turn reasoning effort flows in via the follow-up payload
                // (see queue-shared.validateAndParseTask) but follow-up tasks
                // are dispatched to the follow-up executor by *parameter*, not
                // task.config — mirror the `model` pattern and pass it
                // explicitly. `task.config.reasoningEffort` is also populated,
                // so executors that need it for restart/fork scenarios still
                // find it there.
                const followUpEffort = (followUpPayload as any).reasoningEffort
                    ?? task.config.reasoningEffort;
                await opts.executeFollowUpFn(
                    followUpPayload.processId!,
                    followUpPayload.prompt,
                    followUpPayload.attachments,
                    followUpPayload.mode,
                    (followUpPayload as any).deliveryMode,
                    (followUpPayload as any).images,
                    followUpPayload.context?.skills,
                    (followUpPayload as any).model,
                    turnSource,
                    followUpEffort,
                );
                const duration = Date.now() - startTime;
                logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} completed in ${duration}ms`);
                // Drain pending messages after follow-up completion
                if (opts.onDrainPendingMessages) {
                    try {
                        await opts.onDrainPendingMessages(followUpPayload.processId!, task.id);
                    } catch (err) {
                        logger.warn(LogCategory.AI, `[QueueExecutor] Failed to drain pending messages for ${followUpPayload.processId} — messages may be stranded: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                // Notify loop executor that a loop-originated tick has finished successfully
                await notifyLoopTickComplete(opts, ctx, true, logger);
                return { success: true, durationMs: duration };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                const duration = Date.now() - startTime;
                logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} failed in ${duration}ms: ${errorMsg}`);
                // Notify loop executor that a loop-originated tick has failed
                await notifyLoopTickComplete(opts, ctx, false, logger);
                return { success: false, error: error instanceof Error ? error : new Error(errorMsg), durationMs: duration };
            } finally {
                if (imageTempDir) { cleanupTempDir(imageTempDir); }
            }
        }

        // New task: create a process entry
        const processId = toQueueProcessId(task.id);
        const prompt = applySkillContent(extractPrompt(task), task);
        const payload = task.payload as any;
        const selectedSkills = isChatPayload(task.payload)
            ? (task.payload as ChatPayload).context?.skills
            : isPrClassificationPayload(task.payload)
                ? (task.payload as unknown as PrClassificationPayload).skills
                : undefined;
        const displayPrompt = prependSelectedSkillsDirective(prompt, selectedSkills);
        const workingDirectory = opts.getWorkingDirectoryFn(task);
        const seededTokenLimit = task.config.model !== undefined
            ? modelMetadataStore.getContextWindow(task.config.model)
            : undefined;

        const process: AIProcess = {
            id: processId,
            type: task.type,
            promptPreview: displayPrompt.length > 80 ? displayPrompt.substring(0, 77) + '...' : displayPrompt,
            fullPrompt: displayPrompt,
            status: 'running',
            startTime: new Date(),
            workingDirectory,
            tokenLimit: seededTokenLimit,
            metadata: {
                type: task.type,
                queueTaskId: task.id,
                priority: task.priority,
                model: task.config.model,
                mode: payload?.mode,
                workspaceId: payload?.workspaceId || task.repoId,
                // Use per-task provider from payload when available; fall back to
                // the server-level default (this.provider) set at startup.
                provider: (isChatPayload(task.payload) ? (task.payload as ChatPayload).provider : undefined) ?? this.provider,
                workflowName: isRunWorkflowPayload(task.payload)
                    ? path.basename(task.payload.workflowPath)
                    : undefined,
                planFilePath: isChatPayload(task.payload)
                    ? task.payload.context?.files?.[0]
                    : undefined,
                workItemId: (task.payload as any)?.workItemId,
                notePath: isChatPayload(task.payload) && hasNoteChatContext(task.payload)
                    ? task.payload.context?.noteChat?.notePath
                    : undefined,
                noteTitle: isChatPayload(task.payload) && hasNoteChatContext(task.payload)
                    ? task.payload.context?.noteChat?.noteTitle
                    : undefined,
                ralph: serializeRalphMetadata(task.payload),
            },
        };

        await rehydrateImagesIfNeeded(payload);

        const payloadImages = Array.isArray(payload?.images)
            ? payload.images.filter((img: unknown) => typeof img === 'string')
            : undefined;
        const initialTurns: ConversationTurn[] = [
            {
                role: 'user',
                content: displayPrompt,
                timestamp: process.startTime,
                turnIndex: 0,
                timeline: [],
                images: payloadImages?.length > 0 ? payloadImages : undefined,
                ...(task.config.model !== undefined ? { model: task.config.model } : {}),
                ...(payload?.mode !== undefined ? { mode: payload.mode } : {}),
            },
        ];

        // Cold resume: prepend historical turns before creating the process
        const resumedFrom = (task.payload as any)?.resumedFrom;
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
                    process.conversationTurns = [
                        ...historicalTurns,
                        ...initialTurns.map((t, i) => ({ ...t, turnIndex: offset + i })),
                    ];
                } else {
                    process.conversationTurns = initialTurns;
                }
            } catch (err) {
                logger.warn(LogCategory.AI, `[QueueExecutor] Failed to load historical turns for cold resume from ${resumedFrom}: ${err instanceof Error ? err.message : String(err)}`);
                process.conversationTurns = initialTurns;
            }
        } else {
            process.conversationTurns = initialTurns;
        }

        try {
            await this.store.addProcess(process);
        } catch (err) {
            logger.warn(LogCategory.AI, `[QueueExecutor] Failed to register process ${processId} in store: ${err instanceof Error ? err.message : String(err)}`);
        }

        task.processId = processId;

        // Tracks whether the assistant conversation turn has been persisted
        // (either via the success path or the error/timeout recovery path).
        // The finally block uses this to decide whether a safety-net flush
        // is needed to finalize any orphaned streaming turn.
        let turnSaved = false;

        try {
            const result = await opts.executeByTypeFn(task, prompt);
            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} completed in ${duration}ms`);

            const sessionId = (result as any)?.sessionId;
            const responseText = (result as any)?.response ?? '';

            const finalTimeline = (result as any)?.timeline
                ?? mergeConsecutiveContentItems(this.sessions.get(processId)?.timelineBuffer || []);

            try {
                const appendResult = await this.store.appendConversationTurn(
                    processId,
                    (turnIndex) => ({
                        role: 'assistant' as const,
                        content: responseText,
                        timestamp: new Date(),
                        turnIndex,
                        toolCalls: (result as any)?.toolCalls || undefined,
                        timeline: finalTimeline,
                        suggestions: (result as any)?.pendingSuggestions ?? this.sessions.get(processId)?.pendingSuggestions,
                    }),
                    {
                        filterStreaming: true,
                        additionalUpdates: (current) => {
                            if (TERMINAL_STATUSES.has(current.status)) return {};
                            // If cancellation was requested while executing, finalize as cancelled
                            if (current.status === 'cancelling') {
                                return {
                                    status: 'cancelled' as const,
                                    endTime: new Date(),
                                    result: typeof result === 'string' ? result : JSON.stringify(result),
                                    ...(sessionId ? { sdkSessionId: sessionId } : {}),
                                };
                            }
                            return {
                                status: 'completed' as const,
                                endTime: new Date(),
                                result: typeof result === 'string' ? result : JSON.stringify(result),
                                ...(sessionId ? { sdkSessionId: sessionId } : {}),
                            };
                        },
                    },
                );

                turnSaved = true;

                const combinedTurns = appendResult?.allTurns ?? process.conversationTurns ?? initialTurns;

                const currentProc = await this.store.getProcess(
                    processId,
                    (task.payload as any)?.workspaceId as string | undefined,
                );
                const finalStatus = currentProc?.status === 'cancelled' ? 'cancelled' : 'completed';
                if (!TERMINAL_STATUSES.has(currentProc?.status ?? '')) {
                    this.store.emitProcessComplete(processId, finalStatus, `${duration}ms`);
                }

                // Drain pending messages after task completion
                if (finalStatus === 'completed' && opts.onDrainPendingMessages) {
                    try {
                        await opts.onDrainPendingMessages(processId, task.id);
                    } catch (err) {
                        logger.warn(LogCategory.AI, `[QueueExecutor] Failed to drain pending messages for ${processId} — messages may be stranded: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }

                // Trigger Ralph auto-loop for ralph-mode tasks
                if (finalStatus === 'completed' && opts.onRalphNext && isRalphMode(task.payload)) {
                    try {
                        await opts.onRalphNext(processId, task, responseText);
                    } catch (err) {
                        logger.debug(LogCategory.AI, `[QueueExecutor] Failed to trigger Ralph next iteration for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }

                // Eagerly detect .plan.md in conversation turns and set planFilePath
                if (currentProc && (currentProc.metadata as any)?.mode === 'plan' && !(currentProc.metadata as any)?.planFilePath) {
                    const detected = scanTurnsForPlanFile(combinedTurns);
                    if (detected) {
                        try {
                            await this.store.updateProcess(processId, {
                                metadata: { ...currentProc.metadata, planFilePath: detected } as any,
                            });
                        } catch (err) {
                            logger.debug(LogCategory.AI, `[QueueExecutor] Failed to persist planFilePath for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
                        }
                    }
                }

                if (isRunScriptPayload(task.payload as Record<string, unknown>)) {
                    // Deterministic title for script tasks — no AI call needed.
                    const scriptPayload = task.payload as Record<string, unknown>;
                    const titleText = task.displayName
                        ?? deriveScriptTitle((scriptPayload.script as string | undefined) ?? '');
                    void (async () => {
                        try {
                            const existing = await this.store.getProcess(processId);
                            if (!existing?.title) {
                                await this.store.updateProcess(processId, { title: titleText });
                            }
                        } catch (err) {
                            const errMsg = err instanceof Error ? err.message : String(err);
                            logger.warn(LogCategory.AI, `Script title persistence failed for ${processId}: ${errMsg}`);
                        }
                    })();
                } else {
                    setTimeout(() => this.onGenerateTitle(processId, combinedTurns), 0);
                }
            } catch (err) {
                logger.error(LogCategory.AI, `[QueueExecutor] Failed to persist conversation turn for ${processId} — turn may be lost: ${err instanceof Error ? err.message : String(err)}`);
            }

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
                if (!TERMINAL_STATUSES.has(currentProcess?.status ?? '')) {
                    const wasCancelled = opts.cancelledTasks.has(task.id) || currentProcess?.status === 'cancelling';
                    const finalStatus = wasCancelled ? 'cancelled' : 'failed';

                    // Capture the accumulated streaming buffers BEFORE the
                    // finally block tears the session down. This is what
                    // turns a hard timeout (e.g. SDK idle timeout after an
                    // hour of streaming) from a silent data-loss event into
                    // a recoverable conversation turn.
                    const session = this.sessions.get(processId);
                    const partialContent = session?.outputBuffer ?? '';
                    const partialTimeline = session?.timelineBuffer
                        ? mergeConsecutiveContentItems([...session.timelineBuffer])
                        : [];
                    const partialSuggestions = session?.pendingSuggestions;

                    const hasPartial = partialContent.length > 0 || partialTimeline.length > 0;

                    if (hasPartial) {
                        try {
                            await this.store.appendConversationTurn(
                                processId,
                                (turnIndex) => ({
                                    role: 'assistant' as const,
                                    content: partialContent || `Error: ${errorMsg}`,
                                    timestamp: new Date(),
                                    turnIndex,
                                    timeline: partialTimeline,
                                    ...(partialSuggestions ? { suggestions: partialSuggestions } : {}),
                                }),
                                {
                                    filterStreaming: true,
                                    additionalUpdates: {
                                        status: finalStatus,
                                        endTime: new Date(),
                                        ...(wasCancelled ? {} : { error: errorMsg }),
                                    },
                                },
                            );
                            turnSaved = true;
                        } catch (appendErr) {
                            logger.warn(
                                LogCategory.AI,
                                `[QueueExecutor] Failed to persist partial conversation turn for ${processId}: ${appendErr instanceof Error ? appendErr.message : String(appendErr)}`,
                            );
                            // Fall back to status-only update so the process
                            // doesn't remain stuck in 'running'.
                            await this.store.updateProcess(processId, {
                                status: finalStatus,
                                endTime: new Date(),
                                ...(wasCancelled ? {} : { error: errorMsg }),
                            });
                        }
                    } else {
                        await this.store.updateProcess(processId, {
                            status: finalStatus,
                            endTime: new Date(),
                            ...(wasCancelled ? {} : { error: errorMsg }),
                        });
                    }
                    this.store.emitProcessComplete(processId, finalStatus, `${duration}ms`);
                }
            } catch (err) {
                logger.warn(LogCategory.AI, `[QueueExecutor] Failed to update failed process status for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
            }

            return {
                success: false,
                error: error instanceof Error ? error : new Error(errorMsg),
                durationMs: Date.now() - startTime,
            };
        } finally {
            // Safety-net: if neither the success path nor the error-recovery
            // path persisted the assistant turn, finalize any orphaned
            // streaming turn so the UI doesn't show a perpetual "streaming"
            // indicator. flushConversationTurn writes streaming=false which
            // updates the existing streaming row in place (no duplicate).
            if (!turnSaved) {
                try {
                    await this.flushConversationTurn(processId, false);
                } catch {
                    // Non-fatal
                }
            }

            const buffer = this.sessions.get(processId)?.outputBuffer ?? '';
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer, (task.payload as any)?.workspaceId);
        }
    }
}
