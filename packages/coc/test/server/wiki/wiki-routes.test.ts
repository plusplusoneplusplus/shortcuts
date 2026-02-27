/**
 * Wiki Routes Tests
 *
 * Comprehensive tests for the wiki HTTP API endpoints:
 * - Route pattern matching (all regex patterns)
 * - Wiki CRUD (list, register, remove, update, get)
 * - Data endpoints (graph, themes, components, pages)
 * - Ask and Explore SSE handlers
 * - Admin endpoints (seeds, config)
 * - Generate endpoints (start, cancel, status)
 * - 404 for unknown wikiId
 * - URL-encoded wikiId handling
 * - Existing CoC API endpoints unaffected
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import type { ComponentGraph } from '../../../src/server/wiki/types';

// ============================================================================
// Helpers
// ============================================================================

function makeComponentGraph(overrides?: Partial<ComponentGraph>): ComponentGraph {
    return {
        project: {
            name: 'test-project',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: [
            {
                id: 'auth-module',
                name: 'Authentication Module',
                path: 'src/auth',
                purpose: 'Handles user authentication',
                keyFiles: ['src/auth/index.ts'],
                dependencies: ['db-layer'],
                dependents: [],
                complexity: 'medium',
                category: 'core',
            },
            {
                id: 'db-layer',
                name: 'Database Layer',
                path: 'src/db',
                purpose: 'Manages database connections',
                keyFiles: ['src/db/index.ts'],
                dependencies: [],
                dependents: ['auth-module'],
                complexity: 'high',
                category: 'infra',
            },
        ],
        categories: [
            { name: 'core', description: 'Core logic' },
            { name: 'infra', description: 'Infrastructure' },
        ],
        architectureNotes: 'Simple architecture.',
        ...overrides,
    };
}

function createTempWikiDir(graph?: ComponentGraph): string {
    const g = graph ?? makeComponentGraph();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikiroutes-test-'));
    fs.writeFileSync(
        path.join(tmpDir, 'component-graph.json'),
        JSON.stringify(g, null, 2),
    );
    const componentsDir = path.join(tmpDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    for (const mod of g.components) {
        fs.writeFileSync(
            path.join(componentsDir, `${mod.id}.md`),
            `# ${mod.name}\n\n${mod.purpose}`,
        );
    }
    return tmpDir;
}

function removeTempDir(dirPath: string): void {
    try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch { /* ignore */ }
}

