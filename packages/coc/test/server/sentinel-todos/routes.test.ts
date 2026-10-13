import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouter } from '../../../src/server/shared/router';
import type { Route } from '../../../src/server/types';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelDependencyStore } from '../../../src/server/sentinel-todos/sentinel-dependency-store';
import { SentinelDependencyActions } from '../../../src/server/sentinel-todos/sentinel-dependency-actions';
import { registerSentinelTodoRoutes } from '../../../src/server/sentinel-todos/sentinel-todo-routes';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { artifactVersion } from '../../../src/server/sentinel-todos/sentinel-todo-evidence';
import { createTodoTestDatabase, createTodoTestDirectory, failTodoWrites } from './test-db';

const processes: Record<string, { mode: string; workspaceId: string }> = {
    queue_s1: { mode: 'sentinel', workspaceId: 'ws-a' },
    queue_s2: { mode: 'sentinel', workspaceId: 'group-team' },
    queue_s3: { mode: 'sentinel', workspaceId: 'ws-a' },
    queue_ask: { mode: 'ask', workspaceId: 'ws-a' },
};

async function startServer(opts: { dependenciesEnabled?: boolean; dataDir?: string } = {}) {
    const database = createTodoTestDatabase(opts.dataDir ?? createTodoTestDirectory());
    const { dataDir, db } = database;
    const todos = new SentinelTodoStore(db);
    const routes: Route[] = [];
    const onChange = vi.fn();
    const dependenciesEnabled = { value: opts.dependenciesEnabled ?? false };
    const service = new SentinelTodoService({
        todos,
        store: { getProcess: async (id: string) => processes[id] ? { id, metadata: processes[id] } as never : undefined },
        onChange, getDependenciesEnabled: () => dependenciesEnabled.value,
        resolveWorkspaceRoot: async () => dataDir,
        fetchPr: async pr => ({ status: 'merged', url: pr.url, title: 'Mock output' }),
    });
    service.dependencyActions = new SentinelDependencyActions({
        service, receipts: new SentinelDependencyStore(db, todos),
        delivery: { deliverOnce: vi.fn() }, validateProvider: async () => {},
        validateTarget: async target => { if (target !== 'ws-child') throw new Error('Unknown target'); },
        validateCurrent: () => {},
    });
    registerSentinelTodoRoutes({
        routes,
        service,
    });
    const server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    let closed = false;
    return {
        dataDir, db, todos, service, onChange, dependenciesEnabled,
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: async () => {
            if (closed) return;
            closed = true;
            await new Promise<void>(resolve => server.close(() => resolve()));
            database.close();
        },
    };
}

