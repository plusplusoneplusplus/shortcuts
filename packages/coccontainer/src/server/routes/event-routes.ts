/**
 * SSE events stream: `/api/events`. Relays aggregated agent events to browser
 * clients as `data:` frames, unsubscribing when the client disconnects.
 */

import { writeSseHeaders, writeNamedEvent, writeDataEvent } from '@plusplusoneplusplus/forge/sse';
import type { SSEEvent } from '../../proxy/sse-relay';
import type { ContainerRuntime } from '../runtime';
import type { RouteTable } from '../http-util';

export function installEventRoutes(table: RouteTable, runtime: ContainerRuntime): void {
    const { sseRelay } = runtime;

    table.when((_method, url) => url.pathname === '/api/events', ({ req, res }) => {
        writeSseHeaders(res);
        res.write(':ok\n\n');

        const onEvent = (event: SSEEvent) => {
            const envelope = {
                agentId: event.agentId,
                agentName: event.agentName,
                payload: event.data,
            };
            if (event.event) {
                writeNamedEvent(res, event.event, envelope);
            } else {
                writeDataEvent(res, envelope);
            }
        };

        sseRelay.on('event', onEvent);
        req.on('close', () => sseRelay.off('event', onEvent));
    });
}
