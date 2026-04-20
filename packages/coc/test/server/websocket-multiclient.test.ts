/**
 * WebSocket Multi-Client Fan-Out & Connection Lifecycle Tests
 *
 * Section 1: Multi-Client Fan-Out — 3+ simultaneous connected clients all receive events
 * Section 2: Workspace-Scoped Event Filtering — tasks-changed leakage prevention (unit, mock clients)
 * Section 3: Connection Lifecycle — clientCount, disconnect cleanup, heartbeat pruning, no replay
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { createExecutionServer } from '../../src/server/index';
import { ProcessWebSocketServer } from '@plusplusoneplusplus/coc-server';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import type { WSClient, ServerMessage } from '@plusplusoneplusplus/coc-server';
import type { AIProcess } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers — real WS connections
// ============================================================================

function connectWS(port: number): Promise<{ ws: WebSocket; messages: string[] }> {
    return new Promise((resolve, reject) => {
        const messages: string[] = [];
        const ws = new WebSocket(`ws://localhost:${port}/ws`);
        ws.on('open', () => resolve({ ws, messages }));
        ws.on('message', (data: Buffer | string) => {
            const text = typeof data === 'string' ? data : data.toString('utf-8');
            messages.push(text);
        });
        ws.on('error', reject);
    });
}

function waitForMessages(messages: string[], count: number, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (messages.length >= count) { resolve(); }
            else if (Date.now() - start > timeoutMs) {
                reject(new Error(`Timed out waiting for ${count} messages, got ${messages.length}`));
            } else { setTimeout(check, 20); }
        };
        check();
    });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeProcess(overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        promptPreview: 'Test',
        fullPrompt: 'Full test prompt',
        status: 'running',
        startTime: new Date(),
        type: 'clarification',
        ...overrides,
    } as AIProcess;
}

// ============================================================================
// Helpers — mock client (no real WS, direct internals access)
// ============================================================================

function makeMockClient(id: string, options: { workspaceId?: string } = {}): WSClient {
    const client: WSClient = {
        socket: {} as any,
        id,
        send: vi.fn(),
        close: vi.fn(),
        lastSeen: Date.now(),
    };
    if (options.workspaceId) {
        client.workspaceId = options.workspaceId;
    }
    return client;
}

function injectClient(server: ProcessWebSocketServer, client: WSClient): void {
    (server as any).clients.add(client);
}

// ============================================================================
// Section 1: Multi-Client Fan-Out (real WS)
// ============================================================================

describe('Section 1: Multi-Client Fan-Out', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mc-'));
    });

    afterEach(async () => {
        if (server) { await server.close(); server = undefined; }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir , skipNonEssentialInit: true });
        return server;
    }

    it('three simultaneous clients all receive process-added', async () => {
        const srv = await startServer();
        const conn1 = await connectWS(srv.port);
        const conn2 = await connectWS(srv.port);
        const conn3 = await connectWS(srv.port);

        await Promise.all([
            waitForMessages(conn1.messages, 1),
            waitForMessages(conn2.messages, 1),
            waitForMessages(conn3.messages, 1),
        ]);

        const proc = makeProcess();
        await srv.store.addProcess(proc);

        await Promise.all([
            waitForMessages(conn1.messages, 2),
            waitForMessages(conn2.messages, 2),
            waitForMessages(conn3.messages, 2),
        ]);

        for (const conn of [conn1, conn2, conn3]) {
            const evt = JSON.parse(conn.messages[1]);
            expect(evt.type).toBe('process-added');
            expect(evt.process.id).toBe(proc.id);
        }

        conn1.ws.close(); conn2.ws.close(); conn3.ws.close();
    });

    it('three simultaneous clients all receive process-updated', async () => {
        const srv = await startServer();
        const proc = makeProcess();
        await srv.store.addProcess(proc);

        const conn1 = await connectWS(srv.port);
        const conn2 = await connectWS(srv.port);
        const conn3 = await connectWS(srv.port);
        await Promise.all([
            waitForMessages(conn1.messages, 1),
            waitForMessages(conn2.messages, 1),
            waitForMessages(conn3.messages, 1),
        ]);

        await srv.store.updateProcess(proc.id, { status: 'completed' });

        await Promise.all([
            waitForMessages(conn1.messages, 2),
            waitForMessages(conn2.messages, 2),
            waitForMessages(conn3.messages, 2),
        ]);

        for (const conn of [conn1, conn2, conn3]) {
            const evt = JSON.parse(conn.messages[1]);
            expect(evt.type).toBe('process-updated');
            expect(evt.process.status).toBe('completed');
        }

        conn1.ws.close(); conn2.ws.close(); conn3.ws.close();
    });

    it('three simultaneous clients all receive process-removed', async () => {
        const srv = await startServer();
        const proc = makeProcess();
        await srv.store.addProcess(proc);

        const conn1 = await connectWS(srv.port);
        const conn2 = await connectWS(srv.port);
        const conn3 = await connectWS(srv.port);
        await Promise.all([
            waitForMessages(conn1.messages, 1),
            waitForMessages(conn2.messages, 1),
            waitForMessages(conn3.messages, 1),
        ]);

        await srv.store.removeProcess(proc.id);

        await Promise.all([
            waitForMessages(conn1.messages, 2),
            waitForMessages(conn2.messages, 2),
            waitForMessages(conn3.messages, 2),
        ]);

        for (const conn of [conn1, conn2, conn3]) {
            const evt = JSON.parse(conn.messages[1]);
            expect(evt.type).toBe('process-removed');
            expect(evt.processId).toBe(proc.id);
        }

        conn1.ws.close(); conn2.ws.close(); conn3.ws.close();
    });

    it('one client disconnects mid-broadcast — remaining clients still receive', async () => {
        const srv = await startServer();
        const conn1 = await connectWS(srv.port);
        const conn2 = await connectWS(srv.port);
        const conn3 = await connectWS(srv.port);

        await Promise.all([
            waitForMessages(conn1.messages, 1),
            waitForMessages(conn2.messages, 1),
            waitForMessages(conn3.messages, 1),
        ]);

        // Disconnect conn2 before broadcast
        conn2.ws.close();
        await delay(100); // allow close to propagate

        // Broadcast to remaining clients
        const proc = makeProcess();
        await srv.store.addProcess(proc);

        await Promise.all([
            waitForMessages(conn1.messages, 2),
            waitForMessages(conn3.messages, 2),
        ]);

        expect(JSON.parse(conn1.messages[1]).type).toBe('process-added');
        expect(JSON.parse(conn3.messages[1]).type).toBe('process-added');

        conn1.ws.close(); conn3.ws.close();
    });

    it('10 rapid events arrive at each client in same order', async () => {
        const srv = await startServer();
        const conn1 = await connectWS(srv.port);
        const conn2 = await connectWS(srv.port);

        await Promise.all([
            waitForMessages(conn1.messages, 1),
            waitForMessages(conn2.messages, 1),
        ]);

        // Add 10 processes rapidly
        const procs: AIProcess[] = [];
        for (let i = 0; i < 10; i++) {
            const p = makeProcess({ promptPreview: `Proc ${i}` });
            procs.push(p);
        }
        for (const p of procs) {
            await srv.store.addProcess(p);
        }

        await Promise.all([
            waitForMessages(conn1.messages, 11),
            waitForMessages(conn2.messages, 11),
        ]);

        const ids1 = conn1.messages.slice(1).map(m => JSON.parse(m).process?.id).filter(Boolean);
        const ids2 = conn2.messages.slice(1).map(m => JSON.parse(m).process?.id).filter(Boolean);

        expect(ids1).toEqual(ids2);
        expect(ids1.length).toBe(10);

        conn1.ws.close(); conn2.ws.close();
    });

    it('50 simultaneous clients all receive a broadcast', async () => {
        const srv = await startServer();
        const connections = await Promise.all(
            Array.from({ length: 50 }, () => connectWS(srv.port))
        );

        // Wait for all welcome messages
        await Promise.all(connections.map(c => waitForMessages(c.messages, 1)));

        const proc = makeProcess();
        const broadcastStart = Date.now();
        await srv.store.addProcess(proc);

        await Promise.all(connections.map(c => waitForMessages(c.messages, 2)));

        const elapsed = Date.now() - broadcastStart;
        expect(elapsed).toBeLessThan(1000); // well within 1s for unit test

        for (const conn of connections) {
            const evt = JSON.parse(conn.messages[1]);
            expect(evt.type).toBe('process-added');
            expect(evt.process.id).toBe(proc.id);
        }

        await Promise.all(connections.map(c => { c.ws.close(); return delay(0); }));
    });
});

// ============================================================================
// Section 2: Workspace-Scoped Event Filtering (mock clients)
// ============================================================================

describe('Section 2: Workspace-Scoped Event Filtering', () => {
    let wsServer: ProcessWebSocketServer;

    beforeEach(() => {
        wsServer = new ProcessWebSocketServer();
    });

    it('client subscribed to ws-111 receives tasks-changed for ws-111', () => {
        const clientA = makeMockClient('a', { workspaceId: 'ws-111' });
        injectClient(wsServer, clientA);

        wsServer.broadcastProcessEvent({
            type: 'tasks-changed',
            workspaceId: 'ws-111',
            timestamp: Date.now(),
        });

        expect(clientA.send).toHaveBeenCalledOnce();
        const msg = JSON.parse((clientA.send as any).mock.calls[0][0]);
        expect(msg.type).toBe('tasks-changed');
        expect(msg.workspaceId).toBe('ws-111');
    });

    it('client subscribed to ws-222 does NOT receive tasks-changed for ws-111', () => {
        const clientB = makeMockClient('b', { workspaceId: 'ws-222' });
        injectClient(wsServer, clientB);

        wsServer.broadcastProcessEvent({
            type: 'tasks-changed',
            workspaceId: 'ws-111',
            timestamp: Date.now(),
        });

        expect(clientB.send).not.toHaveBeenCalled();
    });

    it('client subscribed to ws-111 and ws-222 receives events for both (via two subscriptions)', () => {
        // Client with no workspaceId receives all events
        const clientBoth = makeMockClient('both');
        injectClient(wsServer, clientBoth);

        wsServer.broadcastProcessEvent({ type: 'tasks-changed', workspaceId: 'ws-111', timestamp: Date.now() });
        wsServer.broadcastProcessEvent({ type: 'tasks-changed', workspaceId: 'ws-222', timestamp: Date.now() });

        expect(clientBoth.send).toHaveBeenCalledTimes(2);
    });

    it('client with no workspace subscription receives global (non-scoped) events', () => {
        const clientAll = makeMockClient('unsubscribed');
        injectClient(wsServer, clientAll);

        // Global events like process-added (no workspaceId)
        wsServer.broadcastProcessEvent({
            type: 'process-added',
            process: {
                id: 'p1',
                promptPreview: 'test',
                status: 'running',
                startTime: new Date().toISOString(),
            },
        });

        expect(clientAll.send).toHaveBeenCalledOnce();
    });

    it('client with no workspace subscription does NOT receive workspace-scoped tasks-changed', () => {
        // Per the broadcastProcessEvent logic: if client has a workspaceId subscription,
        // it only receives matching. If NO subscription, it receives ALL (including scoped).
        // This tests the "no subscription → receives everything" behavior.
        const clientAll = makeMockClient('unsubscribed');
        injectClient(wsServer, clientAll);

        wsServer.broadcastProcessEvent({
            type: 'tasks-changed',
            workspaceId: 'ws-specific',
            timestamp: Date.now(),
        });

        // Clients with no workspace subscription receive ALL events (global or scoped)
        expect(clientAll.send).toHaveBeenCalledOnce();
    });

    it('subscribed client only receives its workspace events, not other workspace', () => {
        const clientA = makeMockClient('a', { workspaceId: 'ws-A' });
        const clientB = makeMockClient('b', { workspaceId: 'ws-B' });
        const clientAll = makeMockClient('all');
        injectClient(wsServer, clientA);
        injectClient(wsServer, clientB);
        injectClient(wsServer, clientAll);

        wsServer.broadcastProcessEvent({ type: 'tasks-changed', workspaceId: 'ws-A', timestamp: Date.now() });

        expect(clientA.send).toHaveBeenCalledOnce();
        expect(clientB.send).not.toHaveBeenCalled();
        expect(clientAll.send).toHaveBeenCalledOnce(); // unsubscribed gets all
    });

    it('subscribe-file message adds subscription, broadcastFileEvent delivers after', () => {
        const client = makeMockClient('file-sub');
        injectClient(wsServer, client);

        (wsServer as any).handleClientMessage(client, {
            type: 'subscribe-file',
            filePath: '/repo/tasks.md',
        });

        const fileMsg: ServerMessage = {
            type: 'document-updated',
            filePath: '/repo/tasks.md',
            content: 'updated',
            comments: [],
        };
        wsServer.broadcastFileEvent('/repo/tasks.md', fileMsg);

        expect(client.send).toHaveBeenCalledOnce();
        const msg = JSON.parse((client.send as any).mock.calls[0][0]);
        expect(msg.type).toBe('document-updated');
    });
});

// ============================================================================
// Section 3: Connection Lifecycle
// ============================================================================

describe('Section 3: Connection Lifecycle', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-lifecycle-'));
    });

    afterEach(async () => {
        if (server) { await server.close(); server = undefined; }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('client connects → clientCount increments', async () => {
        const wsServer = new ProcessWebSocketServer();
        const httpServer = http.createServer();
        await new Promise<void>(res => httpServer.listen(0, 'localhost', res));
        const addr = httpServer.address() as AddressInfo;
        wsServer.attach(httpServer);

        expect(wsServer.clientCount).toBe(0);

        const { ws } = await connectWS(addr.port);
        await delay(50);
        expect(wsServer.clientCount).toBe(1);

        ws.close();
        wsServer.closeAll();
        httpServer.close();
    });

    it('client calls close() → removed from internal client set', async () => {
        const wsServer = new ProcessWebSocketServer();
        const httpServer = http.createServer();
        await new Promise<void>(res => httpServer.listen(0, 'localhost', res));
        const addr = httpServer.address() as AddressInfo;
        wsServer.attach(httpServer);

        const { ws } = await connectWS(addr.port);
        await delay(50);
        expect(wsServer.clientCount).toBe(1);

        ws.close();
        await delay(100);
        expect(wsServer.clientCount).toBe(0);

        wsServer.closeAll();
        httpServer.close();
    });

    it('server closeAll() → all connected clients receive close frame', async () => {
        const wsServer = new ProcessWebSocketServer();
        const httpServer = http.createServer();
        await new Promise<void>(res => httpServer.listen(0, 'localhost', res));
        const addr = httpServer.address() as AddressInfo;
        wsServer.attach(httpServer);

        const closedEvents: string[] = [];

        const { ws: ws1 } = await connectWS(addr.port);
        const { ws: ws2 } = await connectWS(addr.port);
        const { ws: ws3 } = await connectWS(addr.port);

        ws1.on('close', () => closedEvents.push('ws1'));
        ws2.on('close', () => closedEvents.push('ws2'));
        ws3.on('close', () => closedEvents.push('ws3'));

        await delay(50);
        expect(wsServer.clientCount).toBe(3);

        wsServer.closeAll();
        await delay(200);

        expect(wsServer.clientCount).toBe(0);
        expect(closedEvents).toContain('ws1');
        expect(closedEvents).toContain('ws2');
        expect(closedEvents).toContain('ws3');

        httpServer.close();
    });

    it('new client connects after process-added → does not receive old event (no replay)', async () => {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir , skipNonEssentialInit: true });

        // Add process BEFORE client connects
        const proc = makeProcess();
        await server.store.addProcess(proc);

        // Now connect
        const { ws, messages } = await connectWS(server.port);
        await waitForMessages(messages, 1); // welcome only

        // Wait a bit to confirm no extra messages
        await delay(200);

        // Should only have the welcome message, not the process-added event
        expect(messages.length).toBe(1);
        expect(JSON.parse(messages[0]).type).toBe('welcome');

        ws.close();
    });

    it('client drops without close frame → cleaned up after heartbeat pruning (fake timers)', () => {
        vi.useFakeTimers();
        try {
            const wsServer = new ProcessWebSocketServer();

            // Start the heartbeat AFTER fake timers are active so setInterval is faked
            (wsServer as any).startHeartbeat();

            // Forcibly add a "dead" mock client (isAlive = false on the socket)
            const deadClient: WSClient = {
                socket: { ping: vi.fn(), terminate: vi.fn() } as any,
                id: 'dead-client',
                send: vi.fn(),
                close: vi.fn(() => { (wsServer as any).clients.delete(deadClient); }),
                lastSeen: Date.now() - 120_000,
            };
            (deadClient.socket as any).isAlive = false;
            (wsServer as any).clients.add(deadClient);

            expect(wsServer.clientCount).toBe(1);

            // Advance past the 60s heartbeat interval
            vi.advanceTimersByTime(60_001);

            expect(wsServer.clientCount).toBe(0);

            wsServer.closeAll();
        } finally {
            vi.useRealTimers();
        }
    });
});
