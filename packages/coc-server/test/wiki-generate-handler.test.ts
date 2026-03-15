/**
 * Wiki Generate Handler Tests (coc-server)
 *
 * Tests for wiki generation routes:
 * - POST /api/wikis/:wikiId/admin/generate         — start generation (SSE)
 * - POST /api/wikis/:wikiId/admin/generate/cancel  — cancel running generation
 * - GET  /api/wikis/:wikiId/admin/generate/status  — get phase cache status
 *
 * Key risks: 404 for unknown wiki, 409 when already running, 400 for invalid
 * startPhase/endPhase, cancel when not running.
 *
 * Gap: generate-handler.ts was entirely untested at handler level.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../src/shared/router';
import { registerWikiRoutes } from '../src/wiki/wiki-routes';
import { resetAllGenerationStates } from '../src/wiki/generate-handler';
import type { Route } from '../src/types';

// ============================================================================
// Fixtures
// ============================================================================

const MINIMAL_GRAPH = JSON.stringify({
    version: '1.0',
    metadata: {},
    components: [],
    domains: [],
});

function createWikiDir(baseDir: string, wikiId: string): string {
    const wikiDir = path.join(baseDir, 'wikis', wikiId);
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'component-graph.json'), MINIMAL_GRAPH, 'utf-8');
    return wikiDir;
}

// ============================================================================
// Helpers
// ============================================================================

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

async function postJSON(
    baseUrl: string,
    pathname: string,
    body: unknown
): Promise<{ status: number; contentType: string | null; text: string }> {
    const res = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, contentType: res.headers.get('content-type'), text };
}

async function getJSON(baseUrl: string, pathname: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${pathname}`);
    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body };
}

// ============================================================================
// Tests
// ============================================================================

describe('Wiki Generate Handler', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-gen-test-'));
        resetAllGenerationStates();
    });

    afterEach(() => {
        resetAllGenerationStates();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ---- POST /api/wikis/:wikiId/admin/generate — validation ------------------

    describe('POST /api/wikis/:wikiId/admin/generate', () => {
        it('returns 404 for non-existent wiki', async () => {
            const routes: Route[] = [];
            registerWikiRoutes(routes, { dataDir });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const { status, text } = await postJSON(baseUrl, '/api/wikis/nonexistent/admin/generate', { startPhase: 1, endPhase: 5 });
                expect(status).toBe(404);
                const body = JSON.parse(text);
                expect(body.error).toMatch(/not found/i);
            } finally {
                await stopServer(server);
            }
        });

        it('returns 400 when wiki has no repoPath', async () => {
            const wikiId = 'no-repo-wiki';
            const wikiDir = createWikiDir(dataDir, wikiId);

            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                dataDir,
                wikis: { [wikiId]: { wikiDir } }, // no repoPath
            });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const { status } = await postJSON(baseUrl, `/api/wikis/${wikiId}/admin/generate`, { startPhase: 1, endPhase: 5 });
                expect(status).toBe(400);
            } finally {
                await stopServer(server);
            }
        });

        it('returns 400 for invalid startPhase (out of range)', async () => {
            const wikiId = 'phase-wiki';
            const wikiDir = createWikiDir(dataDir, wikiId);
            const repoPath = dataDir;

            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                dataDir,
                wikis: { [wikiId]: { wikiDir, repoPath } },
            });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const { status } = await postJSON(baseUrl, `/api/wikis/${wikiId}/admin/generate`, { startPhase: 0, endPhase: 5 });
                expect(status).toBe(400);
            } finally {
                await stopServer(server);
            }
        });

        it('returns 400 when endPhase < startPhase', async () => {
            const wikiId = 'endphase-wiki';
            const wikiDir = createWikiDir(dataDir, wikiId);
            const repoPath = dataDir;

            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                dataDir,
                wikis: { [wikiId]: { wikiDir, repoPath } },
            });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const { status } = await postJSON(baseUrl, `/api/wikis/${wikiId}/admin/generate`, { startPhase: 3, endPhase: 2 });
                expect(status).toBe(400);
            } finally {
                await stopServer(server);
            }
        });

        it('returns 400 for non-JSON body', async () => {
            const wikiId = 'json-wiki';
            const wikiDir = createWikiDir(dataDir, wikiId);
            const repoPath = dataDir;

            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                dataDir,
                wikis: { [wikiId]: { wikiDir, repoPath } },
            });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const res = await fetch(`${baseUrl}/api/wikis/${wikiId}/admin/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: 'NOT JSON',
                });
                expect(res.status).toBe(400);
            } finally {
                await stopServer(server);
            }
        });
    });

    // ---- POST /api/wikis/:wikiId/admin/generate/cancel ------------------------

    describe('POST /api/wikis/:wikiId/admin/generate/cancel', () => {
        it('returns success:false when no generation is in progress', async () => {
            const wikiId = 'cancel-wiki';
            const wikiDir = createWikiDir(dataDir, wikiId);

            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                dataDir,
                wikis: { [wikiId]: { wikiDir } },
            });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const res = await fetch(`${baseUrl}/api/wikis/${wikiId}/admin/generate/cancel`, { method: 'POST' });
                expect(res.status).toBe(200);
                const body = await res.json();
                expect(body.success).toBe(false);
                expect(body.error).toMatch(/no generation in progress/i);
            } finally {
                await stopServer(server);
            }
        });
    });

    // ---- GET /api/wikis/:wikiId/admin/generate/status -------------------------

    describe('GET /api/wikis/:wikiId/admin/generate/status', () => {
        it('returns 404 for non-existent wiki', async () => {
            const routes: Route[] = [];
            registerWikiRoutes(routes, { dataDir });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const { status } = await getJSON(baseUrl, '/api/wikis/missing/admin/generate/status');
                expect(status).toBe(404);
            } finally {
                await stopServer(server);
            }
        });

        it('returns status with running:false when no generation is active', async () => {
            const wikiId = 'status-wiki';
            const wikiDir = createWikiDir(dataDir, wikiId);

            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                dataDir,
                wikis: { [wikiId]: { wikiDir } },
            });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const { status, body } = await getJSON(baseUrl, `/api/wikis/${wikiId}/admin/generate/status`);
                expect(status).toBe(200);
                expect((body as any).running).toBe(false);
            } finally {
                await stopServer(server);
            }
        });

        it('includes phase cache status in response', async () => {
            const wikiId = 'phasecache-wiki';
            const wikiDir = createWikiDir(dataDir, wikiId);

            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                dataDir,
                wikis: { [wikiId]: { wikiDir } },
            });
            const server = http.createServer(createRouter({ routes, spaHtml: '' }));
            const baseUrl = await startServer(server);

            try {
                const { body } = await getJSON(baseUrl, `/api/wikis/${wikiId}/admin/generate/status`);
                expect(typeof (body as any).phases).toBe('object');
            } finally {
                await stopServer(server);
            }
        });
    });
});
