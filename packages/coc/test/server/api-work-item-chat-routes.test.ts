/**
 * Work-Item-Chat Binding API Route Tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

vi.mock('child_process', function () { return ({
    execSync: vi.fn(() => ''),
    execFileSync: vi.fn(() => ''),
}); });

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(function () { return ({
            getBranchStatus: vi.fn(),
            hasUncommittedChanges: vi.fn(),
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: vi.fn(),
            detectCommitRange: vi.fn(),
        }); }),
    };
});

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

describe('Work-Item-Chat Binding API endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let db: Database.Database;

    const WORKSPACE_ID = 'ws-work-item-chat-test';
    const WORKSPACE_CLONE_ID = 'ws-work-item-chat-clone';
    const OTHER_WORKSPACE_ID = 'ws-work-item-chat-other';
    const ORIGIN_ID = 'gh_owner_repo';

    beforeAll(async () => {
        db = new Database(':memory:');
        initializeDatabase(db);

        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Test Repo', rootPath: '/test/repo', remoteUrl: 'https://github.com/owner/repo.git' },
            { id: WORKSPACE_CLONE_ID, name: 'Test Repo Clone', rootPath: '/test/repo-clone', remoteUrl: 'git@github.com:owner/repo.git' },
            { id: OTHER_WORKSPACE_ID, name: 'Other Repo', rootPath: '/other/repo', remoteUrl: 'https://github.com/owner/other.git' },
        ]);

        const routes: Route[] = [];
        registerApiRoutes(routes, store, undefined, undefined, undefined, db);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        db.close();
    });

    const base = () => `http://127.0.0.1:${port}`;
    const api = (workspaceId: string, wsPath: string) => `${base()}/api/workspaces/${workspaceId}/${wsPath}`;
    const originApi = (originPath: string) => `${base()}/api/origins/${ORIGIN_ID}/${originPath}`;

    beforeEach(() => {
        db.prepare('DELETE FROM work_item_chat_bindings').run();
    });

    it('creates, reads, lists, and deletes a binding', async () => {
        const res = await request(api(WORKSPACE_ID, 'work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ workItemId: 'wi-1', taskId: 'task-1' }),
        });
        expect(res.status).toBe(201);
        expect(res.json()).toEqual({ workItemId: 'wi-1', taskId: 'task-1' });

        const get = await request(api(WORKSPACE_ID, 'work-item-chat-bindings/wi-1'));
        expect(get.status).toBe(200);
        expect(get.json()).toEqual({ workItemId: 'wi-1', taskId: 'task-1' });

        const list = await request(api(WORKSPACE_ID, 'work-item-chat-bindings'));
        expect(list.status).toBe(200);
        expect(list.json().bindings['wi-1'].taskId).toBe('task-1');

        const del = await request(api(WORKSPACE_ID, 'work-item-chat-bindings/wi-1'), { method: 'DELETE' });
        expect(del.status).toBe(204);
        const missing = await request(api(WORKSPACE_ID, 'work-item-chat-bindings/wi-1'));
        expect(missing.status).toBe(404);
    });

    it('shares workspace route bindings across same-origin clones', async () => {
        await request(api(WORKSPACE_ID, 'work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ workItemId: 'same-id', taskId: 'task-a' }),
        });

        const clone = await request(api(WORKSPACE_CLONE_ID, 'work-item-chat-bindings/same-id'));

        expect(clone.status).toBe(200);
        expect(clone.json().taskId).toBe('task-a');
    });

    it('keeps distinct origins isolated by work item ID', async () => {
        await request(api(WORKSPACE_ID, 'work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ workItemId: 'same-id', taskId: 'task-a' }),
        });
        await request(api(OTHER_WORKSPACE_ID, 'work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ workItemId: 'same-id', taskId: 'task-b' }),
        });

        const first = await request(api(WORKSPACE_ID, 'work-item-chat-bindings/same-id'));
        const second = await request(api(OTHER_WORKSPACE_ID, 'work-item-chat-bindings/same-id'));

        expect(first.json().taskId).toBe('task-a');
        expect(second.json().taskId).toBe('task-b');
    });

    it('returns 404 when no binding exists', async () => {
        const res = await request(api(WORKSPACE_ID, 'work-item-chat-bindings/missing-wi'));
        expect(res.status).toBe(404);
    });

    it('returns 404 for unknown workspace', async () => {
        const res = await request(api('unknown-ws', 'work-item-chat-bindings/wi-1'));
        expect(res.status).toBe(404);
    });

    it('rejects missing or invalid create fields', async () => {
        const missingWorkItem = await request(api(WORKSPACE_ID, 'work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ taskId: 'task-1' }),
        });
        expect(missingWorkItem.status).toBe(400);

        const missingTask = await request(api(WORKSPACE_ID, 'work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ workItemId: 'wi-1' }),
        });
        expect(missingTask.status).toBe(400);

        const controlChar = await request(api(WORKSPACE_ID, 'work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ workItemId: 'wi-\u0000', taskId: 'task-1' }),
        });
        expect(controlChar.status).toBe(400);
    });

    it('supports encoded opaque work item IDs', async () => {
        const workItemId = 'feature:repo-a:42';
        await request(api(WORKSPACE_ID, 'work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ workItemId, taskId: 'task-opaque' }),
        });

        const res = await request(api(WORKSPACE_ID, `work-item-chat-bindings/${encodeURIComponent(workItemId)}`));
        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ workItemId, taskId: 'task-opaque' });
    });

    it('creates, reads, lists, and deletes bindings by canonical origin', async () => {
        const create = await request(originApi('work-item-chat-bindings'), {
            method: 'POST',
            body: JSON.stringify({ workItemId: 'origin-wi-1', taskId: 'task-origin-1' }),
        });
        expect(create.status).toBe(201);
        expect(create.json()).toEqual({ workItemId: 'origin-wi-1', taskId: 'task-origin-1' });

        const get = await request(originApi('work-item-chat-bindings/origin-wi-1'));
        expect(get.status).toBe(200);
        expect(get.json()).toEqual({ workItemId: 'origin-wi-1', taskId: 'task-origin-1' });

        const list = await request(originApi('work-item-chat-bindings'));
        expect(list.status).toBe(200);
        expect(list.json().bindings['origin-wi-1'].taskId).toBe('task-origin-1');

        const workspaceRead = await request(api(WORKSPACE_ID, 'work-item-chat-bindings/origin-wi-1'));
        expect(workspaceRead.status).toBe(200);
        expect(workspaceRead.json().taskId).toBe('task-origin-1');

        const remove = await request(originApi('work-item-chat-bindings/origin-wi-1'), { method: 'DELETE' });
        expect(remove.status).toBe(204);

        const verify = await request(originApi('work-item-chat-bindings/origin-wi-1'));
        expect(verify.status).toBe(404);
    });

    it('migrates a legacy workspace row when reading through an origin route', async () => {
        db.prepare(`
            INSERT INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at)
            VALUES (?, ?, ?, ?)
        `).run(WORKSPACE_ID, 'legacy-origin-1', 'task-legacy-origin', '2026-01-01T00:00:00.000Z');

        const res = await request(originApi('work-item-chat-bindings/legacy-origin-1'));

        expect(res.status).toBe(200);
        expect(res.json().taskId).toBe('task-legacy-origin');
        expect(
            db.prepare('SELECT COUNT(*) AS count FROM work_item_chat_bindings WHERE workspace_id = ?')
                .get(WORKSPACE_ID) as { count: number },
        ).toEqual({ count: 0 });
        expect(
            db.prepare('SELECT task_id FROM work_item_chat_bindings WHERE workspace_id = ? AND work_item_id = ?')
                .get(ORIGIN_ID, 'legacy-origin-1') as { task_id: string },
        ).toEqual({ task_id: 'task-legacy-origin' });
    });

    it('requires a matching workspaceId for origin-scoped fresh chat reset', async () => {
        const missingWorkspace = await request(originApi('work-item-chat-bindings/origin-fresh/fresh'), {
            method: 'POST',
            body: '{}',
        });
        expect(missingWorkspace.status).toBe(400);

        const mismatchedWorkspace = await request(`${originApi('work-item-chat-bindings/origin-fresh/fresh')}?workspaceId=${OTHER_WORKSPACE_ID}`, {
            method: 'POST',
            body: '{}',
        });
        expect(mismatchedWorkspace.status).toBe(400);
    });
});
