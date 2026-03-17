/**
 * Wiki API Handlers Tests (coc-server)
 *
 * Tests for wiki CRUD HTTP routes registered by registerWikiRoutes():
 * - GET  /api/wikis                — list all wikis
 * - POST /api/wikis                — register a new wiki
 * - GET  /api/wikis/:wikiId        — get wiki metadata
 * - DELETE /api/wikis/:wikiId      — remove a wiki
 * - PATCH  /api/wikis/:wikiId      — update wiki metadata
 *
 * These are the routes that were entirely untested (only routing/CORS was tested
 * in wiki-router-utils.test.ts and wiki-static-cors.test.ts).
 *
 * Uses a temp directory with a minimal component-graph.json fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../src/shared/router';
import { registerWikiRoutes } from '../src/wiki/wiki-routes';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
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

/**
 * Create a temp wiki directory with a component-graph.json so WikiManager
 * can register the wiki without errors.
 */
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

async function apiRequest(
    baseUrl: string,
    pathname: string,
    opts: { method?: string; body?: unknown } = {}
): Promise<{ status: number; body: unknown }> {
    const method = opts.method ?? 'GET';
    const init: RequestInit = { method };
    if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
        init.headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(`${baseUrl}${pathname}`, init);
    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body };
}

// ============================================================================
// Tests
// ============================================================================

