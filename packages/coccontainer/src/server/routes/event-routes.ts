/**
 * SSE events stream: `/api/events`. Relays aggregated agent events to browser
 * clients as `data:` frames, unsubscribing when the client disconnects.
 */

import type { SSEEvent } from '../../proxy/sse-relay';
import type { ContainerRuntime } from '../runtime';
import type { RouteTable } from '../http-util';

export function installEventRoutes(table: RouteTable, runtime: ContainerRuntime): void {
    const { sseRelay } = runtime;

    table.when((_method, url) => url.pathname === '/api/events', ({ req, res }) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write(':ok\n\n');

        const onEvent = (event: SSEEvent) => {
            const envelope = JSON.stringify({
                agentId: event.agentId,
                agentName: event.agentName,
                payload: event.data,
            });
            if (event.event) {
                res.write(`event: ${event.event}\n`);
            }
            res.write(`data: ${envelope}\n\n`);
        };

        sseRelay.on('event', onEvent);
        req.on('close', () => sseRelay.off('event', onEvent));
    });
}
