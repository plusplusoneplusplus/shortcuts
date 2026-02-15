/**
 * Types Tests
 *
 * Tests for type validation, schema helpers, and module ID normalization.
 */

import { describe, it, expect } from 'vitest';
import { isValidComponentId, normalizeComponentId, COMPONENT_GRAPH_REQUIRED_FIELDS, PROJECT_INFO_REQUIRED_FIELDS, COMPONENT_INFO_REQUIRED_FIELDS, VALID_COMPLEXITY_VALUES, COMPONENT_GRAPH_SCHEMA, STRUCTURAL_SCAN_SCHEMA } from '../src/schemas';
import type { ComponentGraph, ComponentInfo, ProjectInfo, CategoryInfo, DiscoveryOptions, DiscoveryResult, DeepWikiConfig, DiscoverCommandOptions, TopLevelDomain, StructuralScanResult, CacheMetadata, CachedGraph, DomainInfo, GeneratedArticle, ArticleType, ThemeRequest, ThemeCoverageCheck, ThemeOutline, ThemeAnalysis, ThemeArticle, ThemeMeta, ThemeCommandOptions } from '../src/types';

describe('Types and Schemas', () => {
    // ========================================================================
    // Module ID Validation
    // ========================================================================

    describe('isValidComponentId', () => {
        it('should accept simple lowercase IDs', () => {
            expect(isValidComponentId('auth')).toBe(true);
            expect(isValidComponentId('database')).toBe(true);
            expect(isValidComponentId('api')).toBe(true);
        });

        it('should accept kebab-case IDs', () => {
            expect(isValidComponentId('auth-service')).toBe(true);
            expect(isValidComponentId('database-layer')).toBe(true);
            expect(isValidComponentId('my-long-module-name')).toBe(true);
        });

        it('should accept IDs with numbers', () => {
            expect(isValidComponentId('module1')).toBe(true);
            expect(isValidComponentId('v2-api')).toBe(true);
            expect(isValidComponentId('auth-v3')).toBe(true);
        });

        it('should reject IDs starting with numbers', () => {
            expect(isValidComponentId('123')).toBe(false);
            expect(isValidComponentId('1module')).toBe(false);
        });

        it('should reject IDs with uppercase letters', () => {
            expect(isValidComponentId('Auth')).toBe(false);
            expect(isValidComponentId('AUTH')).toBe(false);
            expect(isValidComponentId('myModule')).toBe(false);
        });

        it('should reject IDs with special characters', () => {
            expect(isValidComponentId('auth_service')).toBe(false);
            expect(isValidComponentId('auth.service')).toBe(false);
            expect(isValidComponentId('auth/service')).toBe(false);
            expect(isValidComponentId('auth service')).toBe(false);
        });

        it('should reject IDs with leading or trailing hyphens', () => {
            expect(isValidComponentId('-auth')).toBe(false);
            expect(isValidComponentId('auth-')).toBe(false);
            expect(isValidComponentId('-auth-')).toBe(false);
        });

        it('should reject IDs with consecutive hyphens', () => {
            expect(isValidComponentId('auth--service')).toBe(false);
        });

        it('should reject empty strings', () => {
            expect(isValidComponentId('')).toBe(false);
        });
    });

    // ========================================================================
    // Module ID Normalization
    // ========================================================================

    describe('normalizeComponentId', () => {
        it('should lowercase the input', () => {
            expect(normalizeComponentId('Auth')).toBe('auth');
            expect(normalizeComponentId('AUTH')).toBe('auth');
            expect(normalizeComponentId('MyModule')).toBe('mymodule');
        });

        it('should replace special characters with hyphens', () => {
            expect(normalizeComponentId('auth_service')).toBe('auth-service');
            expect(normalizeComponentId('auth.service')).toBe('auth-service');
            expect(normalizeComponentId('auth/service')).toBe('auth-service');
            expect(normalizeComponentId('auth service')).toBe('auth-service');
        });

        it('should trim leading/trailing hyphens', () => {
            expect(normalizeComponentId('-auth-')).toBe('auth');
            expect(normalizeComponentId('--auth--')).toBe('auth');
        });

        it('should collapse consecutive hyphens', () => {
            expect(normalizeComponentId('auth--service')).toBe('auth-service');
            expect(normalizeComponentId('a___b')).toBe('a-b');
        });

        it('should return "unknown" for empty/invalid input', () => {
            expect(normalizeComponentId('')).toBe('unknown');
            expect(normalizeComponentId('---')).toBe('unknown');
            expect(normalizeComponentId('...')).toBe('unknown');
        });

        it('should handle complex paths', () => {
            expect(normalizeComponentId('src/auth/')).toBe('src-auth');
            expect(normalizeComponentId('packages/core/src')).toBe('packages-core-src');
        });
    });

    // ========================================================================
    // Required Fields Constants
    // ========================================================================

    describe('Required field constants', () => {
        it('should define COMPONENT_GRAPH_REQUIRED_FIELDS', () => {
            expect(COMPONENT_GRAPH_REQUIRED_FIELDS).toContain('project');
            expect(COMPONENT_GRAPH_REQUIRED_FIELDS).toContain('components');
            expect(COMPONENT_GRAPH_REQUIRED_FIELDS).toContain('categories');
        });

        it('should define PROJECT_INFO_REQUIRED_FIELDS', () => {
            expect(PROJECT_INFO_REQUIRED_FIELDS).toContain('name');
            expect(PROJECT_INFO_REQUIRED_FIELDS).toContain('language');
        });

        it('should define COMPONENT_INFO_REQUIRED_FIELDS', () => {
            expect(COMPONENT_INFO_REQUIRED_FIELDS).toContain('id');
            expect(COMPONENT_INFO_REQUIRED_FIELDS).toContain('name');
            expect(COMPONENT_INFO_REQUIRED_FIELDS).toContain('path');
        });

        it('should define VALID_COMPLEXITY_VALUES', () => {
            expect(VALID_COMPLEXITY_VALUES).toEqual(['low', 'medium', 'high']);
        });
    });

    // ========================================================================
    // Schema Strings
    // ========================================================================

    describe('Schema strings', () => {
        it('should define COMPONENT_GRAPH_SCHEMA as a non-empty string', () => {
            expect(typeof COMPONENT_GRAPH_SCHEMA).toBe('string');
            expect(COMPONENT_GRAPH_SCHEMA.length).toBeGreaterThan(100);
            expect(COMPONENT_GRAPH_SCHEMA).toContain('project');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('components');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('categories');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('architectureNotes');
        });

        it('should define STRUCTURAL_SCAN_SCHEMA as a non-empty string', () => {
            expect(typeof STRUCTURAL_SCAN_SCHEMA).toBe('string');
            expect(STRUCTURAL_SCAN_SCHEMA.length).toBeGreaterThan(50);
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('fileCount');
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('domains');
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('projectInfo');
        });

        // Feature-focus schema hint tests
        it('should include feature-focused guidance in COMPONENT_GRAPH_SCHEMA id field', () => {
            expect(COMPONENT_GRAPH_SCHEMA).toContain('describing the FEATURE');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('NOT the file/directory path');
        });

        it('should include feature-focused guidance in COMPONENT_GRAPH_SCHEMA name field', () => {
            expect(COMPONENT_GRAPH_SCHEMA).toContain('what this module DOES for users/system');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('NOT the file name');
        });

        it('should include feature-focused guidance in COMPONENT_GRAPH_SCHEMA purpose field', () => {
            expect(COMPONENT_GRAPH_SCHEMA).toContain('what this module does for users or the system');
        });

        it('should include feature-focused guidance in STRUCTURAL_SCAN_SCHEMA domain name', () => {
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('FUNCTIONALITY');
        });

        it('should include feature-focused guidance in STRUCTURAL_SCAN_SCHEMA domain description', () => {
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('what this domain DOES');
        });
    });

    // ========================================================================
    // Type Shape Verification
    // ========================================================================

    describe('Type shape verification', () => {
        it('should allow constructing a valid ComponentGraph', () => {
            const graph: ComponentGraph = {
                project: {
                    name: 'test-project',
                    description: 'A test project',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: ['src/index.ts'],
                },
                components: [
                    {
                        id: 'core',
                        name: 'Core Module',
                        path: 'src/core/',
                        purpose: 'Core business logic',
                        keyFiles: ['src/core/index.ts'],
                        dependencies: [],
                        dependents: ['api'],
                        complexity: 'medium',
                        category: 'core',
                    },
                ],
                categories: [
                    { name: 'core', description: 'Core modules' },
                ],
                architectureNotes: 'Simple architecture',
            };
            expect(graph.project.name).toBe('test-project');
            expect(graph.components).toHaveLength(1);
            expect(graph.categories).toHaveLength(1);
        });

        it('should allow constructing valid DiscoveryOptions', () => {
            const options: DiscoveryOptions = {
                repoPath: '/path/to/repo',
                model: 'claude-sonnet',
                timeout: 300000,
                focus: 'src/',
                concurrency: 5,
            };
            expect(options.repoPath).toBe('/path/to/repo');
        });

        it('should allow constructing valid DiscoveryResult', () => {
            const result: DiscoveryResult = {
                graph: {
                    project: { name: 'p', description: '', language: 'TS', buildSystem: '', entryPoints: [] },
                    components: [],
                    categories: [],
                    architectureNotes: '',
                },
                duration: 1234,
                tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
            };
            expect(result.duration).toBe(1234);
        });

        it('should allow constructing valid DeepWikiConfig', () => {
            const config: DeepWikiConfig = {
                output: './wiki',
                concurrency: 5,
                model: 'claude-sonnet',
                focus: 'src/',
                depth: 'normal',
                cache: '.wiki-cache',
                force: false,
                useCache: false,
                phase: 1,
            };
            expect(config.depth).toBe('normal');
        });

        it('should allow constructing valid CachedGraph', () => {
            const metadata: CacheMetadata = {
                gitHash: 'abc123def456',
                timestamp: Date.now(),
                version: '1.0.0',
                focus: 'src/',
            };
            const cached: CachedGraph = {
                metadata,
                graph: {
                    project: { name: 'p', description: '', language: 'TS', buildSystem: '', entryPoints: [] },
                    components: [],
                    categories: [],
                    architectureNotes: '',
                },
            };
            expect(cached.metadata.gitHash).toBe('abc123def456');
        });

        it('should allow constructing valid TopLevelDomain', () => {
            const domain: TopLevelDomain = {
                name: 'packages/core',
                path: 'packages/core',
                description: 'Core package',
            };
            expect(domain.name).toBe('packages/core');
        });

        it('should allow constructing valid StructuralScanResult', () => {
            const scan: StructuralScanResult = {
                fileCount: 5000,
                domains: [{ name: 'src', path: 'src', description: 'Source code' }],
                projectInfo: { name: 'my-project', language: 'TypeScript' },
            };
            expect(scan.fileCount).toBe(5000);
        });

        it('should allow constructing valid DiscoverCommandOptions', () => {
            const opts: DiscoverCommandOptions = {
                output: './wiki',
                model: 'claude-sonnet',
                timeout: 300,
                focus: 'src/',
                force: false,
                useCache: false,
                verbose: true,
            };
            expect(opts.output).toBe('./wiki');
        });
    });

    // ========================================================================
    // DomainInfo Type
    // ========================================================================

    describe('DomainInfo type', () => {
        it('should allow constructing valid DomainInfo', () => {
            const domain: DomainInfo = {
                id: 'packages-core',
                name: 'packages/core',
                path: 'packages/core',
                description: 'Core library modules',
                components: ['auth', 'database'],
            };
            expect(domain.id).toBe('packages-core');
            expect(domain.components).toHaveLength(2);
        });

        it('should allow empty modules array', () => {
            const domain: DomainInfo = {
                id: 'empty-domain',
                name: 'Empty',
                path: 'empty',
                description: 'No modules',
                components: [],
            };
            expect(domain.components).toHaveLength(0);
        });
    });

    // ========================================================================
    // ComponentGraph with Areas
    // ========================================================================

    describe('ComponentGraph with domains', () => {
        it('should allow ComponentGraph without domains (backward compat)', () => {
            const graph: ComponentGraph = {
                project: {
                    name: 'test',
                    description: '',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                components: [],
                categories: [],
                architectureNotes: '',
            };
            expect(graph.domains).toBeUndefined();
        });

        it('should allow ComponentGraph with domains', () => {
            const graph: ComponentGraph = {
                project: {
                    name: 'test',
                    description: '',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                components: [{
                    id: 'auth',
                    name: 'Auth',
                    path: 'src/auth/',
                    purpose: 'Auth',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'medium',
                    category: 'core',
                    domain: 'packages-core',
                }],
                categories: [],
                architectureNotes: '',
                domains: [{
                    id: 'packages-core',
                    name: 'Core',
                    path: 'packages/core',
                    description: 'Core library',
                    components: ['auth'],
                }],
            };
            expect(graph.domains).toHaveLength(1);
            expect(graph.components[0].domain).toBe('packages-core');
        });
    });

    // ========================================================================
    // Extended ArticleType and GeneratedArticle
    // ========================================================================

    describe('extended ArticleType', () => {
        it('should support area-index type', () => {
            const articleType: ArticleType = 'domain-index';
            expect(articleType).toBe('domain-index');
        });

        it('should support area-architecture type', () => {
            const articleType: ArticleType = 'domain-architecture';
            expect(articleType).toBe('domain-architecture');
        });

        it('should still support original types', () => {
            const types: ArticleType[] = ['component', 'index', 'architecture', 'getting-started'];
            expect(types).toHaveLength(4);
        });
    });

    describe('GeneratedArticle with domainId', () => {
        it('should allow GeneratedArticle without domainId (backward compat)', () => {
            const article: GeneratedArticle = {
                type: 'component',
                slug: 'auth',
                title: 'Auth',
                content: '# Auth',
                componentId: 'auth',
            };
            expect(article.domainId).toBeUndefined();
        });

        it('should allow GeneratedArticle with domainId', () => {
            const article: GeneratedArticle = {
                type: 'component',
                slug: 'auth',
                title: 'Auth',
                content: '# Auth',
                componentId: 'auth',
                domainId: 'packages-core',
            };
            expect(article.domainId).toBe('packages-core');
        });

        it('should allow area-index article with domainId', () => {
            const article: GeneratedArticle = {
                type: 'domain-index',
                slug: 'index',
                title: 'Core Overview',
                content: '# Core',
                domainId: 'packages-core',
            };
            expect(article.type).toBe('domain-index');
            expect(article.domainId).toBe('packages-core');
        });

        it('should allow area-architecture article with domainId', () => {
            const article: GeneratedArticle = {
                type: 'domain-architecture',
                slug: 'architecture',
                title: 'Core Architecture',
                content: '# Core Arch',
                domainId: 'packages-core',
            };
            expect(article.type).toBe('domain-architecture');
        });
    });

    // ========================================================================
    // Theme Generation Types
    // ========================================================================

    describe('ThemeRequest type', () => {
        it('should allow constructing a minimal ThemeRequest', () => {
            const req: ThemeRequest = { theme: 'compaction' };
            expect(req.theme).toBe('compaction');
            expect(req.description).toBeUndefined();
            expect(req.hints).toBeUndefined();
        });

        it('should allow constructing a full ThemeRequest', () => {
            const req: ThemeRequest = {
                theme: 'compaction',
                description: 'How LSM-tree compaction works',
                hints: ['compact', 'merge', 'level'],
            };
            expect(req.hints).toHaveLength(3);
        });
    });

    describe('ThemeCoverageCheck type', () => {
        it('should allow new status', () => {
            const check: ThemeCoverageCheck = {
                status: 'new',
                relatedComponents: [],
            };
            expect(check.status).toBe('new');
            expect(check.existingArticlePath).toBeUndefined();
        });

        it('should allow exists status with article path', () => {
            const check: ThemeCoverageCheck = {
                status: 'exists',
                existingArticlePath: 'themes/compaction/index.md',
                relatedComponents: [{
                    componentId: 'storage',
                    articlePath: 'modules/storage.md',
                    relevance: 'high',
                    matchReason: 'Contains compaction logic',
                }],
            };
            expect(check.relatedComponents).toHaveLength(1);
            expect(check.relatedComponents[0].relevance).toBe('high');
        });

        it('should allow partial status', () => {
            const check: ThemeCoverageCheck = {
                status: 'partial',
                relatedComponents: [
                    { componentId: 'a', articlePath: 'a.md', relevance: 'medium', matchReason: 'reason' },
                    { componentId: 'b', articlePath: 'b.md', relevance: 'low', matchReason: 'reason' },
                ],
            };
            expect(check.relatedComponents).toHaveLength(2);
        });
    });

    describe('ThemeOutline type', () => {
        it('should allow constructing a single-layout outline', () => {
            const outline: ThemeOutline = {
                themeId: 'compaction',
                title: 'Compaction',
                layout: 'single',
                articles: [{
                    slug: 'compaction',
                    title: 'Compaction',
                    description: 'Overview of compaction',
                    isIndex: true,
                    coveredComponentIds: ['storage'],
                    coveredFiles: ['src/storage/compact.ts'],
                }],
                involvedComponents: [{
                    componentId: 'storage',
                    role: 'Primary compaction engine',
                    keyFiles: ['src/storage/compact.ts'],
                }],
            };
            expect(outline.layout).toBe('single');
            expect(outline.articles).toHaveLength(1);
            expect(outline.articles[0].isIndex).toBe(true);
        });

        it('should allow constructing an area-layout outline', () => {
            const outline: ThemeOutline = {
                themeId: 'auth',
                title: 'Authentication',
                layout: 'area',
                articles: [
                    { slug: 'index', title: 'Auth Overview', description: 'Overview', isIndex: true, coveredComponentIds: [], coveredFiles: [] },
                    { slug: 'jwt', title: 'JWT Tokens', description: 'JWT handling', isIndex: false, coveredComponentIds: ['auth'], coveredFiles: [] },
                ],
                involvedComponents: [],
            };
            expect(outline.layout).toBe('area');
            expect(outline.articles).toHaveLength(2);
        });
    });

    describe('ThemeAnalysis type', () => {
        it('should allow constructing a full ThemeAnalysis', () => {
            const analysis: ThemeAnalysis = {
                themeId: 'compaction',
                overview: 'Compaction is the process of merging SSTables',
                perArticle: [{
                    slug: 'compaction',
                    keyConcepts: [{ name: 'SSTable', description: 'Sorted string table', codeRef: 'src/sstable.ts' }],
                    dataFlow: 'Input SSTables → Merge → Output SSTable',
                    codeExamples: [{ title: 'Basic compaction', code: 'compact()', file: 'src/compact.ts' }],
                    internalDetails: 'Uses leveled compaction strategy',
                }],
                crossCutting: {
                    architecture: 'Tiered compaction',
                    dataFlow: 'Memtable → L0 → L1 → ...',
                    suggestedDiagram: 'graph TD; A-->B',
                    configuration: 'max_compaction_bytes',
                    relatedThemes: ['storage', 'write-path'],
                },
            };
            expect(analysis.perArticle).toHaveLength(1);
            expect(analysis.crossCutting.relatedThemes).toHaveLength(2);
        });

        it('should allow minimal cross-cutting analysis', () => {
            const analysis: ThemeAnalysis = {
                themeId: 'test',
                overview: 'Test',
                perArticle: [],
                crossCutting: {
                    architecture: 'Simple',
                    dataFlow: 'A → B',
                    suggestedDiagram: '',
                },
            };
            expect(analysis.crossCutting.configuration).toBeUndefined();
            expect(analysis.crossCutting.relatedThemes).toBeUndefined();
        });
    });

    describe('ThemeArticle type', () => {
        it('should allow theme-index article', () => {
            const article: ThemeArticle = {
                type: 'theme-index',
                slug: 'index',
                title: 'Compaction Overview',
                content: '# Compaction',
                themeId: 'compaction',
                coveredComponentIds: ['storage', 'lsm'],
            };
            expect(article.type).toBe('theme-index');
        });

        it('should allow theme-article type', () => {
            const article: ThemeArticle = {
                type: 'theme-article',
                slug: 'leveled-compaction',
                title: 'Leveled Compaction',
                content: '# Leveled Compaction',
                themeId: 'compaction',
                coveredComponentIds: [],
            };
            expect(article.type).toBe('theme-article');
        });
    });

    describe('ThemeMeta type', () => {
        it('should allow constructing a full ThemeMeta', () => {
            const meta: ThemeMeta = {
                id: 'compaction',
                title: 'Compaction',
                description: 'LSM-tree compaction processes',
                layout: 'area',
                articles: [
                    { slug: 'index', title: 'Overview', path: 'themes/compaction/index.md' },
                    { slug: 'leveled', title: 'Leveled', path: 'themes/compaction/leveled.md' },
                ],
                involvedComponentIds: ['storage', 'lsm'],
                directoryPath: 'themes/compaction',
                generatedAt: Date.now(),
                gitHash: 'abc123',
            };
            expect(meta.articles).toHaveLength(2);
            expect(meta.involvedComponentIds).toHaveLength(2);
        });

        it('should allow ThemeMeta without gitHash', () => {
            const meta: ThemeMeta = {
                id: 'auth',
                title: 'Auth',
                description: 'Auth theme',
                layout: 'single',
                articles: [{ slug: 'auth', title: 'Auth', path: 'themes/auth.md' }],
                involvedComponentIds: [],
                directoryPath: 'themes/auth',
                generatedAt: 1700000000000,
            };
            expect(meta.gitHash).toBeUndefined();
        });
    });

    describe('ThemeCommandOptions type', () => {
        it('should allow constructing full ThemeCommandOptions', () => {
            const opts: ThemeCommandOptions = {
                theme: 'compaction',
                description: 'How compaction works',
                wiki: './wiki',
                force: false,
                check: false,
                list: false,
                model: 'claude-sonnet',
                depth: 'normal',
                timeout: 300,
                concurrency: 5,
                noCrossLink: false,
                noWebsite: false,
                interactive: true,
                verbose: false,
            };
            expect(opts.theme).toBe('compaction');
            expect(opts.depth).toBe('normal');
        });

        it('should allow minimal ThemeCommandOptions', () => {
            const opts: ThemeCommandOptions = {
                theme: 'auth',
                wiki: './wiki',
                force: false,
                check: false,
                list: false,
                depth: 'shallow',
                timeout: 120,
                concurrency: 3,
                noCrossLink: false,
                noWebsite: false,
                interactive: false,
                verbose: false,
            };
            expect(opts.description).toBeUndefined();
            expect(opts.model).toBeUndefined();
        });
    });

    describe('ComponentGraph with themes', () => {
        it('should allow ComponentGraph without themes (backward compat)', () => {
            const graph: ComponentGraph = {
                project: {
                    name: 'test',
                    description: '',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                components: [],
                categories: [],
                architectureNotes: '',
            };
            expect(graph.themes).toBeUndefined();
        });

        it('should allow ComponentGraph with themes', () => {
            const graph: ComponentGraph = {
                project: {
                    name: 'test',
                    description: '',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                components: [],
                categories: [],
                architectureNotes: '',
                themes: [{
                    id: 'compaction',
                    title: 'Compaction',
                    description: 'LSM-tree compaction',
                    layout: 'area',
                    articles: [{ slug: 'index', title: 'Overview', path: 'themes/compaction/index.md' }],
                    involvedComponentIds: ['storage'],
                    directoryPath: 'themes/compaction',
                    generatedAt: Date.now(),
                }],
            };
            expect(graph.themes).toHaveLength(1);
            expect(graph.themes![0].id).toBe('compaction');
        });
    });

    // ========================================================================
    // ComponentInfo with domain
    // ========================================================================

    describe('ComponentInfo with domain', () => {
        it('should allow ComponentInfo without domain (backward compat)', () => {
            const mod: ComponentInfo = {
                id: 'auth',
                name: 'Auth',
                path: 'src/auth/',
                purpose: 'Authentication',
                keyFiles: [],
                dependencies: [],
                dependents: [],
                complexity: 'medium',
                category: 'core',
            };
            expect(mod.domain).toBeUndefined();
        });

        it('should allow ComponentInfo with domain', () => {
            const mod: ComponentInfo = {
                id: 'auth',
                name: 'Auth',
                path: 'src/auth/',
                purpose: 'Authentication',
                keyFiles: [],
                dependencies: [],
                dependents: [],
                complexity: 'medium',
                category: 'core',
                domain: 'packages-core',
            };
            expect(mod.domain).toBe('packages-core');
        });
    });
});
