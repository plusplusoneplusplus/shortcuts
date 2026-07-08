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
 * No execution-mode logic (chat, autopilot, workflows, scripts) lives here.
 */

import type { ConversationTurn, GenericProcessMetadata, ProcessStore, TimelineItem, ToolEvent, BackgroundTasksInfo } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory, mergeConsecutiveContentItems } from '@plusplusoneplusplus/forge';
import { OutputFileManager } from '../processes/output-file-manager';
import {
    ProcessSessionRegistry,
    type InteractiveAskUserHandles,
    type RalphGrillState,
    type StreamingTurnState,
    type TurnWriteState,
} from './process-session-registry';

// ============================================================================
// Types
// ============================================================================

export type { InteractiveAskUserHandles, StreamingTurnState };

// ============================================================================
// BaseExecutor
// ============================================================================

export abstract class BaseExecutor {
    protected readonly store: ProcessStore;
    protected readonly dataDir?: string;

    /** Set of task IDs that have been cancelled. */
    protected readonly cancelledTasks: Set<string> = new Set();

    /** Owns per-process executor session state with explicit cleanup policy. */
    protected readonly sessions = new ProcessSessionRegistry();

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

    /** Get or create per-turn streaming state for a process. */
    protected getOrCreateStreamingState(processId: string): StreamingTurnState {
        return this.sessions.getStreaming(processId);
    }

    /** Clear per-turn state, retaining cross-turn Ralph grill state when present. */
    protected cleanupSession(processId: string): void {
        this.sessions.cleanupTurn(processId);
    }

    protected async clearPendingAskUser(processId: string): Promise<void> {
        await this.store.updateProcess(processId, { pendingAskUser: undefined });
    }

    /**
     * Reset streaming state for a process so a retry starts with a clean slate.
     * Clears the output buffer, timeline, suggestions, and throttle counters
     * without deleting the session entry itself.
     */
    protected resetSessionStreamingState(processId: string): void {
        this.sessions.resetStreaming(processId);
    }

    /** Look up the pending ask-user handles for a process (if any). */
    getAskUserHandles(processId: string): InteractiveAskUserHandles | undefined {
        return this.sessions.getAskUserHandles(processId);
    }

    protected setAskUserHandles(processId: string, handles: InteractiveAskUserHandles): void {
        this.sessions.setAskUserHandles(processId, handles);
    }

    protected clearAskUserHandles(processId: string): void {
        this.sessions.clearAskUserHandles(processId);
    }

    protected cancelAskUserHandles(processId: string): void {
        this.sessions.cancelAskUserHandles(processId);
    }

    protected getRalphGrillState(processId: string): RalphGrillState['current'] {
        return this.sessions.getRalphGrillState(processId);
    }

    protected setRalphGrillState(processId: string, state: RalphGrillState['current']): void {
        this.sessions.setRalphGrillState(processId, state);
    }

    protected getOutputBuffer(processId: string): string {
        return this.sessions.getStreamingIfPresent(processId)?.outputBuffer ?? '';
    }

    protected appendOutputChunk(processId: string, chunk: string): void {
        this.sessions.getStreaming(processId).outputBuffer += chunk;
    }

    protected getTimelineBuffer(processId: string): TimelineItem[] | undefined {
        return this.sessions.getStreamingIfPresent(processId)?.timelineBuffer;
    }

    protected getPendingSuggestions(processId: string): string[] | undefined {
        return this.sessions.getPendingSuggestions(processId);
    }

