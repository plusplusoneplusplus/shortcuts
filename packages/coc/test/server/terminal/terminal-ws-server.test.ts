/**
 * Terminal WebSocket Server Tests
 *
 * Tests for TerminalWebSocketServer: connection handshake, PTY I/O
 * forwarding, resize, close, PTY exit, error handling, closeAll,
 * and heartbeat pruning.
 *
 * Uses a real HTTP server on port 0 with mocked node-pty.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { TerminalWebSocketServer } from '../../../src/server/terminal/terminal-ws-server';
import { attachWebSocketUpgradeHandler } from '../../../src/server/streaming/websocket';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';
import type { IPty } from '../../../src/server/terminal/types';

// ============================================================================
// Mock PTY helpers
// ============================================================================

interface MockPty extends IPty {
    _emitData: (data: string) => void;
    _emitExit: (code: number, signal?: number) => void;
}

function createMockPty(overrides?: Partial<IPty>): MockPty {
    const dataListeners: Array<(data: string) => void> = [];
    const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
    return {
        pid: Math.floor(Math.random() * 10000) + 1000,
        cols: 80,
        rows: 24,
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn((cb: (data: string) => void) => {
            dataListeners.push(cb);
            return { dispose: () => { dataListeners.splice(dataListeners.indexOf(cb), 1); } };
        }),
        onExit: vi.fn((cb: (e: { exitCode: number; signal?: number }) => void) => {
            exitListeners.push(cb);
            return { dispose: () => { exitListeners.splice(exitListeners.indexOf(cb), 1); } };
        }),
        _emitData: (data: string) => dataListeners.forEach(cb => cb(data)),
        _emitExit: (code: number, signal?: number) =>
            exitListeners.forEach(cb => cb({ exitCode: code, signal })),
        ...overrides,
    };
}

// ============================================================================
// Helpers
// ============================================================================

const TEST_WORKSPACE = { id: 'test-ws', name: 'Test Workspace', rootPath: '/tmp/test-ws' };
let lastMockPty: MockPty;

function createTestServer(
    storeOverrides?: { workspaces?: typeof TEST_WORKSPACE[] },
): { server: http.Server; terminalWs: TerminalWebSocketServer; store: MockProcessStore } {
    const store = createMockProcessStore();
    const workspaces = storeOverrides?.workspaces ?? [TEST_WORKSPACE];
    (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue(workspaces);

    const mockSpawn = vi.fn(() => {
        lastMockPty = createMockPty();
        return lastMockPty;
    });

    const terminalWs = new TerminalWebSocketServer(store, {
        nodePtyModule: { spawn: mockSpawn },
        cleanupIntervalMs: 999_999, // effectively disabled for tests
    });
    const server = http.createServer();
    // Use the dispatch function so /ws/terminal routes correctly
    attachWebSocketUpgradeHandler(server, { handleUpgrade: () => {} } as any, terminalWs);
    return { server, terminalWs, store };
}

function startServer(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as AddressInfo;
            resolve(addr.port);
        });
    });
}

function connectTerminal(port: number, workspaceId = 'test-ws'): Promise<{ ws: WebSocket; messages: any[] }> {
    return new Promise((resolve, reject) => {
        const messages: any[] = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?workspaceId=${workspaceId}`);
        ws.on('open', () => resolve({ ws, messages }));
        ws.on('message', (data: Buffer | string) => {
            const text = typeof data === 'string' ? data : data.toString('utf-8');
            messages.push(JSON.parse(text));
        });
        ws.on('error', reject);
    });
}

function sendMsg(ws: WebSocket, msg: any): void {
    ws.send(JSON.stringify(msg));
}

function waitForMessages(messages: any[], count: number, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (messages.length >= count) resolve();
            else if (Date.now() - start > timeoutMs) reject(new Error(`Timed out waiting for ${count} messages, got ${messages.length}`));
            else setTimeout(check, 20);
        };
        check();
    });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('TerminalWebSocketServer', () => {
    let server: http.Server;
    let terminalWs: TerminalWebSocketServer;
    let store: MockProcessStore;
    let port: number;
    let openSockets: WebSocket[] = [];

    beforeEach(async () => {
        ({ server, terminalWs, store } = createTestServer());
        port = await startServer(server);
        openSockets = [];
    });

    afterEach(async () => {
        for (const ws of openSockets) {
            try { ws.close(); } catch { /* ignore */ }
        }
        terminalWs.closeAll();
        await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    });

    // Helper: connect and track socket for cleanup
    async function connect(workspaceId = 'test-ws') {
        const result = await connectTerminal(port, workspaceId);
        openSockets.push(result.ws);
        return result;
    }

    // Helper: connect and create a terminal session
    async function connectAndCreate(cols = 80, rows = 24) {
        const { ws, messages } = await connect();
        sendMsg(ws, { type: 'terminal-create', workspaceId: 'test-ws', cols, rows });
        await waitForMessages(messages, 1);
        expect(messages[0].type).toBe('terminal-created');
        const sessionId = messages[0].session.id;
        return { ws, messages, sessionId };
    }

    // ========================================================================
    // Connection handshake
    // ========================================================================

    it('should complete WebSocket handshake on /ws/terminal', async () => {
        const { ws, messages } = await connect();
        // Connection established — no immediate server message expected
        expect(ws.readyState).toBe(WebSocket.OPEN);
        expect(terminalWs.clientCount).toBe(1);
    });

    it('should reject connection with unknown workspaceId', async () => {
        const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?workspaceId=nonexistent`);
            openSockets.push(ws);
            ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
        });
        const { code } = await closePromise;
        expect(code).toBe(4001);
    });

    it('should reject connection with missing workspaceId', async () => {
        const closePromise = new Promise<{ code: number }>((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal`);
            openSockets.push(ws);
            ws.on('close', (code) => resolve({ code }));
        });
        const { code } = await closePromise;
        expect(code).toBe(4001);
    });

    // ========================================================================
    // Session creation
    // ========================================================================

    it('should create a terminal session and return terminal-created', async () => {
        const { ws, messages } = await connect();
        sendMsg(ws, { type: 'terminal-create', workspaceId: 'test-ws', cols: 100, rows: 30 });
        await waitForMessages(messages, 1);

        expect(messages[0].type).toBe('terminal-created');
        expect(messages[0].session).toMatchObject({
            workspaceId: 'test-ws',
            cols: 100,
            rows: 30,
        });
        expect(typeof messages[0].session.id).toBe('string');
        expect(typeof messages[0].session.pid).toBe('number');
    });

    it('should return terminal-error when PTY spawn fails', async () => {
        // Create server with null nodePtyModule (unavailable)
        terminalWs.closeAll();
        await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));

        const storeForFail = createMockProcessStore();
        (storeForFail.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([TEST_WORKSPACE]);
        const failTerminalWs = new TerminalWebSocketServer(storeForFail, {
            nodePtyModule: null, // node-pty not available
            cleanupIntervalMs: 999_999,
        });
        const failServer = http.createServer();
        attachWebSocketUpgradeHandler(failServer, { handleUpgrade: () => {} } as any, failTerminalWs);
        const failPort = await startServer(failServer);

        try {
            const failMessages: any[] = [];
            const ws = new WebSocket(`ws://127.0.0.1:${failPort}/ws/terminal?workspaceId=test-ws`);
            ws.on('message', (d: Buffer | string) => failMessages.push(JSON.parse(typeof d === 'string' ? d : d.toString())));
            await new Promise<void>((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

            sendMsg(ws, { type: 'terminal-create', workspaceId: 'test-ws' });
            await waitForMessages(failMessages, 1);

            expect(failMessages[0].type).toBe('terminal-error');
            expect(failMessages[0].message).toContain('not available');
            ws.close();
        } finally {
            failTerminalWs.closeAll();
            await new Promise<void>((resolve, reject) => failServer.close(err => err ? reject(err) : resolve()));
        }

        // Re-create the main server for afterEach
        ({ server, terminalWs, store } = createTestServer());
        port = await startServer(server);
    });

    // ========================================================================
    // PTY output → WebSocket
    // ========================================================================

    it('should forward PTY output to WebSocket as terminal-output messages', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();

        // Trigger mock PTY output
        lastMockPty._emitData('hello world\r\n');
        await waitForMessages(messages, 2); // terminal-created + terminal-output

        const outputMsg = messages.find(m => m.type === 'terminal-output');
        expect(outputMsg).toBeDefined();
        expect(outputMsg.sessionId).toBe(sessionId);
        expect(outputMsg.data).toBe('hello world\r\n');
    });

    // ========================================================================
    // WebSocket input → PTY
    // ========================================================================

    it('should forward WebSocket input to PTY', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();

        sendMsg(ws, { type: 'terminal-input', sessionId, data: 'ls\n' });
        await delay(50);

        expect(lastMockPty.write).toHaveBeenCalledWith('ls\n');
    });

    // ========================================================================
    // Resize
    // ========================================================================

    it('should handle terminal-resize messages', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();

        sendMsg(ws, { type: 'terminal-resize', sessionId, cols: 120, rows: 40 });
        await delay(50);

        expect(lastMockPty.resize).toHaveBeenCalledWith(120, 40);
    });

    // ========================================================================
    // PTY exit
    // ========================================================================

    it('should send terminal-exit and close when PTY exits', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();

        lastMockPty._emitExit(0);
        await waitForMessages(messages, 2); // terminal-created + terminal-exit

        const exitMsg = messages.find(m => m.type === 'terminal-exit');
        expect(exitMsg).toBeDefined();
        expect(exitMsg.sessionId).toBe(sessionId);
        expect(exitMsg.exitCode).toBe(0);
    });

    // ========================================================================
    // WebSocket close → PTY cleanup
    // ========================================================================

    it('should destroy PTY session when WebSocket closes', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();

        const sessionManager = terminalWs.getSessionManager();
        expect(sessionManager.getSession(sessionId)).toBeDefined();

        ws.close();
        await delay(100);

        expect(sessionManager.getSession(sessionId)).toBeUndefined();
        expect(terminalWs.clientCount).toBe(0);
    });

    // ========================================================================
    // terminal-close message
    // ========================================================================

    it('should destroy PTY session on terminal-close message', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();

        const sessionManager = terminalWs.getSessionManager();
        expect(sessionManager.getSession(sessionId)).toBeDefined();

        sendMsg(ws, { type: 'terminal-close', sessionId });
        await delay(100);

        expect(sessionManager.getSession(sessionId)).toBeUndefined();
        // Client is still connected
        expect(terminalWs.clientCount).toBe(1);
    });

    // ========================================================================
    // closeAll
    // ========================================================================

    it('should clean up on server closeAll()', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();
        const sessionManager = terminalWs.getSessionManager();

        const closePromise = new Promise<void>(resolve => ws.on('close', resolve));
        terminalWs.closeAll();
        await closePromise;

        expect(terminalWs.clientCount).toBe(0);
    });

    // ========================================================================
    // Multiple sessions per connection
    // ========================================================================

    it('should support multiple sessions per connection', async () => {
        const { ws, messages } = await connect();

        // Create two sessions
        sendMsg(ws, { type: 'terminal-create', workspaceId: 'test-ws', cols: 80, rows: 24 });
        await waitForMessages(messages, 1);
        const session1Id = messages[0].session.id;
        const pty1 = lastMockPty;

        sendMsg(ws, { type: 'terminal-create', workspaceId: 'test-ws', cols: 100, rows: 30 });
        await waitForMessages(messages, 2);
        const session2Id = messages[1].session.id;
        const pty2 = lastMockPty;

        expect(session1Id).not.toBe(session2Id);

        // Both PTYs forward output to the same WebSocket
        pty1._emitData('from-pty1');
        pty2._emitData('from-pty2');
        await waitForMessages(messages, 4); // 2 created + 2 output

        const outputs = messages.filter(m => m.type === 'terminal-output');
        expect(outputs).toHaveLength(2);
        expect(outputs.find(m => m.sessionId === session1Id)?.data).toBe('from-pty1');
        expect(outputs.find(m => m.sessionId === session2Id)?.data).toBe('from-pty2');
    });

    // ========================================================================
    // Client count
    // ========================================================================

    it('should track client count correctly', async () => {
        expect(terminalWs.clientCount).toBe(0);
        const { ws: ws1 } = await connect();
        expect(terminalWs.clientCount).toBe(1);
        const { ws: ws2 } = await connect();
        expect(terminalWs.clientCount).toBe(2);

        ws1.close();
        await delay(100);
        expect(terminalWs.clientCount).toBe(1);

        ws2.close();
        await delay(100);
        expect(terminalWs.clientCount).toBe(0);
    });
});
