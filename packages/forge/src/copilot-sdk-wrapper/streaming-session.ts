/**
 * StreamingSession — thin orchestrator that wires collaborators.
 *
 * Delegates state management to `StreamingStateMachine`, timer management
 * to `SessionTimerManager`, and telemetry to `SessionTelemetry`.
 * The session itself handles SDK event dispatch, message sending,
 * and cleanup coordination.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Race conditions addressed
 * ─────────────────────────────────────────────────────────────────────────────
 *   • turn_end grace fires while session.idle is also in flight:
 *     first settle() wins; the second is a no-op (state guard).
 *   • turn_end starts grace timer; immediately turn_start cancels it:
 *     handleTurnStart() clears turnEndGraceTimer before it can fire.
 *   • wall-clock timeout fires concurrently with session.idle:
 *     first settle()/settleError() wins; state is already terminal
 *     for the second call, so it is silently ignored.
 */

import { createSessionLogger } from '../ai-logger';
import type { ToolCall } from '../ai/process-types';
import type { Attachment, DeliveryMode, TokenUsage } from './types';
import { StreamingStateMachine, StreamingState } from './streaming-state-machine';
import { SessionTimerManager } from './session-timer-manager';
import { SessionTelemetry } from './session-telemetry';

// Re-export for backward compatibility
export { StreamingState } from './streaming-state-machine';

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
    }) => Promise<string | void>;
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
        // Background tasks (session.idle, background_tasks_changed)
        backgroundTasks?: {
            agents?: Array<{ id: string; type?: string; description?: string }>;
            shells?: Array<{ id: string; type?: string; description?: string }>;
        };
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

import type { ToolEvent } from './types';

// ============================================================================
// StreamingSession
// ============================================================================

export class StreamingSession {
    // ── Collaborators ────────────────────────────────────────────────────────
    private readonly stateMachine = new StreamingStateMachine();
    private timers!: SessionTimerManager;
    private telemetry!: SessionTelemetry;

    // ── Session subscription ─────────────────────────────────────────────────
    private unsubscribe?: () => void;

    // ── Promise control ──────────────────────────────────────────────────────
    private resolve?: (value: StreamingResult) => void;
    private reject?: (error: Error) => void;

    // ── Background task tracking ────────────────────────────────────────────
    private waitingForBackgroundTasks = false;

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
        this.stateMachine.start(); // throws if not Idle

        this.session = session;
        this.options = options;
        this.telemetry = new SessionTelemetry(options.toolCallsMap);
        this.sessionLog = createSessionLogger(session.sessionId);
        this.streamingStartTime = Date.now();

