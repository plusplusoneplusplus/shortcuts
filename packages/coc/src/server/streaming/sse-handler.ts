/**
 * SSE Stream Handler
 *
 * Server-Sent Events endpoint for real-time process output streaming.
 * Clients connect to `GET /api/processes/:id/stream` to receive output chunks
 * as they arrive, followed by a status + done event on completion.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessStore, ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import type { WarmStatus } from '@plusplusoneplusplus/coc-agent-sdk';
import { getServerLogger } from '../logging/server-logger';
import type { RalphGrillPlanningProgress } from '../ralph/grill-planning';
import { warmStatusBridge, type WarmStatusBridge } from './warm-status-bridge';

// ============================================================================
// SSE Event Payload Types
// ============================================================================

/** Fired immediately after the server accepts a follow-up message. */
export interface MessageQueuedPayload {
    /** Zero-based index of this turn in the conversation. */
    turnIndex: number;
    /** The resolved delivery mode (after defaulting). */
    deliveryMode: 'immediate' | 'enqueue';
    /** Position in the follow-up queue (1-based). 0 when deliveryMode === 'immediate'. */
    queuePosition: number;
    /** Client-provided optimistic ID echoed back for reconciliation. */
    optimisticId?: string;
}

/** Fired when an immediate-mode message is actively being injected into a live session. */
export interface MessageSteeringPayload {
    /** Zero-based turn index — matches the turnIndex in the preceding message-queued event. */
    turnIndex: number;
    /** Client-provided optimistic ID echoed back for reconciliation. */
    optimisticId?: string;
}

/** Fired when a pending message is persisted on the process (queued while AI is busy). */
export interface PendingMessageAddedPayload {
    /** The persisted pending message. */
    id: string;
    content: string;
    mode?: string;
    createdAt: string;
}

/** Fired when a canvas linked to this process is created or updated by the AI. */
export interface CanvasUpdatedPayload {
    canvasId: string;
    title: string;
    revision: number;
    editor: 'ai' | 'user';
}

/**
 * Fired on every `WarmClientRegistry` state transition for the conversation's
 * `(provider, processId)` key (AC-01). The SPA maps `status` to its warm indicator:
 * `warm`/`active` → green, `warming` → amber-pulse, `cold` → invisible. Providers
 * that never stay warm (e.g. Claude) never emit, so the indicator stays invisible.
 */
export interface WarmStatusPayload {
    status: WarmStatus;
}

// ============================================================================
// SSE Emitter Helpers
// ============================================================================

/** Emit a `message-queued` event on a process's SSE channel. */
export function emitMessageQueued(store: ProcessStore, processId: string, payload: MessageQueuedPayload): void {
    store.emitProcessEvent(processId, {
        type: 'message-queued',
        turnIndex: payload.turnIndex,
        deliveryMode: payload.deliveryMode,
        queuePosition: payload.queuePosition,
        ...(payload.optimisticId !== undefined ? { optimisticId: payload.optimisticId } : {}),
    } as ProcessOutputEvent);
}

/** Emit a `message-steering` event on a process's SSE channel. */
export function emitMessageSteering(store: ProcessStore, processId: string, payload: MessageSteeringPayload): void {
    store.emitProcessEvent(processId, {
        type: 'message-steering',
        turnIndex: payload.turnIndex,
        ...(payload.optimisticId !== undefined ? { optimisticId: payload.optimisticId } : {}),
    } as ProcessOutputEvent);
}

/** Emit a `pending-message-added` event on a process's SSE channel. */
export function emitPendingMessageAdded(store: ProcessStore, processId: string, payload: PendingMessageAddedPayload): void {
    store.emitProcessEvent(processId, {
        type: 'pending-message-added',
        pendingMessage: {
            id: payload.id,
            content: payload.content,
            mode: payload.mode,
            createdAt: payload.createdAt,
        },
    } as ProcessOutputEvent);
}