function httpRequest(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
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
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function getJSON(url: string) {
    return httpRequest(url);
}

function postJSON(url: string, data: unknown) {
    return httpRequest(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function putJSON(url: string, data: unknown) {
    return httpRequest(url, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function patchJSON(url: string, data: unknown) {
    return httpRequest(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteRequest(url: string) {
    return httpRequest(url, { method: 'DELETE' });
}

// ============================================================================
// Route Pattern Unit Tests
// ============================================================================

describe('Wiki Route Patterns', () => {
    const patterns = {
        graph: /^\/api\/wikis\/([^/]+)\/graph$/,
        themes: /^\/api\/wikis\/([^/]+)\/themes$/,
        themeArticle: /^\/api\/wikis\/([^/]+)\/themes\/([^/]+)\/([^/]+)$/,
        themeById: /^\/api\/wikis\/([^/]+)\/themes\/([^/]+)$/,
        components: /^\/api\/wikis\/([^/]+)\/components$/,
        componentById: /^\/api\/wikis\/([^/]+)\/components\/(.+)$/,
        pageByKey: /^\/api\/wikis\/([^/]+)\/pages\/(.+)$/,
        ask: /^\/api\/wikis\/([^/]+)\/ask$/,
        askSession: /^\/api\/wikis\/([^/]+)\/ask\/session\/(.+)$/,
        explore: /^\/api\/wikis\/([^/]+)\/explore\/(.+)$/,
        adminSeeds: /^\/api\/wikis\/([^/]+)\/admin\/seeds$/,
        adminConfig: /^\/api\/wikis\/([^/]+)\/admin\/config$/,
        adminGenerate: /^\/api\/wikis\/([^/]+)\/admin\/generate$/,
        adminGenerateCancel: /^\/api\/wikis\/([^/]+)\/admin\/generate\/cancel$/,
        adminGenerateStatus: /^\/api\/wikis\/([^/]+)\/admin\/generate\/status$/,
        adminGenerateComponent: /^\/api\/wikis\/([^/]+)\/admin\/generate\/component\/(.+)$/,
        wikiById: /^\/api\/wikis\/([^/]+)$/,
    };

    it('matches /api/wikis/:wikiId/graph', () => {
        const m = '/api/wikis/my-wiki/graph'.match(patterns.graph);
        expect(m).toBeTruthy();
        expect(m![1]).toBe('my-wiki');
    });

    it('matches /api/wikis/:wikiId/themes/:themeId/:slug', () => {
        const m = '/api/wikis/w1/themes/t1/intro'.match(patterns.themeArticle);
        expect(m).toBeTruthy();
        expect(m![1]).toBe('w1');
        expect(m![2]).toBe('t1');
        expect(m![3]).toBe('intro');
    });

    it('matches /api/wikis/:wikiId/components/:id', () => {
        const m = '/api/wikis/wiki-1/components/auth-module'.match(patterns.componentById);
        expect(m).toBeTruthy();
        expect(m![1]).toBe('wiki-1');
        expect(m![2]).toBe('auth-module');
    });

    it('matches /api/wikis/:wikiId/pages/:key with nested paths', () => {
        const m = '/api/wikis/w/pages/overview/architecture'.match(patterns.pageByKey);
        expect(m).toBeTruthy();
        expect(m![1]).toBe('w');
        expect(m![2]).toBe('overview/architecture');
    });

    it('matches /api/wikis/:wikiId/ask', () => {
        const m = '/api/wikis/test/ask'.match(patterns.ask);
        expect(m).toBeTruthy();
        expect(m![1]).toBe('test');
    });

    it('matches /api/wikis/:wikiId/ask/session/:sessionId', () => {
        const m = '/api/wikis/w1/ask/session/sess-123'.match(patterns.askSession);
        expect(m).toBeTruthy();
        expect(m![1]).toBe('w1');
        expect(m![2]).toBe('sess-123');
    });

    it('matches /api/wikis/:wikiId/explore/:componentId', () => {
        const m = '/api/wikis/w1/explore/auth-module'.match(patterns.explore);
        expect(m).toBeTruthy();
        expect(m![1]).toBe('w1');
        expect(m![2]).toBe('auth-module');
    });

    it('matches admin routes with wikiId', () => {
        const seeds = '/api/wikis/w1/admin/seeds'.match(patterns.adminSeeds);
        expect(seeds).toBeTruthy();
        expect(seeds![1]).toBe('w1');

        const gen = '/api/wikis/w1/admin/generate'.match(patterns.adminGenerate);
        expect(gen).toBeTruthy();

        const comp = '/api/wikis/w1/admin/generate/component/auth-module'.match(patterns.adminGenerateComponent);
        expect(comp).toBeTruthy();
        expect(comp![1]).toBe('w1');
        expect(comp![2]).toBe('auth-module');
    });

    it('matches /api/wikis/:wikiId for wiki CRUD', () => {
        const m = '/api/wikis/my-wiki'.match(patterns.wikiById);
        expect(m).toBeTruthy();
        expect(m![1]).toBe('my-wiki');
    });

    it('does not match /api/wikis/:wikiId for paths with extra segments', () => {
        // /api/wikis/w1/graph should NOT match the single-wiki pattern
        const m = '/api/wikis/w1/graph'.match(patterns.wikiById);
        expect(m).toBeNull();
    });

    it('handles URL-encoded wikiId in patterns', () => {
        const encoded = encodeURIComponent('wiki with spaces');
        const m = `/api/wikis/${encoded}/graph`.match(patterns.graph);
        expect(m).toBeTruthy();
        expect(decodeURIComponent(m![1])).toBe('wiki with spaces');
    });
});

// ============================================================================
// Integration Tests (HTTP server)
// ============================================================================

describe('Wiki Routes Integration', () => {
    let server: ExecutionServer;
    let tempDirs: string[] = [];
    let wikiDir: string;

    function makeTempWikiDir(graph?: ComponentGraph): string {
        const dir = createTempWikiDir(graph);
        tempDirs.push(dir);
        return dir;
    }

    beforeEach(async () => {
        wikiDir = makeTempWikiDir();

        server = await createExecutionServer({
            port: 0,
            wiki: {
                enabled: true,
                wikis: {
                    'test-wiki': { wikiDir },
                },
                aiEnabled: false,
            },
        });
    });

    afterEach(async () => {
        await server.close();
        for (const dir of tempDirs) removeTempDir(dir);
        tempDirs = [];
    });

    // ========================================================================
    // Wiki CRUD Endpoints
    // ========================================================================

    describe('Wiki CRUD', () => {
        it('GET /api/wikis lists registered wikis', async () => {
            const res = await getJSON(`${server.url}/api/wikis`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body).toHaveLength(1);
            expect(body[0].id).toBe('test-wiki');
            expect(body[0].wikiDir).toBe(path.resolve(wikiDir));
        });

        it('POST /api/wikis registers a new wiki', async () => {
            const newDir = makeTempWikiDir();
            const res = await postJSON(`${server.url}/api/wikis`, {
                id: 'new-wiki',
                wikiDir: newDir,
            });
            expect(res.status).toBe(201);

            // Verify it appears in the list
            const list = await getJSON(`${server.url}/api/wikis`);
            const wikis = JSON.parse(list.body);
            expect(wikis).toHaveLength(2);
        });

        it('POST /api/wikis rejects missing fields', async () => {
            const res = await postJSON(`${server.url}/api/wikis`, { id: 'x' });
            expect(res.status).toBe(400);
        });

        it('POST /api/wikis rejects invalid wikiDir', async () => {
            const res = await postJSON(`${server.url}/api/wikis`, {
                id: 'bad',
                wikiDir: '/nonexistent/path',
            });
            expect(res.status).toBe(400);
        });

        it('GET /api/wikis/:wikiId returns wiki metadata', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.id).toBe('test-wiki');
            expect(body.componentCount).toBe(2);
        });

        it('GET /api/wikis/:wikiId returns 404 for unknown wiki', async () => {
            const res = await getJSON(`${server.url}/api/wikis/no-such-wiki`);
            expect(res.status).toBe(404);
        });

        it('DELETE /api/wikis/:wikiId removes a wiki', async () => {
            const res = await deleteRequest(`${server.url}/api/wikis/test-wiki`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(true);

            // Verify it's gone
            const get = await getJSON(`${server.url}/api/wikis/test-wiki`);
            expect(get.status).toBe(404);
        });

        it('DELETE /api/wikis/:wikiId returns 404 for unknown wiki', async () => {
            const res = await deleteRequest(`${server.url}/api/wikis/nonexistent`);
            expect(res.status).toBe(404);
        });

        it('PATCH /api/wikis/:wikiId updates wiki metadata', async () => {
            const res = await patchJSON(`${server.url}/api/wikis/test-wiki`, {
                title: 'Updated Title',
            });
            expect(res.status).toBe(200);

            const get = await getJSON(`${server.url}/api/wikis/test-wiki`);
            const body = JSON.parse(get.body);
            expect(body.title).toBe('Updated Title');
        });

        it('PATCH /api/wikis/:wikiId updates name field', async () => {
            const res = await patchJSON(`${server.url}/api/wikis/test-wiki`, {
                name: 'Renamed Wiki',
            });
            expect(res.status).toBe(200);

            const get = await getJSON(`${server.url}/api/wikis/test-wiki`);
            const body = JSON.parse(get.body);
            expect(body.title).toBe('Renamed Wiki');
        });

        it('PATCH /api/wikis/:wikiId returns 404 for unknown wiki without store', async () => {
            const res = await patchJSON(`${server.url}/api/wikis/nonexistent`, { title: 'x' });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Data Endpoints
    // ========================================================================

    describe('Data Endpoints', () => {
        it('GET /api/wikis/:wikiId/graph returns component graph', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/graph`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.project.name).toBe('test-project');
            expect(body.components).toHaveLength(2);
        });

        it('GET /api/wikis/:wikiId/graph returns 404 for unknown wiki', async () => {
            const res = await getJSON(`${server.url}/api/wikis/unknown/graph`);
            expect(res.status).toBe(404);
        });

        it('GET /api/wikis/:wikiId/components returns component summaries', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/components`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(Array.isArray(body)).toBe(true);
            expect(body.length).toBe(2);
        });

        it('GET /api/wikis/:wikiId/components/:id returns component detail', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/components/auth-module`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.component.id).toBe('auth-module');
        });

        it('GET /api/wikis/:wikiId/components/:id returns 404 for unknown component', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/components/nonexistent`);
            expect(res.status).toBe(404);
        });

        it('GET /api/wikis/:wikiId/themes returns theme list', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/themes`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(Array.isArray(body)).toBe(true);
        });

        it('GET /api/wikis/:wikiId/pages/:key returns 404 for non-existent page', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/pages/nonexistent`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Admin Endpoints
    // ========================================================================

    describe('Admin Endpoints', () => {
        it('GET /api/wikis/:wikiId/admin/seeds returns seeds state', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/admin/seeds`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.exists).toBe(false);
        });

        it('PUT /api/wikis/:wikiId/admin/seeds saves and reads back', async () => {
            const seedData = { themes: [{ id: 't1', title: 'Test Theme' }] };
            const put = await putJSON(`${server.url}/api/wikis/test-wiki/admin/seeds`, {
                content: seedData,
            });
            expect(put.status).toBe(200);
            expect(JSON.parse(put.body).success).toBe(true);

            const get = await getJSON(`${server.url}/api/wikis/test-wiki/admin/seeds`);
            expect(get.status).toBe(200);
            const body = JSON.parse(get.body);
            expect(body.exists).toBe(true);
            expect(body.content.themes[0].id).toBe('t1');
        });

        it('PUT /api/wikis/:wikiId/admin/seeds rejects invalid body', async () => {
            const res = await putJSON(`${server.url}/api/wikis/test-wiki/admin/seeds`, {});
            expect(res.status).toBe(400);
        });

        it('GET /api/wikis/:wikiId/admin/seeds returns 404 for unknown wiki', async () => {
            const res = await getJSON(`${server.url}/api/wikis/unknown/admin/seeds`);
            expect(res.status).toBe(404);
        });

        it('GET /api/wikis/:wikiId/admin/config returns config state', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/admin/config`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // No repoPath configured, so should indicate that
            expect(body.exists).toBe(false);
        });

        it('GET /api/wikis/:wikiId/admin/config returns 404 for unknown wiki', async () => {
            const res = await getJSON(`${server.url}/api/wikis/unknown/admin/config`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Generate Endpoints
    // ========================================================================

    describe('Generate Endpoints', () => {
        it('GET /api/wikis/:wikiId/admin/generate/status returns status', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/admin/generate/status`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.running).toBe(false);
            expect(body.available).toBe(false); // no repoPath
        });

        it('GET /api/wikis/:wikiId/admin/generate/status returns 404 for unknown wiki', async () => {
            const res = await getJSON(`${server.url}/api/wikis/unknown/admin/generate/status`);
            expect(res.status).toBe(404);
        });

        it('GET /api/wikis/:wikiId/admin/generate/status includes metadata', async () => {
            const res = await getJSON(`${server.url}/api/wikis/test-wiki/admin/generate/status`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.metadata).toBeDefined();
            expect(body.metadata.components).toBe(2);
            expect(body.metadata.categories).toBe(2);
            expect(body.metadata.themes).toBe(0);
            expect(body.metadata.domains).toBe(0);
            expect(body.metadata.projectName).toBe('test-project');
            expect(body.metadata.projectLanguage).toBe('TypeScript');
        });

        it('POST /api/wikis/:wikiId/admin/generate rejects without repoPath', async () => {
            const res = await postJSON(`${server.url}/api/wikis/test-wiki/admin/generate`, {
                startPhase: 1,
                endPhase: 5,
            });
            expect(res.status).toBe(400);
        });

        it('POST /api/wikis/:wikiId/admin/generate/cancel returns no-op when not running', async () => {
            const res = await postJSON(`${server.url}/api/wikis/test-wiki/admin/generate/cancel`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.success).toBe(false);
        });
    });

    // ========================================================================
    // AI Endpoints (gated by aiEnabled)
    // ========================================================================

    describe('AI Endpoints (disabled)', () => {
        it('POST /api/wikis/:wikiId/ask returns 400 when AI disabled', async () => {
            const res = await postJSON(`${server.url}/api/wikis/test-wiki/ask`, {
                question: 'Hello',
            });
            expect(res.status).toBe(400);
        });

        it('POST /api/wikis/:wikiId/explore/:componentId returns 400 when AI disabled', async () => {
            const res = await postJSON(`${server.url}/api/wikis/test-wiki/explore/auth-module`, {});
            // Wiki found but AI disabled
            expect(res.status).toBe(400);
        });

        it('POST /api/wikis/:wikiId/ask returns 400 for unknown wiki', async () => {
            const res = await postJSON(`${server.url}/api/wikis/unknown/ask`, {
                question: 'Hello',
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Session Management
    // ========================================================================

    describe('Session Management', () => {
        it('DELETE /api/wikis/:wikiId/ask/session/:id returns 404 for unknown wiki', async () => {
            const res = await deleteRequest(`${server.url}/api/wikis/unknown/ask/session/sess1`);
            expect(res.status).toBe(404);
        });

        it('DELETE /api/wikis/:wikiId/ask/session/:id returns 400 when session manager not enabled', async () => {
            const res = await deleteRequest(`${server.url}/api/wikis/test-wiki/ask/session/sess1`);
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // URL-encoded wikiId
    // ========================================================================

    describe('URL-encoded wikiId', () => {
        it('handles URL-encoded wikiId in registration and lookup', async () => {
            const dir = makeTempWikiDir();
            const wikiId = 'wiki with spaces';
            const encoded = encodeURIComponent(wikiId);

            // Register
            const reg = await postJSON(`${server.url}/api/wikis`, {
                id: wikiId,
                wikiDir: dir,
            });
            expect(reg.status).toBe(201);

            // GET by encoded ID
            const get = await getJSON(`${server.url}/api/wikis/${encoded}`);
            expect(get.status).toBe(200);
            expect(JSON.parse(get.body).id).toBe(wikiId);

            // Graph
            const graph = await getJSON(`${server.url}/api/wikis/${encoded}/graph`);
            expect(graph.status).toBe(200);
        });
    });

    // ========================================================================
    // Existing CoC API Endpoints Unaffected
    // ========================================================================

    describe('Existing endpoints unaffected', () => {
        it('GET /api/health still works', async () => {
            const res = await getJSON(`${server.url}/api/health`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.status).toBe('ok');
        });

        it('GET /api/processes still works', async () => {
            const res = await getJSON(`${server.url}/api/processes`);
            expect(res.status).toBe(200);
        });

        it('GET /api/workspaces still works', async () => {
            const res = await getJSON(`${server.url}/api/workspaces`);
            expect(res.status).toBe(200);
        });
    });
});

// ============================================================================
// Unit Tests for SSE utility and prompt builders
// ============================================================================

describe('sendSSE helper', () => {
    it('formats SSE data correctly', async () => {
        const { sendSSE } = await import('../../../src/server/wiki/ask-handler');
        const chunks: string[] = [];
        const mockRes = {
            write: (data: string) => { chunks.push(data); return true; },
        } as any;

        sendSSE(mockRes, { type: 'chunk', content: 'hello' });
        expect(chunks[0]).toBe('data: {"type":"chunk","content":"hello"}\n\n');
    });
});

describe('buildAskPrompt', () => {
    it('builds a prompt with context and question', async () => {
        const { buildAskPrompt } = await import('../../../src/server/wiki/ask-handler');
        const prompt = buildAskPrompt(
            'How does auth work?',
            'Auth module handles JWT tokens.',
            'Project has auth and db modules.',
        );
        expect(prompt).toContain('How does auth work?');
        expect(prompt).toContain('Auth module handles JWT tokens.');
        expect(prompt).toContain('Project has auth and db modules.');
        expect(prompt).toContain('Architecture Overview');
        expect(prompt).toContain('Current Question');
    });

    it('includes conversation history when provided', async () => {
        const { buildAskPrompt } = await import('../../../src/server/wiki/ask-handler');
        const prompt = buildAskPrompt(
            'Follow up question',
            'context',
            'summary',
            [{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'First answer' }],
        );
        expect(prompt).toContain('Conversation History');
        expect(prompt).toContain('First question');
        expect(prompt).toContain('First answer');
    });
});

describe('buildExplorePrompt', () => {
    it('builds explore prompt with component info', async () => {
        const { buildExplorePrompt } = await import('../../../src/server/wiki/explore-handler');
        const prompt = buildExplorePrompt(
            {
                id: 'auth',
                name: 'Auth',
                category: 'core',
                path: 'src/auth',
                purpose: 'Authentication',
                keyFiles: ['index.ts'],
                dependencies: ['db'],
                dependents: [],
            },
            '# Existing analysis',
            {
                project: { name: 'Test', description: 'Desc', language: 'TS' },
                components: [{ id: 'auth', name: 'Auth', purpose: 'Auth', dependencies: ['db'] }],
            },
            { depth: 'deep' },
        );
        expect(prompt).toContain('Auth');
        expect(prompt).toContain('deep');
        expect(prompt).toContain('Existing Analysis');
        expect(prompt).toContain('Deep Analysis Task');
    });
});

// ============================================================================
// Generate Handler State Tests
// ============================================================================

describe('Generate handler per-wiki state', () => {
    it('generation state is per-wiki (not singleton)', async () => {
        const {
            getGenerationState,
            resetAllGenerationStates,
        } = await import('../../../src/server/wiki/generate-handler');

        resetAllGenerationStates();
        expect(getGenerationState('w1')).toBeNull();
        expect(getGenerationState('w2')).toBeNull();
    });

    it('resetGenerationState clears per-wiki state', async () => {
        const {
            getGenerationState,
            resetGenerationState,
            resetAllGenerationStates,
        } = await import('../../../src/server/wiki/generate-handler');

        resetAllGenerationStates();
        // After reset, both should be null
        expect(getGenerationState('w1')).toBeNull();
        resetGenerationState('w1'); // should not throw
    });
});

// ============================================================================
// Admin handler: config write with repoPath
// ============================================================================

describe('Admin handlers with repoPath', () => {
    let server: ExecutionServer;
    let tempDirs: string[] = [];
    let repoDir: string;

    function makeTempWikiDir(graph?: ComponentGraph): string {
        const dir = createTempWikiDir(graph);
        tempDirs.push(dir);
        return dir;
    }

    beforeEach(async () => {
        const wikiDir = makeTempWikiDir();
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikiroutes-repo-'));
        tempDirs.push(repoDir);

        server = await createExecutionServer({
            port: 0,
            wiki: {
                enabled: true,
                wikis: {
                    'repo-wiki': { wikiDir, repoPath: repoDir },
                },
                aiEnabled: false,
            },
        });
    });

    afterEach(async () => {
        await server.close();
        for (const dir of tempDirs) removeTempDir(dir);
        tempDirs = [];
    });

    it('GET /api/wikis/:wikiId/admin/config returns not-found for clean repo', async () => {
        const res = await getJSON(`${server.url}/api/wikis/repo-wiki/admin/config`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.exists).toBe(false);
        expect(body.defaultName).toBe('deep-wiki.config.yaml');
    });

    it('PUT /api/wikis/:wikiId/admin/config writes and reads back', async () => {
        const yamlContent = 'output: .wiki\ndepth: normal\n';
        const put = await putJSON(`${server.url}/api/wikis/repo-wiki/admin/config`, {
            content: yamlContent,
        });
        expect(put.status).toBe(200);
        expect(JSON.parse(put.body).success).toBe(true);

        const get = await getJSON(`${server.url}/api/wikis/repo-wiki/admin/config`);
        expect(get.status).toBe(200);
        const body = JSON.parse(get.body);
        expect(body.exists).toBe(true);
        expect(body.content).toContain('output: .wiki');
    });

    it('PUT /api/wikis/:wikiId/admin/config rejects invalid YAML', async () => {
        const res = await putJSON(`${server.url}/api/wikis/repo-wiki/admin/config`, {
            content: ': invalid yaml : {{',
        });
        expect(res.status).toBe(400);
    });

    it('PUT /api/wikis/:wikiId/admin/config rejects non-string content', async () => {
        const res = await putJSON(`${server.url}/api/wikis/repo-wiki/admin/config`, {
            content: 42,
        });
        expect(res.status).toBe(400);
    });

    it('GET /api/wikis/:wikiId/admin/generate/status shows available=true with repoPath', async () => {
        const res = await getJSON(`${server.url}/api/wikis/repo-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.available).toBe(true);
        expect(body.running).toBe(false);
        expect(body.phases).toBeDefined();
    });

    it('GET /api/wikis/:wikiId/admin/generate/status includes metadata with repoPath', async () => {
        const res = await getJSON(`${server.url}/api/wikis/repo-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.metadata).toBeDefined();
        expect(body.metadata.components).toBe(2);
        expect(body.metadata.categories).toBe(2);
        expect(typeof body.metadata.analyses).toBe('number');
        expect(typeof body.metadata.articles).toBe('number');
    });

    it('GET /api/wikis/:wikiId/admin/seeds reads seeds from repoPath when repoPath is set', async () => {
        const yaml = await import('js-yaml');
        const seedsData = { themes: [{ theme: 'auth', description: 'Auth module', hints: ['login'] }] };
        fs.writeFileSync(path.join(repoDir, 'seeds.yaml'), yaml.dump(seedsData), 'utf-8');

        const res = await getJSON(`${server.url}/api/wikis/repo-wiki/admin/seeds`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.exists).toBe(true);
        expect(body.content.themes[0].theme).toBe('auth');
        expect(body.path).toContain(repoDir);
    });

    it('PUT /api/wikis/:wikiId/admin/seeds writes seeds to repoPath when repoPath is set', async () => {
        const seedData = { themes: [{ theme: 'api', description: 'API layer', hints: ['rest'] }] };
        const put = await putJSON(`${server.url}/api/wikis/repo-wiki/admin/seeds`, { content: seedData });
        expect(put.status).toBe(200);
        const putBody = JSON.parse(put.body);
        expect(putBody.success).toBe(true);
        expect(putBody.path).toContain(repoDir);

        const written = fs.readFileSync(path.join(repoDir, 'seeds.yaml'), 'utf-8');
        expect(written).toContain('theme: api');
    });
});

// ============================================================================
// YAML Seeds Migration Tests
// ============================================================================

describe('Seeds YAML migration (multi-wiki)', () => {
    let server: ExecutionServer;
    let tempDirs: string[] = [];
    let wikiDir: string;

    function makeTempWikiDir(graph?: ComponentGraph): string {
        const dir = createTempWikiDir(graph);
        tempDirs.push(dir);
        return dir;
    }

    beforeEach(async () => {
        wikiDir = makeTempWikiDir();
        server = await createExecutionServer({
            port: 0,
            wiki: {
                enabled: true,
                wikis: {
                    'yaml-wiki': { wikiDir },
                },
                aiEnabled: false,
            },
        });
    });

    afterEach(async () => {
        await server.close();
        for (const dir of tempDirs) removeTempDir(dir);
        tempDirs = [];
    });

    it('GET reads seeds.yaml (not seeds.json)', async () => {
        const yaml = await import('js-yaml');
        const seedsData = {
            version: '1.0.0',
            themes: [{ theme: 'auth', description: 'Authentication', hints: ['login'] }],
        };
        fs.writeFileSync(path.join(wikiDir, 'seeds.yaml'), yaml.dump(seedsData), 'utf-8');

        const res = await getJSON(`${server.url}/api/wikis/yaml-wiki/admin/seeds`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.exists).toBe(true);
        expect(body.content.themes[0].theme).toBe('auth');
        expect(body.path).toContain('seeds.yaml');
    });

    it('GET returns Invalid YAML error for bad YAML', async () => {
        fs.writeFileSync(path.join(wikiDir, 'seeds.yaml'), '{{: bad yaml ::::', 'utf-8');

        const res = await getJSON(`${server.url}/api/wikis/yaml-wiki/admin/seeds`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.exists).toBe(true);
        expect(body.error).toBe('Invalid YAML');
        expect(body.raw).toBe('{{: bad yaml ::::');
    });

    it('PUT writes seeds as YAML via yaml.dump', async () => {
        const seedData = {
            themes: [{ theme: 'api', description: 'API layer', hints: ['rest'] }],
        };
        const put = await putJSON(`${server.url}/api/wikis/yaml-wiki/admin/seeds`, {
            content: seedData,
        });
        expect(put.status).toBe(200);
        expect(JSON.parse(put.body).success).toBe(true);

        // Verify the file is written as YAML (not JSON)
        const written = fs.readFileSync(path.join(wikiDir, 'seeds.yaml'), 'utf-8');
        expect(written).not.toContain('{');
        expect(written).toContain('theme: api');

        // Verify round-trip via GET
        const get = await getJSON(`${server.url}/api/wikis/yaml-wiki/admin/seeds`);
        expect(get.status).toBe(200);
        const body = JSON.parse(get.body);
        expect(body.content.themes[0].theme).toBe('api');
    });

    it('PUT passes raw string content through as-is', async () => {
        const rawYaml = 'themes:\n  - theme: raw\n    description: Raw string\n    hints: []\n';
        const put = await putJSON(`${server.url}/api/wikis/yaml-wiki/admin/seeds`, {
            content: rawYaml,
        });
        expect(put.status).toBe(200);

        const written = fs.readFileSync(path.join(wikiDir, 'seeds.yaml'), 'utf-8');
        expect(written).toBe(rawYaml);
    });
});

// ============================================================================
// Seeds Generate Endpoint Tests
// ============================================================================

describe('POST /api/wikis/:wikiId/admin/seeds/generate', () => {
    let server: ExecutionServer;
    let tempDirs: string[] = [];

    function makeTempWikiDir(graph?: ComponentGraph): string {
        const dir = createTempWikiDir(graph);
        tempDirs.push(dir);
        return dir;
    }

    afterEach(async () => {
        await server.close();
        for (const dir of tempDirs) removeTempDir(dir);
        tempDirs = [];
    });

    it('returns 404 JSON for unknown wikiId', async () => {
        const wikiDir = makeTempWikiDir();
        server = await createExecutionServer({
            port: 0,
            wiki: {
                enabled: true,
                wikis: { 'gen-wiki': { wikiDir } },
                aiEnabled: false,
            },
        });

        const res = await postJSON(`${server.url}/api/wikis/unknown/admin/seeds/generate`, {});
        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('Wiki not found');
    });

    it('returns 400 JSON when repoPath is not configured', async () => {
        const wikiDir = makeTempWikiDir();
        server = await createExecutionServer({
            port: 0,
            wiki: {
                enabled: true,
                wikis: { 'no-repo-wiki': { wikiDir } },
                aiEnabled: false,
            },
        });

        const res = await postJSON(`${server.url}/api/wikis/no-repo-wiki/admin/seeds/generate`, {});
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('No repository path configured');
    });

    it('route is registered (not 404 for valid wiki with repoPath)', async () => {
        const wikiDir = makeTempWikiDir();
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-seeds-gen-repo-'));
        tempDirs.push(repoDir);
        server = await createExecutionServer({
            port: 0,
            wiki: {
                enabled: true,
                wikis: { 'repo-wiki': { wikiDir, repoPath: repoDir } },
                aiEnabled: false,
            },
        });

        // Only check that the route exists (status + headers) without waiting for
        // the full SSE stream, which may invoke real AI calls and never finish in CI.
        const { status, headers } = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
            const parsed = new URL(`${server!.url}/api/wikis/repo-wiki/admin/seeds/generate`);
            const req = http.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port,
                    path: parsed.pathname + parsed.search,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                },
                (res) => {
                    // Resolve as soon as we get the response head — don't wait for body
                    resolve({ status: res.statusCode || 0, headers: res.headers });
                    res.destroy(); // abort the SSE stream
                },
            );
            req.on('error', reject);
            req.write('{}');
            req.end();
        });
        // Should be 200 (SSE started) — deep-wiki import may fail but SSE headers are sent first
        expect(status).toBe(200);
        expect(headers['content-type']).toBe('text/event-stream');
    });
});

// ============================================================================
// Generate Status Metadata Tests
// ============================================================================

describe('Generate Status Metadata', () => {
    let server: ExecutionServer;
    let tempDirs: string[] = [];

    function makeTempWikiDirWithCache(options?: {
        themes?: any[];
        domains?: any[];
        analysisIds?: string[];
        articleIds?: string[];
        articleDomains?: Record<string, string[]>;
    }): string {
        const graph = makeComponentGraph({
            themes: options?.themes,
            domains: options?.domains,
        });
        const tmpDir = createTempWikiDir(graph);
        tempDirs.push(tmpDir);

        const cacheDir = path.join(tmpDir, '.wiki-cache');

        if (options?.analysisIds) {
            const analysesDir = path.join(cacheDir, 'analyses');
            fs.mkdirSync(analysesDir, { recursive: true });
            fs.writeFileSync(path.join(analysesDir, '_metadata.json'), JSON.stringify({
                gitHash: 'abc123', timestamp: Date.now(), componentCount: options.analysisIds.length,
            }));
            for (const id of options.analysisIds) {
                fs.writeFileSync(path.join(analysesDir, `${id}.json`), JSON.stringify({
                    analysis: { componentId: id, overview: 'test' }, gitHash: 'abc123', timestamp: Date.now(),
                }));
            }
        }

        if (options?.articleIds) {
            const articlesDir = path.join(cacheDir, 'articles');
            fs.mkdirSync(articlesDir, { recursive: true });
            fs.writeFileSync(path.join(articlesDir, '_metadata.json'), JSON.stringify({
                gitHash: 'abc123', timestamp: Date.now(), componentCount: options.articleIds.length,
            }));
            for (const id of options.articleIds) {
                fs.writeFileSync(path.join(articlesDir, `${id}.json`), JSON.stringify({
                    article: { slug: id, title: id, content: 'test' }, gitHash: 'abc123', timestamp: Date.now(),
                }));
            }
        }

        if (options?.articleDomains) {
            const articlesDir = path.join(cacheDir, 'articles');
            fs.mkdirSync(articlesDir, { recursive: true });
            for (const [domain, ids] of Object.entries(options.articleDomains)) {
                const domainDir = path.join(articlesDir, domain);
                fs.mkdirSync(domainDir, { recursive: true });
                for (const id of ids) {
                    fs.writeFileSync(path.join(domainDir, `${id}.json`), JSON.stringify({
                        article: { slug: id, title: id, content: 'test' }, gitHash: 'abc123', timestamp: Date.now(),
                    }));
                }
            }
        }

        return tmpDir;
    }

    afterEach(async () => {
        await server.close();
        for (const dir of tempDirs) removeTempDir(dir);
        tempDirs = [];
    });

    it('returns analysis count from cache directory', async () => {
        const wikiDir = makeTempWikiDirWithCache({
            analysisIds: ['auth-module', 'db-layer'],
        });
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-meta-repo-'));
        tempDirs.push(repoDir);

        server = await createExecutionServer({
            port: 0,
            wiki: { enabled: true, wikis: { 'meta-wiki': { wikiDir, repoPath: repoDir } }, aiEnabled: false },
        });

        const res = await getJSON(`${server.url}/api/wikis/meta-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.metadata.analyses).toBe(2);
    });

    it('returns article count from flat cache directory', async () => {
        const wikiDir = makeTempWikiDirWithCache({
            articleIds: ['auth-module', 'db-layer'],
        });
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-meta-repo-'));
        tempDirs.push(repoDir);

        server = await createExecutionServer({
            port: 0,
            wiki: { enabled: true, wikis: { 'art-wiki': { wikiDir, repoPath: repoDir } }, aiEnabled: false },
        });

        const res = await getJSON(`${server.url}/api/wikis/art-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.metadata.articles).toBe(2);
    });

    it('returns article count from nested domain directories', async () => {
        const wikiDir = makeTempWikiDirWithCache({
            articleDomains: {
                'core': ['auth-module'],
                'infra': ['db-layer', 'cache-layer'],
            },
        });
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-meta-repo-'));
        tempDirs.push(repoDir);

        server = await createExecutionServer({
            port: 0,
            wiki: { enabled: true, wikis: { 'nested-wiki': { wikiDir, repoPath: repoDir } }, aiEnabled: false },
        });

        const res = await getJSON(`${server.url}/api/wikis/nested-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.metadata.articles).toBe(3);
    });

    it('returns theme count from graph', async () => {
        const wikiDir = makeTempWikiDirWithCache({
            themes: [
                { id: 'auth-theme', title: 'Auth', description: 'Auth theme', layout: 'single', articles: [], involvedComponentIds: [], directoryPath: '', generatedAt: Date.now() },
                { id: 'data-theme', title: 'Data', description: 'Data theme', layout: 'area', articles: [], involvedComponentIds: [], directoryPath: '', generatedAt: Date.now() },
            ],
        });
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-meta-repo-'));
        tempDirs.push(repoDir);

        server = await createExecutionServer({
            port: 0,
            wiki: { enabled: true, wikis: { 'theme-wiki': { wikiDir, repoPath: repoDir } }, aiEnabled: false },
        });

        const res = await getJSON(`${server.url}/api/wikis/theme-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.metadata.themes).toBe(2);
    });

    it('returns domain count from graph', async () => {
        const wikiDir = makeTempWikiDirWithCache({
            domains: [
                { id: 'core', name: 'Core', path: 'src/core', description: 'Core domain', components: ['auth-module'] },
                { id: 'infra', name: 'Infra', path: 'src/infra', description: 'Infra domain', components: ['db-layer'] },
            ],
        });
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-meta-repo-'));
        tempDirs.push(repoDir);

        server = await createExecutionServer({
            port: 0,
            wiki: { enabled: true, wikis: { 'domain-wiki': { wikiDir, repoPath: repoDir } }, aiEnabled: false },
        });

        const res = await getJSON(`${server.url}/api/wikis/domain-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.metadata.domains).toBe(2);
    });

    it('returns zero counts when no cache files exist', async () => {
        const wikiDir = createTempWikiDir();
        tempDirs.push(wikiDir);
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-meta-repo-'));
        tempDirs.push(repoDir);

        server = await createExecutionServer({
            port: 0,
            wiki: { enabled: true, wikis: { 'empty-wiki': { wikiDir, repoPath: repoDir } }, aiEnabled: false },
        });

        const res = await getJSON(`${server.url}/api/wikis/empty-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.metadata.analyses).toBe(0);
        expect(body.metadata.articles).toBe(0);
        expect(body.metadata.themes).toBe(0);
        expect(body.metadata.domains).toBe(0);
        expect(body.metadata.components).toBe(2);
        expect(body.metadata.categories).toBe(2);
    });

    it('excludes _metadata.json and _reduce files from article count', async () => {
        const graph = makeComponentGraph();
        const tmpDir = createTempWikiDir(graph);
        tempDirs.push(tmpDir);

        const articlesDir = path.join(tmpDir, '.wiki-cache', 'articles');
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(path.join(articlesDir, '_metadata.json'), '{}');
        fs.writeFileSync(path.join(articlesDir, '_reduce-summary.json'), '{}');
        fs.writeFileSync(path.join(articlesDir, 'auth-module.json'), JSON.stringify({
            article: { slug: 'auth', title: 'Auth', content: 'test' },
        }));

        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-meta-repo-'));
        tempDirs.push(repoDir);

        server = await createExecutionServer({
            port: 0,
            wiki: { enabled: true, wikis: { 'filter-wiki': { wikiDir: tmpDir, repoPath: repoDir } }, aiEnabled: false },
        });

        const res = await getJSON(`${server.url}/api/wikis/filter-wiki/admin/generate/status`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.metadata.articles).toBe(1);
    });
});

// ============================================================================
// Wiki Routes Always Registered (no wiki.enabled required)
// ============================================================================

describe('Wiki Routes Always Available', () => {
    let server: ExecutionServer;
    let tempDirs: string[] = [];

    function makeTempWikiDir(graph?: ComponentGraph): string {
        const dir = createTempWikiDir(graph);
        tempDirs.push(dir);
        return dir;
    }

    beforeEach(async () => {
        // Create server WITHOUT wiki options — routes should still be registered
        server = await createExecutionServer({
            port: 0,
        });
    });

    afterEach(async () => {
        await server.close();
        for (const dir of tempDirs) removeTempDir(dir);
        tempDirs = [];
    });

    it('GET /api/wikis returns empty list when no wikis configured', async () => {
        const res = await getJSON(`${server.url}/api/wikis`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body).toHaveLength(0);
    });

    it('POST /api/wikis can register a wiki with wikiDir', async () => {
        const dir = makeTempWikiDir();
        const res = await postJSON(`${server.url}/api/wikis`, {
            id: 'dynamic-wiki',
            wikiDir: dir,
        });
        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
        expect(body.hasExistingData).toBe(true);

        // Verify it appears in the list
        const list = await getJSON(`${server.url}/api/wikis`);
        const wikis = JSON.parse(list.body);
        expect(wikis.some((w: any) => w.id === 'dynamic-wiki')).toBe(true);
    });

    it('GET /api/health still works alongside wiki routes', async () => {
        const res = await getJSON(`${server.url}/api/health`);
        expect(res.status).toBe(200);
    });

    it('GET /api/processes still works alongside wiki routes', async () => {
        const res = await getJSON(`${server.url}/api/processes`);
        expect(res.status).toBe(200);
    });
});

// ============================================================================
// POST /api/wikis with repoPath (derives wikiDir automatically)
// ============================================================================

describe('Wiki Registration with repoPath', () => {
    let server: ExecutionServer;
    let tempDirs: string[] = [];
    let dataDir: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-datadir-'));
        tempDirs.push(dataDir);

        server = await createExecutionServer({
            port: 0,
            dataDir,
        });
    });

    afterEach(async () => {
        await server.close();
        for (const dir of tempDirs) removeTempDir(dir);
        tempDirs = [];
    });

    it('POST /api/wikis with repoPath derives wikiDir under dataDir/wikis/', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-repo-'));
        tempDirs.push(repoDir);

        const res = await postJSON(`${server.url}/api/wikis`, {
            id: 'repo-wiki',
            repoPath: repoDir,
            name: 'My Repo Wiki',
            color: '#ff0000',
        });
        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
        expect(body.wikiDir).toBe(path.join(dataDir, 'wikis', 'repo-wiki'));
        expect(body.hasExistingData).toBe(false);
        expect(body.name).toBe('My Repo Wiki');
        expect(body.color).toBe('#ff0000');

        // The wiki directory should have been created
        expect(fs.existsSync(body.wikiDir)).toBe(true);
    });

    it('POST /api/wikis with repoPath and existing wiki data registers immediately', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-repo-'));
        tempDirs.push(repoDir);

        // Pre-create wiki data in the derived directory
        const wikiDir = path.join(dataDir, 'wikis', 'prebuilt-wiki');
        fs.mkdirSync(wikiDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'component-graph.json'),
            JSON.stringify(makeComponentGraph(), null, 2),
        );
        const componentsDir = path.join(wikiDir, 'components');
        fs.mkdirSync(componentsDir, { recursive: true });
        for (const mod of makeComponentGraph().components) {
            fs.writeFileSync(
                path.join(componentsDir, `${mod.id}.md`),
                `# ${mod.name}\n\n${mod.purpose}`,
            );
        }

        const res = await postJSON(`${server.url}/api/wikis`, {
            id: 'prebuilt-wiki',
            repoPath: repoDir,
            name: 'Prebuilt Wiki',
        });
        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.hasExistingData).toBe(true);

        // Should be fully loaded and accessible
        const graph = await getJSON(`${server.url}/api/wikis/prebuilt-wiki/graph`);
        expect(graph.status).toBe(200);
        const graphBody = JSON.parse(graph.body);
        expect(graphBody.project.name).toBe('test-project');
    });

    it('POST /api/wikis rejects when neither wikiDir nor repoPath provided', async () => {
        const res = await postJSON(`${server.url}/api/wikis`, {
            id: 'orphan-wiki',
        });
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('wikiDir or repoPath');
    });

    it('POST /api/wikis rejects when id is missing', async () => {
        const res = await postJSON(`${server.url}/api/wikis`, {
            repoPath: '/some/path',
        });
        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('id');
    });

    it('POST /api/wikis with name and color passes them through in response', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-repo-'));
        tempDirs.push(repoDir);

        const res = await postJSON(`${server.url}/api/wikis`, {
            id: 'styled-wiki',
            repoPath: repoDir,
            name: 'Styled Wiki',
            color: '#0078d4',
            generateWithAI: true,
        });
        expect(res.status).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.name).toBe('Styled Wiki');
        expect(body.color).toBe('#0078d4');
        expect(body.generateWithAI).toBe(true);
    });
});

// ============================================================================
// Wiki Store Persistence
// ============================================================================

describe('Wiki Store Persistence', () => {
    let tempDirs: string[] = [];
    let dataDir: string;

    function makeTempWikiDir(graph?: ComponentGraph): string {
        const dir = createTempWikiDir(graph);
        tempDirs.push(dir);
        return dir;
    }

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-persist-'));
        tempDirs.push(dataDir);
    });

    afterEach(() => {
        for (const dir of tempDirs) removeTempDir(dir);
        tempDirs = [];
    });

    it('persisted wikis survive server restart', async () => {
        const { FileProcessStore } = await import('@plusplusoneplusplus/pipeline-core');
        const store = new FileProcessStore({ dataDir });

        // Start first server, register a wiki
        const wikiDir = makeTempWikiDir();
        const server1 = await createExecutionServer({
            port: 0,
            dataDir,
            store,
        });

        const reg = await postJSON(`${server1.url}/api/wikis`, {
            id: 'persist-wiki',
            wikiDir,
            name: 'Persisted Wiki',
            color: '#00ff00',
        });
        expect(reg.status).toBe(201);

        await server1.close();

        // Start second server with same store — wiki should be restored
        const store2 = new FileProcessStore({ dataDir });
        const server2 = await createExecutionServer({
            port: 0,
            dataDir,
            store: store2,
        });

        // Wait a tick for async store restoration
        await new Promise(resolve => setTimeout(resolve, 100));

        const list = await getJSON(`${server2.url}/api/wikis`);
        expect(list.status).toBe(200);
        const wikis = JSON.parse(list.body);
        expect(wikis.some((w: any) => w.id === 'persist-wiki')).toBe(true);

        await server2.close();
    });

    it('DELETE removes wiki from both manager and store', async () => {
        const { FileProcessStore } = await import('@plusplusoneplusplus/pipeline-core');
        const store = new FileProcessStore({ dataDir });

        const wikiDir = makeTempWikiDir();
        const server = await createExecutionServer({
            port: 0,
            dataDir,
            store,
        });

        // Register
        await postJSON(`${server.url}/api/wikis`, {
            id: 'del-wiki',
            wikiDir,
        });

        // Delete
        const del = await deleteRequest(`${server.url}/api/wikis/del-wiki`);
        expect(del.status).toBe(200);

        // Verify removed from store
        const storedWikis = await store.getWikis();
        expect(storedWikis.some(w => w.id === 'del-wiki')).toBe(false);

        await server.close();
    });

    it('PATCH updates name and color in the store', async () => {
        const { FileProcessStore } = await import('@plusplusoneplusplus/pipeline-core');
        const store = new FileProcessStore({ dataDir });

        const wikiDir = makeTempWikiDir();
        const server = await createExecutionServer({
            port: 0,
            dataDir,
            store,
        });

        // Register
        await postJSON(`${server.url}/api/wikis`, {
            id: 'edit-wiki',
            wikiDir,
            name: 'Original Name',
            color: '#0078d4',
        });

        // Update name and color
        const patch = await patchJSON(`${server.url}/api/wikis/edit-wiki`, {
            name: 'New Name',
            color: '#16825d',
        });
        expect(patch.status).toBe(200);

        // Verify store was updated
        const storedWikis = await store.getWikis();
        const updated = storedWikis.find(w => w.id === 'edit-wiki');
        expect(updated).toBeDefined();
        expect(updated!.name).toBe('New Name');
        expect(updated!.color).toBe('#16825d');

        await server.close();
    });

    it('PATCH updates name in the API list response', async () => {
        const { FileProcessStore } = await import('@plusplusoneplusplus/pipeline-core');
        const store = new FileProcessStore({ dataDir });

        const wikiDir = makeTempWikiDir();
        const server = await createExecutionServer({
            port: 0,
            dataDir,
            store,
        });

        await postJSON(`${server.url}/api/wikis`, {
            id: 'rename-wiki',
            wikiDir,
            name: 'Before Rename',
        });

        await patchJSON(`${server.url}/api/wikis/rename-wiki`, {
            name: 'After Rename',
        });

        const list = await getJSON(`${server.url}/api/wikis`);
        const wikis = JSON.parse(list.body);
        const wiki = wikis.find((w: any) => w.id === 'rename-wiki');
        expect(wiki).toBeDefined();
        expect(wiki.name).toBe('After Rename');

        await server.close();
    });

    it('PATCH color updates in the API list response', async () => {
        const { FileProcessStore } = await import('@plusplusoneplusplus/pipeline-core');
        const store = new FileProcessStore({ dataDir });

        const wikiDir = makeTempWikiDir();
        const server = await createExecutionServer({
            port: 0,
            dataDir,
            store,
        });

        await postJSON(`${server.url}/api/wikis`, {
            id: 'color-wiki',
            wikiDir,
            name: 'Color Wiki',
            color: '#0078d4',
        });

        await patchJSON(`${server.url}/api/wikis/color-wiki`, {
            color: '#f14c4c',
        });

        const list = await getJSON(`${server.url}/api/wikis`);
        const wikis = JSON.parse(list.body);
        const wiki = wikis.find((w: any) => w.id === 'color-wiki');
        expect(wiki).toBeDefined();
        expect(wiki.color).toBe('#f14c4c');

        await server.close();
    });

    it('PATCH succeeds for store-only wikis (not loaded in manager)', async () => {
        const { FileProcessStore } = await import('@plusplusoneplusplus/pipeline-core');
        const store = new FileProcessStore({ dataDir });

        // Register a wiki directly in the store (no component-graph.json)
        const pendingDir = path.join(dataDir, 'wikis', 'store-only');
        fs.mkdirSync(pendingDir, { recursive: true });
        await store.registerWiki({
            id: 'store-only',
            name: 'Store Only Wiki',
            wikiDir: pendingDir,
            color: '#848484',
            aiEnabled: false,
            registeredAt: new Date().toISOString(),
        });

        const server = await createExecutionServer({
            port: 0,
            dataDir,
            store,
        });

        const patch = await patchJSON(`${server.url}/api/wikis/store-only`, {
            name: 'Updated Store Wiki',
            color: '#b180d7',
        });
        expect(patch.status).toBe(200);

        const storedWikis = await store.getWikis();
        const updated = storedWikis.find(w => w.id === 'store-only');
        expect(updated).toBeDefined();
        expect(updated!.name).toBe('Updated Store Wiki');
        expect(updated!.color).toBe('#b180d7');

        await server.close();
    });

    it('admin config works for store-only pending wikis', async () => {
        const { FileProcessStore } = await import('@plusplusoneplusplus/pipeline-core');
        const store = new FileProcessStore({ dataDir });

        const pendingDir = path.join(dataDir, 'wikis', 'store-only-admin');
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-repo-'));
        fs.mkdirSync(pendingDir, { recursive: true });

        await store.registerWiki({
            id: 'store-only-admin',
            name: 'Store Only Admin Wiki',
            wikiDir: pendingDir,
            repoPath: repoDir,
            color: '#848484',
            aiEnabled: false,
            registeredAt: new Date().toISOString(),
        });

        const server = await createExecutionServer({
            port: 0,
            dataDir,
            store,
        });

        const getBefore = await getJSON(`${server.url}/api/wikis/store-only-admin/admin/config`);
        expect(getBefore.status).toBe(200);
        const beforeBody = JSON.parse(getBefore.body);
        expect(beforeBody.exists).toBe(false);

        const put = await putJSON(`${server.url}/api/wikis/store-only-admin/admin/config`, {
            content: 'model: claude-haiku-4.5\ndepth: shallow\n',
        });
        expect(put.status).toBe(200);

        const getAfter = await getJSON(`${server.url}/api/wikis/store-only-admin/admin/config`);
        expect(getAfter.status).toBe(200);
        const afterBody = JSON.parse(getAfter.body);
        expect(afterBody.exists).toBe(true);
        expect(afterBody.content).toContain('claude-haiku-4.5');

        await server.close();
        removeTempDir(repoDir);
    });

    it('GET /api/wikis merges manager and store entries', async () => {
        const { FileProcessStore } = await import('@plusplusoneplusplus/pipeline-core');
        const store = new FileProcessStore({ dataDir });

        // Pre-populate store with a wiki that has no actual data (pending generation)
        await store.registerWiki({
            id: 'pending-wiki',
            name: 'Pending Wiki',
            wikiDir: path.join(dataDir, 'wikis', 'pending-wiki'),
            repoPath: '/some/repo',
            color: '#ff0000',
            aiEnabled: false,
            registeredAt: new Date().toISOString(),
        });

        // Also create a wiki with actual data
        const wikiDir = makeTempWikiDir();

        const server = await createExecutionServer({
            port: 0,
            dataDir,
            store,
            wiki: {
                wikis: {
                    'loaded-wiki': { wikiDir },
                },
            },
        });

        const list = await getJSON(`${server.url}/api/wikis`);
        expect(list.status).toBe(200);
        const wikis = JSON.parse(list.body);

        // Should have both: loaded-wiki (from manager) and pending-wiki (from store)
        const loadedWiki = wikis.find((w: any) => w.id === 'loaded-wiki');
        const pendingWiki = wikis.find((w: any) => w.id === 'pending-wiki');

        expect(loadedWiki).toBeDefined();
        expect(loadedWiki.loaded).toBe(true);

        expect(pendingWiki).toBeDefined();
        expect(pendingWiki.loaded).toBe(false);
        expect(pendingWiki.name).toBe('Pending Wiki');
        expect(pendingWiki.color).toBe('#ff0000');

        await server.close();
    });
});
