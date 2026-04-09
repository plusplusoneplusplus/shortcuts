/**
 * Base Executor
 *
 * Abstract base class that owns the shared streaming/cancellation plumbing
 * used by all execution modes. Concrete executors (e.g. CLITaskExecutor)
 * extend this class and add execution-mode-specific logic on top.
 *
 * Responsibilities:
 * - Streaming lifecycle: chunk accumulation, throttled flush, timeline buffering
 * - Cancellation token management (cancelledTasks set)
 * - Tool-event capture (building the onToolEvent handler)
 * - Output file management (writing streamed output to disk)
 *
 * No execution-mode logic (chat, plan, autopilot, workflows, scripts) lives here.
 */

import type { ProcessStore, TimelineItem, ToolEvent, BackgroundTasksInfo } from '@plusplusoneplusplus/forge';
import { mergeConsecutiveContentItems } from '@plusplusoneplusplus/forge';
import { OutputFileManager } from '../output-file-manager';

// ============================================================================
// Types
// ============================================================================

/**
 * Consolidated per-process state held for the lifetime of a single task execution.
 * A single entry is created on first access and deleted atomically in cleanupSession().
 */
export interface ProcessSessionState {
    outputBuffer: string;
    timelineBuffer: TimelineItem[];
    throttleState: { chunksSinceLastFlush: number; lastFlushTime: number };
    pendingSuggestions: string[] | undefined;
}

// ============================================================================
// BaseExecutor
// ============================================================================

export abstract class BaseExecutor {
    protected readonly store: ProcessStore;
    protected readonly dataDir?: string;

    /** Set of task IDs that have been cancelled. */
    protected readonly cancelledTasks: Set<string> = new Set();

    /**
     * Subfolder under `<dataDir>/repos/<workspaceId>/` where output files are persisted.
     * Defaults to `'outputs'`; chat-mode executors override this to `'chat'`.
     */
    protected readonly outputSubfolder: string = 'outputs';

    /** Consolidated per-process session state. */
    protected readonly sessions = new Map<string, ProcessSessionState>();

    /** Time-based throttle: flush every N milliseconds. */
    protected static readonly THROTTLE_TIME_MS = 5000;

    /** Count-based throttle: flush every N chunks. */
    protected static readonly THROTTLE_CHUNK_COUNT = 50;

    constructor(store: ProcessStore, dataDir?: string) {
        this.store = store;
        this.dataDir = dataDir;
    }

    // ========================================================================
    // Session lifecycle
    // ========================================================================

    /** Get or create the session state for a process. */
    protected getOrCreateSession(processId: string): ProcessSessionState {
        let session = this.sessions.get(processId);
        if (!session) {
            session = {
                outputBuffer: '',
                timelineBuffer: [],
                throttleState: { chunksSinceLastFlush: 0, lastFlushTime: 0 },
                pendingSuggestions: undefined,
            };
            this.sessions.set(processId, session);
        }
        return session;
    }

    /** Delete all session state for a process in one atomic operation. */
    protected cleanupSession(processId: string): void {
        this.sessions.delete(processId);
    }

    // ========================================================================
    // Streaming / throttling
    // ========================================================================

    /** Append a timeline item to the in-memory buffer for a process. */
    protected appendTimelineItem(processId: string, item: TimelineItem): void {
        const session = this.getOrCreateSession(processId);
        const last = session.timelineBuffer.length > 0
            ? session.timelineBuffer[session.timelineBuffer.length - 1]
            : undefined;
        // Merge consecutive content items to avoid word-per-line rendering
        if (last && last.type === 'content' && item.type === 'content') {
            last.content = (last.content ?? '') + (item.content ?? '');
        } else {
            session.timelineBuffer.push(item);
        }
    }