/** Emit a `canvas-updated` event on a process's SSE channel. */
export function emitCanvasUpdated(store: ProcessStore, processId: string, payload: CanvasUpdatedPayload): void {
    store.emitProcessEvent(processId, {
        type: 'canvas-updated',
        canvasUpdate: payload,
    } as unknown as ProcessOutputEvent);
}

/**
 * Emit a `warm-status` event on a process's SSE channel. Relayed to the SPA as a
 * `warm_status` SSE event carrying `{ status }` (AC-01). The {@link WarmStatusBridge}
 * is the normal producer; this helper exists for server-internal callers and tests.
 */
export function emitWarmStatus(store: ProcessStore, processId: string, status: WarmStatus): void {
    store.emitProcessEvent(processId, {
        type: 'warm-status',
        warmStatus: status,
    } as unknown as ProcessOutputEvent);
}

/**
 * Handle SSE streaming for a single process.
 *
 * Protocol:
 *   event: conversation-snapshot → { turns: ConversationTurn[], sessionTokenLimit?, sessionCurrentTokens?, sessionSystemTokens?, sessionToolTokens?, sessionConversationTokens? }
 *   event: chunk              → { content: string }
 *   event: tool-start         → { turnIndex, toolCallId, parentToolCallId?, toolName, parameters }
 *   event: tool-complete      → { turnIndex, toolCallId, parentToolCallId?, toolName?, parameters?, result }
 *   event: tool-failed        → { turnIndex, toolCallId, parentToolCallId?, toolName?, parameters?, error }
 *   event: permission-request → { turnIndex, permissionId, kind, description }
 *   event: workflow-phase    → { phase, status, timestamp, durationMs?, error?, itemCount? }
 *   event: workflow-progress → { phase, totalItems, completedItems, failedItems, percentage, message? }
 *   event: item-process     → { itemIndex, processId, status, phase, itemLabel?, error? }
 *   event: suggestions       → { suggestions: string[], turnIndex: number }
 *   event: ask-user          → { questionId, question, type, options?, defaultValue?, turnIndex }
 *   event: token-usage       → { turnIndex, tokenUsage, cumulativeTokenUsage?, conversationCostEstimate?, sessionTokenLimit?, sessionCurrentTokens?, sessionSystemTokens?, sessionToolTokens?, sessionConversationTokens? }
 *   event: background-tasks  → { backgroundAgents, backgroundShells, backgroundTotalActive, backgroundWaitingForDrain }
 *   event: ralph-grill-planning → { status, depth, agentCount, agents, message, warnings }
 *   event: canvas-updated    → { canvasId, title, revision, editor }
 *   event: warm_status       → { status: 'warming' | 'warm' | 'active' | 'cold' }
 *   event: status             → { status, result?, error?, duration? }
 *   event: done               → { processId }
 *   event: heartbeat          → {}
 */
