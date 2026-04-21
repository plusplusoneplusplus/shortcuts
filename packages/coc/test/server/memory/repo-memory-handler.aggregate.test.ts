import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RawMemoryRecordStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../../../src/server/types';
import { registerRepoMemoryRoutes } from '../../../src/server/memory/repo-memory-handler';
import { createTestRouter } from './test-helpers';

// Minimal fake types matching QueuedTask shape
interface FakeTask {
    id: string;
    type: string;
    status: string;
    payload: Record<string, unknown>;
    createdAt: number;
    completedAt?: number;
    processId?: string;
    error?: string;
    priority: string;
    config: Record<string, unknown>;
    displayName?: string;
    repoId?: string;
}

function createFakeQueueManager() {
    const tasks: FakeTask[] = [];
    let nextId = 1;

    return {
        getAll: vi.fn(() => [...tasks]),
        enqueue: vi.fn((opts: any) => {
            const id = opts.id ?? `t-${nextId++}`;
            const task: FakeTask = {
                id,
                type: opts.type,
                status: 'queued',
                payload: opts.payload,
                createdAt: Date.now(),
                processId: opts.processId,
                priority: opts.priority ?? 'low',
                config: opts.config ?? {},
                displayName: opts.displayName,
                repoId: opts.repoId,
            };
            tasks.push(task);
            return id;
        }),
        getTask: vi.fn((id: string) => tasks.find(t => t.id === id)),
        _tasks: tasks,
        _addExisting(t: FakeTask) { tasks.push(t); },
    };
}

function createFakeStore(workspaces: Array<{ id: string; rootPath: string }> = []) {
    return {
        getWorkspaces: vi.fn(async () => workspaces),
    } as any;
}

