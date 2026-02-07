/**
 * Analysis Cache Tests
 *
 * Tests for Phase 2 per-module analysis caching:
 * save/load single module, save/load all, incremental rebuild,
 * clear cache, and corrupted cache handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ModuleAnalysis, ModuleGraph } from '../../src/types';

// Mock git-utils before importing cache
vi.mock('../../src/cache/git-utils', () => ({
    getRepoHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    hasChanges: vi.fn().mockResolvedValue(false),
    isGitAvailable: vi.fn().mockResolvedValue(true),
    isGitRepo: vi.fn().mockResolvedValue(true),
}));

import {
    saveAnalysis,
    getCachedAnalysis,
    saveAllAnalyses,
    getCachedAnalyses,
    clearAnalysesCache,
    getModulesNeedingReanalysis,
    getAnalysesCacheDir,
    getAnalysesMetadataPath,
} from '../../src/cache';
import { getChangedFiles, getRepoHeadHash } from '../../src/cache/git-utils';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

function createTestAnalysis(moduleId: string): ModuleAnalysis {
    return {
        moduleId,
        overview: `Overview of ${moduleId}`,
        keyConcepts: [{ name: 'Concept', description: 'Test' }],
        publicAPI: [],
        internalArchitecture: 'Architecture',
        dataFlow: 'Flow',
        patterns: ['Pattern'],
        errorHandling: 'Errors',
        codeExamples: [],
        dependencies: { internal: [], external: [] },
        suggestedDiagram: '',
    };
}

function createTestGraph(moduleIds: string[]): ModuleGraph {
    return {
        project: {
            name: 'Test',
            description: 'Test',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: [],
        },
        modules: moduleIds.map(id => ({
            id,
            name: id,
            path: `src/${id}/`,
            purpose: `${id} module`,
            keyFiles: [`src/${id}/index.ts`],
            dependencies: [],
            dependents: [],
            complexity: 'medium' as const,
            category: 'core',
        })),
        categories: [{ name: 'core', description: 'Core' }],
        architectureNotes: '',
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-cache-test-'));
    outputDir = path.join(tempDir, 'output');
    vi.clearAllMocks();
    // Reset default mock
    vi.mocked(getRepoHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
    vi.mocked(getChangedFiles).mockResolvedValue([]);
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// saveAnalysis / getCachedAnalysis
// ============================================================================

describe('single module analysis cache', () => {
    it('should save and load a single analysis', () => {
        const analysis = createTestAnalysis('auth');
        saveAnalysis('auth', analysis, outputDir, 'hash123');

        const loaded = getCachedAnalysis('auth', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.moduleId).toBe('auth');
        expect(loaded!.overview).toContain('auth');
    });

    it('should return null for non-existent module', () => {
        const loaded = getCachedAnalysis('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted cache file', () => {
        const analysesDir = getAnalysesCacheDir(outputDir);
        fs.mkdirSync(analysesDir, { recursive: true });
        fs.writeFileSync(
            path.join(analysesDir, 'corrupted.json'),
            'not valid json!!!',
            'utf-8'
        );

        const loaded = getCachedAnalysis('corrupted', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle cache with missing analysis field', () => {
        const analysesDir = getAnalysesCacheDir(outputDir);
        fs.mkdirSync(analysesDir, { recursive: true });
        fs.writeFileSync(
            path.join(analysesDir, 'invalid.json'),
            JSON.stringify({ gitHash: 'abc', timestamp: Date.now() }),
            'utf-8'
        );

        const loaded = getCachedAnalysis('invalid', outputDir);
        expect(loaded).toBeNull();
    });

    it('should overwrite existing cached analysis', () => {
        const analysis1 = createTestAnalysis('auth');
        saveAnalysis('auth', analysis1, outputDir, 'hash1');

        const analysis2 = { ...createTestAnalysis('auth'), overview: 'Updated overview' };
        saveAnalysis('auth', analysis2, outputDir, 'hash2');

        const loaded = getCachedAnalysis('auth', outputDir);
        expect(loaded!.overview).toBe('Updated overview');
    });
});

// ============================================================================
// saveAllAnalyses / getCachedAnalyses
// ============================================================================

describe('bulk analysis cache', () => {
    it('should save and load all analyses', async () => {
        const analyses = [
            createTestAnalysis('auth'),
            createTestAnalysis('database'),
            createTestAnalysis('api'),
        ];

        await saveAllAnalyses(analyses, outputDir, '/repo');

        const loaded = getCachedAnalyses(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(3);
        expect(loaded!.map(a => a.moduleId).sort()).toEqual(['api', 'auth', 'database']);
    });

    it('should write metadata file', async () => {
        const analyses = [createTestAnalysis('auth')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        const metadataPath = getAnalysesMetadataPath(outputDir);
        expect(fs.existsSync(metadataPath)).toBe(true);

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        expect(metadata.moduleCount).toBe(1);
        expect(metadata.version).toBe('1.0.0');
    });

    it('should return null when no cache exists', () => {
        const loaded = getCachedAnalyses(outputDir);
        expect(loaded).toBeNull();
    });

    it('should return null when metadata is corrupted', () => {
        const analysesDir = getAnalysesCacheDir(outputDir);
        fs.mkdirSync(analysesDir, { recursive: true });
        fs.writeFileSync(
            path.join(analysesDir, '_metadata.json'),
            'not json',
            'utf-8'
        );

        const loaded = getCachedAnalyses(outputDir);
        expect(loaded).toBeNull();
    });

    it('should skip git hash check if hash unavailable', async () => {
        vi.mocked(getRepoHeadHash).mockResolvedValue(null);
        const analyses = [createTestAnalysis('auth')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        // Should not write anything (can't determine hash)
        const loaded = getCachedAnalyses(outputDir);
        expect(loaded).toBeNull();
    });

    it('should skip corrupted individual entries', async () => {
        const analyses = [createTestAnalysis('auth'), createTestAnalysis('db')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        // Corrupt one entry
        const analysesDir = getAnalysesCacheDir(outputDir);
        fs.writeFileSync(path.join(analysesDir, 'auth.json'), 'corrupted', 'utf-8');

        const loaded = getCachedAnalyses(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
        expect(loaded![0].moduleId).toBe('db');
    });
});

// ============================================================================
// clearAnalysesCache
// ============================================================================

describe('clearAnalysesCache', () => {
    it('should remove all cached analyses', async () => {
        const analyses = [createTestAnalysis('auth')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        const cleared = clearAnalysesCache(outputDir);
        expect(cleared).toBe(true);

        const loaded = getCachedAnalyses(outputDir);
        expect(loaded).toBeNull();
    });

    it('should return false when no cache exists', () => {
        const cleared = clearAnalysesCache(outputDir);
        expect(cleared).toBe(false);
    });
});

// ============================================================================
// getModulesNeedingReanalysis
// ============================================================================

describe('getModulesNeedingReanalysis', () => {
    it('should return null when no cache metadata exists', async () => {
        const graph = createTestGraph(['auth', 'db']);
        const result = await getModulesNeedingReanalysis(graph, outputDir, '/repo');
        expect(result).toBeNull();
    });

    it('should return empty array when nothing changed', async () => {
        // Set up cache
        const analyses = [createTestAnalysis('auth'), createTestAnalysis('db')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        // Same git hash
        vi.mocked(getRepoHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
        vi.mocked(getChangedFiles).mockResolvedValue([]);

        const graph = createTestGraph(['auth', 'db']);
        const result = await getModulesNeedingReanalysis(graph, outputDir, '/repo');
        expect(result).toEqual([]);
    });

    it('should identify changed modules based on file paths', async () => {
        const analyses = [createTestAnalysis('auth'), createTestAnalysis('db')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        // Different git hash + changed files
        vi.mocked(getRepoHeadHash).mockResolvedValue('new_hash_new_hash_new_hash_new_hash_new1');
        vi.mocked(getChangedFiles).mockResolvedValue(['src/auth/jwt.ts']);

        const graph = createTestGraph(['auth', 'db']);
        const result = await getModulesNeedingReanalysis(graph, outputDir, '/repo');

        expect(result).not.toBeNull();
        expect(result).toContain('auth');
        expect(result).not.toContain('db');
    });

    it('should detect changes matching key files', async () => {
        const analyses = [createTestAnalysis('auth')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        vi.mocked(getRepoHeadHash).mockResolvedValue('new_hash_new_hash_new_hash_new_hash_new1');
        vi.mocked(getChangedFiles).mockResolvedValue(['src/auth/index.ts']);

        const graph = createTestGraph(['auth']);
        const result = await getModulesNeedingReanalysis(graph, outputDir, '/repo');

        expect(result).toContain('auth');
    });

    it('should return null when git hash unavailable', async () => {
        const analyses = [createTestAnalysis('auth')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        vi.mocked(getRepoHeadHash).mockResolvedValue(null);

        const graph = createTestGraph(['auth']);
        const result = await getModulesNeedingReanalysis(graph, outputDir, '/repo');
        expect(result).toBeNull();
    });

    it('should return null when changed files unavailable', async () => {
        const analyses = [createTestAnalysis('auth')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        vi.mocked(getRepoHeadHash).mockResolvedValue('new_hash_new_hash_new_hash_new_hash_new1');
        vi.mocked(getChangedFiles).mockResolvedValue(null);

        const graph = createTestGraph(['auth']);
        const result = await getModulesNeedingReanalysis(graph, outputDir, '/repo');
        expect(result).toBeNull();
    });

    it('should handle Windows-style backslash paths', async () => {
        const analyses = [createTestAnalysis('auth')];
        await saveAllAnalyses(analyses, outputDir, '/repo');

        vi.mocked(getRepoHeadHash).mockResolvedValue('new_hash_new_hash_new_hash_new_hash_new1');
        vi.mocked(getChangedFiles).mockResolvedValue(['src\\auth\\jwt.ts']);

        const graph = createTestGraph(['auth']);
        const result = await getModulesNeedingReanalysis(graph, outputDir, '/repo');

        expect(result).toContain('auth');
    });
});
