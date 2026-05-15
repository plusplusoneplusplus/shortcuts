/**
 * Commit-Chat Binding API Tests
 *
 * Tests for the commit-chat binding REST API routes:
 * - GET  /api/workspaces/:id/commit-chat-bindings       (list all)
 * - GET  /api/workspaces/:id/commit-chat-bindings/:hash  (get one)
 * - POST /api/workspaces/:id/commit-chat-bindings        (create)
 * - DELETE /api/workspaces/:id/commit-chat-bindings/:hash (delete)
 * - POST /api/workspaces/:id/commit-chat-bindings/rebind  (rebind)
 *
 * Uses a temp directory for CommitChatBindingStore persistence.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';
import { CommitChatBindingStore } from '../../src/server/processes/commit-chat-binding-store';

// ============================================================================
// Mocks — child_process and forge services (required by api-handler)
// ============================================================================

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
            getBranchStatus: vi.fn(),
            hasUncommittedChanges: vi.fn(),
            hasUncommittedChanges: vi.fn(),
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: vi.fn(),
            getCurrentBranch: vi.fn(),
            detectCommitRange: vi.fn(),
        }); }),
    };
});

// ============================================================================
// Test Helpers
// ============================================================================

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

// ============================================================================
// Test Suite
// ============================================================================

describe('Commit-Chat Binding API endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let db: Database.Database;
    let bindingStore: CommitChatBindingStore;

    const WORKSPACE_ID = 'ws-binding-test';

    beforeAll(async () => {
        db = new Database(':memory:');
        initializeDatabase(db);

        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Test Repo', rootPath: '/test/repo' },
        ]);

        bindingStore = new CommitChatBindingStore(db);

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
    const bindingsUrl = () => `${base()}/api/workspaces/${WORKSPACE_ID}/commit-chat-bindings`;

    // ========================================================================
    // GET /api/workspaces/:id/commit-chat-bindings (list all)
    // ========================================================================

    describe('GET /api/workspaces/:id/commit-chat-bindings', () => {
        it('returns 200 with empty bindings when none exist', async () => {
            const res = await request(bindingsUrl());
            expect(res.status).toBe(200);
            expect(res.json().bindings).toEqual({});
        });

        it('returns 200 with populated bindings', async () => {
            bindingStore.bind(WORKSPACE_ID, 'aabb1122', 'task-1');
            bindingStore.bind(WORKSPACE_ID, 'ccdd3344', 'task-2');

            const res = await request(bindingsUrl());
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.bindings['aabb1122'].taskId).toBe('task-1');
            expect(data.bindings['ccdd3344'].taskId).toBe('task-2');

            // Cleanup
            bindingStore.unbind(WORKSPACE_ID, 'aabb1122');
            bindingStore.unbind(WORKSPACE_ID, 'ccdd3344');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/commit-chat-bindings`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/commit-chat-bindings/:hash (get one)
    // ========================================================================

    describe('GET /api/workspaces/:id/commit-chat-bindings/:hash', () => {
        it('returns 200 with commitHash and taskId when binding exists', async () => {
            bindingStore.bind(WORKSPACE_ID, 'aabb1122', 'task-get');

            const res = await request(`${bindingsUrl()}/aabb1122`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commitHash).toBe('aabb1122');
            expect(data.taskId).toBe('task-get');

            bindingStore.unbind(WORKSPACE_ID, 'aabb1122');
        });

        it('returns 404 when binding does not exist', async () => {
            const res = await request(`${bindingsUrl()}/deadbeef`);
            expect(res.status).toBe(404);
            expect(res.json().code).toBe('NOT_FOUND');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/no-ws/commit-chat-bindings/aabb1122`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/commit-chat-bindings (create)
    // ========================================================================

    describe('POST /api/workspaces/:id/commit-chat-bindings', () => {
        it('returns 201 with commitHash and taskId on valid input', async () => {
            const res = await request(bindingsUrl(), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd1234', taskId: 'task-new' }),
            });
            expect(res.status).toBe(201);
            const data = res.json();
            expect(data.commitHash).toBe('abcd1234');
            expect(data.taskId).toBe('task-new');

            bindingStore.unbind(WORKSPACE_ID, 'abcd1234');
        });

        it('persists the binding (verifiable via GET)', async () => {
            await request(bindingsUrl(), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd5678', taskId: 'task-persist' }),
            });

            const res = await request(`${bindingsUrl()}/abcd5678`);
            expect(res.status).toBe(200);
            expect(res.json().taskId).toBe('task-persist');

            bindingStore.unbind(WORKSPACE_ID, 'abcd5678');
        });

        it('returns 400 when commitHash is missing', async () => {
            const res = await request(bindingsUrl(), {
                method: 'POST',
                body: JSON.stringify({ taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
            expect(res.json().code).toBe('BAD_REQUEST');
        });

        it('returns 400 when commitHash has invalid format', async () => {
            const res = await request(bindingsUrl(), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'zzz', taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when taskId is missing or empty', async () => {
            const res = await request(bindingsUrl(), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd1234', taskId: '' }),
            });
            expect(res.status).toBe(400);

            const res2 = await request(bindingsUrl(), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd1234' }),
            });
            expect(res2.status).toBe(400);
        });

        it('returns 400 on invalid JSON body', async () => {
            const res = await request(bindingsUrl(), {
                method: 'POST',
                body: 'not-json{{{',
            });
            expect(res.status).toBe(400);
            expect(res.json().code).toBe('INVALID_JSON');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/no-ws/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd1234', taskId: 'task-1' }),
            });
            expect(res.status).toBe(404);
        });

        it('overwrites existing binding for same commitHash', async () => {
            await request(bindingsUrl(), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd9999', taskId: 'task-old' }),
            });
            await request(bindingsUrl(), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd9999', taskId: 'task-new' }),
            });

            const res = await request(`${bindingsUrl()}/abcd9999`);
            expect(res.json().taskId).toBe('task-new');

            bindingStore.unbind(WORKSPACE_ID, 'abcd9999');
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/commit-chat-bindings/:hash (delete)
    // ========================================================================

    describe('DELETE /api/workspaces/:id/commit-chat-bindings/:hash', () => {
        it('returns 204 when binding exists and is removed', async () => {
            bindingStore.bind(WORKSPACE_ID, 'dede1111', 'task-del');

            const res = await request(`${bindingsUrl()}/dede1111`, { method: 'DELETE' });
            expect(res.status).toBe(204);
            expect(res.body).toBe('');
        });

        it('returns 204 when binding does not exist (idempotent)', async () => {
            const res = await request(`${bindingsUrl()}/face0000`, { method: 'DELETE' });
            expect(res.status).toBe(204);
        });

        it('verifies binding is actually removed', async () => {
            bindingStore.bind(WORKSPACE_ID, 'beef2222', 'task-verify');
            await request(`${bindingsUrl()}/beef2222`, { method: 'DELETE' });

            const res = await request(`${bindingsUrl()}/beef2222`);
            expect(res.status).toBe(404);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/no-ws/commit-chat-bindings/aabb1122`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/commit-chat-bindings/rebind (rebind)
    // ========================================================================

    describe('POST /api/workspaces/:id/commit-chat-bindings/rebind', () => {
        it('returns 200 with oldHash, newHash, taskId on success', async () => {
            bindingStore.bind(WORKSPACE_ID, 'aaaa1111', 'task-rebind');

            const res = await request(`${bindingsUrl()}/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'aaaa1111', newHash: 'bbbb2222' }),
            });
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.oldHash).toBe('aaaa1111');
            expect(data.newHash).toBe('bbbb2222');
            expect(data.taskId).toBe('task-rebind');

            bindingStore.unbind(WORKSPACE_ID, 'bbbb2222');
        });

        it('verifies old hash removed and new hash bound', async () => {
            bindingStore.bind(WORKSPACE_ID, 'cccc3333', 'task-move');
            await request(`${bindingsUrl()}/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'cccc3333', newHash: 'dddd4444' }),
            });

            const oldRes = await request(`${bindingsUrl()}/cccc3333`);
            expect(oldRes.status).toBe(404);

            const newRes = await request(`${bindingsUrl()}/dddd4444`);
            expect(newRes.status).toBe(200);
            expect(newRes.json().taskId).toBe('task-move');

            bindingStore.unbind(WORKSPACE_ID, 'dddd4444');
        });

        it('returns 404 when no binding exists for oldHash', async () => {
            const res = await request(`${bindingsUrl()}/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'dead0000', newHash: 'beef0000' }),
            });
            expect(res.status).toBe(404);
            expect(res.json().code).toBe('NOT_FOUND');
        });

        it('returns 400 when oldHash is missing or invalid', async () => {
            const res = await request(`${bindingsUrl()}/rebind`, {
                method: 'POST',
                body: JSON.stringify({ newHash: 'bbbb2222' }),
            });
            expect(res.status).toBe(400);

            const res2 = await request(`${bindingsUrl()}/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'zzz', newHash: 'bbbb2222' }),
            });
            expect(res2.status).toBe(400);
        });

        it('returns 400 when newHash is missing or invalid', async () => {
            const res = await request(`${bindingsUrl()}/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'aaaa1111' }),
            });
            expect(res.status).toBe(400);

            const res2 = await request(`${bindingsUrl()}/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'aaaa1111', newHash: 'XYZ' }),
            });
            expect(res2.status).toBe(400);
        });

        it('returns 400 on invalid JSON body', async () => {
            const res = await request(`${bindingsUrl()}/rebind`, {
                method: 'POST',
                body: '{bad json',
            });
            expect(res.status).toBe(400);
            expect(res.json().code).toBe('INVALID_JSON');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/no-ws/commit-chat-bindings/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'aaaa1111', newHash: 'bbbb2222' }),
            });
            expect(res.status).toBe(404);
        });
    });
});
