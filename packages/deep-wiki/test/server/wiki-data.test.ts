/**
 * WikiData Tests
 *
 * Tests for the wiki data layer that reads and caches wiki data from disk.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WikiData } from '../../src/server/wiki-data';
import type { ComponentGraph, ComponentAnalysis } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-wikidata-test-'));
});

afterEach(() => {
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
            {
                id: 'utils',
                name: 'Utilities',
                path: 'src/utils/',
                purpose: 'Shared utility functions',
                keyFiles: ['src/utils/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'low',
                category: 'utility',
            },
        ],
        categories: [
            { name: 'core', description: 'Core functionality' },
            { name: 'utility', description: 'Utility modules' },
        ],
        architectureNotes: 'Layered architecture.',
    };
}

function setupWikiDir(graph?: ComponentGraph, markdownFiles?: Record<string, string>): string {
    const wikiDir = path.join(tempDir, 'wiki');
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });

    const g = graph || createTestModuleGraph();
    fs.writeFileSync(
        path.join(wikiDir, 'component-graph.json'),
        JSON.stringify(g, null, 2),
        'utf-8'
    );

    const defaultMarkdown: Record<string, string> = {
        auth: '# Auth Module\n\nHandles authentication.',
        database: '# Database Module\n\nDatabase access layer.',
        utils: '# Utilities\n\nShared utility functions.',
    };

    const files = markdownFiles || defaultMarkdown;
    for (const [id, content] of Object.entries(files)) {
        if (id.startsWith('__')) {
            const filename = id.replace(/^__/, '') + '.md';
            fs.writeFileSync(path.join(wikiDir, filename), content, 'utf-8');
        } else {
            fs.writeFileSync(path.join(componentsDir, `${id}.md`), content, 'utf-8');
        }
    }

    return wikiDir;
}

// ============================================================================
// Constructor & Loading
// ============================================================================

describe('WikiData', () => {
    describe('constructor', () => {
        it('should create a WikiData instance', () => {
            const wikiDir = setupWikiDir();
            const wd = new WikiData(wikiDir);
            expect(wd).toBeDefined();
        });

        it('should not be loaded until load() is called', () => {
            const wikiDir = setupWikiDir();
            const wd = new WikiData(wikiDir);
            expect(wd.isLoaded).toBe(false);
        });

        it('should resolve the wiki directory to absolute path', () => {
            const wikiDir = setupWikiDir();
            const relativePath = path.relative(process.cwd(), wikiDir);
            const wd = new WikiData(relativePath);
            expect(path.isAbsolute(wd.dir)).toBe(true);
        });
    });

    describe('load', () => {
        it('should load wiki data from disk', () => {
            const wikiDir = setupWikiDir();
            const wd = new WikiData(wikiDir);
            wd.load();
            expect(wd.isLoaded).toBe(true);
        });

        it('should throw when component-graph.json is missing', () => {
            const emptyDir = path.join(tempDir, 'empty');
            fs.mkdirSync(emptyDir, { recursive: true });
            const wd = new WikiData(emptyDir);
            expect(() => wd.load()).toThrow('component-graph.json not found');
        });

        it('should throw when component-graph.json is invalid JSON', () => {
            const badDir = path.join(tempDir, 'bad');
            fs.mkdirSync(badDir, { recursive: true });
            fs.writeFileSync(path.join(badDir, 'component-graph.json'), 'not json', 'utf-8');
            const wd = new WikiData(badDir);
            expect(() => wd.load()).toThrow();
        });
    });

    describe('reload', () => {
        it('should reload data from disk', () => {
            const wikiDir = setupWikiDir();
            const wd = new WikiData(wikiDir);
            wd.load();

            // Modify a file
            fs.writeFileSync(
                path.join(wikiDir, 'components', 'auth.md'),
                '# Auth Module v2',
                'utf-8'
            );

            wd.reload();
            const detail = wd.getComponentDetail('auth');
            expect(detail?.markdown).toContain('v2');
        });
    });
});

// ============================================================================
// Graph Access
// ============================================================================

describe('WikiData — graph', () => {
    it('should return the component graph', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.graph.project.name).toBe('TestProject');
        expect(wd.graph.components).toHaveLength(3);
    });

    it('should throw when accessed before load', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        expect(() => wd.graph).toThrow('Wiki data not loaded');
    });
});

// ============================================================================
// Module Summaries
// ============================================================================

describe('WikiData — getComponentSummaries', () => {
    it('should return summaries for all components', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        const summaries = wd.getComponentSummaries();
        expect(summaries).toHaveLength(3);
    });

    it('should include id, name, category, complexity, path, purpose', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        const summaries = wd.getComponentSummaries();
        const auth = summaries.find(s => s.id === 'auth');
        expect(auth).toBeDefined();
        expect(auth!.name).toBe('Auth Module');
        expect(auth!.category).toBe('core');
        expect(auth!.complexity).toBe('high');
        expect(auth!.path).toBe('src/auth/');
        expect(auth!.purpose).toBe('Handles authentication');
    });
});

// ============================================================================
// Module Detail
// ============================================================================

describe('WikiData — getComponentDetail', () => {
    it('should return detail for an existing component', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        const detail = wd.getComponentDetail('auth');
        expect(detail).not.toBeNull();
        expect(detail!.component.id).toBe('auth');
        expect(detail!.markdown).toContain('# Auth Module');
    });

    it('should return null for non-existent component', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        const detail = wd.getComponentDetail('nonexistent');
        expect(detail).toBeNull();
    });

    it('should return empty markdown when .md file is missing', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph, { auth: '# Auth' });
        const wd = new WikiData(wikiDir);
        wd.load();

        // 'database' component exists in graph but no .md file
        const detail = wd.getComponentDetail('database');
        expect(detail).not.toBeNull();
        expect(detail!.markdown).toBe('');
    });

    it('should include component info from graph', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        const detail = wd.getComponentDetail('auth');
        expect(detail!.component.dependencies).toEqual(['database']);
        expect(detail!.component.dependents).toEqual(['api']);
    });
});

// ============================================================================
// Special Pages
// ============================================================================

describe('WikiData — getSpecialPage', () => {
    it('should return index page', () => {
        const wikiDir = setupWikiDir(undefined, {
            auth: '# Auth',
            __index: '# Project Index',
        });
        const wd = new WikiData(wikiDir);
        wd.load();

        const page = wd.getSpecialPage('index');
        expect(page).not.toBeNull();
        expect(page!.key).toBe('index');
        expect(page!.title).toBe('Index');
        expect(page!.markdown).toContain('# Project Index');
    });

    it('should return architecture page', () => {
        const wikiDir = setupWikiDir(undefined, {
            auth: '# Auth',
            __architecture: '# Architecture Overview',
        });
        const wd = new WikiData(wikiDir);
        wd.load();

        const page = wd.getSpecialPage('architecture');
        expect(page).not.toBeNull();
        expect(page!.title).toBe('Architecture');
    });

    it('should return getting-started page', () => {
        const wikiDir = setupWikiDir(undefined, {
            auth: '# Auth',
            '__getting-started': '# Getting Started',
        });
        const wd = new WikiData(wikiDir);
        wd.load();

        const page = wd.getSpecialPage('getting-started');
        expect(page).not.toBeNull();
        expect(page!.title).toBe('Getting Started');
    });

    it('should return null for non-existent page', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        const page = wd.getSpecialPage('nonexistent');
        expect(page).toBeNull();
    });
});

// ============================================================================
// Markdown Data
// ============================================================================

describe('WikiData — getMarkdownData', () => {
    it('should return all markdown content', () => {
        const wikiDir = setupWikiDir(undefined, {
            auth: '# Auth',
            database: '# DB',
            __index: '# Index',
        });
        const wd = new WikiData(wikiDir);
        wd.load();

        const data = wd.getMarkdownData();
        expect(data['auth']).toContain('# Auth');
        expect(data['database']).toContain('# DB');
        expect(data['__index']).toContain('# Index');
    });

    it('should return a copy (not the internal reference)', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        const data1 = wd.getMarkdownData();
        const data2 = wd.getMarkdownData();
        expect(data1).not.toBe(data2);
        expect(data1).toEqual(data2);
    });
});

// ============================================================================
// Hierarchical Layout
// ============================================================================

describe('WikiData — hierarchical layout', () => {
    it('should read area-level markdown files', () => {
        const graph: ComponentGraph = {
            ...createTestModuleGraph(),
            domains: [
                { id: 'core', name: 'Core', path: 'src/core/', description: 'Core area', components: ['auth'] },
            ],
        };

        const wikiDir = path.join(tempDir, 'hierarchical');
        const domainComponentsDir = path.join(wikiDir, 'domains', 'core', 'components');
        fs.mkdirSync(domainComponentsDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'component-graph.json'),
            JSON.stringify(graph),
            'utf-8'
        );
        fs.writeFileSync(path.join(domainComponentsDir, 'auth.md'), '# Area Auth', 'utf-8');
        fs.writeFileSync(path.join(wikiDir, 'domains', 'core', 'index.md'), '# Core Index', 'utf-8');

        const wd = new WikiData(wikiDir);
        wd.load();

        const data = wd.getMarkdownData();
        expect(data['auth']).toContain('# Area Auth');
        expect(data['__domain_core_index']).toContain('# Core Index');
    });
});

// ============================================================================
// Analysis Loading
// ============================================================================

describe('WikiData — analysis loading', () => {
    it('should handle missing cache directory gracefully', () => {
        const wikiDir = setupWikiDir();
        const wd = new WikiData(wikiDir);
        wd.load();

        const detail = wd.getComponentDetail('auth');
        expect(detail).not.toBeNull();
        expect(detail!.analysis).toBeUndefined();
    });

    it('should load cached analyses when present', () => {
        const wikiDir = setupWikiDir();

        // Create cache directory with an analysis
        const cacheDir = path.join(wikiDir, '.wiki-cache', 'analyses');
        fs.mkdirSync(cacheDir, { recursive: true });

        const analysis: ComponentAnalysis = {
            componentId: 'auth',
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

        fs.writeFileSync(
            path.join(cacheDir, 'auth.json'),
            JSON.stringify({ analysis, gitHash: 'abc123', timestamp: Date.now() }),
            'utf-8'
        );

        const wd = new WikiData(wikiDir);
        wd.load();

        const detail = wd.getComponentDetail('auth');
        expect(detail).not.toBeNull();
        expect(detail!.analysis).toBeDefined();
        expect(detail!.analysis!.overview).toBe('Auth overview');
    });

    it('should skip invalid analysis files', () => {
        const wikiDir = setupWikiDir();
        const cacheDir = path.join(wikiDir, '.wiki-cache', 'analyses');
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, 'bad.json'), 'not json', 'utf-8');

        const wd = new WikiData(wikiDir);
        // Should not throw
        wd.load();
        expect(wd.isLoaded).toBe(true);
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('WikiData — edge cases', () => {
    it('should handle empty components directory', () => {
        const graph = createTestModuleGraph();
        const wikiDir = path.join(tempDir, 'empty-modules');
        fs.mkdirSync(path.join(wikiDir, 'components'), { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'component-graph.json'),
            JSON.stringify(graph),
            'utf-8'
        );

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getComponentSummaries()).toHaveLength(3);
        expect(wd.getComponentDetail('auth')!.markdown).toBe('');
    });

    it('should handle no components directory at all', () => {
        const graph = createTestModuleGraph();
        const wikiDir = path.join(tempDir, 'no-modules');
        fs.mkdirSync(wikiDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'component-graph.json'),
            JSON.stringify(graph),
            'utf-8'
        );

        const wd = new WikiData(wikiDir);
        wd.load();

        const data = wd.getMarkdownData();
        expect(Object.keys(data)).toHaveLength(0);
    });

    it('should handle graph with no components', () => {
        const graph: ComponentGraph = {
            project: {
                name: 'Empty',
                description: 'Empty project',
                language: 'TypeScript',
                buildSystem: 'npm',
                entryPoints: [],
            },
            components: [],
            categories: [],
            architectureNotes: '',
        };

        const wikiDir = path.join(tempDir, 'empty-graph');
        fs.mkdirSync(wikiDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'component-graph.json'),
            JSON.stringify(graph),
            'utf-8'
        );

        const wd = new WikiData(wikiDir);
        wd.load();

        expect(wd.getComponentSummaries()).toHaveLength(0);
    });
});