export async function handleProcessStream(
    req: IncomingMessage,
    res: ServerResponse,
    processId: string,
    store: ProcessStore,
    warmBridge: WarmStatusBridge = warmStatusBridge
): Promise<void> {
    // Parse workspaceId hint from the query string for direct-path lookup
    const parsed = new URL(req.url ?? '/', 'http://x');
    const wsId = parsed.searchParams.get('workspace') ?? undefined;
    // Warm-only mode: the SPA opens this lightweight stream purely to receive
    // `warm_status` pushes (AC-02). Unlike the main stream it skips the
    // conversation replay and stays open for completed/failed/cancelled
    // processes — the dominant warm case is typing a follow-up on a finished
    // conversation whose provider client is still parked warm.
    const warmOnly = parsed.searchParams.get('warm') === '1';

    // 1. Look up the process — 404 if not found
    let process = await store.getProcess(processId, wsId);
    if (!process) {
        getServerLogger().warn({ processId }, 'SSE: process not found');
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Process not found' }));
        return;
    }

    // 2. Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    getServerLogger().debug({ processId, warmOnly }, 'SSE stream started');

    if (warmOnly) {
        streamWarmStatusOnly(req, res, processId, process, store, warmBridge);
        return;
    }

    // 3. For running processes, flush buffered content before replay
    if ((process.status === 'running') && store.requestFlush) {
        await store.requestFlush(processId);
        const refreshed = await store.getProcess(processId, wsId);
        if (refreshed) { process = refreshed; }
    }

    // 4. Replay persisted conversation history as a structured snapshot
    replayConversationTurns(res, process);

    // Replay pending ask-user questions whenever the process has them — regardless
    // of status. ChatBaseExecutor finishes its SDK turn with `status='completed'`
    // while an ask is still actionable; the executor is responsible for clearing
    // `pendingAskUser` on answer/skip/cancel, so a non-empty list is the
    // authoritative signal that the user still owes an answer.
    if (process.pendingAskUser && process.pendingAskUser.length > 0) {
        for (const question of process.pendingAskUser) {
            sendEvent(res, 'ask-user', question);
        }
    }

    // 5. If already completed/failed/cancelled, send final status + close
    if (process.status !== 'running' && process.status !== 'queued') {
        sendEvent(res, 'status', {
            status: process.status,
            result: process.result,
            error: process.error,
        });
        sendEvent(res, 'done', { processId });
        res.end();
        getServerLogger().debug({ processId, eventCount: 0 }, 'SSE stream ended');
        return;
    }

    // 6. Subscribe to output chunks via store.onProcessOutput
    let cleaned = false;
    let eventCount = 0;

    // Relay WarmClientRegistry transitions for this conversation process onto
    // this stream as `warm_status` events (AC-01). Interest lives for the life of
    // the stream; providers that never warm (e.g. Claude) simply never fire.
    const unregisterWarm = warmBridge.register({
        store,
        processId,
        provider: resolveProviderId(process.metadata?.provider),
        workingDirectory: process.workingDirectory,
    });

    const cleanup = () => {
        if (cleaned) { return; }
        cleaned = true;
        clearInterval(heartbeat);
        unsubscribe();
        unregisterWarm();
        getServerLogger().debug({ processId, eventCount }, 'SSE stream ended');
    };

    const unsubscribe = store.onProcessOutput(processId, (event) => {
        const eventType = (event as { type: string }).type;
        const ralphGrillPlanning = (event as { ralphGrillPlanning?: RalphGrillPlanningProgress }).ralphGrillPlanning;
        eventCount++;
        if (event.type === 'chunk') {
            sendEvent(res, 'chunk', { content: event.content });
        } else if (event.type === 'tool-start') {
            sendEvent(res, 'tool-start', {
                turnIndex: event.turnIndex,
                toolCallId: event.toolCallId,
                parentToolCallId: event.parentToolCallId,
                toolName: event.toolName,
                parameters: event.parameters,
            });
        } else if (event.type === 'tool-complete') {
            sendEvent(res, 'tool-complete', {
                turnIndex: event.turnIndex,
                toolCallId: event.toolCallId,
                parentToolCallId: event.parentToolCallId,
                toolName: event.toolName,
                parameters: event.parameters,
                result: event.result,
            });
        } else if (event.type === 'tool-failed') {
            sendEvent(res, 'tool-failed', {
                turnIndex: event.turnIndex,
                toolCallId: event.toolCallId,
                parentToolCallId: event.parentToolCallId,
                toolName: event.toolName,
                parameters: event.parameters,
                error: event.error,
            });
        } else if (event.type === 'permission-request') {
            sendEvent(res, 'permission-request', {
                turnIndex: event.turnIndex,
                permissionId: event.permissionId,
                kind: event.kind,
                description: event.description,
            });
        } else if (event.type === 'pipeline-phase') {
            sendEvent(res, 'workflow-phase', event.pipelinePhase);
        } else if (event.type === 'pipeline-progress') {
            sendEvent(res, 'workflow-progress', event.pipelineProgress);
        } else if (event.type === 'item-process') {
            sendEvent(res, 'item-process', event.itemProcess);
        } else if (event.type === 'suggestions') {
            sendEvent(res, 'suggestions', {
                suggestions: event.suggestions,
                turnIndex: event.turnIndex,
            });
        } else if (event.type === 'token-usage') {
            sendEvent(res, 'token-usage', {
                turnIndex: event.turnIndex,
                tokenUsage: event.tokenUsage,
                cumulativeTokenUsage: event.cumulativeTokenUsage,
                conversationCostEstimate: event.conversationCostEstimate,
                sessionTokenLimit: event.sessionTokenLimit,
                sessionCurrentTokens: event.sessionCurrentTokens,
                ...(event.sessionSystemTokens     != null ? { sessionSystemTokens:     event.sessionSystemTokens }     : {}),
                ...(event.sessionToolTokens       != null ? { sessionToolTokens:       event.sessionToolTokens }       : {}),
                ...(event.sessionConversationTokens != null ? { sessionConversationTokens: event.sessionConversationTokens } : {}),
            });
        } else if (event.type === 'message-queued') {
            sendEvent(res, 'message-queued', {
                turnIndex: event.turnIndex,
                deliveryMode: event.deliveryMode,
                queuePosition: event.queuePosition,
                ...(event.optimisticId !== undefined ? { optimisticId: event.optimisticId } : {}),
            });
        } else if (event.type === 'message-steering') {
            sendEvent(res, 'message-steering', {
                turnIndex: event.turnIndex,
                ...(event.optimisticId !== undefined ? { optimisticId: event.optimisticId } : {}),
            });
        } else if (event.type === 'pending-message-added') {
            sendEvent(res, 'pending-message-added', {
                pendingMessage: event.pendingMessage,
            });
        } else if (event.type === 'ask-user' && event.askUser) {
            sendEvent(res, 'ask-user', event.askUser);
        } else if (event.type === 'hook-step') {
            sendEvent(res, 'hook-step', { hookStep: event.hookStep });
        } else if (event.type === 'background-tasks') {
            sendEvent(res, 'background-tasks', {
                backgroundAgents: event.backgroundAgents,
                backgroundShells: event.backgroundShells,
                backgroundTotalActive: event.backgroundTotalActive,
                backgroundWaitingForDrain: event.backgroundWaitingForDrain,
            });
        } else if (event.type === 'mcp-oauth-required' && event.mcpOAuth) {
            sendEvent(res, 'mcp-oauth-required', event.mcpOAuth);
        } else if (event.type === 'mcp-oauth-completed' && event.mcpOAuth) {
            sendEvent(res, 'mcp-oauth-completed', event.mcpOAuth);
        } else if (eventType === 'ralph-grill-planning' && ralphGrillPlanning) {
            sendEvent(res, 'ralph-grill-planning', ralphGrillPlanning);
        } else if (eventType === 'canvas-updated') {
            const canvasUpdate = (event as { canvasUpdate?: CanvasUpdatedPayload }).canvasUpdate;
            if (canvasUpdate) {
                sendEvent(res, 'canvas-updated', canvasUpdate);
            }
        } else if (eventType === 'warm-status') {
            const warmStatus = (event as { warmStatus?: WarmStatus }).warmStatus;
            if (warmStatus) {
                sendEvent(res, 'warm_status', { status: warmStatus } satisfies WarmStatusPayload);
            }
        } else if (event.type === 'complete') {
            sendEvent(res, 'status', {
                status: event.status,
                duration: event.duration,
            });
            sendEvent(res, 'done', { processId });
            cleanup();
            res.end();
        }
    });

    // 7a. Immediate heartbeat signals the client that the stream is ready
    sendEvent(res, 'heartbeat', {});

    // 7b. Periodic heartbeat to detect stale connections (every 15s)
    const heartbeat = setInterval(() => {
        sendEvent(res, 'heartbeat', {});
    }, 15_000);

    // 8. Cleanup on client disconnect
    req.on('close', cleanup);
}

