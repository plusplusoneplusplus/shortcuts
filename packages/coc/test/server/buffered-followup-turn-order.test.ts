/**
 * Buffered Follow-Up Turn Order — Regression Test
 *
 * Verifies that when a 2nd message is sent while the 1st is still running,
 * the user turn is NOT immediately appended to conversationTurns. Instead,
 * it is stored only in pendingMessages and appended at the correct position
 * when drainPendingMessages runs after the current round completes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { createRequestHandler, registerApiRoutes, generateDashboardHtml } from '../../src/server/index';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { createMockBridge } from '../helpers/mock-sdk-service';

// ============================================================================
// HTTP Helpers
// ============================================================================

function postJSON(
    url: string,
    data: unknown = {}
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const body = JSON.stringify(data);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Buffered follow-up turn order (regression)', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffered-turn-order-'));
        store = new FileProcessStore({ dataDir });
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('2nd message should NOT be in conversationTurns when buffered as pending', async () => {
        const bridge = createMockBridge();
        (bridge as any).findTaskByProcessId = vi.fn().mockReturnValue({
            id: 'task-1',
            type: 'chat',
            status: 'running',
        });

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);
        const spaHtml = generateDashboardHtml();
        const handler = createRequestHandler({ routes, spaHtml, store });
        server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });
        baseUrl = `http://localhost:${(server!.address() as { port: number }).port}`;

        const proc: AIProcess = {
            id: 'proc-order',
            type: 'clarification',
            promptPreview: 'msg 1',
            fullPrompt: 'msg 1 full',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-1',
            conversationTurns: [
                {
                    role: 'user',
                    content: 'Message 1',
                    timestamp: new Date(),
                    turnIndex: 0,
                    timeline: [],
                },
            ],
        };
        await store.addProcess(proc);

        const res = await postJSON(`${baseUrl}/api/processes/proc-order/message`, {
            content: 'Message 2',
        });

        expect(res.status).toBe(202);

        const updated = await store.getProcess('proc-order');
        // Pending message IS stored
        expect(updated?.pendingMessages).toHaveLength(1);
        expect(updated?.pendingMessages![0].content).toBe('Message 2');

        // Buffered message is NOT in conversationTurns yet
        const turns = updated?.conversationTurns ?? [];
        expect(turns).toHaveLength(1);
        expect(turns[0].content).toBe('Message 1');
    });

    it('correct turn ordering after msg 1 completes', async () => {
        const bridge = createMockBridge();
        (bridge as any).findTaskByProcessId = vi.fn().mockReturnValue({
            id: 'task-1',
            type: 'chat',
            status: 'running',
        });

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);
        const spaHtml = generateDashboardHtml();
        const handler = createRequestHandler({ routes, spaHtml, store });
        server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });
        baseUrl = `http://localhost:${(server!.address() as { port: number }).port}`;

        const proc: AIProcess = {
            id: 'proc-order-2',
            type: 'clarification',
            promptPreview: 'msg 1',
            fullPrompt: 'msg 1 full',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-2',
            conversationTurns: [
                {
                    role: 'user',
                    content: 'Message 1',
                    timestamp: new Date(),
                    turnIndex: 0,
                    timeline: [],
                },
            ],
        };
        await store.addProcess(proc);

        await postJSON(`${baseUrl}/api/processes/proc-order-2/message`, {
            content: 'Message 2',
        });

        // Simulate msg 1's assistant response completing
        await store.appendConversationTurn(
            'proc-order-2',
            (turnIndex) => ({
                role: 'assistant' as const,
                content: 'Response to message 1',
                timestamp: new Date(),
                turnIndex,
                timeline: [],
            }),
        );

        const updated = await store.getProcess('proc-order-2');
        const turns = updated?.conversationTurns ?? [];

        // Only user-msg1 + assistant response — buffered msg2 is still pending
        expect(turns).toHaveLength(2);
        expect(turns[0].role).toBe('user');
        expect(turns[0].content).toBe('Message 1');
        expect(turns[1].role).toBe('assistant');
        expect(turns[1].content).toBe('Response to message 1');

        // Message 2 still in pendingMessages
        expect(updated?.pendingMessages).toHaveLength(1);
        expect(updated?.pendingMessages![0].content).toBe('Message 2');
    });

    it('buffered message should not appear in both conversationTurns and pendingMessages', async () => {
        const bridge = createMockBridge();
        (bridge as any).findTaskByProcessId = vi.fn().mockReturnValue({
            id: 'task-1',
            type: 'chat',
            status: 'running',
        });

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);
        const spaHtml = generateDashboardHtml();
        const handler = createRequestHandler({ routes, spaHtml, store });
        server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });
        baseUrl = `http://localhost:${(server!.address() as { port: number }).port}`;

        const proc: AIProcess = {
            id: 'proc-dup',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-dup',
            conversationTurns: [{
                role: 'user',
                content: 'First message',
                timestamp: new Date(),
                turnIndex: 0,
                timeline: [],
            }],
        };
        await store.addProcess(proc);

        await postJSON(`${baseUrl}/api/processes/proc-dup/message`, {
            content: 'Buffered message',
        });

        const updated = await store.getProcess('proc-dup');

        // The message appears in pendingMessages only
        const inPending = updated?.pendingMessages?.some(m => m.content === 'Buffered message');
        expect(inPending).toBe(true);

        // The message does NOT appear in conversationTurns
        const inTurns = updated?.conversationTurns?.some(t => t.content === 'Buffered message');
        expect(inTurns).toBe(false);
    });

    it('pending message stores displayContent and images for drain', async () => {
        const bridge = createMockBridge();
        (bridge as any).findTaskByProcessId = vi.fn().mockReturnValue({
            id: 'task-1',
            type: 'chat',
            status: 'running',
        });

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);
        const spaHtml = generateDashboardHtml();
        const handler = createRequestHandler({ routes, spaHtml, store });
        server = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });
        baseUrl = `http://localhost:${(server!.address() as { port: number }).port}`;

        const proc: AIProcess = {
            id: 'proc-meta',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-meta',
            conversationTurns: [{
                role: 'user',
                content: 'First message',
                timestamp: new Date(),
                turnIndex: 0,
                timeline: [],
            }],
        };
        await store.addProcess(proc);

        await postJSON(`${baseUrl}/api/processes/proc-meta/message`, {
            content: 'Follow-up with skills',
            skillNames: ['impl'],
            mode: 'autopilot',
        });

        const updated = await store.getProcess('proc-meta');
        const pending = updated?.pendingMessages?.[0];
        expect(pending).toBeDefined();
        expect(pending!.content).toBe('Follow-up with skills');
        // displayContent includes skill directive
        expect(pending!.displayContent).toContain('impl');
        expect(pending!.mode).toBe('autopilot');
    });
});
