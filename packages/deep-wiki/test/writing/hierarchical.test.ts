/**
 * Hierarchical Wiki Output Tests
 *
 * Tests for 3-level hierarchical wiki output for large repos:
 * - Area-aware cross-link generation
 * - Hierarchical file writer (domain directory creation + path routing)
 * - Area reduce prompt template
 * - Static fallback generation for domains
 * - Backward compat: small repo still produces flat layout
 * - Integration-level: graph with domains → hierarchical articles + file layout
 * - Integration-level: graph without domains → flat layout (unchanged)
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
    DomainInfo,
} from '../../src/types';
import {
    buildModuleArticlePromptTemplate,
    buildCrossLinkRules,
    buildSimplifiedGraph,
} from '../../src/writing/prompts';
import {
    buildDomainReducePromptTemplate,
    getDomainReduceOutputFields,
    buildHierarchicalReducePromptTemplate,
} from '../../src/writing/reduce-prompts';
import {
    writeWikiOutput,
    getArticleFilePath,
} from '../../src/writing/file-writer';
import {
    generateStaticDomainPages,
    generateStaticHierarchicalIndexPages,
    generateStaticIndexPages,
    analysisToPromptItem,
    groupAnalysesByDomain,
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
    const domains: DomainInfo[] = [
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
                domain: 'packages-core',
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
                domain: 'packages-core',
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
                domain: 'packages-api',
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
                domain: 'packages-api',
            },
        ],
        categories: [
            { name: 'security', description: 'Security modules' },
            { name: 'infrastructure', description: 'Infrastructure' },
            { name: 'api', description: 'API layer' },
        ],
        architectureNotes: 'Monorepo with packages/core and packages/api domains',
        domains,
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
    it('should produce flat cross-link rules when no domainId', () => {
        const rules = buildCrossLinkRules();
        expect(rules).toContain('./modules/module-id.md');
        expect(rules).not.toContain('domains/');
    });

    it('should produce hierarchical cross-link rules when domainId provided', () => {
        const rules = buildCrossLinkRules('packages-core');
        expect(rules).toContain('domains/packages-core/modules/');
        expect(rules).toContain('../../other-domain-id/modules/module-id.md');
        expect(rules).toContain('Domain Index');
        expect(rules).toContain('Project Index');
    });

    it('should include the specific domain ID in the location context', () => {
        const rules = buildCrossLinkRules('my-domain');
        expect(rules).toContain('domains/my-domain/modules/');
    });
});

// ============================================================================
// Prompt Template with Area Context
// ============================================================================

describe('buildModuleArticlePromptTemplate with domain', () => {
    it('should produce flat cross-links by default', () => {
        const template = buildModuleArticlePromptTemplate('normal');
        expect(template).toContain('./modules/module-id.md');
        expect(template).not.toContain('../../other-domain-id');
    });

    it('should produce hierarchical cross-links when domainId provided', () => {
        const template = buildModuleArticlePromptTemplate('normal', 'packages-core');
        expect(template).toContain('domains/packages-core/modules/');
        expect(template).toContain('../../other-domain-id/modules/module-id.md');
    });

    it('should still contain template variables when domain is provided', () => {
        const template = buildModuleArticlePromptTemplate('normal', 'my-domain');
        expect(template).toContain('{{moduleName}}');
        expect(template).toContain('{{analysis}}');
        expect(template).toContain('{{moduleGraph}}');
    });

    it('should vary by depth even with domain', () => {
        const shallow = buildModuleArticlePromptTemplate('shallow', 'domain-1');
        const deep = buildModuleArticlePromptTemplate('deep', 'domain-1');
        expect(shallow).toContain('concise');
        expect(deep).toContain('thorough');
    });
});

// ============================================================================
// Domain Reduce Prompt Template
// ============================================================================

describe('buildDomainReducePromptTemplate', () => {
    it('should contain domain-specific template variables', () => {
        const template = buildDomainReducePromptTemplate();
        expect(template).toContain('{{domainName}}');
        expect(template).toContain('{{domainDescription}}');
        expect(template).toContain('{{domainPath}}');
        expect(template).toContain('{{projectName}}');
    });

    it('should request index and architecture pages', () => {
        const template = buildDomainReducePromptTemplate();
        expect(template).toContain('index.md');
        expect(template).toContain('architecture.md');
    });

    it('should instruct domain-relative module links', () => {
        const template = buildDomainReducePromptTemplate();
        expect(template).toContain('./modules/module-id.md');
    });

    it('should include cross-domain linking instructions', () => {
        const template = buildDomainReducePromptTemplate();
        expect(template).toContain('../../other-domain-id/modules/module-id.md');
    });

    it('should request JSON output with two fields', () => {
        const template = buildDomainReducePromptTemplate();
        expect(template).toContain('"index"');
        expect(template).toContain('"architecture"');
    });
});

describe('getDomainReduceOutputFields', () => {
    it('should return index and architecture', () => {
        const fields = getDomainReduceOutputFields();
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

    it('should reference domains structure', () => {
        const template = buildHierarchicalReducePromptTemplate();
        expect(template).toContain('domains');
        expect(template).toContain('hierarchical');
    });

    it('should instruct domain-relative linking', () => {
        const template = buildHierarchicalReducePromptTemplate();
        expect(template).toContain('./domains/domain-id/index.md');
        expect(template).toContain('./domains/domain-id/modules/module-id.md');
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
    it('should route module articles with domainId to domains/{domainId}/modules/', () => {
        const article: GeneratedArticle = {
            type: 'module',
            slug: 'core-auth',
            title: 'Core Auth',
            content: '',
            moduleId: 'core-auth',
            domainId: 'packages-core',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'domains', 'packages-core', 'modules', 'core-auth.md'));
    });

    it('should route module articles without domainId to modules/ (flat)', () => {
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

    it('should route domain-index to domains/{domainId}/index.md', () => {
        const article: GeneratedArticle = {
            type: 'domain-index',
            slug: 'index',
            title: 'Area Index',
            content: '',
            domainId: 'packages-core',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'domains', 'packages-core', 'index.md'));
    });

    it('should route domain-architecture to domains/{domainId}/architecture.md', () => {
        const article: GeneratedArticle = {
            type: 'domain-architecture',
            slug: 'architecture',
            title: 'Area Architecture',
            content: '',
            domainId: 'packages-api',
        };
        const result = getArticleFilePath(article, '/output');
        expect(result).toBe(path.join('/output', 'domains', 'packages-api', 'architecture.md'));
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
    it('should create domain directory structure', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'core-auth',
                    title: 'Core Auth',
                    content: '# Core Auth',
                    moduleId: 'core-auth',
                    domainId: 'packages-core',
                },
                {
                    type: 'domain-index',
                    slug: 'index',
                    title: 'Core Overview',
                    content: '# Core',
                    domainId: 'packages-core',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'modules', 'core-auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'index.md'))).toBe(true);
    });

    it('should create multiple domain directories', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'auth',
                    title: 'Auth',
                    content: '# Auth',
                    moduleId: 'auth',
                    domainId: 'packages-core',
                },
                {
                    type: 'module',
                    slug: 'routes',
                    title: 'Routes',
                    content: '# Routes',
                    moduleId: 'routes',
                    domainId: 'packages-api',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'modules', 'auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-api', 'modules', 'routes.md'))).toBe(true);
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
                { type: 'domain-index', slug: 'index', title: 'Core Index', content: '# Core', domainId: 'packages-core' },
                { type: 'domain-architecture', slug: 'architecture', title: 'Core Arch', content: '# Core Arch', domainId: 'packages-core' },
                // Module-level
                { type: 'module', slug: 'auth', title: 'Auth', content: '# Auth', moduleId: 'auth', domainId: 'packages-core' },
            ],
            duration: 100,
        };

        const written = writeWikiOutput(output, outputDir);

        expect(written).toHaveLength(6);
        expect(fs.existsSync(path.join(outputDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'getting-started.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'modules', 'auth.md'))).toBe(true);
    });

    it('should still support flat layout (no domainId)', () => {
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
        expect(fs.existsSync(path.join(outputDir, 'domains'))).toBe(false);
    });

    it('should normalize line endings in domain articles', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'domain-index',
                    slug: 'index',
                    title: 'Core',
                    content: 'line1\r\nline2\r\n',
                    domainId: 'core',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        const content = fs.readFileSync(path.join(outputDir, 'domains', 'core', 'index.md'), 'utf-8');
        expect(content).toBe('line1\nline2\n');
    });
});

// ============================================================================
// Static Fallback — Area Pages
// ============================================================================

describe('generateStaticDomainPages', () => {
    it('should generate domain-index and domain-architecture articles', () => {
        const graph = createLargeGraph();
        const domain = graph.domains![0]; // packages-core
        const analyses = [createTestAnalysis('core-auth'), createTestAnalysis('core-database')];

        const articles = generateStaticDomainPages(domain, analyses, graph);

        const types = articles.map(a => a.type);
        expect(types).toContain('domain-index');
        expect(types).toContain('domain-architecture');
    });

    it('should set domainId on generated articles', () => {
        const graph = createLargeGraph();
        const domain = graph.domains![0];
        const analyses = [createTestAnalysis('core-auth')];

        const articles = generateStaticDomainPages(domain, analyses, graph);

        for (const article of articles) {
            expect(article.domainId).toBe('packages-core');
        }
    });

    it('should include module links in domain index', () => {
        const graph = createLargeGraph();
        const domain = graph.domains![0];
        const analyses = [createTestAnalysis('core-auth'), createTestAnalysis('core-database')];

        const articles = generateStaticDomainPages(domain, analyses, graph);
        const index = articles.find(a => a.type === 'domain-index')!;

        expect(index.content).toContain('core-auth.md');
        expect(index.content).toContain('core-database.md');
    });

    it('should use module names in domain index', () => {
        const graph = createLargeGraph();
        const domain = graph.domains![0];
        const analyses = [createTestAnalysis('core-auth')];

        const articles = generateStaticDomainPages(domain, analyses, graph);
        const index = articles.find(a => a.type === 'domain-index')!;

        expect(index.content).toContain('Core Auth');
    });

    it('should include domain name in both articles', () => {
        const graph = createLargeGraph();
        const domain = graph.domains![0];
        const analyses = [createTestAnalysis('core-auth')];

        const articles = generateStaticDomainPages(domain, analyses, graph);

        for (const article of articles) {
            expect(article.content).toContain(domain.name);
        }
    });
});

// ============================================================================
// Static Fallback — Hierarchical Project Index
// ============================================================================

describe('generateStaticHierarchicalIndexPages', () => {
    it('should generate project index and architecture', () => {
        const graph = createLargeGraph();
        const domains = graph.domains!;
        const domainSummaries = domains.map(a => ({
            domainId: a.id,
            name: a.name,
            description: a.description,
            moduleCount: a.modules.length,
        }));

        const articles = generateStaticHierarchicalIndexPages(graph, domains, domainSummaries);

        const types = articles.map(a => a.type);
        expect(types).toContain('index');
        expect(types).toContain('architecture');
    });

    it('should include domain links in project index', () => {
        const graph = createLargeGraph();
        const domains = graph.domains!;
        const domainSummaries = domains.map(a => ({
            domainId: a.id,
            name: a.name,
            description: a.description,
            moduleCount: a.modules.length,
        }));

        const articles = generateStaticHierarchicalIndexPages(graph, domains, domainSummaries);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('./domains/packages-core/index.md');
        expect(index.content).toContain('./domains/packages-api/index.md');
    });

    it('should show module counts in project index', () => {
        const graph = createLargeGraph();
        const domains = graph.domains!;
        const domainSummaries = domains.map(a => ({
            domainId: a.id,
            name: a.name,
            description: a.description,
            moduleCount: a.modules.length,
        }));

        const articles = generateStaticHierarchicalIndexPages(graph, domains, domainSummaries);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('2 modules');
    });

    it('should include project name', () => {
        const graph = createLargeGraph();
        const domains = graph.domains!;
        const domainSummaries = domains.map(a => ({
            domainId: a.id,
            name: a.name,
            description: a.description,
            moduleCount: a.modules.length,
        }));

        const articles = generateStaticHierarchicalIndexPages(graph, domains, domainSummaries);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('LargeProject');
    });
});

// ============================================================================
// Backward Compatibility
// ============================================================================

describe('backward compatibility — small repos', () => {
    it('should produce flat layout when graph has no domains', () => {
        const graph = createSmallGraph();
        expect(graph.domains).toBeUndefined();

        const analyses = [createTestAnalysis('auth'), createTestAnalysis('database')];
        const articles = generateStaticIndexPages(graph, analyses);

        // All module links should use flat ./modules/ path
        const index = articles.find(a => a.type === 'index')!;
        expect(index.content).toContain('./modules/auth.md');
        expect(index.content).not.toContain('./domains/');
    });

    it('should not generate domain articles for small repos', () => {
        const graph = createSmallGraph();
        const analyses = [createTestAnalysis('auth')];
        const articles = generateStaticIndexPages(graph, analyses);

        const types = articles.map(a => a.type);
        expect(types).not.toContain('domain-index');
        expect(types).not.toContain('domain-architecture');
    });

    it('should produce flat cross-link rules for modules without domain', () => {
        const graph = createSmallGraph();
        const analysis = createTestAnalysis('auth');
        const item = analysisToPromptItem(analysis, graph);

        // The item should not have domain context
        const prompt = buildModuleArticlePromptTemplate('normal');
        expect(prompt).toContain('./modules/module-id.md');
        expect(prompt).not.toContain('../../other-domain-id');
    });
});

// ============================================================================
// Integration: End-to-End File Layout
// ============================================================================

describe('integration — hierarchical file layout', () => {
    it('should write hierarchical articles to correct paths', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const graph = createLargeGraph();
        const domains = graph.domains!;

        // Build a full set of articles similar to what the executor would produce
        const articles: GeneratedArticle[] = [
            // Project-level
            { type: 'index', slug: 'index', title: 'Wiki', content: '# Wiki' },
            { type: 'architecture', slug: 'architecture', title: 'Arch', content: '# Arch' },
            { type: 'getting-started', slug: 'getting-started', title: 'GS', content: '# GS' },

            // Area: packages-core
            { type: 'domain-index', slug: 'index', title: 'Core', content: '# Core', domainId: 'packages-core' },
            { type: 'domain-architecture', slug: 'architecture', title: 'Core Arch', content: '# Core Arch', domainId: 'packages-core' },
            { type: 'module', slug: 'core-auth', title: 'Auth', content: '# Auth', moduleId: 'core-auth', domainId: 'packages-core' },
            { type: 'module', slug: 'core-database', title: 'DB', content: '# DB', moduleId: 'core-database', domainId: 'packages-core' },

            // Area: packages-api
            { type: 'domain-index', slug: 'index', title: 'API', content: '# API', domainId: 'packages-api' },
            { type: 'domain-architecture', slug: 'architecture', title: 'API Arch', content: '# API Arch', domainId: 'packages-api' },
            { type: 'module', slug: 'api-routes', title: 'Routes', content: '# Routes', moduleId: 'api-routes', domainId: 'packages-api' },
            { type: 'module', slug: 'api-middleware', title: 'MW', content: '# MW', moduleId: 'api-middleware', domainId: 'packages-api' },
        ];

        const output: WikiOutput = { articles, duration: 100 };
        const written = writeWikiOutput(output, outputDir);

        expect(written).toHaveLength(11);

        // Project level
        expect(fs.existsSync(path.join(outputDir, 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'getting-started.md'))).toBe(true);

        // packages-core domain
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'modules', 'core-auth.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-core', 'modules', 'core-database.md'))).toBe(true);

        // packages-api domain
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-api', 'index.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-api', 'architecture.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-api', 'modules', 'api-routes.md'))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, 'domains', 'packages-api', 'modules', 'api-middleware.md'))).toBe(true);
    });

    it('should write flat articles to correct paths (no domains)', () => {
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

        // No domains directory should be created
        expect(fs.existsSync(path.join(outputDir, 'domains'))).toBe(false);
    });

    it('should correctly read written hierarchical content', () => {
        const outputDir = path.join(tempDir, 'wiki');
        const output: WikiOutput = {
            articles: [
                {
                    type: 'module',
                    slug: 'core-auth',
                    title: 'Core Auth',
                    content: '# Core Auth\n\nAuthentication module in the core domain.',
                    moduleId: 'core-auth',
                    domainId: 'packages-core',
                },
            ],
            duration: 100,
        };

        writeWikiOutput(output, outputDir);

        const filePath = path.join(outputDir, 'domains', 'packages-core', 'modules', 'core-auth.md');
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toBe('# Core Auth\n\nAuthentication module in the core domain.');
    });
});

// ============================================================================
// groupAnalysesByDomain
// ============================================================================

describe('groupAnalysesByDomain', () => {
    it('should map modules to their domains correctly', () => {
        const graph = createLargeGraph();
        const analyses = [
            createTestAnalysis('core-auth'),
            createTestAnalysis('core-database'),
            createTestAnalysis('api-routes'),
        ];

        const result = groupAnalysesByDomain(analyses, graph.domains!);

        expect(result.moduleDomainMap.get('core-auth')).toBe('packages-core');
        expect(result.moduleDomainMap.get('core-database')).toBe('packages-core');
        expect(result.moduleDomainMap.get('api-routes')).toBe('packages-api');
    });

    it('should group analyses by domain', () => {
        const graph = createLargeGraph();
        const analyses = [
            createTestAnalysis('core-auth'),
            createTestAnalysis('core-database'),
            createTestAnalysis('api-routes'),
            createTestAnalysis('api-middleware'),
        ];

        const result = groupAnalysesByDomain(analyses, graph.domains!);

        expect(result.analysesByDomain.get('packages-core')!.length).toBe(2);
        expect(result.analysesByDomain.get('packages-api')!.length).toBe(2);
        expect(result.unassignedAnalyses.length).toBe(0);
    });

    it('should collect unassigned modules', () => {
        const graph = createLargeGraph();
        const analyses = [
            createTestAnalysis('core-auth'),
            createTestAnalysis('unknown-module'),
        ];

        const result = groupAnalysesByDomain(analyses, graph.domains!);

        expect(result.analysesByDomain.get('packages-core')!.length).toBe(1);
        expect(result.unassignedAnalyses.length).toBe(1);
        expect(result.unassignedAnalyses[0].moduleId).toBe('unknown-module');
    });

    it('should handle empty analyses', () => {
        const graph = createLargeGraph();

        const result = groupAnalysesByDomain([], graph.domains!);

        expect(result.moduleDomainMap.size).toBe(4); // all domain modules still mapped
        expect(result.analysesByDomain.size).toBe(0);
        expect(result.unassignedAnalyses.length).toBe(0);
    });

    it('should handle empty domains', () => {
        const analyses = [createTestAnalysis('core-auth')];

        const result = groupAnalysesByDomain(analyses, []);

        expect(result.moduleDomainMap.size).toBe(0);
        expect(result.analysesByDomain.size).toBe(0);
        expect(result.unassignedAnalyses.length).toBe(1);
    });
});
