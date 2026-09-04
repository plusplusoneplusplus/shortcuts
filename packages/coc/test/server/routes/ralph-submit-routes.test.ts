/**
 * Tests for POST /api/workspaces/:workspaceId/ralph-sessions/:sessionId/submit-pr
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphSubmitRoutes } from '../../../src/server/routes/ralph-submit-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore, type MockProcessStore } from '../helpers/mock-process-store';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { _clearSubmitEnqueuedSet } from '../../../src/server/ralph/enqueue-submit';
import type { RalphSessionRecord, RalphTerminalReason } from '../../../src/server/ralph/types';

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
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

function post(baseUrl: string, urlPath: string) {
    return request(baseUrl, urlPath, { method: 'POST', body: '{}' });
}

function makeBridgeStub(opts: { tasks?: any[] } = {}) {
    const tasks = opts.tasks ?? [];
    const enqueue = vi.fn().mockResolvedValue('submit-task-id');
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
        originalGoal: 'Ship the widget feature',
        maxIterations: 10,
        startedAt: '2026-08-19T00:00:00Z',
        baselineSha: 'f'.repeat(40),
    });
    return journal.updateSessionRecord(workspaceId, sessionId, (rec) => ({
        ...(rec as RalphSessionRecord),
        currentIteration: 10,
        phase: 'complete',
        completedAt: '2026-08-19T03:00:00Z',
        terminalReason: 'RALPH_COMPLETE' as RalphTerminalReason,
        iterations: [
            { iteration: 10, loopIndex: 1, taskId: 't10', processId: 'queue_p10', startedAt: '2026-08-19T02:50:00Z', endedAt: '2026-08-19T03:00:00Z', status: 'completed' },
        ],
        ...overrides,
    }));
}

function readRecord(dataDir: string, workspaceId: string, sessionId: string): any {
    const recPath = pathMod.join(dataDir, 'repos', workspaceId, 'ralph-sessions', sessionId, 'session.json');
    return JSON.parse(fs.readFileSync(recPath, 'utf-8'));
}

describe('POST /api/workspaces/:wsId/ralph-sessions/:sessionId/submit-pr', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let dataDir: string;
    let bridgeStub: ReturnType<typeof makeBridgeStub>;

    beforeAll(async () => {
        store = createMockProcessStore();
        dataDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ralph-submit-test-'));
        bridgeStub = makeBridgeStub();

        const routes: Route[] = [];
        registerRalphSubmitRoutes(routes, { bridge: bridgeStub.bridge, store, dataDir });

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
        bridgeStub.enqueue.mockResolvedValue('submit-task-id');
        _clearSubmitEnqueuedSet();
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
        fs.mkdirSync(dataDir, { recursive: true });
    });

    // -----------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------

    it('appends a queued submit record, enqueues the job, and returns 200', async () => {
        await seedSession(dataDir, 'ws-1', 'sess-ok');

        const res = await post(baseUrl, '/api/workspaces/ws-1/ralph-sessions/sess-ok/submit-pr');
        expect(res.status).toBe(200);
        expect(res.json()).toEqual({
            submitted: true,
            sessionId: 'sess-ok',
            taskId: 'submit-task-id',
            submitIndex: 1,
        });

        expect(bridgeStub.enqueue).toHaveBeenCalledOnce();
        const enqueueArg = bridgeStub.enqueue.mock.calls[0][0];
        expect(enqueueArg.payload.mode).toBe('ralph');
        expect(enqueueArg.continuationOfSessionId).toBe('sess-ok');
        expect(enqueueArg.payload.context.ralph.sessionId).toBe('sess-ok');
        expect(enqueueArg.payload.context.ralph.submit).toEqual({
            kind: 'submit-pr',
            submitIndex: 1,
        });
        expect(enqueueArg.payload.context.taskGroup).toMatchObject({
            groupId: 'sess-ok',
            groupType: 'ralph',
            role: 'submit-pr',
            itemKey: 'submit-1',
        });
        // Workspace defaults: no AI-selection payload on the submit job.
        expect(enqueueArg.payload.provider).toBeUndefined();
        expect(enqueueArg.config).toEqual({});
        // Baseline strategy lands in the prompt.
        expect(enqueueArg.payload.prompt).toContain(`${'f'.repeat(40)}..HEAD`);
        expect(enqueueArg.payload.prompt).toContain('submit-commits-as-pr');

        const rec = readRecord(dataDir, 'ws-1', 'sess-ok');
        expect(rec.submits).toHaveLength(1);
        expect(rec.submits[0]).toMatchObject({
            submitIndex: 1,
            status: 'queued',
            taskId: 'submit-task-id',
        });
        expect(typeof rec.submits[0].startedAt).toBe('string');
    });

    it('allows submit for any complete session regardless of terminalReason', async () => {
        for (const reason of ['CAP_REACHED', 'CANCELLED', 'NO_SIGNAL'] as RalphTerminalReason[]) {
            const sid = `sess-${reason.toLowerCase()}`;
            await seedSession(dataDir, 'ws-tr', sid, { terminalReason: reason });
            const res = await post(baseUrl, `/api/workspaces/ws-tr/ralph-sessions/${sid}/submit-pr`);
            expect(res.status, `terminalReason=${reason}`).toBe(200);
        }
    });

    it('uses the time-window strategy in the prompt for legacy sessions without baselineSha', async () => {
        const journal = new RalphSessionStore({ dataDir });
        await journal.initSession('ws-legacy', 'sess-legacy', {
            originalGoal: 'Legacy goal',
            maxIterations: 5,
            startedAt: '2026-08-19T00:00:00Z',
        });
        await journal.updateSessionRecord('ws-legacy', 'sess-legacy', (rec) => ({
            ...(rec as RalphSessionRecord),
            phase: 'complete',
            completedAt: '2026-08-19T02:00:00Z',
            terminalReason: 'RALPH_COMPLETE',
        }));

        const res = await post(baseUrl, '/api/workspaces/ws-legacy/ralph-sessions/sess-legacy/submit-pr');
        expect(res.status).toBe(200);
        const prompt = bridgeStub.enqueue.mock.calls[0][0].payload.prompt;
        expect(prompt).not.toContain('..HEAD');
        expect(prompt).toContain('2026-08-19T00:00:00Z');
        expect(prompt).toContain('2026-08-19T02:00:00Z');
        expect(prompt).toContain('progress');
    });

    it('accepts a second submit after the first reaches a terminal state, with submitIndex 2', async () => {
        await seedSession(dataDir, 'ws-2', 'sess-again');
        const journal = new RalphSessionStore({ dataDir });
        await journal.upsertSubmitRecord('ws-2', 'sess-again', 1, {
            status: 'failed',
            taskId: 'old-task',
            startedAt: '2026-08-19T04:00:00Z',
            completedAt: '2026-08-19T04:01:00Z',
            error: 'dirty worktree',
        });

        const res = await post(baseUrl, '/api/workspaces/ws-2/ralph-sessions/sess-again/submit-pr');
        expect(res.status).toBe(200);
        expect(res.json().submitIndex).toBe(2);

        const rec = readRecord(dataDir, 'ws-2', 'sess-again');
        expect(rec.submits).toHaveLength(2);
        expect(rec.submits[1]).toMatchObject({ submitIndex: 2, status: 'queued' });
    });

    it('closes the range at the last iteration headSha and excludes already-submitted SHAs', async () => {
        await seedSession(dataDir, 'ws-range', 'sess-range', {
            iterations: [
                { iteration: 1, loopIndex: 1, taskId: 't1', processId: 'p1', startedAt: '2026-08-19T01:00:00Z', endedAt: '2026-08-19T01:30:00Z', status: 'completed', headSha: 'a'.repeat(40) },
                { iteration: 2, loopIndex: 1, taskId: 't2', processId: 'p2', startedAt: '2026-08-19T02:00:00Z', endedAt: '2026-08-19T02:30:00Z', status: 'completed', headSha: 'b'.repeat(40) },
            ],
        });
        const journal = new RalphSessionStore({ dataDir });
        await journal.upsertSubmitRecord('ws-range', 'sess-range', 1, {
            status: 'submitted',
            taskId: 'old-task',
            startedAt: '2026-08-19T04:00:00Z',
            completedAt: '2026-08-19T04:01:00Z',
            commitShas: ['c'.repeat(40)],
        });

        const res = await post(baseUrl, '/api/workspaces/ws-range/ralph-sessions/sess-range/submit-pr');
        expect(res.status).toBe(200);

        const prompt = bridgeStub.enqueue.mock.calls[0][0].payload.prompt;
        expect(prompt).toContain(`${'f'.repeat(40)}..${'b'.repeat(40)}`);
        // Regression: submit 2 must not re-send submit 1's commits, and must
        // not sweep in commits made on the branch after the session ended.
        expect(prompt).not.toContain('..HEAD');
        expect(prompt).toContain(`OMIT them from this PR: ${'c'.repeat(40)}`);
    });

    // -----------------------------------------------------------------------
    // 404
    // -----------------------------------------------------------------------

    it('returns 404 when the session does not exist', async () => {
        const res = await post(baseUrl, '/api/workspaces/ws-x/ralph-sessions/nope/submit-pr');
        expect(res.status).toBe(404);
        expect(bridgeStub.enqueue).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // 409 guards
    // -----------------------------------------------------------------------

    it('rejects when the session is not complete', async () => {
        await seedSession(dataDir, 'ws-3', 'sess-exec', {
            phase: 'executing',
            completedAt: undefined,
            terminalReason: undefined,
        });
        const res = await post(baseUrl, '/api/workspaces/ws-3/ralph-sessions/sess-exec/submit-pr');
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(/phase/i);
        expect(bridgeStub.enqueue).not.toHaveBeenCalled();
    });

    it('rejects when a Ralph task for the session is still in flight', async () => {
        await seedSession(dataDir, 'ws-4', 'sess-busy');
        const inFlightTasks = [{
            id: 't-busy',
            status: 'running',
            payload: { context: { ralph: { sessionId: 'sess-busy' } } },
        }];
        const localBridge = makeBridgeStub({ tasks: inFlightTasks });
        const localRoutes: Route[] = [];
        registerRalphSubmitRoutes(localRoutes, { bridge: localBridge.bridge, store, dataDir });
        const localRouter = createRouter({ routes: localRoutes, spaHtml: '' });
        const localServer = http.createServer(localRouter);
        try {
            await new Promise<void>(r => localServer.listen(0, '127.0.0.1', () => r()));
            const port = (localServer.address() as { port: number }).port;
            const res = await post(`http://127.0.0.1:${port}`, '/api/workspaces/ws-4/ralph-sessions/sess-busy/submit-pr');
            expect(res.status).toBe(409);
            expect(res.json().error).toMatch(/queued|running/);
            expect(localBridge.enqueue).not.toHaveBeenCalled();
        } finally {
            await new Promise<void>(r => localServer.close(() => r()));
        }
    });

    it.each(['queued', 'running'] as const)('rejects when a submit is already %s', async (status) => {
        const sid = `sess-active-${status}`;
        await seedSession(dataDir, 'ws-5', sid);
        const journal = new RalphSessionStore({ dataDir });
        await journal.upsertSubmitRecord('ws-5', sid, 1, {
            status,
            taskId: 'prior-task',
            startedAt: '2026-08-19T04:00:00Z',
        });

        const res = await post(baseUrl, `/api/workspaces/ws-5/ralph-sessions/${sid}/submit-pr`);
        expect(res.status).toBe(409);
        expect(res.json().error).toMatch(new RegExp(status));
        expect(bridgeStub.enqueue).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Enqueue failure
    // -----------------------------------------------------------------------

    it('returns 500, persists nothing, and allows a retry when enqueue fails', async () => {
        await seedSession(dataDir, 'ws-6', 'sess-fail');
        bridgeStub.enqueue.mockRejectedValueOnce(new Error('queue down'));

        const res = await post(baseUrl, '/api/workspaces/ws-6/ralph-sessions/sess-fail/submit-pr');
        expect(res.status).toBe(500);
        const rec = readRecord(dataDir, 'ws-6', 'sess-fail');
        expect(rec.submits).toBeUndefined();

        // The in-memory guard was rolled back — a retry succeeds.
        const retry = await post(baseUrl, '/api/workspaces/ws-6/ralph-sessions/sess-fail/submit-pr');
        expect(retry.status).toBe(200);
        expect(retry.json().submitIndex).toBe(1);
    });
});
