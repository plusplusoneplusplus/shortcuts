/**
 * Note-chat binding routes — the by-path read/write/delete surface.
 *
 * The interesting one is `PUT .../by-path`. Bindings are normally a side effect
 * of enqueue, so there is no write path for the one case that needs one:
 * widening an existing per-note chat into its folder's section chat. That flip
 * changes which key the chat resolves from (note → folder) with no new enqueue
 * behind it, so without this route the conversation would vanish the moment the
 * user clicked a sibling — exactly what section scope exists to prevent.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerNoteChatBindingRoutes } from '../../src/server/notes/note-chat-bindings-handler';
import { NoteChatBindingStore } from '../../src/server/notes/note-chat-binding-store';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

const WS = 'ws-notes';

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
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
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        json: () => (bodyStr ? JSON.parse(bodyStr) : undefined),
                    });
                });
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

describe('note-chat binding routes', () => {
    let server: http.Server;
    let baseUrl: string;
    let db: Database.Database;
    let bindings: NoteChatBindingStore;

    beforeAll(async () => {
        db = new Database(':memory:');
        initializeDatabase(db);
        bindings = new NoteChatBindingStore(db);

        const store = createMockProcessStore();
        await store.registerWorkspace({ id: WS, name: 'notes', rootPath: '/tmp/notes' } as any);

        const routes: Route[] = [];
        registerNoteChatBindingRoutes({
            routes,
            store,
            db,
            gitOpsStore: {} as any,
        } as any);
        server = http.createServer(createRouter({ routes }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        db.close();
    });

    beforeEach(() => {
        db.prepare('DELETE FROM note_chat_bindings').run();
    });

    const byPath = (p: string) =>
        `/api/workspaces/${WS}/notes/chat-bindings/by-path?path=${encodeURIComponent(p)}`;

    describe('PUT by-path', () => {
        it('binds an existing task to a folder key so the section chat resolves', async () => {
            const res = await request(baseUrl, byPath('MultiModal'), {
                method: 'PUT',
                body: { taskId: 'task-a' },
            });

            expect(res.status).toBe(200);
            expect(res.json().notePath).toBe('MultiModal');
            expect(res.json().taskId).toBe('task-a');
            expect(res.json().createdAt).toEqual(expect.any(String));
            expect(bindings.get(WS, 'MultiModal')!.taskId).toBe('task-a');
        });

        it('leaves the original per-note row in place — both keys reach the same chat', async () => {
            bindings.bind(WS, 'MultiModal/a.md', 'task-a');
            await request(baseUrl, byPath('MultiModal'), { method: 'PUT', body: { taskId: 'task-a' } });

            expect(bindings.get(WS, 'MultiModal/a.md')!.taskId).toBe('task-a');
            expect(bindings.get(WS, 'MultiModal')!.taskId).toBe('task-a');
        });

        it('overwrites an existing row at the same key', async () => {
            bindings.bind(WS, 'MultiModal', 'task-old');
            await request(baseUrl, byPath('MultiModal'), { method: 'PUT', body: { taskId: 'task-new' } });
            expect(bindings.get(WS, 'MultiModal')!.taskId).toBe('task-new');
        });

        it('normalizes the path before binding', async () => {
            await request(baseUrl, byPath('MultiModal\\sub'), { method: 'PUT', body: { taskId: 'task-a' } });
            expect(bindings.get(WS, 'MultiModal/sub')!.taskId).toBe('task-a');
        });

        it('rejects a traversal path', async () => {
            const res = await request(baseUrl, byPath('../escape'), {
                method: 'PUT',
                body: { taskId: 'task-a' },
            });
            expect(res.status).toBe(400);
        });

        it('rejects a missing path parameter', async () => {
            const res = await request(baseUrl, `/api/workspaces/${WS}/notes/chat-bindings/by-path`, {
                method: 'PUT',
                body: { taskId: 'task-a' },
            });
            expect(res.status).toBe(400);
        });

        it.each([
            ['missing', {}],
            ['blank', { taskId: '   ' }],
            ['non-string', { taskId: 42 }],
        ])('rejects a %s taskId without writing a row', async (_label, body) => {
            const res = await request(baseUrl, byPath('MultiModal'), { method: 'PUT', body });
            expect(res.status).toBe(400);
            expect(bindings.get(WS, 'MultiModal')).toBeUndefined();
        });

        it('404s for an unknown workspace', async () => {
            const res = await request(
                baseUrl,
                '/api/workspaces/nope/notes/chat-bindings/by-path?path=MultiModal',
                { method: 'PUT', body: { taskId: 'task-a' } },
            );
            expect(res.status).toBe(404);
        });
    });

    describe('round-trip with the read and delete routes', () => {
        it('a folder binding is listed, readable, and deletable like any other', async () => {
            await request(baseUrl, byPath('MultiModal'), { method: 'PUT', body: { taskId: 'task-a' } });

            const list = await request(baseUrl, `/api/workspaces/${WS}/notes/chat-bindings`);
            expect(list.json().bindings.MultiModal.taskId).toBe('task-a');

            const read = await request(baseUrl, byPath('MultiModal'));
            expect(read.status).toBe(200);
            expect(read.json().taskId).toBe('task-a');

            const del = await request(baseUrl, byPath('MultiModal'), { method: 'DELETE' });
            expect(del.status).toBe(204);
            expect(bindings.get(WS, 'MultiModal')).toBeUndefined();
        });
    });
});
