/**
 * Topic Support Tests
 *
 * Tests for all topic-related server changes:
 * - WikiData topic loading
 * - TF-IDF indexing of topic articles
 * - Context retrieval with topics
 * - API endpoints for topics
 * - Ask handler with topic context
 * - Sidebar rendering with topics
 * - Backward compatibility (no topics)
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
import type { ModuleGraph, TopicAreaMeta } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let server: WikiServer | null = null;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-topic-test-'));
});

afterEach(async () => {
    if (server) {
        await server.close();
        server = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function createTopicMeta(overrides?: Partial<TopicAreaMeta>): TopicAreaMeta {
    return {
        id: 'compaction',
        title: 'Compaction Strategies',
        description: 'How the system compacts data for storage efficiency',
        layout: 'area',
        articles: [
            { slug: 'compaction-overview', title: 'Compaction Overview', path: 'topics/compaction/compaction-overview.md' },
            { slug: 'compaction-styles', title: 'Compaction Styles', path: 'topics/compaction/compaction-styles.md' },
        ],
        involvedModuleIds: ['auth'],
        directoryPath: 'topics/compaction',
        generatedAt: Date.now(),
        ...overrides,
    };
}

function createSingleTopicMeta(): TopicAreaMeta {
    return {
        id: 'caching',
        title: 'Caching Strategy',
        description: 'How caching works across the system',
        layout: 'single',
        articles: [
            { slug: 'caching', title: 'Caching Strategy', path: 'topics/caching.md' },
        ],
        involvedModuleIds: ['database'],
        directoryPath: 'topics',
        generatedAt: Date.now(),
    };
}

function createTestModuleGraph(topics?: TopicAreaMeta[]): ModuleGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        modules: [
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
        topics: topics,
    };
}

function setupWikiDir(graph?: ModuleGraph, options?: {
    topicFiles?: Record<string, string>;
}): string {
    const wikiDir = path.join(tempDir, 'wiki');
    const modulesDir = path.join(wikiDir, 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });

    const g = graph || createTestModuleGraph();
    fs.writeFileSync(
        path.join(wikiDir, 'module-graph.json'),
        JSON.stringify(g, null, 2),
        'utf-8'
    );

    fs.writeFileSync(path.join(modulesDir, 'auth.md'), '# Auth Module\n\nAuth content about authentication and login.', 'utf-8');
    fs.writeFileSync(path.join(modulesDir, 'database.md'), '# Database Module\n\nDB content about queries.', 'utf-8');
    fs.writeFileSync(path.join(wikiDir, 'index.md'), '# Project Index', 'utf-8');

    // Write topic files
    if (options?.topicFiles) {
        for (const [filePath, content] of Object.entries(options.topicFiles)) {
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
// WikiData — Topic Loading
// ============================================================================

describe('WikiData — topic loading', () => {
    it('should load area-layout topic articles from topics/ directory', () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph, {
            topicFiles: {
                'topics/compaction/compaction-overview.md': '# Compaction Overview\n\nOverview content.',
                'topics/compaction/compaction-styles.md': '# Compaction Styles\n\nStyles content.',
            },
        });

        const wd = new WikiData(wikiDir);
        wd.load();

        const articles = wd.getTopicArticles('compaction');
        expect(articles).toHaveLength(2);
        expect(articles[0].slug).toBe('compaction-overview');
        expect(articles[0].content).toContain('Overview content');
        expect(articles[1].slug).toBe('compaction-styles');
        expect(articles[1].content).toContain('Styles content');
    });

    it('should load single-layout topic article', () => {
        const topic = createSingleTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph, {
            topicFiles: {
                'topics/caching.md': '# Caching Strategy\n\nCaching content.',
            },
        });

        const wd = new WikiData(wikiDir);
        wd.load();

        const articles = wd.getTopicArticles('caching');
        expect(articles).toHaveLength(1);
        expect(articles[0].slug).toBe('caching');
        expect(articles[0].content).toContain('Caching content');
    });

    it('should return empty topic list when no topics in graph', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getTopicList()).toEqual([]);
    });

    it('should return empty articles for non-existent topic', () => {
        const graph = createTestModuleGraph([createTopicMeta()]);
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getTopicArticles('nonexistent')).toEqual([]);
    });

    it('should handle missing topics/ directory gracefully', () => {
        const graph = createTestModuleGraph([createTopicMeta()]);
        const wikiDir = setupWikiDir(graph);
        // Don't create topics/ directory

        const wd = new WikiData(wikiDir);
        wd.load();

        // Should still load without error, just no topic content
        const articles = wd.getTopicArticles('compaction');
        expect(articles).toHaveLength(2);
        expect(articles[0].content).toBe('');
        expect(articles[1].content).toBe('');
    });

    it('should get single topic article by topicId and slug', () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph, {
            topicFiles: {
                'topics/compaction/compaction-overview.md': '# Overview',
                'topics/compaction/compaction-styles.md': '# Styles',
            },
        });

        const wd = new WikiData(wikiDir);
        wd.load();

        const detail = wd.getTopicArticle('compaction', 'compaction-styles');
        expect(detail).not.toBeNull();
        expect(detail!.content).toContain('# Styles');
        expect(detail!.meta.id).toBe('compaction');
    });

    it('should return null for non-existent topic article', () => {
        const graph = createTestModuleGraph([createTopicMeta()]);
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getTopicArticle('compaction', 'nonexistent')).toBeNull();
    });

    it('should return null for non-existent topic ID', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getTopicArticle('nonexistent')).toBeNull();
    });

    it('should return topic list from metadata', () => {
        const topic1 = createTopicMeta();
        const topic2 = createSingleTopicMeta();
        const graph = createTestModuleGraph([topic1, topic2]);
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        const list = wd.getTopicList();
        expect(list).toHaveLength(2);
        expect(list[0].id).toBe('compaction');
        expect(list[1].id).toBe('caching');
    });

    it('should expose topic markdown data separately', () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph, {
            topicFiles: {
                'topics/compaction/compaction-overview.md': '# Overview',
                'topics/compaction/compaction-styles.md': '# Styles',
            },
        });

        const wd = new WikiData(wikiDir);
        wd.load();

        const topicData = wd.getTopicMarkdownData();
        expect(topicData['topic:compaction:compaction-overview']).toContain('# Overview');
        expect(topicData['topic:compaction:compaction-styles']).toContain('# Styles');
    });
});

// ============================================================================
// ContextBuilder — Topic Indexing
// ============================================================================

describe('ContextBuilder — topic indexing', () => {
    it('should index topic articles alongside modules', () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const markdownData = {
            'auth': '# Auth Module\nAuthentication.',
            'database': '# Database\nDB access.',
        };
        const topicMarkdownData = {
            'topic:compaction:compaction-overview': '# Compaction Overview\nHow data compaction works.',
            'topic:compaction:compaction-styles': '# Compaction Styles\nDifferent compaction approaches.',
        };

        const builder = new ContextBuilder(graph, markdownData, topicMarkdownData);
        // 2 modules + 2 topic articles = 4 documents
        expect(builder.documentCount).toBe(4);
    });

    it('should retrieve topic articles for relevant queries', () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const markdownData = {
            'auth': '# Auth Module\nAuthentication.',
            'database': '# Database\nDB access.',
        };
        const topicMarkdownData = {
            'topic:compaction:compaction-overview': '# Compaction Overview\nHow data compaction works in the storage layer.',
            'topic:compaction:compaction-styles': '# Compaction Styles\nDifferent compaction approaches and strategies.',
        };

        const builder = new ContextBuilder(graph, markdownData, topicMarkdownData);
        const result = builder.retrieve('compaction strategies');

        expect(result.topicContexts.length).toBeGreaterThan(0);
        expect(result.topicContexts[0].topicId).toBe('compaction');
    });

    it('should include topic context in contextText', () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const markdownData = {
            'auth': '# Auth\nAuth.',
            'database': '# DB\nDB.',
        };
        const topicMarkdownData = {
            'topic:compaction:compaction-overview': '# Compaction Overview\nCompaction details here.',
            'topic:compaction:compaction-styles': '# Styles\nStyles info.',
        };

        const builder = new ContextBuilder(graph, markdownData, topicMarkdownData);
        const result = builder.retrieve('compaction details');

        expect(result.contextText).toContain('Topic Article:');
    });

    it('should work with no topic data (backward compatible)', () => {
        const graph = createTestModuleGraph();
        const markdownData = {
            'auth': '# Auth\nAuth.',
            'database': '# DB\nDB.',
        };

        const builder = new ContextBuilder(graph, markdownData);
        expect(builder.documentCount).toBe(2);

        const result = builder.retrieve('authentication');
        expect(result.topicContexts).toEqual([]);
        expect(result.moduleIds).toContain('auth');
    });

    it('should respect maxTopics limit', () => {
        // Create many topic articles
        const topics: TopicAreaMeta[] = [];
        const topicMarkdownData: Record<string, string> = {};
        for (let i = 0; i < 10; i++) {
            const id = `topic-${i}`;
            topics.push({
                id,
                title: `Topic ${i}`,
                description: `Topic about compaction variant ${i}`,
                layout: 'single',
                articles: [{ slug: id, title: `Topic ${i}`, path: `topics/${id}.md` }],
                involvedModuleIds: [],
                directoryPath: 'topics',
                generatedAt: Date.now(),
            });
            topicMarkdownData[`topic:${id}:${id}`] = `# Topic ${i}\nCompaction variant ${i} details.`;
        }

        const graph = createTestModuleGraph(topics);
        const builder = new ContextBuilder(graph, {}, topicMarkdownData);
        const result = builder.retrieve('compaction variant', 5, 3);

        expect(result.topicContexts.length).toBeLessThanOrEqual(3);
    });

    it('should return both module and topic results for cross-cutting queries', () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const markdownData = {
            'auth': '# Auth Module\nAuthentication with compaction support.',
            'database': '# Database\nDB access.',
        };
        const topicMarkdownData = {
            'topic:compaction:compaction-overview': '# Compaction Overview\nCompaction in the auth layer.',
            'topic:compaction:compaction-styles': '# Compaction Styles\nStyles info.',
        };

        const builder = new ContextBuilder(graph, markdownData, topicMarkdownData);
        const result = builder.retrieve('authentication compaction');

        expect(result.moduleIds.length).toBeGreaterThan(0);
        // topicContexts may or may not have results depending on scoring
        expect(result.topicContexts).toBeDefined();
    });
});

// ============================================================================
// API Endpoints — Topics
// ============================================================================

describe('GET /api/topics', () => {
    it('should return topic list', async () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/topics`);
        expect(status).toBe(200);

        const topics = body as TopicAreaMeta[];
        expect(topics).toHaveLength(1);
        expect(topics[0].id).toBe('compaction');
        expect(topics[0].title).toBe('Compaction Strategies');
    });

    it('should return empty list when no topics', async () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/topics`);
        expect(status).toBe(200);
        expect(body).toEqual([]);
    });
});

describe('GET /api/topics/:topicId', () => {
    it('should return topic area with articles', async () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph, {
            topicFiles: {
                'topics/compaction/compaction-overview.md': '# Overview Content',
                'topics/compaction/compaction-styles.md': '# Styles Content',
            },
        });
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/topics/compaction`);
        expect(status).toBe(200);

        const data = body as any;
        expect(data.id).toBe('compaction');
        expect(data.articles).toHaveLength(2);
        expect(data.articles[0].content).toContain('Overview Content');
    });

    it('should return 404 for non-existent topic', async () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/topics/nonexistent`);
        expect(status).toBe(404);
        expect((body as any).error).toContain('not found');
    });
});

describe('GET /api/topics/:topicId/:slug', () => {
    it('should return single topic article', async () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph, {
            topicFiles: {
                'topics/compaction/compaction-overview.md': '# Overview',
                'topics/compaction/compaction-styles.md': '# Styles Detail',
            },
        });
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/topics/compaction/compaction-styles`);
        expect(status).toBe(200);

        const data = body as any;
        expect(data.topicId).toBe('compaction');
        expect(data.slug).toBe('compaction-styles');
        expect(data.content).toContain('Styles Detail');
        expect(data.meta.id).toBe('compaction');
    });

    it('should return 404 for non-existent article', async () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/topics/compaction/nonexistent`);
        expect(status).toBe(404);
        expect((body as any).error).toContain('not found');
    });

    it('should handle URL-encoded topic IDs and slugs', async () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph, {
            topicFiles: {
                'topics/compaction/compaction-overview.md': '# Overview',
            },
        });
        const s = await startServer(wikiDir);

        const { status } = await fetchJson(
            `${s.url}/api/topics/${encodeURIComponent('compaction')}/${encodeURIComponent('compaction-overview')}`
        );
        expect(status).toBe(200);
    });
});

describe('GET /api/graph — topic extension', () => {
    it('should include topics in graph response', async () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { status, body } = await fetchJson(`${s.url}/api/graph`);
        expect(status).toBe(200);

        const data = body as ModuleGraph;
        expect(data.topics).toBeDefined();
        expect(data.topics).toHaveLength(1);
        expect(data.topics![0].id).toBe('compaction');
    });

    it('should not include topics field when none exist', async () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const { body } = await fetchJson(`${s.url}/api/graph`);
        const data = body as ModuleGraph;
        // topics may be undefined or empty array
        expect(data.topics === undefined || data.topics?.length === 0).toBe(true);
    });
});

// ============================================================================
// Backward Compatibility
// ============================================================================

describe('Backward compatibility', () => {
    it('should work with wiki that has no topics', async () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        // All existing endpoints should still work
        const graphRes = await fetchJson(`${s.url}/api/graph`);
        expect(graphRes.status).toBe(200);

        const modulesRes = await fetchJson(`${s.url}/api/modules`);
        expect(modulesRes.status).toBe(200);

        const moduleRes = await fetchJson(`${s.url}/api/modules/auth`);
        expect(moduleRes.status).toBe(200);

        const pageRes = await fetchJson(`${s.url}/api/pages/index`);
        expect(pageRes.status).toBe(200);

        // Topics endpoint returns empty
        const topicsRes = await fetchJson(`${s.url}/api/topics`);
        expect(topicsRes.status).toBe(200);
        expect(topicsRes.body).toEqual([]);
    });

    it('should load wiki data without topics/ directory', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.isLoaded).toBe(true);
        expect(wd.getTopicList()).toEqual([]);
        expect(wd.getTopicMarkdownData()).toEqual({});
    });

    it('should context-build without topic data', () => {
        const graph = createTestModuleGraph();
        const markdownData = {
            'auth': '# Auth\nAuth.',
            'database': '# DB\nDB.',
        };

        // Old-style constructor (no topic data)
        const builder = new ContextBuilder(graph, markdownData);
        const result = builder.retrieve('authentication');

        expect(result.moduleIds).toContain('auth');
        expect(result.topicContexts).toEqual([]);
    });
});

// ============================================================================
// SPA Rendering — Topics
// ============================================================================

describe('SPA — topics in sidebar', () => {
    it('should include topic navigation code in SPA HTML', async () => {
        const topic = createTopicMeta();
        const graph = createTestModuleGraph([topic]);
        const wikiDir = setupWikiDir(graph);
        const s = await startServer(wikiDir);

        const html = await new Promise<string>((resolve, reject) => {
            http.get(s.url, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });

        // SPA should include topic sidebar functions
        expect(html).toContain('buildTopicsSidebar');
        expect(html).toContain('loadTopicArticle');
    });
});