describe('repo-memory-handler aggregate routes', () => {
    let tmpDir: string;
    const wsId = 'ws-test-1';
    const wsRoot = '/fake/repo';

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-mem-agg-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function setup(opts?: { queueManager?: any; workspaces?: Array<{ id: string; rootPath: string }> }) {
        const routes: Route[] = [];
        const queueManager = opts?.queueManager ?? createFakeQueueManager();
        const store = createFakeStore(opts?.workspaces ?? [{ id: wsId, rootPath: wsRoot }]);
        registerRepoMemoryRoutes(routes, tmpDir, { store, queueManager });
        const router = createTestRouter(routes);
        return { router, queueManager, store };
    }

    // ── GET overview: raw-record stats ──────────────────────────────────

    describe('GET /api/repos/:repoId/memory/overview', () => {
        it('returns zero raw counts when no raw-memory DB exists', async () => {
            const { router } = setup();
            const res = await router.get(`/api/repos/${wsId}/memory/overview`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.pendingRawCount).toBe(0);
            expect(body.claimedRawCount).toBe(0);
        });

        it('returns raw-record counts from existing DB', async () => {
            // Create a real raw-memory DB with some records
            const memDir = path.join(tmpDir, 'repos', wsId, 'memory');
            fs.mkdirSync(memDir, { recursive: true });
            const rawDbPath = path.join(memDir, 'raw-memory.db');
            const rawStore = new RawMemoryRecordStore({ dbPath: rawDbPath });
            await rawStore.append({ target: 'memory', content: 'fact 1', source: 'ai', workspaceId: wsId });
            await rawStore.append({ target: 'memory', content: 'fact 2', source: 'ai', workspaceId: wsId });
            await rawStore.append({ target: 'memory', content: 'fact 3', source: 'ai', workspaceId: wsId });
            rawStore.close();

            const { router } = setup();
            const res = await router.get(`/api/repos/${wsId}/memory/overview`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.pendingRawCount).toBe(3);
            expect(body.claimedRawCount).toBe(0);
        });

        it('reports consolidation status idle when no queue tasks exist', async () => {
            const { router } = setup();
            const res = await router.get(`/api/repos/${wsId}/memory/overview`);
            const body = res.json();
            expect(body.consolidationStatus).toBe('idle');
            expect(body.consolidationTaskId).toBeUndefined();
            expect(body.consolidationProcessId).toBeUndefined();
        });

        it('reports consolidation status queued when a queued task exists', async () => {
            const qm = createFakeQueueManager();
            qm._addExisting({
                id: 'agg-1',
                type: 'memory-aggregate',
                status: 'queued',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: Date.now(),
                processId: 'proc-1',
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            const res = await router.get(`/api/repos/${wsId}/memory/overview`);
            const body = res.json();
            expect(body.consolidationStatus).toBe('queued');
            expect(body.consolidationTaskId).toBe('agg-1');
            expect(body.consolidationProcessId).toBe('proc-1');
        });

        it('reports consolidation status running when a running task exists', async () => {
            const qm = createFakeQueueManager();
            qm._addExisting({
                id: 'agg-r',
                type: 'memory-aggregate',
                status: 'running',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: Date.now(),
                processId: 'proc-r',
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            const res = await router.get(`/api/repos/${wsId}/memory/overview`);
            const body = res.json();
            expect(body.consolidationStatus).toBe('running');
            expect(body.consolidationTaskId).toBe('agg-r');
        });

        it('reports lastAggregatedAt from most recent completed task', async () => {
            const qm = createFakeQueueManager();
            const completedAt = Date.now() - 5000;
            qm._addExisting({
                id: 'agg-done',
                type: 'memory-aggregate',
                status: 'completed',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: completedAt - 10000,
                completedAt,
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            const res = await router.get(`/api/repos/${wsId}/memory/overview`);
            const body = res.json();
            expect(body.consolidationStatus).toBe('idle');
            expect(body.lastAggregatedAt).toBe(new Date(completedAt).toISOString());
        });

        it('reports lastAggregateError from most recent failed task', async () => {
            const qm = createFakeQueueManager();
            qm._addExisting({
                id: 'agg-fail',
                type: 'memory-aggregate',
                status: 'failed',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: Date.now() - 10000,
                error: 'AI model not available',
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            const res = await router.get(`/api/repos/${wsId}/memory/overview`);
            const body = res.json();
            expect(body.lastAggregateError).toBe('AI model not available');
        });

        it('returns 404 for unknown workspace', async () => {
            const { router } = setup();
            const res = await router.get('/api/repos/unknown-ws/memory/overview');
            expect(res.status).toBe(404);
        });

        it('includes bounded memory stats', async () => {
            // Write MEMORY.md
            const memDir = path.join(tmpDir, 'repos', wsId, 'memory');
            fs.mkdirSync(memDir, { recursive: true });
            fs.writeFileSync(path.join(memDir, 'MEMORY.md'), 'some memory content');

            const { router } = setup();
            const res = await router.get(`/api/repos/${wsId}/memory/overview`);
            const body = res.json();
            expect(body.charCount).toBe('some memory content'.length);
            expect(body.charLimit).toBeGreaterThan(0);
            expect(body.lastModified).toBeTruthy();
        });
    });

    // ── POST aggregate: manual trigger ──────────────────────────────────

    describe('POST /api/repos/:repoId/memory/aggregate', () => {
        it('enqueues a new task and returns 200 with queued status', async () => {
            const { router, queueManager } = setup();
            const res = await router.post(`/api/repos/${wsId}/memory/aggregate`, {});
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.status).toBe('queued');
            expect(body.taskId).toBeTruthy();

            expect(queueManager.enqueue).toHaveBeenCalledTimes(1);
            const call = queueManager.enqueue.mock.calls[0][0];
            expect(call.type).toBe('memory-aggregate');
            expect(call.payload.workspaceId).toBe(wsId);
            expect(call.payload.target).toBe('memory');
            expect(call.payload.trigger).toBe('manual');
            expect(call.priority).toBe('low');
        });

        it('passes model from request body to payload', async () => {
            const { router, queueManager } = setup();
            await router.post(`/api/repos/${wsId}/memory/aggregate`, { model: 'gpt-4' });
            const call = queueManager.enqueue.mock.calls[0][0];
            expect(call.payload.model).toBe('gpt-4');
        });

        it('allows target=system', async () => {
            const { router, queueManager } = setup();
            await router.post(`/api/repos/${wsId}/memory/aggregate`, { target: 'system' });
            const call = queueManager.enqueue.mock.calls[0][0];
            expect(call.payload.target).toBe('system');
        });

        it('defaults target to memory for unknown values', async () => {
            const { router, queueManager } = setup();
            await router.post(`/api/repos/${wsId}/memory/aggregate`, { target: 'bogus' });
            const call = queueManager.enqueue.mock.calls[0][0];
            expect(call.payload.target).toBe('memory');
        });

        it('returns 409 with already-queued when task is already queued', async () => {
            const qm = createFakeQueueManager();
            qm._addExisting({
                id: 'existing-q',
                type: 'memory-aggregate',
                status: 'queued',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: Date.now(),
                processId: 'proc-existing',
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            const res = await router.post(`/api/repos/${wsId}/memory/aggregate`, {});
            expect(res.status).toBe(409);
            const body = res.json();
            expect(body.status).toBe('already-queued');
            expect(body.taskId).toBe('existing-q');
            expect(body.processId).toBe('proc-existing');
            expect(qm.enqueue).not.toHaveBeenCalled();
        });

        it('returns 409 with already-running when task is already running', async () => {
            const qm = createFakeQueueManager();
            qm._addExisting({
                id: 'existing-r',
                type: 'memory-aggregate',
                status: 'running',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: Date.now(),
                processId: 'proc-running',
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            const res = await router.post(`/api/repos/${wsId}/memory/aggregate`, {});
            expect(res.status).toBe(409);
            const body = res.json();
            expect(body.status).toBe('already-running');
            expect(body.taskId).toBe('existing-r');
        });

        it('allows enqueue when existing task is completed', async () => {
            const qm = createFakeQueueManager();
            qm._addExisting({
                id: 'done-task',
                type: 'memory-aggregate',
                status: 'completed',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: Date.now() - 10000,
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            const res = await router.post(`/api/repos/${wsId}/memory/aggregate`, {});
            expect(res.status).toBe(200);
            expect(res.json().status).toBe('queued');
            expect(qm.enqueue).toHaveBeenCalledTimes(1);
        });

        it('allows enqueue when existing task has failed', async () => {
            const qm = createFakeQueueManager();
            qm._addExisting({
                id: 'fail-task',
                type: 'memory-aggregate',
                status: 'failed',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: Date.now() - 10000,
                error: 'some error',
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            const res = await router.post(`/api/repos/${wsId}/memory/aggregate`, {});
            expect(res.status).toBe(200);
            expect(res.json().status).toBe('queued');
        });

        it('returns 404 for unknown workspace', async () => {
            const { router } = setup();
            const res = await router.post('/api/repos/unknown-ws/memory/aggregate', {});
            expect(res.status).toBe(404);
        });

        it('returns 500 when no queue manager is available', async () => {
            const routes: Route[] = [];
            const store = createFakeStore([{ id: wsId, rootPath: wsRoot }]);
            registerRepoMemoryRoutes(routes, tmpDir, { store });
            const router = createTestRouter(routes);
            const res = await router.post(`/api/repos/${wsId}/memory/aggregate`, {});
            expect(res.status).toBe(500);
        });

        it('different targets are independent for dedupe', async () => {
            const qm = createFakeQueueManager();
            qm._addExisting({
                id: 'existing-mem',
                type: 'memory-aggregate',
                status: 'queued',
                payload: { kind: 'memory-aggregate', workspaceId: wsId, target: 'memory' },
                createdAt: Date.now(),
                priority: 'low',
                config: {},
            });

            const { router } = setup({ queueManager: qm });
            // memory target is blocked
            const res1 = await router.post(`/api/repos/${wsId}/memory/aggregate`, { target: 'memory' });
            expect(res1.status).toBe(409);
            // system target is independent
            const res2 = await router.post(`/api/repos/${wsId}/memory/aggregate`, { target: 'system' });
            expect(res2.status).toBe(200);
            expect(res2.json().status).toBe('queued');
        });
    });
});
