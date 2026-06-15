/**
 * CORS Headers Tests (Section 12)
 *
 * Verifies that the shared router sets the correct CORS headers on every
 * HTTP response and that OPTIONS preflight requests are handled correctly
 * without triggering any side effects.
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

function rawRequest(
    baseUrl: string,
    path: string,
    opts: { method?: string; body?: string; origin?: string } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(`${baseUrl}${path}`);
        const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (opts.origin) reqHeaders['Origin'] = opts.origin;
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: opts.method ?? 'GET',
                headers: reqHeaders,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    resolve({ status: res.statusCode ?? 0, headers: res.headers as any });
                });
            },
        );
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
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
// CORS header tests
// ============================================================================

describe('CORS headers', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let addProcessCallCount: number;

    beforeAll(async () => {
        store = createMockProcessStore();
        addProcessCallCount = 0;
        const origAdd = store.addProcess as any;
        (store.addProcess as any) = vi.fn(async (...args: any[]) => {
            addProcessCallCount++;
            return origAdd(...args);
        });
        server = makeServer(store);
        baseUrl = await startServer(server);
    });

    afterAll(async () => { await stopServer(server); });

    it('OPTIONS /api/processes (no Origin) returns 204 without an ACAO header', async () => {
        const { status, headers } = await rawRequest(baseUrl, '/api/processes', { method: 'OPTIONS' });
        expect(status).toBe(204);
        // No Origin → not a cross-origin request; no ACAO header is emitted and
        // the wildcard `*` is never used.
        expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('OPTIONS response includes all required methods', async () => {
        const { headers } = await rawRequest(baseUrl, '/api/processes', { method: 'OPTIONS' });
        const methods = String(headers['access-control-allow-methods'] ?? '');
        expect(methods).toMatch(/GET/);
        expect(methods).toMatch(/POST/);
        expect(methods).toMatch(/PATCH/);
        expect(methods).toMatch(/DELETE/);
    });

    it('OPTIONS preflight does not trigger any writes (no side effects)', async () => {
        const callsBefore = addProcessCallCount;
        await rawRequest(baseUrl, '/api/processes', { method: 'OPTIONS' });
        expect(addProcessCallCount).toBe(callsBefore);
    });

    it('GET /api/processes (no Origin) omits Access-Control-Allow-Origin', async () => {
        const { status, headers } = await rawRequest(baseUrl, '/api/processes');
        expect(status).toBe(200);
        expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('GET /api/processes reflects a loopback Origin (never wildcard)', async () => {
        const loopback = `http://127.0.0.1:${new URL(baseUrl).port}`;
        const { status, headers } = await rawRequest(baseUrl, '/api/processes', { origin: loopback });
        expect(status).toBe(200);
        expect(headers['access-control-allow-origin']).toBe(loopback);
    });

    it('POST /api/processes from a loopback Origin reflects it', async () => {
        const loopback = `http://localhost:${new URL(baseUrl).port}`;
        const { status, headers } = await rawRequest(baseUrl, '/api/processes', {
            method: 'POST',
            origin: loopback,
            body: JSON.stringify({
                id: 'cors-proc-1',
                promptPreview: 'hi',
                status: 'running',
                startTime: new Date().toISOString(),
            }),
        });
        // Either 201 or 400 — either way the loopback origin is reflected and
        // the wildcard is never used.
        expect([201, 400]).toContain(status);
        expect(headers['access-control-allow-origin']).toBe(loopback);
    });

    it('Access-Control-Allow-Headers is set on all responses', async () => {
        const { headers } = await rawRequest(baseUrl, '/api/processes');
        expect(headers['access-control-allow-headers']).toBeDefined();
    });

    it('Access-Control-Allow-Headers always includes Authorization', async () => {
        const { headers } = await rawRequest(baseUrl, '/api/processes');
        expect(String(headers['access-control-allow-headers'])).toContain('Authorization');
    });

    it('OPTIONS response includes PUT method', async () => {
        const { headers } = await rawRequest(baseUrl, '/api/processes', { method: 'OPTIONS' });
        expect(String(headers['access-control-allow-methods'])).toContain('PUT');
    });

    it('reflects localhost origin and sets credentials header', async () => {
        const localhostOrigin = `http://localhost:${new URL(baseUrl).port}`;
        const { headers } = await rawRequest(baseUrl, '/api/processes', { origin: localhostOrigin });
        expect(headers['access-control-allow-origin']).toBe(localhostOrigin);
        expect(headers['access-control-allow-credentials']).toBe('true');
    });

    it('reflects 127.0.0.1 origin and sets credentials header', async () => {
        const loopback = `http://127.0.0.1:${new URL(baseUrl).port}`;
        const { headers } = await rawRequest(baseUrl, '/api/processes', { origin: loopback });
        expect(headers['access-control-allow-origin']).toBe(loopback);
        expect(headers['access-control-allow-credentials']).toBe('true');
    });

    it('non-loopback origin is NOT reflected and never gets wildcard', async () => {
        const { headers } = await rawRequest(baseUrl, '/api/processes', { origin: 'https://evil.example.com' });
        expect(headers['access-control-allow-origin']).toBeUndefined();
        expect(headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('private-LAN origin is NOT reflected (loopback ≠ private network)', async () => {
        const { headers } = await rawRequest(baseUrl, '/api/processes', { origin: 'http://192.168.1.10:4000' });
        expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('look-alike subdomain origin is rejected', async () => {
        const { headers } = await rawRequest(baseUrl, '/api/processes', { origin: 'http://attacker.localhost.evil.com' });
        expect(headers['access-control-allow-origin']).toBeUndefined();
    });

    it('OPTIONS preflight from localhost reflects origin', async () => {
        const localhostOrigin = `http://localhost:${new URL(baseUrl).port}`;
        const { status, headers } = await rawRequest(baseUrl, '/api/processes', { method: 'OPTIONS', origin: localhostOrigin });
        expect(status).toBe(204);
        expect(headers['access-control-allow-origin']).toBe(localhostOrigin);
    });

    it('OPTIONS preflight from a non-loopback origin is not reflected (no wildcard)', async () => {
        const { status, headers } = await rawRequest(baseUrl, '/api/processes', { method: 'OPTIONS', origin: 'https://remote.devtunnels.ms' });
        expect(status).toBe(204);
        expect(headers['access-control-allow-origin']).toBeUndefined();
    });
});