/**
 * Lightweight warm-status-only stream (the `?warm=1` variant of the process
 * stream). It exists so the SPA warm indicator can receive `warm_status` pushes
 * even when the conversation is not running (AC-02): unlike {@link
 * handleProcessStream} it sends no conversation snapshot, relays nothing but
 * `warm-status` events, and never self-closes on a terminal process status — it
 * stays open until the client disconnects. Heartbeats keep the connection alive
 * and let the client detect a stale socket.
 */
function streamWarmStatusOnly(
    req: IncomingMessage,
    res: ServerResponse,
    processId: string,
    process: AIProcess,
    store: ProcessStore,
    warmBridge: WarmStatusBridge,
): void {
    let cleaned = false;
    const provider = resolveProviderId(process.metadata?.provider);
    const workingDirectory = process.workingDirectory;

    const sendWarmStatus = (status: WarmStatus) => {
        sendEvent(res, 'warm_status', { status } satisfies WarmStatusPayload);
    };

    // Order matters (closes two gaps):
    //   1. Subscribe to process output FIRST, so a transition emitted between the
    //      bridge registration and now cannot slip past an unattached listener.
    //   2. Register bridge interest, then read the current registry status and
    //      send it as an initial snapshot. If the client warmed before the
    //      browser subscribed, this snapshot delivers that state immediately
    //      instead of waiting for the next transition (AC-02).
    // A transition racing the snapshot can produce a duplicate frame (e.g. `warm`
    // twice); the SPA hook assigns status idempotently, so duplicates are benign.
    const unsubscribe = store.onProcessOutput(processId, (event) => {
        if ((event as { type: string }).type !== 'warm-status') { return; }
        const warmStatus = (event as { warmStatus?: WarmStatus }).warmStatus;
        if (warmStatus) {
            sendWarmStatus(warmStatus);
        }
    });

    const unregisterWarm = warmBridge.register({ store, processId, provider, workingDirectory });

    const cleanup = () => {
        if (cleaned) { return; }
        cleaned = true;
        clearInterval(heartbeat);
        unsubscribe();
        unregisterWarm();
        getServerLogger().debug({ processId }, 'SSE warm stream ended');
    };

    // Initial snapshot of the current warm status. `cold` is sent too — it is a
    // valid, useful state after reconnects, unsupported providers, TTL expiry, or
    // a server restart, and the SPA hook accepts it.
    sendWarmStatus(warmBridge.getCurrentStatus(provider, processId, workingDirectory));

    // Immediate heartbeat signals the client the stream is ready; periodic
    // heartbeats keep the connection alive and detect stale sockets.
    sendEvent(res, 'heartbeat', {});
    const heartbeat = setInterval(() => {
        sendEvent(res, 'heartbeat', {});
    }, 15_000);

    req.on('close', cleanup);
}

