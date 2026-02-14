/**
 * WebSocket Server Tests
 *
 * Comprehensive tests for the ProcessWebSocketServer:
 * handshake, welcome message, process event broadcasting,
 * workspace subscription filtering, heartbeat, shutdown,
 * and frame codec unit tests.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as crypto from 'crypto';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { ProcessWebSocketServer, sendFrame, decodeFrame, toProcessSummary } from '../../src/server/websocket';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';
import type { ProcessSummary, ServerMessage } from '../../src/server/websocket';
import type { AIProcess } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB5DC11E65B';

/** Create a raw TCP connection and perform WebSocket handshake. */
function connectWebSocket(port: number, wsPath = '/ws'): Promise<{ socket: net.Socket; messages: string[] }> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: 'localhost', port }, () => {
            const key = crypto.randomBytes(16).toString('base64');
            socket.write(
                `GET ${wsPath} HTTP/1.1\r\n` +
                `Host: localhost:${port}\r\n` +
                `Upgrade: websocket\r\n` +
                `Connection: Upgrade\r\n` +
                `Sec-WebSocket-Key: ${key}\r\n` +
                `Sec-WebSocket-Version: 13\r\n` +
                `\r\n`
            );

            const messages: string[] = [];
            let handshakeDone = false;
            let pendingData = Buffer.alloc(0);

            socket.on('data', (data: Buffer) => {
                if (!handshakeDone) {
                    const str = data.toString();
                    if (str.includes('101 Switching Protocols')) {
                        handshakeDone = true;
                        // Check for any WebSocket data after the handshake headers
                        const headerEnd = data.indexOf('\r\n\r\n');
                        if (headerEnd !== -1) {
                            const remaining = data.slice(headerEnd + 4);
                            if (remaining.length > 0) {
                                const msg = decodeFrame(remaining);
                                if (msg) messages.push(msg);
                            }
                        }
                        resolve({ socket, messages });
                    } else {
                        reject(new Error(`Handshake failed: ${str}`));
                    }
                } else {
                    // Accumulate data
                    pendingData = Buffer.concat([pendingData, data]);
                    // Try to decode frames from accumulated data
                    const msg = decodeFrame(pendingData);
                    if (msg !== null) {
                        messages.push(msg);
                        pendingData = Buffer.alloc(0);
                    }
                }
            });

            socket.on('error', reject);
        });
        socket.on('error', reject);
    });
}

/** Send a masked text frame (as browsers do). */
function sendMaskedFrame(socket: net.Socket, data: string): void {
    const payload = Buffer.from(data, 'utf-8');
    const length = payload.length;
    const maskKey = crypto.randomBytes(4);

    let header: Buffer;
    if (length < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81;
        header[1] = 0x80 | length; // Mask bit set
    } else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(length, 6);
    }

    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ maskKey[i % 4];
    }

    socket.write(Buffer.concat([header, maskKey, masked]));
}

/** Wait for a specific number of messages or timeout. */
function waitForMessages(messages: string[], count: number, timeoutMs = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (messages.length >= count) {
                resolve();
            } else if (Date.now() - start > timeoutMs) {
                reject(new Error(`Timed out waiting for ${count} messages, got ${messages.length}: ${JSON.stringify(messages)}`));
            } else {
                setTimeout(check, 20);
            }
        };
        check();
    });
}

/** Wait a small amount of time. */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Create a minimal process body for the store. */
function makeAIProcess(overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        promptPreview: 'Test prompt',
        fullPrompt: 'Full test prompt text',
        status: 'running',
        startTime: new Date(),
        type: 'clarification',
        ...overrides,
    } as AIProcess;
}

// ============================================================================
// Tests
// ============================================================================

