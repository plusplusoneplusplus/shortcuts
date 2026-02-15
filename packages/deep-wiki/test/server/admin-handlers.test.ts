/**
 * Admin Handlers Tests
 *
 * Tests for the admin portal REST API endpoints:
 *   GET  /api/admin/seeds  — Read seeds.json
 *   PUT  /api/admin/seeds  — Write seeds.json
 *   GET  /api/admin/config — Read deep-wiki.config.yaml
 *   PUT  /api/admin/config — Write deep-wiki.config.yaml
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { createServer, type WikiServer } from '../../src/server';
import type { ModuleGraph } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let server: WikiServer | null = null;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-admin-test-'));
});

afterEach(async () => {
    if (server) {
        await server.close();
        server = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function createTestModuleGraph(): ModuleGraph {
    return {
        project: {
            name: 'AdminTestProject',
            description: 'A test project for admin portal',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        modules: [
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

function setupWikiDir(options?: { withSeeds?: boolean; withConfig?: boolean }): { wikiDir: string; repoPath: string } {
    const wikiDir = path.join(tempDir, 'wiki');
    const repoPath = path.join(tempDir, 'repo');
    const modulesDir = path.join(wikiDir, 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });
    fs.mkdirSync(repoPath, { recursive: true });

    const graph = createTestModuleGraph();
    fs.writeFileSync(path.join(wikiDir, 'module-graph.json'), JSON.stringify(graph, null, 2), 'utf-8');
    fs.writeFileSync(path.join(modulesDir, 'core.md'), '# Core Module\n\nCore content.', 'utf-8');
    fs.writeFileSync(path.join(wikiDir, 'index.md'), '# Project Index', 'utf-8');

    if (options?.withSeeds) {
        const seeds = {
            version: '1.0.0',
            timestamp: Date.now(),
            repoPath: '/test/repo',
            topics: [
                { topic: 'authentication', description: 'Auth system', hints: ['auth', 'login'] },
                { topic: 'database', description: 'Database layer', hints: ['db', 'sql'] },
            ],
        };
        fs.writeFileSync(path.join(wikiDir, 'seeds.json'), JSON.stringify(seeds, null, 2), 'utf-8');
    }

    if (options?.withConfig) {
        const config = `# Deep Wiki Config\nmodel: claude-sonnet\nconcurrency: 5\ntimeout: 300\ndepth: normal\n`;
        fs.writeFileSync(path.join(repoPath, 'deep-wiki.config.yaml'), config, 'utf-8');
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

async function putJson(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const parsed = new URL(url);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, body: JSON.parse(responseData) });
                } catch {
                    resolve({ status: res.statusCode || 0, body: responseData });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ============================================================================
// GET /api/admin/seeds
// ============================================================================

describe('GET /api/admin/seeds', () => {
    it('should return seeds content when file exists', async () => {
        const { wikiDir } = setupWikiDir({ withSeeds: true });
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/admin/seeds`);
        expect(status).toBe(200);

        const result = body as { exists: boolean; content: { topics: unknown[] }; path: string };
        expect(result.exists).toBe(true);
        expect(result.content).toBeDefined();
        expect(result.content.topics).toHaveLength(2);
        expect(result.path).toContain('seeds.json');
    });

    it('should return exists: false when seeds file does not exist', async () => {
        const { wikiDir } = setupWikiDir({ withSeeds: false });
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/admin/seeds`);
        expect(status).toBe(200);

        const result = body as { exists: boolean; content: null };
        expect(result.exists).toBe(false);
        expect(result.content).toBeNull();
    });

    it('should handle invalid JSON in seeds file', async () => {
        const { wikiDir } = setupWikiDir();
        fs.writeFileSync(path.join(wikiDir, 'seeds.json'), 'not valid json {{{', 'utf-8');
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/admin/seeds`);
        expect(status).toBe(200);

        const result = body as { exists: boolean; raw: string; error: string };
        expect(result.exists).toBe(true);
        expect(result.raw).toBe('not valid json {{{');
        expect(result.error).toBe('Invalid JSON');
    });
});

// ============================================================================
// PUT /api/admin/seeds
// ============================================================================

describe('PUT /api/admin/seeds', () => {
    it('should save seeds content', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const newSeeds = {
            version: '1.0.0',
            timestamp: Date.now(),
            repoPath: '/test',
            topics: [
                { topic: 'api', description: 'API layer', hints: ['api', 'rest'] },
            ],
        };

        const { status, body } = await putJson(`${s.url}/api/admin/seeds`, { content: newSeeds });
        expect(status).toBe(200);

        const result = body as { success: boolean; path: string };
        expect(result.success).toBe(true);

        // Verify file was written
        const written = JSON.parse(fs.readFileSync(path.join(wikiDir, 'seeds.json'), 'utf-8'));
        expect(written.topics).toHaveLength(1);
        expect(written.topics[0].topic).toBe('api');
    });

    it('should overwrite existing seeds file', async () => {
        const { wikiDir } = setupWikiDir({ withSeeds: true });
        const s = await startServer(wikiDir);

        const newSeeds = { version: '2.0.0', timestamp: Date.now(), repoPath: '/new', topics: [] };
        const { status, body } = await putJson(`${s.url}/api/admin/seeds`, { content: newSeeds });
        expect(status).toBe(200);
        expect((body as { success: boolean }).success).toBe(true);

        // Verify updated content
        const written = JSON.parse(fs.readFileSync(path.join(wikiDir, 'seeds.json'), 'utf-8'));
        expect(written.version).toBe('2.0.0');
        expect(written.topics).toHaveLength(0);
    });

    it('should reject invalid request body', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await putJson(`${s.url}/api/admin/seeds`, { notContent: 'bad' });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Missing "content"');
    });

    it('should reject invalid topics field', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await putJson(`${s.url}/api/admin/seeds`, {
            content: { topics: 'not-an-array' },
        });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('topics');
    });

    it('should reject non-JSON request body', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const result = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
            const parsed = new URL(`${s.url}/api/admin/seeds`);
            const req = http.request({
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: 'PUT',
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
            req.write('this is not json');
            req.end();
        });

        expect(result.status).toBe(400);
        expect((result.body as { error: string }).error).toContain('valid JSON');
    });
});

// ============================================================================
// GET /api/admin/config
// ============================================================================

describe('GET /api/admin/config', () => {
    it('should return config content when file exists', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withConfig: true });
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await fetchJson(`${s.url}/api/admin/config`);
        expect(status).toBe(200);

        const result = body as { exists: boolean; content: string; path: string };
        expect(result.exists).toBe(true);
        expect(result.content).toContain('model: claude-sonnet');
        expect(result.path).toContain('deep-wiki.config.yaml');
    });

    it('should return exists: false when config file does not exist', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withConfig: false });
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await fetchJson(`${s.url}/api/admin/config`);
        expect(status).toBe(200);

        const result = body as { exists: boolean; content: null; defaultName: string };
        expect(result.exists).toBe(false);
        expect(result.content).toBeNull();
        expect(result.defaultName).toBe('deep-wiki.config.yaml');
    });

    it('should handle no repo path configured', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/admin/config`);
        expect(status).toBe(200);

        const result = body as { exists: boolean; error: string };
        expect(result.exists).toBe(false);
        expect(result.error).toContain('No repository path');
    });
});

// ============================================================================
// PUT /api/admin/config
// ============================================================================

describe('PUT /api/admin/config', () => {
    it('should save valid YAML config', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const yamlContent = 'model: claude-opus\nconcurrency: 3\ntimeout: 600\n';
        const { status, body } = await putJson(`${s.url}/api/admin/config`, { content: yamlContent });
        expect(status).toBe(200);

        const result = body as { success: boolean; path: string };
        expect(result.success).toBe(true);

        // Verify file was written
        const written = fs.readFileSync(path.join(repoPath, 'deep-wiki.config.yaml'), 'utf-8');
        expect(written).toBe(yamlContent);
    });

    it('should overwrite existing config file', async () => {
        const { wikiDir, repoPath } = setupWikiDir({ withConfig: true });
        const s = await startServer(wikiDir, { repoPath });

        const newConfig = 'model: gpt-4\ntimeout: 120\n';
        const { status, body } = await putJson(`${s.url}/api/admin/config`, { content: newConfig });
        expect(status).toBe(200);
        expect((body as { success: boolean }).success).toBe(true);

        const written = fs.readFileSync(path.join(repoPath, 'deep-wiki.config.yaml'), 'utf-8');
        expect(written).toBe(newConfig);
    });

    it('should reject invalid YAML config values', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        // depth must be shallow/normal/deep
        const badConfig = 'depth: invalid-value\n';
        const { status, body } = await putJson(`${s.url}/api/admin/config`, { content: badConfig });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Invalid config');
    });

    it('should reject non-string content', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await putJson(`${s.url}/api/admin/config`, { content: { not: 'a string' } });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('YAML string');
    });

    it('should reject missing content field', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        const { status, body } = await putJson(`${s.url}/api/admin/config`, { data: 'wrong field' });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('Missing "content"');
    });

    it('should reject when no repo path configured', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { status, body } = await putJson(`${s.url}/api/admin/config`, { content: 'model: test\n' });
        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('No repository path');
    });

    it('should save empty config as valid', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        const s = await startServer(wikiDir, { repoPath });

        // Empty YAML parses as null/undefined which should be allowed
        const { status, body } = await putJson(`${s.url}/api/admin/config`, { content: '' });
        expect(status).toBe(200);
        expect((body as { success: boolean }).success).toBe(true);
    });

    it('should discover .yml extension config files', async () => {
        const { wikiDir, repoPath } = setupWikiDir();
        // Create .yml instead of .yaml
        fs.writeFileSync(path.join(repoPath, 'deep-wiki.config.yml'), 'model: test\n', 'utf-8');
        const s = await startServer(wikiDir, { repoPath });

        // Overwrite it
        const newConfig = 'model: updated\n';
        const { status, body } = await putJson(`${s.url}/api/admin/config`, { content: newConfig });
        expect(status).toBe(200);
        expect((body as { success: boolean }).success).toBe(true);

        // Should have written to the existing .yml path
        const written = fs.readFileSync(path.join(repoPath, 'deep-wiki.config.yml'), 'utf-8');
        expect(written).toBe(newConfig);
    });
});

// ============================================================================
// SPA Admin Portal
// ============================================================================

describe('SPA admin portal', () => {
    it('should include admin page elements in SPA HTML', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).toContain('id="admin-toggle"');
        expect(body).toContain('id="admin-page"');
        expect(body).toContain('admin-tab-seeds');
        expect(body).toContain('admin-tab-config');
        expect(body).toContain('id="admin-back"');
        expect(body).toContain('Admin Portal');
    });

    it('should not contain overlay elements', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        expect(body).not.toContain('admin-overlay');
        expect(body).not.toContain('admin-close-btn');
    });

    it('should hide ask-widget when admin page is shown', async () => {
        const { wikiDir } = setupWikiDir();
        const s = await startServer(wikiDir);

        const { body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
            }).on('error', reject);
        });

        // showAdminContent hides the ask-widget, showWikiContent restores it
        expect(body).toContain('const askWidget = document.getElementById("ask-widget")');
        expect(body).toContain('if (askWidget) askWidget.style.display = "none"');
        expect(body).toContain('if (askWidget) askWidget.style.display = ""');
    });
});
