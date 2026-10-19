import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import { createRouter, type Route } from '../../../src/server/shared/router';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelJobStore } from '../../../src/server/sentinel-jobs/job-store';
import { SentinelJobService } from '../../../src/server/sentinel-jobs/job-service';
import { registerSentinelJobRoutes } from '../../../src/server/sentinel-jobs/job-routes';
import { createTodoTestDatabase } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_s1' };
const base = '/api/workspaces/ws-a/sentinel-todos/queue_s1/jobs';
const input = { name: 'Review', instructions: 'Check evidence', provider: 'copilot', model: 'gpt' };
const processesMeta: Record<string, { workspaceId: string; mode: string }> = {
    queue_s1: { workspaceId: 'ws-a', mode: 'sentinel' },
    queue_s2: { workspaceId: 'group-team', mode: 'sentinel' },
    queue_s3: { workspaceId: 'ws-a', mode: 'sentinel' },
    queue_ask: { workspaceId: 'ws-a', mode: 'ask' },
};
let fixture: ReturnType<typeof createTodoTestDatabase>;
let todoStore: SentinelTodoStore;
let todoService: SentinelTodoService;
let jobStore: SentinelJobStore;
let service: SentinelJobService;
let server: http.Server;
let url: string;
let enabled: boolean;
let onConfigChange: ReturnType<typeof vi.fn>;
let enqueue: ReturnType<typeof vi.fn>;
let cancelTask: ReturnType<typeof vi.fn>;
let jobProcesses: Map<string, AIProcess>;

