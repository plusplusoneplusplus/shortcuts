/**
 * Tests for terminal pin/unpin WebSocket messages in TerminalWebSocketServer.
 *
 * Covers:
 * - terminal-pin message triggers pinSession and responds with terminal-pin-changed
 * - terminal-unpin message triggers unpinSession and responds with terminal-pin-changed
 * - pin/unpin for unknown session returns terminal-error
 * - terminal-created includes pinned field
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { TerminalWebSocketServer } from '../../../src/server/terminal/terminal-ws-server';
import { attachWebSocketUpgradeHandler } from '../../../src/server/streaming/websocket';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { IPty } from '../../../src/server/terminal/types';

// ============================================================================
// Mock PTY helpers
// ============================================================================

function createMockPty(): IPty {
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
    };
}

// ============================================================================
// Helpers
// ============================================================================

const TEST_WORKSPACE = { id: 'test-ws', name: 'Test Workspace', rootPath: '/tmp/test-ws' };

function createTestServer() {
    const store = createMockProcessStore();
    (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([TEST_WORKSPACE]);

    const terminalWs = new TerminalWebSocketServer(store, {
        nodePtyModule: { spawn: vi.fn(() => createMockPty()) },
        cleanupIntervalMs: 999_999,
    });
    const server = http.createServer();
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

describe('TerminalWebSocketServer pin/unpin', () => {
    let server: http.Server;
    let terminalWs: TerminalWebSocketServer;
    let port: number;
    let openSockets: WebSocket[] = [];

    beforeEach(async () => {
        ({ server, terminalWs } = createTestServer());
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

    async function connect(workspaceId = 'test-ws') {
        const result = await connectTerminal(port, workspaceId);
        openSockets.push(result.ws);
        return result;
    }

    async function connectAndCreate() {
        const { ws, messages } = await connect();
        sendMsg(ws, { type: 'terminal-create', workspaceId: 'test-ws', cols: 80, rows: 24 });
        await waitForMessages(messages, 1);
        expect(messages[0].type).toBe('terminal-created');
        const sessionId = messages[0].session.id;
        return { ws, messages, sessionId };
    }

    it('should include pinned: false in terminal-created message', async () => {
        const { messages } = await connectAndCreate();
        expect(messages[0].session.pinned).toBe(false);
    });

    it('should handle terminal-pin and respond with terminal-pin-changed', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();

        sendMsg(ws, { type: 'terminal-pin', sessionId });
        await waitForMessages(messages, 2);

        const pinMsg = messages[1];
        expect(pinMsg.type).toBe('terminal-pin-changed');
        expect(pinMsg.sessionId).toBe(sessionId);
        expect(pinMsg.pinned).toBe(true);
    });

    it('should handle terminal-unpin and respond with terminal-pin-changed', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();

        // Pin first
        sendMsg(ws, { type: 'terminal-pin', sessionId });
        await waitForMessages(messages, 2);

        // Then unpin
        sendMsg(ws, { type: 'terminal-unpin', sessionId });
        await waitForMessages(messages, 3);

        const unpinMsg = messages[2];
        expect(unpinMsg.type).toBe('terminal-pin-changed');
        expect(unpinMsg.sessionId).toBe(sessionId);
        expect(unpinMsg.pinned).toBe(false);
    });

    it('should return terminal-error when pinning unknown session', async () => {
        const { ws, messages } = await connect();

        sendMsg(ws, { type: 'terminal-pin', sessionId: 'nonexistent' });
        await waitForMessages(messages, 1);

        expect(messages[0].type).toBe('terminal-error');
        expect(messages[0].sessionId).toBe('nonexistent');
        expect(messages[0].message).toContain('not found');
    });

    it('should return terminal-error when unpinning unknown session', async () => {
        const { ws, messages } = await connect();

        sendMsg(ws, { type: 'terminal-unpin', sessionId: 'nonexistent' });
        await waitForMessages(messages, 1);

        expect(messages[0].type).toBe('terminal-error');
        expect(messages[0].sessionId).toBe('nonexistent');
        expect(messages[0].message).toContain('not found');
    });

    it('should reflect pin state in session manager', async () => {
        const { ws, messages, sessionId } = await connectAndCreate();
        const mgr = terminalWs.getSessionManager();

        // Initially unpinned
        expect(mgr.getSession(sessionId)?.pinned).toBe(false);

        // Pin via WebSocket
        sendMsg(ws, { type: 'terminal-pin', sessionId });
        await waitForMessages(messages, 2);
        expect(mgr.getSession(sessionId)?.pinned).toBe(true);

        // Unpin via WebSocket
        sendMsg(ws, { type: 'terminal-unpin', sessionId });
        await waitForMessages(messages, 3);
        expect(mgr.getSession(sessionId)?.pinned).toBe(false);
    });
});
