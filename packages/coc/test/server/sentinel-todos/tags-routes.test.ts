import { Readable } from 'node:stream';
import type * as http from 'node:http';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Route } from '../../../src/server/shared/router';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { registerSentinelTodoRoutes } from '../../../src/server/sentinel-todos/sentinel-todo-routes';

describe('Sentinel tag routes without a live server', () => {
    let db: NativeDatabase;
    let routes: Route[];
    let enabled: boolean;
    beforeEach(() => {
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        enabled = true;
        const todos = new SentinelTodoStore(db);
        const service = new SentinelTodoService({
            todos, getTagsEnabled: () => enabled,
            store: { getProcess: async id => id === 'parent/a'
                ? { id, metadata: { mode: 'sentinel', workspaceId: 'ws-a' } } as never : undefined },
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
    const tag = { expectedRevision: 0, name: 'API', color: 'blue' };

    it('exposes encoded parent-scoped library CRUD and retains libraries in recent-list responses', async () => {
        expect(await request('GET', `${base}/tags`)).toEqual({ status: 200, body: { revision: 0, tags: [] } });
        const created = await request('POST', `${base}/tags`, tag);
        expect(created.status).toBe(200);
        const id = created.body.tags[0].id;
        expect(await request('GET', base)).toMatchObject({ status: 200, body: { tagLibrary: created.body } });
        expect(await request('PATCH', `${base}/tags/${id}`, { ...tag, expectedRevision: 1, name: 'Server' }))
            .toMatchObject({ status: 200, body: { revision: 2, tags: [{ name: 'Server' }] } });
        expect((await request('DELETE', `${base}/tags/${id}`, { expectedRevision: 1, confirmed: true })).status).toBe(409);
        expect((await request('DELETE', `${base}/tags/${id}`, { expectedRevision: 2 })).status).toBe(400);
        expect(await request('DELETE', `${base}/tags/${id}`, { expectedRevision: 2, confirmed: true }))
            .toEqual({ status: 200, body: { revision: 3, tags: [] } });
    });

    it('supports explicit manual clears and requires confirmation for re-suggestion', async () => {
        await request('POST', `${base}/tags`, tag);
        const created = await request('POST', `${base}/items`, { title: 'Track', tagIds: [] });
        expect(created).toMatchObject({ status: 201, body: { item: { tagIds: [], tagOrigin: 'manual' } } });
        const path = `${base}/items/${created.body.item.id}`;
        expect((await request('POST', `${path}/suggest-tags`, { expectedRevision: 1, expectedTagRevision: 1 })).status).toBe(400);
        expect(await request('POST', `${path}/suggest-tags`, { expectedRevision: 1, expectedTagRevision: 1, confirmed: true }))
            .toMatchObject({ status: 200, body: { item: { tagIds: [], tagOrigin: 'manual', tagMatch: { state: 'unavailable' } } } });
        expect((await request('PATCH', path, { expectedRevision: 1, expectedTagRevision: 1, tagIds: [] })).status).toBe(409);
        expect((await request('POST', `${path}/suggest-tags`, { expectedRevision: 2, unexpected: true })).status).toBe(400);
    });

    it('rejects foreign parents/workspaces and disabled routes without touching the library', async () => {
        await request('POST', `${base}/tags`, tag);
        expect((await request('GET', `${base.replace('ws-a', 'ws-b')}/tags`)).status).toBe(404);
        expect((await request('GET', `${base.replace('parent%2Fa', 'other')}/tags`)).status).toBe(404);
        enabled = false;
        for (const [method, suffix] of [['GET', '/tags'], ['POST', '/tags'], ['PATCH', '/tags/tag'],
            ['DELETE', '/tags/tag'], ['POST', '/items/item/suggest-tags']]) {
            expect((await request(method, base + suffix, tag)).status).toBe(404);
        }
        expect((await request('GET', base)).body.tagLibrary).toBeUndefined();
        enabled = true;
        expect((await request('GET', `${base}/tags`)).body.tags).toHaveLength(1);
    });

    it('rejects tag options without an item change or assignments without advancing revisions', async () => {
        const created = await request('POST', `${base}/items`, { title: 'Track', tagIds: [] });
        const itemPath = `${base}/items/${created.body.item.id}`;
        const before = await request('GET', base);
        for (const patch of [{ matchMultiple: true }, { matchMultiple: false }, { expectedTagRevision: 0 },
            { expectedTagRevision: 1, title: 'Must not save' }]) {
            expect((await request('PATCH', itemPath, { expectedRevision: 1, ...patch })).status).toBe(400);
        }
        expect(await request('GET', base)).toEqual(before);
    });
});
