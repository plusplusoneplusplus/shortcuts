/**
 * Consolidation Cache Tests (Phase 2)
 *
 * Tests for saving/loading consolidated module graph cache,
 * git hash validation, input module count validation,
 * --use-cache mode, corrupted cache, and cache clearing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ModuleGraph, CachedConsolidation } from '../../src/types';

// Mock git-utils before importing cache
vi.mock('../../src/cache/git-utils', () => ({
    getRepoHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    hasChanges: vi.fn().mockResolvedValue(false),
    isGitAvailable: vi.fn().mockResolvedValue(true),
    isGitRepo: vi.fn().mockResolvedValue(true),
}));

import {
    getCacheDir,
    getConsolidatedGraphCachePath,
    getCachedConsolidation,
    getCachedConsolidationAny,
    saveConsolidation,
    clearConsolidationCache,
} from '../../src/cache';
import { getRepoHeadHash } from '../../src/cache/git-utils';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

function createTestGraph(moduleCount: number): ModuleGraph {
    return {
        project: {
            name: 'test-project',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        modules: Array.from({ length: moduleCount }, (_, i) => ({
            id: `mod-${i}`,
            name: `Module ${i}`,
            path: `src/mod-${i}/`,
            purpose: `Module ${i} purpose`,
            keyFiles: [`src/mod-${i}/index.ts`],
            dependencies: [],
            dependents: [],
            complexity: 'medium' as const,
            category: 'core',
        })),
        categories: [{ name: 'core', description: 'Core modules' }],
        architectureNotes: 'Simple architecture',
    };
}

function writeConsolidationCache(
    dir: string,
    cached: CachedConsolidation
): void {
    const cacheDir = getCacheDir(dir);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
        getConsolidatedGraphCachePath(dir),
        JSON.stringify(cached),
        'utf-8'
    );
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-consolidation-cache-test-'));
    outputDir = path.join(tempDir, 'output');
    vi.mocked(getRepoHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Cache Paths
// ============================================================================

describe('Consolidation Cache Paths', () => {
    it('should return path to consolidated-graph.json', () => {
        const cachePath = getConsolidatedGraphCachePath('/output/wiki');
        expect(path.basename(cachePath)).toBe('consolidated-graph.json');
    });

    it('should be inside the cache directory', () => {
        const cachePath = getConsolidatedGraphCachePath('/output/wiki');
        const cacheDir = getCacheDir('/output/wiki');
        expect(cachePath.startsWith(cacheDir)).toBe(true);
    });
});

// ============================================================================
// getCachedConsolidation (with git hash validation)
// ============================================================================

describe('getCachedConsolidation', () => {
    it('should return null when no cache exists', async () => {
        const result = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return null for corrupted cache file', async () => {
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            getConsolidatedGraphCachePath(outputDir),
            'not valid json',
            'utf-8'
        );

        const result = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return null for cache with missing graph', async () => {
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            getConsolidatedGraphCachePath(outputDir),
            JSON.stringify({
                gitHash: 'abc123def456abc123def456abc123def456abc1',
                inputModuleCount: 10,
                timestamp: Date.now(),
            }),
            'utf-8'
        );

        const result = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return null for cache with missing gitHash', async () => {
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            getConsolidatedGraphCachePath(outputDir),
            JSON.stringify({
                graph: createTestGraph(5),
                inputModuleCount: 10,
                timestamp: Date.now(),
            }),
            'utf-8'
        );

        const result = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return null when input module count does not match', async () => {
        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: 'abc123def456abc123def456abc123def456abc1',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        // Request with different input module count
        const result = await getCachedConsolidation('/some/repo', outputDir, 15);
        expect(result).toBeNull();
    });

    it('should return null when git hash does not match', async () => {
        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: '0000000000000000000000000000000000000000',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        const result = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return cached consolidation when git hash and module count match', async () => {
        const consolidatedGraph = createTestGraph(5);
        writeConsolidationCache(outputDir, {
            graph: consolidatedGraph,
            gitHash: 'abc123def456abc123def456abc123def456abc1',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        const result = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(result).not.toBeNull();
        expect(result!.graph.modules).toHaveLength(5);
        expect(result!.inputModuleCount).toBe(10);
    });

    it('should return null when getRepoHeadHash fails', async () => {
        vi.mocked(getRepoHeadHash).mockRejectedValueOnce(new Error('git not available'));

        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: 'abc123def456abc123def456abc123def456abc1',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        const result = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return null when getRepoHeadHash returns null', async () => {
        vi.mocked(getRepoHeadHash).mockResolvedValueOnce(null as unknown as string);

        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: 'abc123def456abc123def456abc123def456abc1',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        const result = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(result).toBeNull();
    });
});

// ============================================================================
// getCachedConsolidationAny (--use-cache mode, skip git hash)
// ============================================================================

describe('getCachedConsolidationAny', () => {
    it('should return null when no cache exists', () => {
        const result = getCachedConsolidationAny(outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return null for corrupted cache file', () => {
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            getConsolidatedGraphCachePath(outputDir),
            'not valid json',
            'utf-8'
        );

        const result = getCachedConsolidationAny(outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return null when input module count does not match', () => {
        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: 'any-hash',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        const result = getCachedConsolidationAny(outputDir, 20);
        expect(result).toBeNull();
    });

    it('should return cached consolidation regardless of git hash', () => {
        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: 'completely-different-hash',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        const result = getCachedConsolidationAny(outputDir, 10);
        expect(result).not.toBeNull();
        expect(result!.graph.modules).toHaveLength(5);
        expect(result!.inputModuleCount).toBe(10);
    });

    it('should return null for cache with missing graph', () => {
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            getConsolidatedGraphCachePath(outputDir),
            JSON.stringify({
                gitHash: 'some-hash',
                inputModuleCount: 10,
                timestamp: Date.now(),
            }),
            'utf-8'
        );

        const result = getCachedConsolidationAny(outputDir, 10);
        expect(result).toBeNull();
    });

    it('should return null for cache with missing inputModuleCount', () => {
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
            getConsolidatedGraphCachePath(outputDir),
            JSON.stringify({
                graph: createTestGraph(5),
                gitHash: 'some-hash',
                timestamp: Date.now(),
            }),
            'utf-8'
        );

        const result = getCachedConsolidationAny(outputDir, 10);
        expect(result).toBeNull();
    });
});

// ============================================================================
// saveConsolidation
// ============================================================================

describe('saveConsolidation', () => {
    it('should create cache directory and write file', async () => {
        const graph = createTestGraph(5);

        await saveConsolidation('/some/repo', graph, outputDir, 10);

        const cachePath = getConsolidatedGraphCachePath(outputDir);
        expect(fs.existsSync(cachePath)).toBe(true);

        const content = fs.readFileSync(cachePath, 'utf-8');
        const parsed = JSON.parse(content) as CachedConsolidation;
        expect(parsed.graph.modules).toHaveLength(5);
        expect(parsed.gitHash).toBe('abc123def456abc123def456abc123def456abc1');
        expect(parsed.inputModuleCount).toBe(10);
        expect(parsed.timestamp).toBeGreaterThan(0);
    });

    it('should not write cache when git hash is unavailable', async () => {
        vi.mocked(getRepoHeadHash).mockResolvedValueOnce(null as unknown as string);

        const graph = createTestGraph(5);
        await saveConsolidation('/some/repo', graph, outputDir, 10);

        const cachePath = getConsolidatedGraphCachePath(outputDir);
        expect(fs.existsSync(cachePath)).toBe(false);
    });

    it('should overwrite existing cache', async () => {
        const graph1 = createTestGraph(5);
        await saveConsolidation('/some/repo', graph1, outputDir, 10);

        const graph2 = createTestGraph(3);
        await saveConsolidation('/some/repo', graph2, outputDir, 8);

        const cachePath = getConsolidatedGraphCachePath(outputDir);
        const content = fs.readFileSync(cachePath, 'utf-8');
        const parsed = JSON.parse(content) as CachedConsolidation;
        expect(parsed.graph.modules).toHaveLength(3);
        expect(parsed.inputModuleCount).toBe(8);
    });

    it('should produce cache readable by getCachedConsolidation', async () => {
        const graph = createTestGraph(5);
        await saveConsolidation('/some/repo', graph, outputDir, 10);

        const cached = await getCachedConsolidation('/some/repo', outputDir, 10);
        expect(cached).not.toBeNull();
        expect(cached!.graph.modules).toHaveLength(5);
        expect(cached!.graph.project.name).toBe('test-project');
    });

    it('should produce cache readable by getCachedConsolidationAny', async () => {
        const graph = createTestGraph(5);
        await saveConsolidation('/some/repo', graph, outputDir, 10);

        const cached = getCachedConsolidationAny(outputDir, 10);
        expect(cached).not.toBeNull();
        expect(cached!.graph.modules).toHaveLength(5);
    });
});

// ============================================================================
// clearConsolidationCache
// ============================================================================

describe('clearConsolidationCache', () => {
    it('should return false when no cache exists', () => {
        expect(clearConsolidationCache(outputDir)).toBe(false);
    });

    it('should delete cache file and return true', () => {
        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: 'some-hash',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        expect(clearConsolidationCache(outputDir)).toBe(true);
        expect(fs.existsSync(getConsolidatedGraphCachePath(outputDir))).toBe(false);
    });

    it('should not affect other cache files', () => {
        // Write consolidation cache and a module-graph cache in same dir
        const cacheDir = getCacheDir(outputDir);
        fs.mkdirSync(cacheDir, { recursive: true });

        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: 'some-hash',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        // Write another file in cache dir
        const otherFile = path.join(cacheDir, 'module-graph.json');
        fs.writeFileSync(otherFile, '{}', 'utf-8');

        clearConsolidationCache(outputDir);

        expect(fs.existsSync(otherFile)).toBe(true);
        expect(fs.existsSync(getConsolidatedGraphCachePath(outputDir))).toBe(false);
    });

    it('should allow re-saving after clear', async () => {
        writeConsolidationCache(outputDir, {
            graph: createTestGraph(5),
            gitHash: 'some-hash',
            inputModuleCount: 10,
            timestamp: Date.now(),
        });

        clearConsolidationCache(outputDir);

        const graph = createTestGraph(3);
        await saveConsolidation('/some/repo', graph, outputDir, 8);

        const cached = getCachedConsolidationAny(outputDir, 8);
        expect(cached).not.toBeNull();
        expect(cached!.graph.modules).toHaveLength(3);
    });
});
