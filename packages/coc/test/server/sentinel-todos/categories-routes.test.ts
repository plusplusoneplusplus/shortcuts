import { Readable } from 'node:stream';
import type * as http from 'node:http';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../../../src/server/shared/router';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { type SentinelTodoCategoriesChange, SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { registerSentinelTodoRoutes } from '../../../src/server/sentinel-todos/sentinel-todo-routes';

describe('Workspace Sentinel category routes', () => {
    let db: NativeDatabase;
    let routes: Route[];
    let enabled: boolean;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    const changes = vi.fn<(change: SentinelTodoCategoriesChange) => void>();
    const owners: Record<string, { workspaceId: string; mode: string }> = {
        'parent/a': { workspaceId: 'ws-a', mode: 'sentinel' },
        'parent/b': { workspaceId: 'ws-a', mode: 'sentinel' },
        'other-workspace': { workspaceId: 'ws-b', mode: 'sentinel' },
        'group-chat': { workspaceId: 'group-a', mode: 'sentinel' },
        'ask-chat': { workspaceId: 'ws-a', mode: 'ask' },
    };
    beforeEach(() => {
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        enabled = true;
        changes.mockReset();
        todos = new SentinelTodoStore(db);
        service = new SentinelTodoService({
            todos, getCategoriesEnabled: () => enabled,
            onCategoriesChange: change => {
                // Notifications observe the committed category set and ledger revisions.
                expect(todos.getCategories(change.workspaceId).revision).toBe(change.revision);
                for (const ledger of change.affectedLedgers) {
                    expect(todos.get({ workspaceId: change.workspaceId, processId: ledger.processId }).revision)
                        .toBe(ledger.ledgerRevision);
                }
                changes(change);
            },
            store: { getProcess: async id => owners[id] ? { id, metadata: owners[id] } as never : undefined },
        });
        routes = [];
        registerSentinelTodoRoutes({ routes, service });
    });
    afterEach(() => db.close());
    const base = '/api/workspaces/ws-a/sentinel-todos/parent%2Fa';
    async function request(method: string, pathname: string, body?: unknown) {
        const url = new URL(pathname, 'http://localhost');
        const route = routes.find(route => route.method === method && route.pattern instanceof RegExp && route.pattern.test(url.pathname));
        if (!route || !(route.pattern instanceof RegExp)) throw new Error('Missing route');
        const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as http.IncomingMessage;
        req.url = pathname;
        req.method = method;
        req.headers = { 'content-type': 'application/json' };
        let status = 0;
        let result: unknown;
        const res = {
            writeHead(code: number) { status = code; },
            end(value: Buffer) { result = JSON.parse(value.toString()); },
        } as unknown as http.ServerResponse;
        await route.handler(req, res, url.pathname.match(route.pattern));
        return { status, body: result as any };
    }
    const otherChat = '/api/workspaces/ws-a/sentinel-todos/parent%2Fb';
    const otherWorkspace = '/api/workspaces/ws-b/sentinel-todos/other-workspace';
    const group = '/api/workspaces/group-a/sentinel-todos/group-chat';

    it('shares ordered CRUD across chats, isolating other workspaces and repo groups', async () => {
        expect(await request('GET', `${base}/categories`)).toEqual({ status: 200, body: { revision: 0, categories: [] } });
        const created = await request('POST', `${base}/categories`, { expectedRevision: 0, name: ' API ' });
        expect(created).toMatchObject({ status: 200, body: { revision: 1, categories: [{ name: 'API' }] } });
        expect(await request('GET', `${otherChat}/categories`)).toEqual(created);
        const first = created.body.categories[0].id;
        const second = await request('POST', `${otherChat}/categories`, { expectedRevision: 1, name: 'UI' });
        const ids = second.body.categories.map((category: { id: string }) => category.id).reverse();
        const reordered = await request('PUT', `${base}/categories`, { expectedRevision: 2, categoryIds: ids });
        expect(reordered.body.categories.map((category: { id: string }) => category.id)).toEqual(ids);
        const renamed = await request('PATCH', `${otherChat}/categories/${first}`, { expectedRevision: 3, name: 'Server' });
        expect(renamed).toMatchObject({ status: 200, body: { revision: 4, categories: [{ name: 'UI' }, { name: 'Server' }] } });
        expect(await request('GET', `${base}/categories`)).toEqual(renamed);
        for (const path of [otherWorkspace, group]) {
            expect(await request('GET', `${path}/categories`)).toEqual({ status: 200, body: { revision: 0, categories: [] } });
            expect((await request('POST', `${path}/categories`, { expectedRevision: 0, name: 'Server' })).status).toBe(200);
        }
        expect(await request('GET', `${base}/categories`)).toEqual(renamed);
        expect(changes.mock.calls.slice(0, 4).map(([change]) => change)).toEqual([1, 2, 3, 4]
            .map(revision => ({ workspaceId: 'ws-a', revision, affectedLedgers: [] })));
    });

    it('previews all affected items/chats and publishes committed ledger invalidations on confirmed delete', async () => {
        const created = await request('POST', `${base}/categories`, { expectedRevision: 0, name: 'API' });
        const categoryId = created.body.categories[0].id;
        // Public item assignment is a separate AC-02 slice.
        const firstOwner = { workspaceId: 'ws-a', processId: 'parent/a' };
        const secondOwner = { workspaceId: 'ws-a', processId: 'parent/b' };
        todos.create(firstOwner, { title: 'Normal' }, { actor: 'user' });
        todos.create(firstOwner, { title: 'Manual done', type: 'manual', status: 'done' }, { actor: 'user' });
        const archived = todos.create(secondOwner, { title: 'Archived' }, { actor: 'user' });
        todos.update(secondOwner, archived.item.id, 1, { archived: true }, 'user');
        const foreign = { workspaceId: 'ws-b', processId: 'other-workspace' };
        todos.create(foreign, { title: 'Foreign' }, { actor: 'user' });
        db.prepare('UPDATE sentinel_todo_items SET category_id = ?').run(categoryId);
        changes.mockClear();
        const path = `${otherChat}/categories/${categoryId}`;
        expect(await request('GET', path + '/usage')).toEqual({ status: 200, body: { itemCount: 3, chatCount: 2 } });
        expect((await request('DELETE', path, { expectedRevision: 1 })).status).toBe(400);
        expect((await request('DELETE', path, { expectedRevision: 0, confirmed: true })).status).toBe(409);
        expect(changes).not.toHaveBeenCalled();
        expect(await request('DELETE', path, { expectedRevision: 1, confirmed: true })).toEqual({ status: 200,
            body: { categorySet: { revision: 2, categories: [] }, itemCount: 3, chatCount: 2 } });
        expect(changes).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws-a', revision: 2,
            affectedLedgers: [
                { processId: 'parent/a', ledgerRevision: 4 },
                { processId: 'parent/b', ledgerRevision: 3 },
            ] });
        expect(todos.get(foreign).revision).toBe(1);
        expect((await request('GET', path + '/usage')).status).toBe(404);
        expect((await request('GET', `${base}/categories`)).body).toEqual({ revision: 2, categories: [] });
    });

    it('rejects stale/invalid writes and missing categories without publishing changes', async () => {
        const created = await request('POST', `${base}/categories`, { expectedRevision: 0, name: 'API' });
        const path = `${base}/categories/${created.body.categories[0].id}`;
        changes.mockClear();
        for (const [method, url, body, status] of [
            ['POST', `${base}/categories`, { expectedRevision: 0, name: 'UI' }, 409],
            ['PATCH', path, { expectedRevision: 0, name: 'UI' }, 409],
            ['PUT', `${base}/categories`, { expectedRevision: 0, categoryIds: [] }, 409],
            ['POST', `${base}/categories`, { expectedRevision: 1, name: 'api' }, 400],
            ['POST', `${base}/categories`, { expectedRevision: 1, name: ' '.repeat(2) }, 400],
            ['POST', `${base}/categories`, { expectedRevision: 1, name: 'x'.repeat(41) }, 400],
            ['POST', `${base}/categories`, { expectedRevision: 1, name: 'UI', color: 'blue' }, 400],
            ['PUT', `${base}/categories`, { expectedRevision: 1, categoryIds: [] }, 400],
            ['PATCH', `${base}/categories/missing`, { expectedRevision: 1, name: 'UI' }, 404],
            ['DELETE', `${base}/categories/missing`, { expectedRevision: 1, confirmed: true }, 404],
        ] as const) {
            expect((await request(method, url, body)).status).toBe(status);
        }
        expect(changes).not.toHaveBeenCalled();
        expect(await request('GET', `${base}/categories`)).toEqual(created);
    });

    it('proves Sentinel ownership for every endpoint and gates routes and direct service calls live', async () => {
        const endpoints = [['GET', '/categories'], ['POST', '/categories'], ['PUT', '/categories'],
            ['PATCH', '/categories/id'], ['DELETE', '/categories/id'], ['GET', '/categories/id/usage']];
        for (const invalid of [base.replace('ws-a', 'ws-b'), base.replace('parent%2Fa', 'unknown'),
            base.replace('parent%2Fa', 'ask-chat')]) {
            for (const [method, suffix] of endpoints) expect((await request(method, invalid + suffix, {})).status).toBe(404);
        }
        enabled = false;
        for (const [method, suffix] of endpoints) expect((await request(method, base + suffix, {})).status).toBe(404);
        const owner = { workspaceId: 'ws-a', processId: 'parent/a' };
        for (const call of [() => service.getCategories(owner), () => service.createCategory(owner, {}),
            () => service.updateCategory(owner, 'id', {}), () => service.reorderCategories(owner, {}),
            () => service.getCategoryUsage(owner, 'id'), () => service.deleteCategory(owner, 'id', {})]) {
            await expect(call()).rejects.toMatchObject({ code: 'not_found' });
        }
        expect(changes).not.toHaveBeenCalled();
        expect(todos.getCategories('ws-a')).toEqual({ revision: 0, categories: [] });
        enabled = true;
        expect((await request('POST', `${base}/categories`, { expectedRevision: 0, name: 'API' })).status).toBe(200);
        changes.mockImplementationOnce(() => { throw new Error('Notification transport unavailable'); });
        expect((await request('POST', `${base}/categories`, { expectedRevision: 1, name: 'UI' })).status).toBe(200);
        expect(todos.getCategories('ws-a').revision).toBe(2);
    });
});
