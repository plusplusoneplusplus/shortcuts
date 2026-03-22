/**
 * StreamingSession — encapsulates the streaming-session state machine.
 *
 * Extracted from the `sendWithStreaming` closure in `copilot-sdk-service.ts`.
 * An explicit state enum and named event-handler methods replace the
 * ad-hoc `settled` boolean and monolithic `session.on` callback, making the
 * logic testable and reviewable in isolation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Timer dependency map
 * ─────────────────────────────────────────────────────────────────────────────
 *   timeoutId        — started in startTimers(), cleared in cleanup().
 *                      Fires → session.destroy() + settleError (Cancelled).
 *   idleTimerId      — started in startTimers() when idleTimeoutMs > 0,
 *                      reset on every activity event (message_delta, message,
 *                      tool_start, tool_complete).  Cleared in cleanup().
 *                      Fires → session.destroy() + settleError (Cancelled).
 *   turnEndGraceTimer — started in handleTurnEnd() if no timer is already
 *                       active.  Cancelled in handleTurnStart().
 *                       Fires → settleWithResult() (Settled) if content exists.
 *                       Also cleared in cleanup() as a safety net.
 *   unsubscribe      — SDK event subscription handle set in subscribeToEvents(),
 *                       called unconditionally in cleanup().
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Race conditions addressed
 * ─────────────────────────────────────────────────────────────────────────────
 *   • turn_end grace fires while session.idle is also in flight:
 *     first settle() wins; the second is a no-op (state guard).
 *   • turn_end starts grace timer; immediately turn_start cancels it:
 *     handleTurnStart() clears turnEndGraceTimer before it can fire.
 *   • wall-clock timeout fires concurrently with session.idle:
 *     first settle()/settleError() wins; state is already ≠ Streaming
 *     for the second call, so it is silently ignored.
 */

import { createSessionLogger } from '../ai-logger';
import { tryConvertImageFileToDataUrl } from './image-converter';
import type { ToolCall } from '../ai/process-types';
import type { ToolEvent, Attachment, DeliveryMode, TokenUsage } from './types';

// ============================================================================
// State machine
// ============================================================================

/**
 * Lifecycle states of a single streaming session run.
 *
 * Transitions:
 *   Idle → Streaming  (run() called)
 *   Streaming → Settled   (session.idle / turn_end grace / wall-clock timeout)
 *   Streaming → Cancelled (idle timeout / session error)
 */
export const enum StreamingState {
    Idle      = 'Idle',
    Streaming = 'Streaming',
    Settled   = 'Settled',
    Cancelled = 'Cancelled',
}

// ============================================================================
// Types
// ============================================================================

/** Result returned by StreamingSession.run(). */
export interface StreamingResult {
    response: string;
    tokenUsage?: TokenUsage;
    /** Number of assistant turns completed during the session. */
    turnCount: number;
    /** Tool calls captured during the session (if any). */
    toolCalls?: ToolCall[];
}

/**
 * Minimal interface for a streamable SDK session.
 * ICopilotSession in copilot-sdk-service.ts is a strict superset and is
 * structurally compatible with this interface via TypeScript's structural typing.
 */
export interface IStreamableSession {
    sessionId: string;
    on?: (handler: (event: ISessionEvent) => void) => () => void;
    send?: (options: {
        prompt: string;
        attachments?: Attachment[];
        deliveryMode?: DeliveryMode;
    }) => Promise<void>;
    destroy(): Promise<void>;
}

/** SDK event fired by the streaming session. */
export interface ISessionEvent {
    type: string;
    data?: {
        content?: string;
        deltaContent?: string;
        message?: string;
        stack?: string;
        turnId?: string;
        // Token usage (assistant.usage)
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        cost?: number;
        duration?: number;
        // Session quota (session.usage_info)
        tokenLimit?: number;
        currentTokens?: number;
        // Tool execution (tool.execution_start / tool.execution_complete)
        toolCallId?: string;
        toolName?: string;
        arguments?: unknown;
        parentToolCallId?: string;
        success?: boolean;
        result?: { content?: string };
        error?: { message?: string; code?: string };
        toolTelemetry?: Record<string, unknown>;
        // Tool progress (tool.execution_progress)
        progressMessage?: string;
        // Tool partial result (tool.execution_partial_result)
        partialOutput?: string;
        // Session info (session.info)
        infoType?: string;
        // Assistant intent (assistant.intent)
        intent?: string;
        // Agent mode change (session.agent_mode_change)
        previous_mode?: string;
        new_mode?: string;
        // Assistant message tool requests
        toolRequests?: Array<{ toolCallId: string; name: string; arguments?: unknown }>;
        // Abort reason
        reason?: string;
    };
}

