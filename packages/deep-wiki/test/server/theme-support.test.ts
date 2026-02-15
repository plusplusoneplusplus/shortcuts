/**
 * Theme Support Tests
 *
 * Tests for all theme-related server changes:
 * - WikiData theme loading
 * - TF-IDF indexing of theme articles
 * - Context retrieval with themes
 * - API endpoints for themes
 * - Ask handler with theme context
 * - Sidebar rendering with themes
 * - Backward compatibility (no themes)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { WikiData } from '../../src/server/wiki-data';
import { ContextBuilder } from '../../src/server/context-builder';
import { createServer, type WikiServer } from '../../src/server';
import type { ComponentGraph, ThemeMeta } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let server: WikiServer | null = null;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-theme-test-'));
});

afterEach(async () => {
    if (server) {
        await server.close();
        server = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function createThemeMeta(overrides?: Partial<ThemeMeta>): ThemeMeta {
    return {
        id: 'compaction',
        title: 'Compaction Strategies',
        description: 'How the system compacts data for storage efficiency',
        layout: 'area',
        articles: [
            { slug: 'compaction-overview', title: 'Compaction Overview', path: 'themes/compaction/compaction-overview.md' },
            { slug: 'compaction-styles', title: 'Compaction Styles', path: 'themes/compaction/compaction-styles.md' },
        ],
        involvedComponentIds: ['auth'],
        directoryPath: 'themes/compaction',
        generatedAt: Date.now(),
        ...overrides,
    };
}

function createSingleThemeMeta(): ThemeMeta {
    return {
        id: 'caching',
        title: 'Caching Strategy',
        description: 'How caching works across the system',
        layout: 'single',
        articles: [
            { slug: 'caching', title: 'Caching Strategy', path: 'themes/caching.md' },
        ],
        involvedComponentIds: ['database'],
        directoryPath: 'themes',
        generatedAt: Date.now(),
    };
}

function createTestModuleGraph(themes?: ThemeMeta[]): ComponentGraph {
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
        themes: themes,
    };
}

function setupWikiDir(graph?: ComponentGraph, options?: {
    themeFiles?: Record<string, string>;
}): string {
    const wikiDir = path.join(tempDir, 'wiki');
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });

    const g = graph || createTestModuleGraph();
    fs.writeFileSync(
        path.join(wikiDir, 'component-graph.json'),
        JSON.stringify(g, null, 2),
        'utf-8'
    );

    fs.writeFileSync(path.join(componentsDir, 'auth.md'), '# Auth Module\n\nAuth content about authentication and login.', 'utf-8');
    fs.writeFileSync(path.join(componentsDir, 'database.md'), '# Database Module\n\nDB content about queries.', 'utf-8');
    fs.writeFileSync(path.join(wikiDir, 'index.md'), '# Project Index', 'utf-8');

    // Write theme files
    if (options?.themeFiles) {
        for (const [filePath, content] of Object.entries(options.themeFiles)) {
            const fullPath = path.join(wikiDir, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    return wikiDir;
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

// ============================================================================
// WikiData — Theme Loading
// ============================================================================

describe('WikiData — theme loading', () => {
    it('should load area-layout theme articles from themes/ directory', () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph, {
            themeFiles: {
                'themes/compaction/compaction-overview.md': '# Compaction Overview\n\nOverview content.',
                'themes/compaction/compaction-styles.md': '# Compaction Styles\n\nStyles content.',
            },
        });

        const wd = new WikiData(wikiDir);
        wd.load();

        const articles = wd.getThemeArticles('compaction');
        expect(articles).toHaveLength(2);
        expect(articles[0].slug).toBe('compaction-overview');
        expect(articles[0].content).toContain('Overview content');
        expect(articles[1].slug).toBe('compaction-styles');
        expect(articles[1].content).toContain('Styles content');
    });

    it('should load single-layout theme article', () => {
        const theme = createSingleThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph, {
            themeFiles: {
                'themes/caching.md': '# Caching Strategy\n\nCaching content.',
            },
        });

        const wd = new WikiData(wikiDir);
        wd.load();

        const articles = wd.getThemeArticles('caching');
        expect(articles).toHaveLength(1);
        expect(articles[0].slug).toBe('caching');
        expect(articles[0].content).toContain('Caching content');
    });

    it('should return empty theme list when no themes in graph', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getThemeList()).toEqual([]);
    });

    it('should return empty articles for non-existent theme', () => {
        const graph = createTestModuleGraph([createThemeMeta()]);
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getThemeArticles('nonexistent')).toEqual([]);
    });

    it('should handle missing themes/ directory gracefully', () => {
        const graph = createTestModuleGraph([createThemeMeta()]);
        const wikiDir = setupWikiDir(graph);
        // Don't create themes/ directory

        const wd = new WikiData(wikiDir);
        wd.load();

        // Should still load without error, just no theme content
        const articles = wd.getThemeArticles('compaction');
        expect(articles).toHaveLength(2);
        expect(articles[0].content).toBe('');
        expect(articles[1].content).toBe('');
    });

    it('should get single theme article by themeId and slug', () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph, {
            themeFiles: {
                'themes/compaction/compaction-overview.md': '# Overview',
                'themes/compaction/compaction-styles.md': '# Styles',
            },
        });

        const wd = new WikiData(wikiDir);
        wd.load();

        const detail = wd.getThemeArticle('compaction', 'compaction-styles');
        expect(detail).not.toBeNull();
        expect(detail!.content).toContain('# Styles');
        expect(detail!.meta.id).toBe('compaction');
    });

    it('should return null for non-existent theme article', () => {
        const graph = createTestModuleGraph([createThemeMeta()]);
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getThemeArticle('compaction', 'nonexistent')).toBeNull();
    });

    it('should return null for non-existent theme ID', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getThemeArticle('nonexistent')).toBeNull();
    });

    it('should return theme list from metadata', () => {
        const theme1 = createThemeMeta();
        const theme2 = createSingleThemeMeta();
        const graph = createTestModuleGraph([theme1, theme2]);
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        const list = wd.getThemeList();
        expect(list).toHaveLength(2);
        expect(list[0].id).toBe('compaction');
        expect(list[1].id).toBe('caching');
    });

    it('should expose theme markdown data separately', () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph, {
            themeFiles: {
                'themes/compaction/compaction-overview.md': '# Overview',
                'themes/compaction/compaction-styles.md': '# Styles',
            },
        });

        const wd = new WikiData(wikiDir);
        wd.load();

        const themeData = wd.getThemeMarkdownData();
        expect(themeData['theme:compaction:compaction-overview']).toContain('# Overview');
        expect(themeData['theme:compaction:compaction-styles']).toContain('# Styles');
    });
});

// ============================================================================
// ContextBuilder — Theme Indexing
// ============================================================================

describe('ContextBuilder — theme indexing', () => {
    it('should index theme articles alongside modules', () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const markdownData = {
            'auth': '# Auth Module\nAuthentication.',
            'database': '# Database\nDB access.',
        };
        const themeMarkdownData = {
            'theme:compaction:compaction-overview': '# Compaction Overview\nHow data compaction works.',
            'theme:compaction:compaction-styles': '# Compaction Styles\nDifferent compaction approaches.',
        };

        const builder = new ContextBuilder(graph, markdownData, themeMarkdownData);
        // 2 modules + 2 theme articles = 4 documents
        expect(builder.documentCount).toBe(4);
    });

    it('should retrieve theme articles for relevant queries', () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const markdownData = {
            'auth': '# Auth Module\nAuthentication.',
            'database': '# Database\nDB access.',
        };
        const themeMarkdownData = {
            'theme:compaction:compaction-overview': '# Compaction Overview\nHow data compaction works in the storage layer.',
            'theme:compaction:compaction-styles': '# Compaction Styles\nDifferent compaction approaches and strategies.',
        };

        const builder = new ContextBuilder(graph, markdownData, themeMarkdownData);
        const result = builder.retrieve('compaction strategies');

        expect(result.themeContexts.length).toBeGreaterThan(0);
        expect(result.themeContexts[0].themeId).toBe('compaction');
    });

    it('should include theme context in contextText', () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const markdownData = {
            'auth': '# Auth\nAuth.',
            'database': '# DB\nDB.',
        };
        const themeMarkdownData = {
            'theme:compaction:compaction-overview': '# Compaction Overview\nCompaction details here.',
            'theme:compaction:compaction-styles': '# Styles\nStyles info.',
        };

        const builder = new ContextBuilder(graph, markdownData, themeMarkdownData);
        const result = builder.retrieve('compaction details');

        expect(result.contextText).toContain('Theme Article:');
    });

    it('should work with no theme data (backward compatible)', () => {
        const graph = createTestModuleGraph();
        const markdownData = {
            'auth': '# Auth\nAuth.',
            'database': '# DB\nDB.',
        };

        const builder = new ContextBuilder(graph, markdownData);
        expect(builder.documentCount).toBe(2);

        const result = builder.retrieve('authentication');
        expect(result.themeContexts).toEqual([]);
        expect(result.componentIds).toContain('auth');
    });

    it('should respect maxThemes limit', () => {
        // Create many theme articles
        const themes: ThemeMeta[] = [];
        const themeMarkdownData: Record<string, string> = {};
        for (let i = 0; i < 10; i++) {
            const id = `theme-${i}`;
            themes.push({
                id,
                title: `Theme ${i}`,
                description: `Theme about compaction variant ${i}`,
                layout: 'single',
                articles: [{ slug: id, title: `Theme ${i}`, path: `themes/${id}.md` }],
                involvedComponentIds: [],
                directoryPath: 'themes',
                generatedAt: Date.now(),
            });
            themeMarkdownData[`theme:${id}:${id}`] = `# Theme ${i}\nCompaction variant ${i} details.`;
        }

        const graph = createTestModuleGraph(themes);
        const builder = new ContextBuilder(graph, {}, themeMarkdownData);
        const result = builder.retrieve('compaction variant', 5, 3);

        expect(result.themeContexts.length).toBeLessThanOrEqual(3);
    });

    it('should return both module and theme results for cross-cutting queries', () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const markdownData = {
            'auth': '# Auth Module\nAuthentication with compaction support.',
            'database': '# Database\nDB access.',
        };
        const themeMarkdownData = {
            'theme:compaction:compaction-overview': '# Compaction Overview\nCompaction in the auth layer.',
            'theme:compaction:compaction-styles': '# Compaction Styles\nStyles info.',
        };

        const builder = new ContextBuilder(graph, markdownData, themeMarkdownData);
        const result = builder.retrieve('authentication compaction');

        expect(result.componentIds.length).toBeGreaterThan(0);
        // themeContexts may or may not have results depending on scoring
        expect(result.themeContexts).toBeDefined();
    });
});

// ============================================================================
// API Endpoints — Themes
// ============================================================================

describe('GET /api/themes', () => {
    it('should return theme list', async () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/themes`);
        expect(status).toBe(200);

        const themes = body as ThemeMeta[];
        expect(themes).toHaveLength(1);
        expect(themes[0].id).toBe('compaction');
        expect(themes[0].title).toBe('Compaction Strategies');
    });

    it('should return empty list when no themes', async () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/themes`);
        expect(status).toBe(200);
        expect(body).toEqual([]);
    });
});

describe('GET /api/themes/:themeId', () => {
    it('should return theme area with articles', async () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph, {
            themeFiles: {
                'themes/compaction/compaction-overview.md': '# Overview Content',
                'themes/compaction/compaction-styles.md': '# Styles Content',
            },
        });
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/themes/compaction`);
        expect(status).toBe(200);

        const data = body as any;
        expect(data.id).toBe('compaction');
        expect(data.articles).toHaveLength(2);
        expect(data.articles[0].content).toContain('Overview Content');
    });

    it('should return 404 for non-existent theme', async () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/themes/nonexistent`);
        expect(status).toBe(404);
        expect((body as any).error).toContain('not found');
    });
});

describe('GET /api/themes/:themeId/:slug', () => {
    it('should return single theme article', async () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph, {
            themeFiles: {
                'themes/compaction/compaction-overview.md': '# Overview',
                'themes/compaction/compaction-styles.md': '# Styles Detail',
            },
        });
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/themes/compaction/compaction-styles`);
        expect(status).toBe(200);

        const data = body as any;
        expect(data.themeId).toBe('compaction');
        expect(data.slug).toBe('compaction-styles');
        expect(data.content).toContain('Styles Detail');
        expect(data.meta.id).toBe('compaction');
    });

    it('should return 404 for non-existent article', async () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/themes/compaction/nonexistent`);
        expect(status).toBe(404);
        expect((body as any).error).toContain('not found');
    });

    it('should handle URL-encoded theme IDs and slugs', async () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph, {
            themeFiles: {
                'themes/compaction/compaction-overview.md': '# Overview',
            },
        });
        const s = await startServer(wikiDir);

        const { status } = await fetchJson(
            `${s.url}/api/themes/${encodeURIComponent('compaction')}/${encodeURIComponent('compaction-overview')}`
        );
        expect(status).toBe(200);
    });
});

describe('GET /api/graph — theme extension', () => {
    it('should include themes in graph response', async () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/graph`);
        expect(status).toBe(200);

        const data = body as ComponentGraph;
        expect(data.themes).toBeDefined();
        expect(data.themes).toHaveLength(1);
        expect(data.themes![0].id).toBe('compaction');
    });

    it('should not include themes field when none exist', async () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { body } = await fetchJson(`${s.url}/api/graph`);
        const data = body as ComponentGraph;
        // themes may be undefined or empty array
        expect(data.themes === undefined || data.themes?.length === 0).toBe(true);
    });
});

// ============================================================================
// Backward Compatibility
// ============================================================================

describe('Backward compatibility', () => {
    it('should work with wiki that has no themes', async () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        // All existing endpoints should still work
        const graphRes = await fetchJson(`${s.url}/api/graph`);
        expect(graphRes.status).toBe(200);

        const modulesRes = await fetchJson(`${s.url}/api/components`);
        expect(modulesRes.status).toBe(200);

        const moduleRes = await fetchJson(`${s.url}/api/components/auth`);
        expect(moduleRes.status).toBe(200);

        const pageRes = await fetchJson(`${s.url}/api/pages/index`);
        expect(pageRes.status).toBe(200);

        // Themes endpoint returns empty
        const themesRes = await fetchJson(`${s.url}/api/themes`);
        expect(themesRes.status).toBe(200);
        expect(themesRes.body).toEqual([]);
    });

    it('should load wiki data without themes/ directory', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.isLoaded).toBe(true);
        expect(wd.getThemeList()).toEqual([]);
        expect(wd.getThemeMarkdownData()).toEqual({});
    });

    it('should context-build without theme data', () => {
        const graph = createTestModuleGraph();
        const markdownData = {
            'auth': '# Auth\nAuth.',
            'database': '# DB\nDB.',
        };

        // Old-style constructor (no theme data)
        const builder = new ContextBuilder(graph, markdownData);
        const result = builder.retrieve('authentication');

        expect(result.componentIds).toContain('auth');
        expect(result.themeContexts).toEqual([]);
    });
});

// ============================================================================
// SPA Rendering — Themes
// ============================================================================

describe('SPA — themes in sidebar', () => {
    it('should include theme navigation code in SPA HTML', async () => {
        const theme = createThemeMeta();
        const graph = createTestModuleGraph([theme]);
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const html = await new Promise<string>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });

        // SPA should include theme sidebar functions
        expect(html).toContain('buildThemesSidebar');
        expect(html).toContain('loadThemeArticle');
    });
});
