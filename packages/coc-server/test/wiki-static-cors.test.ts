/**
 * Wiki Static File CORS Tests
 *
 * Verifies that CORS headers are set on wiki static file error responses
 * (wiki not found, invalid path, file not found).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as path from 'path';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        readFileSync: vi.fn(actual.readFileSync),
    };
});

import { createRequestHandler } from '../src/router';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): ProcessStore {
    return {
        getAllProcesses: vi.fn().mockResolvedValue([]),
    } as unknown as ProcessStore;
}

function request(
    url: string,
    method = 'GET',
    rawPath?: string
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: rawPath ?? parsed.pathname + parsed.search,
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

function assertCorsHeaders(headers: Record<string, string>): void {
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toBe('GET, POST, PATCH, DELETE, OPTIONS');
    expect(headers['access-control-allow-headers']).toBe('Content-Type');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Wiki static file CORS headers', () => {
    let server: http.Server;
    let baseUrl: string;

    // A wiki dir that exists for testing traversal and file-not-found cases
    const WIKI_DIR = path.resolve(__dirname, 'fixtures-wiki-cors');

    beforeAll(async () => {
        const handler = createRequestHandler({
            routes: [],
            spaHtml: '<html>SPA</html>',
            store: makeStore(),
            getWikiDir: (id: string) => {
                if (id === 'existing') return WIKI_DIR;
                return undefined;
            },
        });
        const srv = http.createServer(handler);
        await new Promise<void>((resolve) => {
            srv.listen(0, '127.0.0.1', () => resolve());
        });
        server = srv;
        const addr = srv.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        vi.restoreAllMocks();
    });

    it('sets CORS headers when wiki is not found', async () => {
        const res = await request(`${baseUrl}/wiki/unknown-id/static/index.html`);
        expect(res.status).toBe(404);
        assertCorsHeaders(res.headers);
    });

    it('sets CORS headers on directory traversal attempt', async () => {
        // Send raw path to bypass URL normalization of ".." segments
        const res = await request(baseUrl, 'GET', '/wiki/existing/static/../../etc/passwd');
        expect(res.status).toBe(404);
        assertCorsHeaders(res.headers);
    });

    it('sets CORS headers when file does not exist', async () => {
        const res = await request(`${baseUrl}/wiki/existing/static/no-such-file.js`);
        expect(res.status).toBe(404);
        assertCorsHeaders(res.headers);
    });
});
