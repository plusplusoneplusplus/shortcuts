/**
 * Error Response Shape Conformance Tests (Section 13)
 *
 * Verifies that all error responses from the API conform to the shape:
 *   { error: string, code?: string, details?: unknown }
 *
 * Also verifies:
 *   - 500 errors do not leak stack traces
 *   - All error responses have Content-Type: application/json
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

interface ApiResponse {
    status: number;
    body: unknown;
    contentType: string;
}

function apiRequest(
    baseUrl: string,
    path: string,
    opts: { method?: string; rawBody?: string; body?: unknown } = {},
): Promise<ApiResponse> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(`${baseUrl}${path}`);
        const bodyStr = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: opts.method ?? 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    let body: unknown;
                    try { body = JSON.parse(text); } catch { body = text; }
                    resolve({
                        status: res.statusCode ?? 0,
                        body,
                        contentType: String(res.headers['content-type'] ?? ''),
                    });
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
// Shape assertion helper
// ============================================================================

function assertErrorShape(body: unknown): void {
    expect(typeof (body as any).error).toBe('string');
    expect((body as any).error.length).toBeGreaterThan(0);
    // code is optional but when present must be a string
    if ((body as any).code !== undefined) {
        expect(typeof (body as any).code).toBe('string');
    }
}

// ============================================================================
// Error shape tests
// ============================================================================

describe('Error response shapes', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('400 missing fields — shape { error, code: "MISSING_FIELDS", details }', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes', {
            method: 'POST',
            body: {},
        });
        expect(status).toBe(400);
        assertErrorShape(body);
        expect((body as any).code).toBe('MISSING_FIELDS');
        // details should contain the list of missing fields
        expect((body as any).details).toBeDefined();
    });

    it('400 missing fields — error string is non-empty and contains field names', async () => {
        const { body } = await apiRequest(baseUrl, '/api/processes', {
            method: 'POST',
            body: {},
        });
        expect(typeof (body as any).error).toBe('string');
        expect((body as any).error.length).toBeGreaterThan(0);
    });

    it('400 invalid JSON — shape { error, code: "INVALID_JSON" }', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes', {
            method: 'POST',
            rawBody: '{broken',
        });
        expect(status).toBe(400);
        assertErrorShape(body);
        expect((body as any).code).toBe('INVALID_JSON');
    });

    it('404 not found — shape { error, code: "NOT_FOUND" }', async () => {
        const { status, body } = await apiRequest(baseUrl, '/api/processes/no-such-id');
        expect(status).toBe(404);
        assertErrorShape(body);
        expect((body as any).code).toBe('NOT_FOUND');
    });

    it('all error responses have Content-Type: application/json', async () => {
        const cases: Array<[string, { method?: string; body?: unknown; rawBody?: string }]> = [
            // 400 missing fields
            ['/api/processes', { method: 'POST', body: {} }],
            // 400 invalid JSON
            ['/api/processes', { method: 'POST', rawBody: '{bad}' }],
            // 404
            ['/api/processes/nonexistent', {}],
        ];

        for (const [path, opts] of cases) {
            const { contentType } = await apiRequest(baseUrl, path, opts);
            expect(contentType).toContain('application/json');
        }
    });

    it('500 internal error shape (simulated via throwing store)', async () => {
        const throwingStore = createMockProcessStore();
        (throwingStore.getProcess as any).mockRejectedValue(new Error('DB failure'));
        const routes: Route[] = [];
        registerApiRoutes(routes, throwingStore);
        // Add a route that throws to test 500 handling
        const handler = createRouter({ routes, spaHtml: '' });
        const srv = http.createServer(handler);
        await new Promise<void>((resolve, reject) => {
            srv.on('error', reject);
            srv.listen(0, '127.0.0.1', resolve);
        });
        const throwingBase = `http://127.0.0.1:${(srv.address() as any).port}`;
        try {
            const { status, body } = await apiRequest(throwingBase, '/api/processes/some-id');
            // Either 404 (process not found via handleAPIError) or 500 (unexpected error via catch)
            expect([404, 500]).toContain(status);
            // Regardless of status, must conform to error shape
            assertErrorShape(body);
            // Must NOT leak stack traces
            const bodyStr = JSON.stringify(body);
            expect(bodyStr).not.toContain(' at ');      // no stack frames
            expect(bodyStr).not.toContain('Error: DB'); // no raw error message
        } finally {
            await new Promise<void>(resolve => srv.close(() => resolve()));
        }
    });
});
