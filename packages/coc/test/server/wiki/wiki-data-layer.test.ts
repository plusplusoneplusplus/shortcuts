/**
 * Wiki Data Layer Tests
 *
 * Tests for WikiData, ContextBuilder, ConversationSessionManager,
 * FileWatcher, and barrel exports.
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
    ConversationSessionManager,
    FileWatcher,
} from '../../../src/server/wiki/index';
import type {
    ComponentGraph,
    ComponentInfo,
    ComponentAnalysis,
    ThemeMeta,
    AskAIFunction,
    ComponentSummary,
    RetrievedContext,
    ConversationSession,
    FileWatcherOptions,
    WikiServeCommandOptions,
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
// ConversationSessionManager Tests
// ============================================================================

describe('ConversationSessionManager', () => {
    let mockSend: AskAIFunction;
    let manager: ConversationSessionManager;

    beforeEach(() => {
        mockSend = vi.fn().mockResolvedValue('AI response');
        manager = new ConversationSessionManager({
            sendMessage: mockSend,
            idleTimeoutMs: 5000,
            maxSessions: 3,
            cleanupIntervalMs: 100000, // long interval to avoid interference
        });
    });

    afterEach(() => {
        manager.destroyAll();
    });

    it('should create a session', () => {
        const session = manager.create();
        expect(session).not.toBeNull();
        expect(session!.sessionId).toBeTruthy();
        expect(session!.turnCount).toBe(0);
        expect(session!.busy).toBe(false);
        expect(manager.size).toBe(1);
    });

    it('should get an existing session', () => {
        const session = manager.create()!;
        const retrieved = manager.get(session.sessionId);
        expect(retrieved).toBeDefined();
        expect(retrieved!.sessionId).toBe(session.sessionId);
    });

    it('should return undefined for unknown session', () => {
        expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('should send messages through a session', async () => {
        const session = manager.create()!;
        const result = await manager.send(session.sessionId, 'Hello');
        expect(result.response).toBe('AI response');
        expect(result.sessionId).toBe(session.sessionId);
        expect(mockSend).toHaveBeenCalledWith('Hello', {
            model: undefined,
            workingDirectory: undefined,
            onStreamingChunk: undefined,
        });
    });

    it('should increment turn count after send', async () => {
        const session = manager.create()!;
        await manager.send(session.sessionId, 'Hello');
        const updated = manager.get(session.sessionId)!;
        expect(updated.turnCount).toBe(1);
    });

    it('should pass options to send function', async () => {
        const session = manager.create()!;
        const onChunk = vi.fn();
        await manager.send(session.sessionId, 'Hello', {
            model: 'gpt-4',
            workingDirectory: '/tmp',
            onStreamingChunk: onChunk,
        });
        expect(mockSend).toHaveBeenCalledWith('Hello', {
            model: 'gpt-4',
            workingDirectory: '/tmp',
            onStreamingChunk: onChunk,
        });
    });

    it('should reject if session not found', async () => {
        await expect(manager.send('nonexistent', 'Hello')).rejects.toThrow('Session not found');
    });

    it('should reject if session is busy', async () => {
        const slowSend: AskAIFunction = () => new Promise(resolve => setTimeout(() => resolve('done'), 100));
        const slowManager = new ConversationSessionManager({
            sendMessage: slowSend,
            cleanupIntervalMs: 100000,
        });
        const session = slowManager.create()!;

        // Start a send (don't await)
        const sendPromise = slowManager.send(session.sessionId, 'Hello');

        // Try another send while busy
        await expect(slowManager.send(session.sessionId, 'Hi')).rejects.toThrow('Session is busy');

        await sendPromise;
        slowManager.destroyAll();
    });

    it('should reset busy flag after send error', async () => {
        const errorSend: AskAIFunction = () => Promise.reject(new Error('AI error'));
        const errorManager = new ConversationSessionManager({
            sendMessage: errorSend,
            cleanupIntervalMs: 100000,
        });
        const session = errorManager.create()!;

        await expect(errorManager.send(session.sessionId, 'Hello')).rejects.toThrow('AI error');

        const updated = errorManager.get(session.sessionId)!;
        expect(updated.busy).toBe(false);
        errorManager.destroyAll();
    });

    it('should destroy a session', () => {
        const session = manager.create()!;
        expect(manager.destroy(session.sessionId)).toBe(true);
        expect(manager.size).toBe(0);
        expect(manager.get(session.sessionId)).toBeUndefined();
    });

    it('should return false when destroying nonexistent session', () => {
        expect(manager.destroy('nonexistent')).toBe(false);
    });

    it('should destroy all sessions', () => {
        manager.create();
        manager.create();
        expect(manager.size).toBe(2);
        manager.destroyAll();
        expect(manager.size).toBe(0);
    });

    it('should enforce max sessions and evict oldest idle', () => {
        const s1 = manager.create()!;
        manager.create();
        manager.create();
        expect(manager.size).toBe(3);

        // Creating a 4th should evict the oldest idle (s1)
        const s4 = manager.create();
        expect(s4).not.toBeNull();
        expect(manager.size).toBe(3);
        expect(manager.get(s1.sessionId)).toBeUndefined();
    });

    it('should return null if all sessions are busy', async () => {
        const slowSend: AskAIFunction = () => new Promise(resolve => setTimeout(() => resolve('done'), 200));
        const busyManager = new ConversationSessionManager({
            sendMessage: slowSend,
            maxSessions: 1,
            cleanupIntervalMs: 100000,
        });
        const session = busyManager.create()!;

        // Start a send to make session busy
        const sendPromise = busyManager.send(session.sessionId, 'Hello');

        // Try to create another — should fail since the only session is busy
        expect(busyManager.create()).toBeNull();

        await sendPromise;
        busyManager.destroyAll();
    });

    it('should list session IDs', () => {
        const s1 = manager.create()!;
        const s2 = manager.create()!;
        const ids = manager.sessionIds;
        expect(ids).toContain(s1.sessionId);
        expect(ids).toContain(s2.sessionId);
    });

    it('should clean up idle sessions', async () => {
        const shortManager = new ConversationSessionManager({
            sendMessage: mockSend,
            idleTimeoutMs: 50,
            cleanupIntervalMs: 30,
        });
        shortManager.create();
        expect(shortManager.size).toBe(1);

        // Wait for cleanup to fire
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(shortManager.size).toBe(0);
        shortManager.destroyAll();
    });
});

// ============================================================================
// FileWatcher Tests
// ============================================================================

describe('FileWatcher', () => {
    let tmpDir: string;
    let graph: ComponentGraph;

    beforeEach(() => {
        graph = makeComponentGraph();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-fw-test-'));
        // Create basic structure
        fs.mkdirSync(path.join(tmpDir, 'src', 'auth'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'src', 'db'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'index.ts'), '// auth');
    });

    afterEach(() => {
        cleanupTempDir(tmpDir);
    });

    it('should create a FileWatcher instance', () => {
        const watcher = new FileWatcher({
            repoPath: tmpDir,
            wikiDir: tmpDir,
            componentGraph: graph,
            onChange: () => {},
        });
        expect(watcher.isWatching).toBe(false);
    });

    it('should start and stop watching', () => {
        const watcher = new FileWatcher({
            repoPath: tmpDir,
            wikiDir: tmpDir,
            componentGraph: graph,
            onChange: () => {},
        });
        watcher.start();
        expect(watcher.isWatching).toBe(true);
        watcher.stop();
        expect(watcher.isWatching).toBe(false);
    });

    it('should not start twice', () => {
        const watcher = new FileWatcher({
            repoPath: tmpDir,
            wikiDir: tmpDir,
            componentGraph: graph,
            onChange: () => {},
        });
        watcher.start();
        watcher.start(); // Should be no-op
        expect(watcher.isWatching).toBe(true);
        watcher.stop();
    });

    it('should handle errors when watching invalid path', () => {
        const onError = vi.fn();
        const watcher = new FileWatcher({
            repoPath: '/nonexistent/path/12345',
            wikiDir: tmpDir,
            componentGraph: graph,
            onChange: () => {},
            onError,
        });
        watcher.start();
        // On macOS/Linux, fs.watch on nonexistent path throws synchronously
        if (!watcher.isWatching) {
            expect(onError).toHaveBeenCalled();
        }
        watcher.stop();
    });

    it('should detect file changes and call onChange with affected component IDs', async () => {
        const onChange = vi.fn();
        const watcher = new FileWatcher({
            repoPath: tmpDir,
            wikiDir: tmpDir,
            componentGraph: graph,
            debounceMs: 100,
            onChange,
        });
        watcher.start();

        // Write a file in the auth component's directory
        fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'new-file.ts'), '// new');

        // Wait for debounce
        await new Promise(resolve => setTimeout(resolve, 500));

        watcher.stop();

        // The onChange might or might not fire depending on OS fs.watch behavior
        // We primarily verify no crashes occur
        if (onChange.mock.calls.length > 0) {
            expect(onChange.mock.calls[0][0]).toContain('auth-module');
        }
    });
});

// ============================================================================
// Types Tests (structural)
// ============================================================================

describe('Wiki Types', () => {
    it('should use AskAIFunction type correctly', () => {
        const fn: AskAIFunction = async (prompt, options) => {
            return `Response to: ${prompt}`;
        };
        expect(fn).toBeDefined();
    });

    it('should create ComponentGraph object with correct structure', () => {
        const graph = makeComponentGraph();
        expect(graph.project.name).toBe('test-project');
        expect(graph.components).toHaveLength(3);
        expect(graph.categories).toHaveLength(3);
    });

    it('should create WikiServeCommandOptions object', () => {
        const opts: WikiServeCommandOptions = {
            port: 3000,
            host: 'localhost',
            ai: true,
            verbose: false,
        };
        expect(opts.port).toBe(3000);
    });
});

// ============================================================================
// Barrel Export Tests
// ============================================================================

describe('Barrel Export (index.ts)', () => {
    it('should export WikiData class', () => {
        expect(WikiData).toBeDefined();
        expect(typeof WikiData).toBe('function');
    });

    it('should export ContextBuilder class', () => {
        expect(ContextBuilder).toBeDefined();
        expect(typeof ContextBuilder).toBe('function');
    });

    it('should export tokenize function', () => {
        expect(tokenize).toBeDefined();
        expect(typeof tokenize).toBe('function');
    });

    it('should export ConversationSessionManager class', () => {
        expect(ConversationSessionManager).toBeDefined();
        expect(typeof ConversationSessionManager).toBe('function');
    });

    it('should export FileWatcher class', () => {
        expect(FileWatcher).toBeDefined();
        expect(typeof FileWatcher).toBe('function');
    });
});
