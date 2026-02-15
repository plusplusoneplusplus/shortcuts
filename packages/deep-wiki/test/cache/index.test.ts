/**
 * Cache Manager Tests
 *
 * Tests for cache read/write, invalidation, and path management.
 * Uses temporary directories for isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    getCacheDir,
    getGraphCachePath,
    getCachedGraph,
    getCachedGraphAny,
    saveGraph,
    clearCache,
    hasCachedGraph,
    getAnalysisCachePath,
    scanIndividualAnalysesCacheAny,
    getArticleCachePath,
    scanIndividualArticlesCacheAny,
} from '../../src/cache';
import type { ComponentGraph, CachedGraph, CachedAnalysis, CachedArticle } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tmpDir: string;

const createTestGraph = (): ComponentGraph => ({
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
            purpose: 'Core logic',
            keyFiles: ['src/core/index.ts'],
            dependencies: [],
            dependents: [],
            complexity: 'medium',
            category: 'core',
        },
    ],
    categories: [
        { name: 'core', description: 'Core modules' },
    ],
    architectureNotes: 'Simple architecture',
});

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-cache-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Cache Paths', () => {
    describe('getCacheDir', () => {
        it('should return path with .wiki-cache suffix', () => {
            const cacheDir = getCacheDir('/output/wiki');
            expect(cacheDir).toContain('.wiki-cache');
            expect(path.basename(cacheDir)).toBe('.wiki-cache');
        });

        it('should be inside the output directory', () => {
            const cacheDir = getCacheDir('/output/wiki');
            expect(cacheDir).toContain('wiki');
        });
    });

    describe('getGraphCachePath', () => {
        it('should return path to component-graph.json', () => {
            const cachePath = getGraphCachePath('/output/wiki');
            expect(path.basename(cachePath)).toBe('component-graph.json');
        });

        it('should be inside the cache directory', () => {
            const cachePath = getGraphCachePath('/output/wiki');
            const cacheDir = getCacheDir('/output/wiki');
            expect(cachePath.startsWith(cacheDir)).toBe(true);
        });
    });
});

describe('Cache Read/Write', () => {
    describe('getCachedGraph', () => {
        it('should return null when no cache exists', async () => {
            const result = await getCachedGraph('/some/repo', path.join(tmpDir, 'output'));
            expect(result).toBeNull();
        });

        it('should return null for corrupted cache file', async () => {
            const outputDir = path.join(tmpDir, 'output');
            const cacheDir = getCacheDir(outputDir);
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(getGraphCachePath(outputDir), 'not valid json', 'utf-8');

            const result = await getCachedGraph('/some/repo', outputDir);
            expect(result).toBeNull();
        });

        it('should return null for cache with missing metadata', async () => {
            const outputDir = path.join(tmpDir, 'output');
            const cacheDir = getCacheDir(outputDir);
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(
                getGraphCachePath(outputDir),
                JSON.stringify({ graph: createTestGraph() }),
                'utf-8'
            );

            const result = await getCachedGraph('/some/repo', outputDir);
            expect(result).toBeNull();
        });

        it('should return null for cache with missing graph', async () => {
            const outputDir = path.join(tmpDir, 'output');
            const cacheDir = getCacheDir(outputDir);
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(
                getGraphCachePath(outputDir),
                JSON.stringify({ metadata: { gitHash: 'abc', timestamp: Date.now(), version: '1.0.0' } }),
                'utf-8'
            );

            const result = await getCachedGraph('/some/repo', outputDir);
            expect(result).toBeNull();
        });

        it('should return null when git hash does not match', async () => {
            // This test uses the actual workspace as repo, whose hash won't match
            const outputDir = path.join(tmpDir, 'output');
            const cacheDir = getCacheDir(outputDir);
            fs.mkdirSync(cacheDir, { recursive: true });

            const cached: CachedGraph = {
                metadata: {
                    gitHash: '0000000000000000000000000000000000000000', // Won't match
                    timestamp: Date.now(),
                    version: '1.0.0',
                },
                graph: createTestGraph(),
            };
            fs.writeFileSync(getGraphCachePath(outputDir), JSON.stringify(cached), 'utf-8');

            // Use the actual workspace as repoPath (it's a git repo)
            const workspaceRoot = path.resolve(__dirname, '../../../../');
            const result = await getCachedGraph(workspaceRoot, outputDir);
            expect(result).toBeNull(); // Hash won't match
        });

        it('should return null for non-git repo path', async () => {
            const outputDir = path.join(tmpDir, 'output');
            const cacheDir = getCacheDir(outputDir);
            fs.mkdirSync(cacheDir, { recursive: true });

            const cached: CachedGraph = {
                metadata: {
                    gitHash: 'abc123',
                    timestamp: Date.now(),
                    version: '1.0.0',
                },
                graph: createTestGraph(),
            };
            fs.writeFileSync(getGraphCachePath(outputDir), JSON.stringify(cached), 'utf-8');

            const result = await getCachedGraph('/tmp', outputDir);
            expect(result).toBeNull(); // Can't determine git hash for /tmp
        });
    });

    describe('saveGraph', () => {
        it('should create cache directory if it does not exist', async () => {
            const outputDir = path.join(tmpDir, 'output');
            const graph = createTestGraph();

            // Use actual workspace root as repo path
            const workspaceRoot = path.resolve(__dirname, '../../../../');
            await saveGraph(workspaceRoot, graph, outputDir);

            const cacheDir = getCacheDir(outputDir);
            expect(fs.existsSync(cacheDir)).toBe(true);
        });

        it('should write a valid JSON cache file', async () => {
            const outputDir = path.join(tmpDir, 'output');
            const graph = createTestGraph();

            const workspaceRoot = path.resolve(__dirname, '../../../../');
            await saveGraph(workspaceRoot, graph, outputDir);

            const cachePath = getGraphCachePath(outputDir);
            expect(fs.existsSync(cachePath)).toBe(true);

            const content = fs.readFileSync(cachePath, 'utf-8');
            const parsed = JSON.parse(content) as CachedGraph;
            expect(parsed.metadata).toBeDefined();
            expect(parsed.graph).toBeDefined();
            expect(parsed.metadata.gitHash).toMatch(/^[0-9a-f]{40}$/);
            expect(parsed.graph.project.name).toBe('test-project');
        });

        it('should store focus in metadata when provided', async () => {
            const outputDir = path.join(tmpDir, 'output');
            const graph = createTestGraph();

            const workspaceRoot = path.resolve(__dirname, '../../../../');
            await saveGraph(workspaceRoot, graph, outputDir, 'src/');

            const cachePath = getGraphCachePath(outputDir);
            const content = fs.readFileSync(cachePath, 'utf-8');
            const parsed = JSON.parse(content) as CachedGraph;
            expect(parsed.metadata.focus).toBe('src/');
        });

        it('should not write cache for non-git directory', async () => {
            const outputDir = path.join(tmpDir, 'output');
            const graph = createTestGraph();

            await saveGraph('/tmp', graph, outputDir);

            const cachePath = getGraphCachePath(outputDir);
            expect(fs.existsSync(cachePath)).toBe(false);
        });
    });
});

describe('Cache Invalidation', () => {
    describe('clearCache', () => {
        it('should return false when no cache exists', () => {
            const outputDir = path.join(tmpDir, 'output');
            expect(clearCache(outputDir)).toBe(false);
        });

        it('should delete cache file and return true', () => {
            const outputDir = path.join(tmpDir, 'output');
            const cacheDir = getCacheDir(outputDir);
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(getGraphCachePath(outputDir), '{}', 'utf-8');

            expect(clearCache(outputDir)).toBe(true);
            expect(fs.existsSync(getGraphCachePath(outputDir))).toBe(false);
        });
    });

    describe('hasCachedGraph', () => {
        it('should return false when no cache exists', async () => {
            const result = await hasCachedGraph('/some/repo', path.join(tmpDir, 'output'));
            expect(result).toBe(false);
        });
    });
});

// ============================================================================
// getCachedGraphAny (--use-cache support)
// ============================================================================

describe('getCachedGraphAny', () => {
    it('should return null when no cache exists', () => {
        const result = getCachedGraphAny(path.join(tmpDir, 'output'));
        expect(result).toBeNull();
    });

    it('should return null for corrupted cache file', () => {
        const outputDir = path.join(tmpDir, 'output');
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(getGraphCachePath(outputDir), 'not valid json', 'utf-8');

        const result = getCachedGraphAny(outputDir);
        expect(result).toBeNull();
    });

    it('should return null for cache with missing metadata', () => {
        const outputDir = path.join(tmpDir, 'output');
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            getGraphCachePath(outputDir),
            JSON.stringify({ graph: createTestGraph() }),
            'utf-8'
        );

        const result = getCachedGraphAny(outputDir);
        expect(result).toBeNull();
    });

    it('should return cached graph regardless of git hash', () => {
        const outputDir = path.join(tmpDir, 'output');
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });

        const cached: CachedGraph = {
            metadata: {
                gitHash: '0000000000000000000000000000000000000000',
                timestamp: Date.now(),
                version: '1.0.0',
            },
            graph: createTestGraph(),
        };
        fs.writeFileSync(getGraphCachePath(outputDir), JSON.stringify(cached), 'utf-8');

        const result = getCachedGraphAny(outputDir);
        expect(result).not.toBeNull();
        expect(result!.graph.project.name).toBe('test-project');
        expect(result!.graph.components).toHaveLength(1);
    });
});

// ============================================================================
// scanIndividualAnalysesCacheAny (--use-cache support)
// ============================================================================

describe('scanIndividualAnalysesCacheAny', () => {
    it('should return all missing when no cache exists', () => {
        const outputDir = path.join(tmpDir, 'output');
        const { found, missing } = scanIndividualAnalysesCacheAny(['mod-a', 'mod-b'], outputDir);
        expect(found).toHaveLength(0);
        expect(missing).toEqual(['mod-a', 'mod-b']);
    });

    it('should return cached analyses regardless of git hash', () => {
        const outputDir = path.join(tmpDir, 'output');
        const cacheDir = getCacheDir(outputDir);
        const analysesDir = path.join(cacheDir, 'analyses');
        fs.mkdirSync(analysesDir, { recursive: true });

        const cachedAnalysis: CachedAnalysis = {
            analysis: {
                componentId: 'mod-a',
                overview: 'Test overview',
                keyConcepts: [],
                publicAPI: [],
                internalArchitecture: '',
                dataFlow: '',
                patterns: [],
                errorHandling: '',
                codeExamples: [],
                dependencies: { internal: [], external: [] },
                suggestedDiagram: '',
            },
            gitHash: 'stale-hash-that-does-not-match',
            timestamp: Date.now(),
        };
        fs.writeFileSync(
            getAnalysisCachePath(outputDir, 'mod-a'),
            JSON.stringify(cachedAnalysis),
            'utf-8'
        );

        const { found, missing } = scanIndividualAnalysesCacheAny(['mod-a', 'mod-b'], outputDir);
        expect(found).toHaveLength(1);
        expect(found[0].componentId).toBe('mod-a');
        expect(missing).toEqual(['mod-b']);
    });

    it('should skip corrupted cache entries', () => {
        const outputDir = path.join(tmpDir, 'output');
        const cacheDir = getCacheDir(outputDir);
        const analysesDir = path.join(cacheDir, 'analyses');
        fs.mkdirSync(analysesDir, { recursive: true });

        fs.writeFileSync(getAnalysisCachePath(outputDir, 'mod-a'), 'not json', 'utf-8');

        const { found, missing } = scanIndividualAnalysesCacheAny(['mod-a'], outputDir);
        expect(found).toHaveLength(0);
        expect(missing).toEqual(['mod-a']);
    });
});

// ============================================================================
// scanIndividualArticlesCacheAny (--use-cache support)
// ============================================================================

describe('scanIndividualArticlesCacheAny', () => {
    it('should return all missing when no cache exists', () => {
        const outputDir = path.join(tmpDir, 'output');
        const { found, missing } = scanIndividualArticlesCacheAny(['mod-a'], outputDir);
        expect(found).toHaveLength(0);
        expect(missing).toEqual(['mod-a']);
    });

    it('should return cached articles regardless of git hash', () => {
        const outputDir = path.join(tmpDir, 'output');
        const cacheDir = getCacheDir(outputDir);
        const articlesDir = path.join(cacheDir, 'articles');
        fs.mkdirSync(articlesDir, { recursive: true });

        const cachedArticle: CachedArticle = {
            article: {
                type: 'component',
                slug: 'mod-a',
                title: 'Module A',
                content: '# Module A',
                componentId: 'mod-a',
            },
            gitHash: 'completely-different-hash',
            timestamp: Date.now(),
        };
        fs.writeFileSync(
            getArticleCachePath(outputDir, 'mod-a'),
            JSON.stringify(cachedArticle),
            'utf-8'
        );

        const { found, missing } = scanIndividualArticlesCacheAny(['mod-a', 'mod-b'], outputDir);
        expect(found).toHaveLength(1);
        expect(found[0].slug).toBe('mod-a');
        expect(missing).toEqual(['mod-b']);
    });
});
