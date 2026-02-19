/**
 * Queue Executor Bridge
 *
 * Wires up a QueueExecutor with a CLITaskExecutor to actually execute
 * queued tasks in the coc serve server. Bridges executor events
 * to the ProcessStore and WebSocket for real-time UI updates.
 *
 * Task types supported:
 * - ai-clarification: Sends prompt to CopilotSDKService
 * - custom: Sends payload.data.prompt to CopilotSDKService
 * - follow-prompt: Reads prompt file and sends to CopilotSDKService
 * - code-review / resolve-comments: Marked as completed (no-op placeholder)
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import { OutputFileManager } from './output-file-manager';
import {
    QueueExecutor,
    createQueueExecutor,
    TaskQueueManager,
    QueuedTask,
    TaskExecutor,
    TaskExecutionResult,
    isFollowPromptPayload,
    isAIClarificationPayload,
    isCustomTaskPayload,
    getCopilotSDKService,
    approveAllPermissions,
    DEFAULT_AI_TIMEOUT_MS,
    getLogger,
    LogCategory,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, AIProcess, ConversationTurn, ToolEvent, TimelineItem, CopilotSDKService } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

export interface QueueExecutorBridgeOptions {
    /** Maximum concurrent task executions (default: 1) */
    maxConcurrency?: number;
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
}

