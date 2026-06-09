/**
 * Tests for POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/new-loop
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphNewLoopRoutes } from '../../../src/server/routes/ralph-new-loop-routes';
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

function post(baseUrl: string, urlPath: string, body: unknown) {
    return request(baseUrl, urlPath, {
        method: 'POST',
        body: JSON.stringify(body),
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
        currentIteration: 7,
        phase: 'complete',
        completedAt: '2026-05-11T03:00:00Z',
        terminalReason: 'RALPH_COMPLETE' as RalphTerminalReason,
        iterations: [
            {
                iteration: 7,
                loopIndex: 1,
                taskId: 't7',
                processId: 'queue_p7',
                startedAt: '2026-05-11T02:50:00Z',
                endedAt: '2026-05-11T03:00:00Z',
                status: 'completed',
            },
        ],
        ...overrides,
    }));
}

describe('POST /api/workspaces/:wsId/ralph-sessions/:sessionId/new-loop', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let dataDir: string;
    let bridgeStub: ReturnType<typeof makeBridgeStub>;

    beforeAll(async () => {
        store = createMockProcessStore();
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-new-loop-test-'));
        bridgeStub = makeBridgeStub();

        const routes: Route[] = [];
        registerRalphNewLoopRoutes(routes, { bridge: bridgeStub.bridge, store, dataDir });

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
    // Happy path
    // -----------------------------------------------------------------------

    it('starts a new loop on RALPH_COMPLETE session and returns 200 with loopIndex 2', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-complete');

        const res = await post(
            baseUrl,
            '/api/workspaces/ws-1/ralph-sessions/sess-complete/new-loop',
            { newGoal: 'Second goal', additionalIterations: 20 },
        );

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.resumed).toBe(true);
        expect(data.loopIndex).toBe(2);
        expect(data.nextIteration).toBe(8);
        expect(data.newMaxIterations).toBe(30);
        expect(data.sessionId).toBe('sess-complete');
        expect(data.workspaceId).toBe('ws-1');

        // Enqueue was called once with correct payload
        expect(bridgeStub.enqueue).toHaveBeenCalledOnce();
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.mode).toBe('ralph');
        expect(enqueueArg.payload.context.ralph.sessionId).toBe('sess-complete');
        expect(enqueueArg.payload.context.ralph.currentIteration).toBe(8);
        expect(enqueueArg.payload.context.ralph.maxIterations).toBe(30);
        expect(enqueueArg.payload.context.ralph.originalGoal).toBe('Second goal');

        // session.json updated correctly
        const recPath = pathMod.join(
            dataDir, 'repos', 'ws-1', 'ralph-sessions', 'sess-complete', 'session.json',
        );
        const rec = JSON.parse(fs.readFileSync(recPath, 'utf-8'));
        expect(rec.phase).toBe('executing');
        expect(rec.terminalReason).toBeUndefined();
        expect(rec.maxIterations).toBe(30);
        expect(rec.loops).toHaveLength(2);
        expect(rec.loops[1].goal).toBe('Second goal');
        expect(rec.loops[1].loopIndex).toBe(2);

        // progress.md got a loop banner
        const progressPath = pathMod.join(
            dataDir, 'repos', 'ws-1', 'ralph-sessions', 'sess-complete', 'progress.md',
        );
        const md = fs.readFileSync(progressPath, 'utf-8');
        expect(md).toMatch(/## Loop 2/);
        expect(md).toMatch(/Goal: Second goal/);
    });

    it('preserves the prior concrete provider when starting a new loop', async () => {
        await seedSession(dataDir, 'ws-provider', 'sess-provider');
        await store.addProcess({
            id: 'queue_p7',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'last iteration',
            metadata: {
                provider: 'claude',
                model: 'claude-sonnet-4.6',
            },
            payload: {
                kind: 'chat',
                mode: 'ralph',
                prompt: 'last iteration',
                provider: 'claude',
                workspaceId: 'ws-provider',
                workingDirectory: '/repos/provider',
            },
        } as any);

        const res = await post(
            baseUrl,
            '/api/workspaces/ws-provider/ralph-sessions/sess-provider/new-loop',
            { newGoal: 'Second goal', additionalIterations: 5 },
        );

        expect(res.status).toBe(200);
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBe('claude');
        expect(enqueueArg.config.model).toBe('claude-sonnet-4.6');
    });

    it('uses default additionalIterations when omitted', async () => {
        await seedSession(dataDir, 'ws-def', 'sess-def');

        const res = await post(
            baseUrl,
            '/api/workspaces/ws-def/ralph-sessions/sess-def/new-loop',
            { newGoal: 'Another goal' },
        );
        expect(res.status).toBe(200);
        // Default is RALPH_DEFAULT_MAX_ITERATIONS (20), so 10 + 20 = 30
        expect(res.json().newMaxIterations).toBe(30);
    });

    it('uses per-repo maxRalphIterations preference when body omits additionalIterations', async () => {
        await seedSession(dataDir, 'ws-pref', 'sess-pref');
        const prefsDir = pathMod.join(dataDir, 'repos', 'ws-pref');
        fs.mkdirSync(prefsDir, { recursive: true });
        fs.writeFileSync(
            pathMod.join(prefsDir, 'preferences.json'),
            JSON.stringify({ maxRalphIterations: 5 }),
            'utf-8',
        );

        const res = await post(
            baseUrl,
            '/api/workspaces/ws-pref/ralph-sessions/sess-pref/new-loop',
            { newGoal: 'Pref goal' },
        );
        expect(res.status).toBe(200);
        expect(res.json().newMaxIterations).toBe(15);
    });

    // -----------------------------------------------------------------------
    // 400 — missing/invalid body
    // -----------------------------------------------------------------------

    it('returns 400 when newGoal is missing', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-missing-goal');
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-a/ralph-sessions/sess-missing-goal/new-loop',
            { additionalIterations: 5 },
        );
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/newGoal/i);
    });

    it('returns 400 when newGoal is empty string', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-empty-goal');
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-a/ralph-sessions/sess-empty-goal/new-loop',
            { newGoal: '   ' },
        );
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/newGoal/i);
    });

    it('returns 400 when additionalIterations is 0', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-zero-add');
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-a/ralph-sessions/sess-zero-add/new-loop',
            { newGoal: 'valid', additionalIterations: 0 },
        );
        expect(res.status).toBe(400);
    });

    it('returns 400 when additionalIterations > 200', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-big-add');
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-a/ralph-sessions/sess-big-add/new-loop',
            { newGoal: 'valid', additionalIterations: 201 },
        );
        expect(res.status).toBe(400);
    });

    it('returns 400 when additionalIterations is non-integer', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-frac');
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-a/ralph-sessions/sess-frac/new-loop',
            { newGoal: 'valid', additionalIterations: 5.5 },
        );
        expect(res.status).toBe(400);
    });

    it('returns 400 when resulting maxIterations would exceed the 500 hard cap', async () => {
        await seedSession(dataDir, 'ws-cap', 'sess-cap', { maxIterations: 480 });
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-cap/ralph-sessions/sess-cap/new-loop',
            { newGoal: 'valid', additionalIterations: 50 },
        );
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/hard cap/i);
    });

    // -----------------------------------------------------------------------
    // 404 — session not found
    // -----------------------------------------------------------------------

    it('returns 404 when session does not exist', async () => {
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-x/ralph-sessions/ghost/new-loop',
            { newGoal: 'valid' },
        );
        expect(res.status).toBe(404);
    });

    // -----------------------------------------------------------------------
    // 409 — session not eligible for new-loop
    // -----------------------------------------------------------------------

    it('returns 409 when session phase is executing', async () => {
        await seedSession(dataDir, 'ws-2', 'sess-exec', {
            phase: 'executing',
            completedAt: undefined,
            terminalReason: undefined,
        });
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-2/ralph-sessions/sess-exec/new-loop',
            { newGoal: 'valid' },
        );
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/phase/i);
    });

    it('returns 409 when session is CAP_REACHED (use /continue instead)', async () => {
        await seedSession(dataDir, 'ws-3', 'sess-cap-reached', {
            terminalReason: 'CAP_REACHED',
        });
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-3/ralph-sessions/sess-cap-reached/new-loop',
            { newGoal: 'valid' },
        );
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/continue|RALPH_COMPLETE/i);
    });

    it('returns 409 when session has manual verification pending', async () => {
        await seedSession(dataDir, 'ws-3', 'sess-manual', {
            terminalReason: 'MANUAL_VERIFICATION_ONLY',
        });
        const res = await post(
            baseUrl,
            '/api/workspaces/ws-3/ralph-sessions/sess-manual/new-loop',
            { newGoal: 'valid' },
        );
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/manual verification/i);
    });

    it('returns 409 when a task for this session is still queued', async () => {
        await seedSession(dataDir, 'ws-4', 'sess-busy');
        const inFlightTasks = [{
            id: 't-busy',
            status: 'queued',
            payload: { context: { ralph: { sessionId: 'sess-busy' } } },
        }];
        const localBridge = makeBridgeStub({ tasks: inFlightTasks });
        const localRoutes: Route[] = [];
        registerRalphNewLoopRoutes(localRoutes, { bridge: localBridge.bridge, store, dataDir });
        const localRouter = createRouter({ routes: localRoutes, spaHtml: '' });
        const localServer = http.createServer(localRouter);
        try {
            await new Promise<void>(r => localServer.listen(0, '127.0.0.1', () => r()));
            const port = (localServer.address() as { port: number }).port;
            const res = await post(
                `http://127.0.0.1:${port}`,
                '/api/workspaces/ws-4/ralph-sessions/sess-busy/new-loop',
                { newGoal: 'valid' },
            );
            expect(res.status).toBe(409);
            expect(res.json().error).toMatch(/queued|running/);
        } finally {
            await new Promise<void>(r => localServer.close(() => r()));
        }
    });
});
