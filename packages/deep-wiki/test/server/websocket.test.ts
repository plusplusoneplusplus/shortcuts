/**
 * Tests for WebSocketServer - live reload communication.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as crypto from 'crypto';
import { Socket } from 'net';
import { WebSocketServer } from '../../src/server/websocket';
import type { WSMessage } from '../../src/server/websocket';

// ============================================================================
// Helpers
// ============================================================================

function createTestServer(): { server: http.Server; getPort: () => number; close: () => Promise<void> } {
    const server = http.createServer();
    let port = 0;

    return {
        server,
        getPort: () => port,
        close: () => new Promise<void>((resolve, reject) => {
            server.close(err => err ? reject(err) : resolve());
        }),
    };
}

async function startServer(server: http.Server): Promise<number> {
    return new Promise((resolve) => {
        server.listen(0, 'localhost', () => {
            const addr = server.address();
            resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
    });
}

/**
 * Create a raw WebSocket connection for testing.
 * Returns helpers to send/receive messages.
 */
function connectWebSocket(port: number, path = '/ws'): Promise<{
    socket: Socket;
    send: (data: string) => void;
    onMessage: (handler: (data: string) => void) => void;
    close: () => void;
    waitForMessage: () => Promise<string>;
}> {
    return new Promise((resolve, reject) => {
        const key = crypto.randomBytes(16).toString('base64');
        const socket = new Socket();
        const messageHandlers: Array<(data: string) => void> = [];
        let connected = false;

        socket.connect(port, 'localhost', () => {
            socket.write(
                `GET ${path} HTTP/1.1\r\n` +
                `Host: localhost:${port}\r\n` +
                `Upgrade: websocket\r\n` +
                `Connection: Upgrade\r\n` +
                `Sec-WebSocket-Key: ${key}\r\n` +
                `Sec-WebSocket-Version: 13\r\n` +
                `\r\n`,
            );
        });

        socket.on('data', (buf) => {
            if (!connected) {
                // Check for 101 response
                const response = buf.toString();
                if (response.includes('101')) {
                    connected = true;
                    resolve({
                        socket,
                        send: (data: string) => {
                            const payload = Buffer.from(data, 'utf-8');
                            const mask = crypto.randomBytes(4);
                            let header: Buffer;

                            if (payload.length < 126) {
                                header = Buffer.alloc(6);
                                header[0] = 0x81;
                                header[1] = 0x80 | payload.length;
                                mask.copy(header, 2);
                            } else {
                                header = Buffer.alloc(8);
                                header[0] = 0x81;
                                header[1] = 0x80 | 126;
                                header.writeUInt16BE(payload.length, 2);
                                mask.copy(header, 4);
                            }

                            const masked = Buffer.alloc(payload.length);
                            for (let i = 0; i < payload.length; i++) {
                                masked[i] = payload[i] ^ mask[i % 4];
                            }

                            socket.write(Buffer.concat([header, masked]));
                        },
                        onMessage: (handler) => messageHandlers.push(handler),
                        close: () => socket.end(),
                        waitForMessage: () => new Promise<string>((res) => {
                            messageHandlers.push(res);
                        }),
                    });
                }
                return;
            }

            // Decode frame
            if (buf.length < 2) return;
            const opcode = buf[0] & 0x0f;
            if (opcode !== 1) return;

            let payloadLen = buf[1] & 0x7f;
            let offset = 2;
            if (payloadLen === 126) {
                payloadLen = buf.readUInt16BE(2);
                offset = 4;
            }

            const data = buf.slice(offset, offset + payloadLen).toString('utf-8');
            for (const handler of messageHandlers) {
                handler(data);
            }
        });

        socket.on('error', reject);

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
        // Give sockets time to close before shutting down the server
        await new Promise(resolve => setTimeout(resolve, 100));
        await new Promise<void>((resolve) => {
            httpServer.close(() => resolve());
        });
    });

    it('should accept WebSocket connections', async () => {
        const ws = await connectWebSocket(port);
        expect(wsServer.clientCount).toBe(1);
        ws.close();
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

        wsServer.broadcast({ type: 'reload', modules: ['auth'] });

        const msg1 = await msg1Promise;
        const msg2 = await msg2Promise;

        expect(JSON.parse(msg1)).toEqual({ type: 'reload', modules: ['auth'] });
        expect(JSON.parse(msg2)).toEqual({ type: 'reload', modules: ['auth'] });

        ws1.close();
        ws2.close();
    });

    it('should handle incoming messages', async () => {
        const messageHandler = vi.fn();
        wsServer.onMessage(messageHandler);

        const ws = await connectWebSocket(port);
        ws.send(JSON.stringify({ type: 'ping' }));

        // Wait for message to be received
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(messageHandler).toHaveBeenCalledWith(
            expect.objectContaining({ send: expect.any(Function) }),
            { type: 'ping' },
        );

        ws.close();
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
        const ws = await connectWebSocket(port);
        const msgPromise = ws.waitForMessage();

        wsServer.broadcast({ type: 'rebuilding', modules: ['api', 'config'] });

        const msg = await msgPromise;
        const parsed = JSON.parse(msg);
        expect(parsed.type).toBe('rebuilding');
        expect(parsed.modules).toEqual(['api', 'config']);

        ws.close();
    });

    it('should broadcast error messages', async () => {
        const ws = await connectWebSocket(port);
        const msgPromise = ws.waitForMessage();

        wsServer.broadcast({ type: 'error', message: 'Build failed' });

        const msg = await msgPromise;
        const parsed = JSON.parse(msg);
        expect(parsed.type).toBe('error');
        expect(parsed.message).toBe('Build failed');

        ws.close();
    });
});
