/**
 * Queue Executor Bridge
 *
 * Wires up a QueueExecutor with a CLITaskExecutor to actually execute
 * queued tasks in the coc serve server. Bridges executor events
 * to the ProcessStore and WebSocket for real-time UI updates.
 *
 * Task types supported:
 * - ai-clarification: Sends prompt to CopilotSDKService
 * - chat: Interactive SPA conversation, sends prompt to CopilotSDKService (readonly flag for read-only mode)
 * - custom: Sends payload.data.prompt to CopilotSDKService
 * - follow-prompt: Reads prompt file and sends to CopilotSDKService
 * - task-generation: Builds task creation prompt and sends to CopilotSDKService
 * - code-review / resolve-comments: Marked as completed (no-op placeholder)
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ResolveCommentsPayload, RunWorkflowPayload, RunScriptPayload, TaskGenerationPayload, ChatPayload, ReplicateTemplatePayload } from '@plusplusoneplusplus/coc-server';
import {
    cleanupTempDir,
    createSuggestFollowUpsTool,
    isAIClarificationPayload, isChatPayload,
    isChatFollowUp,
    isCustomTaskPayload,
    isFollowPromptPayload,
    isReplicateTemplatePayload,
    isResolveCommentsPayload,
    isRunWorkflowPayload,
    isRunScriptPayload,
    isTaskGenerationPayload,
    saveImagesToTempFiles,
} from '@plusplusoneplusplus/coc-server';
import type { AIProcess, Attachment, AutoFolderContext, ConversationTurn, CopilotSDKService, PipelinePhase, PipelinePhaseStatus, ProcessStore, SelectedContext, TimelineItem, Tool, ToolEvent } from '@plusplusoneplusplus/pipeline-core';
import {
    approveAllPermissions,
    applyDeepModePrefix,
    AUTO_FOLDER_SENTINEL,
    buildCreateFromFeaturePrompt,
    buildCreateTaskPrompt,
    buildCreateTaskPromptWithName,
    buildDeepModePrompt,
    computeRemoteHash,
    createQueueExecutor,
    DEFAULT_AI_TIMEOUT_MS,
    TASK_FILTER,
    compileToWorkflow,
    executeWorkflow,
    flattenWorkflowResult,
    FileToolCallCacheStore,
    gatherFeatureContext,
    getCopilotSDKService,
    getLogger,
    getRemoteUrl,
    LogCategory,
    mergeConsecutiveContentItems,
    QueuedTask,
    QueueExecutor,
    TaskExecutionResult,
    TaskExecutor,
    TaskQueueManager,
    toNativePath,
    ToolCallCapture,
} from '@plusplusoneplusplus/pipeline-core';
import { replicateCommit } from '@plusplusoneplusplus/pipeline-core/templates';
import type { ReplicateResult, ReplicateProgressCallback } from '@plusplusoneplusplus/pipeline-core/templates';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { createCLIAIInvoker } from '../ai-invoker';
import { ImageBlobStore } from './image-blob-store';
import { OutputFileManager } from './output-file-manager';

// ============================================================================
// Constants
// ============================================================================

/** Statuses that represent a terminal (non-overwritable) process state. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** Prompt prefix prepended to read-only chat messages to instruct the AI not to modify files. */
export const READONLY_PROMPT_PREFIX =
    'IMPORTANT: You are in read-only mode. You MUST NOT create, edit, delete, or modify any files or source code that\'s tracked by the git. Special files like task plan markdown files are exempt from this rule. If the user asks you to make changes, explain what changes would be needed but do not execute them.\n\n';

// ============================================================================
// Types
// ============================================================================

export interface QueueExecutorBridgeOptions {
    /** Maximum concurrent task executions (default: 1). Deprecated: use sharedConcurrency/exclusiveConcurrency. */
    maxConcurrency?: number;
    /** Concurrency limit for shared (read-only) tasks (default: 5) */
    sharedConcurrency?: number;
    /** Concurrency limit for exclusive (write) tasks (default: 1) */
    exclusiveConcurrency?: number;
    /** Policy callback to classify a task as exclusive. Default: defaultIsExclusive */
    isExclusive?: (task: QueuedTask) => boolean;
    /** Whether to auto-start processing (default: true) */
    autoStart?: boolean;
    /** Whether to auto-approve AI permission requests (default: true) */
    approvePermissions?: boolean;
    /** Working directory for AI sessions */
    workingDirectory?: string;
    /** Directory for persisted data (output files, etc.). Default: ~/.coc */
    dataDir?: string;
    /** Optional AI service injection (for testing). If not provided, uses getCopilotSDKService(). */
    aiService?: CopilotSDKService;
    /** Default timeout in ms for tasks that don't specify their own timeoutMs */
    defaultTimeoutMs?: number;
    /** Follow-up suggestions configuration */
    followUpSuggestions?: { enabled: boolean; count: number };
    /** Lazy getter for the WebSocket server — used to broadcast comment-resolved events. */
    getWsServer?: () => import('@plusplusoneplusplus/coc-server').ProcessWebSocketServer | undefined;
}

/**
 * Exposes follow-up execution for the API layer.
 * Implemented by CLITaskExecutor, surfaced via the bridge factory.
 */
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[]): Promise<void>;
    /** Check whether the underlying SDK session for a process is still alive. */
    isSessionAlive(processId: string): Promise<boolean>;
    /** Cancel a running process by aborting its live AI session. */
    cancelProcess?(processId: string): Promise<void>;
}

// ============================================================================
// CLI Task Executor
// ============================================================================

/**
 * Task executor that uses CopilotSDKService to execute queued tasks.
 * Creates AIProcess entries in the ProcessStore for tracking.
 */
export class CLITaskExecutor implements TaskExecutor {
    private readonly store: ProcessStore;
    private readonly cancelledTasks: Set<string> = new Set();
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;
    private readonly dataDir?: string;
    /** AI service instance (injected or default from getCopilotSDKService()) */
    private readonly aiService: CopilotSDKService;
    /** Default timeout in ms for tasks without explicit timeoutMs */
    private readonly defaultTimeoutMs: number;
    /** Per-process output accumulator for persisting conversation output */
    private readonly outputBuffers: Map<string, string> = new Map();
    /** Per-process timeline accumulator for chronological execution events */
    private readonly timelineBuffers: Map<string, TimelineItem[]> = new Map();
    /** Per-process throttle state for streaming conversation flushes */
    private readonly throttleState: Map<string, {
        chunksSinceLastFlush: number;
        lastFlushTime: number;
    }> = new Map();
    /** Per-process buffered follow-up suggestions from the suggest_follow_ups tool */
    private readonly pendingSuggestions: Map<string, string[]> = new Map();
    /** Time-based throttle: flush every N milliseconds */
    private static readonly THROTTLE_TIME_MS = 5000;
    /** Count-based throttle: flush every N chunks */
    private static readonly THROTTLE_CHUNK_COUNT = 50;

    /** Follow-up suggestions configuration */
    private readonly followUpSuggestions: { enabled: boolean; count: number };
    /** Lazy getter for the WebSocket server to broadcast file events */
    private readonly getWsServer?: () => import('@plusplusoneplusplus/coc-server').ProcessWebSocketServer | undefined;
    /** Optional queue manager for re-activating parent tasks during follow-ups */
    private queueManager?: TaskQueueManager;
    /** Shared store for tool-call Q&A capture (explore cache). */
    private readonly toolCallCacheStore: FileToolCallCacheStore;

