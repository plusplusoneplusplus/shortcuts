/**
 * Tests for GET /api/workspaces/:workspaceId/ralph-sessions/:sessionId.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerRalphSessionRoutes } from '../../../src/server/routes/ralph-session-routes';
import type { Route } from '../../../src/server/types';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { createMockProcessStore, type MockProcessStore } from '../../helpers/mock-process-store';

function getJson(baseUrl: string, urlPath: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    let body: any = text;
                    try { body = JSON.parse(text); } catch { /* leave as text */ }
                    resolve({ status: res.statusCode || 0, body });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

/**
 * Minimal MultiRepoQueueRouter stub exposing only what
 * `findInFlightRalphTask` reads: `registry.getAllQueues()` → managers with
 * `getAll()`. The task list is mutable so individual tests can seed in-flight
 * tasks for the session under test.
 */
function makeBridgeStub(tasksRef: { tasks: any[] }) {
    return {
        registry: {
            getAllQueues: () => new Map([['repo-1', { getAll: () => tasksRef.tasks }]]),
        },
    } as any;
}

describe('GET /api/workspaces/:workspaceId/ralph-sessions/:sessionId', () => {
    let server: http.Server;
    let baseUrl: string;
    let dataDir: string;
    let processStore: MockProcessStore;
    const tasksRef: { tasks: any[] } = { tasks: [] };

    const WS = 'ws-1';
    const SID = 'session-1';

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-session-routes-test-'));
        processStore = createMockProcessStore();

        const routes: Route[] = [];
        registerRalphSessionRoutes(routes, { dataDir, store: processStore, bridge: makeBridgeStub(tasksRef) });

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
        // Reset session dir between tests
        processStore.processes.clear();
        tasksRef.tasks = [];
        const sessionDir = path.join(dataDir, 'repos', WS, 'ralph-sessions', SID);
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('returns 404 when the session does not exist', async () => {
        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);
        expect(r.status).toBe(404);
    });

    it('returns the session record and parsed sections for an existing session', async () => {
        const store = new RalphSessionStore({ dataDir });
        await store.initSession(WS, SID, { originalGoal: 'build the thing', maxIterations: 10 });
        await store.appendProgressSection(WS, SID, {
            iteration: 1,
            signal: 'RALPH_NEXT',
            timestamp: '2025-01-01T00:00:00.000Z',
            body: 'Files: a.ts\nDecisions: pick path A\nRemaining: tests',
        });
        await store.appendProgressSection(WS, SID, {
            iteration: 2,
            signal: 'RALPH_COMPLETE',
            timestamp: '2025-01-01T00:05:00.000Z',
            body: 'Files: b.ts\nDecisions: done\nRemaining: none',
        });

        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);
        expect(r.status).toBe(200);
        expect(r.body.record.sessionId).toBe(SID);
        expect(r.body.record.originalGoal).toBe('build the thing');
        expect(Array.isArray(r.body.sections)).toBe(true);
        expect(r.body.sections).toHaveLength(2);
        expect(r.body.sections[0]).toMatchObject({ iteration: 1, signal: 'RALPH_NEXT' });
        expect(r.body.sections[1]).toMatchObject({ iteration: 2, signal: 'RALPH_COMPLETE' });
    });

    it('returns raw session files in alphabetical order', async () => {
        const store = new RalphSessionStore({ dataDir });
        await store.initSession(WS, SID, {
            originalGoal: 'inspect files',
            maxIterations: 2,
            startedAt: '2026-06-02T00:00:00.000Z',
        });
        const dir = store.getSessionDir(WS, SID);
        await fs.promises.writeFile(path.join(dir, 'z-extra.json'), '{"z":true}', 'utf-8');
        await fs.promises.writeFile(path.join(dir, 'a-extra.md'), '# Extra\nraw markdown', 'utf-8');

        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);

        expect(r.status).toBe(200);
        expect(r.body.files.map((file: { name: string }) => file.name)).toEqual([
            'a-extra.md',
            'progress.md',
            'session.json',
            'z-extra.json',
        ]);
        expect(r.body.files.find((file: { name: string }) => file.name === 'a-extra.md')?.content)
            .toBe('# Extra\nraw markdown');
        expect(r.body.files.find((file: { name: string }) => file.name === 'z-extra.json')?.content)
            .toBe('{"z":true}');
        expect(r.body.files.find((file: { name: string }) => file.name === 'progress.md')?.content)
            .toContain('# Ralph Session: session-1');
        expect(r.body.files.find((file: { name: string }) => file.name === 'session.json')?.content)
            .toContain('"originalGoal": "inspect files"');
    });

    it('returns an empty sections array when session.json exists but progress.md does not', async () => {
        const store = new RalphSessionStore({ dataDir });
        await store.initSession(WS, SID, { originalGoal: 'g', maxIterations: 1 });
        // Remove the progress file that initSession may have created.
        try { fs.unlinkSync(store.getProgressPath(WS, SID)); } catch { /* ignore */ }

        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);
        expect(r.status).toBe(200);
        expect(r.body.sections).toEqual([]);
    });

    it('returns transient resume defaults recovered from the latest iteration process', async () => {
        const store = new RalphSessionStore({ dataDir });
        await store.initSession(WS, SID, { originalGoal: 'resume defaults', maxIterations: 10 });
        await store.updateSessionRecord(WS, SID, (rec) => ({
            ...rec,
            currentIteration: 2,
            phase: 'executing',
            iterations: [
                { iteration: 1, loopIndex: 1, taskId: 't1', processId: 'queue_old', startedAt: '2026-06-01T00:00:00Z', status: 'completed' },
                { iteration: 2, loopIndex: 1, taskId: 't2', processId: 'queue_latest', startedAt: '2026-06-01T00:10:00Z', status: 'completed' },
            ],
        }));
        await processStore.addProcess({
            id: 'queue_latest',
            type: 'chat',
            status: 'completed',
            startTime: new Date('2026-06-01T00:10:00Z'),
            promptPreview: 'latest',
            metadata: {
                workspaceId: WS,
                provider: 'codex',
                model: 'gpt-5.3-codex',
            },
            payload: {
                kind: 'chat',
                mode: 'ralph',
                provider: 'codex',
                reasoningEffort: 'high',
            },
        } as any);

        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);

        expect(r.status).toBe(200);
        expect(r.body.resumeDefaults).toEqual({
            provider: 'codex',
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high',
        });
    });

    it('omits resume defaults when the latest iteration process cannot be recovered in the workspace', async () => {
        const store = new RalphSessionStore({ dataDir });
        await store.initSession(WS, SID, { originalGoal: 'missing defaults', maxIterations: 10 });
        await store.updateSessionRecord(WS, SID, (rec) => ({
            ...rec,
            currentIteration: 1,
            phase: 'executing',
            iterations: [
                { iteration: 1, loopIndex: 1, taskId: 't1', processId: 'queue_other-ws', startedAt: '2026-06-01T00:00:00Z', status: 'completed' },
            ],
        }));
        await processStore.addProcess({
            id: 'queue_other-ws',
            type: 'chat',
            status: 'completed',
            startTime: new Date('2026-06-01T00:00:00Z'),
            promptPreview: 'other workspace',
            metadata: {
                workspaceId: 'different-workspace',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
            },
            payload: {
                kind: 'chat',
                mode: 'ralph',
                provider: 'claude',
                reasoningEffort: 'medium',
            },
        } as any);

        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);

        expect(r.status).toBe(200);
        expect(r.body.resumeDefaults).toBeUndefined();
    });

    it('reports hasInFlightTask=false when no queued/running task backs the session', async () => {
        const store = new RalphSessionStore({ dataDir });
        // Mirror the user-reported stuck state: executing, but the first
        // iteration was cancelled before it was ever recorded.
        await store.initSession(WS, SID, { originalGoal: 'stuck', maxIterations: 20 });

        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);

        expect(r.status).toBe(200);
        expect(r.body.record.phase).toBe('executing');
        expect(r.body.record.currentIteration).toBe(0);
        expect(r.body.record.iterations).toEqual([]);
        expect(r.body.hasInFlightTask).toBe(false);
    });

    it('reports hasInFlightTask=true when a queued/running task exists for the session', async () => {
        const store = new RalphSessionStore({ dataDir });
        await store.initSession(WS, SID, { originalGoal: 'running', maxIterations: 20 });
        tasksRef.tasks = [
            {
                id: 'queue_running',
                status: 'running',
                payload: { context: { ralph: { sessionId: SID } } },
            },
        ];

        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);

        expect(r.status).toBe(200);
        expect(r.body.hasInFlightTask).toBe(true);
    });

    it('does not count an in-flight task belonging to a different session', async () => {
        const store = new RalphSessionStore({ dataDir });
        await store.initSession(WS, SID, { originalGoal: 'other', maxIterations: 20 });
        tasksRef.tasks = [
            {
                id: 'queue_other',
                status: 'queued',
                payload: { context: { ralph: { sessionId: 'some-other-session' } } },
            },
        ];

        const r = await getJson(baseUrl, `/api/workspaces/${WS}/ralph-sessions/${SID}`);

        expect(r.status).toBe(200);
        expect(r.body.hasInFlightTask).toBe(false);
    });

    it('URL-decodes workspaceId and sessionId path segments', async () => {
        const wsEnc = 'ws with space';
        const sidEnc = 'sid/with-special';
        // Encode ourselves: '/' would split the path, so test only space
        const ws2 = 'ws with space';
        const sid2 = 'sid-special';
        const store = new RalphSessionStore({ dataDir });
        await store.initSession(ws2, sid2, { originalGoal: 'g', maxIterations: 1 });
        const r = await getJson(
            baseUrl,
            `/api/workspaces/${encodeURIComponent(ws2)}/ralph-sessions/${encodeURIComponent(sid2)}`,
        );
        expect(r.status).toBe(200);
        expect(r.body.record.sessionId).toBe(sid2);
        // unused locals are fine
        expect(wsEnc).toBeDefined();
        expect(sidEnc).toBeDefined();
    });
});
