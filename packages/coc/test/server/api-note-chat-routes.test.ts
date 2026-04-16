/**
 * Note-Chat Binding API Route Tests
 *
 * HTTP-level tests for the note-chat API endpoints:
 *   - GET    /api/workspaces/:id/note-chat-bindings           (list all)
 *   - GET    /api/workspaces/:id/note-chat-bindings?path=X    (get single)
 *   - POST   /api/workspaces/:id/note-chat-bindings           (create)
 *   - DELETE  /api/workspaces/:id/note-chat-bindings?path=X   (delete)
 *   - POST   /api/workspaces/:id/note-chat-bindings/rebind    (rebind)
 *
 * Uses a real http.Server with registerApiRoutes + in-memory SQLite.
 * Cross-platform (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock child_process to prevent real git calls from co-registered git routes
// ============================================================================

vi.mock('child_process', () => ({
    execSync: vi.fn(() => ''),
    execFileSync: vi.fn(() => ''),
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(() => ({
            getBranchStatus: vi.fn(),
            hasUncommittedChanges: vi.fn(),
        })),
        GitRangeService: vi.fn().mockImplementation(() => ({
            getCurrentBranch: vi.fn(),
            detectCommitRange: vi.fn(),
        })),
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

describe('Note-Chat Binding API endpoints', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let db: Database.Database;

    const WORKSPACE_ID = 'ws-note-chat-test';

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
    // GET /api/workspaces/:id/note-chat-bindings?path=X
    // ========================================================================

    describe('GET /note-chat-bindings?path=X', () => {
        it('returns binding when it exists', async () => {
            // Seed a binding first
            await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath: 'folder/my-note.md', taskId: 'task-1' }),
            });

            const res = await request(api('note-chat-bindings?path=' + encodeURIComponent('folder/my-note.md')));
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.notePath).toBe('folder/my-note.md');
            expect(data.taskId).toBe('task-1');
        });

        it('returns 404 when no binding exists', async () => {
            const res = await request(api('note-chat-bindings?path=' + encodeURIComponent('nonexistent.md')));
            expect(res.status).toBe(404);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/note-chat-bindings?path=note.md`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/note-chat-bindings
    // ========================================================================

    describe('POST /note-chat-bindings', () => {
        it('creates a new binding', async () => {
            const res = await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath: 'new-note.md', taskId: 'task-new' }),
            });
            expect(res.status).toBe(201);
            const data = res.json();
            expect(data.notePath).toBe('new-note.md');
            expect(data.taskId).toBe('task-new');

            // Verify it was persisted
            const verify = await request(api('note-chat-bindings?path=' + encodeURIComponent('new-note.md')));
            expect(verify.status).toBe(200);
            expect(verify.json().taskId).toBe('task-new');
        });

        it('returns 400 when notePath is missing', async () => {
            const res = await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when taskId is missing', async () => {
            const res = await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath: 'note.md' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when notePath is empty string', async () => {
            const res = await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath: '', taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/note-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ notePath: 'note.md', taskId: 'task-1' }),
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/note-chat-bindings?path=X
    // ========================================================================

    describe('DELETE /note-chat-bindings?path=X', () => {
        it('removes existing binding', async () => {
            // Seed
            await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath: 'to-delete.md', taskId: 'task-del' }),
            });

            const res = await request(api('note-chat-bindings?path=' + encodeURIComponent('to-delete.md')), { method: 'DELETE' });
            expect(res.status).toBe(204);

            // Verify it's gone
            const verify = await request(api('note-chat-bindings?path=' + encodeURIComponent('to-delete.md')));
            expect(verify.status).toBe(404);
        });

        it('returns 204 for non-existent binding', async () => {
            const res = await request(api('note-chat-bindings?path=' + encodeURIComponent('never-existed.md')), { method: 'DELETE' });
            expect(res.status).toBe(204);
        });

        it('returns 400 when path is missing', async () => {
            const res = await request(api('note-chat-bindings'), { method: 'DELETE' });
            expect(res.status).toBe(400);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/note-chat-bindings?path=note.md`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/note-chat-bindings
    // ========================================================================

    describe('GET /note-chat-bindings (list)', () => {
        it('lists all bindings for workspace', async () => {
            // Seed two bindings
            await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath: 'list-a.md', taskId: 'task-a' }),
            });
            await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath: 'list-b.md', taskId: 'task-b' }),
            });

            const res = await request(api('note-chat-bindings'));
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.bindings).toBeDefined();
            expect(data.bindings['list-a.md']).toBeDefined();
            expect(data.bindings['list-b.md']).toBeDefined();
        });

        it('returns empty bindings when none exist for a fresh workspace', async () => {
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Test Repo', rootPath: '/test/repo' },
                { id: 'ws-empty', name: 'Empty', rootPath: '/empty' },
            ]);

            const res = await request(`${base()}/api/workspaces/ws-empty/note-chat-bindings`);
            expect(res.status).toBe(200);
            expect(res.json().bindings).toEqual({});

            // Restore
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Test Repo', rootPath: '/test/repo' },
            ]);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/note-chat-bindings`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/note-chat-bindings/rebind
    // ========================================================================

    describe('POST /note-chat-bindings/rebind', () => {
        it('rebinds old→new path', async () => {
            // Seed
            await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath: 'old-name.md', taskId: 'task-rebind' }),
            });

            const res = await request(api('note-chat-bindings/rebind'), {
                method: 'POST',
                body: JSON.stringify({ oldPath: 'old-name.md', newPath: 'new-name.md' }),
            });
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.oldPath).toBe('old-name.md');
            expect(data.newPath).toBe('new-name.md');
            expect(data.taskId).toBe('task-rebind');

            // Verify old is gone, new exists
            const oldRes = await request(api('note-chat-bindings?path=' + encodeURIComponent('old-name.md')));
            expect(oldRes.status).toBe(404);
            const newRes = await request(api('note-chat-bindings?path=' + encodeURIComponent('new-name.md')));
            expect(newRes.status).toBe(200);
            expect(newRes.json().taskId).toBe('task-rebind');
        });

        it('returns 404 when old path has no binding', async () => {
            const res = await request(api('note-chat-bindings/rebind'), {
                method: 'POST',
                body: JSON.stringify({ oldPath: 'nonexistent.md', newPath: 'dest.md' }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 when newPath is missing', async () => {
            const res = await request(api('note-chat-bindings/rebind'), {
                method: 'POST',
                body: JSON.stringify({ oldPath: 'note.md' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when oldPath is missing', async () => {
            const res = await request(api('note-chat-bindings/rebind'), {
                method: 'POST',
                body: JSON.stringify({ newPath: 'note.md' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/note-chat-bindings/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldPath: 'old.md', newPath: 'new.md' }),
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Path handling
    // ========================================================================

    describe('Path handling', () => {
        it('handles paths with spaces', async () => {
            const notePath = 'folder/my note.md';
            await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath, taskId: 'task-spaces' }),
            });

            const res = await request(api('note-chat-bindings?path=' + encodeURIComponent(notePath)));
            expect(res.status).toBe(200);
            expect(res.json().taskId).toBe('task-spaces');
        });

        it('handles deeply nested paths', async () => {
            const notePath = 'a/b/c/d/note.md';
            await request(api('note-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ notePath, taskId: 'task-deep' }),
            });

            const res = await request(api('note-chat-bindings?path=' + encodeURIComponent(notePath)));
            expect(res.status).toBe(200);
            expect(res.json().taskId).toBe('task-deep');
        });
    });
});
