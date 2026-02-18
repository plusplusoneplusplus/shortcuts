/**
 * Shared Router Tests
 *
 * Unit tests for the shared Router implementation used by both
 * main server and wiki server routers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    createRouter,
    serveStaticFile,
    sendJson,
    send404,
    send400,
    send500,
    readJsonBody,
    readBody,
} from '../../src/shared/router';
import type { SharedRouterOptions } from '../../src/shared/router';

// ============================================================================
// Test Helpers
// ============================================================================

/** Make an HTTP request to the test server. */
function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            headers: options.headers,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    status: res.statusCode || 0,
                    headers: res.headers as Record<string, string>,
                    body: Buffer.concat(chunks).toString('utf-8'),
                });
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

/** Create a test server from router options. */
function createTestServer(options: SharedRouterOptions): Promise<{ server: http.Server; baseUrl: string }> {
    return new Promise((resolve) => {
        const handler = createRouter(options);
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

// ============================================================================
// Route Matching Tests
// ============================================================================

describe('Route matching', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const result = await createTestServer({
            routes: [
                {
                    method: 'GET',
                    pattern: '/api/items',
                    handler: (_req, res) => {
                        sendJson(res, { items: [] });
                    },
                },
                {
                    method: 'POST',
                    pattern: '/api/items',
                    handler: async (req, res) => {
                        const body = await readJsonBody<{ name: string }>(req);
                        sendJson(res, { created: body.name }, 201);
                    },
                },
                {
                    method: 'GET',
                    pattern: /^\/api\/items\/([^/]+)$/,
                    handler: (_req, res, match) => {
                        sendJson(res, { id: match![1] });
                    },
                },
                {
                    method: 'DELETE',
                    pattern: /^\/api\/items\/([^/]+)$/,
                    handler: (_req, res, match) => {
                        sendJson(res, { deleted: match![1] });
                    },
                },
                {
                    pattern: '/api/no-method',
                    handler: (_req, res) => {
                        sendJson(res, { ok: true });
                    },
                },
            ],
            spaHtml: '<html>SPA</html>',
        });
        server = result.server;
        baseUrl = result.baseUrl;
    });

    afterAll(async () => {
        await closeServer(server);
    });

    it('matches exact string routes', async () => {
        const res = await request(`${baseUrl}/api/items`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.items).toEqual([]);
    });

    it('matches POST routes', async () => {
        const res = await request(`${baseUrl}/api/items`, {
            method: 'POST',
            body: JSON.stringify({ name: 'test' }),
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.created).toBe('test');
    });

    it('matches regex routes with capture groups', async () => {
        const res = await request(`${baseUrl}/api/items/abc-123`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBe('abc-123');
    });

    it('matches DELETE routes', async () => {
        const res = await request(`${baseUrl}/api/items/xyz`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.deleted).toBe('xyz');
    });

    it('returns 404 for unmatched API routes', async () => {
        const res = await request(`${baseUrl}/api/unknown`);
        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('API route not found');
    });

    it('returns 404 for wrong method on matched path', async () => {
        const res = await request(`${baseUrl}/api/items`, { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    it('defaults to GET when method is omitted in route', async () => {
        const res = await request(`${baseUrl}/api/no-method`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.ok).toBe(true);
    });

    it('catches async handler errors and sends 500', async () => {
        const result = await createTestServer({
            routes: [
                {
                    method: 'GET',
                    pattern: '/api/error',
                    handler: async () => {
                        throw new Error('async handler error');
                    },
                },
            ],
            spaHtml: '',
        });
        try {
            const res = await request(`${result.baseUrl}/api/error`);
            expect(res.status).toBe(500);
        } finally {
            await closeServer(result.server);
        }
    });
});

// ============================================================================
// Static File Serving Tests
// ============================================================================

describe('Static file serving', () => {
    let server: http.Server;
    let baseUrl: string;
    let staticDir: string;

    beforeAll(async () => {
        staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-test-static-'));
        fs.writeFileSync(path.join(staticDir, 'style.css'), 'body { color: red; }');
        fs.writeFileSync(path.join(staticDir, 'app.js'), 'console.log("hi")');
        fs.writeFileSync(path.join(staticDir, 'data.json'), '{"key":"value"}');
        fs.mkdirSync(path.join(staticDir, 'images'), { recursive: true });
        fs.writeFileSync(path.join(staticDir, 'images', 'logo.svg'), '<svg></svg>');
        fs.writeFileSync(path.join(staticDir, 'unknown.xyz'), 'binary-data');
        fs.mkdirSync(path.join(staticDir, 'subdir'), { recursive: true });

        const result = await createTestServer({
            routes: [],
            spaHtml: '<html>SPA</html>',
            staticHandlers: [
                {
                    resolve: (pathname) => {
                        if (pathname === '/' || pathname === '/index.html') {
                            return undefined;
                        }
                        return path.join(staticDir, pathname);
                    },
                },
            ],
        });
        server = result.server;
        baseUrl = result.baseUrl;
    });

    afterAll(async () => {
        await closeServer(server);
        fs.rmSync(staticDir, { recursive: true, force: true });
    });

    it('serves CSS with correct MIME type', async () => {
        const res = await request(`${baseUrl}/style.css`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
        expect(res.body).toBe('body { color: red; }');
    });

    it('serves JS with correct MIME type', async () => {
        const res = await request(`${baseUrl}/app.js`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8');
    });

    it('serves JSON with correct MIME type', async () => {
        const res = await request(`${baseUrl}/data.json`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    });

    it('serves nested files', async () => {
        const res = await request(`${baseUrl}/images/logo.svg`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/svg+xml');
    });

    it('uses octet-stream for unknown extensions', async () => {
        const res = await request(`${baseUrl}/unknown.xyz`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/octet-stream');
    });

    it('includes Cache-Control header', async () => {
        const res = await request(`${baseUrl}/style.css`);
        expect(res.headers['cache-control']).toBe('public, max-age=3600');
    });

    it('falls back to SPA for non-existent files', async () => {
        const res = await request(`${baseUrl}/no-such-file.txt`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('<html>SPA</html>');
    });

    it('falls back to SPA for directories', async () => {
        const res = await request(`${baseUrl}/subdir`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('<html>SPA</html>');
    });
});

// ============================================================================
// serveStaticFile Tests
// ============================================================================

describe('serveStaticFile', () => {
    let tempDir: string;
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-serve-test-'));
        fs.writeFileSync(path.join(tempDir, 'file.txt'), 'hello');
        fs.mkdirSync(path.join(tempDir, 'dir'), { recursive: true });

        // Use a real server to test serveStaticFile
        const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
            const pathname = (req.url || '/').slice(1); // strip leading /
            const filePath = path.join(tempDir, pathname);
            if (!serveStaticFile(filePath, res)) {
                res.writeHead(404);
                res.end('not served');
            }
        };
        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await closeServer(server);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns false for non-existent files', async () => {
        const res = await request(`${baseUrl}/nope.txt`);
        expect(res.status).toBe(404);
        expect(res.body).toBe('not served');
    });

    it('returns false for directories', async () => {
        const res = await request(`${baseUrl}/dir`);
        expect(res.status).toBe(404);
        expect(res.body).toBe('not served');
    });

    it('returns true and serves existing files', async () => {
        const res = await request(`${baseUrl}/file.txt`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('hello');
    });
});

// ============================================================================
// SPA Fallback Tests
// ============================================================================

describe('SPA fallback', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const result = await createTestServer({
            routes: [],
            spaHtml: '<html><body>My SPA</body></html>',
        });
        server = result.server;
        baseUrl = result.baseUrl;
    });

    afterAll(async () => {
        await closeServer(server);
    });

    it('serves SPA HTML for root path', async () => {
        const res = await request(`${baseUrl}/`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(res.body).toBe('<html><body>My SPA</body></html>');
    });

    it('serves SPA HTML for arbitrary non-API paths', async () => {
        const res = await request(`${baseUrl}/dashboard/settings`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('<html><body>My SPA</body></html>');
    });

    it('does not serve SPA for /api/ paths', async () => {
        const res = await request(`${baseUrl}/api/missing`);
        expect(res.status).toBe(404);
    });
});

// ============================================================================
// CORS Handling Tests
// ============================================================================

describe('CORS handling', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const result = await createTestServer({
            routes: [
                {
                    method: 'GET',
                    pattern: '/api/test',
                    handler: (_req, res) => sendJson(res, { ok: true }),
                },
            ],
            spaHtml: '<html></html>',
        });
        server = result.server;
        baseUrl = result.baseUrl;
    });

    afterAll(async () => {
        await closeServer(server);
    });

    it('handles OPTIONS preflight with 204', async () => {
        const res = await request(`${baseUrl}/api/test`, { method: 'OPTIONS' });
        expect(res.status).toBe(204);
        expect(res.body).toBe('');
    });

    it('sets CORS headers on API responses', async () => {
        const res = await request(`${baseUrl}/api/test`);
        expect(res.headers['access-control-allow-origin']).toBe('*');
        expect(res.headers['access-control-allow-methods']).toContain('GET');
        expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
    });

    it('sets CORS headers on SPA responses', async () => {
        const res = await request(`${baseUrl}/`);
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });
});

// ============================================================================
// Response Helper Tests
// ============================================================================

describe('Response helpers', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const result = await createTestServer({
            routes: [
                {
                    method: 'GET',
                    pattern: '/api/json',
                    handler: (_req, res) => sendJson(res, { hello: 'world' }),
                },
                {
                    method: 'GET',
                    pattern: '/api/json-status',
                    handler: (_req, res) => sendJson(res, { created: true }, 201),
                },
                {
                    method: 'GET',
                    pattern: '/api/not-found',
                    handler: (_req, res) => send404(res, 'Thing not found'),
                },
                {
                    method: 'GET',
                    pattern: '/api/bad',
                    handler: (_req, res) => send400(res, 'Invalid input'),
                },
                {
                    method: 'GET',
                    pattern: '/api/err',
                    handler: (_req, res) => send500(res, 'Server broke'),
                },
            ],
            spaHtml: '',
        });
        server = result.server;
        baseUrl = result.baseUrl;
    });

    afterAll(async () => {
        await closeServer(server);
    });

    it('sendJson sends correct content-type and body', async () => {
        const res = await request(`${baseUrl}/api/json`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(JSON.parse(res.body)).toEqual({ hello: 'world' });
    });

    it('sendJson supports custom status codes', async () => {
        const res = await request(`${baseUrl}/api/json-status`);
        expect(res.status).toBe(201);
    });

    it('send404 sends 404 with error JSON', async () => {
        const res = await request(`${baseUrl}/api/not-found`);
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: 'Thing not found' });
    });

    it('send400 sends 400 with error JSON', async () => {
        const res = await request(`${baseUrl}/api/bad`);
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body)).toEqual({ error: 'Invalid input' });
    });

    it('send500 sends 500 with error JSON', async () => {
        const res = await request(`${baseUrl}/api/err`);
        expect(res.status).toBe(500);
        expect(JSON.parse(res.body)).toEqual({ error: 'Server broke' });
    });
});

// ============================================================================
// Body Parser Tests
// ============================================================================

describe('Body parsers', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeAll(async () => {
        const result = await createTestServer({
            routes: [
                {
                    method: 'POST',
                    pattern: '/api/json-body',
                    handler: async (req, res) => {
                        const body = await readJsonBody<{ value: number }>(req);
                        sendJson(res, { received: body.value });
                    },
                },
                {
                    method: 'POST',
                    pattern: '/api/raw-body',
                    handler: async (req, res) => {
                        const body = await readBody(req);
                        sendJson(res, { received: body });
                    },
                },
            ],
            spaHtml: '',
        });
        server = result.server;
        baseUrl = result.baseUrl;
    });

    afterAll(async () => {
        await closeServer(server);
    });

    it('readJsonBody parses valid JSON', async () => {
        const res = await request(`${baseUrl}/api/json-body`, {
            method: 'POST',
            body: '{"value":42}',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ received: 42 });
    });

    it('readBody returns raw string', async () => {
        const res = await request(`${baseUrl}/api/raw-body`, {
            method: 'POST',
            body: 'plain text content',
            headers: { 'Content-Type': 'text/plain' },
        });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ received: 'plain text content' });
    });
});