/** Options passed to StreamingSession.run(). */
export interface StreamingSessionRunOptions {
    prompt: string;
    timeoutMs: number;
    onStreamingChunk?: (chunk: string) => void;
    /** Shared map; mutated in place so callers can read captured calls after run(). */
    toolCallsMap?: Map<string, ToolCall>;
    onToolEvent?: (event: ToolEvent) => void;
    idleTimeoutMs?: number;
    attachments?: Attachment[];
    deliveryMode?: DeliveryMode;
    /** Original caller session ID; used only to suppress the deliveryMode warning. */
    callerSessionId?: string;
}

// ============================================================================
// StreamingSession
// ============================================================================

export class StreamingSession {
    // ── State machine ────────────────────────────────────────────────────────
    private state: StreamingState = StreamingState.Idle;

    // ── Timers ───────────────────────────────────────────────────────────────
    private timeoutId?: ReturnType<typeof setTimeout>;
    private idleTimerId?: ReturnType<typeof setTimeout>;
    private turnEndGraceTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Session subscription ─────────────────────────────────────────────────
    private unsubscribe?: () => void;

    // ── Accumulated response data ────────────────────────────────────────────
    private response = '';
    private allMessages: string[] = [];
    private turnCount = 0;
    private readonly activeToolCalls = new Map<string, { toolName: string; startTime: number }>();
    private toolCallsMap!: Map<string, ToolCall>;

    // ── Token usage accumulators ─────────────────────────────────────────────
    private usageInputTokens = 0;
    private usageOutputTokens = 0;
    private usageCacheReadTokens = 0;
    private usageCacheWriteTokens = 0;
    private usageCost: number | undefined;
    private usageDuration: number | undefined;
    private usageTurnCount = 0;
    private usageTokenLimit: number | undefined;
    private usageCurrentTokens: number | undefined;

    // ── Promise control ──────────────────────────────────────────────────────
    private resolve?: (value: StreamingResult) => void;
    private reject?: (error: Error) => void;

    // ── Misc ─────────────────────────────────────────────────────────────────
    private streamingStartTime = 0;
    private sessionLog!: ReturnType<typeof createSessionLogger>;
    private session!: IStreamableSession;
    private options!: StreamingSessionRunOptions;

