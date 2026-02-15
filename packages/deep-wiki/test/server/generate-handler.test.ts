/**
 * Generate Handler Tests
 *
 * Tests for the phase regeneration API endpoints:
 *   POST /api/admin/generate        — Start generation (SSE stream)
 *   POST /api/admin/generate/cancel — Cancel running generation
 *   GET  /api/admin/generate/status — Get phase cache status
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { createServer, type WikiServer } from '../../src/server';
import { resetGenerationState, getGenerationState } from '../../src/server/generate-handler';
import type { ComponentGraph } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let server: WikiServer | null = null;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-generate-test-'));
    resetGenerationState();
});

afterEach(async () => {
    if (server) {
        await server.close();
        server = null;
    }
    resetGenerationState();
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function createTestModuleGraph(): ComponentGraph {
    return {
        project: {
            name: 'GenerateTestProject',
            description: 'A test project for generate handler',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: [
            {
                id: 'core',
                name: 'Core Module',
                path: 'src/core/',
                purpose: 'Core functionality',
                keyFiles: ['src/core/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'medium',
                category: 'core',
            },
        ],
        categories: [
            { name: 'core', description: 'Core functionality' },
        ],
        architectureNotes: 'Simple architecture.',
    };
}

function setupWikiDir(options?: { withCacheDir?: boolean }): { wikiDir: string; repoPath: string } {
    const wikiDir = path.join(tempDir, 'wiki');
    const repoPath = path.join(tempDir, 'repo');
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    fs.mkdirSync(repoPath, { recursive: true });

    const graph = createTestModuleGraph();
    fs.writeFileSync(path.join(wikiDir, 'component-graph.json'), JSON.stringify(graph, null, 2), 'utf-8');
    fs.writeFileSync(path.join(componentsDir, 'core.md'), '# Core Module\n\nCore content.', 'utf-8');
    fs.writeFileSync(path.join(wikiDir, 'index.md'), '# Project Index', 'utf-8');

    if (options?.withCacheDir) {
        const cacheDir = path.join(wikiDir, '.wiki-cache');
        fs.mkdirSync(cacheDir, { recursive: true });

        // Create a fake graph cache
        const graphCache = {
            metadata: {
                gitHash: 'abc123',
                timestamp: Date.now(),
                version: '1.0.0',
            },
            graph,
        };
        fs.writeFileSync(
            path.join(cacheDir, 'component-graph.json'),
            JSON.stringify(graphCache, null, 2),
            'utf-8'
        );

        // Create a fake consolidated graph cache
        const consolidatedCache = {
            graph,
            gitHash: 'abc123',
            inputComponentCount: 1,
            timestamp: Date.now(),
        };
        fs.writeFileSync(
            path.join(cacheDir, 'consolidated-graph.json'),
            JSON.stringify(consolidatedCache, null, 2),
            'utf-8'
        );

        // Create fake analyses cache
        const analysesDir = path.join(cacheDir, 'analyses');
        fs.mkdirSync(analysesDir, { recursive: true });
        fs.writeFileSync(
            path.join(analysesDir, '_metadata.json'),
            JSON.stringify({
                gitHash: 'abc123',
                timestamp: Date.now(),
                version: '1.0.0',
                componentCount: 1,
            }),
            'utf-8'
        );
        fs.writeFileSync(
            path.join(analysesDir, 'core.json'),
            JSON.stringify({
                analysis: {
                    componentId: 'core',
                    summary: 'Core module',
                    publicAPI: [],
                    internalPatterns: [],
                    integrationPoints: [],
                    gotchas: [],
                },
                gitHash: 'abc123',
                timestamp: Date.now(),
            }),
            'utf-8'
        );

        // Create fake articles cache
        const articlesDir = path.join(cacheDir, 'articles');
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(
            path.join(articlesDir, '_metadata.json'),
            JSON.stringify({
                gitHash: 'abc123',
                timestamp: Date.now(),
                version: '1.0.0',
                componentCount: 1,
            }),
            'utf-8'
        );

        // Create a fake index.html for website cache
        fs.writeFileSync(path.join(wikiDir, 'index.html'), '<html></html>', 'utf-8');
    }

    return { wikiDir, repoPath };
}

async function startServer(wikiDir: string, options?: Partial<Parameters<typeof createServer>[0]>): Promise<WikiServer> {
    const s = await createServer({
        wikiDir,
        port: 0,
        host: 'localhost',
        ...options,
    });
    server = s;
    return s;
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode || 0, body: data });
                }
            });
        }).on('error', reject);
    });
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: unknown; raw: string }> {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const parsed = new URL(url);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, body: JSON.parse(responseData), raw: responseData });
                } catch {
                    resolve({ status: res.statusCode || 0, body: responseData, raw: responseData });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ============================================================================
// GET /api/admin/generate/status
// ============================================================================

describe('GET /api/admin/generate/status', () => {
    it('should return available: false when no repo path', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        expect(status).toBe(200);

        const result = body as { running: boolean; available: boolean; phases: Record<string, unknown> };
        expect(result.available).toBe(false);
        expect(result.running).toBe(false);
    });

    it('should return available: true when repo path is set', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        expect(status).toBe(200);

        const result = body as { running: boolean; available: boolean; repoPath: string };
        expect(result.available).toBe(true);
        expect(result.repoPath).toBe(repoPath);
    });

    it('should report cache status for all phases', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withCacheDir: true });
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        expect(status).toBe(200);

        const result = body as { phases: Record<string, { cached: boolean; timestamp?: string }> };
        expect(result.phases).toBeDefined();
        expect(result.phases['1']).toBeDefined();
        expect(result.phases['2']).toBeDefined();
        expect(result.phases['3']).toBeDefined();
        expect(result.phases['4']).toBeDefined();
        expect(result.phases['5']).toBeDefined();
    });

    it('should report cached phases with timestamps', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withCacheDir: true });
        const s = await startServer(wikiDir, { repoPath });

        const { body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        const result = body as { phases: Record<string, { cached: boolean; timestamp?: string }> };

        // Phase 1 (graph cache) should be cached
        expect(result.phases['1'].cached).toBe(true);
        expect(result.phases['1'].timestamp).toBeDefined();

        // Phase 2 (consolidation cache) should be cached
        expect(result.phases['2'].cached).toBe(true);

        // Phase 3 (analysis cache) should be cached
        expect(result.phases['3'].cached).toBe(true);

        // Phase 4 (article cache) should be cached
        expect(result.phases['4'].cached).toBe(true);

        // Phase 5 (website) should be cached (index.html exists)
        expect(result.phases['5'].cached).toBe(true);
    });

    it('should report uncached phases when no cache exists', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withCacheDir: false });
        const s = await startServer(wikiDir, { repoPath });

        const { body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        const result = body as { phases: Record<string, { cached: boolean }> };

        // All phases should be uncached
        expect(result.phases['1'].cached).toBe(false);
        expect(result.phases['2'].cached).toBe(false);
        expect(result.phases['3'].cached).toBe(false);
        expect(result.phases['4'].cached).toBe(false);
        expect(result.phases['5'].cached).toBe(false);
    });

    it('should report running: false when no generation in progress', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        const result = body as { running: boolean };
        expect(result.running).toBe(false);
    });
});

// ============================================================================
// POST /api/admin/generate (validation)
// ============================================================================

describe('POST /api/admin/generate (validation)', () => {
    it('should reject when no repo path is configured', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await postJson(`${s.url}/api/admin/generate`, {
            startPhase: 1,
            endPhase: 5,
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('repository path');
    });

    it('should reject invalid startPhase', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await postJson(`${s.url}/api/admin/generate`, {
            startPhase: 0,
            endPhase: 5,
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('startPhase');
    });

    it('should reject invalid endPhase', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await postJson(`${s.url}/api/admin/generate`, {
            startPhase: 1,
            endPhase: 6,
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('endPhase');
    });

    it('should reject endPhase < startPhase', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await postJson(`${s.url}/api/admin/generate`, {
            startPhase: 3,
            endPhase: 1,
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('>=');
    });

    it('should reject invalid JSON body', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const result = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
            const parsed = new URL(`${s.url}/api/admin/generate`);
            const req = http.request({
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try { resolve({ status: res.statusCode || 0, body: JSON.parse(data) }); }
                    catch { resolve({ status: res.statusCode || 0, body: data }); }
                });
            });
            req.on('error', reject);
            req.write('not json');
            req.end();
        });

        expect(result.status).toBe(400);
        expect((result.body as { error: string }).error).toContain('valid JSON');
    });
});

// ============================================================================
// POST /api/admin/generate/cancel
// ============================================================================

describe('POST /api/admin/generate/cancel', () => {
    it('should return error when no generation in progress', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await postJson(`${s.url}/api/admin/generate/cancel`, {});
        expect(status).toBe(200);

        const result = body as { success: boolean; error?: string };
        expect(result.success).toBe(false);
        expect(result.error).toContain('No generation');
    });
});

// ============================================================================
// SPA Generate Tab
// ============================================================================

describe('SPA generate tab', () => {
    it('should include generate tab in SPA HTML', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('admin-tab-generate');
        expect(body).toContain('admin-content-generate');
        expect(body).toContain('generate-phases');
        expect(body).toContain('phase-card-1');
        expect(body).toContain('phase-card-5');
    });

    it('should include phase cards for all 5 phases', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        for (let i = 1; i <= 5; i++) {
            expect(body).toContain(`phase-card-${i}`);
            expect(body).toContain(`phase-run-${i}`);
            expect(body).toContain(`phase-cache-${i}`);
            expect(body).toContain(`phase-log-${i}`);
        }
    });

    it('should include force checkbox', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('generate-force');
        expect(body).toContain('Force (ignore cache)');
    });

    it('should include range controls', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('generate-start-phase');
        expect(body).toContain('generate-end-phase');
        expect(body).toContain('generate-run-range');
    });

    it('should include unavailable message element', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('generate-unavailable');
        expect(body).toContain('--generate');
    });

    it('should include phase descriptions', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('Discovery');
        expect(body).toContain('Consolidation');
        expect(body).toContain('Analysis');
        expect(body).toContain('Writing');
        expect(body).toContain('Website');
        expect(body).toContain('Scan repo and build module graph');
        expect(body).toContain('Build static HTML site');
    });

    it('should include generate CSS styles', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('.generate-phase-card');
        expect(body).toContain('.phase-running');
        expect(body).toContain('.phase-success');
        expect(body).toContain('.phase-error');
        expect(body).toContain('.phase-cache-badge');
    });

    it('should include generate JavaScript functions', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('loadGenerateStatus');
        expect(body).toContain('runPhaseGeneration');
        expect(body).toContain('handleGenerateEvent');
        expect(body).toContain('cancelGeneration');
        expect(body).toContain('setPhaseCardState');
    });
});

// ============================================================================
// Generate Handler State Management
// ============================================================================

describe('Generate handler state management', () => {
    it('should start with null generation state', () => {
        expect(getGenerationState()).toBeNull();
    });

    it('should reset generation state', () => {
        resetGenerationState();
        expect(getGenerationState()).toBeNull();
    });
});

// ============================================================================
// Admin handler routing for generate
// ============================================================================

describe('Admin handler routing for generate', () => {
    it('should route GET /api/admin/generate/status', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status } = await fetchJson(`${s.url}/api/admin/generate/status`);
        expect(status).toBe(200);
    });

    it('should route POST /api/admin/generate/cancel', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status } = await postJson(`${s.url}/api/admin/generate/cancel`, {});
        expect(status).toBe(200);
    });

    it('should return 404 for unknown admin generate paths', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status } = await fetchJson(`${s.url}/api/admin/generate/unknown`);
        expect(status).toBe(404);
    });

    it('should route POST /api/admin/generate/component/:componentId', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withCacheDir: false });
        const s = await startServer(wikiDir, { repoPath });

        // Should return 412 (no analysis cached) — proves the route was matched
        const { status } = await postJson(`${s.url}/api/admin/generate/component/core`, {});
        expect(status).toBe(412);
    });
});

// ============================================================================
// POST /api/admin/generate/component/:componentId (validation)
// ============================================================================

describe('POST /api/admin/generate/component/:componentId (validation)', () => {
    it('should return 503 when no repo path is configured', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await postJson(`${s.url}/api/admin/generate/component/core`, {});
        expect(status).toBe(503);
        expect((body as { error: string }).error).toContain('repository path');
    });

    it('should return 404 when component is not in graph', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await postJson(`${s.url}/api/admin/generate/component/nonexistent-component`, {});
        expect(status).toBe(404);
        expect((body as { error: string }).error).toContain('not found');
    });

    it('should return 412 when no analysis is cached for the component', async () => {
        // Setup wiki dir without analysis cache for 'core'
        const { wikiDir, repoPath } = setupWikiDir({ withCacheDir: false });
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await postJson(`${s.url}/api/admin/generate/component/core`, {});
        expect(status).toBe(412);
        expect((body as { error: string }).error).toContain('analysis');
    });

    it('should handle URL-encoded component IDs', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status } = await postJson(`${s.url}/api/admin/generate/component/${encodeURIComponent('nonexistent/component')}`, {});
        expect(status).toBe(404);
    });
});

// ============================================================================
// GET /api/admin/generate/status (per-component extension)
// ============================================================================

describe('GET /api/admin/generate/status (per-component)', () => {
    it('should include per-component article cache status in phase 4', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withCacheDir: true });
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        expect(status).toBe(200);

        const result = body as { phases: Record<string, { cached: boolean; components?: Record<string, { cached: boolean; timestamp?: string }> }> };
        expect(result.phases['4']).toBeDefined();
        expect(result.phases['4'].components).toBeDefined();
        expect(result.phases['4'].components!['core']).toBeDefined();
    });

    it('should report uncached component when no article cache file exists', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withCacheDir: true });
        const s = await startServer(wikiDir, { repoPath });

        const { body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        const result = body as { phases: Record<string, { components?: Record<string, { cached: boolean }> }> };

        // No individual article cache file for 'core' was created in setupWikiDir
        expect(result.phases['4'].components!['core'].cached).toBe(false);
    });

    it('should report cached component when article cache file exists', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withCacheDir: true });

        // Create a cached article file for 'core'
        const articlesDir = path.join(wikiDir, '.wiki-cache', 'articles');
        fs.writeFileSync(
            path.join(articlesDir, 'core.json'),
            JSON.stringify({
                article: { type: 'component', slug: 'core', title: 'Core', content: '# Core', componentId: 'core' },
                gitHash: 'abc123',
                timestamp: Date.now(),
            }),
            'utf-8'
        );

        const s = await startServer(wikiDir, { repoPath });
        const { body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        const result = body as { phases: Record<string, { components?: Record<string, { cached: boolean; timestamp?: string }> }> };

        expect(result.phases['4'].components!['core'].cached).toBe(true);
        expect(result.phases['4'].components!['core'].timestamp).toBeDefined();
    });

    it('should not include components when no repo path', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await fetchJson(`${s.url}/api/admin/generate/status`);
        const result = body as { phases: Record<string, unknown> };

        // No phases when not available
        expect(Object.keys(result.phases).length).toBe(0);
    });
});

// ============================================================================
// SPA Module Regeneration UI
// ============================================================================

describe('SPA component regeneration UI', () => {
    it('should include regenerate button in component page script', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('module-regen-btn');
        expect(body).toContain('regenerateModule');
        expect(body).toContain('checkRegenAvailability');
    });

    it('should include Phase 4 module list HTML elements', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('phase4-module-toggle');
        expect(body).toContain('phase4-module-list');
        expect(body).toContain('phase4-module-count');
    });

    it('should include module list JavaScript functions', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('initPhase4ModuleList');
        expect(body).toContain('renderPhase4ModuleList');
        expect(body).toContain('runModuleRegenFromAdmin');
    });

    it('should include regeneration CSS styles', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('.module-regen-btn');
        expect(body).toContain('.regen-overlay');
        expect(body).toContain('.phase-module-list');
        expect(body).toContain('.phase-module-row');
        expect(body).toContain('.phase-module-run-btn');
    });
});
