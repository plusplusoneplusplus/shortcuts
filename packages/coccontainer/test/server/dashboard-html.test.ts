/**
 * Tests for the dashboard HTML rendering path on `GET /`.
 *
 * These tests use the `htmlRenderer` / `skipHtmlPrecheck` injection seams on
 * `createContainerServer` so they can exercise both startup-time and
 * request-time failure modes without depending on coc's compiled `dist/`.
 *
 * Regression: before this seam existed, when coc's compiled
 * `html-template.js` was missing, the server wrote `res.writeHead(200)` and
 * THEN tried to render — the throw was swallowed by `headersSent`, so the
 * socket hung until the client timed out. The reordered handler must produce
 * a clean 500 instead, and the eager probe must reject server startup.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface HttpResult {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
}

function httpGet(url: string, timeoutMs = 2000): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method: 'GET',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            },
        );
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`HTTP request to ${url} timed out after ${timeoutMs}ms`));
        });
        req.on('error', reject);
        req.end();
    });
}

function makeConfig(port: number, dataDir: string) {
    return {
        serve: { port, host: '127.0.0.1', dataDir },
        // Effectively disable the periodic agent health check during tests.
        healthCheckIntervalMs: 600_000,
        tunnelBridgeBasePort: 0,
    };
}

function pickPort(): number {
    return 16000 + Math.floor(Math.random() * 5000);
}

describe('coccontainer dashboard HTML', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coccontainer-html-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('serves 200 HTML on GET / using the injected renderer', async () => {
        const { createContainerServer } = await import('../../src/server');
        const port = pickPort();
        const html = '<!doctype html><html><body>CoCContainer containerMode: true</body></html>';
        const server = await createContainerServer(makeConfig(port, tmpDir), {
            htmlRenderer: () => html,
        });
        try {
            const res = await httpGet(`http://127.0.0.1:${port}/`);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('text/html');
            expect(res.body).toBe(html);

            // /index.html should behave the same way
            const resIndex = await httpGet(`http://127.0.0.1:${port}/index.html`);
            expect(resIndex.status).toBe(200);
            expect(resIndex.body).toBe(html);
        } finally {
            server.close();
        }
    });

    it('rejects createContainerServer when the eager HTML probe fails', async () => {
        const { createContainerServer } = await import('../../src/server');
        const port = pickPort();
        await expect(
            createContainerServer(makeConfig(port, tmpDir), {
                htmlRenderer: () => {
                    throw new Error('synthetic template load failure');
                },
            }),
        ).rejects.toThrow(/synthetic template load failure/);

        // The port must NOT be bound when startup rejects — a follow-up
        // request should fail fast with ECONNREFUSED, not hang.
        await expect(httpGet(`http://127.0.0.1:${port}/`, 500)).rejects.toBeDefined();
    });

    it('returns a 500 JSON error (not a hung socket) when the renderer throws at request time', async () => {
        const { createContainerServer } = await import('../../src/server');
        const port = pickPort();
        const server = await createContainerServer(makeConfig(port, tmpDir), {
            htmlRenderer: () => {
                throw new Error('boom-at-request-time');
            },
            // Disable the eager probe so we can exercise the request-time path.
            skipHtmlPrecheck: true,
        });
        try {
            const res = await httpGet(`http://127.0.0.1:${port}/`, 3000);
            expect(res.status).toBe(500);
            const parsed = JSON.parse(res.body);
            expect(parsed.error).toContain('boom-at-request-time');
        } finally {
            server.close();
        }
    });

    it('startup error message points the user at building coc', async () => {
        const { createContainerServer } = await import('../../src/server');
        const port = pickPort();
        await expect(
            createContainerServer(makeConfig(port, tmpDir), {
                htmlRenderer: () => {
                    throw new Error('Cannot find module html-template.js');
                },
            }),
        ).rejects.toThrow(/coc/);
    });
});