/**
 * Exposes follow-up execution for the API layer.
 * Implemented by CLITaskExecutor, surfaced via the bridge factory.
 */
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string): Promise<void>;
    /** Check whether the underlying SDK session for a process is still alive. */
    isSessionAlive(processId: string): Promise<boolean>;
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
    /** Per-process output accumulator for persisting conversation output */
    private readonly outputBuffers: Map<string, string> = new Map();
    /** Per-process timeline accumulator for chronological execution events */
    private readonly timelineBuffers: Map<string, TimelineItem[]> = new Map();
    /** Per-process throttle state for streaming conversation flushes */
    private readonly throttleState: Map<string, {
        chunksSinceLastFlush: number;
        lastFlushTime: number;
    }> = new Map();
    /** Time-based throttle: flush every N milliseconds */
    private static readonly THROTTLE_TIME_MS = 5000;
    /** Count-based throttle: flush every N chunks */
    private static readonly THROTTLE_CHUNK_COUNT = 50;

    constructor(store: ProcessStore, options: { approvePermissions?: boolean; workingDirectory?: string; dataDir?: string; aiService?: CopilotSDKService } = {}) {
        this.store = store;
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.dataDir = options.dataDir;
        this.aiService = options.aiService ?? getCopilotSDKService();
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();

        logger.debug(LogCategory.AI, `[QueueExecutor] Starting task ${task.id} (type: ${task.type}, name: ${task.displayName || 'unnamed'})`);

        // Check if cancelled before starting
        if (this.cancelledTasks.has(task.id)) {
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} was cancelled before starting`);
            return { success: false, error: new Error('Task cancelled'), durationMs: 0 };
        }

        // Create a process in the store for tracking
        // Format: <type>_<uuid> e.g. queue_1771242852770-g94u3ig
        const processId = `queue_${task.id}`;
        const prompt = this.extractPrompt(task);
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
            },
        };

        // Store initial user turn immediately so it survives page refresh
        const initialTurns: ConversationTurn[] = [
            {
                role: 'user',
                content: prompt,
                timestamp: process.startTime,
                turnIndex: 0,
                timeline: [],
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
            const finalTimeline = this.timelineBuffers.get(processId) || [];
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
                },
            ];

            // Update process as completed — now includes session + conversation data
            try {
                await this.store.updateProcess(processId, {
                    status: 'completed',
                    endTime: new Date(),
                    result: typeof result === 'string' ? result : JSON.stringify(result),
                    sdkSessionId: sessionId,
                    conversationTurns: finalTurns,
                });
                this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);
            } catch {
                // Non-fatal
            }

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
                await this.store.updateProcess(processId, {
                    status: 'failed',
                    endTime: new Date(),
                    error: errorMsg,
                    conversationTurns: existingTurns,
                });
                this.store.emitProcessComplete(processId, 'failed', `${duration}ms`);
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
            await this.persistOutput(processId, buffer);
        }
    }

    cancel(taskId: string): void {
        this.cancelledTasks.add(taskId);
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
     * Execute a follow-up message on an existing process's SDK session.
     *
     * Flow:
     * 1. Look up process → get sdkSessionId
     * 2. Call sdkService.sendFollowUp(sdkSessionId, message, { onStreamingChunk })
     * 3. Stream chunks via store.emitProcessOutput()
     * 4. On completion, append assistant turn to conversationTurns
     * 5. Update process status back to 'completed'
     */
    async executeFollowUp(processId: string, message: string): Promise<void> {
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

        try {
            const result = await this.aiService.sendFollowUp(process.sdkSessionId, message, {
                workingDirectory,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
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
                    // Append tool timeline item
                    const timelineType = event.type === 'tool-start' ? 'tool-start'
                        : event.type === 'tool-complete' ? 'tool-complete'
                        : 'tool-failed';
                    this.appendTimelineItem(processId, {
                        type: timelineType,
                        timestamp: new Date(),
                        toolCall: {
                            id: event.toolCallId,
                            name: event.toolName || 'unknown',
                            status: event.type === 'tool-start' ? 'running'
                                : event.type === 'tool-complete' ? 'completed' : 'failed',
                            startTime: new Date(),
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
                },
            });

            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[FollowUp] Completed for ${processId} in ${duration}ms`);

            // Clean up throttle state
            this.throttleState.delete(processId);

            // Drain accumulated timeline items for the final assistant turn
            const followUpTimeline = this.timelineBuffers.get(processId) || [];
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
            };

            await this.store.updateProcess(processId, {
                conversationTurns: [...cleanTurns, assistantTurn],
                status: 'completed',
                endTime: new Date(),
                result: result.response || undefined,
            });
            this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);

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
            // Append to existing output file rather than overwriting
            await this.persistOutput(processId, buffer);
        }
    }

    // ========================================================================
    // Private — Prompt Extraction
    // ========================================================================

    private extractPrompt(task: QueuedTask): string {
        if (isAIClarificationPayload(task.payload)) {
            return task.payload.prompt || task.displayName || 'AI clarification task';
        }

        if (isFollowPromptPayload(task.payload)) {
            // New-style payloads (planFilePath without additionalContext):
            // Use VS Code extension format: "Follow the instruction {promptFilePath}. {planFilePath}"
            const hasAdditionalContext = !!task.payload.additionalContext;
            const hasPlanFilePath = !!task.payload.planFilePath;

            if (!hasAdditionalContext && hasPlanFilePath && !task.payload.promptContent) {
                // New-style: file-path-based prompt referencing both files
                try {
                    if (task.payload.promptFilePath && fs.existsSync(task.payload.promptFilePath)) {
                        return `Follow the instruction ${task.payload.promptFilePath}. ${task.payload.planFilePath}`;
                    }
                } catch {
                    // Fall through to legacy handling
                }
            }

            if (!hasAdditionalContext && hasPlanFilePath && task.payload.promptContent) {
                // Skill-type: promptContent + planFilePath reference (no inline content)
                return `${task.payload.promptContent} ${task.payload.planFilePath}`;
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
                return `Context document:\n\n${contextBlock}\n\n---\n\n${prompt}`;
            }

            return prompt;
        }

        if (isCustomTaskPayload(task.payload)) {
            const data = task.payload.data;
            if (typeof data.prompt === 'string' && data.prompt.trim()) {
                return data.prompt;
            }
        }

        return task.displayName || `Queue task: ${task.type}`;
    }

    // ========================================================================
    // Private — Execution by Type
    // ========================================================================

    private async executeByType(task: QueuedTask, prompt: string): Promise<unknown> {
        // For types that need AI execution
        if (
            isAIClarificationPayload(task.payload) ||
            isCustomTaskPayload(task.payload) ||
            isFollowPromptPayload(task.payload)
        ) {
            return this.executeWithAI(task, prompt);
        }

        // For code-review and resolve-comments: placeholder (no-op)
        return { status: 'completed', message: `Task type '${task.type}' executed (no-op in CLI mode)` };
    }

    private async executeWithAI(task: QueuedTask, prompt: string): Promise<unknown> {
        const processId = `queue_${task.id}`;

        // Initialize output accumulator for this process
        this.outputBuffers.set(processId, '');

        const availability = await this.aiService.isAvailable();
        if (!availability.available) {
            throw new Error(`Copilot SDK not available: ${availability.error || 'unknown reason'}`);
        }

        const workingDirectory = this.getWorkingDirectory(task);
        const timeoutMs = task.config.timeoutMs || DEFAULT_AI_TIMEOUT_MS;

        const result = await this.aiService.sendMessage({
            prompt,
            model: task.config.model,
            workingDirectory,
            timeoutMs,
            keepAlive: true,
            onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
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
            onToolEvent: (event: ToolEvent) => {
                // Append tool timeline item
                const timelineType = event.type === 'tool-start' ? 'tool-start'
                    : event.type === 'tool-complete' ? 'tool-complete'
                    : 'tool-failed';
                this.appendTimelineItem(processId, {
                    type: timelineType,
                    timestamp: new Date(),
                    toolCall: {
                        id: event.toolCallId,
                        name: event.toolName || 'unknown',
                        status: event.type === 'tool-start' ? 'running'
                            : event.type === 'tool-complete' ? 'completed' : 'failed',
                        startTime: new Date(),
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
            },
        });

        if (!result.success) {
            throw new Error(result.error || 'AI execution failed');
        }

        return {
            response: result.response || '(Task completed via tool execution — no text response produced)',
            sessionId: result.sessionId,
            toolCalls: result.toolCalls,
        };
    }

    private getWorkingDirectory(task: QueuedTask): string | undefined {
        if (isFollowPromptPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isAIClarificationPayload(task.payload)) {
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
     * Append a timeline item to the in-memory buffer for a process.
     */
    private appendTimelineItem(processId: string, item: TimelineItem): void {
        if (!this.timelineBuffers.has(processId)) {
            this.timelineBuffers.set(processId, []);
        }
        this.timelineBuffers.get(processId)!.push(item);
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
        if (!buffer) return;

        // Snapshot current timeline for this flush
        const timelineSnapshot = [...(this.timelineBuffers.get(processId) || [])];

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
                        ? { ...turn, content: buffer, streaming: streaming || undefined, timeline: timelineSnapshot }
                        : turn
                );
            } else {
                // Append new assistant turn
                updatedTurns = [
                    ...existingTurns,
                    {
                        role: 'assistant' as const,
                        content: buffer,
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
    });

    const executor = createQueueExecutor(queueManager, taskExecutor, {
        maxConcurrency: options.maxConcurrency ?? 1,
        autoStart: options.autoStart !== false,
    });

    return { executor, bridge: taskExecutor };
}
