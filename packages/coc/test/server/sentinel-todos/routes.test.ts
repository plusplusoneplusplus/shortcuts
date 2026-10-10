import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouter } from '../../../src/server/shared/router';
import type { Route } from '../../../src/server/types';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { registerSentinelTodoRoutes } from '../../../src/server/sentinel-todos/sentinel-todo-routes';
import { atomicWriteJsonUnique } from '../../../src/server/shared/fs-utils';
import { CocClient } from '@plusplusoneplusplus/coc-client';

const processes: Record<string, { mode: string; workspaceId: string }> = {
    queue_s1: { mode: 'sentinel', workspaceId: 'ws-a' },
    queue_s2: { mode: 'sentinel', workspaceId: 'group-team' },
    queue_s3: { mode: 'sentinel', workspaceId: 'ws-a' },
    queue_ask: { mode: 'ask', workspaceId: 'ws-a' },
};

async function startServer(opts: { enabled?: boolean; write?: (file: string, data: unknown) => void; dataDir?: string } = {}) {
    const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sentinel-todo-routes-'));
    const routes: Route[] = [];
    const onChange = vi.fn();
    const enabled = { value: opts.enabled ?? true };
    registerSentinelTodoRoutes({
        routes,
        getEnabled: () => enabled.value,
        service: new SentinelTodoService({
            todos: new SentinelTodoStore(dataDir, opts.write),
            store: { getProcess: async (id: string) => processes[id] ? { id, metadata: processes[id] } as never : undefined },
            onChange,
        }),
    });
    const server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    return {
        dataDir, onChange, enabled,
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
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

    it('hides every endpoint when the feature is off', async () => {
        const s = await track(await startServer({ enabled: false }));
        expect((await req(s.baseUrl, 'GET', ledger)).status).toBe(404);
        expect((await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'x' })).status).toBe(404);
        expect((await req(s.baseUrl, 'PATCH', `${ledger}/items/x`, { expectedRevision: 1 })).status).toBe(404);
        expect(fs.existsSync(path.join(s.dataDir, 'repos'))).toBe(false);
        expect(s.onChange).not.toHaveBeenCalled();
    });

    it('creates and edits an item that survives a server restart', async () => {
        const s = await track(await startServer(), false);
        cleanups.unshift(() => fs.rmSync(s.dataDir, { recursive: true, force: true }));
        expect((await req(s.baseUrl, 'GET', ledger)).body).toEqual({ revision: 0, items: [] });

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
        const restarted = await track(await startServer({ dataDir: s.dataDir }), false);
        expect((await new CocClient({ baseUrl: restarted.baseUrl }).sentinelTodos.get('ws-a', 'queue_s1')).items)
            .toEqual((await client.sentinelTodos.get('ws-a', 'queue_s1')).items);
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
        let failWrite = false;
        const s = await track(await startServer({ write: (file, data) => {
            if (failWrite) throw new Error('EIO');
            atomicWriteJsonUnique(file, data);
        } }));
        const input = { type: 'manual', title: 'Check release', idempotencyKey: 'manual-k1' };
        failWrite = true;
        expect((await req(s.baseUrl, 'POST', `${ledger}/items`, input)).status).toBe(500);
        expect(s.onChange).not.toHaveBeenCalled();
        expect((await req(s.baseUrl, 'GET', ledger)).body).toEqual({ revision: 0, items: [] });
        failWrite = false;
        const created = await req(s.baseUrl, 'POST', `${ledger}/items`, input);
        expect(created.status).toBe(201);
        failWrite = true;
        expect((await req(s.baseUrl, 'PATCH', `${ledger}/items/${created.body.item.id}`, {
            expectedRevision: 1, notes: 'Not saved',
        })).status).toBe(500);
        expect(s.onChange).toHaveBeenCalledTimes(1);
        expect((await req(s.baseUrl, 'GET', ledger)).body).toMatchObject({
            revision: 1, items: [{ type: 'manual', notes: '', revision: 1 }],
        });
        failWrite = false;
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

    it('returns 500 with no live update when the disk write fails', async () => {
        const s = await track(await startServer({ write: () => { throw new Error('EIO'); } }));
        const res = await req(s.baseUrl, 'POST', `${ledger}/items`, { title: 'x' });
        expect(res.status).toBe(500);
        expect(res.body.item).toBeUndefined();
        expect(s.onChange).not.toHaveBeenCalled();
        expect((await req(s.baseUrl, 'GET', ledger)).body.items).toEqual([]);
    });
});
