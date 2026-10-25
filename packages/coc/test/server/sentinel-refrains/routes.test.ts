import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import { createRouter, type Route } from '../../../src/server/shared/router';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelRefrainStore } from '../../../src/server/sentinel-refrains/refrain-store';
import { SentinelRefrainService } from '../../../src/server/sentinel-refrains/refrain-service';
import { registerSentinelRefrainRoutes } from '../../../src/server/sentinel-refrains/refrain-routes';
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
let jobStore: SentinelRefrainStore;
let service: SentinelRefrainService;
let server: http.Server;
let url: string;
let enabled: boolean;
let onConfigChange: ReturnType<typeof vi.fn>;
let enqueue: ReturnType<typeof vi.fn>;
let cancelTask: ReturnType<typeof vi.fn>;
let jobProcesses: Map<string, AIProcess>;
let gateEnabled: boolean;
let runGate: ReturnType<typeof vi.fn>;

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
    jobStore = new SentinelRefrainStore(fixture.db);
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
    gateEnabled = true;
    runGate = vi.fn(async () => ({ items: [1] }));
    jobProcesses = new Map();
    onConfigChange = vi.fn();
    enqueue = vi.fn(async (taskInput: CreateTaskInput) => taskInput.id!);
    cancelTask = vi.fn(() => true);
    service = new SentinelRefrainService({
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
        getGateEnabled: () => gateEnabled,
        runGate,
        enqueue,
        cancelTask,
        getTask: () => undefined,
    });
    const routes: Route[] = [];
    registerSentinelRefrainRoutes({ routes, jobs: jobStore, service, onConfigChange });
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
    it('saves a cron-bound gate script with its gate state and rejects a gate without a cron', async () => {
        const gateScript = 'return await tools.list_items();';
        expect(await request('POST', base, { ...input, gateScript })).toMatchObject({ status: 400,
            body: { code: 'invalid', error: expect.stringMatching(/needs a cron/) } });
        const created = await request('POST', base, { ...input, cron: '0 * * * *', gateScript });
        expect(created).toMatchObject({ status: 201, body: { gateScript, gateConsecutiveFailures: 0, gatePaused: false } });
        expect(await request('PATCH', `${base}/${created.body.id}`, { cron: '', expectedRevision: 1 }))
            .toMatchObject({ status: 400, body: { code: 'invalid' } });
        // Gate state is runtime bookkeeping, never a user setting.
        expect((await request('PATCH', `${base}/${created.body.id}`, { gatePaused: false, expectedRevision: 1 })).status).toBe(400);
        expect((await request('POST', base, { ...input, cron: '0 * * * *', gateScript, gateConsecutiveFailures: 0 })).status).toBe(400);
        const cleared = await request('PATCH', `${base}/${created.body.id}`, { gateScript: '', cron: '', expectedRevision: 1 });
        expect(cleared).toMatchObject({ status: 200, body: { gateConsecutiveFailures: 0, gatePaused: false, revision: 2 } });
        expect(cleared.body.gateScript).toBeUndefined();
        expect(cleared.body.cron).toBeUndefined();
        expect((await request('GET')).body.jobs).toHaveLength(1);
    });
    it('returns concrete manual skips and gate errors without ungated fallback', async () => {
        const { body: job } = await request('POST', base, { ...input, cron: '0 * * * *', gateScript: 'return state;' });
        runGate.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Gate deadline exceeded'));
        expect(await request('POST', `${base}/${job.id}/runs`)).toMatchObject({ status: 202,
            body: { trigger: 'manual', status: 'skipped', skipReason: 'gate-empty' } });
        expect(await request('POST', `${base}/${job.id}/runs`)).toMatchObject({ status: 409,
            body: { code: 'conflict', error: 'Gate deadline exceeded' } });
        jobStore.updateGate(owner, job.id, 'return state;', () => ({ gatePaused: true }));
        expect(await request('POST', `${base}/${job.id}/runs`)).toMatchObject({ status: 409,
            body: { error: expect.stringContaining('gate is paused') } });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('tests a paused gate without starting a run or saving state, then resumes it', async () => {
        const gateScript = 'return state;';
        const { body: job } = await request('POST', base, { ...input, cron: '0 * * * *', gateScript });
        jobStore.updateGate(owner, job.id, gateScript, () => ({
            gateLastResult: '{"seen":1}', gateConsecutiveFailures: 5, gatePaused: true, gateLastError: { message: 'boom', at: 'x' } }));
        const saved = jobStore.get(owner, job.id);
        onConfigChange.mockClear();
        expect(await request('POST', `${base}/${job.id}/gate/test`)).toEqual({ status: 200,
            body: { ok: true, result: '{"items":[1]}', empty: false } });
        expect(runGate).toHaveBeenCalledWith(expect.objectContaining({ ...owner, code: gateScript, state: { seen: 1 } }));
        runGate.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('bad'));
        expect((await request('POST', `${base}/${job.id}/gate/test`)).body).toEqual({ ok: true, result: 'null', empty: true });
        expect((await request('POST', `${base}/${job.id}/gate/test`)).body).toEqual({ ok: false, error: 'bad' });
        expect(jobStore.get(owner, job.id)).toEqual(saved);
        expect(jobStore.runs(owner, job.id)).toEqual([]);
        expect(enqueue).not.toHaveBeenCalled();

        const resumed = await request('POST', `${base}/${job.id}/gate/resume`);
        expect(resumed).toMatchObject({ status: 200, body: { id: job.id, gatePaused: false, gateConsecutiveFailures: 0,
            gateLastResult: '{"seen":1}', revision: 1, runs: [] } });
        expect(onConfigChange).not.toHaveBeenCalled();
    });

    it('rejects Test gate while tool scripting is off and gate actions on ungated or unknown jobs', async () => {
        const gated = (await request('POST', base, { ...input, cron: '0 * * * *', gateScript: 'return 1;' })).body;
        const plain = (await request('POST', base, input)).body;
        gateEnabled = false;
        expect(await request('POST', `${base}/${gated.id}/gate/test`)).toMatchObject({ status: 409, body: { code: 'conflict' } });
        gateEnabled = true;
        for (const action of ['test', 'resume']) {
            expect(await request('POST', `${base}/${plain.id}/gate/${action}`)).toMatchObject({ status: 400, body: { code: 'invalid' } });
            expect((await request('POST', `${base}/missing/gate/${action}`)).status).toBe(404);
        }
        expect(runGate).not.toHaveBeenCalled();
    });

    it('cancels a running Test gate when the client disconnects', async () => {
        const { body: job } = await request('POST', base, { ...input, cron: '0 * * * *', gateScript: 'return 1;' });
        let signal: AbortSignal | undefined;
        runGate.mockImplementationOnce((gate: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
            signal = gate.signal;
            signal.addEventListener('abort', () => reject(signal!.reason));
        }));
        const client = new AbortController();
        const pending = fetch(`${url}${base}/${job.id}/gate/test`, { method: 'POST', signal: client.signal });
        await vi.waitFor(() => expect(signal).toBeDefined());
        expect(signal!.aborted).toBe(false);
        client.abort();
        await expect(pending).rejects.toThrow();
        await vi.waitFor(() => expect(signal!.aborted).toBe(true));
    });

    it.each([
        ['an edit', (id: string) => request('PATCH', `${base}/${id}`, { name: 'Renamed', expectedRevision: 1 })],
        ['a delete', (id: string) => request('DELETE', `${base}/${id}`, { expectedRevision: 1 })],
    ])('cancels a ticking gate on %s without counting a failure or starting a run', async (_label, write) => {
        const { body: job } = await request('POST', base, { ...input, cron: '0 * * * *', gateScript: 'return 1;' });
        let signal: AbortSignal | undefined;
        let settle!: (value: unknown) => void;
        runGate.mockImplementationOnce((gate: { signal: AbortSignal }) => new Promise((resolve, reject) => {
            signal = gate.signal;
            settle = resolve;
            signal.addEventListener('abort', () => reject(signal!.reason));
        }));
        const tick = service.tick(owner, job.id);
        await vi.waitFor(() => expect(signal).toBeDefined());
        expect(signal!.aborted).toBe(false);
        expect((await write(job.id)).status).toBeLessThan(300);
        expect(signal!.aborted).toBe(true);
        settle({ late: true });
        expect(await tick).toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
        const [stored] = jobStore.list(owner);
        if (stored) {
            expect(stored).toMatchObject({ gateConsecutiveFailures: 0, gatePaused: false });
            expect(stored.gateLastResult).toBeUndefined();
            expect(stored.gateLastError).toBeUndefined();
            expect(jobStore.runs(owner, job.id)).toEqual([]);
        }
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

    it('rejects editing or deleting a job with an active run', async () => {
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

    it('hides every endpoint while Sentinel refrains are disabled, with no persistence or queue side effects', async () => {
        const created = await request('POST', base, input);
        const id = created.body.id;
        enabled = false;
        for (const [method, route, body] of [
            ['GET', base, undefined], ['POST', base, input], ['PATCH', `${base}/${id}`, { expectedRevision: 1 }],
            ['DELETE', `${base}/${id}`, { expectedRevision: 1 }], ['POST', `${base}/${id}/runs`, undefined],
            ['POST', `${base}/${id}/runs/x/cancel`, undefined], ['POST', `${base}/${id}/gate/test`, undefined],
            ['POST', `${base}/${id}/gate/resume`, undefined],
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
