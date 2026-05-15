/**
 * Commit-Chat Binding API Route Tests
 *
 * HTTP-level tests for the 5 commit-chat API endpoints:
 *   - GET  /api/workspaces/:id/commit-chat-bindings          (list)
 *   - GET  /api/workspaces/:id/commit-chat-bindings/:hash     (get)
 *   - POST /api/workspaces/:id/commit-chat-bindings           (create)
 *   - DELETE /api/workspaces/:id/commit-chat-bindings/:hash   (delete)
 *   - POST /api/workspaces/:id/commit-chat-bindings/rebind    (rebind)
 *
 * Uses a real http.Server with registerApiRoutes + a temp dataDir.
 * Cross-platform (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock child_process to prevent real git calls from co-registered git routes
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

    const WORKSPACE_ID = 'ws-chat-test';

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
    // GET /api/workspaces/:id/commit-chat-bindings/:hash
    // ========================================================================

    describe('GET /commit-chat-bindings/:hash', () => {
        it('returns binding when it exists', async () => {
            // Seed a binding first
            await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abc12345', taskId: 'task-1' }),
            });

            const res = await request(api('commit-chat-bindings/abc12345'));
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.commitHash).toBe('abc12345');
            expect(data.taskId).toBe('task-1');
        });

        it('returns 404 when no binding exists', async () => {
            const res = await request(api('commit-chat-bindings/dead0000'));
            expect(res.status).toBe(404);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/commit-chat-bindings/abc12345`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/commit-chat-bindings
    // ========================================================================

    describe('POST /commit-chat-bindings', () => {
        it('creates a new binding', async () => {
            const res = await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'beef1234', taskId: 'task-new' }),
            });
            expect(res.status).toBe(201);
            const data = res.json();
            expect(data.commitHash).toBe('beef1234');
            expect(data.taskId).toBe('task-new');

            // Verify it was persisted
            const verify = await request(api('commit-chat-bindings/beef1234'));
            expect(verify.status).toBe(200);
            expect(verify.json().taskId).toBe('task-new');
        });

        it('returns 400 when commitHash is missing', async () => {
            const res = await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when taskId is missing', async () => {
            const res = await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd1234' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 for invalid commitHash (non-hex)', async () => {
            const res = await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'ZZZZZZZZ', taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 for commitHash shorter than 4 characters', async () => {
            const res = await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abc', taskId: 'task-1' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/commit-chat-bindings`, {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'abcd1234', taskId: 'task-1' }),
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/commit-chat-bindings/:hash
    // ========================================================================

    describe('DELETE /commit-chat-bindings/:hash', () => {
        it('removes existing binding', async () => {
            // Seed
            await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'cafe1234', taskId: 'task-del' }),
            });

            const res = await request(api('commit-chat-bindings/cafe1234'), { method: 'DELETE' });
            expect(res.status).toBe(204);

            // Verify it's gone
            const verify = await request(api('commit-chat-bindings/cafe1234'));
            expect(verify.status).toBe(404);
        });

        it('returns 204 for non-existent binding', async () => {
            const res = await request(api('commit-chat-bindings/dead9999'), { method: 'DELETE' });
            expect(res.status).toBe(204);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/commit-chat-bindings/abcd1234`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/commit-chat-bindings
    // ========================================================================

    describe('GET /commit-chat-bindings', () => {
        it('lists all bindings for workspace', async () => {
            // Seed two bindings
            await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'aaaa1111', taskId: 'task-a' }),
            });
            await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'bbbb2222', taskId: 'task-b' }),
            });

            const res = await request(api('commit-chat-bindings'));
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.bindings).toBeDefined();
            expect(data.bindings['aaaa1111']).toBeDefined();
            expect(data.bindings['bbbb2222']).toBeDefined();
        });

        it('returns empty bindings when none exist for a fresh workspace', async () => {
            // Add a second workspace with no bindings
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Test Repo', rootPath: '/test/repo' },
                { id: 'ws-empty', name: 'Empty', rootPath: '/empty' },
            ]);

            const res = await request(`${base()}/api/workspaces/ws-empty/commit-chat-bindings`);
            expect(res.status).toBe(200);
            expect(res.json().bindings).toEqual({});

            // Restore
            (store.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Test Repo', rootPath: '/test/repo' },
            ]);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/commit-chat-bindings`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/commit-chat-bindings/rebind
    // ========================================================================

    describe('POST /commit-chat-bindings/rebind', () => {
        it('rebinds old→new hash', async () => {
            // Seed
            await request(api('commit-chat-bindings'), {
                method: 'POST',
                body: JSON.stringify({ commitHash: 'face1234', taskId: 'task-rebind' }),
            });

            const res = await request(api('commit-chat-bindings/rebind'), {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'face1234', newHash: 'bead5678' }),
            });
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.oldHash).toBe('face1234');
            expect(data.newHash).toBe('bead5678');
            expect(data.taskId).toBe('task-rebind');

            // Verify old is gone, new exists
            const oldRes = await request(api('commit-chat-bindings/face1234'));
            expect(oldRes.status).toBe(404);
            const newRes = await request(api('commit-chat-bindings/bead5678'));
            expect(newRes.status).toBe(200);
            expect(newRes.json().taskId).toBe('task-rebind');
        });

        it('returns 404 when old hash has no binding', async () => {
            const res = await request(api('commit-chat-bindings/rebind'), {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'deed0000', newHash: 'feed1111' }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 when newHash is missing', async () => {
            const res = await request(api('commit-chat-bindings/rebind'), {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'abcd1234' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when oldHash is missing', async () => {
            const res = await request(api('commit-chat-bindings/rebind'), {
                method: 'POST',
                body: JSON.stringify({ newHash: 'abcd1234' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 for unknown workspace', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/commit-chat-bindings/rebind`, {
                method: 'POST',
                body: JSON.stringify({ oldHash: 'abcd1234', newHash: 'efef5678' }),
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Hash validation (route pattern matching)
    // ========================================================================

    describe('Hash validation', () => {
        it('rejects non-hex characters in GET /:hash (route mismatch)', async () => {
            const res = await request(api('commit-chat-bindings/ZZZZ'));
            // Route pattern /[a-f0-9]{4,40}/ won't match uppercase or non-hex
            expect(res.status).toBe(404);
        });

        it('rejects hash shorter than 4 chars in GET /:hash (route mismatch)', async () => {
            const res = await request(api('commit-chat-bindings/abc'));
            expect(res.status).toBe(404);
        });
    });
});
