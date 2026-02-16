/**
 * Tests for WebSocketServer - live reload communication.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import WS from 'ws';
import { WebSocketServer } from '../../../src/server/wiki/websocket';
import type { WSMessage } from '../../../src/server/wiki/websocket';

// ============================================================================
// Helpers
// ============================================================================

async function startServer(server: http.Server): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, 'localhost', () => {
            const addr = server.address();
            resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
    });
}

/**
 * Create a WebSocket connection using the `ws` library.
 */
function connectWebSocket(port: number, path = '/ws'): Promise<{
    ws: WS;
    send: (data: string) => void;
    close: () => void;
    waitForMessage: () => Promise<string>;
}> {
    return new Promise((resolve, reject) => {
        const ws = new WS(`ws://localhost:${port}${path}`);

        ws.on('open', () => {
            resolve({
                ws,
                send: (data: string) => ws.send(data),
                close: () => ws.close(),
                waitForMessage: () => new Promise<string>((res) => {
                    ws.once('message', (raw) => res(raw.toString()));
                }),
            });
        });

        ws.on('error', reject);

        setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('WebSocketServer', () => {
    let httpServer: http.Server;
    let wsServer: WebSocketServer;
    let port: number;

    beforeEach(async () => {
        httpServer = http.createServer();
        wsServer = new WebSocketServer();
        wsServer.attach(httpServer);
        port = await startServer(httpServer);
    });

    afterEach(async () => {
        wsServer.closeAll();
        await new Promise(resolve => setTimeout(resolve, 100));
        await new Promise<void>((resolve) => {
            httpServer.close(() => resolve());
        });
    });

    it('should accept WebSocket connections', async () => {
        const client = await connectWebSocket(port);
        expect(wsServer.clientCount).toBe(1);
        client.close();
    });

    it('should reject non-/ws upgrade requests', async () => {
        await expect(connectWebSocket(port, '/other')).rejects.toThrow();
    });

    it('should broadcast messages to all clients', async () => {
        const ws1 = await connectWebSocket(port);
        const ws2 = await connectWebSocket(port);

        expect(wsServer.clientCount).toBe(2);

        const msg1Promise = ws1.waitForMessage();
        const msg2Promise = ws2.waitForMessage();

        wsServer.broadcast({ type: 'reload', components: ['auth'] });

        const msg1 = await msg1Promise;
        const msg2 = await msg2Promise;

        expect(JSON.parse(msg1)).toEqual({ type: 'reload', components: ['auth'] });
        expect(JSON.parse(msg2)).toEqual({ type: 'reload', components: ['auth'] });

        ws1.close();
        ws2.close();
    });

    it('should handle incoming messages', async () => {
        const messageHandler = vi.fn();
        wsServer.onMessage(messageHandler);

        const client = await connectWebSocket(port);
        client.send(JSON.stringify({ type: 'ping' }));

        // Wait for message to be received
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(messageHandler).toHaveBeenCalledWith(
            expect.objectContaining({ send: expect.any(Function) }),
            { type: 'ping' },
        );

        client.close();
    });

    it('should track client count on connect', async () => {
        expect(wsServer.clientCount).toBe(0);

        const ws1 = await connectWebSocket(port);
        expect(wsServer.clientCount).toBe(1);

        const ws2 = await connectWebSocket(port);
        expect(wsServer.clientCount).toBe(2);

        // closeAll should drop both
        wsServer.closeAll();
        expect(wsServer.clientCount).toBe(0);
    });

    it('should close all clients', async () => {
        const ws1 = await connectWebSocket(port);
        const ws2 = await connectWebSocket(port);

        expect(wsServer.clientCount).toBe(2);

        wsServer.closeAll();

        await new Promise(resolve => setTimeout(resolve, 100));
        expect(wsServer.clientCount).toBe(0);
    });

    it('should broadcast rebuilding messages', async () => {
        const client = await connectWebSocket(port);
        const msgPromise = client.waitForMessage();

        wsServer.broadcast({ type: 'rebuilding', components: ['api', 'config'] });

        const msg = await msgPromise;
        const parsed = JSON.parse(msg);
        expect(parsed.type).toBe('rebuilding');
        expect(parsed.components).toEqual(['api', 'config']);

        client.close();
    });

    it('should broadcast error messages', async () => {
        const client = await connectWebSocket(port);
        const msgPromise = client.waitForMessage();

        wsServer.broadcast({ type: 'error', message: 'Build failed' });

        const msg = await msgPromise;
        const parsed = JSON.parse(msg);
        expect(parsed.type).toBe('error');
        expect(parsed.message).toBe('Build failed');

        client.close();
    });

    it('should remove client from set on disconnect', async () => {
        const client = await connectWebSocket(port);
        expect(wsServer.clientCount).toBe(1);

        client.close();
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(wsServer.clientCount).toBe(0);
    });

    it('should not send to closed client during broadcast', async () => {
        const ws1 = await connectWebSocket(port);
        const ws2 = await connectWebSocket(port);

        // Close ws1 from server side
        wsServer.closeAll();
        expect(wsServer.clientCount).toBe(0);

        // Broadcast after close should not throw
        expect(() => wsServer.broadcast({ type: 'reload', components: [] })).not.toThrow();
    });
});
