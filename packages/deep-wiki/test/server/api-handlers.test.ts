/**
 * API Handlers Tests
 *
 * Tests for the REST API endpoint handlers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { createServer, type WikiServer } from '../../src/server';
import type { ComponentGraph } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let server: WikiServer | null = null;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-api-test-'));
});

afterEach(async () => {
    if (server) {
        await server.close();
        server = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function createTestModuleGraph(): ComponentGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: [
            {
                id: 'auth',
                name: 'Auth Module',
                path: 'src/auth/',
                purpose: 'Handles authentication',
                keyFiles: ['src/auth/index.ts'],
                dependencies: ['database'],
                dependents: ['api'],
                complexity: 'high',
                category: 'core',
            },
            {
                id: 'database',
                name: 'Database Module',
                path: 'src/database/',
                purpose: 'Database access layer',
                keyFiles: ['src/database/index.ts'],
                dependencies: [],
                dependents: ['auth'],
                complexity: 'medium',
                category: 'core',
            },
        ],
        categories: [
            { name: 'core', description: 'Core functionality' },
        ],
        architectureNotes: 'Layered architecture.',
    };
}

function setupWikiDir(graph?: ComponentGraph): string {
    const wikiDir = path.join(tempDir, 'wiki');
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });

    const g = graph || createTestModuleGraph();
    fs.writeFileSync(
        path.join(wikiDir, 'component-graph.json'),
        JSON.stringify(g, null, 2),
        'utf-8'
    );

    fs.writeFileSync(path.join(componentsDir, 'auth.md'), '# Auth Module\n\nAuth content.', 'utf-8');
    fs.writeFileSync(path.join(componentsDir, 'database.md'), '# Database Module\n\nDB content.', 'utf-8');
    fs.writeFileSync(path.join(wikiDir, 'index.md'), '# Project Index', 'utf-8');
    fs.writeFileSync(path.join(wikiDir, 'architecture.md'), '# Architecture', 'utf-8');

    return wikiDir;
}

async function startServer(wikiDir: string, options?: Partial<Parameters<typeof createServer>[0]>): Promise<WikiServer> {
    const s = await createServer({
        wikiDir,
        port: 0, // Random available port
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

async function fetchText(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({ status: res.statusCode || 0, body: data });
            });
        }).on('error', reject);
    });
}

// ============================================================================
// GET /api/graph
// ============================================================================

describe('GET /api/graph', () => {
    it('should return the full component graph', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/graph`);
        expect(status).toBe(200);

        const graph = body as ComponentGraph;
        expect(graph.project.name).toBe('TestProject');
        expect(graph.components).toHaveLength(2);
    });

    it('should include categories', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await fetchJson(`${s.url}/api/graph`);
        const graph = body as ComponentGraph;
        expect(graph.categories).toHaveLength(1);
        expect(graph.categories[0].name).toBe('core');
    });
});

// ============================================================================
// GET /api/components
// ============================================================================

describe('GET /api/components', () => {
    it('should return component summaries', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/components`);
        expect(status).toBe(200);

        const components = body as Array<{ id: string; name: string }>;
        expect(components).toHaveLength(2);
        expect(components.find(m => m.id === 'auth')).toBeDefined();
    });

    it('should include id, name, category, complexity, path, purpose', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await fetchJson(`${s.url}/api/components`);
        const components = body as Array<Record<string, string>>;
        const auth = components.find(m => m.id === 'auth')!;

        expect(auth.name).toBe('Auth Module');
        expect(auth.category).toBe('core');
        expect(auth.complexity).toBe('high');
        expect(auth.path).toBe('src/auth/');
        expect(auth.purpose).toBe('Handles authentication');
    });
});

// ============================================================================
// GET /api/components/:id
// ============================================================================

describe('GET /api/components/:id', () => {
    it('should return component detail with markdown', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/components/auth`);
        expect(status).toBe(200);

        const detail = body as { component: { id: string }; markdown: string };
        expect(detail.component.id).toBe('auth');
        expect(detail.markdown).toContain('# Auth Module');
    });

    it('should return 404 for non-existent component', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/components/nonexistent`);
        expect(status).toBe(404);
        expect((body as { error: string }).error).toContain('not found');
    });

    it('should handle URL-encoded component IDs', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status } = await fetchJson(`${s.url}/api/components/${encodeURIComponent('auth')}`);
        expect(status).toBe(200);
    });
});

// ============================================================================
// GET /api/pages/:key
// ============================================================================

describe('GET /api/pages/:key', () => {
    it('should return index page', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/pages/index`);
        expect(status).toBe(200);

        const page = body as { key: string; title: string; markdown: string };
        expect(page.key).toBe('index');
        expect(page.title).toBe('Index');
        expect(page.markdown).toContain('# Project Index');
    });

    it('should return architecture page', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/pages/architecture`);
        expect(status).toBe(200);

        const page = body as { key: string; title: string; markdown: string };
        expect(page.title).toBe('Architecture');
    });

    it('should return 404 for non-existent page', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/pages/nonexistent`);
        expect(status).toBe(404);
        expect((body as { error: string }).error).toContain('not found');
    });
});

// ============================================================================
// SPA Shell
// ============================================================================

describe('SPA shell', () => {
    it('should serve HTML at root /', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchText(s.url);
        expect(status).toBe(200);
        expect(body).toContain('<!DOCTYPE html>');
        expect(body).toContain('TestProject');
    });

    it('should serve HTML at /index.html', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchText(`${s.url}/index.html`);
        expect(status).toBe(200);
        expect(body).toContain('<!DOCTYPE html>');
    });

    it('should serve SPA for unknown routes (client-side routing)', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchText(`${s.url}/some/unknown/route`);
        expect(status).toBe(200);
        expect(body).toContain('<!DOCTYPE html>');
    });
});

// ============================================================================
// Static Files
// ============================================================================

describe('Static file serving', () => {
    it('should serve embedded-data.js from wiki dir', async () => {
        const wikiDir = setupWikiDir();
        // Create embedded-data.js
        fs.writeFileSync(path.join(wikiDir, 'embedded-data.js'), 'var x = 1;', 'utf-8');

        const s = await startServer(wikiDir);

        const { status, body } = await fetchText(`${s.url}/embedded-data.js`);
        expect(status).toBe(200);
        expect(body).toBe('var x = 1;');
    });
});

// ============================================================================
// Unknown API Routes
// ============================================================================

describe('Unknown API routes', () => {
    it('should return 404 for unknown API endpoint', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/unknown`);
        expect(status).toBe(404);
        expect((body as { error: string }).error).toContain('Unknown API endpoint');
    });
});

// ============================================================================
// AI Feature Gating
// ============================================================================

describe('AI feature gating', () => {
    it('should reject POST /api/ask when AI is disabled', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir, { aiEnabled: false });

        const { status, body } = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
            const req = http.request(`${s.url}/api/ask`, { method: 'POST' }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
                });
            });
            req.on('error', reject);
            req.write(JSON.stringify({ question: 'test' }));
            req.end();
        });

        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('not enabled');
    });

    it('should reject POST /api/explore/:id when AI is disabled', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir, { aiEnabled: false });

        const { status, body } = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
            const req = http.request(`${s.url}/api/explore/auth`, { method: 'POST' }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
                });
            });
            req.on('error', reject);
            req.write(JSON.stringify({}));
            req.end();
        });

        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('not enabled');
    });
});

// ============================================================================
// CORS
// ============================================================================

describe('CORS headers', () => {
    it('should include CORS headers on API responses', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
            http.get(`${s.url}/api/graph`, (res) => {
                res.resume();
                resolve(res.headers);
            }).on('error', reject);
        });

        expect(headers['access-control-allow-origin']).toBe('*');
    });

    it('should handle OPTIONS preflight', async () => {
        const wikiDir = setupWikiDir();
        const s = await startServer(wikiDir);

        const status = await new Promise<number>((resolve, reject) => {
            const req = http.request(`${s.url}/api/graph`, { method: 'OPTIONS' }, (res) => {
                res.resume();
                resolve(res.statusCode || 0);
            });
            req.on('error', reject);
            req.end();
        });

        expect(status).toBe(204);
    });
});
