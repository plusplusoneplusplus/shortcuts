/**
 * Types Tests
 *
 * Tests for type validation, schema helpers, and module ID normalization.
 */

import { describe, it, expect } from 'vitest';
import { isValidModuleId, normalizeModuleId, MODULE_GRAPH_REQUIRED_FIELDS, PROJECT_INFO_REQUIRED_FIELDS, MODULE_INFO_REQUIRED_FIELDS, VALID_COMPLEXITY_VALUES, MODULE_GRAPH_SCHEMA, STRUCTURAL_SCAN_SCHEMA } from '../src/schemas';
import type { ModuleGraph, ModuleInfo, ProjectInfo, CategoryInfo, DiscoveryOptions, DiscoveryResult, DeepWikiConfig, DiscoverCommandOptions, TopLevelArea, StructuralScanResult, CacheMetadata, CachedGraph, AreaInfo, GeneratedArticle, ArticleType, TopicRequest, TopicCoverageCheck, TopicOutline, TopicAnalysis, TopicArticle, TopicAreaMeta, TopicCommandOptions } from '../src/types';

describe('Types and Schemas', () => {
    // ========================================================================
    // Module ID Validation
    // ========================================================================

    describe('isValidModuleId', () => {
        it('should accept simple lowercase IDs', () => {
            expect(isValidModuleId('auth')).toBe(true);
            expect(isValidModuleId('database')).toBe(true);
            expect(isValidModuleId('api')).toBe(true);
        });

        it('should accept kebab-case IDs', () => {
            expect(isValidModuleId('auth-service')).toBe(true);
            expect(isValidModuleId('database-layer')).toBe(true);
            expect(isValidModuleId('my-long-module-name')).toBe(true);
        });

        it('should accept IDs with numbers', () => {
            expect(isValidModuleId('module1')).toBe(true);
            expect(isValidModuleId('v2-api')).toBe(true);
            expect(isValidModuleId('auth-v3')).toBe(true);
        });

        it('should reject IDs starting with numbers', () => {
            expect(isValidModuleId('123')).toBe(false);
            expect(isValidModuleId('1module')).toBe(false);
        });

        it('should reject IDs with uppercase letters', () => {
            expect(isValidModuleId('Auth')).toBe(false);
            expect(isValidModuleId('AUTH')).toBe(false);
            expect(isValidModuleId('myModule')).toBe(false);
        });

        it('should reject IDs with special characters', () => {
            expect(isValidModuleId('auth_service')).toBe(false);
            expect(isValidModuleId('auth.service')).toBe(false);
            expect(isValidModuleId('auth/service')).toBe(false);
            expect(isValidModuleId('auth service')).toBe(false);
        });

        it('should reject IDs with leading or trailing hyphens', () => {
            expect(isValidModuleId('-auth')).toBe(false);
            expect(isValidModuleId('auth-')).toBe(false);
            expect(isValidModuleId('-auth-')).toBe(false);
        });

        it('should reject IDs with consecutive hyphens', () => {
            expect(isValidModuleId('auth--service')).toBe(false);
        });

        it('should reject empty strings', () => {
            expect(isValidModuleId('')).toBe(false);
        });
    });

    // ========================================================================
    // Module ID Normalization
    // ========================================================================

    describe('normalizeModuleId', () => {
        it('should lowercase the input', () => {
            expect(normalizeModuleId('Auth')).toBe('auth');
            expect(normalizeModuleId('AUTH')).toBe('auth');
            expect(normalizeModuleId('MyModule')).toBe('mymodule');
        });

        it('should replace special characters with hyphens', () => {
            expect(normalizeModuleId('auth_service')).toBe('auth-service');
            expect(normalizeModuleId('auth.service')).toBe('auth-service');
            expect(normalizeModuleId('auth/service')).toBe('auth-service');
            expect(normalizeModuleId('auth service')).toBe('auth-service');
        });

        it('should trim leading/trailing hyphens', () => {
            expect(normalizeModuleId('-auth-')).toBe('auth');
            expect(normalizeModuleId('--auth--')).toBe('auth');
        });

        it('should collapse consecutive hyphens', () => {
            expect(normalizeModuleId('auth--service')).toBe('auth-service');
            expect(normalizeModuleId('a___b')).toBe('a-b');
        });

        it('should return "unknown" for empty/invalid input', () => {
            expect(normalizeModuleId('')).toBe('unknown');
            expect(normalizeModuleId('---')).toBe('unknown');
            expect(normalizeModuleId('...')).toBe('unknown');
        });

        it('should handle complex paths', () => {
            expect(normalizeModuleId('src/auth/')).toBe('src-auth');
            expect(normalizeModuleId('packages/core/src')).toBe('packages-core-src');
        });
    });

    // ========================================================================
    // Required Fields Constants
    // ========================================================================

    describe('Required field constants', () => {
        it('should define MODULE_GRAPH_REQUIRED_FIELDS', () => {
            expect(MODULE_GRAPH_REQUIRED_FIELDS).toContain('project');
            expect(MODULE_GRAPH_REQUIRED_FIELDS).toContain('modules');
            expect(MODULE_GRAPH_REQUIRED_FIELDS).toContain('categories');
        });

        it('should define PROJECT_INFO_REQUIRED_FIELDS', () => {
            expect(PROJECT_INFO_REQUIRED_FIELDS).toContain('name');
            expect(PROJECT_INFO_REQUIRED_FIELDS).toContain('language');
        });

        it('should define MODULE_INFO_REQUIRED_FIELDS', () => {
            expect(MODULE_INFO_REQUIRED_FIELDS).toContain('id');
            expect(MODULE_INFO_REQUIRED_FIELDS).toContain('name');
            expect(MODULE_INFO_REQUIRED_FIELDS).toContain('path');
        });

        it('should define VALID_COMPLEXITY_VALUES', () => {
            expect(VALID_COMPLEXITY_VALUES).toEqual(['low', 'medium', 'high']);
        });
    });

    // ========================================================================
    // Schema Strings
    // ========================================================================

    describe('Schema strings', () => {
        it('should define MODULE_GRAPH_SCHEMA as a non-empty string', () => {
            expect(typeof MODULE_GRAPH_SCHEMA).toBe('string');
            expect(MODULE_GRAPH_SCHEMA.length).toBeGreaterThan(100);
            expect(MODULE_GRAPH_SCHEMA).toContain('project');
            expect(MODULE_GRAPH_SCHEMA).toContain('modules');
            expect(MODULE_GRAPH_SCHEMA).toContain('categories');
            expect(MODULE_GRAPH_SCHEMA).toContain('architectureNotes');
        });

        it('should define STRUCTURAL_SCAN_SCHEMA as a non-empty string', () => {
            expect(typeof STRUCTURAL_SCAN_SCHEMA).toBe('string');
            expect(STRUCTURAL_SCAN_SCHEMA.length).toBeGreaterThan(50);
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('fileCount');
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('domains');
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('projectInfo');
        });

        // Feature-focus schema hint tests
        it('should include feature-focused guidance in MODULE_GRAPH_SCHEMA id field', () => {
            expect(MODULE_GRAPH_SCHEMA).toContain('describing the FEATURE');
            expect(MODULE_GRAPH_SCHEMA).toContain('NOT the file/directory path');
        });

        it('should include feature-focused guidance in MODULE_GRAPH_SCHEMA name field', () => {
            expect(MODULE_GRAPH_SCHEMA).toContain('what this module DOES for users/system');
            expect(MODULE_GRAPH_SCHEMA).toContain('NOT the file name');
        });

        it('should include feature-focused guidance in MODULE_GRAPH_SCHEMA purpose field', () => {
            expect(MODULE_GRAPH_SCHEMA).toContain('what this module does for users or the system');
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
        it('should allow constructing a valid ModuleGraph', () => {
            const graph: ModuleGraph = {
                project: {
                    name: 'test-project',
                    description: 'A test project',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: ['src/index.ts'],
                },
                modules: [
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
            expect(graph.modules).toHaveLength(1);
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
                    modules: [],
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
                    modules: [],
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
                modules: ['auth', 'database'],
            };
            expect(domain.id).toBe('packages-core');
            expect(domain.modules).toHaveLength(2);
        });

        it('should allow empty modules array', () => {
            const domain: DomainInfo = {
                id: 'empty-domain',
                name: 'Empty',
                path: 'empty',
                description: 'No modules',
                modules: [],
            };
            expect(domain.modules).toHaveLength(0);
        });
    });

    // ========================================================================
    // ModuleGraph with Areas
    // ========================================================================

    describe('ModuleGraph with domains', () => {
        it('should allow ModuleGraph without domains (backward compat)', () => {
            const graph: ModuleGraph = {
                project: {
                    name: 'test',
                    description: '',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                modules: [],
                categories: [],
                architectureNotes: '',
            };
            expect(graph.domains).toBeUndefined();
        });

        it('should allow ModuleGraph with domains', () => {
            const graph: ModuleGraph = {
                project: {
                    name: 'test',
                    description: '',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                modules: [{
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
                    modules: ['auth'],
                }],
            };
            expect(graph.domains).toHaveLength(1);
            expect(graph.modules[0].domain).toBe('packages-core');
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
            const types: ArticleType[] = ['module', 'index', 'architecture', 'getting-started'];
            expect(types).toHaveLength(4);
        });
    });

    describe('GeneratedArticle with domainId', () => {
        it('should allow GeneratedArticle without domainId (backward compat)', () => {
            const article: GeneratedArticle = {
                type: 'module',
                slug: 'auth',
                title: 'Auth',
                content: '# Auth',
                moduleId: 'auth',
            };
            expect(article.domainId).toBeUndefined();
        });

        it('should allow GeneratedArticle with domainId', () => {
            const article: GeneratedArticle = {
                type: 'module',
                slug: 'auth',
                title: 'Auth',
                content: '# Auth',
                moduleId: 'auth',
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
    // Topic Generation Types
    // ========================================================================

    describe('TopicRequest type', () => {
        it('should allow constructing a minimal TopicRequest', () => {
            const req: TopicRequest = { topic: 'compaction' };
            expect(req.topic).toBe('compaction');
            expect(req.description).toBeUndefined();
            expect(req.hints).toBeUndefined();
        });

        it('should allow constructing a full TopicRequest', () => {
            const req: TopicRequest = {
                topic: 'compaction',
                description: 'How LSM-tree compaction works',
                hints: ['compact', 'merge', 'level'],
            };
            expect(req.hints).toHaveLength(3);
        });
    });

    describe('TopicCoverageCheck type', () => {
        it('should allow new status', () => {
            const check: TopicCoverageCheck = {
                status: 'new',
                relatedModules: [],
            };
            expect(check.status).toBe('new');
            expect(check.existingArticlePath).toBeUndefined();
        });

        it('should allow exists status with article path', () => {
            const check: TopicCoverageCheck = {
                status: 'exists',
                existingArticlePath: 'topics/compaction/index.md',
                relatedModules: [{
                    moduleId: 'storage',
                    articlePath: 'modules/storage.md',
                    relevance: 'high',
                    matchReason: 'Contains compaction logic',
                }],
            };
            expect(check.relatedModules).toHaveLength(1);
            expect(check.relatedModules[0].relevance).toBe('high');
        });

        it('should allow partial status', () => {
            const check: TopicCoverageCheck = {
                status: 'partial',
                relatedModules: [
                    { moduleId: 'a', articlePath: 'a.md', relevance: 'medium', matchReason: 'reason' },
                    { moduleId: 'b', articlePath: 'b.md', relevance: 'low', matchReason: 'reason' },
                ],
            };
            expect(check.relatedModules).toHaveLength(2);
        });
    });

    describe('TopicOutline type', () => {
        it('should allow constructing a single-layout outline', () => {
            const outline: TopicOutline = {
                topicId: 'compaction',
                title: 'Compaction',
                layout: 'single',
                articles: [{
                    slug: 'compaction',
                    title: 'Compaction',
                    description: 'Overview of compaction',
                    isIndex: true,
                    coveredModuleIds: ['storage'],
                    coveredFiles: ['src/storage/compact.ts'],
                }],
                involvedModules: [{
                    moduleId: 'storage',
                    role: 'Primary compaction engine',
                    keyFiles: ['src/storage/compact.ts'],
                }],
            };
            expect(outline.layout).toBe('single');
            expect(outline.articles).toHaveLength(1);
            expect(outline.articles[0].isIndex).toBe(true);
        });

        it('should allow constructing an area-layout outline', () => {
            const outline: TopicOutline = {
                topicId: 'auth',
                title: 'Authentication',
                layout: 'area',
                articles: [
                    { slug: 'index', title: 'Auth Overview', description: 'Overview', isIndex: true, coveredModuleIds: [], coveredFiles: [] },
                    { slug: 'jwt', title: 'JWT Tokens', description: 'JWT handling', isIndex: false, coveredModuleIds: ['auth'], coveredFiles: [] },
                ],
                involvedModules: [],
            };
            expect(outline.layout).toBe('area');
            expect(outline.articles).toHaveLength(2);
        });
    });

    describe('TopicAnalysis type', () => {
        it('should allow constructing a full TopicAnalysis', () => {
            const analysis: TopicAnalysis = {
                topicId: 'compaction',
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
                    relatedTopics: ['storage', 'write-path'],
                },
            };
            expect(analysis.perArticle).toHaveLength(1);
            expect(analysis.crossCutting.relatedTopics).toHaveLength(2);
        });

        it('should allow minimal cross-cutting analysis', () => {
            const analysis: TopicAnalysis = {
                topicId: 'test',
                overview: 'Test',
                perArticle: [],
                crossCutting: {
                    architecture: 'Simple',
                    dataFlow: 'A → B',
                    suggestedDiagram: '',
                },
            };
            expect(analysis.crossCutting.configuration).toBeUndefined();
            expect(analysis.crossCutting.relatedTopics).toBeUndefined();
        });
    });

    describe('TopicArticle type', () => {
        it('should allow topic-index article', () => {
            const article: TopicArticle = {
                type: 'topic-index',
                slug: 'index',
                title: 'Compaction Overview',
                content: '# Compaction',
                topicId: 'compaction',
                coveredModuleIds: ['storage', 'lsm'],
            };
            expect(article.type).toBe('topic-index');
        });

        it('should allow topic-article type', () => {
            const article: TopicArticle = {
                type: 'topic-article',
                slug: 'leveled-compaction',
                title: 'Leveled Compaction',
                content: '# Leveled Compaction',
                topicId: 'compaction',
                coveredModuleIds: [],
            };
            expect(article.type).toBe('topic-article');
        });
    });

    describe('TopicAreaMeta type', () => {
        it('should allow constructing a full TopicAreaMeta', () => {
            const meta: TopicAreaMeta = {
                id: 'compaction',
                title: 'Compaction',
                description: 'LSM-tree compaction processes',
                layout: 'area',
                articles: [
                    { slug: 'index', title: 'Overview', path: 'topics/compaction/index.md' },
                    { slug: 'leveled', title: 'Leveled', path: 'topics/compaction/leveled.md' },
                ],
                involvedModuleIds: ['storage', 'lsm'],
                directoryPath: 'topics/compaction',
                generatedAt: Date.now(),
                gitHash: 'abc123',
            };
            expect(meta.articles).toHaveLength(2);
            expect(meta.involvedModuleIds).toHaveLength(2);
        });

        it('should allow TopicAreaMeta without gitHash', () => {
            const meta: TopicAreaMeta = {
                id: 'auth',
                title: 'Auth',
                description: 'Auth topic',
                layout: 'single',
                articles: [{ slug: 'auth', title: 'Auth', path: 'topics/auth.md' }],
                involvedModuleIds: [],
                directoryPath: 'topics/auth',
                generatedAt: 1700000000000,
            };
            expect(meta.gitHash).toBeUndefined();
        });
    });

    describe('TopicCommandOptions type', () => {
        it('should allow constructing full TopicCommandOptions', () => {
            const opts: TopicCommandOptions = {
                topic: 'compaction',
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
            expect(opts.topic).toBe('compaction');
            expect(opts.depth).toBe('normal');
        });

        it('should allow minimal TopicCommandOptions', () => {
            const opts: TopicCommandOptions = {
                topic: 'auth',
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

    describe('ModuleGraph with topics', () => {
        it('should allow ModuleGraph without topics (backward compat)', () => {
            const graph: ModuleGraph = {
                project: {
                    name: 'test',
                    description: '',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                modules: [],
                categories: [],
                architectureNotes: '',
            };
            expect(graph.topics).toBeUndefined();
        });

        it('should allow ModuleGraph with topics', () => {
            const graph: ModuleGraph = {
                project: {
                    name: 'test',
                    description: '',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                modules: [],
                categories: [],
                architectureNotes: '',
                topics: [{
                    id: 'compaction',
                    title: 'Compaction',
                    description: 'LSM-tree compaction',
                    layout: 'area',
                    articles: [{ slug: 'index', title: 'Overview', path: 'topics/compaction/index.md' }],
                    involvedModuleIds: ['storage'],
                    directoryPath: 'topics/compaction',
                    generatedAt: Date.now(),
                }],
            };
            expect(graph.topics).toHaveLength(1);
            expect(graph.topics![0].id).toBe('compaction');
        });
    });

    // ========================================================================
    // ModuleInfo with domain
    // ========================================================================

    describe('ModuleInfo with domain', () => {
        it('should allow ModuleInfo without domain (backward compat)', () => {
            const mod: ModuleInfo = {
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

        it('should allow ModuleInfo with domain', () => {
            const mod: ModuleInfo = {
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