// ============================================================================
// Multiple Static Handlers Tests
// ============================================================================

describe('Multiple static handlers', () => {
    let server: http.Server;
    let baseUrl: string;
    let dir1: string;
    let dir2: string;

    beforeAll(async () => {
        dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'router-multi-1-'));
        dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'router-multi-2-'));

        fs.writeFileSync(path.join(dir1, 'shared.txt'), 'from-dir1');
        fs.writeFileSync(path.join(dir2, 'shared.txt'), 'from-dir2');
        fs.writeFileSync(path.join(dir2, 'only-dir2.txt'), 'only-in-dir2');

        const result = await createTestServer({
            routes: [],
            spaHtml: '<html>SPA</html>',
            staticHandlers: [
                {
                    resolve: (pathname) => {
                        if (!pathname.startsWith('/first/')) return undefined;
                        return path.join(dir1, pathname.slice('/first'.length));
                    },
                },
                {
                    resolve: (pathname) => {
                        if (!pathname.startsWith('/second/')) return undefined;
                        return path.join(dir2, pathname.slice('/second'.length));
                    },
                },
            ],
        });
        server = result.server;
        baseUrl = result.baseUrl;
    });

    afterAll(async () => {
        await closeServer(server);
        fs.rmSync(dir1, { recursive: true, force: true });
        fs.rmSync(dir2, { recursive: true, force: true });
    });

    it('serves from first handler', async () => {
        const res = await request(`${baseUrl}/first/shared.txt`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('from-dir1');
    });

    it('serves from second handler', async () => {
        const res = await request(`${baseUrl}/second/only-dir2.txt`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('only-in-dir2');
    });

    it('falls through when handler returns undefined', async () => {
        const res = await request(`${baseUrl}/other/file.txt`);
        expect(res.status).toBe(200);
        expect(res.body).toBe('<html>SPA</html>');
    });
});