async function request(method: string, route = base, body?: unknown) {
    const res = await fetch(url + route, {
        method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

beforeEach(async () => {
    const directory = path.resolve('.sentinel-jobs-tests', randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    fixture = createTodoTestDatabase(directory);
    todoStore = new SentinelTodoStore(fixture.db);
    jobStore = new SentinelJobStore(fixture.db);
    todoService = new SentinelTodoService({
        todos: todoStore,
        store: {
            getProcess: async (id: string) => {
                const metadata = processesMeta[id];
                return metadata ? { id, metadata } as unknown as AIProcess : undefined;
            },
        } as unknown as ProcessStore,
    });
    enabled = true;
    jobProcesses = new Map();
    onConfigChange = vi.fn();
    enqueue = vi.fn(async (taskInput: CreateTaskInput) => taskInput.id!);
    cancelTask = vi.fn(() => true);
    service = new SentinelJobService({
        dataDir: fixture.dataDir,
        jobs: jobStore,
        todos: todoService,
        store: {
            getWorkspaces: async () => [{ id: 'ws-a', name: 'a', rootPath: '/a' }, { id: 'group-team', name: 'g', rootPath: '/g' }],
            getProcess: async (id: string) => {
                const metadata = processesMeta[id];
                return metadata ? { id, metadata, conversationTurns: [] } as unknown as AIProcess : jobProcesses.get(id);
            },
            addProcess: async (value: AIProcess) => { jobProcesses.set(value.id, value); },
            updateProcess: async () => {},
        } as unknown as ProcessStore,
        getEnabled: () => enabled,
        enqueue,
        cancelTask,
        getTask: () => undefined,
    });
    const routes: Route[] = [];
    registerSentinelJobRoutes({ routes, jobs: jobStore, service, onConfigChange });
    server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fixture.dispose();
});

describe('Sentinel job REST routes', () => {
    it('partial edits preserve non-default settings and explicitly clear optional effort and cron', async () => {
        const created = await request('POST', base, { ...input, mode: 'autopilot', enabled: false,
            autoCompactThreshold: 555, effort: 'high', cron: '0 * * * *' });
        const patched = await request('PATCH', `${base}/${created.body.id}`, { name: 'new', expectedRevision: 1 });
        expect(patched.body).toMatchObject({ mode: 'autopilot', enabled: false, autoCompactThreshold: 555,
            effort: 'high', cron: '0 * * * *', revision: 2 });
        const cleared = await request('PATCH', `${base}/${created.body.id}`, { effort: '', cron: '', expectedRevision: 2 });
        expect(cleared.body.effort).toBeUndefined();
        expect(cleared.body.cron).toBeUndefined();
    });
    it('persists an effort tier over REST and lets an explicit model replace it', async () => {
        const created = await request('POST', base, { ...input, effort: 'high', effortTier: 'low' });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ effortTier: 'low' });
        expect(created.body).not.toHaveProperty('model');
        const patched = await request('PATCH', `${base}/${created.body.id}`, { model: 'm2', effortTier: '', expectedRevision: 1 });
        expect(patched.body).toMatchObject({ model: 'm2', revision: 2 });
        expect(patched.body).not.toHaveProperty('effortTier');
        expect((await request('PATCH', `${base}/${created.body.id}`, { effortTier: 'max', expectedRevision: 2 })).status).toBe(400);
    });
    it('creates, lists, patches with revision checks, and deletes a job', async () => {
        expect((await request('GET')).body).toEqual({ jobs: [] });
        const created = await request('POST', base, input);
        expect(created).toMatchObject({ status: 201, body: { name: 'Review', mode: 'ask', enabled: true, revision: 1, runs: [] } });
        const id = created.body.id;
        expect((await request('GET')).body.jobs).toHaveLength(1);

        const stale = await request('PATCH', `${base}/${id}`, { name: 'Renamed', expectedRevision: 999 });
        expect(stale).toMatchObject({ status: 409, body: { code: 'conflict' } });
        const patched = await request('PATCH', `${base}/${id}`, { name: 'Renamed', expectedRevision: 1 });
        expect(patched).toMatchObject({ status: 200, body: { name: 'Renamed', revision: 2 } });
        expect(onConfigChange).toHaveBeenCalledTimes(2); // create + patch

        const deleteStale = await request('DELETE', `${base}/${id}`, { expectedRevision: 1 });
        expect(deleteStale).toMatchObject({ status: 409, body: { code: 'conflict' } });
        const deleted = await request('DELETE', `${base}/${id}`, { expectedRevision: 2 });
        expect(deleted).toMatchObject({ status: 200, body: { deleted: true } });
        expect((await request('GET')).body.jobs).toEqual([]);
        expect(onConfigChange).toHaveBeenCalledTimes(3);
    });

    it('rejects invalid create/update schemas, unknown fields, and the per-owner job limit', async () => {
        for (const body of [
            { ...input, mode: 'ralph' }, { ...input, provider: 'auto' }, { ...input, name: '' },
            { ...input, extra: true }, {}, [], null,
        ]) {
            expect((await request('POST', base, body)).status).toBe(400);
        }
        const created = await request('POST', base, input);
        const id = created.body.id;
        for (const body of [
            { expectedRevision: 1, extra: true }, { expectedRevision: 1, provider: 'auto' }, { expectedRevision: 'x' },
        ]) {
            expect((await request('PATCH', `${base}/${id}`, body)).status).toBe(400);
        }
        for (let i = 1; i < 10; i++) await request('POST', base, input);
        const overLimit = await request('POST', base, input);
        expect(overLimit).toMatchObject({ status: 400, body: { code: 'limit' } });
        expect(onConfigChange).toHaveBeenCalledTimes(10); // 10 successful creates only
    });

    it('rejects editing or deleting a job with an active run or an undelivered handback', async () => {
        const created = await request('POST', base, input);
        const id = created.body.id;
        const started = await request('POST', `${base}/${id}/runs`);
        expect(started.status).toBe(202);
        const edit = await request('PATCH', `${base}/${id}`, { name: 'x', expectedRevision: 1 });
        expect(edit).toMatchObject({ status: 409, body: { code: 'conflict' } });
        const del = await request('DELETE', `${base}/${id}`, { expectedRevision: 1 });
        expect(del).toMatchObject({ status: 409, body: { code: 'conflict' } });
    });

    it('starts a run (low priority, persistent chat process) and rejects a concurrent manual overlap', async () => {
        const created = await request('POST', base, input);
        const id = created.body.id;
        const started = await request('POST', `${base}/${id}/runs`);
        expect(started).toMatchObject({ status: 202, body: { status: 'queued', trigger: 'manual' } });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0][0]).toMatchObject({ priority: 'low', type: 'chat' });
        const overlap = await request('POST', `${base}/${id}/runs`);
        expect(overlap).toMatchObject({ status: 409, body: { code: 'conflict' } });
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('allows explicit runs with the schedule paused, and 404s unknown job/run commands', async () => {
        const created = await request('POST', base, { ...input, enabled: false });
        const id = created.body.id;
        const paused = await request('POST', `${base}/${id}/runs`);
        expect(paused).toMatchObject({ status: 202, body: { trigger: 'manual', status: 'queued' } });
        expect((await request('POST', `${base}/missing/runs`)).status).toBe(404);
        expect((await request('POST', `${base}/missing/runs/missing/cancel`)).status).toBe(404);
    });

    it('cancels a queued run through the REST endpoint', async () => {
        const created = await request('POST', base, input);
        const id = created.body.id;
        const started = await request('POST', `${base}/${id}/runs`);
        const runId = started.body.id;
        const cancelled = await request('POST', `${base}/${id}/runs/${runId}/cancel`);
        expect(cancelled).toMatchObject({ status: 200, body: { status: 'cancelled' } });
        expect(cancelTask).toHaveBeenCalled();
        const again = await request('POST', `${base}/${id}/runs/${runId}/cancel`);
        expect(again).toMatchObject({ status: 200, body: { status: 'cancelled' } }); // idempotent no-op
    });

    it('enforces ownership: rejects non-Sentinel, cross-workspace, and malformed workspace/chat ids on every route', async () => {
        for (const other of [
            '/api/workspaces/ws-a/sentinel-todos/queue_s2/jobs', // queue_s2 is actually scoped to group-team, not ws-a
            '/api/workspaces/ws-a/sentinel-todos/queue_ask/jobs', // not a Sentinel chat
            '/api/workspaces/ws-a/sentinel-todos/missing/jobs', // no such chat
        ]) {
            expect((await request('GET', other)).status).toBe(404);
            expect((await request('POST', other, input)).status).toBe(404);
        }
        // queue_s2 is a valid Sentinel owner under its own (group-team) workspace.
        expect((await request('GET', '/api/workspaces/group-team/sentinel-todos/queue_s2/jobs')).status).toBe(200);
        expect((await request('GET', '/api/workspaces/bad%2Fid/sentinel-todos/queue_s1/jobs')).status).toBe(400);
        expect(onConfigChange).not.toHaveBeenCalled();
        // A job created under one Sentinel owner is invisible to another, even with the same job id guessed.
        const created = await request('POST', base, input);
        const id = created.body.id;
        const other = '/api/workspaces/ws-a/sentinel-todos/queue_s3/jobs';
        expect((await request('GET', other)).body.jobs).toEqual([]);
        expect((await request('PATCH', `${other}/${id}`, { expectedRevision: 1 })).status).toBe(404);
    });

    it('hides every endpoint while Sentinel jobs are disabled, with no persistence or queue side effects', async () => {
        const created = await request('POST', base, input);
        const id = created.body.id;
        enabled = false;
        for (const [method, route, body] of [
            ['GET', base, undefined], ['POST', base, input], ['PATCH', `${base}/${id}`, { expectedRevision: 1 }],
            ['DELETE', `${base}/${id}`, { expectedRevision: 1 }], ['POST', `${base}/${id}/runs`, undefined],
            ['POST', `${base}/${id}/runs/x/cancel`, undefined],
        ] as const) {
            expect((await request(method, route, body)).status).toBe(404);
        }
        expect(jobStore.list(owner)).toHaveLength(1); // the job persists — only the API surface is gated
        expect(enqueue).not.toHaveBeenCalled();
        onConfigChange.mockClear();
        enabled = true;
        expect((await request('GET')).body.jobs).toHaveLength(1);
        expect(onConfigChange).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON bodies and non-object payloads', async () => {
        expect((await (await fetch(url + base, { method: 'POST', body: '{' })).status)).toBe(400);
        for (const body of [[], null, 'x', 1]) {
            expect((await request('POST', base, body)).status).toBe(400);
        }
    });
});