    /**
     * Run the streaming session against `session` with the given options.
     * Can only be called once per instance.
     */
    run(session: IStreamableSession, options: StreamingSessionRunOptions): Promise<StreamingResult> {
        if (this.state !== StreamingState.Idle) {
            throw new Error('StreamingSession.run() can only be called once per instance');
        }

        this.session = session;
        this.options = options;
        this.toolCallsMap = options.toolCallsMap ?? new Map<string, ToolCall>();
        this.sessionLog = createSessionLogger(session.sessionId);
        this.state = StreamingState.Streaming;
        this.streamingStartTime = Date.now();

        return new Promise<StreamingResult>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
            this.startTimers();
            this.subscribeToEvents();
            this.sendMessage();
        });
    }

    // ── Setup ────────────────────────────────────────────────────────────────

    private startTimers(): void {
        const { timeoutMs } = this.options;

        this.timeoutId = setTimeout(() => {
            if (this.activeToolCalls.size > 0) {
                const staleTools = [...this.activeToolCalls.entries()].map(
                    ([id, t]) => `${t.toolName}(${id}, ${Date.now() - t.startTime}ms)`,
                );
                this.sessionLog.error(
                    { activeToolCount: this.activeToolCalls.size, activeTools: staleTools },
                    'Timeout with active tool call(s)',
                );
            }
            this.sessionLog.error(
                { elapsedMs: timeoutMs, activeTools: [...this.activeToolCalls.keys()] },
                'Force-destroying session due to timeout',
            );
            this.session.destroy().catch(() => {});
            this.settleError(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        this.resetIdleTimer();
    }

    private resetIdleTimer(): void {
        const effectiveIdleMs = this.options.idleTimeoutMs ?? 0;
        if (effectiveIdleMs <= 0) { return; }
        if (this.idleTimerId !== undefined) { clearTimeout(this.idleTimerId); }
        this.idleTimerId = setTimeout(() => {
            this.sessionLog.error(
                { elapsedMs: effectiveIdleMs },
                'Force-destroying session due to idle timeout',
            );
            this.session.destroy().catch(() => {});
            this.settleError(new Error(`Request idle-timed out after ${effectiveIdleMs}ms with no activity`));
        }, effectiveIdleMs);
    }

    private subscribeToEvents(): void {
        this.unsubscribe = this.session.on!((event: ISessionEvent) => {
            this.handleEvent(event);
        });
    }

    private sendMessage(): void {
        const { prompt, attachments, deliveryMode, callerSessionId } = this.options;

        if (deliveryMode && !callerSessionId) {
            this.sessionLog.warn(
                'deliveryMode is set but this is a one-shot session — ' +
                'delivery mode is only meaningful for resumed sessions ' +
                '(pass sessionId to resume). The option will be forwarded ' +
                'to session.send() but may have no observable effect.',
            );
        }

        this.session.send!({ prompt, attachments, deliveryMode }).catch(error => {
            this.settleError(error instanceof Error ? error : new Error(String(error)));
        });
    }

    // ── State machine ────────────────────────────────────────────────────────

    private cleanup(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        clearTimeout(this.timeoutId);
        if (this.idleTimerId !== undefined) {
            clearTimeout(this.idleTimerId);
        }
        if (this.turnEndGraceTimer) {
            clearTimeout(this.turnEndGraceTimer);
            this.turnEndGraceTimer = null;
        }
    }

    private settle(value: StreamingResult): void {
        if (this.state === StreamingState.Streaming) {
            this.state = StreamingState.Settled;
            this.cleanup();
            this.resolve!(value);
        }
    }

    private settleError(error: Error): void {
        if (this.state === StreamingState.Streaming) {
            this.state = StreamingState.Cancelled;
            this.cleanup();
            this.reject!(error);
        }
    }

    private settleWithResult(): void {
        const joinedMessages = this.allMessages.length > 0
            ? this.allMessages.filter(m => m.trim()).join('\n\n')
            : '';
        const result = joinedMessages || this.response;
        const elapsedMs = Date.now() - this.streamingStartTime;
        this.sessionLog.info(
            { totalChars: result.length, turns: this.turnCount, messages: this.allMessages.length, elapsedMs },
            'Streaming completed',
        );
        if (this.activeToolCalls.size > 0) {
            const staleTools = [...this.activeToolCalls.entries()].map(
                ([id, t]) => `${t.toolName}(${id}, ${Date.now() - t.startTime}ms)`,
            );
            this.sessionLog.debug(
                { activeToolCount: this.activeToolCalls.size, staleTools },
                'WARNING: tool call(s) still active at settle',
            );
        }
        const capturedToolCalls = this.toolCallsMap.size > 0
            ? Array.from(this.toolCallsMap.values())
            : undefined;
        this.settle({
            response: result,
            tokenUsage: this.buildTokenUsage(),
            turnCount: this.turnCount,
            toolCalls: capturedToolCalls,
        });
    }

    private buildTokenUsage(): TokenUsage | undefined {
        if (this.usageTurnCount === 0) { return undefined; }
        return {
            inputTokens: this.usageInputTokens,
            outputTokens: this.usageOutputTokens,
            cacheReadTokens: this.usageCacheReadTokens,
            cacheWriteTokens: this.usageCacheWriteTokens,
            totalTokens: this.usageInputTokens + this.usageOutputTokens,
            cost: this.usageCost,
            duration: this.usageDuration,
            turnCount: this.usageTurnCount,
            tokenLimit: this.usageTokenLimit,
            currentTokens: this.usageCurrentTokens,
        };
    }

    // ── Event dispatcher ─────────────────────────────────────────────────────

    private handleEvent(event: ISessionEvent): void {
        switch (event.type) {
            case 'assistant.message_delta':   this.handleMessageDelta(event);  break;
            case 'assistant.message':         this.handleMessage(event);       break;
            case 'assistant.turn_start':      this.handleTurnStart();          break;
            case 'assistant.turn_end':        this.handleTurnEnd();            break;
            case 'session.idle':              this.handleSessionIdle();        break;
            case 'session.error':             this.handleSessionError(event);  break;
            case 'assistant.usage':           this.handleUsage(event);         break;
            case 'session.usage_info':        this.handleUsageInfo(event);     break;
            case 'tool.execution_start':      this.handleToolStart(event);     break;
            case 'tool.execution_complete':   this.handleToolComplete(event);  break;
            case 'tool.execution_progress':   this.handleToolProgress(event);  break;
            case 'assistant.intent':
                this.sessionLog.debug({ intent: event.data?.intent }, 'Assistant intent');
                break;
            case 'session.info':
                this.sessionLog.debug({ infoType: event.data?.infoType, message: event.data?.message }, 'Session info');
                break;
            case 'abort':
                this.sessionLog.debug({ reason: event.data?.reason }, 'Session aborted');
                break;
        }
    }

    // ── Event handlers ───────────────────────────────────────────────────────

    private handleMessageDelta(event: ISessionEvent): void {
        const delta = event.data?.deltaContent || '';
        this.response += delta;
        if (delta) { this.resetIdleTimer(); }
        if (this.options.onStreamingChunk && delta) {
            try {
                this.options.onStreamingChunk(delta);
            } catch (cbError) {
                this.sessionLog.debug({ err: cbError }, 'onStreamingChunk callback error');
            }
        }
    }

    private handleMessage(event: ISessionEvent): void {
        const messageContent = event.data?.content || '';
        if (messageContent) {
            this.allMessages.push(messageContent);
        }
        this.sessionLog.debug(
            { messageNum: this.allMessages.length, chars: messageContent.length },
            'Received message',
        );
        if (event.data?.toolRequests?.length) {
            const toolNames = event.data.toolRequests.map(t => t.name);
            this.sessionLog.debug(
                { toolRequestCount: event.data.toolRequests.length, toolNames },
                'Message includes tool requests',
            );
        }
        // If no delta chunks were received but we have a streaming callback,
        // emit the full message as a single chunk so SSE consumers get content.
        if (this.options.onStreamingChunk && messageContent && !this.response) {
            this.resetIdleTimer();
            try {
                this.options.onStreamingChunk(messageContent);
            } catch (cbError) {
                this.sessionLog.debug({ err: cbError }, 'onStreamingChunk callback error');
            }
        }
    }

    private handleTurnStart(): void {
        const elapsedMs = Date.now() - this.streamingStartTime;
        this.sessionLog.debug({ elapsedMs, activeToolCalls: this.activeToolCalls.size }, 'Turn starting');
        if (this.turnEndGraceTimer) {
            clearTimeout(this.turnEndGraceTimer);
            this.turnEndGraceTimer = null;
            this.sessionLog.debug('Cancelled turn_end grace timer — new turn starting');
        }
    }

    private handleTurnEnd(): void {
        this.turnCount++;
        this.sessionLog.debug({ turn: this.turnCount, messages: this.allMessages.length }, 'Turn ended');
        if (this.state === StreamingState.Streaming && !this.turnEndGraceTimer) {
            this.turnEndGraceTimer = setTimeout(() => {
                this.turnEndGraceTimer = null;
                if (this.state === StreamingState.Streaming && (this.allMessages.length > 0 || this.response)) {
                    this.sessionLog.debug({ turn: this.turnCount }, 'Settling after turn_end grace period');
                    this.settleWithResult();
                }
            }, 2000);
        }
    }

    private handleSessionIdle(): void {
        this.sessionLog.debug({ turns: this.turnCount }, 'Session idle');
        this.settleWithResult();
    }

    private handleSessionError(event: ISessionEvent): void {
        const errorMessage = event.data?.message || 'Unknown session error';
        this.sessionLog.error({ errorMessage }, 'Session error');
        this.settleError(new Error(`Copilot session error: ${errorMessage}`));
    }

    private handleUsage(event: ISessionEvent): void {
        this.usageTurnCount++;
        this.usageInputTokens   += event.data?.inputTokens   ?? 0;
        this.usageOutputTokens  += event.data?.outputTokens  ?? 0;
        this.usageCacheReadTokens  += event.data?.cacheReadTokens  ?? 0;
        this.usageCacheWriteTokens += event.data?.cacheWriteTokens ?? 0;
        if (event.data?.cost != null)     { this.usageCost     = (this.usageCost     ?? 0) + event.data.cost; }
        if (event.data?.duration != null) { this.usageDuration = (this.usageDuration ?? 0) + event.data.duration; }
        this.sessionLog.debug(
            { turn: this.usageTurnCount, inputTokens: event.data?.inputTokens ?? 0, outputTokens: event.data?.outputTokens ?? 0 },
            'Token usage',
        );
    }

    private handleUsageInfo(event: ISessionEvent): void {
        if (event.data?.tokenLimit    != null) { this.usageTokenLimit    = event.data.tokenLimit; }
        if (event.data?.currentTokens != null) { this.usageCurrentTokens = event.data.currentTokens; }
        this.sessionLog.debug(
            { tokenLimit: this.usageTokenLimit, currentTokens: this.usageCurrentTokens },
            'Session usage info',
        );
    }

    private handleToolStart(event: ISessionEvent): void {
        this.resetIdleTimer();
        const toolCallId       = event.data?.toolCallId       || '(unknown)';
        const toolName         = event.data?.toolName         || '(unknown)';
        const parentToolCallId = event.data?.parentToolCallId;
        this.activeToolCalls.set(toolCallId, { toolName, startTime: Date.now() });
        const truncatedArgs = event.data?.arguments
            ? JSON.stringify(event.data.arguments).substring(0, 200)
            : undefined;
        this.sessionLog.debug({ toolName, toolCallId, args: truncatedArgs }, 'Tool execution started');

        const toolCall: ToolCall = {
            id:        toolCallId !== '(unknown)' ? toolCallId : `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name:      toolName   !== '(unknown)' ? toolName   : 'unknown',
            status:    'running',
            startTime: new Date(),
            args:      (event.data?.arguments ?? {}) as Record<string, unknown>,
            ...(parentToolCallId ? { parentToolCallId } : {}),
        };
        this.toolCallsMap.set(toolCall.id, toolCall);

        if (this.options.onToolEvent) {
            try {
                this.options.onToolEvent({
                    type:              'tool-start',
                    toolCallId:        toolCall.id,
                    toolName:          toolCall.name,
                    parentToolCallId:  toolCall.parentToolCallId,
                    parameters:        toolCall.args,
                });
            } catch { /* non-fatal */ }
        }
    }

    private handleToolComplete(event: ISessionEvent): void {
        this.resetIdleTimer();
        const toolCallId = event.data?.toolCallId || '(unknown)';
        const tracked    = this.activeToolCalls.get(toolCallId);
        const durationMs = tracked ? Date.now() - tracked.startTime : undefined;
        this.activeToolCalls.delete(toolCallId);

        const toolSuccess = event.data?.success;
        if (toolSuccess) {
            const resultChars = event.data?.result?.content?.length ?? 0;
            this.sessionLog.debug(
                { toolName: tracked?.toolName, toolCallId, durationMs, resultChars, success: true },
                'Tool execution completed',
            );
        } else {
            const errorMsg = event.data?.error?.message || '(no error message)';
            this.sessionLog.debug(
                { toolName: tracked?.toolName, toolCallId, durationMs, success: false, errorMsg },
                'Tool execution failed',
            );
        }

        const capturedTool = this.toolCallsMap.get(toolCallId);
        let resultContent  = event.data?.result?.content;

        if (capturedTool) {
            capturedTool.status  = toolSuccess ? 'completed' : 'failed';
            capturedTool.endTime = new Date();
            if (toolSuccess) {
                // For the `view` tool on image files, replace the plain-text result
                // with a base64 data URL so the dashboard can render it inline.
                if (tracked?.toolName === 'view') {
                    const filePath = capturedTool.args?.path as string | undefined;
                    if (filePath) {
                        const dataUrl = tryConvertImageFileToDataUrl(filePath);
                        if (dataUrl) { resultContent = dataUrl; }
                    }
                }
                capturedTool.result = resultContent;
            } else {
                capturedTool.error = event.data?.error?.message || 'Unknown error';
            }
        } else {
            // Orphaned complete event — tool started outside the observation window.
            this.toolCallsMap.set(toolCallId, {
                id:        toolCallId,
                name:      tracked?.toolName || 'unknown',
                status:    'failed',
                startTime: new Date(tracked?.startTime ?? Date.now()),
                endTime:   new Date(),
                args:      {},
                ...(event.data?.parentToolCallId ? { parentToolCallId: event.data.parentToolCallId } : {}),
                error:     'Started outside observation window',
            });
        }

        // Prefer event-data parentToolCallId (freshest from SDK) over the captured start value.
        const completeParentId = event.data?.parentToolCallId || capturedTool?.parentToolCallId;
        if (this.options.onToolEvent) {
            try {
                if (toolSuccess) {
                    this.options.onToolEvent({
                        type:             'tool-complete',
                        toolCallId,
                        toolName:         tracked?.toolName,
                        parentToolCallId: completeParentId,
                        result:           resultContent,
                    });
                } else {
                    this.options.onToolEvent({
                        type:             'tool-failed',
                        toolCallId,
                        toolName:         tracked?.toolName,
                        parentToolCallId: completeParentId,
                        error:            event.data?.error?.message || 'Unknown error',
                    });
                }
            } catch { /* non-fatal */ }
        }
    }

    private handleToolProgress(event: ISessionEvent): void {
        const toolCallId       = event.data?.toolCallId || '(unknown)';
        const tracked          = this.activeToolCalls.get(toolCallId);
        this.sessionLog.debug(
            { toolName: tracked?.toolName, toolCallId, progressMessage: event.data?.progressMessage },
            'Tool progress',
        );
        const capturedProgress = this.toolCallsMap.get(toolCallId);
        if (capturedProgress && event.data?.progressMessage) {
            (capturedProgress as any).progressMessage = event.data.progressMessage;
        }
    }
}
