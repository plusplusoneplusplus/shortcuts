/**
 * Tests for POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/continue
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphContinueRoutes } from '../../../src/server/routes/ralph-continue-routes';
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
        currentIteration: 10,
        phase: 'complete',
        completedAt: '2026-05-11T03:00:00Z',
        terminalReason: 'CAP_REACHED' as RalphTerminalReason,
        iterations: [
            { iteration: 10, loopIndex: 1, taskId: 't10', processId: 'queue_p10', startedAt: '2026-05-11T02:50:00Z', endedAt: '2026-05-11T03:00:00Z', status: 'completed' },
        ],
        ...overrides,
    }));
}

describe('POST /api/workspaces/:wsId/ralph-sessions/:sessionId/continue', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let dataDir: string;
    let bridgeStub: ReturnType<typeof makeBridgeStub>;

    beforeAll(async () => {
        store = createMockProcessStore();
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-continue-test-'));
        bridgeStub = makeBridgeStub();

        const routes: Route[] = [];
        registerRalphContinueRoutes(routes, { bridge: bridgeStub.bridge, store, dataDir });

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
        // Clear data dir per test
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
        fs.mkdirSync(dataDir, { recursive: true });
    });

    // -----------------------------------------------------------------------
    // Happy paths
    // -----------------------------------------------------------------------

    it('continues a CAP_REACHED session and enqueues iteration 11', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-cap');

        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-cap/continue', {
            additionalIterations: 5,
        });
        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.resumed).toBe(true);
        expect(data.nextIteration).toBe(11);
        expect(data.newMaxIterations).toBe(15);

        expect(bridgeStub.enqueue).toHaveBeenCalledOnce();
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.context.ralph.sessionId).toBe('sess-cap');
        expect(enqueueArg.payload.context.ralph.currentIteration).toBe(11);
        expect(enqueueArg.payload.context.ralph.maxIterations).toBe(15);
        expect(enqueueArg.payload.mode).toBe('ralph');

        // session.json updated
        const recPath = pathMod.join(dataDir, 'repos', 'ws-1', 'ralph-sessions', 'sess-cap', 'session.json');
        const rec = JSON.parse(fs.readFileSync(recPath, 'utf-8'));
        expect(rec.maxIterations).toBe(15);
        expect(rec.phase).toBe('executing');
        expect(rec.terminalReason).toBeUndefined();

        // progress.md got the marker
        const progressPath = pathMod.join(dataDir, 'repos', 'ws-1', 'ralph-sessions', 'sess-cap', 'progress.md');
        const md = fs.readFileSync(progressPath, 'utf-8');
        expect(md).toMatch(/Loop continued at .* extending to 15/);
    });

    it('preserves the prior concrete provider and model when continuing a session', async () => {
        await seedSession(dataDir, 'ws-provider', 'sess-provider');
        await store.addProcess({
            id: 'queue_p10',
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
                reasoningEffort: 'high',
                workspaceId: 'ws-provider',
                workingDirectory: '/repos/provider',
            },
        } as any);

        const res = await post(baseUrl, '/api/workspaces/ws-provider/ralph-sessions/sess-provider/continue', {
            additionalIterations: 5,
        });

        expect(res.status).toBe(200);
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBe('claude');
        expect(enqueueArg.config).toMatchObject({
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
        });
    });

    it('uses explicit provider, model, reasoning effort, and effort tier overrides for the continued iteration', async () => {
        await seedSession(dataDir, 'ws-overrides', 'sess-overrides');
        await store.addProcess({
            id: 'queue_p10',
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
                reasoningEffort: 'medium',
                workspaceId: 'ws-overrides',
                workingDirectory: '/repos/overrides',
            },
        } as any);

        const res = await post(baseUrl, '/api/workspaces/ws-overrides/ralph-sessions/sess-overrides/continue', {
            additionalIterations: 5,
            provider: 'claude',
            config: {
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                effortTier: 'low',
            },
        });

        expect(res.status).toBe(200);
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBe('claude');
        expect(enqueueArg.config.model).toBe('claude-sonnet-4.6');
        expect(enqueueArg.config.reasoningEffort).toBe('high');
        expect(enqueueArg.config.effortTier).toBe('low');
    });

    it('supports Auto provider routing with an explicit effort tier override', async () => {
        await seedSession(dataDir, 'ws-auto', 'sess-auto');

        const res = await post(baseUrl, '/api/workspaces/ws-auto/ralph-sessions/sess-auto/continue', {
            additionalIterations: 5,
            autoProviderRouting: true,
            config: { effortTier: 'high' },
        });

        expect(res.status).toBe(200);
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBeUndefined();
        expect(enqueueArg.config.effortTier).toBe('high');
        expect(enqueueArg.payload.context.autoProviderRouting).toEqual({ requested: true });
    });

    it('lets an explicit effort tier override recovered model and reasoning effort', async () => {
        await seedSession(dataDir, 'ws-tier-only', 'sess-tier-only');
        await store.addProcess({
            id: 'queue_p10',
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
                reasoningEffort: 'xhigh',
                workspaceId: 'ws-tier-only',
                workingDirectory: '/repos/tier-only',
            },
        } as any);

        const res = await post(baseUrl, '/api/workspaces/ws-tier-only/ralph-sessions/sess-tier-only/continue', {
            additionalIterations: 5,
            config: { effortTier: 'medium' },
        });

        expect(res.status).toBe(200);
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.provider).toBe('codex');
        expect(enqueueArg.config.model).toBeUndefined();
        expect(enqueueArg.config.reasoningEffort).toBeUndefined();
        expect(enqueueArg.config.effortTier).toBe('medium');
    });

    it('rejects invalid provider overrides', async () => {
        await seedSession(dataDir, 'ws-invalid-provider', 'sess-invalid-provider');

        const res = await post(baseUrl, '/api/workspaces/ws-invalid-provider/ralph-sessions/sess-invalid-provider/continue', {
            additionalIterations: 5,
            provider: 'bogus',
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/Invalid provider/);
        expect(bridgeStub.enqueue).not.toHaveBeenCalled();
    });

    it('rejects invalid reasoning effort overrides', async () => {
        await seedSession(dataDir, 'ws-invalid-effort', 'sess-invalid-effort');

        const res = await post(baseUrl, '/api/workspaces/ws-invalid-effort/ralph-sessions/sess-invalid-effort/continue', {
            additionalIterations: 5,
            config: { reasoningEffort: 'maximum' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/Invalid reasoningEffort/);
        expect(bridgeStub.enqueue).not.toHaveBeenCalled();
    });

    it('rejects invalid effort tier overrides', async () => {
        await seedSession(dataDir, 'ws-invalid-tier', 'sess-invalid-tier');

        const res = await post(baseUrl, '/api/workspaces/ws-invalid-tier/ralph-sessions/sess-invalid-tier/continue', {
            additionalIterations: 5,
            config: { effortTier: 'maximum' },
        });

        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/Invalid effortTier/);
        expect(bridgeStub.enqueue).not.toHaveBeenCalled();
    });

    it('continues a NO_SIGNAL session at the cap', async () => {
        await seedSession(dataDir, 'ws-2', 'sess-no-signal', {
            terminalReason: 'NO_SIGNAL',
        });

        const res = await post(baseUrl, '/api/workspaces/ws-2/ralph-sessions/sess-no-signal/continue', {
            additionalIterations: 3,
        });
        expect(res.status).toBe(200);
        expect(res.json().newMaxIterations).toBe(13);
    });

    it('falls back to default 20 when additionalIterations is omitted', async () => {
        await seedSession(dataDir, 'ws-3', 'sess-default');
        const res = await post(baseUrl, '/api/workspaces/ws-3/ralph-sessions/sess-default/continue', {});
        expect(res.status).toBe(200);
        expect(res.json().newMaxIterations).toBe(30);
    });

    it('uses per-repo maxRalphIterations preference when body omits the override', async () => {
        await seedSession(dataDir, 'ws-pref', 'sess-pref');
        const prefsDir = pathMod.join(dataDir, 'repos', 'ws-pref');
        fs.mkdirSync(prefsDir, { recursive: true });
        fs.writeFileSync(
            pathMod.join(prefsDir, 'preferences.json'),
            JSON.stringify({ maxRalphIterations: 7 }),
            'utf-8',
        );

        const res = await post(baseUrl, '/api/workspaces/ws-pref/ralph-sessions/sess-pref/continue', {});
        expect(res.status).toBe(200);
        expect(res.json().newMaxIterations).toBe(17);
    });

    // -----------------------------------------------------------------------
    // 404
    // -----------------------------------------------------------------------

    it('returns 404 when the session does not exist', async () => {
        const res = await post(baseUrl, '/api/workspaces/ws-x/ralph-sessions/nope/continue', {});
        expect(res.status).toBe(404);
    });

    // -----------------------------------------------------------------------
    // 409 — invalid terminal state
    // -----------------------------------------------------------------------

    it('rejects when phase is executing', async () => {
        await seedSession(dataDir, 'ws-4', 'sess-exec', {
            phase: 'executing',
            completedAt: undefined,
            terminalReason: undefined,
        });
        const res = await post(baseUrl, '/api/workspaces/ws-4/ralph-sessions/sess-exec/continue', {});
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/phase/i);
    });

    it('rejects when terminalReason is RALPH_COMPLETE', async () => {
        await seedSession(dataDir, 'ws-5', 'sess-complete', {
            terminalReason: 'RALPH_COMPLETE',
        });
        const res = await post(baseUrl, '/api/workspaces/ws-5/ralph-sessions/sess-complete/continue', {});
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/RALPH_COMPLETE/);
    });

    it('rejects when terminalReason is MANUAL_VERIFICATION_ONLY', async () => {
        await seedSession(dataDir, 'ws-5', 'sess-manual', {
            terminalReason: 'MANUAL_VERIFICATION_ONLY',
        });
        const res = await post(baseUrl, '/api/workspaces/ws-5/ralph-sessions/sess-manual/continue', {});
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/manual verification/i);
    });

    it('rejects when terminalReason is CANCELLED', async () => {
        await seedSession(dataDir, 'ws-6', 'sess-cancelled', {
            terminalReason: 'CANCELLED',
        });
        const res = await post(baseUrl, '/api/workspaces/ws-6/ralph-sessions/sess-cancelled/continue', {});
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/cancelled/i);
    });

    it('continues a NO_SIGNAL session before the cap (early agent failure)', async () => {
        await seedSession(dataDir, 'ws-7', 'sess-mid', {
            terminalReason: 'NO_SIGNAL',
            currentIteration: 4,
            maxIterations: 10,
        });
        const res = await post(baseUrl, '/api/workspaces/ws-7/ralph-sessions/sess-mid/continue', {
            additionalIterations: 5,
        });
        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.resumed).toBe(true);
        expect(data.nextIteration).toBe(5);
        expect(data.newMaxIterations).toBe(15);
    });

    // -----------------------------------------------------------------------
    // 409 — in-flight task with same sessionId
    // -----------------------------------------------------------------------

    it('rejects when a task with this sessionId is still queued', async () => {
        await seedSession(dataDir, 'ws-8', 'sess-busy');
        // Replace bridgeStub with one that has an in-flight task
        const inFlightTasks = [{
            id: 't-busy',
            status: 'queued',
            payload: { context: { ralph: { sessionId: 'sess-busy' } } },
        }];
        const localBridge = makeBridgeStub({ tasks: inFlightTasks });
        const localRoutes: Route[] = [];
        registerRalphContinueRoutes(localRoutes, { bridge: localBridge.bridge, store, dataDir });
        const localRouter = createRouter({ routes: localRoutes, spaHtml: '' });
        const localServer = http.createServer(localRouter);
        try {
            await new Promise<void>(r => localServer.listen(0, '127.0.0.1', () => r()));
            const port = (localServer.address() as { port: number }).port;
            const res = await post(`http://127.0.0.1:${port}`, '/api/workspaces/ws-8/ralph-sessions/sess-busy/continue', {});
            expect(res.status).toBe(409);
            expect(res.json().error).toMatch(/queued|running/);
        } finally {
            await new Promise<void>(r => localServer.close(() => r()));
        }
    });

    // -----------------------------------------------------------------------
    // 400 — bad additionalIterations
    // -----------------------------------------------------------------------

    it('rejects additionalIterations = 0', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-z');
        const res = await post(baseUrl, '/api/workspaces/ws-a/ralph-sessions/sess-z/continue', {
            additionalIterations: 0,
        });
        expect(res.status).toBe(400);
    });

    it('rejects negative additionalIterations', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-neg');
        const res = await post(baseUrl, '/api/workspaces/ws-a/ralph-sessions/sess-neg/continue', {
            additionalIterations: -5,
        });
        expect(res.status).toBe(400);
    });

    it('rejects additionalIterations > 200', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-big');
        const res = await post(baseUrl, '/api/workspaces/ws-a/ralph-sessions/sess-big/continue', {
            additionalIterations: 201,
        });
        expect(res.status).toBe(400);
    });

    it('rejects non-integer additionalIterations', async () => {
        await seedSession(dataDir, 'ws-a', 'sess-frac');
        const res = await post(baseUrl, '/api/workspaces/ws-a/ralph-sessions/sess-frac/continue', {
            additionalIterations: 5.5,
        });
        expect(res.status).toBe(400);
    });

    // -----------------------------------------------------------------------
    // 400 — hard-cap
    // -----------------------------------------------------------------------

    it('rejects when newMax would exceed the 500-iteration hard cap', async () => {
        await seedSession(dataDir, 'ws-cap', 'sess-cap2', {
            maxIterations: 450,
        });
        const res = await post(baseUrl, '/api/workspaces/ws-cap/ralph-sessions/sess-cap2/continue', {
            additionalIterations: 100,
        });
        expect(res.status).toBe(400);
        expect(res.json().error).toMatch(/hard cap/i);
    });
});
