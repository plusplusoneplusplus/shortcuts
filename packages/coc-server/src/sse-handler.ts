/**
 * SSE Stream Handler
 *
 * Server-Sent Events endpoint for real-time process output streaming.
 * Clients connect to `GET /api/processes/:id/stream` to receive output chunks
 * as they arrive, followed by a status + done event on completion.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { AIProcess } from '@plusplusoneplusplus/pipeline-core';

/**
 * Handle SSE streaming for a single process.
 *
 * Protocol:
 *   event: conversation-snapshot → { turns: ConversationTurn[] }
 *   event: chunk              → { content: string }
 *   event: tool-start         → { turnIndex, toolCallId, parentToolCallId?, toolName, parameters }
 *   event: tool-complete      → { turnIndex, toolCallId, parentToolCallId?, result }
 *   event: tool-failed        → { turnIndex, toolCallId, parentToolCallId?, error }
 *   event: permission-request → { turnIndex, permissionId, kind, description }
 *   event: workflow-phase    → { phase, status, timestamp, durationMs?, error?, itemCount? }
 *   event: workflow-progress → { phase, totalItems, completedItems, failedItems, percentage, message? }
 *   event: item-process     → { itemIndex, processId, status, phase, itemLabel?, error? }
 *   event: suggestions       → { suggestions: string[], turnIndex: number }
 *   event: status             → { status, result?, error?, duration? }
 *   event: done               → { processId }
 *   event: heartbeat          → {}
 */
export async function handleProcessStream(
    req: IncomingMessage,
    res: ServerResponse,
    processId: string,
    store: ProcessStore
): Promise<void> {
    // 1. Look up the process — 404 if not found
    let process = await store.getProcess(processId);
    if (!process) {
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

    // 3. For running processes, flush buffered content before replay
    if ((process.status === 'running') && store.requestFlush) {
        await store.requestFlush(processId);
        const refreshed = await store.getProcess(processId);
        if (refreshed) { process = refreshed; }
    }

    // 4. Replay persisted conversation history as a structured snapshot
    replayConversationTurns(res, process);

    // 5. If already completed/failed/cancelled, send final status + close
    if (process.status !== 'running' && process.status !== 'queued') {
        sendEvent(res, 'status', {
            status: process.status,
            result: process.result,
            error: process.error,
        });
        sendEvent(res, 'done', { processId });
        res.end();
        return;
    }

    // 6. Subscribe to output chunks via store.onProcessOutput
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) { return; }
        cleaned = true;
        clearInterval(heartbeat);
        unsubscribe();
    };

    const unsubscribe = store.onProcessOutput(processId, (event) => {
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
                result: event.result,
            });
        } else if (event.type === 'tool-failed') {
            sendEvent(res, 'tool-failed', {
                turnIndex: event.turnIndex,
                toolCallId: event.toolCallId,
                parentToolCallId: event.parentToolCallId,
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

    // 7. Heartbeat to detect stale connections (every 15s)
    const heartbeat = setInterval(() => {
        sendEvent(res, 'heartbeat', {});
    }, 15_000);

    // 8. Cleanup on client disconnect
    req.on('close', cleanup);
}

/** Write a single SSE event frame. */
function sendEvent(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Replay persisted conversation turns as a single structured snapshot event.
 * Sends the full turns array so the client can reconstruct conversation state.
 */
function replayConversationTurns(res: ServerResponse, process: AIProcess): void {
    const turns = process.conversationTurns;
    if (!turns || turns.length === 0) { return; }

    sendEvent(res, 'conversation-snapshot', { turns });
}
