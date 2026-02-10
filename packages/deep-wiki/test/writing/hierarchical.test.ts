/**
 * Hierarchical Wiki Output Tests
 *
 * Tests for 3-level hierarchical wiki output for large repos:
 * - Area-aware cross-link generation
 * - Hierarchical file writer (area directory creation + path routing)
 * - Area reduce prompt template
 * - Static fallback generation for areas
 * - Backward compat: small repo still produces flat layout
 * - Integration-level: graph with areas → hierarchical articles + file layout
 * - Integration-level: graph without areas → flat layout (unchanged)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
    ModuleGraph,
    ModuleAnalysis,
    GeneratedArticle,
    WikiOutput,
    AreaInfo,
} from '../../src/types';
import {
    buildModuleArticlePromptTemplate,
    buildCrossLinkRules,
    buildSimplifiedGraph,
} from '../../src/writing/prompts';
import {
    buildAreaReducePromptTemplate,
    getAreaReduceOutputFields,
    buildHierarchicalReducePromptTemplate,
} from '../../src/writing/reduce-prompts';
import {
    writeWikiOutput,
    getArticleFilePath,
} from '../../src/writing/file-writer';
import {
    generateStaticAreaPages,
    generateStaticHierarchicalIndexPages,
    generateStaticIndexPages,
    analysisToPromptItem,
    groupAnalysesByArea,
} from '../../src/writing/article-executor';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-hierarchical-test-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function createSmallGraph(): ModuleGraph {
    return {
        project: {
            name: 'SmallProject',
            description: 'A small project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        modules: [
            {
                id: 'auth',
                name: 'Auth Module',
                path: 'src/auth/',
                purpose: 'Authentication',
                keyFiles: ['src/auth/index.ts'],
                dependencies: ['database'],
                dependents: [],
                complexity: 'medium' as const,
                category: 'core',
            },
            {
                id: 'database',
                name: 'Database Module',
                path: 'src/db/',
                purpose: 'Data access',
                keyFiles: ['src/db/index.ts'],
                dependencies: [],
                dependents: ['auth'],
                complexity: 'medium' as const,
                category: 'infrastructure',
            },
        ],
        categories: [
            { name: 'core', description: 'Core modules' },
            { name: 'infrastructure', description: 'Infrastructure' },
        ],
        architectureNotes: 'Simple layered architecture',
    };
}

function createLargeGraph(): ModuleGraph {
    const areas: AreaInfo[] = [
        {
            id: 'packages-core',
            name: 'packages/core',
            path: 'packages/core',
            description: 'Core library modules',
            modules: ['core-auth', 'core-database'],
        },
        {
            id: 'packages-api',
            name: 'packages/api',
            path: 'packages/api',
            description: 'API layer modules',
            modules: ['api-routes', 'api-middleware'],
        },
    ];

    return {
        project: {
            name: 'LargeProject',
            description: 'A large monorepo project',
            language: 'TypeScript',
            buildSystem: 'npm + turbo',
            entryPoints: ['packages/core/src/index.ts'],
        },
        modules: [
            {
                id: 'core-auth',
                name: 'Core Auth',
                path: 'packages/core/auth/',
                purpose: 'Authentication primitives',
                keyFiles: ['packages/core/auth/index.ts'],
                dependencies: ['core-database'],
                dependents: ['api-middleware'],
                complexity: 'high' as const,
                category: 'security',
                area: 'packages-core',
            },
            {
                id: 'core-database',
                name: 'Core Database',
                path: 'packages/core/db/',
                purpose: 'Database access layer',
                keyFiles: ['packages/core/db/index.ts'],
                dependencies: [],
                dependents: ['core-auth'],
                complexity: 'medium' as const,
                category: 'infrastructure',
                area: 'packages-core',
            },
            {
                id: 'api-routes',
                name: 'API Routes',
                path: 'packages/api/routes/',
                purpose: 'HTTP route definitions',
                keyFiles: ['packages/api/routes/index.ts'],
                dependencies: ['api-middleware'],
                dependents: [],
                complexity: 'medium' as const,
                category: 'api',
                area: 'packages-api',
            },
            {
                id: 'api-middleware',
                name: 'API Middleware',
                path: 'packages/api/middleware/',
                purpose: 'Request processing middleware',
                keyFiles: ['packages/api/middleware/index.ts'],
                dependencies: ['core-auth'],
                dependents: ['api-routes'],
                complexity: 'medium' as const,
                category: 'api',
                area: 'packages-api',
            },
        ],
        categories: [
            { name: 'security', description: 'Security modules' },
            { name: 'infrastructure', description: 'Infrastructure' },
            { name: 'api', description: 'API layer' },
        ],
        architectureNotes: 'Monorepo with packages/core and packages/api areas',
        areas,
    };
}

function createTestAnalysis(moduleId: string): ModuleAnalysis {
    return {
        moduleId,
        overview: `Overview of ${moduleId} module.`,
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
}

// ============================================================================
// Cross-Link Rules
// ============================================================================

describe('buildCrossLinkRules', () => {
    it('should produce flat cross-link rules when no areaId', () => {
        const rules = buildCrossLinkRules();
        expect(rules).toContain('./modules/module-id.md');
        expect(rules).not.toContain('areas/');
    });

    it('should produce hierarchical cross-link rules when areaId provided', () => {
        const rules = buildCrossLinkRules('packages-core');
        expect(rules).toContain('areas/packages-core/modules/');
        expect(rules).toContain('../../other-area-id/modules/module-id.md');
        expect(rules).toContain('Area Index');
        expect(rules).toContain('Project Index');
    });

    it('should include the specific area ID in the location context', () => {
        const rules = buildCrossLinkRules('my-area');
        expect(rules).toContain('areas/my-area/modules/');
    });
});

// ============================================================================
// Prompt Template with Area Context
// ============================================================================

describe('buildModuleArticlePromptTemplate with area', () => {
    it('should produce flat cross-links by default', () => {
        const template = buildModuleArticlePromptTemplate('normal');
        expect(template).toContain('./modules/module-id.md');
        expect(template).not.toContain('../../other-area-id');
    });

    it('should produce hierarchical cross-links when areaId provided', () => {
        const template = buildModuleArticlePromptTemplate('normal', 'packages-core');
        expect(template).toContain('areas/packages-core/modules/');
        expect(template).toContain('../../other-area-id/modules/module-id.md');
    });

    it('should still contain template variables when area is provided', () => {
        const template = buildModuleArticlePromptTemplate('normal', 'my-area');
        expect(template).toContain('{{moduleName}}');
        expect(template).toContain('{{analysis}}');
        expect(template).toContain('{{moduleGraph}}');
    });

    it('should vary by depth even with area', () => {
        const shallow = buildModuleArticlePromptTemplate('shallow', 'area-1');
        const deep = buildModuleArticlePromptTemplate('deep', 'area-1');
        expect(shallow).toContain('concise');
        expect(deep).toContain('thorough');
    });
});

// ============================================================================
// Area Reduce Prompt Template
// ============================================================================

describe('buildAreaReducePromptTemplate', () => {
    it('should contain area-specific template variables', () => {
        const template = buildAreaReducePromptTemplate();
        expect(template).toContain('{{areaName}}');
        expect(template).toContain('{{areaDescription}}');
        expect(template).toContain('{{areaPath}}');
        expect(template).toContain('{{projectName}}');
    });

    it('should request index and architecture pages', () => {
        const template = buildAreaReducePromptTemplate();
        expect(template).toContain('index.md');
        expect(template).toContain('architecture.md');
    });

    it('should instruct area-relative module links', () => {
        const template = buildAreaReducePromptTemplate();
        expect(template).toContain('./modules/module-id.md');
    });

    it('should include cross-area linking instructions', () => {
        const template = buildAreaReducePromptTemplate();
        expect(template).toContain('../../other-area-id/modules/module-id.md');
    });

    it('should request JSON output with two fields', () => {
        const template = buildAreaReducePromptTemplate();
        expect(template).toContain('"index"');
        expect(template).toContain('"architecture"');
    });
});

describe('getAreaReduceOutputFields', () => {
    it('should return index and architecture', () => {
        const fields = getAreaReduceOutputFields();
        expect(fields).toEqual(['index', 'architecture']);
    });
});

// ============================================================================
// Hierarchical Reduce Prompt Template
// ============================================================================

describe('buildHierarchicalReducePromptTemplate', () => {
    it('should contain project-level template variables', () => {
        const template = buildHierarchicalReducePromptTemplate();
        expect(template).toContain('{{projectName}}');
        expect(template).toContain('{{projectDescription}}');
        expect(template).toContain('{{language}}');
        expect(template).toContain('{{buildSystem}}');
    });

    it('should reference areas structure', () => {
        const template = buildHierarchicalReducePromptTemplate();
        expect(template).toContain('areas');
        expect(template).toContain('hierarchical');
    });

    it('should instruct area-relative linking', () => {
        const template = buildHierarchicalReducePromptTemplate();
        expect(template).toContain('./areas/area-id/index.md');
        expect(template).toContain('./areas/area-id/modules/module-id.md');
    });

    it('should request three output fields', () => {
        const template = buildHierarchicalReducePromptTemplate();
        expect(template).toContain('"index"');
        expect(template).toContain('"architecture"');
        expect(template).toContain('"gettingStarted"');
    });
});

// ============================================================================
// File Writer — Hierarchical Layout
// ============================================================================

describe('getArticleFilePath — hierarchical', () => {
    it('should route module articles with areaId to areas/{areaId}/modules/', () => {
        const article: GeneratedArticle = {
            type: 'module',
            slug: 'core-auth',
            title: 'Core Auth',
            content: '',
            moduleId: 'core-auth',
            areaId: 'packages-core',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'areas', 'packages-core', 'modules', 'core-auth.md'));
    });

    it('should route module articles without areaId to modules/ (flat)', () => {
        const article: GeneratedArticle = {
            type: 'module',
            slug: 'auth',
            title: 'Auth',
            content: '',
            moduleId: 'auth',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'modules', 'auth.md'));
    });

    it('should route area-index to areas/{areaId}/index.md', () => {
        const article: GeneratedArticle = {
            type: 'area-index',
            slug: 'index',
            title: 'Area Index',
            content: '',
            areaId: 'packages-core',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'areas', 'packages-core', 'index.md'));
    });

    it('should route area-architecture to areas/{areaId}/architecture.md', () => {
        const article: GeneratedArticle = {
            type: 'area-architecture',
            slug: 'architecture',
            title: 'Area Architecture',
            content: '',
            areaId: 'packages-api',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'areas', 'packages-api', 'architecture.md'));
    });

    it('should route project-level index to root', () => {
        const article: GeneratedArticle = {
            type: 'index',
            slug: 'index',
            title: 'Wiki',
            content: '',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'index.md'));
    });
});

describe('writeWikiOutput — hierarchical layout', () => {
    it('should create area directory structure', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'core-auth',
                    title: 'Core Auth',
                    content: '# Core Auth',
                    moduleId: 'core-auth',
                    areaId: 'packages-core',
                },
                {
                    type: 'area-index',
                    slug: 'index',
                    title: 'Core Overview',
                    content: '# Core',
                    areaId: 'packages-core',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'modules', 'core-auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'index.md'))).toBe(true);
    });

    it('should create multiple area directories', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'auth',
                    title: 'Auth',
                    content: '# Auth',
                    moduleId: 'auth',
                    areaId: 'packages-core',
                },
                {
                    type: 'module',
                    slug: 'routes',
                    title: 'Routes',
                    content: '# Routes',
                    moduleId: 'routes',
                    areaId: 'packages-api',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'modules', 'auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-api', 'modules', 'routes.md'))).toBe(true);
    });

    it('should write complete hierarchical directory structure', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                // Project-level
                { type: 'index', slug: 'index', title: 'Index', content: '# Index' },
                { type: 'architecture', slug: 'architecture', title: 'Arch', content: '# Arch' },
                { type: 'getting-started', slug: 'getting-started', title: 'GS', content: '# GS' },
                // Area-level
                { type: 'area-index', slug: 'index', title: 'Core Index', content: '# Core', areaId: 'packages-core' },
                { type: 'area-architecture', slug: 'architecture', title: 'Core Arch', content: '# Core Arch', areaId: 'packages-core' },
                // Module-level
                { type: 'module', slug: 'auth', title: 'Auth', content: '# Auth', moduleId: 'auth', areaId: 'packages-core' },
            ],
            duration: 100,
        };

        const written = writeWikiOutput(output, outputDir);

        expect(written).toHaveLength(6);
        expect(fs.existsSync(path.join(outputDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'getting-started.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'modules', 'auth.md'))).toBe(true);
    });

    it('should still support flat layout (no areaId)', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                { type: 'index', slug: 'index', title: 'Index', content: '# Index' },
                { type: 'module', slug: 'auth', title: 'Auth', content: '# Auth', moduleId: 'auth' },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        expect(fs.existsSync(path.join(outputDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'modules', 'auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas'))).toBe(false);
    });

    it('should normalize line endings in area articles', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'area-index',
                    slug: 'index',
                    title: 'Core',
                    content: 'line1\r\nline2\r\n',
                    areaId: 'core',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        const content = fs.readFileSync(path.join(outputDir, 'areas', 'core', 'index.md'), 'utf-8');
        expect(content).toBe('line1\nline2\n');
    });
});

// ============================================================================
// Static Fallback — Area Pages
// ============================================================================

describe('generateStaticAreaPages', () => {
    it('should generate area-index and area-architecture articles', () => {
        const graph = createLargeGraph();
        const area = graph.areas![0]; // packages-core
        const analyses = [createTestAnalysis('core-auth'), createTestAnalysis('core-database')];

        const articles = generateStaticAreaPages(area, analyses, graph);

        const types = articles.map(a => a.type);
        expect(types).toContain('area-index');
        expect(types).toContain('area-architecture');
    });

    it('should set areaId on generated articles', () => {
        const graph = createLargeGraph();
        const area = graph.areas![0];
        const analyses = [createTestAnalysis('core-auth')];

        const articles = generateStaticAreaPages(area, analyses, graph);

        for (const article of articles) {
            expect(article.areaId).toBe('packages-core');
        }
    });

    it('should include module links in area index', () => {
        const graph = createLargeGraph();
        const area = graph.areas![0];
        const analyses = [createTestAnalysis('core-auth'), createTestAnalysis('core-database')];

        const articles = generateStaticAreaPages(area, analyses, graph);
        const index = articles.find(a => a.type === 'area-index')!;

        expect(index.content).toContain('core-auth.md');
        expect(index.content).toContain('core-database.md');
    });

    it('should use module names in area index', () => {
        const graph = createLargeGraph();
        const area = graph.areas![0];
        const analyses = [createTestAnalysis('core-auth')];

        const articles = generateStaticAreaPages(area, analyses, graph);
        const index = articles.find(a => a.type === 'area-index')!;

        expect(index.content).toContain('Core Auth');
    });

    it('should include area name in both articles', () => {
        const graph = createLargeGraph();
        const area = graph.areas![0];
        const analyses = [createTestAnalysis('core-auth')];

        const articles = generateStaticAreaPages(area, analyses, graph);

        for (const article of articles) {
            expect(article.content).toContain(area.name);
        }
    });
});

// ============================================================================
// Static Fallback — Hierarchical Project Index
// ============================================================================

describe('generateStaticHierarchicalIndexPages', () => {
    it('should generate project index and architecture', () => {
        const graph = createLargeGraph();
        const areas = graph.areas!;
        const areaSummaries = areas.map(a => ({
            areaId: a.id,
            name: a.name,
            description: a.description,
            moduleCount: a.modules.length,
        }));

        const articles = generateStaticHierarchicalIndexPages(graph, areas, areaSummaries);

        const types = articles.map(a => a.type);
        expect(types).toContain('index');
        expect(types).toContain('architecture');
    });

    it('should include area links in project index', () => {
        const graph = createLargeGraph();
        const areas = graph.areas!;
        const areaSummaries = areas.map(a => ({
            areaId: a.id,
            name: a.name,
            description: a.description,
            moduleCount: a.modules.length,
        }));

        const articles = generateStaticHierarchicalIndexPages(graph, areas, areaSummaries);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('./areas/packages-core/index.md');
        expect(index.content).toContain('./areas/packages-api/index.md');
    });

    it('should show module counts in project index', () => {
        const graph = createLargeGraph();
        const areas = graph.areas!;
        const areaSummaries = areas.map(a => ({
            areaId: a.id,
            name: a.name,
            description: a.description,
            moduleCount: a.modules.length,
        }));

        const articles = generateStaticHierarchicalIndexPages(graph, areas, areaSummaries);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('2 modules');
    });

    it('should include project name', () => {
        const graph = createLargeGraph();
        const areas = graph.areas!;
        const areaSummaries = areas.map(a => ({
            areaId: a.id,
            name: a.name,
            description: a.description,
            moduleCount: a.modules.length,
        }));

        const articles = generateStaticHierarchicalIndexPages(graph, areas, areaSummaries);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('LargeProject');
    });
});

// ============================================================================
// Backward Compatibility
// ============================================================================

describe('backward compatibility — small repos', () => {
    it('should produce flat layout when graph has no areas', () => {
        const graph = createSmallGraph();
        expect(graph.areas).toBeUndefined();

        const analyses = [createTestAnalysis('auth'), createTestAnalysis('database')];
        const articles = generateStaticIndexPages(graph, analyses);

        // All module links should use flat ./modules/ path
        const index = articles.find(a => a.type === 'index')!;
        expect(index.content).toContain('./modules/auth.md');
        expect(index.content).not.toContain('./areas/');
    });

    it('should not generate area articles for small repos', () => {
        const graph = createSmallGraph();
        const analyses = [createTestAnalysis('auth')];
        const articles = generateStaticIndexPages(graph, analyses);

        const types = articles.map(a => a.type);
        expect(types).not.toContain('area-index');
        expect(types).not.toContain('area-architecture');
    });

    it('should produce flat cross-link rules for modules without area', () => {
        const graph = createSmallGraph();
        const analysis = createTestAnalysis('auth');
        const item = analysisToPromptItem(analysis, graph);

        // The item should not have area context
        const prompt = buildModuleArticlePromptTemplate('normal');
        expect(prompt).toContain('./modules/module-id.md');
        expect(prompt).not.toContain('../../other-area-id');
    });
});

// ============================================================================
// Integration: End-to-End File Layout
// ============================================================================

describe('integration — hierarchical file layout', () => {
    it('should write hierarchical articles to correct paths', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const graph = createLargeGraph();
        const areas = graph.areas!;

        // Build a full set of articles similar to what the executor would produce
        const articles: GeneratedArticle[] = [
            // Project-level
            { type: 'index', slug: 'index', title: 'Wiki', content: '# Wiki' },
            { type: 'architecture', slug: 'architecture', title: 'Arch', content: '# Arch' },
            { type: 'getting-started', slug: 'getting-started', title: 'GS', content: '# GS' },

            // Area: packages-core
            { type: 'area-index', slug: 'index', title: 'Core', content: '# Core', areaId: 'packages-core' },
            { type: 'area-architecture', slug: 'architecture', title: 'Core Arch', content: '# Core Arch', areaId: 'packages-core' },
            { type: 'module', slug: 'core-auth', title: 'Auth', content: '# Auth', moduleId: 'core-auth', areaId: 'packages-core' },
            { type: 'module', slug: 'core-database', title: 'DB', content: '# DB', moduleId: 'core-database', areaId: 'packages-core' },

            // Area: packages-api
            { type: 'area-index', slug: 'index', title: 'API', content: '# API', areaId: 'packages-api' },
            { type: 'area-architecture', slug: 'architecture', title: 'API Arch', content: '# API Arch', areaId: 'packages-api' },
            { type: 'module', slug: 'api-routes', title: 'Routes', content: '# Routes', moduleId: 'api-routes', areaId: 'packages-api' },
            { type: 'module', slug: 'api-middleware', title: 'MW', content: '# MW', moduleId: 'api-middleware', areaId: 'packages-api' },
        ];

        const output: WikiOutput = { articles, duration: 100 };
        const written = writeWikiOutput(output, outputDir);

        expect(written).toHaveLength(11);

        // Project level
        expect(fs.existsSync(path.join(outputDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'getting-started.md'))).toBe(true);

        // packages-core area
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'modules', 'core-auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-core', 'modules', 'core-database.md'))).toBe(true);

        // packages-api area
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-api', 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-api', 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-api', 'modules', 'api-routes.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'areas', 'packages-api', 'modules', 'api-middleware.md'))).toBe(true);
    });

    it('should write flat articles to correct paths (no areas)', () => {
        const outputDir = path.join(tempDir, 'wiki');

        const articles: GeneratedArticle[] = [
            { type: 'index', slug: 'index', title: 'Wiki', content: '# Wiki' },
            { type: 'architecture', slug: 'architecture', title: 'Arch', content: '# Arch' },
            { type: 'getting-started', slug: 'getting-started', title: 'GS', content: '# GS' },
            { type: 'module', slug: 'auth', title: 'Auth', content: '# Auth', moduleId: 'auth' },
            { type: 'module', slug: 'database', title: 'DB', content: '# DB', moduleId: 'database' },
        ];

        const output: WikiOutput = { articles, duration: 100 };
        const written = writeWikiOutput(output, outputDir);

        expect(written).toHaveLength(5);

        expect(fs.existsSync(path.join(outputDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'modules', 'auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'modules', 'database.md'))).toBe(true);

        // No areas directory should be created
        expect(fs.existsSync(path.join(outputDir, 'areas'))).toBe(false);
    });

    it('should correctly read written hierarchical content', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'core-auth',
                    title: 'Core Auth',
                    content: '# Core Auth\n\nAuthentication module in the core area.',
                    moduleId: 'core-auth',
                    areaId: 'packages-core',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        const filePath = path.join(outputDir, 'areas', 'packages-core', 'modules', 'core-auth.md');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toBe('# Core Auth\n\nAuthentication module in the core area.');
    });
});

// ============================================================================
// groupAnalysesByArea
// ============================================================================

describe('groupAnalysesByArea', () => {
    it('should map modules to their areas correctly', () => {
        const graph = createLargeGraph();
        const analyses = [
            createTestAnalysis('core-auth'),
            createTestAnalysis('core-database'),
            createTestAnalysis('api-routes'),
        ];

        const result = groupAnalysesByArea(analyses, graph.areas!);

        expect(result.moduleAreaMap.get('core-auth')).toBe('packages-core');
        expect(result.moduleAreaMap.get('core-database')).toBe('packages-core');
        expect(result.moduleAreaMap.get('api-routes')).toBe('packages-api');
    });

    it('should group analyses by area', () => {
        const graph = createLargeGraph();
        const analyses = [
            createTestAnalysis('core-auth'),
            createTestAnalysis('core-database'),
            createTestAnalysis('api-routes'),
            createTestAnalysis('api-middleware'),
        ];

        const result = groupAnalysesByArea(analyses, graph.areas!);

        expect(result.analysesByArea.get('packages-core')!.length).toBe(2);
        expect(result.analysesByArea.get('packages-api')!.length).toBe(2);
        expect(result.unassignedAnalyses.length).toBe(0);
    });

    it('should collect unassigned modules', () => {
        const graph = createLargeGraph();
        const analyses = [
            createTestAnalysis('core-auth'),
            createTestAnalysis('unknown-module'),
        ];

        const result = groupAnalysesByArea(analyses, graph.areas!);

        expect(result.analysesByArea.get('packages-core')!.length).toBe(1);
        expect(result.unassignedAnalyses.length).toBe(1);
        expect(result.unassignedAnalyses[0].moduleId).toBe('unknown-module');
    });

    it('should handle empty analyses', () => {
        const graph = createLargeGraph();

        const result = groupAnalysesByArea([], graph.areas!);

        expect(result.moduleAreaMap.size).toBe(4); // all area modules still mapped
        expect(result.analysesByArea.size).toBe(0);
        expect(result.unassignedAnalyses.length).toBe(0);
    });

    it('should handle empty areas', () => {
        const analyses = [createTestAnalysis('core-auth')];

        const result = groupAnalysesByArea(analyses, []);

        expect(result.moduleAreaMap.size).toBe(0);
        expect(result.analysesByArea.size).toBe(0);
        expect(result.unassignedAnalyses.length).toBe(1);
    });
});
