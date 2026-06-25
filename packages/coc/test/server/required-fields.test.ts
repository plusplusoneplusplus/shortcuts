/**
 * Required Fields Validation Tests (Section 6)
 *
 * HTTP integration tests verifying that routes return 400 MISSING_FIELDS
 * when required request body fields are absent.
 *
 * Routes tested (all in packages/coc-server):
 *   POST /api/processes — requires id, promptPreview, status, startTime
 *   POST /api/workspaces — requires name, rootPath (id is server-computed)
 *   PATCH /api/workspaces/:id — 200 no-op for empty body
 *
 * Cross-platform compatible (Linux/macOS/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock forge git services (avoids real git CLI calls in unit tests)
// ============================================================================

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(function () { return ({
            hasUncommittedChanges: vi.fn(async () => false),
            getBranchStatus: vi.fn(async () => null),
        }); }),
        GitRangeService: vi.fn().mockImplementation(function () { return ({
            getCurrentBranch: vi.fn(async () => 'main'),
        }); }),
        WorkingTreeService: vi.fn().mockImplementation(function () { return ({
            getAllChanges: vi.fn(async () => []),
        }); }),
        detectRemoteUrl: vi.fn(async () => undefined),
    };
});

// ============================================================================
// HTTP helpers
// ============================================================================

function apiRequest(
    baseUrl: string,
    path: string,
    opts: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(`${baseUrl}${path}`);
        const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: opts.method ?? 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    let body: unknown;
                    try { body = JSON.parse(text); } catch { body = text; }
                    const headers: Record<string, string> = {};
                    for (const [k, v] of Object.entries(res.headers)) {
                        if (typeof v === 'string') headers[k] = v;
                    }
                    resolve({ status: res.statusCode ?? 0, body, headers });
                });
            },
        );
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// ============================================================================
// Server lifecycle helpers
// ============================================================================

function makeServer(store: MockProcessStore): http.Server {
    const routes: Route[] = [];
    registerApiRoutes(routes, store);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(server: http.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve(`http://127.0.0.1:${addr.port}`);
        });
    });
}

async function stopServer(server: http.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

// ============================================================================
// POST /api/processes — required fields
// ============================================================================

describe('POST /api/processes — required fields', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('returns 201 when all required fields are present', async () => {
        const { status } = await apiRequest(baseUrl, '/api/processes', {
            method: 'POST',
            body: {
                id: 'proc-1',
                promptPreview: 'hello',
                status: 'running',
                startTime: new Date().toISOString(),
            },
        });
        expect(status).toBe(201);
    });

    it('returns 400 MISSING_FIELDS when id is absent', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes', {
            method: 'POST',
            body: { promptPreview: 'hi', status: 'running', startTime: new Date().toISOString() },
        });
        expect(status).toBe(400);
        expect((body as any).code).toBe('MISSING_FIELDS');
    });

    it('returns 400 MISSING_FIELDS when promptPreview is absent', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes', {
            method: 'POST',
            body: { id: 'proc-2', status: 'running', startTime: new Date().toISOString() },
        });
        expect(status).toBe(400);
        expect((body as any).code).toBe('MISSING_FIELDS');
    });

    it('returns 400 MISSING_FIELDS when all required fields are absent', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes', {
            method: 'POST',
            body: {},
        });
        expect(status).toBe(400);
        expect((body as any).code).toBe('MISSING_FIELDS');
    });

    it('returns 400 INVALID_JSON for malformed JSON body', async () => {
        await new Promise<void>((resolve, reject) => {
            const req = http.request(
                `${baseUrl}/api/processes`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' } },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => {
                        const body = JSON.parse(Buffer.concat(chunks).toString());
                        expect(res.statusCode).toBe(400);
                        expect(body.code).toBe('INVALID_JSON');
                        resolve();
                    });
                },
            );
            req.on('error', reject);
            req.write('{not json}');
            req.end();
        });
    });
});

// ============================================================================
// POST /api/workspaces — required fields
// ============================================================================

describe('POST /api/workspaces — required fields', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('returns 400 MISSING_FIELDS when rootPath is absent', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/workspaces', {
            method: 'POST',
            body: { id: 'ws-1', name: 'project' },
        });
        expect(status).toBe(400);
        expect((body as any).code).toBe('MISSING_FIELDS');
    });

    it('registers (201) when id is absent — the server computes a machine-scoped id', async () => {
        // Id is no longer a required field: physical workspace ids are
        // server-authoritative and derived from hostname + root path.
        const { status, body } = await apiRequest(baseUrl, '/api/workspaces', {
            method: 'POST',
            body: { name: 'project', rootPath: '/some/path' },
        });
        expect(status).toBe(201);
        expect((body as any).id).toMatch(/^ws-v2-[0-9a-f]+$/);
    });

    it('returns 400 MISSING_FIELDS when name is absent', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/workspaces', {
            method: 'POST',
            body: { rootPath: '/some/path' },
        });
        expect(status).toBe(400);
        expect((body as any).code).toBe('MISSING_FIELDS');
    });

    it('honors an explicitly supplied virtual workspace id (e.g. my_work)', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/workspaces', {
            method: 'POST',
            body: { id: 'my_work', name: 'My Work', rootPath: '/some/path' },
        });
        expect(status).toBe(201);
        expect((body as any).id).toBe('my_work');
    });

    it('honors an explicitly supplied id for explicit/fixture callers', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/workspaces', {
            method: 'POST',
            body: { id: 'ws-explicit-fixture', name: 'fixture', rootPath: '/some/path' },
        });
        expect(status).toBe(201);
        expect((body as any).id).toBe('ws-explicit-fixture');
    });

    it('derives the same machine-scoped id for the same path when id is omitted', async () => {
        const reg = () => apiRequest(baseUrl, '/api/workspaces', {
            method: 'POST',
            body: { name: 'stable', rootPath: '/some/stable/path' },
        });
        const first = await reg();
        const second = await reg();
        expect(first.status).toBe(201);
        expect((first.body as any).id).toBe((second.body as any).id);
        expect((first.body as any).id).toMatch(/^ws-v2-/);
    });
});

// ============================================================================
// PATCH /api/workspaces/:id — empty body is a no-op
// ============================================================================

describe('PATCH /api/workspaces/:id', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore({
            initialWorkspaces: [{
                id: 'ws-patch',
                name: 'patch-project',
                rootPath: '/some/path',
            }],
        });
        (store.updateWorkspace as any).mockResolvedValue({ id: 'ws-patch', name: 'patch-project', rootPath: '/some/path' });
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('returns 200 no-op for empty body {}', async () => {
        const { status } = await apiRequest(baseUrl, '/api/workspaces/ws-patch', {
            method: 'PATCH',
            body: {},
        });
        expect(status).toBe(200);
    });

    it('returns 404 for nonexistent workspace', async () => {
        (store.updateWorkspace as any).mockResolvedValue(undefined);
        const { status, body } = await apiRequest(baseUrl, '/api/workspaces/does-not-exist', {
            method: 'PATCH',
            body: { name: 'new-name' },
        });
        expect(status).toBe(404);
        expect((body as any).code).toBe('NOT_FOUND');
    });
});
