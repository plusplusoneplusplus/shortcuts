/**
 * Pull-Request-Chat Binding API Route Tests
 *
 * HTTP-level tests for the 4 pull-request-chat API endpoints:
 *   - GET    /api/workspaces/:id/pull-request-chat-bindings          (list)
 *   - GET    /api/workspaces/:id/pull-request-chat-bindings/:prId    (get)
 *   - POST   /api/workspaces/:id/pull-request-chat-bindings          (create)
 *   - DELETE /api/workspaces/:id/pull-request-chat-bindings/:prId    (delete)
 *
 * Uses a real http.Server with registerApiRoutes + a temp dataDir.
 * Cross-platform (Linux/Mac/Windows).
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

describe('Pull-Request-Chat Binding API endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let db: Database.Database;

    const WORKSPACE_ID = 'ws-pr-chat-test';

    beforeAll(async () => {
        db = new Database(':memory:');
        initializeDatabase(db);

        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Test Repo', rootPath: '/test/repo' },
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
    const api = (wsPath: string) => `${base()}/api/workspaces/${WORKSPACE_ID}/${wsPath}`;

    // ========================================================================
    // GET /api/workspaces/:id/pull-request-chat-bindings/:prId
    // ========================================================================

    describe('GET /pull-request-chat-bindings/:prId', () => {
        it('returns binding when it exists', async () => {
            await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ prId: '142', taskId: 'task-1' }),
            });

            const res = await request(api('pull-request-chat-bindings/142'));
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.prId).toBe('142');
            expect(data.taskId).toBe('task-1');
        });

        it('returns 404 when no binding exists', async () => {
            const res = await request(api('pull-request-chat-bindings/999999'));
            expect(res.status).toBe(404);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/pull-request-chat-bindings/142`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/pull-request-chat-bindings
    // ========================================================================

    describe('POST /pull-request-chat-bindings', () => {
        it('creates a new binding', async () => {
            const res = await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ prId: '500', taskId: 'task-new' }),
            });
            expect(res.status).toBe(201);
            const data = res.json();
            expect(data.prId).toBe('500');
            expect(data.taskId).toBe('task-new');

            const verify = await request(api('pull-request-chat-bindings/500'));
            expect(verify.status).toBe(200);
            expect(verify.json().taskId).toBe('task-new');
        });

        it('returns 400 when prId is missing', async () => {
            const res = await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when taskId is missing', async () => {
            const res = await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ prId: '142' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 for invalid prId characters', async () => {
            const res = await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ prId: 'has spaces!', taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        });

        it('accepts alphanumeric provider prefix forms', async () => {
            const res = await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ prId: 'PR-1234', taskId: 'task-mixed' }),
            });
            expect(res.status).toBe(201);
            expect(res.json().prId).toBe('PR-1234');
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/pull-request-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ prId: '142', taskId: 'task-1' }),
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/pull-request-chat-bindings/:prId
    // ========================================================================

    describe('DELETE /pull-request-chat-bindings/:prId', () => {
        it('removes existing binding', async () => {
            await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ prId: '700', taskId: 'task-del' }),
            });

            const res = await request(api('pull-request-chat-bindings/700'), { method: 'DELETE' });
            expect(res.status).toBe(204);

            const verify = await request(api('pull-request-chat-bindings/700'));
            expect(verify.status).toBe(404);
        });

        it('returns 204 for non-existent binding', async () => {
            const res = await request(api('pull-request-chat-bindings/888888'), { method: 'DELETE' });
            expect(res.status).toBe(204);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/pull-request-chat-bindings/142`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/pull-request-chat-bindings
    // ========================================================================

    describe('GET /pull-request-chat-bindings', () => {
        it('lists all bindings for workspace', async () => {
            await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ prId: '1001', taskId: 'task-a' }),
            });
            await request(api('pull-request-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ prId: '1002', taskId: 'task-b' }),
            });

            const res = await request(api('pull-request-chat-bindings'));
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.bindings).toBeDefined();
            expect(data.bindings['1001']).toBeDefined();
            expect(data.bindings['1002']).toBeDefined();
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/pull-request-chat-bindings`);
            expect(res.status).toBe(404);
        });
    });
});
