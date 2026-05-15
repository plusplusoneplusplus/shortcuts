/**
 * 404 Not Found Response Tests (Section 7)
 *
 * HTTP integration tests verifying that routes return 404 NOT_FOUND
 * for nonexistent resources, and that the error shape is correct.
 *
 * Routes tested:
 *   GET/PATCH/DELETE /api/processes/:id
 *   GET/PATCH/DELETE /api/workspaces/:id
 *   Unknown API route
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
// Mock forge git services
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
// Helpers
// ============================================================================

function apiRequest(
    baseUrl: string,
    path: string,
    opts: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
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
                    resolve({ status: res.statusCode ?? 0, body });
                });
            },
        );
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

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
// Process 404 tests
// ============================================================================

describe('404 — process not found', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore(); // empty — no processes
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('GET /api/processes/:id returns 404 NOT_FOUND for nonexistent id', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes/nonexistent-id');
        expect(status).toBe(404);
        expect((body as any).code).toBe('NOT_FOUND');
        expect(typeof (body as any).error).toBe('string');
    });

    it('PATCH /api/processes/:id returns 404 for nonexistent id', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes/nonexistent-id', {
            method: 'PATCH',
            body: { status: 'cancelled' },
        });
        expect(status).toBe(404);
        expect((body as any).code).toBe('NOT_FOUND');
    });

    it('DELETE /api/processes/:id returns 404 for nonexistent id', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes/nonexistent-id', {
            method: 'DELETE',
        });
        expect(status).toBe(404);
        expect((body as any).code).toBe('NOT_FOUND');
    });
});

// ============================================================================
// Workspace 404 tests
// ============================================================================

describe('404 — workspace not found', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore(); // empty — no workspaces
        (store.removeWorkspace as any).mockResolvedValue(false); // nonexistent → false
        (store.updateWorkspace as any).mockResolvedValue(undefined); // nonexistent → undefined
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('PATCH /api/workspaces/:id returns 404 for nonexistent workspace', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/workspaces/nonexistent-id', {
            method: 'PATCH',
            body: { name: 'new-name' },
        });
        expect(status).toBe(404);
        expect((body as any).code).toBe('NOT_FOUND');
    });

    it('DELETE /api/workspaces/:id returns 404 for nonexistent workspace', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/workspaces/nonexistent-id', {
            method: 'DELETE',
        });
        expect(status).toBe(404);
        expect((body as any).code).toBe('NOT_FOUND');
    });
});

// ============================================================================
// Unknown API route → 404
// ============================================================================

describe('404 — unknown API route', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const store = createMockProcessStore();
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('GET /api/does-not-exist returns 404', async () => {
        const { status } = await apiRequest(baseUrl, '/api/does-not-exist');
        expect(status).toBe(404);
    });

    it('POST /api/does-not-exist returns 404', async () => {
        const { status } = await apiRequest(baseUrl, '/api/does-not-exist', {
            method: 'POST',
            body: {},
        });
        expect(status).toBe(404);
    });
});
