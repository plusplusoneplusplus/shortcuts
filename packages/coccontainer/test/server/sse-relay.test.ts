import { describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { SSERelay, type SSEEvent } from '../../src/proxy/sse-relay';
import { installEventRoutes } from '../../src/server/routes/event-routes';
import { RouteTable } from '../../src/server/http-util';
import type { ContainerRuntime } from '../../src/server/runtime';

describe('SSE relay', () => {
    it('preserves JSON bytes through parsing and the browser envelope for named and unnamed events', async () => {
        const relay = new SSERelay();
        const table = new RouteTable();
        installEventRoutes(table, { sseRelay: relay } as ContainerRuntime);
        const browserServer = createServer((req, res) => {
            void table.dispatch({ req, res, url: new URL(req.url!, 'http://localhost'), method: 'GET' });
        });
        const agentServer = createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.end('event: chunk\nid: 7\ndata: {"content":"hello"}\n\ndata: {"type":"done"}\n\n');
        });
        const controller = new AbortController();
        try {
            browserServer.listen(0, '127.0.0.1');
            agentServer.listen(0, '127.0.0.1');
            await Promise.all([once(browserServer, 'listening'), once(agentServer, 'listening')]);
            const response = await fetch(`http://127.0.0.1:${(browserServer.address() as AddressInfo).port}/api/events`, { signal: controller.signal });
            expect(response.headers.get('x-accel-buffering')).toBe('no');
            const reader = response.body!.getReader();
            const received: SSEEvent[] = [];
            relay.on('event', event => received.push(event));
            const disconnected = once(relay, 'disconnected');
            relay.connect('a', 'Agent A', `http://127.0.0.1:${(agentServer.address() as AddressInfo).port}`);
            await disconnected;
            expect(received).toEqual([
                { agentId: 'a', agentName: 'Agent A', event: 'chunk', id: '7', data: '{"content":"hello"}' },
                { agentId: 'a', agentName: 'Agent A', event: undefined, id: undefined, data: '{"type":"done"}' },
            ]);
            const expected = ':ok\n\n'
                + 'event: chunk\ndata: {"agentId":"a","agentName":"Agent A","payload":"{\\"content\\":\\"hello\\"}"}\n\n'
                + 'data: {"agentId":"a","agentName":"Agent A","payload":"{\\"type\\":\\"done\\"}"}\n\n';
            let raw = '';
            while (raw.length < expected.length) {
                const { value, done } = await reader.read();
                if (done) break;
                raw += new TextDecoder().decode(value);
            }
            expect(raw).toBe(expected);
            await reader.cancel();
            reader.releaseLock();
            await vi.waitFor(() => expect(relay.listenerCount('event')).toBe(1));
        } finally {
            controller.abort();
            relay.disconnectAll();
            browserServer.closeAllConnections();
            agentServer.closeAllConnections();
            await Promise.all([new Promise<void>(resolve => browserServer.close(() => resolve())), new Promise<void>(resolve => agentServer.close(() => resolve()))]);
        }
    });

    it('retains partial frames and split UTF-8, including trailing whitespace and empty data', async () => {
        let response!: ServerResponse;
        const server = createServer((_req, res) => {
            response = res;
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write('data: ready\n\n');
        });
        const relay = new SSERelay();
        const received: SSEEvent[] = [];
        relay.on('event', event => received.push(event));
        try {
            server.listen(0, '127.0.0.1');
            await once(server, 'listening');
            const ready = once(relay, 'event');
            relay.connect('a', 'Agent A', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
            await ready;
            const bytes = Buffer.from('data: {"content":"😀"}  \r\n\r\ndata:\r\n\r\ndata: incomplete');
            const split = bytes.indexOf(Buffer.from('😀')) + 1;
            response.write(bytes.subarray(0, split));
            // A later event-loop turn forces the partial character through a read.
            await new Promise<void>(resolve => setImmediate(resolve));
            const disconnected = once(relay, 'disconnected');
            response.end(bytes.subarray(split));
            await disconnected;
            expect(received.map(event => event.data)).toEqual(['ready', '{"content":"😀"}  ', '']);
        } finally {
            relay.disconnectAll();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