    constructor(store: ProcessStore, options: { approvePermissions?: boolean; workingDirectory?: string; dataDir?: string; aiService?: CopilotSDKService; defaultTimeoutMs?: number; followUpSuggestions?: { enabled: boolean; count: number }; getWsServer?: () => import('@plusplusoneplusplus/coc-server').ProcessWebSocketServer | undefined } = {}) {
        this.store = store;
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.dataDir = options.dataDir;
        this.aiService = options.aiService ?? getCopilotSDKService();
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
        this.followUpSuggestions = options.followUpSuggestions ?? { enabled: true, count: 3 };
        this.getWsServer = options.getWsServer;
        this.toolCallCacheStore = new FileToolCallCacheStore(
            (() => {
                const memoryDataDir = this.dataDir ? path.join(this.dataDir, 'memory') : undefined;
                const workDir = options.workingDirectory;
                if (workDir) {
                    const remoteUrl = getRemoteUrl(workDir);
                    if (remoteUrl) {
                        return {
                            ...(memoryDataDir ? { dataDir: memoryDataDir } : undefined),
                            level: 'git-remote' as const,
                            remoteHash: computeRemoteHash(remoteUrl),
                        };
                    }
                }
                return memoryDataDir ? { dataDir: memoryDataDir } : undefined;
            })(),
        );
    }

    /** Inject the queue manager (called by createQueueExecutorBridge after construction). */
    setQueueManager(qm: TaskQueueManager): void {
        this.queueManager = qm;
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();

        logger.debug(LogCategory.AI, `[QueueExecutor] Starting task ${task.id} (type: ${task.type}, name: ${task.displayName || 'unnamed'})`);

        // Check if cancelled before starting
        if (this.cancelledTasks.has(task.id)) {
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} was cancelled before starting`);
            // For follow-ups, revert the original process from 'running' back to 'completed'
            // since api-handler.ts set it to 'running' before enqueueing
            if (isChatFollowUp(task.payload)) {
                const payload = task.payload as unknown as ChatPayload;
                task.processId = payload.processId;
                try {
                    await this.store.updateProcess(payload.processId!, { status: 'completed' });
                } catch {
                    // Non-fatal: process may already be cleaned up
                }
                // Return the parent task from queue back to history
                if (payload.parentTaskId && this.queueManager) {
                    this.queueManager.returnToHistory(payload.parentTaskId);
                }
                if (payload.imageTempDir) {
                    cleanupTempDir(payload.imageTempDir);
                }
            }
            return { success: false, error: new Error('Task cancelled'), durationMs: 0 };
        }

        // ── Chat follow-up: skip ghost process creation — reuse the original process ──
        if (isChatFollowUp(task.payload)) {
            const followUpPayload = task.payload as unknown as ChatPayload;
            task.processId = followUpPayload.processId;
            const parentTaskId = followUpPayload.parentTaskId;

            // Re-activate the parent chat task so it shows as "running" in the queue
            if (parentTaskId && this.queueManager) {
                this.queueManager.reActivate(parentTaskId);
            }

            // Rehydrate externalized images if needed
            const rawPayload = task.payload as any;
            if (rawPayload?.imagesFilePath && (!Array.isArray(rawPayload.images) || rawPayload.images.length === 0)) {
                rawPayload.images = await ImageBlobStore.loadImages(rawPayload.imagesFilePath);
            }

            try {
                await this.executeFollowUp(followUpPayload.processId!, followUpPayload.prompt, followUpPayload.attachments);
                const duration = Date.now() - startTime;
                logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} completed in ${duration}ms`);

                // Return parent chat task to history with updated display name
                if (parentTaskId && this.queueManager) {
                    const proc = await this.store.getProcess(followUpPayload.processId!);
                    const turnCount = proc?.conversationTurns?.length ?? 0;
                    this.queueManager.updateTask(parentTaskId, { displayName: `Chat (${turnCount} turns)` });
                    this.queueManager.markCompleted(parentTaskId);
                }

