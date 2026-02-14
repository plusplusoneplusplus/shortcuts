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

/**
 * Handle SSE streaming for a single process.
 *
 * Protocol:
 *   event: chunk    → { content: string }
 *   event: status   → { status, result?, error?, duration? }
 *   event: done     → { processId }
 *   event: heartbeat → {}
 */
export async function handleProcessStream(
    req: IncomingMessage,
    res: ServerResponse,
    processId: string,
    store: ProcessStore
): Promise<void> {
    // 1. Look up the process — 404 if not found
    const process = await store.getProcess(processId);
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

    // 3. If already completed/failed/cancelled, send final status + close
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

    // 4. Subscribe to output chunks via store.onProcessOutput
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

    // 5. Heartbeat to detect stale connections (every 15s)
    const heartbeat = setInterval(() => {
        sendEvent(res, 'heartbeat', {});
    }, 15_000);

    // 6. Cleanup on client disconnect
    req.on('close', cleanup);
}

/** Write a single SSE event frame. */
function sendEvent(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
