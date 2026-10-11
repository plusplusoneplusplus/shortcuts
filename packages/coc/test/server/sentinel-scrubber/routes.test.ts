import * as http from 'node:http';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter, type Route } from '../../../src/server/shared/router';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { ScrubberStore } from '../../../src/server/sentinel-scrubber/scrubber-store';
import { ScrubberEngine } from '../../../src/server/sentinel-scrubber/scrubber-engine';
import { ScrubberRunService } from '../../../src/server/sentinel-scrubber/scrubber-runs';
import { registerScrubberRoutes } from '../../../src/server/sentinel-scrubber/scrubber-routes';
import { createTodoTestDatabase, createTodoTestDirectory, failTodoWrites } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_s1' };
const base = '/api/workspaces/ws-a/sentinel-todos/queue_s1/scrubber';
const processes = {
    queue_s1: { workspaceId: 'ws-a', mode: 'sentinel' },
    queue_s2: { workspaceId: 'group-team', mode: 'sentinel' },
    queue_s3: { workspaceId: 'ws-a', mode: 'sentinel' },
    queue_ask: { workspaceId: 'ws-a', mode: 'ask' },
};
let fixture: ReturnType<typeof createTodoTestDatabase>;
let todos: SentinelTodoStore;
let scrubber: ScrubberStore;
let engine: ScrubberEngine;
let runs: ScrubberRunService;
let server: http.Server;
let url: string;
let enabled: boolean;
let onChange: ReturnType<typeof vi.fn>;
let enqueue: ReturnType<typeof vi.fn>;
let cancelTask: ReturnType<typeof vi.fn>;
async function request(method: string, route = base, body?: unknown) {
    const res = await fetch(url + route, {
        method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}
function item() { return todos.create(owner, { title: 'Ship feature' }, { actor: 'sentinel' }).item; }
function settle(itemId: string, verdict: 'done' | 'obsolete' = 'obsolete') {
    scrubber.createRun(owner, {
        id: 'run', trigger: 'manual', status: 'running', createdAt: '2026-10-11T10:00:00.000Z',
        snapshot: [{ itemId, revision: 1 }], deferredItemIds: [], awaitingReviewItemIds: [],
    });
    engine.complete(owner, 'run', [{
        itemId, verdict, autoApply: verdict === 'done', confidence: 'high', summary: 'Verified', rationale: 'Checked',
        evidence: [{ kind: 'pr', ref: 'https://github.com/o/r/pull/915', state: 'merged', checkedAt: '2026-10-11T10:05:00.000Z' }],
    }]);
    return `${base}/runs/run/findings/${itemId}`;
}
beforeEach(async () => {
    fixture = createTodoTestDatabase(createTodoTestDirectory());
    todos = new SentinelTodoStore(fixture.db);
    scrubber = new ScrubberStore(fixture.db);
    engine = new ScrubberEngine({ todos, scrubber, now: () => new Date('2026-10-11T10:10:00.000Z') });
    const service = new SentinelTodoService({ todos, store: {
        getProcess: async id => {
            const metadata = processes[id as keyof typeof processes];
            return metadata ? { id, metadata } as never : undefined;
        },
    } });
    enqueue = vi.fn(async () => 'child');
    cancelTask = vi.fn(() => true);
    runs = new ScrubberRunService({ dataDir: fixture.dataDir, todos: service, scrubber, engine, enqueue, cancelTask });
    enabled = true;
    onChange = vi.fn();
    const routes: Route[] = [];
    registerScrubberRoutes({ routes, todos: service, scrubber, engine, runs, getEnabled: () => enabled, onChange });
    server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    runs.dispose();
    fixture.dispose();
});
describe('Scrubber REST commands', () => {
    it('serves the shared client config, selected run, cancel, history and finding actions', async () => {
        const client = new CocClient({ baseUrl: url }).sentinelTodos.scrubber;
        expect((await client.get(owner.workspaceId, owner.processId)).config.revision).toBe(0);
        const config = await client.updateConfig(owner.workspaceId, owner.processId, {
            enabled: false, cron: '0 9 * * *', expectedRevision: 0,
        });
        expect(config).toMatchObject({ enabled: false, revision: 1 });
        const selected = item();
        const started = await client.start(owner.workspaceId, owner.processId, { itemIds: [selected.id] });
        expect(started.processId).toBe('queue_child');
        expect((await client.getRun(owner.workspaceId, owner.processId, started.runId)).snapshot)
            .toEqual([{ itemId: selected.id, revision: selected.revision }]);
        expect((await client.cancel(owner.workspaceId, owner.processId, started.runId)).status).toBe('cancelled');
        expect((await client.get(owner.workspaceId, owner.processId)).runs[0])
            .toMatchObject({ id: started.runId, itemCount: 1, counts: { done: 0, proposals: 0, unverified: 0 } });
        settle(selected.id);
        const detail = await client.getRun(owner.workspaceId, owner.processId, 'run');
        expect(detail.findings[0]).toMatchObject({ state: 'proposed', itemRevision: 1 });
        const accepted = await client.accept(owner.workspaceId, owner.processId, 'run', selected.id, { expectedItemRevision: 1 });
        expect(accepted.item).toMatchObject({ status: 'done', archived: true });
        expect(accepted.finding.audit[0]).toMatchObject({ action: 'accepted', actor: 'user', before: { status: 'todo' } });
        await expect(client.get(owner.workspaceId, 'queue_s2')).rejects.toMatchObject({ status: 404 });
    });

    it('round-trips Undo and Dismiss through the shared client with stale-write errors', async () => {
        const client = new CocClient({ baseUrl: url }).sentinelTodos.scrubber;
        const original = item();
        settle(original.id, 'done');
        await expect(client.undo(owner.workspaceId, owner.processId, 'run', original.id, { expectedItemRevision: 1 }))
            .rejects.toMatchObject({ status: 409, code: 'conflict', body: { current: { revision: 2 } } });
        const restored = await client.undo(owner.workspaceId, owner.processId, 'run', original.id, { expectedItemRevision: 2 });
        expect(restored.item.status).toBe('todo');
        expect(restored.finding.state).toBe('undone');
        // A separate owner has independent run IDs, findings and dismissal state.
        const other = { workspaceId: 'group-team', processId: 'queue_s2' };
        const groupItem = todos.create(other, { title: 'Group task' }, { actor: 'sentinel' }).item;
        scrubber.createRun(other, {
            id: 'run', trigger: 'manual', status: 'running', createdAt: '2026-10-11T10:00:00.000Z',
            snapshot: [{ itemId: groupItem.id, revision: 1 }], deferredItemIds: [], awaitingReviewItemIds: [],
        });
        engine.complete(other, 'run', [{
            itemId: groupItem.id, verdict: 'obsolete', autoApply: false, confidence: 'medium',
            summary: 'Superseded', rationale: 'Replaced', evidence: [{
                kind: 'reference', ref: 'replacement', state: 'other', checkedAt: '2026-10-11T10:05:00.000Z',
            }],
        }]);
        const dismissed = await client.dismiss(other.workspaceId, other.processId, 'run', groupItem.id, { expectedItemRevision: 1 });
        expect(dismissed.finding.state).toBe('dismissed');
        expect(dismissed).not.toHaveProperty('item');
        expect(todos.get(other).items[0].revision).toBe(1);
        expect((await client.getRun(owner.workspaceId, owner.processId, 'run')).findings[0].state).toBe('undone');
    });
    it('hides every endpoint while disabled without persistence or queues', async () => {
        enabled = false;
        for (const [method, route] of [
            ['GET', base], ['PUT', `${base}/config`], ['POST', `${base}/runs`],
            ['GET', `${base}/runs/run`], ['POST', `${base}/runs/run/cancel`],
            ...['accept', 'dismiss', 'undo'].map(action => ['POST', `${base}/runs/run/findings/item/${action}`]),
        ]) expect((await request(method, route, method === 'GET' ? undefined : {})).status).toBe(404);
        expect(scrubber.listEnabledOwners()).toEqual([]);
        expect(scrubber.listRuns(owner)).toEqual([]);
        expect(enqueue).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });
    it('saves revision-safe schedules and rejects invalid or too frequent cron', async () => {
        expect((await request('GET')).body.config).toMatchObject({ enabled: false, revision: 0 });
        const config = { enabled: true, cron: '0 */6 * * *', expectedRevision: 0 };
        const saved = await request('PUT', `${base}/config`, config);
        expect(saved).toMatchObject({ status: 200, body: { enabled: true, revision: 1 } });
        expect(Date.parse(saved.body.nextRunAt)).toBeGreaterThan(Date.now());
        expect((await request('PUT', `${base}/config`, config)).status).toBe(409);
        for (const cron of ['bad', '* * * * *', '*/30 * * * *', '60 * * * *']) {
            expect((await request('PUT', `${base}/config`, { ...config, cron, expectedRevision: 1 })).status).toBe(400);
        }
        expect((await request('PUT', `${base}/config`, { ...config, enabled: false, expectedRevision: 1 })).body.nextRunAt).toBeUndefined();
        expect(onChange).toHaveBeenCalledTimes(2);
        expect(onChange).toHaveBeenLastCalledWith(owner, { configChanged: true });
    });
    it('starts selected child runs, rejects overlap and cancels without ledger changes', async () => {
        const a = item();
        item();
        const started = await request('POST', `${base}/runs`, { itemIds: [a.id] });
        expect(started).toMatchObject({ status: 202, body: { processId: 'queue_child' } });
        const runId = started.body.runId;
        expect((await request('POST', `${base}/runs`, {})).status).toBe(409);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect((await request('GET', `${base}/runs/${runId}`)).body).toMatchObject({ snapshot: [{ itemId: a.id, revision: 1 }], findings: [] });
        expect((await request('GET')).body).toMatchObject({ activeRun: { id: runId }, runs: [{ itemCount: 1 }] });
        expect(await request('POST', `${base}/runs/${runId}/cancel`)).toMatchObject({ status: 200, body: { status: 'cancelled' } });
        expect(cancelTask).toHaveBeenCalledWith('child');
        expect(todos.get(owner).items.every(i => i.status === 'todo')).toBe(true);
        expect((await request('GET', `${base}/runs/missing`)).status).toBe(404);
        expect((await request('POST', `${base}/runs/missing/cancel`)).status).toBe(404);
    });
    it('rejects malformed bodies and caller-supplied authority', async () => {
        item();
        for (const body of [{ itemIds: [] }, { itemIds: 'x' }, { itemIds: [1] }, { trigger: 'schedule' }, { actor: 'scrubber' }, [], null]) {
            expect((await request('POST', `${base}/runs`, body)).status).toBe(400);
        }
        expect((await request('POST', `${base}/runs`, { itemIds: ['missing'] })).status).toBe(400);
        expect((await request('PUT', `${base}/config`, { enabled: true, cron: '0 * * * *' })).status).toBe(400);
        expect((await fetch(url + base + '/runs', { method: 'POST', body: '{' })).status).toBe(400);
        expect(enqueue).not.toHaveBeenCalled();
    });
    it('isolates groups and chats and rejects non-Sentinel or mismatched owners', async () => {
        const a = item();
        settle(a.id);
        for (const other of [
            '/api/workspaces/group-team/sentinel-todos/queue_s2/scrubber',
            '/api/workspaces/ws-a/sentinel-todos/queue_s3/scrubber',
        ]) {
            expect((await request('GET', other)).body.runs).toEqual([]);
            expect((await request('GET', other + '/runs/run')).status).toBe(404);
            expect((await request('POST', `${other}/runs/run/findings/${a.id}/accept`, { expectedItemRevision: 1 })).status).toBe(404);
        }
        for (const path of [
            '/api/workspaces/ws-a/sentinel-todos/queue_s2/scrubber',
            '/api/workspaces/ws-a/sentinel-todos/queue_ask/scrubber',
            '/api/workspaces/ws-a/sentinel-todos/missing/scrubber',
        ]) {
            expect((await request('GET', path)).status).toBe(404);
            expect((await request('PUT', `${path}/config`, { enabled: true, cron: '0 * * * *', expectedRevision: 0 })).status).toBe(404);
        }
        expect((await request('GET', '/api/workspaces/bad%2Fid/sentinel-todos/queue_s1/scrubber')).status).toBe(400);
        expect(onChange).not.toHaveBeenCalled();
    });
    it('accepts Obsolete as user Done/outcome/archive and exposes its audit', async () => {
        const a = item();
        const path = settle(a.id);
        expect((await request('GET')).body.runs[0].counts.proposals).toBe(1);
        expect(await request('POST', path + '/accept', { expectedItemRevision: 1 })).toMatchObject({ status: 200, body: {
            item: { status: 'done', archived: true, updatedBy: 'user', outcome: { summary: expect.stringContaining('Obsolete:') } },
            finding: { state: 'accepted', audit: [{ actor: 'user', action: 'accepted' }] },
        } });
        expect((await request('GET', `${base}/runs/run`)).body.findings[0].audit).toHaveLength(1);
        expect(onChange).toHaveBeenCalledWith(owner, { runId: 'run', ledgerChanged: true });
        expect((await request('POST', path + '/accept', { expectedItemRevision: 2 })).status).toBe(409);
    });
    it('rejects stale Accept with the current item without publishing', async () => {
        const a = item();
        const path = settle(a.id);
        todos.update(owner, a.id, 1, { title: 'New choice' }, 'user');
        for (const expectedItemRevision of [1, 2]) {
            expect(await request('POST', path + '/accept', { expectedItemRevision })).toMatchObject({
                status: 409, body: { error: expect.stringContaining('Item changed since this proposal'), current: { revision: 2 } },
            });
        }
        expect((await request('POST', path + '/undo', {})).status).toBe(400);
        expect((await request('POST', path + '/accept', { expectedItemRevision: 2, actor: 'scrubber' })).status).toBe(400);
        expect(onChange).not.toHaveBeenCalled();
    });
    it('dismisses without a ledger write and rejects duplicate dismissal', async () => {
        const a = item();
        const path = settle(a.id);
        expect(await request('POST', path + '/dismiss', { expectedItemRevision: 1 })).toMatchObject({ status: 200, body: { finding: { state: 'dismissed' } } });
        expect(todos.get(owner).items[0].revision).toBe(1);
        expect(onChange).toHaveBeenLastCalledWith(owner, { runId: 'run', ledgerChanged: false });
        expect((await request('POST', path + '/dismiss', { expectedItemRevision: 1 })).status).toBe(409);
    });
    it('Undo records a user verdict and refuses later user edits', async () => {
        const a = item();
        const path = settle(a.id, 'done');
        expect(await request('POST', path + '/undo', { expectedItemRevision: 2 })).toMatchObject({
            status: 200, body: { item: { status: 'todo', userVerdictRevision: 3 }, finding: { state: 'undone' } },
        });
        expect((await request('POST', path + '/undo', { expectedItemRevision: 3 })).status).toBe(409);
    });
    it('rolls back failed Accept and publishes nothing', async () => {
        const a = item();
        const path = settle(a.id);
        failTodoWrites(fixture.db);
        expect((await request('POST', path + '/accept', { expectedItemRevision: 1 })).status).toBe(500);
        expect(scrubber.getFinding(owner, 'run', a.id)?.state).toBe('proposed');
        expect(todos.get(owner).items[0].status).toBe('todo');
        expect(onChange).not.toHaveBeenCalled();
    });
});