async function req(baseUrl: string, method: string, url: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${url}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

describe('Sentinel to-do routes', () => {
    const cleanups: Array<() => Promise<void> | void> = [];
    afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
    const track = async (s: Awaited<ReturnType<typeof startServer>>, removeDir = true) => {
        cleanups.push(s.close);
        if (removeDir) cleanups.unshift(() => fs.rmSync(s.dataDir, { recursive: true, force: true }));
        return s;
    };
    const ledger = '/api/workspaces/ws-a/sentinel-todos/queue_s1';

    it('includes all active items before recent Done while retaining older pages, exact reads and full-store dependencies', async () => {
        const s = await track(await startServer({ dependenciesEnabled: true }));
        const owner = { workspaceId: 'ws-a', processId: 'queue_s1' };
        const items = Array.from({ length: 105 }, (_, index) => s.todos.create(owner, {
            title: `Item ${index}`, status: index === 1 ? 'in_progress' : index === 104 ? 'todo' : 'done',
        }, { actor: 'user', idempotencyKey: `item-${index}` }).item);
        const client = new CocClient({ baseUrl: s.baseUrl });
        const recent = await client.sentinelTodos.get(owner.workspaceId, owner.processId);
        const ordered = [items[1], items[104], ...items.slice(2, 104).reverse(), items[0]];
        expect(recent.items.map(item => item.id)).toEqual(ordered.slice(0, 50).map(item => item.id));
        expect(recent).toMatchObject({ total: 105, hasMore: true, nextOffset: 50 });
        const older = await client.sentinelTodos.get(owner.workspaceId, owner.processId, { offset: recent.nextOffset! });
        expect(older.items.map(item => item.id)).toEqual(ordered.slice(50, 100).map(item => item.id));
        expect(older).toMatchObject({ hasMore: true, nextOffset: 100 });
        const last = await client.sentinelTodos.get(owner.workspaceId, owner.processId, { offset: 100 });
        expect(last.items.map(item => item.id)).toEqual(ordered.slice(100).map(item => item.id));
        expect(last).toMatchObject({ hasMore: false, nextOffset: null });
        expect(await client.sentinelTodos.get(owner.workspaceId, owner.processId, { offset: 200 }))
            .toMatchObject({ items: [], total: 105, hasMore: false, nextOffset: null });
        expect((await client.sentinelTodos.get(owner.workspaceId, owner.processId, { itemId: items[0].id })).items)
            .toEqual([items[0]]);
        expect((await client.sentinelTodos.get(owner.workspaceId, owner.processId, { limit: 500 })).items).toHaveLength(105);
        expect((await client.sentinelTodos.get(owner.workspaceId, owner.processId, { full: true })).items).toEqual(items);
        expect((await req(s.baseUrl, 'GET', `${ledger.replace('queue_s1', 'queue_s3')}?itemId=${items[0].id}`)).status).toBe(404);
        expect((await req(s.baseUrl, 'GET', `${ledger}?itemId=missing`)).status).toBe(404);
        expect(s.todos.get(owner).items).toEqual(items);
        expect(s.todos.create(owner, { title: 'Retry' }, { actor: 'user', idempotencyKey: 'item-0' }).item).toEqual(items[0]);
        await client.sentinelTodos.setDependencies(owner.workspaceId, owner.processId, items[104].id, {
            expectedRevision: 1, dependsOn: [{ itemId: items[0].id, condition: { kind: 'done' } }],
        });
        expect(await client.sentinelTodos.evaluateDependencies(owner.workspaceId, owner.processId, items[104].id))
            .toMatchObject({ state: 'ready', edges: [{ sourceRevision: 1, satisfied: true }] });
        await expect(client.sentinelTodos.setDependencies(owner.workspaceId, owner.processId, items[0].id, {
            expectedRevision: 1, dependsOn: [{ itemId: items[104].id, condition: { kind: 'done' } }],
        })).rejects.toMatchObject({ status: 400, code: 'invalid' });
        const edited = await client.sentinelTodos.update(owner.workspaceId, owner.processId, items[0].id, { expectedRevision: 1, notes: 'Retained older item' });
        expect(edited.item.notes).toBe('Retained older item');
        expect((await s.service.list(owner)).items).toHaveLength(105);
        await s.close();
        const reopened = await track(await startServer({ dataDir: s.dataDir }), false);
        expect((await new CocClient({ baseUrl: reopened.baseUrl }).sentinelTodos.get(owner.workspaceId, owner.processId, { full: true })).items)
            .toHaveLength(105);
    });

    it('returns more than 50 active items and pages only the remaining Done history', async () => {
        const s = await track(await startServer());
        const owner = { workspaceId: 'ws-a', processId: 'queue_s1' };
        const active = Array.from({ length: 55 }, (_, index) => s.todos.create(owner, {
            title: `Active ${index}`, status: index === 0 ? 'in_progress' : 'todo',
        }, { actor: 'user' }).item);
        const done = s.todos.create(owner, { title: 'Done', status: 'done' }, { actor: 'user' }).item;
        const client = new CocClient({ baseUrl: s.baseUrl });
        const first = await client.sentinelTodos.get(owner.workspaceId, owner.processId);
        expect(first.items).toEqual(active);
        expect(first).toMatchObject({ total: 56, hasMore: true, nextOffset: 55 });
        expect(await client.sentinelTodos.get(owner.workspaceId, owner.processId, { offset: first.nextOffset! }))
            .toMatchObject({ items: [done], hasMore: false, nextOffset: null });
        expect((await client.sentinelTodos.get(owner.workspaceId, owner.processId, { limit: 1 })).items).toEqual(active);
        expect((await client.sentinelTodos.get(owner.workspaceId, owner.processId, { itemId: done.id, offset: 55 })).items)
            .toEqual([done]);
    });

    it.each(['limit=0', 'limit=501', 'limit=1.5', 'limit=NaN', 'offset=-1', 'offset=1.5', 'full=invalid'])(
        'rejects invalid recent-list options without changing records: %s', async query => {
            const s = await track(await startServer());
            expect((await req(s.baseUrl, 'GET', `${ledger}?${query}`)).status).toBe(400);
            expect(s.db.prepare('SELECT COUNT(*) AS count FROM sentinel_todo_items').get()).toEqual({ count: 0 });
        },
    );

    it('has no separate dependency-action approval or revocation endpoint', async () => {
        const s = await track(await startServer({ dependenciesEnabled: true }));
        for (const method of ['PUT', 'DELETE']) {
            expect((await req(s.baseUrl, method, `${ledger}/items/item/dependency-action`, {})).status).toBe(404);
        }
    });

    it('exposes bookkeeping without a feature gate while dependencies stay disabled', async () => {
        const s = await track(await startServer());
        expect((await req(s.baseUrl, 'GET', ledger)).status).toBe(200);
        const created = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'Always tracked' });
        expect(created.status).toBe(201);
        expect((await req(s.baseUrl, 'PATCH', `${ledger}/items/${created.body.item.id}`,
            { expectedRevision: 1, title: 'Edited' })).status).toBe(200);
        expect((await req(s.baseUrl, 'PUT', `${ledger}/items/${created.body.item.id}/dependencies`,
            { expectedRevision: 2, dependsOn: [] })).status).toBe(404);
        expect(s.onChange).toHaveBeenCalledTimes(2);
    });

    it('shares gated owner-validated exact evidence and readiness with the client', async () => {
        const s = await track(await startServer({ dataDir: fs.mkdtempSync(path.join(process.cwd(), '.sentinel-evidence-route-test-')) }));
        const client = new CocClient({ baseUrl: s.baseUrl });
        const source = (await client.sentinelTodos.create('ws-a', 'queue_s1', { title: 'Source' })).item;
        const dependent = (await client.sentinelTodos.create('ws-a', 'queue_s1', { title: 'Dependent' })).item;
        const pr = { expectedRevision: 1, outputSlot: 'code', prUrl: 'https://github.com/example/project/pull/42',
            provenance: { kind: 'owner_selection' as const, reason: 'Exact produced output selected' } };
        for (const suffix of ['pr-output', 'artifact-acceptance', 'readiness']) {
            expect((await req(s.baseUrl, 'POST', `${ledger}/items/${source.id}/${suffix}`, {})).status).toBe(404);
        }
        s.dependenciesEnabled.value = true;
        await client.sentinelTodos.setDependencies('ws-a', 'queue_s1', dependent.id, {
            expectedRevision: 1, dependsOn: [{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'code' } }],
        });
        expect((await client.sentinelTodos.evaluateDependencies('ws-a', 'queue_s1', dependent.id)).state).toBe('waiting');
        expect((await req(s.baseUrl, 'POST', `${ledger}/items/${source.id}/pr-output`, { ...pr, actor: 'sentinel' })).status).toBe(400);
        expect((await req(s.baseUrl, 'POST', `${ledger.replace('queue_s1', 'queue_s3')}/items/${source.id}/pr-output`, pr)).status).toBe(404);
        const bound = await client.sentinelTodos.bindPrOutput('ws-a', 'queue_s1', source.id, pr);
        expect(bound.item.evidence?.[0]).toMatchObject({ recordedBy: 'user', provenance: pr.provenance });
        expect((await client.sentinelTodos.evaluateDependencies('ws-a', 'queue_s1', dependent.id)).state).toBe('ready');
        expect((await req(s.baseUrl, 'POST', `${ledger}/items/${source.id}/pr-output`, pr)).status).toBe(409);
        fs.writeFileSync(path.join(s.dataDir, 'design.md'), 'Exact design');
        const acceptance = { expectedRevision: 2, phase: 'design', reference: 'design.md', version: artifactVersion(s.dataDir, 'design.md') };
        expect((await client.sentinelTodos.acceptArtifact('ws-a', 'queue_s1', source.id, acceptance)).item.status).toBe('todo');
        expect((await req(s.baseUrl, 'POST', `${ledger}/items/${dependent.id}/readiness`, { merged: true })).status).toBe(400);
        expect((await req(s.baseUrl, 'POST', `${ledger.replace('queue_s1', 'queue_ask')}/items/${dependent.id}/readiness`, {})).status).toBe(404);
        expect(s.onChange).toHaveBeenCalledTimes(5);
    });

    it('gates graph authoring live and validates owner, typed edges, revisions and cycles', async () => {
        const s = await track(await startServer());
        const a = (await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'A', targetRepo: { workspaceId: 'ws-a' } })).body.item;
        const b = (await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'B', targetRepo: { workspaceId: 'ws-b' } })).body.item;
        const route = `${ledger}/items/${b.id}/dependencies`;
        const request = { expectedRevision: 1, dependsOn: [{ itemId: a.id, condition: { kind: 'done' } }] };
        expect((await req(s.baseUrl, 'PUT', route, request)).status).toBe(404);
        s.dependenciesEnabled.value = true;
        expect((await req(s.baseUrl, 'PUT', route, { ...request, serverId: 'remote' })).status).toBe(400);
        expect((await req(s.baseUrl, 'PUT', route, { expectedRevision: 1 })).status).toBe(400);
        expect((await req(s.baseUrl, 'PUT', route.replace('queue_s1', 'queue_ask'), request)).status).toBe(404);
        expect((await req(s.baseUrl, 'PUT', route, request)).body.item).toMatchObject({ revision: 2, status: 'todo', dependsOn: request.dependsOn });
        expect((await req(s.baseUrl, 'PUT', route, request))).toMatchObject({ status: 409, body: { current: { revision: 2 } } });
        expect((await req(s.baseUrl, 'PUT', `${ledger}/items/${a.id}/dependencies`, {
            expectedRevision: 1, dependsOn: [{ itemId: b.id, condition: { kind: 'done' } }],
        })).status).toBe(400);
        expect(s.onChange).toHaveBeenCalledTimes(3);
        s.dependenciesEnabled.value = false;
        expect((await req(s.baseUrl, 'PUT', route, { expectedRevision: 2, dependsOn: [] })).status).toBe(404);
    });

    it('creates and edits an item that survives a server restart', async () => {
        const s = await track(await startServer(), false);
        cleanups.unshift(() => fs.rmSync(s.dataDir, { recursive: true, force: true }));
        expect((await req(s.baseUrl, 'GET', ledger)).body).toEqual({ revision: 0, items: [], total: 0, hasMore: false, nextOffset: null });

        const created = await req(s.baseUrl, 'POST', `${ledger}/items`, {
            title: 'Fix login', completionCondition: 'Login e2e passes', idempotencyKey: 'k1',
        });
        expect(created.status).toBe(201);
        expect(created.body.item).toMatchObject({ title: 'Fix login', status: 'todo', revision: 1, createdBy: 'user' });
        const retry = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'Fix login', idempotencyKey: 'k1' });
        expect(retry.status).toBe(200);
        expect(retry.body.item.id).toBe(created.body.item.id);

        const edited = await req(s.baseUrl, 'PATCH', `${ledger}/items/${created.body.item.id}`, {
            expectedRevision: 1, notes: 'Needs a token refresh', status: 'in_progress',
        });
        expect(edited.status).toBe(200);
        expect(edited.body.item).toMatchObject({ revision: 2, notes: 'Needs a token refresh', status: 'in_progress' });
        expect(s.onChange).toHaveBeenCalledTimes(2);

        await s.close();
        const restarted = await track(await startServer({ dataDir: s.dataDir }), false);
        const reloaded = await req(restarted.baseUrl, 'GET', ledger);
        expect(reloaded.body.items).toHaveLength(1);
        expect(reloaded.body.items[0]).toMatchObject({ title: 'Fix login', notes: 'Needs a token refresh', revision: 2 });
    });

    it('reports a 409 conflict with the accepted version for a stale edit', async () => {
        const s = await track(await startServer());
        const { body } = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'Draft' });
        const itemUrl = `${ledger}/items/${body.item.id}`;
        expect((await req(s.baseUrl, 'PATCH', itemUrl, { expectedRevision: 1, title: 'First' })).status).toBe(200);
        const stale = await req(s.baseUrl, 'PATCH', itemUrl, { expectedRevision: 1, title: 'Second' });
        expect(stale.status).toBe(409);
        expect(stale.body).toMatchObject({ code: 'conflict', current: { title: 'First', revision: 2 } });
        expect((await req(s.baseUrl, 'GET', ledger)).body.items[0].title).toBe('First');
    });

    it('accepts exact user review evidence through the revision-checked client API', async () => {
        const s = await track(await startServer());
        const client = new CocClient({ baseUrl: s.baseUrl });
        const { item } = await client.sentinelTodos.create('ws-a', 'queue_s1', { title: 'Feature' });
        const todos = new SentinelTodoStore(s.db);
        const owner = { workspaceId: 'ws-a', processId: 'queue_s1' };
        todos.linkJob(owner, item.id, {
            processId: 'queue_child', workspaceId: 'ws-child', kind: 'local', openLink: '#',
        });
        todos.recordJobResult(owner, 'queue_child', { terminalEventId: 'event', outcome: 'completed' }, () => 'Completed');
        const current = (await client.sentinelTodos.get('ws-a', 'queue_s1')).items[0];
        expect(current.jobs[0].execution).toMatchObject({ review: { assessment: 'pending' } });
        const reviewedJobs = [{ processId: 'queue_child', terminalEventId: 'event' }];
        await expect(client.sentinelTodos.update('ws-a', 'queue_s1', item.id, {
            expectedRevision: 1, status: 'todo', reviewedJobs,
        })).rejects.toMatchObject({ status: 409 });
        await client.sentinelTodos.update('ws-a', 'queue_s1', item.id, {
            expectedRevision: current.revision, status: 'todo', reviewedJobs,
        });
        const assessed = (await client.sentinelTodos.get('ws-a', 'queue_s1')).items[0];
        expect(assessed.status).toBe('todo');
        expect(assessed.jobs[0].execution).toMatchObject({ review: { assessment: 'reviewed', terminalEventId: 'event' } });
        expect(s.onChange).toHaveBeenCalledTimes(2);
    });

    it('round-trips manual items through the client and API with replay and revision protection', async () => {
        const s = await track(await startServer());
        const client = new CocClient({ baseUrl: s.baseUrl });
        const created = await client.sentinelTodos.create('ws-a', 'queue_s1', {
            type: 'manual', title: 'Check release', idempotencyKey: 'manual-k1',
        });
        expect(created.item).toMatchObject({
            type: 'manual', status: 'todo', priority: 'regular', notes: '', completionCondition: '', jobs: [],
        });
        const retry = await client.sentinelTodos.create('ws-a', 'queue_s1', {
            type: 'normal', title: 'Retry cannot convert', idempotencyKey: 'manual-k1',
        });
        expect(retry).toMatchObject({ created: false, item: created.item, ledgerRevision: 1 });
        const edited = await client.sentinelTodos.update('ws-a', 'queue_s1', created.item.id, {
            expectedRevision: 1, notes: 'Read notes', priority: 'high',
        });
        expect(edited.item).toMatchObject({ type: 'manual', revision: 2, priority: 'high' });
        await expect(client.sentinelTodos.update('ws-a', 'queue_s1', created.item.id, {
            expectedRevision: 1, title: 'Stale',
        })).rejects.toMatchObject({
            code: 'conflict', body: { current: { type: 'manual', title: 'Check release', revision: 2 } },
        });
        const rejected = await req(s.baseUrl, 'PATCH', `${ledger}/items/${created.item.id}`, {
            expectedRevision: 2, type: 'normal',
        });
        expect(rejected).toMatchObject({ status: 400, body: { code: 'invalid' } });
        expect(s.onChange).toHaveBeenCalledTimes(2);
        expect(await client.sentinelTodos.get('ws-a', 'queue_s1')).toMatchObject({
            revision: 2, items: [{ type: 'manual', title: 'Check release', notes: 'Read notes', revision: 2 }],
        });
        const beforeRestart = await client.sentinelTodos.get('ws-a', 'queue_s1');
        await s.close();
        const restarted = await track(await startServer({ dataDir: s.dataDir }), false);
        expect((await new CocClient({ baseUrl: restarted.baseUrl }).sentinelTodos.get('ws-a', 'queue_s1')).items)
            .toEqual(beforeRestart.items);
    });

    it('isolates manual items across chats, groups, and same-ID owners on separate servers', async () => {
        const local = await track(await startServer());
        const remote = await track(await startServer());
        await req(local.baseUrl, 'POST', `${ledger}/items`, { type: 'manual', title: 'Local' });
        const otherChat = '/api/workspaces/ws-a/sentinel-todos/queue_s3';
        const group = '/api/workspaces/group-team/sentinel-todos/queue_s2';
        await req(local.baseUrl, 'POST', `${otherChat}/items`, { type: 'manual', title: 'Other chat' });
        await req(local.baseUrl, 'POST', `${group}/items`, { type: 'manual', title: 'Group' });
        expect((await req(remote.baseUrl, 'GET', ledger)).body.items).toEqual([]);
        await new CocClient({ baseUrl: remote.baseUrl }).sentinelTodos.create('ws-a', 'queue_s1', {
            type: 'manual', title: 'Remote',
        });
        for (const [baseUrl, route, title] of [
            [local.baseUrl, ledger, 'Local'], [local.baseUrl, otherChat, 'Other chat'],
            [local.baseUrl, group, 'Group'], [remote.baseUrl, ledger, 'Remote'],
        ]) {
            expect((await req(baseUrl, 'GET', route)).body.items).toMatchObject([{ type: 'manual', title }]);
            expect((await req(baseUrl, 'GET', route)).body.items).toHaveLength(1);
        }
    });

    it('keeps failed manual writes unpublished and accepts an idempotent retry', async () => {
        const s = await track(await startServer());
        const input = { type: 'manual', title: 'Check release', idempotencyKey: 'manual-k1' };
        let restoreWrites = failTodoWrites(s.db);
        expect((await req(s.baseUrl, 'POST', `${ledger}/items`, input)).status).toBe(500);
        expect(s.onChange).not.toHaveBeenCalled();
        expect((await req(s.baseUrl, 'GET', ledger)).body).toEqual({ revision: 0, items: [], total: 0, hasMore: false, nextOffset: null });
        restoreWrites();
        const created = await req(s.baseUrl, 'POST', `${ledger}/items`, input);
        expect(created.status).toBe(201);
        restoreWrites = failTodoWrites(s.db);
        expect((await req(s.baseUrl, 'PATCH', `${ledger}/items/${created.body.item.id}`, {
            expectedRevision: 1, notes: 'Not saved',
        })).status).toBe(500);
        expect(s.onChange).toHaveBeenCalledTimes(1);
        expect((await req(s.baseUrl, 'GET', ledger)).body).toMatchObject({
            revision: 1, items: [{ type: 'manual', notes: '', revision: 1 }],
        });
        restoreWrites();
        expect((await req(s.baseUrl, 'POST', `${ledger}/items`, input)).status).toBe(200);
        expect((await req(s.baseUrl, 'GET', ledger)).body.items).toHaveLength(1);
        expect(s.onChange).toHaveBeenCalledTimes(1);
    });

    it('isolates chats and workspaces, including repo groups, and rejects non-Sentinel or mismatched owners', async () => {
        const s = await track(await startServer());
        await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'In ws-a' });
        const group = await req(s.baseUrl, 'POST', '/api/workspaces/group-team/sentinel-todos/queue_s2/items', { title: 'In group' });
        expect(group.status).toBe(201);
        expect((await req(s.baseUrl, 'GET', ledger)).body.items.map((i: { title: string }) => i.title)).toEqual(['In ws-a']);
        expect((await req(s.baseUrl, 'GET', '/api/workspaces/group-team/sentinel-todos/queue_s2')).body.items
            .map((i: { title: string }) => i.title)).toEqual(['In group']);

        expect((await req(s.baseUrl, 'GET', '/api/workspaces/ws-a/sentinel-todos/queue_s2')).status).toBe(404);
        expect((await req(s.baseUrl, 'POST', '/api/workspaces/ws-a/sentinel-todos/queue_ask/items', { title: 'x' })).status).toBe(404);
        expect((await req(s.baseUrl, 'GET', '/api/workspaces/ws-a/sentinel-todos/queue_missing')).status).toBe(404);
        expect((await req(s.baseUrl, 'GET', '/api/workspaces/bad%2Fid/sentinel-todos/queue_s1')).status).toBe(400);
    });

    it('marks Done for a person without a reason and never takes a caller-supplied actor', async () => {
        const s = await track(await startServer());
        const created = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'Fix login' });
        const itemUrl = `${ledger}/items/${created.body.item.id}`;
        const spoofed = await req(s.baseUrl, 'PATCH', itemUrl, { expectedRevision: 1, status: 'done', actor: 'sentinel' });
        expect(spoofed.status).toBe(400);
        expect((await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'x', actor: 'system' })).status).toBe(400);
        const done = await req(s.baseUrl, 'PATCH', itemUrl, { expectedRevision: 1, status: 'done', statusReason: null });
        expect(done.status).toBe(200);
        expect(done.body.item).toMatchObject({ status: 'done', revision: 2, updatedBy: 'user' });
        expect(done.body.item.statusReason).toBeUndefined();
        expect(done.body.item.outcome).toBeUndefined();
        const reopened = await req(s.baseUrl, 'PATCH', itemUrl, { expectedRevision: 2, status: 'todo', statusReason: null });
        const reviewed = await req(s.baseUrl, 'PATCH', itemUrl, {
            expectedRevision: reopened.body.item.revision, status: 'done', statusReason: 'Verified', outcome: 'Verified',
        });
        expect(reviewed.body.item).toMatchObject({ statusReason: 'Verified', outcome: { summary: 'Verified', recordedBy: 'user' } });
    });

    it('round-trips priority through create, priority-only edit, and reload, and rejects unknown values', async () => {
        const s = await track(await startServer());
        const plain = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'Plain' });
        expect(plain.body.item.priority).toBe('regular');
        const high = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'Urgent', priority: 'high' });
        expect(high.body.item).toMatchObject({ priority: 'high', createdBy: 'user' });
        const itemUrl = `${ledger}/items/${high.body.item.id}`;
        await req(s.baseUrl, 'PATCH', itemUrl, { expectedRevision: 1, status: 'needs_attention', statusReason: 'Blocked' });
        const lowered = await req(s.baseUrl, 'PATCH', itemUrl, { expectedRevision: 2, priority: 'regular' });
        expect(lowered.status).toBe(200);
        expect(lowered.body.item).toMatchObject({ priority: 'regular', status: 'needs_attention', statusReason: 'Blocked', revision: 3 });
        expect((await req(s.baseUrl, 'GET', ledger)).body.items.map((i: { priority: string }) => i.priority)).toEqual(['regular', 'regular']);

        const badCreate = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'x', priority: 'urgent' });
        expect(badCreate).toMatchObject({ status: 400, body: { code: 'invalid' } });
        const badEdit = await req(s.baseUrl, 'PATCH', itemUrl, { expectedRevision: 3, priority: 'HIGH' });
        expect(badEdit).toMatchObject({ status: 400, body: { code: 'invalid' } });
        expect((await req(s.baseUrl, 'GET', ledger)).body.items).toHaveLength(2);
    });

    it('validates bodies', async () => {
        const s = await track(await startServer());
        expect((await req(s.baseUrl, 'POST', `${ledger}/items`, { title: '' })).body).toMatchObject({ code: 'invalid' });
        expect((await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'x', idempotencyKey: 5 })).status).toBe(400);
        expect((await req(s.baseUrl, 'PATCH', `${ledger}/items/x`, { title: 'y' })).status).toBe(400);
        expect((await req(s.baseUrl, 'PATCH', `${ledger}/items/missing`, { expectedRevision: 1, title: 'y' })).status).toBe(404);
    });

    it('returns 500 with no live update when the SQLite write fails', async () => {
        const s = await track(await startServer());
        failTodoWrites(s.db);
        const res = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'x' });
        expect(res.status).toBe(500);
        expect(res.body.item).toBeUndefined();
        expect(s.onChange).not.toHaveBeenCalled();
        expect((await req(s.baseUrl, 'GET', ledger)).body).toEqual({ revision: 0, items: [], total: 0, hasMore: false, nextOffset: null });
    });
});