    /**
     * Persist the most recent system prompt on process metadata without
     * blocking execution. Re-reads the process first so concurrent metadata
     * updates are preserved.
     */
    protected persistSystemPromptAsync(processId: string, taskType: string, content: string | undefined): void {
        if (!content) return;
        void (async () => {
            try {
                const proc = await this.store.getProcess(processId);
                if (!proc) return;
                const metadata: GenericProcessMetadata = {
                    type: proc.metadata?.type ?? taskType,
                    ...(proc.metadata ?? {}),
                    systemPrompt: content,
                };
                await this.store.updateProcess(processId, { metadata });
            } catch (err) {
                getLogger().debug(
                    LogCategory.AI,
                    `[BaseExecutor] Failed to persist system prompt for ${processId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        })();
    }

    // ========================================================================
    // Streaming / throttling
    // ========================================================================

    /** Append a timeline item to the in-memory buffer for a process. */
    protected appendTimelineItem(processId: string, item: TimelineItem): void {
        const streaming = this.sessions.getStreaming(processId);
        const last = streaming.timelineBuffer.length > 0
            ? streaming.timelineBuffer[streaming.timelineBuffer.length - 1]
            : undefined;
        // Merge consecutive content items to avoid word-per-line rendering
        if (last && last.type === 'content' && item.type === 'content') {
            last.content = (last.content ?? '') + (item.content ?? '');
        } else {
            streaming.timelineBuffer.push(item);
        }
    }

    /**
     * Check throttle conditions and flush conversation turn if necessary.
     * Called on every streaming chunk. Flushes when either:
     * - Time since last flush >= THROTTLE_TIME_MS (5 seconds)
     * - Chunks since last flush >= THROTTLE_CHUNK_COUNT (50 chunks)
     */
    protected checkThrottleAndFlush(processId: string): void {
        const streaming = this.sessions.getStreaming(processId);
        streaming.throttleState.chunksSinceLastFlush++;

        const timeSinceFlush = Date.now() - streaming.throttleState.lastFlushTime;
        if (
            streaming.throttleState.chunksSinceLastFlush >= BaseExecutor.THROTTLE_CHUNK_COUNT ||
            timeSinceFlush >= BaseExecutor.THROTTLE_TIME_MS
        ) {
            // Reset counters synchronously to prevent duplicate flushes
            streaming.throttleState.chunksSinceLastFlush = 0;
            streaming.throttleState.lastFlushTime = Date.now();
            this.flushConversationTurn(processId, true).catch(() => {
                // Non-fatal: don't fail the task because of flush
            });
        }
    }

    /**
     * Run a conversation-turn store write through the per-process chain so a
     * streaming flush and the final turn append cannot interleave, regardless
     * of how the underlying store schedules its writes.
     */
    private chainTurnWrite<T>(processId: string, op: () => Promise<T>): Promise<T> {
        const writeState: TurnWriteState = this.sessions.getTurnWrite(processId);
        const result = writeState.chain.then(op, op);
        writeState.chain = result.then(() => undefined, () => undefined);
        return result;
    }

    /**
     * Flush current streaming content to the store as a conversation turn.
     * When `streaming` is true, marks the turn as in-progress so the UI
     * can show a streaming indicator. On completion, call with `streaming: false`.
     *
     * No-ops once the turn has been finalized: an SSE subscriber's
     * `requestFlush` can race turn completion, and an upsert landing after
     * `appendFinalConversationTurn` would re-insert the streamed content as a
     * permanent duplicate streaming turn.
     */
    protected async flushConversationTurn(processId: string, streaming: boolean): Promise<void> {
        const streamingState = this.sessions.getStreamingIfPresent(processId);
        if (!streamingState || streamingState.turnFinalized) return;
        const buffer = streamingState.outputBuffer;
        const hasTimeline = streamingState.timelineBuffer.length > 0;
        if (buffer == null && !hasTimeline) return;

        // Snapshot buffer + timeline synchronously at call time so throttled
        // flushes persist progressively growing content; only the store write
        // itself is serialized through the chain.
        const timelineSnapshot = mergeConsecutiveContentItems([...streamingState.timelineBuffer]);

        return this.chainTurnWrite(processId, async () => {
            // Re-validate inside the chain: the turn may have been finalized
            // or the session cleaned up while this flush waited its turn.
            if (streamingState !== this.sessions.getStreamingIfPresent(processId) || streamingState.turnFinalized) return;
            try {
                await this.store.upsertStreamingTurn(processId, buffer ?? '', streaming, timelineSnapshot);
            } catch {
                // Non-fatal: don't fail the task because of flush
            }
        });
    }

    /**
     * Append the turn's final conversation turn, replacing any persisted
     * streaming turn (`filterStreaming: true` semantics are supplied by the
     * caller via `options`) and blocking subsequent streaming flushes for this
     * turn. Serialized against in-flight flushes via the per-process write
     * chain so a concurrent flush can neither interleave with nor land after
     * the final append.
     */
    protected appendFinalConversationTurn(
        processId: string,
        makeTurn: (turnIndex: number) => ConversationTurn,
        options?: Parameters<ProcessStore['appendConversationTurn']>[2],
    ): Promise<{ turn: ConversationTurn; allTurns: ConversationTurn[] } | undefined> {
        return this.chainTurnWrite(processId, async () => {
            const streaming = this.sessions.getStreaming(processId);
            streaming.turnFinalized = true;
            return this.store.appendConversationTurn(processId, makeTurn, options);
        });
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
                        this.sessions.setPendingSuggestions(processId, suggestions);
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
            const outputPath = await OutputFileManager.saveOutput(processId, content, this.dataDir, workspaceId);
            if (outputPath) {
                await this.store.updateProcess(processId, { rawStdoutFilePath: outputPath });
            }
        } catch {
            // Non-fatal: don't fail the task because of output persistence
        }
    }
}