    /**
     * Check throttle conditions and flush conversation turn if necessary.
     * Called on every streaming chunk. Flushes when either:
     * - Time since last flush >= THROTTLE_TIME_MS (5 seconds)
     * - Chunks since last flush >= THROTTLE_CHUNK_COUNT (50 chunks)
     */
    protected checkThrottleAndFlush(processId: string): void {
        const session = this.getOrCreateSession(processId);
        session.throttleState.chunksSinceLastFlush++;

        const timeSinceFlush = Date.now() - session.throttleState.lastFlushTime;
        if (
            session.throttleState.chunksSinceLastFlush >= BaseExecutor.THROTTLE_CHUNK_COUNT ||
            timeSinceFlush >= BaseExecutor.THROTTLE_TIME_MS
        ) {
            // Reset counters synchronously to prevent duplicate flushes
            session.throttleState.chunksSinceLastFlush = 0;
            session.throttleState.lastFlushTime = Date.now();
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
    protected async flushConversationTurn(processId: string, streaming: boolean): Promise<void> {
        const session = this.sessions.get(processId);
        const buffer = session?.outputBuffer;
        const hasTimeline = (session?.timelineBuffer.length ?? 0) > 0;
        if (buffer == null && !hasTimeline) return;

        // Snapshot current timeline for this flush, merging consecutive content items
        const timelineSnapshot = mergeConsecutiveContentItems([...(session?.timelineBuffer || [])]);

        try {
            await this.store.upsertStreamingTurn(processId, buffer ?? '', streaming, timelineSnapshot);
        } catch {
            // Non-fatal: don't fail the task because of flush
        }
    }

    // ========================================================================
    // Tool event handling
    // ========================================================================

    /**
     * Builds the onToolEvent handler for a given process.
     * `computeTurnIndex` is called lazily at event time to determine the current turn index
     * for suggestion events — this allows callers to supply the correct index based on
     * conversation state at the time the event fires.
     */
    protected buildToolEventHandler(
        processId: string,
        computeTurnIndex: () => number,
    ): (event: ToolEvent) => void {
        return (event: ToolEvent) => {
            // Intercept suggestion tool completions — emit as dedicated SSE event
            if (event.type === 'tool-complete' && event.toolName === 'suggest_follow_ups') {
                try {
                    const parsed = JSON.parse(event.result || '{}');
                    const suggestions: string[] = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
                    if (suggestions.length > 0) {
                        this.getOrCreateSession(processId).pendingSuggestions = suggestions;
                        this.store.emitProcessEvent(processId, {
                            type: 'suggestions',
                            suggestions,
                            turnIndex: computeTurnIndex(),
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
        };
    }

    /**
     * Builds the onBackgroundTasksChanged handler for a given process.
     * Emits a 'background-tasks' ProcessOutputEvent so SSE can relay it to the frontend.
     */
    protected buildBackgroundTaskHandler(
        processId: string,
    ): (tasks: BackgroundTasksInfo) => void {
        return (tasks: BackgroundTasksInfo) => {
            try {
                this.store.emitProcessEvent(processId, {
                    type: 'background-tasks',
                    backgroundAgents: tasks.backgroundAgents,
                    backgroundShells: tasks.backgroundShells,
                    backgroundTotalActive: tasks.backgroundTotalActive,
                    backgroundWaitingForDrain: tasks.backgroundWaitingForDrain,
                });
            } catch {
                // Non-fatal
            }
        };
    }

    // ========================================================================
    // Output file management
    // ========================================================================

    /**
     * Persist accumulated conversation output to disk.
     * Non-fatal: errors are silently ignored.
     */
    protected async persistOutput(processId: string, content: string, workspaceId?: string): Promise<void> {
        if (!content || !this.dataDir) { return; }
        try {
            const outputPath = await OutputFileManager.saveOutput(processId, content, this.dataDir, workspaceId, this.outputSubfolder);
            if (outputPath) {
                await this.store.updateProcess(processId, { rawStdoutFilePath: outputPath });
            }
        } catch {
            // Non-fatal: don't fail the task because of output persistence
        }
    }
}
