/**
 * Tests for ContainerLinkClient — URL building and lifecycle.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContainerLinkClient } from '../../../src/server/container-link/container-client';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

// Access private buildWsUrl via prototype trick for unit testing
function buildWsUrl(containerUrl: string): string {
    const client = new ContainerLinkClient({ containerUrl, localPort: 4000 });
    // Access private method
    return (client as any).buildWsUrl();
}

describe('ContainerLinkClient', () => {
    it('forwards complete SSE frames with subscription IDs across split UTF-8 reads', async () => {
        let response!: ServerResponse;
        const server = createServer((_req, res) => {
            response = res;
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(':ok\n\ndata: ready\n\n');
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const client = new ContainerLinkClient({ containerUrl: 'http://localhost', localPort: (server.address() as AddressInfo).port });
        const forward = vi.spyOn(client, 'forwardSSEEvent').mockImplementation(() => {});
        try {
            (client as any).handleSubscribeSSE({ subscriptionId: 'repo-a/chat', path: '/stream' });
            await vi.waitFor(() => expect(forward).toHaveBeenCalledWith('repo-a/chat', undefined, 'ready', undefined));
            const bytes = Buffer.from('event: chunk\r\nid: 2\r\ndata: {"content":\r\ndata: "你好 😀"}  \r\n\r\ndata:\r\n\r\ndata: partial');
            const split = bytes.indexOf(Buffer.from('😀')) + 1;
            response.write(bytes.subarray(0, split));
            await new Promise<void>(resolve => setImmediate(resolve));
            response.end(bytes.subarray(split));
            await vi.waitFor(() => expect((client as any).sseSubscriptions.size).toBe(0));
            expect(forward.mock.calls).toEqual([
                ['repo-a/chat', undefined, 'ready', undefined],
                ['repo-a/chat', 'chunk', '{"content":\n"你好 😀"}  ', '2'],
                ['repo-a/chat', undefined, '', undefined],
            ]);
        } finally {
            client.stop();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
            forward.mockRestore();
        }
    });

    describe('buildWsUrl', () => {
        it('should convert http:// to ws:// and append path', () => {
            expect(buildWsUrl('http://localhost:5000')).toBe('ws://localhost:5000/ws/agent-link');
        });

        it('should convert https:// to wss:// and append path', () => {
            expect(buildWsUrl('https://container.example.com')).toBe('wss://container.example.com/ws/agent-link');
        });

        it('should auto-prepend ws:// when no protocol is provided', () => {
            expect(buildWsUrl('localhost:5000')).toBe('ws://localhost:5000/ws/agent-link');
        });

        it('should auto-prepend ws:// for bare hostname', () => {
            expect(buildWsUrl('myhost')).toBe('ws://myhost/ws/agent-link');
        });

        it('should auto-prepend ws:// for IP:port', () => {
            expect(buildWsUrl('192.168.1.10:5000')).toBe('ws://192.168.1.10:5000/ws/agent-link');
        });

        it('should strip trailing slash before building URL', () => {
            expect(buildWsUrl('http://localhost:5000/')).toBe('ws://localhost:5000/ws/agent-link');
        });

        it('should use URL as-is if it already contains /ws/agent-link', () => {
            expect(buildWsUrl('ws://custom:9000/ws/agent-link')).toBe('ws://custom:9000/ws/agent-link');
        });

        it('should preserve wss:// protocol', () => {
            expect(buildWsUrl('wss://secure.host:443')).toBe('wss://secure.host:443/ws/agent-link');
        });

        it('should handle HTTP with uppercase', () => {
            expect(buildWsUrl('HTTP://localhost:5000')).toBe('ws://localhost:5000/ws/agent-link');
        });
    });
});
