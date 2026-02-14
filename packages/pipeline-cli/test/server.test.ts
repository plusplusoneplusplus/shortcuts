/**
 * Server Tests
 *
 * Tests for the HTTP server foundation: health endpoint, CORS,
 * SPA fallback, JSON body parsing, route matching, and shutdown.
 *
 * All tests use port 0 (OS-assigned) and tear down via close().
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { createExecutionServer } from '../src/server/index';
import { createRequestHandler, readJsonBody, sendJson } from '../src/server/router';
import type { ExecutionServer } from '../src/server/types';
import type { Route } from '../src/server/types';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

/** Create a test server on a random OS-assigned port. */
async function startTestServer(routes: Route[] = [], store?: ProcessStore): Promise<ExecutionServer> {
    return createExecutionServer({ port: 0, host: 'localhost', store });
}

/** Make an HTTP request and return status, headers, and body. */
function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Server', () => {
    let server: ExecutionServer | undefined;

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
    });

    // ========================================================================
    // 1. Health endpoint
    // ========================================================================

    it('should start and return health', async () => {
        server = await startTestServer();
        const res = await request(`${server.url}/api/health`);

        expect(res.status).toBe(200);

        const body = JSON.parse(res.body);
        expect(body.status).toBe('ok');
        expect(body.uptime).toBeGreaterThanOrEqual(0);
        expect(body.processCount).toBe(0);
    });

    // ========================================================================
    // 2. CORS headers
    // ========================================================================

    it('should include CORS headers', async () => {
        server = await startTestServer();
        const res = await request(`${server.url}/api/health`);

        expect(res.headers['access-control-allow-origin']).toBe('*');
        expect(res.headers['access-control-allow-methods']).toContain('GET');
        expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    // ========================================================================
    // 3. OPTIONS preflight
    // ========================================================================

    it('should respond 204 to OPTIONS preflight', async () => {
        server = await startTestServer();
        const res = await request(`${server.url}/api/health`, { method: 'OPTIONS' });

        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-methods']).toContain('GET');
        expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
    });

    // ========================================================================
    // 4. SPA fallback
    // ========================================================================

    it('should fall back to SPA shell for unknown paths', async () => {
        server = await startTestServer();
        const res = await request(`${server.url}/nonexistent/path`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.body).toContain('<div id="app">');
    });

    // ========================================================================
    // 5. JSON body parsing
    // ========================================================================

    it('should parse JSON request bodies', async () => {
        // Create a server with a custom POST route that echoes the body
        const store: ProcessStore = {
            addProcess: async () => {},
            updateProcess: async () => {},
            getProcess: async () => undefined,
            getAllProcesses: async () => [],
            removeProcess: async () => {},
            clearProcesses: async () => 0,
            getWorkspaces: async () => [],
            registerWorkspace: async () => {},
        };

        const routes: Route[] = [
            {
                method: 'POST',
                pattern: '/api/echo',
                handler: async (req, res) => {
                    const body = await readJsonBody<{ message: string }>(req);
                    sendJson(res, { echo: body.message });
                },
            },
        ];

        const handler = createRequestHandler({ routes, spaHtml: '<html></html>', store });
        const httpServer = http.createServer(handler);

        await new Promise<void>((resolve) => {
            httpServer.listen(0, 'localhost', () => resolve());
        });

        const address = httpServer.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        try {
            const res = await request(`http://localhost:${port}/api/echo`, {
                method: 'POST',
                body: JSON.stringify({ message: 'hello' }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.echo).toBe('hello');
        } finally {
            await new Promise<void>((resolve, reject) => {
                httpServer.close((err) => (err ? reject(err) : resolve()));
            });
        }
    });

    // ========================================================================
    // 6. Graceful shutdown
    // ========================================================================

    it('should stop listening after close()', async () => {
        server = await startTestServer();
        expect(server.server.listening).toBe(true);

        await server.close();
        expect(server.server.listening).toBe(false);
        server = undefined; // prevent double-close in afterEach
    });

    // ========================================================================
    // 7. Custom routes
    // ========================================================================

    it('should handle custom routes', async () => {
        const store: ProcessStore = {
            addProcess: async () => {},
            updateProcess: async () => {},
            getProcess: async () => undefined,
            getAllProcesses: async () => [],
            removeProcess: async () => {},
            clearProcesses: async () => 0,
            getWorkspaces: async () => [],
            registerWorkspace: async () => {},
        };

        const routes: Route[] = [
            {
                method: 'GET',
                pattern: '/api/custom',
                handler: (_req, res) => {
                    sendJson(res, { custom: true });
                },
            },
        ];

        const handler = createRequestHandler({ routes, spaHtml: '<html></html>', store });
        const httpServer = http.createServer(handler);

        await new Promise<void>((resolve) => {
            httpServer.listen(0, 'localhost', () => resolve());
        });

        const address = httpServer.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        try {
            const res = await request(`http://localhost:${port}/api/custom`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.custom).toBe(true);
        } finally {
            await new Promise<void>((resolve, reject) => {
                httpServer.close((err) => (err ? reject(err) : resolve()));
            });
        }
    });

    // ========================================================================
    // 8. Regex route matching
    // ========================================================================

    it('should match regex routes and capture params', async () => {
        const store: ProcessStore = {
            addProcess: async () => {},
            updateProcess: async () => {},
            getProcess: async () => undefined,
            getAllProcesses: async () => [],
            removeProcess: async () => {},
            clearProcesses: async () => 0,
            getWorkspaces: async () => [],
            registerWorkspace: async () => {},
        };

        let capturedMatch: RegExpMatchArray | undefined;

        const routes: Route[] = [
            {
                method: 'GET',
                pattern: /^\/api\/items\/(\w+)$/,
                handler: (_req, res, match) => {
                    capturedMatch = match;
                    sendJson(res, { id: match?.[1] });
                },
            },
        ];

        const handler = createRequestHandler({ routes, spaHtml: '<html></html>', store });
        const httpServer = http.createServer(handler);

        await new Promise<void>((resolve) => {
            httpServer.listen(0, 'localhost', () => resolve());
        });

        const address = httpServer.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        try {
            const res = await request(`http://localhost:${port}/api/items/abc123`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.id).toBe('abc123');
            expect(capturedMatch).toBeDefined();
            expect(capturedMatch![1]).toBe('abc123');
        } finally {
            await new Promise<void>((resolve, reject) => {
                httpServer.close((err) => (err ? reject(err) : resolve()));
            });
        }
    });

    // ========================================================================
    // Additional: 404 for unmatched API routes
    // ========================================================================

    it('should return 404 JSON for unmatched API routes', async () => {
        server = await startTestServer();
        const res = await request(`${server.url}/api/nonexistent`);

        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('API route not found');
    });
});