describe('Wiki API Routes', () => {
    let server: http.Server;
    let baseUrl: string;
    let dataDir: string;
    let store: FileProcessStore;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-api-test-'));
        store = new FileProcessStore({ dataDir });

        const routes: Route[] = [];
        registerWikiRoutes(routes, { store, dataDir });
        const handler = createRouter({ routes, spaHtml: '' });
        server = http.createServer(handler);
        baseUrl = await startServer(server);
    });

    afterEach(async () => {
        await stopServer(server);
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ---- GET /api/wikis -------------------------------------------------------

    describe('GET /api/wikis', () => {
        it('returns empty list when no wikis are registered', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/wikis');
            expect(status).toBe(200);
            expect(Array.isArray(body)).toBe(true);
            expect((body as unknown[]).length).toBe(0);
        });

        it('lists a registered wiki', async () => {
            const wikiDir = createWikiDir(dataDir, 'test-wiki');
            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                store,
                dataDir,
                wikis: { 'test-wiki': { wikiDir } },
            });
            const localServer = http.createServer(createRouter({ routes, spaHtml: '' }));
            const localUrl = await startServer(localServer);

            try {
                const { status, body } = await apiRequest(localUrl, '/api/wikis');
                expect(status).toBe(200);
                const list = body as any[];
                expect(list.length).toBeGreaterThanOrEqual(1);
                const found = list.find((w: any) => w.id === 'test-wiki');
                expect(found).toBeDefined();
            } finally {
                await stopServer(localServer);
            }
        });
    });

    // ---- POST /api/wikis -------------------------------------------------------

    describe('POST /api/wikis', () => {
        it('returns 400 when id is missing', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/wikis', {
                method: 'POST',
                body: { wikiDir: dataDir },
            });
            expect(status).toBe(400);
            expect((body as any).error).toMatch(/id/i);
        });

        it('returns 400 when neither wikiDir nor repoPath is provided', async () => {
            const { status, body } = await apiRequest(baseUrl, '/api/wikis', {
                method: 'POST',
                body: { id: 'new-wiki' },
            });
            expect(status).toBe(400);
            expect((body as any).error).toMatch(/wikiDir|repoPath/i);
        });

        it('creates a wiki entry and returns 201', async () => {
            const wikiDir = path.join(dataDir, 'wikis', 'created-wiki');
            const { status, body } = await apiRequest(baseUrl, '/api/wikis', {
                method: 'POST',
                body: { id: 'created-wiki', wikiDir },
            });
            expect(status).toBe(201);
            expect((body as any).id).toBe('created-wiki');
        });

        it('persists wiki to store', async () => {
            const wikiDir = path.join(dataDir, 'wikis', 'persisted-wiki');
            await apiRequest(baseUrl, '/api/wikis', {
                method: 'POST',
                body: { id: 'persisted-wiki', name: 'My Wiki', wikiDir },
            });

            const wikis = await store.getWikis();
            const found = wikis.find(w => w.id === 'persisted-wiki');
            expect(found).toBeDefined();
            expect(found!.name).toBe('My Wiki');
        });

        it('registers wiki in manager when component-graph.json exists', async () => {
            const wikiDir = createWikiDir(dataDir, 'loadable-wiki');
            const { status, body } = await apiRequest(baseUrl, '/api/wikis', {
                method: 'POST',
                body: { id: 'loadable-wiki', wikiDir },
            });
            expect(status).toBe(201);
            expect((body as any).hasExistingData).toBe(true);
        });
    });

    // ---- GET /api/wikis/:wikiId -----------------------------------------------

    describe('GET /api/wikis/:wikiId', () => {
        it('returns 404 for non-existent wiki', async () => {
            const { status } = await apiRequest(baseUrl, '/api/wikis/does-not-exist');
            expect(status).toBe(404);
        });

        it('returns metadata for a loaded wiki', async () => {
            // Register wiki with existing data
            const wikiDir = createWikiDir(dataDir, 'meta-wiki');
            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                store,
                dataDir,
                wikis: { 'meta-wiki': { wikiDir } },
            });
            const localServer = http.createServer(createRouter({ routes, spaHtml: '' }));
            const localUrl = await startServer(localServer);

            try {
                const { status, body } = await apiRequest(localUrl, '/api/wikis/meta-wiki');
                expect(status).toBe(200);
                expect((body as any).id).toBe('meta-wiki');
                expect(typeof (body as any).wikiDir).toBe('string');
                expect(typeof (body as any).componentCount).toBe('number');
            } finally {
                await stopServer(localServer);
            }
        });
    });

    // ---- DELETE /api/wikis/:wikiId --------------------------------------------

    describe('DELETE /api/wikis/:wikiId', () => {
        it('returns 404 for non-existent wiki', async () => {
            const { status } = await apiRequest(baseUrl, '/api/wikis/no-such-wiki', { method: 'DELETE' });
            expect(status).toBe(404);
        });

        it('removes a persisted-only wiki from the store', async () => {
            // Register wiki in store but not manager (no component-graph.json)
            await store.registerWiki({
                id: 'store-only-wiki',
                name: 'Store Only',
                wikiDir: path.join(dataDir, 'store-only'),
                registeredAt: new Date().toISOString(),
            });

            const { status, body } = await apiRequest(baseUrl, '/api/wikis/store-only-wiki', { method: 'DELETE' });
            expect(status).toBe(200);
            expect((body as any).success).toBe(true);

            const wikis = await store.getWikis();
            expect(wikis.find(w => w.id === 'store-only-wiki')).toBeUndefined();
        });

        it('removes a loaded wiki from the manager', async () => {
            const wikiDir = createWikiDir(dataDir, 'deletable-wiki');
            const routes: Route[] = [];
            registerWikiRoutes(routes, {
                store,
                dataDir,
                wikis: { 'deletable-wiki': { wikiDir } },
            });
            const localServer = http.createServer(createRouter({ routes, spaHtml: '' }));
            const localUrl = await startServer(localServer);

            try {
                const { status } = await apiRequest(localUrl, '/api/wikis/deletable-wiki', { method: 'DELETE' });
                expect(status).toBe(200);

                // Should 404 after deletion
                const { status: status2 } = await apiRequest(localUrl, '/api/wikis/deletable-wiki');
                expect(status2).toBe(404);
            } finally {
                await stopServer(localServer);
            }
        });
    });

    // ---- PATCH /api/wikis/:wikiId ---------------------------------------------

    describe('PATCH /api/wikis/:wikiId', () => {
        it('returns 404 when wiki does not exist', async () => {
            const { status } = await apiRequest(baseUrl, '/api/wikis/missing-wiki', {
                method: 'PATCH',
                body: { name: 'New Name' },
            });
            expect(status).toBe(404);
        });

        it('updates name of a persisted wiki', async () => {
            await store.registerWiki({
                id: 'patch-wiki',
                name: 'Old Name',
                wikiDir: path.join(dataDir, 'patch-wiki'),
                registeredAt: new Date().toISOString(),
            });

            const { status, body } = await apiRequest(baseUrl, '/api/wikis/patch-wiki', {
                method: 'PATCH',
                body: { name: 'New Name' },
            });
            expect(status).toBe(200);
            expect((body as any).success).toBe(true);

            const wikis = await store.getWikis();
            const updated = wikis.find(w => w.id === 'patch-wiki');
            expect(updated?.name).toBe('New Name');
        });
    });
});
