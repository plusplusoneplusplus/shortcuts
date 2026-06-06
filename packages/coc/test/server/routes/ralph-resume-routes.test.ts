/**
 * Tests for POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/resume
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphResumeRoutes } from '../../../src/server/routes/ralph-resume-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore, type MockProcessStore } from '../helpers/mock-process-store';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import type { RalphSessionRecord, RalphTerminalReason } from '../../../src/server/ralph/types';

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function post(baseUrl: string, urlPath: string, body?: unknown) {
    return request(baseUrl, urlPath, {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

function makeBridgeStub(opts: { tasks?: any[] } = {}) {
    const tasks = opts.tasks ?? [];
    const enqueue = vi.fn().mockResolvedValue('new-task-id');
    const bridge: any = {
        enqueue,
        registry: {
            getAllQueues: () => new Map([['repo-1', { getAll: () => tasks }]]),
        },
    };
    return { bridge, enqueue };
}

async function seedSession(
    dataDir: string,
    workspaceId: string,
    sessionId: string,
    overrides: Partial<RalphSessionRecord> = {},
): Promise<RalphSessionRecord> {
    const journal = new RalphSessionStore({ dataDir });
    await journal.initSession(workspaceId, sessionId, {
        originalGoal: 'Original goal',
        maxIterations: 10,
        startedAt: '2026-05-11T00:00:00Z',
    });
    return journal.updateSessionRecord(workspaceId, sessionId, (rec) => ({
        ...(rec as RalphSessionRecord),
        currentIteration: 3,
        phase: 'executing',
        iterations: [
            { iteration: 1, loopIndex: 1, taskId: 't1', processId: 'queue_p1', startedAt: '2026-05-11T01:00:00Z', endedAt: '2026-05-11T01:10:00Z', status: 'completed' },
            { iteration: 2, loopIndex: 1, taskId: 't2', processId: 'queue_p2', startedAt: '2026-05-11T01:10:00Z', endedAt: '2026-05-11T01:20:00Z', status: 'completed' },
            { iteration: 3, loopIndex: 1, taskId: 't3', processId: 'queue_p3', startedAt: '2026-05-11T01:20:00Z', endedAt: '2026-05-11T01:30:00Z', status: 'completed' },
        ],
        ...overrides,
    }));
}

describe('POST /api/workspaces/:wsId/ralph-sessions/:sessionId/resume', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let dataDir: string;
    let bridgeStub: ReturnType<typeof makeBridgeStub>;

    beforeAll(async () => {
        store = createMockProcessStore();
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-resume-test-'));
        bridgeStub = makeBridgeStub();

        const routes: Route[] = [];
        registerRalphResumeRoutes(routes, { bridge: bridgeStub.bridge, store, dataDir });

        const router = createRouter({ routes, spaHtml: '' });
        server = http.createServer(router);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    beforeEach(async () => {
        store.processes.clear();
        bridgeStub.enqueue.mockClear();
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
        fs.mkdirSync(dataDir, { recursive: true });
    });

    // -----------------------------------------------------------------------
    // Happy paths
    // -----------------------------------------------------------------------

    it('resumes a stuck executing session and enqueues iteration 4', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-stuck');

        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-stuck/resume', {});
        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.resumed).toBe(true);
        expect(data.nextIteration).toBe(4);
        expect(data.maxIterations).toBe(10);
        expect(data.sessionId).toBe('sess-stuck');

        expect(bridgeStub.enqueue).toHaveBeenCalledOnce();
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.context.ralph.sessionId).toBe('sess-stuck');
        expect(enqueueArg.payload.context.ralph.currentIteration).toBe(4);
        expect(enqueueArg.payload.context.ralph.maxIterations).toBe(10);
        expect(enqueueArg.payload.mode).toBe('ralph');

        const progressPath = pathMod.join(dataDir, 'repos', 'ws-1', 'ralph-sessions', 'sess-stuck', 'progress.md');
        const md = fs.readFileSync(progressPath, 'utf-8');
        expect(md).toMatch(/Session resumed at .* picking up from iteration 3/);
    });

    it('preserves the prior concrete provider when resuming a stuck session', async () => {
        await seedSession(dataDir, 'ws-provider', 'sess-provider');
        await store.addProcess({
            id: 'queue_p3',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'last iteration',
            metadata: {
                provider: 'codex',
                model: 'gpt-5.3-codex',
            },
            payload: {
                kind: 'chat',
                mode: 'ralph',
                prompt: 'last iteration',
                provider: 'codex',
                workspaceId: 'ws-provider',
                workingDirectory: '/repos/provider',
            },
        } as any);

        const res = await post(baseUrl, '/api/workspaces/ws-provider/ralph-sessions/sess-provider/resume', {});

        expect(res.status).toBe(200);
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBe('codex');
        expect(enqueueArg.config.model).toBe('gpt-5.3-codex');
    });

    it('resumes a session where last iteration failed', async () => {
        await seedSession(dataDir, 'ws-2', 'sess-failed', {
            currentIteration: 2,
            iterations: [
                { iteration: 1, loopIndex: 1, taskId: 't1', processId: 'p1', startedAt: '2026-05-11T01:00:00Z', endedAt: '2026-05-11T01:10:00Z', status: 'completed' },
                { iteration: 2, loopIndex: 1, taskId: 't2', processId: 'p2', startedAt: '2026-05-11T01:10:00Z', endedAt: '2026-05-11T01:20:00Z', status: 'failed' },
            ],
        });

        const res = await post(baseUrl, '/api/workspaces/ws-2/ralph-sessions/sess-failed/resume', {});
        expect(res.status).toBe(200);
        expect(res.json().nextIteration).toBe(3);
    });

    it('works with an empty request body', async () => {
        await seedSession(dataDir, 'ws-3', 'sess-empty-body');
        const res = await post(baseUrl, '/api/workspaces/ws-3/ralph-sessions/sess-empty-body/resume');
        expect(res.status).toBe(200);
    });

    // -----------------------------------------------------------------------
    // 404
    // -----------------------------------------------------------------------

    it('returns 404 when the session does not exist', async () => {
        const res = await post(baseUrl, '/api/workspaces/ws-x/ralph-sessions/nope/resume', {});
        expect(res.status).toBe(404);
    });

    // -----------------------------------------------------------------------
    // 409 — wrong phase
    // -----------------------------------------------------------------------

    it('rejects when phase is complete', async () => {
        await seedSession(dataDir, 'ws-4', 'sess-complete', {
            phase: 'complete',
            completedAt: '2026-05-11T03:00:00Z',
            terminalReason: 'CAP_REACHED' as RalphTerminalReason,
        });
        const res = await post(baseUrl, '/api/workspaces/ws-4/ralph-sessions/sess-complete/resume', {});
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/phase/i);
    });

    it('rejects when phase is grilling', async () => {
        await seedSession(dataDir, 'ws-5', 'sess-grill', {
            phase: 'grilling',
        });
        const res = await post(baseUrl, '/api/workspaces/ws-5/ralph-sessions/sess-grill/resume', {});
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/phase/i);
    });

    // -----------------------------------------------------------------------
    // 409 — at cap (should use /continue instead)
    // -----------------------------------------------------------------------

    it('rejects when currentIteration >= maxIterations', async () => {
        await seedSession(dataDir, 'ws-6', 'sess-at-cap', {
            currentIteration: 10,
            maxIterations: 10,
        });
        const res = await post(baseUrl, '/api/workspaces/ws-6/ralph-sessions/sess-at-cap/resume', {});
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/cap/i);
    });

    // -----------------------------------------------------------------------
    // 409 — in-flight task
    // -----------------------------------------------------------------------

    it('rejects when a task with this sessionId is still queued', async () => {
        await seedSession(dataDir, 'ws-7', 'sess-busy');
        const inFlightTasks = [{
            id: 't-busy',
            status: 'queued',
            payload: { context: { ralph: { sessionId: 'sess-busy' } } },
        }];
        const localBridge = makeBridgeStub({ tasks: inFlightTasks });
        const localRoutes: Route[] = [];
        registerRalphResumeRoutes(localRoutes, { bridge: localBridge.bridge, store, dataDir });
        const localRouter = createRouter({ routes: localRoutes, spaHtml: '' });
        const localServer = http.createServer(localRouter);
        try {
            await new Promise<void>(r => localServer.listen(0, '127.0.0.1', () => r()));
            const port = (localServer.address() as { port: number }).port;
            const res = await post(`http://127.0.0.1:${port}`, '/api/workspaces/ws-7/ralph-sessions/sess-busy/resume', {});
            expect(res.status).toBe(409);
            expect(res.json().error).toMatch(/queued|running/);
        } finally {
            await new Promise<void>(r => localServer.close(() => r()));
        }
    });

    it('rejects when a task with this sessionId is running', async () => {
        await seedSession(dataDir, 'ws-8', 'sess-running');
        const inFlightTasks = [{
            id: 't-running',
            status: 'running',
            payload: { context: { ralph: { sessionId: 'sess-running' } } },
        }];
        const localBridge = makeBridgeStub({ tasks: inFlightTasks });
        const localRoutes: Route[] = [];
        registerRalphResumeRoutes(localRoutes, { bridge: localBridge.bridge, store, dataDir });
        const localRouter = createRouter({ routes: localRoutes, spaHtml: '' });
        const localServer = http.createServer(localRouter);
        try {
            await new Promise<void>(r => localServer.listen(0, '127.0.0.1', () => r()));
            const port = (localServer.address() as { port: number }).port;
            const res = await post(`http://127.0.0.1:${port}`, '/api/workspaces/ws-8/ralph-sessions/sess-running/resume', {});
            expect(res.status).toBe(409);
            expect(res.json().error).toMatch(/running/);
        } finally {
            await new Promise<void>(r => localServer.close(() => r()));
        }
    });

    // -----------------------------------------------------------------------
    // Resume marker idempotency
    // -----------------------------------------------------------------------

    it('appends resume marker to progress.md', async () => {
        await seedSession(dataDir, 'ws-9', 'sess-marker');
        const res = await post(baseUrl, '/api/workspaces/ws-9/ralph-sessions/sess-marker/resume', {});
        expect(res.status).toBe(200);

        const progressPath = pathMod.join(dataDir, 'repos', 'ws-9', 'ralph-sessions', 'sess-marker', 'progress.md');
        const md = fs.readFileSync(progressPath, 'utf-8');
        const markers = md.match(/Session resumed at/g) ?? [];
        expect(markers).toHaveLength(1);
    });
});