                return { success: true, durationMs: duration };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                const duration = Date.now() - startTime;
                logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} failed in ${duration}ms: ${errorMsg}`);

                // Return parent chat task to history even on failure
                if (parentTaskId && this.queueManager) {
                    this.queueManager.markCompleted(parentTaskId);
                }

                return { success: false, error: error instanceof Error ? error : new Error(errorMsg), durationMs: duration };
            } finally {
                if (followUpPayload.imageTempDir) {
                    cleanupTempDir(followUpPayload.imageTempDir);
                }
            }
        }

        // Create a process in the store for tracking
        // Format: <type>_<uuid> e.g. queue_1771242852770-g94u3ig
        const processId = `queue_${task.id}`;
        const prompt = this.applySkillContent(this.extractPrompt(task), task);
        const workingDirectory = this.getWorkingDirectory(task);
        const process: AIProcess = {
            id: processId,
            type: `queue-${task.type}`,
            promptPreview: prompt.length > 80 ? prompt.substring(0, 77) + '...' : prompt,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            workingDirectory,
            metadata: {
                type: `queue-${task.type}`,
                queueTaskId: task.id,
                priority: task.priority,
                model: task.config.model,
                workflowName: isRunWorkflowPayload(task.payload)
                    ? path.basename(task.payload.workflowPath)
                    : undefined,
            },
        };

        // Rehydrate externalized images from blob store before building conversation turn
        const payload = task.payload as any;
        if (payload?.imagesFilePath && (!Array.isArray(payload.images) || payload.images.length === 0)) {
            payload.images = await ImageBlobStore.loadImages(payload.imagesFilePath);
        }

        // Store initial user turn immediately so it survives page refresh
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

        try {
            await this.store.addProcess(process);
        } catch {
            // Non-fatal: store may be a stub
        }

        // Link process ID to task
        task.processId = processId;

        try {
            const result = await this.executeByType(task, prompt);

            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} completed in ${duration}ms`);

            // Extract session and response data for conversation tracking
            const sessionId = (result as any)?.sessionId;
            const responseText = (result as any)?.response ?? '';

            // Clean up throttle state
            this.throttleState.delete(processId);

            // Drain accumulated timeline items for the final assistant turn
            const finalTimeline = mergeConsecutiveContentItems(this.timelineBuffers.get(processId) || []);
            this.timelineBuffers.delete(processId);

            // Build final conversation turns (re-read from store to include any flushed streaming data)
            const currentProcess = await this.store.getProcess(processId);
            const existingTurns = currentProcess?.conversationTurns || initialTurns;

            // Replace or append the assistant turn with the final complete response
            const finalTurns: ConversationTurn[] = [
                existingTurns[0], // user turn
                {
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                    turnIndex: 1,
                    toolCalls: (result as any)?.toolCalls || undefined,
                    timeline: finalTimeline,
                    suggestions: this.pendingSuggestions.get(processId),
                },
            ];
            this.pendingSuggestions.delete(processId);

            // Cold resume: prepend historical turns from the original session
            const resumedFrom = (task.payload as any)?.resumedFrom;
            let combinedTurns = finalTurns;
            if (resumedFrom && typeof resumedFrom === 'string') {
                try {
                    const oldProcess = await this.store.getProcess(resumedFrom);
                    if (oldProcess?.conversationTurns?.length) {
                        const historicalTurns: ConversationTurn[] = oldProcess.conversationTurns.map((t, i) => ({
                            ...t,
                            historical: true,
                            turnIndex: i,
                        }));
                        // Re-index the new turns after historical ones
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

            // Update process as completed — now includes session + conversation data
            try {
                const currentProc = await this.store.getProcess(processId);
                if (!TERMINAL_STATUSES.has(currentProc?.status ?? '')) {
                    await this.store.updateProcess(processId, {
                        status: 'completed',
                        endTime: new Date(),
                        result: typeof result === 'string' ? result : JSON.stringify(result),
                        sdkSessionId: sessionId,
                        conversationTurns: combinedTurns,
                    });
                    this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);
                }
            } catch {
                // Non-fatal
            }

            // Generate a human-readable title (fire-and-forget, non-blocking)
            this.generateTitleIfNeeded(processId, combinedTurns);

            return {
                success: true,
                result,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} failed in ${duration}ms: ${errorMsg}`);

            // Clean up throttle state
            this.throttleState.delete(processId);
            this.timelineBuffers.delete(processId);
            try {
                const currentProcess = await this.store.getProcess(processId);
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
            // Persist accumulated conversation output to disk (both success and failure)
            const buffer = this.outputBuffers.get(processId) ?? '';
            this.outputBuffers.delete(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer);
        }
    }

    cancel(taskId: string): void {
        this.cancelledTasks.add(taskId);
    }

    /**
     * Cancel a running process by aborting its live AI session.
     * Also marks the task as cancelled to prevent future execution.
     */
    async cancelProcess(processId: string): Promise<void> {
        const taskId = processId.replace('queue_', '');
        this.cancelledTasks.add(taskId);
        try {
            const proc = await this.store.getProcess(processId);
            if (proc?.sdkSessionId) {
                await this.aiService.abortSession(proc.sdkSessionId);
            }
        } catch {
            // Non-fatal: session may already be gone
        }
    }

    /**
     * Check whether the SDK session for a process is still alive.
     */
    async isSessionAlive(processId: string): Promise<boolean> {
        const process = await this.store.getProcess(processId);
        if (!process?.sdkSessionId) return false;
        const workingDirectory = process.workingDirectory || this.defaultWorkingDirectory;
        const onPermissionRequest = this.approvePermissions ? approveAllPermissions : undefined;
        try {
            if (typeof (this.aiService as any).canResumeSession === 'function') {
                return await (this.aiService as any).canResumeSession(process.sdkSessionId, {
                    workingDirectory,
                    onPermissionRequest,
                });
            }
            return this.aiService.hasKeptAliveSession(process.sdkSessionId);
        } catch {
            // Safe fallback: if we cannot verify liveness, treat as unavailable.
            return false;
        }
    }

    /**
     * Generate a human-readable title for a process from its first user message.
     * Fire-and-forget: failures are logged as warnings but never block execution.
     * Idempotent: skips if the process already has a title.
     */
    private generateTitleIfNeeded(processId: string, turns: ConversationTurn[]): void {
        const logger = getLogger();
        const rawContent = turns.find(t => t.role === 'user')?.content ?? '';
        const firstUserContent = rawContent.startsWith(READONLY_PROMPT_PREFIX)
            ? rawContent.slice(READONLY_PROMPT_PREFIX.length)
            : rawContent;
        if (!firstUserContent) return;

        // Use void to explicitly fire-and-forget
        void (async () => {
            try {
                const existing = await this.store.getProcess(processId);
                if (existing?.title) return;

                const truncated = firstUserContent.substring(0, 400);
                const title: string = await (this.aiService as any).transform(
                    `Summarise the following user message as a short title (max 8 words, no punctuation):\n\n"${truncated}"`,
                    (raw: string) => raw.trim().replace(/[".]/g, ''),
                    { model: 'gpt-4.1', cwd: this.defaultWorkingDirectory },
                );
                if (title) {
                    await this.store.updateProcess(processId, { title });
                }
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                logger.warn(LogCategory.AI, `Title generation failed for ${processId}: ${errMsg}`);
            }
        })();
    }

    /**
     * Execute a follow-up message on an existing process's SDK session.
     *
     * Flow:
     * 1. Look up process → get sdkSessionId
     * 2. Call sdkService.sendFollowUp(sdkSessionId, message, { onStreamingChunk })
     * 3. Stream chunks via store.emitProcessOutput()
     * 4. On completion, append assistant turn to conversationTurns
     * 5. Update process status back to 'completed'
     */
    async executeFollowUp(processId: string, message: string, attachments?: Attachment[]): Promise<void> {
        const logger = getLogger();
        const startTime = Date.now();

        logger.debug(LogCategory.AI, `[FollowUp] Starting follow-up for process ${processId}`);

        const process = await this.store.getProcess(processId);
        if (!process) {
            throw new Error(`Process not found: ${processId}`);
        }
        if (!process.sdkSessionId) {
            throw new Error(`Process ${processId} has no SDK session`);
        }
        const workingDirectory = process.workingDirectory || this.defaultWorkingDirectory;

        // Initialize output buffer for this follow-up
        this.outputBuffers.set(processId, '');
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        try {
            // Only attach follow-up suggestions tool on the first AI response (no prior assistant turns)
            const isFirstTurn = !(process.conversationTurns?.some(t => t.role === 'assistant'));
            const suggestTools = (this.followUpSuggestions.enabled && isFirstTurn) ? [createSuggestFollowUpsTool()] : [];
            const followUpMessage = (this.followUpSuggestions.enabled && isFirstTurn)
                ? `${message}\n\nWhen suggesting follow-ups, provide exactly ${this.followUpSuggestions.count} suggestions. Each suggestion must be a short imperative action phrase (not a question), for example: "Show me an example", "Explain the retry config", "Generate the fix".`
                : message;
            const result = await this.aiService.sendFollowUp(process.sdkSessionId, followUpMessage, {
                workingDirectory,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                attachments,
                tools: suggestTools.length > 0 ? suggestTools : undefined,
                onStreamingChunk: (chunk: string) => {
                    // Accumulate for persistence
                    const existing = this.outputBuffers.get(processId) ?? '';
                    this.outputBuffers.set(processId, existing + chunk);
                    // Append content timeline item
                    this.appendTimelineItem(processId, { type: 'content', timestamp: new Date(), content: chunk });
                    try {
                        this.store.emitProcessOutput(processId, chunk);
                    } catch {
                        // Non-fatal
                    }
                    // Check throttle conditions and flush if necessary
                    this.checkThrottleAndFlush(processId);
                },
                onToolEvent: (event: ToolEvent) => {
                    // Intercept suggestion tool completions — emit as dedicated SSE event
                    if (event.type === 'tool-complete' && event.toolName === 'suggest_follow_ups') {
                        try {
                            const parsed = JSON.parse(event.result || '{}');
                            const suggestions: string[] = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
                            if (suggestions.length > 0) {
                                const currentTurnIndex = (process.conversationTurns?.length ?? 0);
                                this.pendingSuggestions.set(processId, suggestions);
                                this.store.emitProcessEvent(processId, {
                                    type: 'suggestions',
                                    suggestions,
                                    turnIndex: currentTurnIndex,
                                });
                            }
                        } catch {
                            // Malformed suggestions — ignore silently
                        }
                        return;
                    }

                    // Append tool timeline item
                    const timelineType = event.type === 'tool-start' ? 'tool-start'
                        : event.type === 'tool-complete' ? 'tool-complete'
                            : 'tool-failed';
                    const now = new Date();
                    this.appendTimelineItem(processId, {
                        type: timelineType,
                        timestamp: now,
                        toolCall: {
                            id: event.toolCallId,
                            name: event.toolName || 'unknown',
                            status: event.type === 'tool-start' ? 'running'
                                : event.type === 'tool-complete' ? 'completed' : 'failed',
                            startTime: now,
                            ...(event.type !== 'tool-start' ? { endTime: now } : {}),
                            args: event.parameters || {},
                            result: event.result,
                            error: event.error,
                            ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
                        },
                    });
                    try {
                        this.store.emitProcessEvent(processId, {
                            type: event.type,
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                            ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
                            parameters: event.parameters,
                            result: event.result,
                            error: event.error,
                        });
                    } catch {
                        // Non-fatal
                    }
                    // Trigger throttled flush so tool-only sessions persist timeline
                    this.checkThrottleAndFlush(processId);
                },
            });

            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[FollowUp] Completed for ${processId} in ${duration}ms`);

            // Clean up throttle state
            this.throttleState.delete(processId);

            // Drain accumulated timeline items for the final assistant turn
            const followUpTimeline = mergeConsecutiveContentItems(this.timelineBuffers.get(processId) || []);
            this.timelineBuffers.delete(processId);

            if (!result.success) {
                throw new Error(result.error || 'Follow-up execution failed');
            }

            // Append or replace the assistant turn in conversationTurns
            const refreshed = await this.store.getProcess(processId);
            const turns = refreshed?.conversationTurns || [];

            // Remove any in-progress streaming assistant turn (will be replaced with final)
            const cleanTurns = turns.filter(t => !(t.role === 'assistant' && t.streaming));
            const assistantTurn: ConversationTurn = {
                role: 'assistant',
                content: result.response || '(No text response)',
                timestamp: new Date(),
                turnIndex: cleanTurns.length,
                toolCalls: result.toolCalls || undefined,
                timeline: followUpTimeline,
                suggestions: this.pendingSuggestions.get(processId),
            };
            this.pendingSuggestions.delete(processId);

            await this.store.updateProcess(processId, {
                conversationTurns: [...cleanTurns, assistantTurn],
                status: 'completed',
                endTime: new Date(),
                result: result.response || undefined,
            });
            this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);

            // Generate a human-readable title if not already set (fire-and-forget)
            this.generateTitleIfNeeded(processId, [...cleanTurns, assistantTurn]);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[FollowUp] Failed for ${processId} in ${duration}ms: ${errorMsg}`);

            // Clean up throttle state
            this.throttleState.delete(processId);
            this.timelineBuffers.delete(processId);
            const refreshed = await this.store.getProcess(processId);
            const turns = refreshed?.conversationTurns || [];
            // Remove any in-progress streaming assistant turn
            const cleanTurns = turns.filter(t => !(t.role === 'assistant' && t.streaming));
            const errorTurn: ConversationTurn = {
                role: 'assistant',
                content: `Error: ${errorMsg}`,
                timestamp: new Date(),
                turnIndex: cleanTurns.length,
                timeline: [],
            };

            await this.store.updateProcess(processId, {
                conversationTurns: [...cleanTurns, errorTurn],
                status: 'failed',
                endTime: new Date(),
                error: errorMsg,
            });
            this.store.emitProcessComplete(processId, 'failed', `${duration}ms`);
        } finally {
            // Persist accumulated output to disk
            const buffer = this.outputBuffers.get(processId) ?? '';
            this.outputBuffers.delete(processId);
            this.store.unregisterFlushHandler?.(processId);
            // Append to existing output file rather than overwriting
            await this.persistOutput(processId, buffer);
        }
    }

    // ========================================================================
    // Private — Prompt Extraction
    // ========================================================================

    private extractPrompt(task: QueuedTask): string {
        if (isTaskGenerationPayload(task.payload)) {
            return task.payload.prompt;
        }

        if (isRunWorkflowPayload(task.payload)) {
            return `Run workflow: ${path.basename(task.payload.workflowPath)}`;
        }

        if (isChatPayload(task.payload)) {
            const payload = task.payload as unknown as ChatPayload;
            const prompt = payload.prompt || task.displayName || 'Chat message';
            if (payload.readonly) {
                return READONLY_PROMPT_PREFIX + prompt;
            }
            return prompt;
        }

        if (isAIClarificationPayload(task.payload)) {
            return task.payload.prompt || task.displayName || 'AI clarification task';
        }

        if (isFollowPromptPayload(task.payload)) {
            // New-style payloads (planFilePath without additionalContext):
            // Use VS Code extension format: "Follow the instruction {promptFilePath}. {planFilePath}"
            const hasAdditionalContext = !!task.payload.additionalContext;
            const hasPlanFilePath = !!task.payload.planFilePath;
            const contextSuffix = this.findContextFileSuffix(task.payload.planFilePath);

            if (!hasAdditionalContext && hasPlanFilePath && !task.payload.promptContent) {
                // New-style: file-path-based prompt referencing both files
                try {
                    if (task.payload.promptFilePath && fs.existsSync(task.payload.promptFilePath)) {
                        const base = `Follow the instruction ${task.payload.promptFilePath}. ${task.payload.planFilePath}`;
                        return contextSuffix ? `${base}\n\n${contextSuffix}` : base;
                    }
                } catch {
                    // Fall through to legacy handling
                }
            }

            if (!hasAdditionalContext && hasPlanFilePath && task.payload.promptContent) {
                // Skill-type: promptContent + planFilePath reference (no inline content)
                const base = `${task.payload.promptContent} ${task.payload.planFilePath}`;
                return contextSuffix ? `${base}\n\n${contextSuffix}` : base;
            }

            // Legacy path: resolve context block from additionalContext + planFilePath content
            const contextBlock = this.resolveContextBlock(task.payload);

            // Prefer direct prompt content when available (no file I/O needed)
            let prompt: string;
            if (task.payload.promptContent) {
                prompt = task.payload.promptContent;
            } else {
                // Fall back to file-based prompt for backward compatibility / skill jobs
                try {
                    if (task.payload.promptFilePath && fs.existsSync(task.payload.promptFilePath)) {
                        prompt = `Follow the instruction ${task.payload.promptFilePath}.`;
                    } else {
                        prompt = `Follow prompt: ${task.payload.promptFilePath || 'unknown'}`;
                    }
                } catch {
                    prompt = `Follow prompt: ${task.payload.promptFilePath || 'unknown'}`;
                }
            }

            // Prepend context block if available
            if (contextBlock) {
                prompt = `Context document:\n\n${contextBlock}\n\n---\n\n${prompt}`;
            }

            // Append CONTEXT.md reference if available
            if (contextSuffix) {
                prompt = `${prompt}\n\n${contextSuffix}`;
            }

            return prompt;
        }

        if (isCustomTaskPayload(task.payload)) {
            const data = task.payload.data;
            if (typeof data.prompt === 'string' && data.prompt.trim()) {
                let prompt = data.prompt;
                if (typeof data.planFilePath === 'string' && data.planFilePath.trim()) {
                    prompt = `${prompt}\n\nFile: ${data.planFilePath}`;
                }
                return prompt;
            }
        }

        return task.displayName || `Queue task: ${task.type}`;
    }

    /**
     * If the task payload includes skill directives (skillNames array or legacy
     * skillName string), emit short skill reference directives.
     * The AI agent already has access to skills via the skill tool.
     */
    private applySkillContent(prompt: string, task: QueuedTask): string {
        const payload = task.payload as { skillName?: string; skillNames?: string[] };
        const names = payload.skillNames?.length
            ? payload.skillNames
            : payload.skillName
                ? [payload.skillName]
                : [];
        if (names.length === 0) return prompt;

        const directives = names.map(n => `Use ${n} skill when available`).join('\n');
        return `${directives}\n\n[Task]\n${prompt}`;
    }

    // ========================================================================
    // Private — Execution by Type
    // ========================================================================

    private async executeByType(task: QueuedTask, prompt: string): Promise<unknown> {
        // Task generation: build the appropriate prompt and delegate to AI
        if (isTaskGenerationPayload(task.payload)) {
            return this.executeTaskGeneration(task);
        }

        // Run workflow: parse YAML and execute via pipeline-core
        if (isRunWorkflowPayload(task.payload)) {
            return this.executeRunPipeline(task);
        }

        // For types that need AI execution (exclude follow-ups — they short-circuit in execute())
        if (
            isAIClarificationPayload(task.payload) ||
            (isChatPayload(task.payload) && !isChatFollowUp(task.payload)) ||
            isCustomTaskPayload(task.payload) ||
            isFollowPromptPayload(task.payload)
        ) {
            const isChatTask = task.type === 'chat';
            const tools = (isChatTask && this.followUpSuggestions.enabled) ? [createSuggestFollowUpsTool()] : undefined;
            const countSuffix = (isChatTask && this.followUpSuggestions.enabled)
                ? `\n\nWhen suggesting follow-ups, provide exactly ${this.followUpSuggestions.count} suggestions. Each suggestion must be a short imperative action phrase (not a question), for example: "Show me an example", "Explain the retry config", "Generate the fix".`
                : '';
            return this.executeWithAI(task, prompt + countSuffix, tools ? { tools } : undefined);
        }

        // Resolve comments: build prompt from payload and execute with AI
        if (isResolveCommentsPayload(task.payload)) {
            return this.executeResolveComments(task);
        }

        // Run script: spawn a child process and capture stdout/stderr
        if (isRunScriptPayload(task.payload)) {
            return this.executeRunScript(task);
        }

        // Replicate template: run commit replication via pipeline-core
        if (isReplicateTemplatePayload(task.payload)) {
            return this.executeReplicateTemplate(task);
        }

        // For code-review: placeholder (no-op)
        return { status: 'completed', message: `Task type '${task.type}' executed (no-op in CLI mode)` };
    }

    private async executeRunScript(task: QueuedTask): Promise<unknown> {
        const payload = task.payload as unknown as RunScriptPayload;
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const child = spawn(payload.script, [], {
                shell: true,
                cwd: payload.workingDirectory,
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
                resolve({
                    success: !timedOut && exitCode === 0,
                    result: { stdout, stderr, exitCode: timedOut ? null : exitCode },
                    durationMs,
                    timedOut,
                });
            });
        });
    }

    private async executeReplicateTemplate(task: QueuedTask): Promise<unknown> {
        const payload = task.payload as unknown as ReplicateTemplatePayload;
        const processId = `queue_${task.id}`;

        // 1. Resolve workspace root
        const workingDirectory = payload.workingDirectory
            ?? this.getWorkingDirectory(task);
        if (!workingDirectory) {
            throw new Error('Cannot resolve repository root for replicate-template task');
        }

        // 2. Update process with enriched prompt preview
        const preview = `Replicate commit ${payload.commitHash.slice(0, 8)} → "${payload.instruction}"`;
        this.store.updateProcess(processId, {
            fullPrompt: payload.instruction,
            promptPreview: preview,
        });

        // 3. Create AI invoker (same pattern as executeRunPipeline)
        const aiInvoker = createCLIAIInvoker({
            model: payload.model ?? (task.config as any)?.model,
            approvePermissions: this.approvePermissions,
            workingDirectory,
        });

        // 4. Build progress callback → SSE events
        const onProgress: ReplicateProgressCallback = (stage, detail) => {
            try {
                this.store.emitProcessEvent(processId, {
                    type: 'pipeline-progress',
                    pipelineProgress: {
                        phase: 'job',
                        totalItems: 1,
                        completedItems: 0,
                        failedItems: 0,
                        percentage: 0,
                        message: detail ? `[${stage}] ${detail}` : stage,
                    },
                });
            } catch {
                // Non-fatal: store may be a stub
            }
        };

        // 5. Emit phase-start event
        try {
            this.store.emitProcessEvent(processId, {
                type: 'pipeline-phase',
                pipelinePhase: { phase: 'job', status: 'started', timestamp: new Date().toISOString() },
            });
        } catch {
            // Non-fatal
        }

        // 6. Execute replication
        let result: ReplicateResult;
        try {
            result = await replicateCommit(
                {
                    template: {
                        name: payload.templateName,
                        kind: 'commit',
                        commitHash: payload.commitHash,
                        hints: payload.hints,
                    },
                    repoRoot: workingDirectory,
                    instruction: payload.instruction,
                },
                aiInvoker,
                onProgress,
            );
        } catch (err) {
            // Emit failure phase event before re-throwing
            try {
                this.store.emitProcessEvent(processId, {
                    type: 'pipeline-phase',
                    pipelinePhase: { phase: 'job', status: 'failed', timestamp: new Date().toISOString() },
                });
            } catch {
                // Non-fatal
            }
            throw err;
        }

        // 7. Emit phase-complete event
        try {
            this.store.emitProcessEvent(processId, {
                type: 'pipeline-phase',
                pipelinePhase: { phase: 'job', status: 'completed', timestamp: new Date().toISOString() },
            });
        } catch {
            // Non-fatal
        }

        // 8. Return structured result for the apply endpoint
        return {
            response: result.summary,
            replicateResult: {
                summary: result.summary,
                files: result.files,
                commitHash: payload.commitHash,
                templateName: payload.templateName,
            },
        };
    }

    private async executeWithAI(task: QueuedTask, prompt: string, options?: { tools?: Tool<any>[] }): Promise<unknown> {
        const processId = `queue_${task.id}`;

        // Initialize output accumulator for this process
        this.outputBuffers.set(processId, '');
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        // Rehydrate externalized images from blob store if needed
        const payload = task.payload as any;
        if (payload?.imagesFilePath && (!Array.isArray(payload.images) || payload.images.length === 0)) {
            payload.images = await ImageBlobStore.loadImages(payload.imagesFilePath);
        }

        // Decode optional base64 images from payload
        let attachments: Attachment[] | undefined;
        let imageTempDir: string | undefined;
        const payloadImages = (task.payload as any)?.images;
        if (Array.isArray(payloadImages) && payloadImages.length > 0) {
            const validImages = payloadImages.filter((img: unknown) => typeof img === 'string').slice(0, 10);
            if (validImages.length > 0) {
                const result = saveImagesToTempFiles(validImages);
                imageTempDir = result.tempDir;
                attachments = result.attachments.length > 0 ? result.attachments : undefined;
            }
        }

        try {
            const availability = await this.aiService.isAvailable();
            if (!availability.available) {
                throw new Error(`Copilot SDK not available: ${availability.error || 'unknown reason'}`);
            }

            const workingDirectory = this.getWorkingDirectory(task);
            const timeoutMs = task.config.timeoutMs || this.defaultTimeoutMs;

            // Capture read-only tool calls for the memory cache.
            // Create capture handler defensively — errors must not break task execution.
            let captureHandler: ((event: ToolEvent) => void) | undefined;
            try {
                const capture = new ToolCallCapture(this.toolCallCacheStore, TASK_FILTER);
                captureHandler = capture.createToolEventHandler();
            } catch (err) {
                getLogger().warn(LogCategory.AI, `[QueueExecutor] ToolCallCapture setup failed: ${err}`);
            }

            const existingToolEventHandler = (event: ToolEvent) => {
                    // Intercept suggestion tool completions — emit as dedicated SSE event
                    if (event.type === 'tool-complete' && event.toolName === 'suggest_follow_ups') {
                        try {
                            const parsed = JSON.parse(event.result || '{}');
                            const suggestions: string[] = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
                            if (suggestions.length > 0) {
                                this.pendingSuggestions.set(processId, suggestions);
                                this.store.emitProcessEvent(processId, {
                                    type: 'suggestions',
                                    suggestions,
                                    turnIndex: 1,
                                });
                            }
                        } catch {
                            // Malformed suggestions — ignore silently
                        }
                        return;
                    }

                    // Append tool timeline item
                    const timelineType = event.type === 'tool-start' ? 'tool-start'
                        : event.type === 'tool-complete' ? 'tool-complete'
                            : 'tool-failed';
                    const now = new Date();
                    this.appendTimelineItem(processId, {
                        type: timelineType,
                        timestamp: now,
                        toolCall: {
                            id: event.toolCallId,
                            name: event.toolName || 'unknown',
                            status: event.type === 'tool-start' ? 'running'
                                : event.type === 'tool-complete' ? 'completed' : 'failed',
                            startTime: now,
                            ...(event.type !== 'tool-start' ? { endTime: now } : {}),
                            args: event.parameters || {},
                            result: event.result,
                            error: event.error,
                            ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
                        },
                    });
                    try {
                        this.store.emitProcessEvent(processId, {
                            type: event.type,
                            toolCallId: event.toolCallId,
                            toolName: event.toolName,
                            ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
                            parameters: event.parameters,
                            result: event.result,
                            error: event.error,
                        });
                    } catch {
                        // Non-fatal: store may be a stub
                    }
                    // Trigger throttled flush so tool-only sessions persist timeline
                    this.checkThrottleAndFlush(processId);
            };

            const result = await this.aiService.sendMessage({
                prompt,
                model: task.config.model,
                workingDirectory,
                timeoutMs,
                keepAlive: true,
                attachments,
                tools: options?.tools,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                onSessionCreated: (sessionId: string) => {
                    this.store.updateProcess(processId, { sdkSessionId: sessionId }).catch(() => {
                        // Non-fatal: store may be a stub
                    });
                },
                // Stream response chunks to the process store for real-time UI updates
                onStreamingChunk: (chunk: string) => {
                    // Accumulate output for disk persistence
                    const existing = this.outputBuffers.get(processId) ?? '';
                    this.outputBuffers.set(processId, existing + chunk);
                    // Append content timeline item
                    this.appendTimelineItem(processId, { type: 'content', timestamp: new Date(), content: chunk });
                    try {
                        this.store.emitProcessOutput(processId, chunk);
                    } catch {
                        // Non-fatal: store may be a stub
                    }
                    // Check throttle conditions and flush if necessary
                    this.checkThrottleAndFlush(processId);
                },
                // Emit tool lifecycle events for real-time tool card rendering in the SPA
                onToolEvent: captureHandler
                    ? (event: ToolEvent) => {
                        try { existingToolEventHandler(event); } catch { /* non-fatal */ }
                        try { captureHandler!(event); } catch { /* non-fatal */ }
                    }
                    : existingToolEventHandler,
            });
            // TODO(004): trigger ToolCallCacheAggregator.aggregateIfNeeded() after sendMessage

            if (!result.success) {
                throw new Error(result.error || 'AI execution failed');
            }

            return {
                response: result.response || '(Task completed via tool execution — no text response produced)',
                sessionId: result.sessionId,
                toolCalls: result.toolCalls,
            };
        } finally {
            if (imageTempDir) { cleanupTempDir(imageTempDir); }
        }
    }

    private async executeTaskGeneration(task: QueuedTask): Promise<unknown> {
        const payload = task.payload as unknown as TaskGenerationPayload;

        const tasksBase = path.resolve(payload.workingDirectory, '.vscode/tasks');
        const isAutoFolder = payload.targetFolder === AUTO_FOLDER_SENTINEL;
        const resolvedTarget = (isAutoFolder || !payload.targetFolder)
            ? tasksBase
            : path.resolve(tasksBase, payload.targetFolder);
        fs.mkdirSync(resolvedTarget, { recursive: true });

        // Build autoFolderContext when auto-folder mode is requested
        let autoFolderContext: AutoFolderContext | undefined;
        if (isAutoFolder) {
            const entries = await fs.promises.readdir(tasksBase, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
            const subfolders = entries.filter(e => e.isDirectory()).map(e => e.name);
            const deepFolders: string[] = [];
            for (const sub of subfolders) {
                const nested = await fs.promises.readdir(path.join(tasksBase, sub), { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
                for (const n of nested) {
                    if (n.isDirectory()) deepFolders.push(`${sub}/${n.name}`);
                }
            }
            autoFolderContext = { tasksRoot: tasksBase, existingFolders: [...subfolders, ...deepFolders] };
        }

        let aiPrompt: string;
        if (payload.mode === 'from-feature') {
            const context = await gatherFeatureContext(resolvedTarget, payload.workingDirectory);
            const selectedContext: SelectedContext = {
                description: context.description,
                planContent: context.planContent,
                specContent: context.specContent,
                relatedFiles: context.relatedFiles,
            };
            aiPrompt = payload.depth === 'deep'
                ? buildDeepModePrompt(selectedContext, payload.prompt, payload.name, resolvedTarget, payload.workingDirectory)
                : buildCreateFromFeaturePrompt(selectedContext, payload.prompt, payload.name, resolvedTarget);
        } else if (payload.name?.trim()) {
            aiPrompt = buildCreateTaskPromptWithName(payload.name, payload.prompt, resolvedTarget, autoFolderContext);
        } else if (isAutoFolder) {
            aiPrompt = buildCreateTaskPromptWithName(undefined, payload.prompt, resolvedTarget, autoFolderContext);
        } else {
            aiPrompt = buildCreateTaskPrompt(payload.prompt, resolvedTarget);
        }

        // Apply go-deep prefix when depth is 'deep', regardless of mode
        if (payload.depth === 'deep') {
            aiPrompt = applyDeepModePrefix(aiPrompt);
        }

        // Update process store with the actual enriched prompt (replaces raw user text)
        const processId = `queue_${task.id}`;
        const enrichedPreview = aiPrompt.length > 80 ? aiPrompt.substring(0, 77) + '...' : aiPrompt;
        try {
            await this.store.updateProcess(processId, {
                fullPrompt: aiPrompt,
                promptPreview: enrichedPreview,
            });
            const existing = await this.store.getProcess(processId);
            if (existing?.conversationTurns?.[0]) {
                existing.conversationTurns[0].content = aiPrompt;
                await this.store.updateProcess(processId, {
                    conversationTurns: existing.conversationTurns,
                });
            }
        } catch {
            // Non-fatal: store may be a stub
        }

        return this.executeWithAI(task, aiPrompt);
    }

    private async executeRunPipeline(task: QueuedTask): Promise<unknown> {
        const payload = task.payload as unknown as RunWorkflowPayload;
        const yamlPath = path.join(payload.workflowPath, 'pipeline.yaml');

        // Read and parse pipeline YAML
        const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
        const config = compileToWorkflow(yamlContent);

        // Create AIInvoker using the same factory as `coc run`
        const aiInvoker = createCLIAIInvoker({
            model: payload.model,
            approvePermissions: this.approvePermissions,
            workingDirectory: payload.workingDirectory,
            mcpServers: payload.mcpServers,          // forward per-workspace MCP filter
        });

        // Execute
        const processId = `queue_${task.id}`;
        const childProcessIds: string[] = [];
        const result = await executeWorkflow(config, {
            aiInvoker,
            workflowDirectory: payload.workflowPath,
            workspaceRoot: payload.workingDirectory,
            model: payload.model,
            parameters: payload.params,
            onProgress: (event) => {
                // Map WorkflowNodePhase to PipelinePhaseStatus for backward compat with SPA
                const statusMap: Record<string, PipelinePhaseStatus> = {
                    pending: 'started', running: 'started', completed: 'completed', failed: 'failed', warned: 'completed',
                };
                // Emit pipeline-phase SSE event for backward compat with SPA
                try {
                    this.store.emitProcessEvent(processId, {
                        type: 'pipeline-phase',
                        pipelinePhase: {
                            phase: event.nodeId as PipelinePhase,
                            status: statusMap[event.phase] ?? 'started',
                            timestamp: event.timestamp,
                            durationMs: event.durationMs,
                            error: event.error,
                            itemCount: event.inputItemCount,
                        },
                    });
                } catch {
                    // Non-fatal: store may be a stub
                }
                // Emit pipeline-progress SSE event when item progress is available
                if (event.itemProgress) {
                    try {
                        const total = event.itemProgress.total;
                        const completed = event.itemProgress.completed;
                        this.store.emitProcessEvent(processId, {
                            type: 'pipeline-progress',
                            pipelineProgress: {
                                phase: event.nodeId as PipelinePhase,
                                totalItems: total,
                                completedItems: completed,
                                failedItems: event.itemProgress.failed,
                                percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
                                message: `Node ${event.nodeId}: ${completed}/${total}`,
                            },
                        });
                    } catch {
                        // Non-fatal
                    }
                }
            },
            onItemProcess: (event) => {
                childProcessIds.push(event.processId);
                const label = event.itemLabel ?? `Item ${event.itemIndex}`;
                const childProcess: AIProcess = {
                    id: event.processId,
                    type: 'pipeline-item',
                    parentProcessId: processId,
                    promptPreview: label.length > 80 ? label.substring(0, 77) + '...' : label,
                    fullPrompt: label,
                    status: event.status === 'completed' ? 'completed' : (event.status === 'failed' ? 'failed' : 'running'),
                    startTime: new Date(),
                    metadata: {
                        type: 'pipeline-item',
                        itemIndex: event.itemIndex,
                        nodeId: event.nodeId,
                        parentPipelineId: processId,
                    },
                };
                if (event.error) {
                    childProcess.error = event.error;
                }
                this.store.addProcess(childProcess).catch(() => {
                    // Non-fatal: don't fail the pipeline if store write fails
                });
                try {
                    this.store.emitProcessEvent(processId, {
                        type: 'pipeline-progress',
                        pipelineProgress: {
                            phase: 'map',
                            totalItems: 0,
                            completedItems: 0,
                            failedItems: 0,
                            percentage: 0,
                            message: `Item process created: ${event.processId}`,
                        },
                    });
                } catch {
                    // Non-fatal
                }
            },
        });

        const flatResult = flattenWorkflowResult(result, config);

        // Update parent process with child process IDs
        if (childProcessIds.length) {
            this.store.updateProcess(processId, {
                groupMetadata: {
                    type: 'pipeline-execution',
                    childProcessIds,
                },
            }).catch(() => {
                // Non-fatal
            });
        }

        // Persist execution stats and pipeline config into metadata so WorkflowDetailView can render the DAG
        this.store.getProcess(processId).then(current => {
            return this.store.updateProcess(processId, {
                metadata: {
                    type: current?.metadata?.type ?? `queue-${task.type}`,
                    ...(current?.metadata ?? {}),
                    executionStats: flatResult.stats,
                    pipelineConfig: config,
                },
            });
        }).catch(() => {
            // Non-fatal
        });

        return {
            response: flatResult.formattedOutput ?? JSON.stringify(flatResult.stats),
            pipelineName: config.name,
            stats: flatResult.stats,
        };
    }

    private async executeResolveComments(task: QueuedTask): Promise<unknown> {
        const payload = task.payload as unknown as ResolveCommentsPayload;
        const aiPrompt = payload.promptTemplate;

        // Update process store with the enriched prompt
        const processId = `queue_${task.id}`;
        const commentCount = Array.isArray(payload.commentIds) ? payload.commentIds.length : 0;
        const targetFile = payload.filePath || payload.documentUri || 'document';
        const preview = `Resolve ${commentCount} comment(s) in ${targetFile}`;
        try {
            await this.store.updateProcess(processId, {
                fullPrompt: aiPrompt,
                promptPreview: preview,
            });
        } catch {
            // Non-fatal: store may be a stub
        }

        const { createResolveCommentTool } = await import('./resolve-comment-tool');
        const { tool, getResolvedIds } = createResolveCommentTool();

        const aiResult = await this.executeWithAI(task, aiPrompt, { tools: [tool] }) as { response: string } | undefined;
        const revisedContent = (aiResult as any)?.response as string | undefined;

        // Only return comment IDs that AI explicitly resolved via the tool.
        // Fall back to all IDs if the tool wasn't called (backward compat).
        const resolvedIds = getResolvedIds();
        const commentIds = resolvedIds.length > 0 ? resolvedIds : payload.commentIds;

        // Server-side resolution: persist comment status and broadcast WS events
        if (this.dataDir && payload.wsId && commentIds.length > 0) {
            try {
                const { TaskCommentsManager } = await import('./task-comments-handler');
                const mgr = new TaskCommentsManager(this.dataDir);
                const wsServer = this.getWsServer?.();
                await Promise.all(
                    commentIds.map(async (id) => {
                        try {
                            await mgr.updateComment(payload.wsId!, payload.filePath, id, { status: 'resolved' });
                            if (wsServer) {
                                wsServer.broadcastFileEvent(payload.filePath, {
                                    type: 'comment-resolved',
                                    filePath: payload.filePath,
                                    commentId: id,
                                });
                            }
                        } catch {
                            // Non-fatal: best-effort resolution
                        }
                    })
                );
            } catch {
                // Non-fatal: server-side resolution is best-effort
            }
        }

        return {
            revisedContent,
            commentIds,
        };
    }

    private getWorkingDirectory(task: QueuedTask): string | undefined {
        if (isTaskGenerationPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isRunWorkflowPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isFollowPromptPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isChatPayload(task.payload)) {
            return task.payload.workingDirectory || task.payload.folderPath || this.defaultWorkingDirectory;
        }
        if (isAIClarificationPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isResolveCommentsPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isReplicateTemplatePayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        return this.defaultWorkingDirectory;
    }

    /**
     * Build a structured context block from additionalContext and planFilePath.
     * Returns the block string, or undefined if no context is available.
     */
    private resolveContextBlock(payload: {
        additionalContext?: string;
        planFilePath?: string;
    }): string | undefined {
        const parts: string[] = [];

        if (payload.planFilePath) {
            try {
                if (fs.existsSync(payload.planFilePath)) {
                    const planContent = fs.readFileSync(payload.planFilePath, 'utf-8');
                    if (planContent.trim()) {
                        parts.push(planContent);
                    }
                }
            } catch {
                // Non-fatal: skip plan file
            }
        }

        if (payload.additionalContext) {
            parts.push(payload.additionalContext);
        }

        if (parts.length === 0) {
            return undefined;
        }

        return parts.join('\n\n');
    }

    /**
     * Look for a CONTEXT.md file in the same directory as the plan file.
     * Returns a prompt suffix like "See context details in /abs/path/CONTEXT.md",
     * or undefined if no context file exists.
     */
    private findContextFileSuffix(planFilePath?: string): string | undefined {
        if (!planFilePath) return undefined;
        try {
            const dir = path.dirname(planFilePath);
            const contextPath = path.join(dir, 'CONTEXT.md');
            if (fs.existsSync(contextPath)) {
                // Use forward slashes in prompt for cross-platform consistency (Unix-style paths in context references)
                const normalizedPath = toNativePath(contextPath);
                return `See context details in ${normalizedPath}`;
            }
        } catch {
            // Non-fatal
        }
        return undefined;
    }

    /**
     * Append a timeline item to the in-memory buffer for a process.
     */
    private appendTimelineItem(processId: string, item: TimelineItem): void {
        if (!this.timelineBuffers.has(processId)) {
            this.timelineBuffers.set(processId, []);
        }
        const buffer = this.timelineBuffers.get(processId)!;
        const last = buffer.length > 0 ? buffer[buffer.length - 1] : undefined;
        // Merge consecutive content items to avoid word-per-line rendering
        if (last && last.type === 'content' && item.type === 'content') {
            last.content = (last.content ?? '') + (item.content ?? '');
        } else {
            buffer.push(item);
        }
    }

    /**
     * Check throttle conditions and flush conversation turn if necessary.
     * Called on every streaming chunk. Flushes when either:
     * - Time since last flush >= THROTTLE_TIME_MS (5 seconds)
     * - Chunks since last flush >= THROTTLE_CHUNK_COUNT (50 chunks)
     */
    private checkThrottleAndFlush(processId: string): void {
        if (!this.throttleState.has(processId)) {
            this.throttleState.set(processId, { chunksSinceLastFlush: 0, lastFlushTime: 0 });
        }
        const state = this.throttleState.get(processId)!;
        state.chunksSinceLastFlush++;

        const timeSinceFlush = Date.now() - state.lastFlushTime;
        if (state.chunksSinceLastFlush >= CLITaskExecutor.THROTTLE_CHUNK_COUNT ||
            timeSinceFlush >= CLITaskExecutor.THROTTLE_TIME_MS) {
            // Reset counters synchronously to prevent duplicate flushes
            state.chunksSinceLastFlush = 0;
            state.lastFlushTime = Date.now();
            this.flushConversationTurn(processId, true).catch(() => {
                // Non-fatal: don't fail the task because of flush
            });
        }
    }

    /**
     * Flush current streaming content to the store as a conversation turn.
     * When `streaming` is true, marks the turn as in-progress so the UI
     * can show a streaming indicator. On completion, call with `streaming: false`.
     */
    private async flushConversationTurn(processId: string, streaming: boolean): Promise<void> {
        const buffer = this.outputBuffers.get(processId);
        const hasTimeline = (this.timelineBuffers.get(processId)?.length ?? 0) > 0;
        if (buffer == null && !hasTimeline) return;

        // Snapshot current timeline for this flush, merging consecutive content items to reduce bloat
        const timelineSnapshot = mergeConsecutiveContentItems([...(this.timelineBuffers.get(processId) || [])]);

        try {
            const currentProcess = await this.store.getProcess(processId);
            if (!currentProcess) return;

            const existingTurns = currentProcess.conversationTurns || [];
            const lastTurn = existingTurns.length > 0 ? existingTurns[existingTurns.length - 1] : null;

            let updatedTurns: ConversationTurn[];
            if (lastTurn && lastTurn.role === 'assistant' && lastTurn.streaming) {
                // Update existing streaming assistant turn
                updatedTurns = existingTurns.map((turn, i) =>
                    i === existingTurns.length - 1
                        ? { ...turn, content: buffer ?? '', streaming: streaming || undefined, timeline: timelineSnapshot }
                        : turn
                );
            } else {
                // Append new assistant turn
                updatedTurns = [
                    ...existingTurns,
                    {
                        role: 'assistant' as const,
                        content: buffer ?? '',
                        timestamp: new Date(),
                        turnIndex: existingTurns.length,
                        streaming: streaming || undefined,
                        timeline: timelineSnapshot,
                    },
                ];
            }

            await this.store.updateProcess(processId, {
                conversationTurns: updatedTurns,
            });
        } catch {
            // Non-fatal: don't fail the task because of flush
        }
    }

    /**
     * Persist accumulated conversation output to disk.
     * Non-fatal: errors are silently ignored.
     */
    private async persistOutput(processId: string, content: string): Promise<void> {
        if (!content || !this.dataDir) { return; }
        try {
            const outputPath = await OutputFileManager.saveOutput(processId, content, this.dataDir);
            if (outputPath) {
                await this.store.updateProcess(processId, { rawStdoutFilePath: outputPath });
            }
        } catch {
            // Non-fatal: don't fail the task because of output persistence
        }
    }
}

// ============================================================================
// Default Task Classification Policy
// ============================================================================

/** Task types that are safe to run concurrently (typically stateless or operating on independent inputs). */
const SHARED_TASK_TYPES: ReadonlySet<string> = new Set([
    'task-generation',
    'ai-clarification',
    'code-review',
    'resolve-comments',
    'update-document',
    'replicate-template',
]);

/**
 * Default policy: tasks whose type is in SHARED_TASK_TYPES run as shared
 * (concurrent); everything else is exclusive (serialised).
 */
export function defaultIsExclusive(task: QueuedTask): boolean {
    if (task.type === 'chat') {
        return !(task.payload as any)?.readonly;
    }
    return !SHARED_TASK_TYPES.has(task.type);
}

// ============================================================================
// Bridge Factory
// ============================================================================

/**
 * Create a QueueExecutor wired to a CLITaskExecutor and ProcessStore.
 *
 * Returns the executor and bridge so the caller can listen to events,
 * control lifecycle, and delegate follow-up execution to the API layer.
 */
export function createQueueExecutorBridge(
    queueManager: TaskQueueManager,
    store: ProcessStore,
    options: QueueExecutorBridgeOptions = {}
): { executor: QueueExecutor; bridge: QueueExecutorBridge } {
    const taskExecutor = new CLITaskExecutor(store, {
        approvePermissions: options.approvePermissions !== false,
        workingDirectory: options.workingDirectory,
        dataDir: options.dataDir,
        aiService: options.aiService,
        defaultTimeoutMs: options.defaultTimeoutMs,
        followUpSuggestions: options.followUpSuggestions,
        getWsServer: options.getWsServer,
    });

    // Inject queue manager so follow-ups can re-activate parent tasks
    taskExecutor.setQueueManager(queueManager);

    const executor = createQueueExecutor(queueManager, taskExecutor, {
        sharedConcurrency: options.sharedConcurrency ?? 5,
        exclusiveConcurrency: options.exclusiveConcurrency ?? 1,
        isExclusive: options.isExclusive ?? defaultIsExclusive,
        autoStart: options.autoStart !== false,
    });

    return { executor, bridge: taskExecutor };
}
