/**
 * Types Tests
 *
 * Tests for type validation, schema helpers, and module ID normalization.
 */

import { describe, it, expect } from 'vitest';
import { isValidModuleId, normalizeModuleId, MODULE_GRAPH_REQUIRED_FIELDS, PROJECT_INFO_REQUIRED_FIELDS, MODULE_INFO_REQUIRED_FIELDS, VALID_COMPLEXITY_VALUES, MODULE_GRAPH_SCHEMA, STRUCTURAL_SCAN_SCHEMA } from '../src/schemas';
import type { ModuleGraph, ModuleInfo, ProjectInfo, CategoryInfo, DiscoveryOptions, DiscoveryResult, DeepWikiConfig, DiscoverCommandOptions, TopLevelArea, StructuralScanResult, CacheMetadata, CachedGraph, AreaInfo, GeneratedArticle, ArticleType } from '../src/types';

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
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('areas');
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('projectInfo');
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

        it('should allow constructing valid TopLevelArea', () => {
            const area: TopLevelArea = {
                name: 'packages/core',
                path: 'packages/core',
                description: 'Core package',
            };
            expect(area.name).toBe('packages/core');
        });

        it('should allow constructing valid StructuralScanResult', () => {
            const scan: StructuralScanResult = {
                fileCount: 5000,
                areas: [{ name: 'src', path: 'src', description: 'Source code' }],
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
    // AreaInfo Type
    // ========================================================================

    describe('AreaInfo type', () => {
        it('should allow constructing valid AreaInfo', () => {
            const area: AreaInfo = {
                id: 'packages-core',
                name: 'packages/core',
                path: 'packages/core',
                description: 'Core library modules',
                modules: ['auth', 'database'],
            };
            expect(area.id).toBe('packages-core');
            expect(area.modules).toHaveLength(2);
        });

        it('should allow empty modules array', () => {
            const area: AreaInfo = {
                id: 'empty-area',
                name: 'Empty',
                path: 'empty',
                description: 'No modules',
                modules: [],
            };
            expect(area.modules).toHaveLength(0);
        });
    });

    // ========================================================================
    // ModuleGraph with Areas
    // ========================================================================

    describe('ModuleGraph with areas', () => {
        it('should allow ModuleGraph without areas (backward compat)', () => {
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
            expect(graph.areas).toBeUndefined();
        });

        it('should allow ModuleGraph with areas', () => {
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
                    area: 'packages-core',
                }],
                categories: [],
                architectureNotes: '',
                areas: [{
                    id: 'packages-core',
                    name: 'Core',
                    path: 'packages/core',
                    description: 'Core library',
                    modules: ['auth'],
                }],
            };
            expect(graph.areas).toHaveLength(1);
            expect(graph.modules[0].area).toBe('packages-core');
        });
    });

    // ========================================================================
    // Extended ArticleType and GeneratedArticle
    // ========================================================================

    describe('extended ArticleType', () => {
        it('should support area-index type', () => {
            const articleType: ArticleType = 'area-index';
            expect(articleType).toBe('area-index');
        });

        it('should support area-architecture type', () => {
            const articleType: ArticleType = 'area-architecture';
            expect(articleType).toBe('area-architecture');
        });

        it('should still support original types', () => {
            const types: ArticleType[] = ['module', 'index', 'architecture', 'getting-started'];
            expect(types).toHaveLength(4);
        });
    });

    describe('GeneratedArticle with areaId', () => {
        it('should allow GeneratedArticle without areaId (backward compat)', () => {
            const article: GeneratedArticle = {
                type: 'module',
                slug: 'auth',
                title: 'Auth',
                content: '# Auth',
                moduleId: 'auth',
            };
            expect(article.areaId).toBeUndefined();
        });

        it('should allow GeneratedArticle with areaId', () => {
            const article: GeneratedArticle = {
                type: 'module',
                slug: 'auth',
                title: 'Auth',
                content: '# Auth',
                moduleId: 'auth',
                areaId: 'packages-core',
            };
            expect(article.areaId).toBe('packages-core');
        });

        it('should allow area-index article with areaId', () => {
            const article: GeneratedArticle = {
                type: 'area-index',
                slug: 'index',
                title: 'Core Overview',
                content: '# Core',
                areaId: 'packages-core',
            };
            expect(article.type).toBe('area-index');
            expect(article.areaId).toBe('packages-core');
        });

        it('should allow area-architecture article with areaId', () => {
            const article: GeneratedArticle = {
                type: 'area-architecture',
                slug: 'architecture',
                title: 'Core Architecture',
                content: '# Core Arch',
                areaId: 'packages-core',
            };
            expect(article.type).toBe('area-architecture');
        });
    });

    // ========================================================================
    // ModuleInfo with area
    // ========================================================================

    describe('ModuleInfo with area', () => {
        it('should allow ModuleInfo without area (backward compat)', () => {
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
            expect(mod.area).toBeUndefined();
        });

        it('should allow ModuleInfo with area', () => {
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
                area: 'packages-core',
            };
            expect(mod.area).toBe('packages-core');
        });
    });
});