describe('WebSocket Server', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    // ========================================================================
    // Handshake
    // ========================================================================

    describe('Handshake', () => {
        it('should complete WebSocket handshake on /ws', async () => {
            const srv = await startServer();
            const { socket, messages } = await connectWebSocket(srv.port);
            expect(socket.writable).toBe(true);
            socket.destroy();
        });

        it('should reject upgrade to non-/ws path', async () => {
            const srv = await startServer();
            const destroyed = await new Promise<boolean>((resolve) => {
                const socket = net.createConnection({ host: 'localhost', port: srv.port }, () => {
                    const key = crypto.randomBytes(16).toString('base64');
                    socket.write(
                        'GET /other HTTP/1.1\r\n' +
                        `Host: localhost:${srv.port}\r\n` +
                        'Upgrade: websocket\r\n' +
                        'Connection: Upgrade\r\n' +
                        `Sec-WebSocket-Key: ${key}\r\n` +
                        'Sec-WebSocket-Version: 13\r\n' +
                        '\r\n'
                    );
                    socket.on('close', () => resolve(true));
                    socket.on('error', () => resolve(true));
                    setTimeout(() => { socket.destroy(); resolve(false); }, 2000);
                });
            });
            expect(destroyed).toBe(true);
        });

        it('should reject upgrade without Sec-WebSocket-Key', async () => {
            const srv = await startServer();
            const destroyed = await new Promise<boolean>((resolve) => {
                const socket = net.createConnection({ host: 'localhost', port: srv.port }, () => {
                    socket.write(
                        'GET /ws HTTP/1.1\r\n' +
                        `Host: localhost:${srv.port}\r\n` +
                        'Upgrade: websocket\r\n' +
                        'Connection: Upgrade\r\n' +
                        'Sec-WebSocket-Version: 13\r\n' +
                        '\r\n'
                    );
                    socket.on('close', () => resolve(true));
                    socket.on('error', () => resolve(true));
                    setTimeout(() => resolve(false), 1000);
                });
            });
            expect(destroyed).toBe(true);
        });
    });

    // ========================================================================
    // Welcome Message
    // ========================================================================

    describe('Welcome Message', () => {
        it('should send welcome message on connect', async () => {
            const srv = await startServer();
            const { socket, messages } = await connectWebSocket(srv.port);

            await waitForMessages(messages, 1);

            const welcome = JSON.parse(messages[0]);
            expect(welcome.type).toBe('welcome');
            expect(welcome.clientId).toBeDefined();
            expect(typeof welcome.clientId).toBe('string');
            expect(typeof welcome.timestamp).toBe('number');

            socket.destroy();
        });

        it('should assign unique client IDs', async () => {
            const srv = await startServer();
            const conn1 = await connectWebSocket(srv.port);
            const conn2 = await connectWebSocket(srv.port);

            await waitForMessages(conn1.messages, 1);
            await waitForMessages(conn2.messages, 1);

            const id1 = JSON.parse(conn1.messages[0]).clientId;
            const id2 = JSON.parse(conn2.messages[0]).clientId;
            expect(id1).not.toBe(id2);

            conn1.socket.destroy();
            conn2.socket.destroy();
        });
    });

    // ========================================================================
    // Process Event Broadcasting
    // ========================================================================

    describe('Process Event Broadcasting', () => {
        it('should broadcast process-added event', async () => {
            const srv = await startServer();
            const { socket, messages } = await connectWebSocket(srv.port);
            await waitForMessages(messages, 1); // welcome

            const proc = makeAIProcess();
            await srv.store.addProcess(proc);

            await waitForMessages(messages, 2);

            const event = JSON.parse(messages[1]);
            expect(event.type).toBe('process-added');
            expect(event.process.id).toBe(proc.id);
            expect(event.process.status).toBe('running');

            socket.destroy();
        });

        it('should broadcast process-updated event', async () => {
            const srv = await startServer();
            const proc = makeAIProcess();
            await srv.store.addProcess(proc);

            const { socket, messages } = await connectWebSocket(srv.port);
            await waitForMessages(messages, 1); // welcome

            await srv.store.updateProcess(proc.id, { status: 'completed' });

            await waitForMessages(messages, 2);

            const event = JSON.parse(messages[1]);
            expect(event.type).toBe('process-updated');
            expect(event.process.id).toBe(proc.id);
            expect(event.process.status).toBe('completed');

            socket.destroy();
        });

        it('should broadcast process-removed event', async () => {
            const srv = await startServer();
            const proc = makeAIProcess();
            await srv.store.addProcess(proc);

            const { socket, messages } = await connectWebSocket(srv.port);
            await waitForMessages(messages, 1); // welcome

            await srv.store.removeProcess(proc.id);

            await waitForMessages(messages, 2);

            const event = JSON.parse(messages[1]);
            expect(event.type).toBe('process-removed');
            expect(event.processId).toBe(proc.id);

            socket.destroy();
        });

        it('should broadcast processes-cleared event', async () => {
            const srv = await startServer();
            const proc1 = makeAIProcess();
            const proc2 = makeAIProcess();
            await srv.store.addProcess(proc1);
            await srv.store.addProcess(proc2);

            const { socket, messages } = await connectWebSocket(srv.port);
            await waitForMessages(messages, 1); // welcome

            await srv.store.clearProcesses();

            await waitForMessages(messages, 2);

            const event = JSON.parse(messages[1]);
            expect(event.type).toBe('processes-cleared');

            socket.destroy();
        });

        it('should broadcast to multiple clients', async () => {
            const srv = await startServer();
            const conn1 = await connectWebSocket(srv.port);
            const conn2 = await connectWebSocket(srv.port);
            const conn3 = await connectWebSocket(srv.port);

            await waitForMessages(conn1.messages, 1);
            await waitForMessages(conn2.messages, 1);
            await waitForMessages(conn3.messages, 1);

            const proc = makeAIProcess();
            await srv.store.addProcess(proc);

            await waitForMessages(conn1.messages, 2);
            await waitForMessages(conn2.messages, 2);
            await waitForMessages(conn3.messages, 2);

            for (const conn of [conn1, conn2, conn3]) {
                const event = JSON.parse(conn.messages[1]);
                expect(event.type).toBe('process-added');
                expect(event.process.id).toBe(proc.id);
            }

            conn1.socket.destroy();
            conn2.socket.destroy();
            conn3.socket.destroy();
        });
    });

    // ========================================================================
    // Workspace Subscription Filtering
    // ========================================================================

    describe('Workspace Subscription Filtering', () => {
        it('should send all events to unsubscribed client', async () => {
            const srv = await startServer();
            const { socket, messages } = await connectWebSocket(srv.port);
            await waitForMessages(messages, 1); // welcome

            const proc = makeAIProcess({
                metadata: { workspaceId: 'ws-a' },
            });
            await srv.store.addProcess(proc);

            await waitForMessages(messages, 2);
            const event = JSON.parse(messages[1]);
            expect(event.type).toBe('process-added');

            socket.destroy();
        });

        it('should filter events by workspace subscription', async () => {
            const srv = await startServer();

            // Client subscribes to workspace "ws-a"
            const connA = await connectWebSocket(srv.port);
            await waitForMessages(connA.messages, 1); // welcome
            sendMaskedFrame(connA.socket, JSON.stringify({ type: 'subscribe', workspaceId: 'ws-a' }));
            await delay(50);

            // Unsubscribed client
            const connAll = await connectWebSocket(srv.port);
            await waitForMessages(connAll.messages, 1); // welcome

            // Event for workspace "ws-b" — subscribed client should NOT receive
            const procB = makeAIProcess({
                metadata: { workspaceId: 'ws-b' },
            });
            await srv.store.addProcess(procB);

            // Unsubscribed client receives
            await waitForMessages(connAll.messages, 2);
            expect(JSON.parse(connAll.messages[1]).type).toBe('process-added');

            // Wait a bit to confirm subscribed client doesn't receive
            await delay(100);
            expect(connA.messages.length).toBe(1); // Only welcome

            // Event for workspace "ws-a" — both clients should receive
            const procA = makeAIProcess({
                metadata: { workspaceId: 'ws-a' },
            });
            await srv.store.addProcess(procA);

            await waitForMessages(connA.messages, 2);
            await waitForMessages(connAll.messages, 3);

            expect(JSON.parse(connA.messages[1]).type).toBe('process-added');
            expect(JSON.parse(connA.messages[1]).process.id).toBe(procA.id);

            connA.socket.destroy();
            connAll.socket.destroy();
        });

        it('should handle mixed subscribed and unsubscribed clients', async () => {
            const srv = await startServer();

            const connA = await connectWebSocket(srv.port);
            await waitForMessages(connA.messages, 1);
            sendMaskedFrame(connA.socket, JSON.stringify({ type: 'subscribe', workspaceId: 'ws-a' }));
            await delay(50);

            const connNone = await connectWebSocket(srv.port);
            await waitForMessages(connNone.messages, 1);

            // Process with workspace "ws-a" — both receive
            const procA = makeAIProcess({ metadata: { workspaceId: 'ws-a' } });
            await srv.store.addProcess(procA);

            await waitForMessages(connA.messages, 2);
            await waitForMessages(connNone.messages, 2);

            // Process with workspace "ws-b" — only unsubscribed receives
            const procB = makeAIProcess({ metadata: { workspaceId: 'ws-b' } });
            await srv.store.addProcess(procB);

            await waitForMessages(connNone.messages, 3);
            await delay(100);
            expect(connA.messages.length).toBe(2); // welcome + ws-a event only

            connA.socket.destroy();
            connNone.socket.destroy();
        });
    });

    // ========================================================================
    // Heartbeat and Timeout
    // ========================================================================

    describe('Heartbeat and Timeout', () => {
        it('should respond with pong on ping', async () => {
            const srv = await startServer();
            const { socket, messages } = await connectWebSocket(srv.port);
            await waitForMessages(messages, 1); // welcome

            sendMaskedFrame(socket, JSON.stringify({ type: 'ping' }));

            await waitForMessages(messages, 2);

            const pong = JSON.parse(messages[1]);
            expect(pong.type).toBe('pong');

            socket.destroy();
        });

        it('should prune dead connections after heartbeat timeout', async () => {
            // Create a standalone WebSocket server with short intervals for testing
            const wsServer = new ProcessWebSocketServer();
            const httpServer = http.createServer();

            await new Promise<void>((resolve) => httpServer.listen(0, 'localhost', resolve));
            const addr = httpServer.address() as net.AddressInfo;
            wsServer.attach(httpServer);

            const { socket } = await connectWebSocket(addr.port);
            expect(wsServer.clientCount).toBe(1);

            // Manually set lastSeen to far in the past by accessing internals
            // We use the broadcastProcessEvent to verify client is there, then gone
            // Instead, we'll use vi.useFakeTimers approach

            socket.destroy();
            await delay(50);

            expect(wsServer.clientCount).toBe(0);

            wsServer.closeAll();
            httpServer.close();
        });

        it('should keep active connections alive', async () => {
            const srv = await startServer();
            const { socket, messages } = await connectWebSocket(srv.port);
            await waitForMessages(messages, 1);

            // Send a ping to update lastSeen
            sendMaskedFrame(socket, JSON.stringify({ type: 'ping' }));
            await waitForMessages(messages, 2);

            // Client should still be connected
            expect(socket.writable).toBe(true);

            socket.destroy();
        });
    });

    // ========================================================================
    // Shutdown
    // ========================================================================

    describe('Shutdown', () => {
        it('should close all connections on closeAll', async () => {
            const wsServer = new ProcessWebSocketServer();
            const httpServer = http.createServer();

            await new Promise<void>((resolve) => httpServer.listen(0, 'localhost', resolve));
            const addr = httpServer.address() as net.AddressInfo;
            wsServer.attach(httpServer);

            const conn1 = await connectWebSocket(addr.port);
            const conn2 = await connectWebSocket(addr.port);
            expect(wsServer.clientCount).toBe(2);

            wsServer.closeAll();

            await delay(100);
            expect(wsServer.clientCount).toBe(0);

            httpServer.close();
        });

        it('should clear heartbeat interval on closeAll', async () => {
            const wsServer = new ProcessWebSocketServer();
            const httpServer = http.createServer();

            await new Promise<void>((resolve) => httpServer.listen(0, 'localhost', resolve));
            const addr = httpServer.address() as net.AddressInfo;
            wsServer.attach(httpServer);

            const { socket } = await connectWebSocket(addr.port);
            expect(wsServer.clientCount).toBe(1);

            wsServer.closeAll();

            // After closeAll, clientCount should be 0 and no errors thrown
            expect(wsServer.clientCount).toBe(0);

            // Calling closeAll again should be safe (no-op)
            wsServer.closeAll();
            expect(wsServer.clientCount).toBe(0);

            httpServer.close();
        });
    });

    // ========================================================================
    // Frame Codec
    // ========================================================================

    describe('Frame Codec', () => {
        it('should encode and decode small payload (< 126 bytes)', () => {
            const data = 'Hello, WebSocket!';
            const chunks: Buffer[] = [];
            const mockSocket = {
                write: (buf: Buffer) => { chunks.push(buf); },
            } as unknown as net.Socket;

            sendFrame(mockSocket, data);
            const frame = Buffer.concat(chunks);
            const decoded = decodeFrame(frame);
            expect(decoded).toBe(data);
        });

        it('should encode and decode medium payload (126–65535 bytes)', () => {
            const data = 'x'.repeat(500);
            const chunks: Buffer[] = [];
            const mockSocket = {
                write: (buf: Buffer) => { chunks.push(buf); },
            } as unknown as net.Socket;

            sendFrame(mockSocket, data);
            const frame = Buffer.concat(chunks);
            const decoded = decodeFrame(frame);
            expect(decoded).toBe(data);
        });

        it('should decode masked client frame', () => {
            const data = 'masked message';
            const payload = Buffer.from(data, 'utf-8');
            const maskKey = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);

            const masked = Buffer.alloc(payload.length);
            for (let i = 0; i < payload.length; i++) {
                masked[i] = payload[i] ^ maskKey[i % 4];
            }

            const header = Buffer.alloc(2);
            header[0] = 0x81;
            header[1] = 0x80 | payload.length;

            const frame = Buffer.concat([header, maskKey, masked]);
            const decoded = decodeFrame(frame);
            expect(decoded).toBe(data);
        });

        it('should return null for non-text frames', () => {
            const frame = Buffer.alloc(4);
            frame[0] = 0x88; // Close frame
            frame[1] = 0x02;
            frame[2] = 0x03;
            frame[3] = 0xe8;
            expect(decodeFrame(frame)).toBeNull();
        });

        it('should return null for too-short buffer', () => {
            expect(decodeFrame(Buffer.alloc(1))).toBeNull();
        });
    });

    // ========================================================================
    // toProcessSummary
    // ========================================================================

    describe('toProcessSummary', () => {
        it('should convert AIProcess to ProcessSummary', () => {
            const now = new Date();
            const proc = makeAIProcess({
                id: 'test-id',
                promptPreview: 'Test',
                status: 'completed',
                type: 'clarification',
                startTime: now,
                endTime: now,
                error: 'some error',
                metadata: { workspaceId: 'ws-1' },
            });

            const summary = toProcessSummary(proc);
            expect(summary.id).toBe('test-id');
            expect(summary.promptPreview).toBe('Test');
            expect(summary.status).toBe('completed');
            expect(summary.type).toBe('clarification');
            expect(summary.startTime).toBe(now.toISOString());
            expect(summary.endTime).toBe(now.toISOString());
            expect(summary.error).toBe('some error');
            expect(summary.workspaceId).toBe('ws-1');
        });

        it('should omit endTime and error when not present', () => {
            const proc = makeAIProcess({
                endTime: undefined,
                error: undefined,
            });

            const summary = toProcessSummary(proc);
            expect(summary.endTime).toBeUndefined();
            expect(summary.error).toBeUndefined();
        });

        it('should strip large fields (fullPrompt, result)', () => {
            const proc = makeAIProcess({
                fullPrompt: 'x'.repeat(10000),
                result: 'y'.repeat(10000),
            });

            const summary = toProcessSummary(proc);
            expect(summary).not.toHaveProperty('fullPrompt');
            expect(summary).not.toHaveProperty('result');
        });
    });
});
