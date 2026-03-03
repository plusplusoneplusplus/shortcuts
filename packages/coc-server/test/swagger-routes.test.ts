/**
 * Swagger / OpenAPI Route Tests
 *
 * Tests for GET /api/openapi.json and GET /api/docs routes.
 * Uses vi.mock('fs') to avoid filesystem dependencies.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';

// ---------------------------------------------------------------------------
// Hoisted fs mock — must be declared before any imports that use 'fs'
// ---------------------------------------------------------------------------
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        readFileSync: vi.fn(actual.readFileSync),
    };
});

import * as fs from 'fs';
import { createRequestHandler } from '../src/router';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(count = 0): ProcessStore {
    return {
        getAllProcesses: vi.fn().mockResolvedValue(new Array(count)),
    } as unknown as ProcessStore;
}

function request(
    url: string,
    method = 'GET'
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode ?? 0,
                        headers: res.headers as Record<string, string>,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    })
                );
            }
        );
        req.on('error', reject);
        req.end();
    });
}

function startServer(store: ProcessStore): Promise<{ server: http.Server; baseUrl: string }> {
    return new Promise((resolve) => {
        const handler = createRequestHandler({
            routes: [],
            spaHtml: '<html>SPA</html>',
            store,
        });
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
        });
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// GET /api/openapi.json
// ---------------------------------------------------------------------------

describe('GET /api/openapi.json', () => {
    let server: http.Server;
    let baseUrl: string;

    const MINIMAL_YAML = `openapi: '3.1.0'\ninfo:\n  title: Test\n  version: '1.0.0'\npaths: {}\n`;

    beforeAll(async () => {
        vi.mocked(fs.readFileSync).mockReturnValue(MINIMAL_YAML as any);
        ({ server, baseUrl } = await startServer(makeStore()));
    });

    afterAll(async () => {
        await closeServer(server);
        vi.restoreAllMocks();
    });

    it('returns 200', async () => {
        const res = await request(`${baseUrl}/api/openapi.json`);
        expect(res.status).toBe(200);
    });

    it('returns Content-Type application/json', async () => {
        const res = await request(`${baseUrl}/api/openapi.json`);
        expect(res.headers['content-type']).toContain('application/json');
    });

    it('returns parsed JSON with openapi field', async () => {
        const res = await request(`${baseUrl}/api/openapi.json`);
        const body = JSON.parse(res.body);
        expect(typeof body.openapi).toBe('string');
        expect(body.openapi).toBe('3.1.0');
    });
});

describe('GET /api/openapi.json — missing spec', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        vi.mocked(fs.readFileSync).mockImplementation(() => {
            const err: NodeJS.ErrnoException = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
        ({ server, baseUrl } = await startServer(makeStore()));
    });

    afterAll(async () => {
        await closeServer(server);
        vi.restoreAllMocks();
    });

    it('returns 404 when spec file is missing', async () => {
        const res = await request(`${baseUrl}/api/openapi.json`);
        expect(res.status).toBe(404);
    });

    it('returns error JSON (not a crash) when spec is missing', async () => {
        const res = await request(`${baseUrl}/api/openapi.json`);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('error');
    });
});

// ---------------------------------------------------------------------------
// GET /api/docs
// ---------------------------------------------------------------------------

describe('GET /api/docs', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        vi.mocked(fs.readFileSync).mockReturnValue('' as any);
        ({ server, baseUrl } = await startServer(makeStore()));
    });

    afterAll(async () => {
        await closeServer(server);
        vi.restoreAllMocks();
    });

    it('returns 200', async () => {
        const res = await request(`${baseUrl}/api/docs`);
        expect(res.status).toBe(200);
    });

    it('returns Content-Type text/html', async () => {
        const res = await request(`${baseUrl}/api/docs`);
        expect(res.headers['content-type']).toContain('text/html');
    });

    it('body contains swagger-ui', async () => {
        const res = await request(`${baseUrl}/api/docs`);
        expect(res.body).toContain('swagger-ui');
    });

    it('body contains swagger-ui-bundle.js script tag', async () => {
        const res = await request(`${baseUrl}/api/docs`);
        expect(res.body).toContain('swagger-ui-bundle.js');
    });

    it('Swagger UI points to /api/openapi.json', async () => {
        const res = await request(`${baseUrl}/api/docs`);
        expect(res.body).toContain('/api/openapi.json');
    });
});

// ---------------------------------------------------------------------------
// Regression: existing /api/health route still works
// ---------------------------------------------------------------------------

describe('Existing routes regression', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        vi.mocked(fs.readFileSync).mockReturnValue('' as any);
        ({ server, baseUrl } = await startServer(makeStore(3)));
    });

    afterAll(async () => {
        await closeServer(server);
        vi.restoreAllMocks();
    });

    it('/api/health still returns 200', async () => {
        const res = await request(`${baseUrl}/api/health`);
        expect(res.status).toBe(200);
    });

    it('/api/health returns processCount', async () => {
        const res = await request(`${baseUrl}/api/health`);
        const body = JSON.parse(res.body);
        expect(body.processCount).toBe(3);
    });
});