/** Write a single SSE event frame. */
function sendEvent(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Normalize a process's `metadata.provider` to the warm-key provider id. Mirrors
 * the prewarm route: unknown/absent providers default to `copilot` so the warm
 * key matches the SDK service that owns the registry for that conversation.
 */
function resolveProviderId(provider: unknown): string {
    return provider === 'codex' || provider === 'claude' || provider === 'copilot'
        ? provider
        : 'copilot';
}

/**
 * Replay persisted conversation turns as a single structured snapshot event.
 * Sends the full turns array so the client can reconstruct conversation state.
 * Also includes session-level token tracking data when available.
 */
function replayConversationTurns(res: ServerResponse, process: AIProcess): void {
    const turns = process.conversationTurns;
    if (!turns || turns.length === 0) { return; }

    sendEvent(res, 'conversation-snapshot', {
        turns,
        sessionTokenLimit: process.tokenLimit,
        sessionCurrentTokens: process.currentTokens,
        ...(process.systemTokens != null ? { sessionSystemTokens: process.systemTokens } : {}),
        ...(process.toolDefinitionsTokens != null ? { sessionToolTokens: process.toolDefinitionsTokens } : {}),
        ...(process.conversationTokens != null ? { sessionConversationTokens: process.conversationTokens } : {}),
    });
}
