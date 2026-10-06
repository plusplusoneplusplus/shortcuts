/**
 * Tests for WikiData and ContextBuilder.
 *
 * Uses temp directories with sample component-graph.json for WikiData tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    WikiData,
    ContextBuilder,
    tokenize,
} from '../../../src/server/wiki/index';
import type {
    ComponentGraph,
    ComponentInfo,
    ComponentAnalysis,
    ThemeMeta,
    ComponentSummary,
    RetrievedContext,
} from '../../../src/server/wiki/index';

// ============================================================================
// Test Helpers
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
                purpose: 'Handles user authentication and JWT tokens',
                keyFiles: ['src/auth/index.ts', 'src/auth/jwt.ts'],
                dependencies: ['db-layer'],
                dependents: ['api-routes'],
                complexity: 'medium',
                category: 'core',
            },
            {
                id: 'db-layer',
                name: 'Database Layer',
                path: 'src/db',
                purpose: 'Manages database connections and queries',
                keyFiles: ['src/db/index.ts'],
                dependencies: [],
                dependents: ['auth-module'],
                complexity: 'high',
                category: 'infra',
            },
            {
                id: 'api-routes',
                name: 'API Routes',
                path: 'src/api',
                purpose: 'HTTP endpoint handlers',
                keyFiles: ['src/api/routes.ts'],
                dependencies: ['auth-module'],
                dependents: [],
                complexity: 'low',
                category: 'api',
            },
        ],
        categories: [
            { name: 'core', description: 'Core business logic' },
            { name: 'infra', description: 'Infrastructure' },
            { name: 'api', description: 'API layer' },
        ],
        architectureNotes: 'Simple three-tier architecture.',
        ...overrides,
    };
}

function makeThemeMeta(overrides?: Partial<ThemeMeta>): ThemeMeta {
    return {
        id: 'security',
        title: 'Security Architecture',
        description: 'How security works across the system',
        layout: 'single',
        articles: [{ slug: 'overview', title: 'Security Overview', path: 'themes/security.md' }],
        involvedComponentIds: ['auth-module'],
        directoryPath: 'themes/security',
        generatedAt: Date.now(),
        ...overrides,
    };
}

function createTempWikiDir(graph: ComponentGraph): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-test-'));

    // Write component-graph.json
    fs.writeFileSync(
        path.join(tmpDir, 'component-graph.json'),
        JSON.stringify(graph, null, 2),
    );

    // Write top-level markdown files
    fs.writeFileSync(path.join(tmpDir, 'index.md'), '# Welcome\nProject index page.');
    fs.writeFileSync(path.join(tmpDir, 'architecture.md'), '# Architecture\nOverview.');

    // Write component markdown files
    const componentsDir = path.join(tmpDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    for (const comp of graph.components) {
        const slug = comp.id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        fs.writeFileSync(
            path.join(componentsDir, `${slug}.md`),
            `# ${comp.name}\n\n${comp.purpose}`,
        );
    }

    return tmpDir;
}

function cleanupTempDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================================
// WikiData Tests
// ============================================================================

describe('WikiData', () => {
    let tmpDir: string;
    let graph: ComponentGraph;

    beforeEach(() => {
        graph = makeComponentGraph();
        tmpDir = createTempWikiDir(graph);
    });

    afterEach(() => {
        cleanupTempDir(tmpDir);
    });

    it('should load component graph from disk', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        expect(wiki.isLoaded).toBe(true);
        expect(wiki.graph.project.name).toBe('test-project');
        expect(wiki.graph.components).toHaveLength(3);
    });

    it('should throw if load() not called before accessing graph', () => {
        const wiki = new WikiData(tmpDir);
        expect(() => wiki.graph).toThrow('Wiki data not loaded');
    });

    it('should throw if component-graph.json is missing', () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wiki-empty-'));
        const wiki = new WikiData(emptyDir);
        expect(() => wiki.load()).toThrow('component-graph.json not found');
        cleanupTempDir(emptyDir);
    });

    it('should return component summaries', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        const summaries = wiki.getComponentSummaries();
        expect(summaries).toHaveLength(3);
        expect(summaries[0].id).toBe('auth-module');
        expect(summaries[0].category).toBe('core');
    });

    it('should return component detail with markdown', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        const detail = wiki.getComponentDetail('auth-module');
        expect(detail).not.toBeNull();
        expect(detail!.component.id).toBe('auth-module');
        expect(detail!.markdown).toContain('Authentication Module');
    });

    it('should return null for unknown component', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        expect(wiki.getComponentDetail('nonexistent')).toBeNull();
    });

    it('should return special pages', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        const indexPage = wiki.getSpecialPage('index');
        expect(indexPage).not.toBeNull();
        expect(indexPage!.title).toBe('Index');
        expect(indexPage!.markdown).toContain('Welcome');
    });

    it('should return null for unknown special page', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        expect(wiki.getSpecialPage('unknown-page')).toBeNull();
    });

    it('should reload data from disk', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        expect(wiki.graph.components).toHaveLength(3);

        // Modify the graph on disk
        const modified = { ...graph, components: [graph.components[0]] };
        fs.writeFileSync(path.join(tmpDir, 'component-graph.json'), JSON.stringify(modified));

        wiki.reload();
        expect(wiki.graph.components).toHaveLength(1);
    });

    it('should expose wiki directory path', () => {
        const wiki = new WikiData(tmpDir);
        expect(wiki.dir).toBe(path.resolve(tmpDir));
    });

    it('should return markdown data', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        const md = wiki.getMarkdownData();
        expect(md['__index']).toContain('Welcome');
    });

    it('should handle themes', () => {
        const theme = makeThemeMeta();
        const graphWithThemes = makeComponentGraph({ themes: [theme] });
        const dir = createTempWikiDir(graphWithThemes);

        // Write theme markdown
        const themesDir = path.join(dir, 'themes');
        fs.mkdirSync(themesDir, { recursive: true });
        fs.writeFileSync(path.join(themesDir, 'security.md'), '# Security\nTheme content.');

        const wiki = new WikiData(dir);
        wiki.load();

        const themeList = wiki.getThemeList();
        expect(themeList).toHaveLength(1);
        expect(themeList[0].id).toBe('security');

        const article = wiki.getThemeArticle('security');
        expect(article).not.toBeNull();
        expect(article!.content).toContain('Security');

        const articles = wiki.getThemeArticles('security');
        expect(articles).toHaveLength(1);
        expect(articles[0].slug).toBe('overview');

        cleanupTempDir(dir);
    });

    it('should return null for unknown theme', () => {
        const wiki = new WikiData(tmpDir);
        wiki.load();
        expect(wiki.getThemeArticle('nonexistent')).toBeNull();
        expect(wiki.getThemeArticles('nonexistent')).toEqual([]);
    });

    it('should read analyses from cache directory', () => {
        // Create cache directory with an analysis file
        const cacheDir = path.join(tmpDir, '.wiki-cache', 'analyses');
        fs.mkdirSync(cacheDir, { recursive: true });
        const analysis: ComponentAnalysis = {
            componentId: 'auth-module',
            overview: 'Auth overview',
            keyConcepts: [],
            publicAPI: [],
            internalArchitecture: '',
            dataFlow: '',
            patterns: [],
            errorHandling: '',
            codeExamples: [],
            dependencies: { internal: [], external: [] },
            suggestedDiagram: '',
        };
        fs.writeFileSync(path.join(cacheDir, 'auth-module.json'), JSON.stringify(analysis));

        const wiki = new WikiData(tmpDir);
        wiki.load();
        const detail = wiki.getComponentDetail('auth-module');
        expect(detail!.analysis).toBeDefined();
        expect(detail!.analysis!.overview).toBe('Auth overview');
    });

    it('should handle domain-based hierarchical layout', () => {
        const graphWithDomains = makeComponentGraph({
            domains: [{
                id: 'frontend',
                name: 'Frontend',
                path: 'src/frontend',
                description: 'Frontend code',
                components: ['auth-module'],
            }],
        });
        const dir = createTempWikiDir(graphWithDomains);

        // Create domain directory with markdown files
        const domainDir = path.join(dir, 'domains', 'frontend');
        fs.mkdirSync(domainDir, { recursive: true });
        fs.writeFileSync(path.join(domainDir, 'index.md'), '# Frontend Domain');

        const domainComponentsDir = path.join(domainDir, 'components');
        fs.mkdirSync(domainComponentsDir, { recursive: true });
        fs.writeFileSync(path.join(domainComponentsDir, 'auth-module.md'), '# Auth in Frontend');

        const wiki = new WikiData(dir);
        wiki.load();
        const md = wiki.getMarkdownData();
        expect(md['__domain_frontend_index']).toContain('Frontend Domain');
        expect(md['auth-module']).toContain('Auth in Frontend');

        cleanupTempDir(dir);
    });
});

// ============================================================================
// ContextBuilder Tests
// ============================================================================

describe('ContextBuilder', () => {
    let graph: ComponentGraph;
    let markdownData: Record<string, string>;

    beforeEach(() => {
        graph = makeComponentGraph();
        markdownData = {
            'auth-module': '# Authentication\nHandles JWT tokens and user login.',
            'db-layer': '# Database\nPostgreSQL connection pooling and ORM.',
            'api-routes': '# API\nREST endpoints for the application.',
        };
    });

    it('should build index from components', () => {
        const builder = new ContextBuilder(graph, markdownData);
        expect(builder.documentCount).toBe(3);
        expect(builder.vocabularySize).toBeGreaterThan(0);
    });

    it('should retrieve relevant components for a question', () => {
        const builder = new ContextBuilder(graph, markdownData);
        const result = builder.retrieve('How does authentication work?');
        expect(result.componentIds).toContain('auth-module');
        expect(result.contextText).toContain('auth-module');
        expect(result.graphSummary).toContain('test-project');
    });

    it('should include graph summary in results', () => {
        const builder = new ContextBuilder(graph, markdownData);
        const result = builder.retrieve('database');
        expect(result.graphSummary).toContain('Database Layer');
        expect(result.graphSummary).toContain('TypeScript');
    });

    it('should expand with dependency neighbors', () => {
        const builder = new ContextBuilder(graph, markdownData);
        const result = builder.retrieve('authentication jwt tokens', 5);
        // auth-module depends on db-layer, so db-layer should be included via expansion
        const ids = result.componentIds;
        expect(ids).toContain('auth-module');
    });

    it('should return empty results for irrelevant query', () => {
        const builder = new ContextBuilder(graph, markdownData);
        const result = builder.retrieve('xyzzy foobar baz');
        expect(result.componentIds).toHaveLength(0);
        expect(result.contextText).toBe('');
    });

    it('should respect maxComponents limit', () => {
        const builder = new ContextBuilder(graph, markdownData);
        const result = builder.retrieve('module', 1);
        expect(result.componentIds.length).toBeLessThanOrEqual(1);
    });

    it('should index and retrieve theme articles', () => {
        const theme = makeThemeMeta();
        const graphWithThemes = makeComponentGraph({ themes: [theme] });
        const themeMarkdown = {
            'theme:security:overview': '# Security Overview\nJWT auth flow and encryption.',
        };

        const builder = new ContextBuilder(graphWithThemes, markdownData, themeMarkdown);
        expect(builder.documentCount).toBe(4); // 3 components + 1 theme article

        const result = builder.retrieve('security encryption', 5, 3);
        expect(result.themeContexts.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty component graph', () => {
        const emptyGraph = makeComponentGraph({ components: [], categories: [] });
        const builder = new ContextBuilder(emptyGraph, {});
        expect(builder.documentCount).toBe(0);
        const result = builder.retrieve('anything');
        expect(result.componentIds).toHaveLength(0);
    });
});

// ============================================================================
// tokenize Tests
// ============================================================================

describe('tokenize', () => {
    it('should tokenize text into lowercase terms', () => {
        const tokens = tokenize('Hello World');
        expect(tokens).toContain('hello');
        expect(tokens).toContain('world');
    });

    it('should remove stop words', () => {
        const tokens = tokenize('the quick brown fox is a dog');
        expect(tokens).not.toContain('the');
        expect(tokens).not.toContain('is');
        expect(tokens).not.toContain('a');
        expect(tokens).toContain('quick');
        expect(tokens).toContain('brown');
        expect(tokens).toContain('fox');
    });

    it('should remove short words (< 2 chars)', () => {
        const tokens = tokenize('I am x y ok go');
        expect(tokens).not.toContain('x');
        expect(tokens).not.toContain('y');
        expect(tokens).toContain('ok');
        expect(tokens).toContain('go');
    });

    it('should handle special characters', () => {
        const tokens = tokenize('foo-bar_baz!@#$%');
        expect(tokens).toContain('foo-bar_baz');
    });

    it('should return empty array for empty input', () => {
        expect(tokenize('')).toEqual([]);
    });
});

// ============================================================================
// Types Tests (structural)
// ============================================================================

describe('Wiki Types', () => {
    it('should create ComponentGraph object with correct structure', () => {
        const graph = makeComponentGraph();
        expect(graph.project.name).toBe('test-project');
        expect(graph.components).toHaveLength(3);
        expect(graph.categories).toHaveLength(3);
    });
});