        return new Promise<StreamingResult>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
            this.startTimers();
            this.subscribeToEvents();
            this.sendMessage();
        });
    }

    // ── Accessors for tests (backward compat with existing test assertions) ─
    private get state(): StreamingState { return this.stateMachine.state; }
    private get turnEndGraceTimer(): ReturnType<typeof setTimeout> | null {
        return this.timers?.hasTurnEndGraceTimer ? ({} as any) : null;
    }

    // ── Setup ────────────────────────────────────────────────────────────────

    private startTimers(): void {
        this.timers = new SessionTimerManager(
            {
                timeoutMs: this.options.timeoutMs,
                idleTimeoutMs: this.options.idleTimeoutMs,
            },
            {
                onTimeout: () => {
                    if (this.telemetry.activeToolCalls.size > 0) {
                        this.sessionLog.error(
                            { activeToolCount: this.telemetry.activeToolCalls.size, activeTools: this.telemetry.getActiveToolDescriptions() },
                            'Timeout with active tool call(s)',
                        );
                    }
                    this.sessionLog.error(
                        { elapsedMs: this.options.timeoutMs, activeTools: [...this.telemetry.activeToolCalls.keys()] },
                        'Force-destroying session due to timeout',
                    );
                    this.session.destroy().catch(() => {});
                    this.settleError(new Error(`Request timed out after ${this.options.timeoutMs}ms`));
                },
                onIdleTimeout: () => {
                    const effectiveIdleMs = this.options.idleTimeoutMs ?? 0;
                    this.sessionLog.error(
                        { elapsedMs: effectiveIdleMs },
                        'Force-destroying session due to idle timeout',
                    );
                    this.session.destroy().catch(() => {});
                    this.settleError(new Error(`Request idle-timed out after ${effectiveIdleMs}ms with no activity`));
                },
                onTurnEndGrace: () => {
                    if (this.waitingForBackgroundTasks) {
                        this.sessionLog.debug('Turn-end grace fired but background tasks still active — skipping');
                        return;
                    }
                    if (this.stateMachine.isStreaming && (this.telemetry.allMessages.length > 0 || this.telemetry.response)) {
                        this.sessionLog.debug({ turn: this.telemetry.turnCount }, 'Settling after turn_end grace period');
                        this.settleWithResult();
                    }
                },
            },
        );
        this.timers.start();
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
        this.timers.cleanup();
    }

    private settle(value: StreamingResult): void {
        if (this.stateMachine.settle()) {
            this.cleanup();
            this.resolve!(value);
        }
    }

    private settleError(error: Error): void {
        if (this.stateMachine.cancel()) {
            this.cleanup();
            this.reject!(error);
        }
    }

    private settleWithResult(): void {
        const joinedMessages = this.telemetry.allMessages.length > 0
            ? this.telemetry.allMessages.filter(m => m.trim()).join('\n\n')
            : '';
        const result = joinedMessages || this.telemetry.response;
        const elapsedMs = Date.now() - this.streamingStartTime;
        this.sessionLog.info(
            { totalChars: result.length, turns: this.telemetry.turnCount, messages: this.telemetry.allMessages.length, elapsedMs },
            'Streaming completed',
        );
        if (this.telemetry.activeToolCalls.size > 0) {
            this.sessionLog.debug(
                { activeToolCount: this.telemetry.activeToolCalls.size, staleTools: this.telemetry.getActiveToolDescriptions() },
                'WARNING: tool call(s) still active at settle',
            );
        }
        this.settle({
            response: result,
            tokenUsage: this.telemetry.buildTokenUsage(),
            turnCount: this.telemetry.turnCount,
            toolCalls: this.telemetry.getCapturedToolCalls(),
        });
    }

    // ── Event dispatcher ─────────────────────────────────────────────────────

    private handleEvent(event: ISessionEvent): void {
        switch (event.type) {
            case 'assistant.message_delta':   this.handleMessageDelta(event);  break;
            case 'assistant.message':         this.handleMessage(event);       break;
            case 'assistant.turn_start':      this.handleTurnStart();          break;
            case 'assistant.turn_end':        this.handleTurnEnd();            break;
            case 'session.idle':              this.handleSessionIdle(event);   break;
            case 'session.error':             this.handleSessionError(event);  break;
            case 'assistant.usage':           this.handleUsage(event);         break;
            case 'session.usage_info':        this.handleUsageInfo(event);     break;
            case 'tool.execution_start':      this.handleToolStart(event);     break;
            case 'tool.execution_complete':   this.handleToolComplete(event);  break;
            case 'tool.execution_progress':   this.handleToolProgress(event);  break;
            case 'background_tasks_changed':  this.handleBackgroundTasksChanged(event); break;
            case 'assistant.intent':
                this.sessionLog.debug({ intent: event.data?.intent }, 'Assistant intent');
                break;
            case 'session.info':
                this.sessionLog.debug({ infoType: event.data?.infoType, message: event.data?.message }, 'Session info');
                break;
            case 'abort':
                this.sessionLog.debug({ reason: event.data?.reason }, 'Session aborted');
                this.settleError(new Error('Session aborted'));
                break;
        }
    }

    // ── Event handlers ───────────────────────────────────────────────────────

    private handleMessageDelta(event: ISessionEvent): void {
        const delta = event.data?.deltaContent || '';
        this.telemetry.response += delta;
        if (delta) { this.timers.resetIdleTimer(); }
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
            this.telemetry.allMessages.push(messageContent);
        }
        this.sessionLog.debug(
            { messageNum: this.telemetry.allMessages.length, chars: messageContent.length },
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
        if (this.options.onStreamingChunk && messageContent && !this.telemetry.response) {
            this.timers.resetIdleTimer();
            try {
                this.options.onStreamingChunk(messageContent);
            } catch (cbError) {
                this.sessionLog.debug({ err: cbError }, 'onStreamingChunk callback error');
            }
        }
    }

    private handleTurnStart(): void {
        const elapsedMs = Date.now() - this.streamingStartTime;
        this.sessionLog.debug({ elapsedMs, activeToolCalls: this.telemetry.activeToolCalls.size }, 'Turn starting');
        if (this.timers.hasTurnEndGraceTimer) {
            this.timers.cancelTurnEndGrace();
            this.sessionLog.debug('Cancelled turn_end grace timer — new turn starting');
        }
    }

    private handleTurnEnd(): void {
        this.telemetry.turnCount++;
        this.sessionLog.debug({ turn: this.telemetry.turnCount, messages: this.telemetry.allMessages.length }, 'Turn ended');
        if (this.stateMachine.isStreaming) {
            this.timers.startTurnEndGrace();
        }
    }

    private handleSessionIdle(event: ISessionEvent): void {
        const bgTasks = event.data?.backgroundTasks;
        const activeAgents = bgTasks?.agents?.length ?? 0;
        const activeShells = bgTasks?.shells?.length ?? 0;
        const totalActive = activeAgents + activeShells;

        if (totalActive > 0) {
            this.waitingForBackgroundTasks = true;
            this.timers.cancelTurnEndGrace();
            this.sessionLog.debug(
                { agents: activeAgents, shells: activeShells },
                'Session idle with active background tasks — deferring settle',
            );
            return;
        }

        this.sessionLog.debug({ turns: this.telemetry.turnCount }, 'Session idle');
        this.waitingForBackgroundTasks = false;
        this.settleWithResult();
    }

    private handleBackgroundTasksChanged(event: ISessionEvent): void {
        const bgTasks = event.data?.backgroundTasks;
        const activeAgents = bgTasks?.agents?.length ?? 0;
        const activeShells = bgTasks?.shells?.length ?? 0;
        const totalActive = activeAgents + activeShells;

        this.sessionLog.debug(
            { agents: activeAgents, shells: activeShells, waiting: this.waitingForBackgroundTasks },
            'Background tasks changed',
        );

        if (this.waitingForBackgroundTasks && totalActive === 0) {
            this.sessionLog.debug('All background tasks drained — settling');
            this.waitingForBackgroundTasks = false;
            this.settleWithResult();
        }
    }

    private handleSessionError(event: ISessionEvent): void {
        const errorMessage = event.data?.message || 'Unknown session error';
        this.sessionLog.error({ errorMessage }, 'Session error');
        this.settleError(new Error(`Copilot session error: ${errorMessage}`));
    }

    private handleUsage(event: ISessionEvent): void {
        this.telemetry.recordUsage({
            inputTokens:      event.data?.inputTokens,
            outputTokens:     event.data?.outputTokens,
            cacheReadTokens:  event.data?.cacheReadTokens,
            cacheWriteTokens: event.data?.cacheWriteTokens,
            cost:             event.data?.cost,
            duration:         event.data?.duration,
        });
        this.sessionLog.debug(
            { turn: this.telemetry.buildTokenUsage()?.turnCount, inputTokens: event.data?.inputTokens ?? 0, outputTokens: event.data?.outputTokens ?? 0 },
            'Token usage',
        );
    }

    private handleUsageInfo(event: ISessionEvent): void {
        this.telemetry.recordUsageInfo({
            tokenLimit:    event.data?.tokenLimit,
            currentTokens: event.data?.currentTokens,
        });
        const usage = this.telemetry.buildTokenUsage();
        this.sessionLog.debug(
            { tokenLimit: usage?.tokenLimit, currentTokens: usage?.currentTokens },
            'Session usage info',
        );
    }

    private handleToolStart(event: ISessionEvent): void {
        this.timers.resetIdleTimer();
        const truncatedArgs = event.data?.arguments
            ? JSON.stringify(event.data.arguments).substring(0, 200)
            : undefined;
        this.sessionLog.debug({ toolName: event.data?.toolName, toolCallId: event.data?.toolCallId, args: truncatedArgs }, 'Tool execution started');

        const { event: toolEvent } = this.telemetry.recordToolStart({
            toolCallId:       event.data?.toolCallId,
            toolName:         event.data?.toolName,
            parentToolCallId: event.data?.parentToolCallId,
            arguments:        event.data?.arguments,
        });

        if (this.options.onToolEvent) {
            try { this.options.onToolEvent(toolEvent); } catch { /* non-fatal */ }
        }
    }

    private handleToolComplete(event: ISessionEvent): void {
        this.timers.resetIdleTimer();

        const { event: toolEvent, tracked, durationMs } = this.telemetry.recordToolComplete({
            toolCallId:       event.data?.toolCallId,
            success:          event.data?.success,
            result:           event.data?.result,
            error:            event.data?.error,
            parentToolCallId: event.data?.parentToolCallId,
        });

        if (event.data?.success) {
            this.sessionLog.debug(
                { toolName: tracked?.toolName, toolCallId: event.data?.toolCallId, durationMs, resultChars: event.data?.result?.content?.length ?? 0, success: true },
                'Tool execution completed',
            );
        } else {
            this.sessionLog.debug(
                { toolName: tracked?.toolName, toolCallId: event.data?.toolCallId, durationMs, success: false, errorMsg: event.data?.error?.message || '(no error message)' },
                'Tool execution failed',
            );
        }

        if (this.options.onToolEvent) {
            try { this.options.onToolEvent(toolEvent); } catch { /* non-fatal */ }
        }
    }

    private handleToolProgress(event: ISessionEvent): void {
        const toolCallId = event.data?.toolCallId || '(unknown)';
        const tracked    = this.telemetry.activeToolCalls.get(toolCallId);
        this.sessionLog.debug(
            { toolName: tracked?.toolName, toolCallId, progressMessage: event.data?.progressMessage },
            'Tool progress',
        );
        this.telemetry.recordToolProgress(toolCallId, event.data?.progressMessage);
    }
}
