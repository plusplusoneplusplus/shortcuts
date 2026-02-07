/**
 * Article Cache Tests
 *
 * Tests for Phase 3 per-module article caching:
 * save/load single article, save/load all, scan for crash recovery,
 * clear cache, corrupted cache handling, git hash validation,
 * --force flag behavior, and reduce always re-runs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { GeneratedArticle } from '../../src/types';

// Mock git-utils before importing cache
vi.mock('../../src/cache/git-utils', () => ({
    getRepoHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    hasChanges: vi.fn().mockResolvedValue(false),
    isGitAvailable: vi.fn().mockResolvedValue(true),
    isGitRepo: vi.fn().mockResolvedValue(true),
}));

import {
    saveArticle,
    getCachedArticle,
    saveAllArticles,
    getCachedArticles,
    clearArticlesCache,
    getArticlesCacheDir,
    getArticlesMetadataPath,
    scanIndividualArticlesCache,
} from '../../src/cache';
import { getRepoHeadHash } from '../../src/cache/git-utils';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

function createTestArticle(moduleId: string): GeneratedArticle {
    return {
        type: 'module',
        slug: moduleId,
        title: `${moduleId} Module`,
        content: `# ${moduleId}\n\nArticle content for ${moduleId}.`,
        moduleId,
    };
}

function createIndexArticle(): GeneratedArticle {
    return {
        type: 'index',
        slug: 'index',
        title: 'Wiki Index',
        content: '# Index\n\nWelcome to the wiki.',
    };
}

function createArchitectureArticle(): GeneratedArticle {
    return {
        type: 'architecture',
        slug: 'architecture',
        title: 'Architecture Overview',
        content: '# Architecture\n\nOverview.',
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-article-cache-test-'));
    outputDir = path.join(tempDir, 'output');
    vi.clearAllMocks();
    // Reset default mock
    vi.mocked(getRepoHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// saveArticle / getCachedArticle
// ============================================================================

describe('single article cache', () => {
    it('should save and load a single article', () => {
        const article = createTestArticle('auth');
        saveArticle('auth', article, outputDir, 'hash123');

        const loaded = getCachedArticle('auth', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.moduleId).toBe('auth');
        expect(loaded!.slug).toBe('auth');
        expect(loaded!.content).toContain('auth');
    });

    it('should return null for non-existent module', () => {
        const loaded = getCachedArticle('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted cache file', () => {
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(
            path.join(articlesDir, 'corrupted.json'),
            'not valid json!!!',
            'utf-8'
        );

        const loaded = getCachedArticle('corrupted', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle cache with missing article field', () => {
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(
            path.join(articlesDir, 'invalid.json'),
            JSON.stringify({ gitHash: 'abc', timestamp: Date.now() }),
            'utf-8'
        );

        const loaded = getCachedArticle('invalid', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle cache with missing slug field', () => {
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(
            path.join(articlesDir, 'no-slug.json'),
            JSON.stringify({
                article: { type: 'module', title: 'No Slug', content: 'test' },
                gitHash: 'abc',
                timestamp: Date.now(),
            }),
            'utf-8'
        );

        const loaded = getCachedArticle('no-slug', outputDir);
        expect(loaded).toBeNull();
    });

    it('should overwrite existing cached article', () => {
        const article1 = createTestArticle('auth');
        saveArticle('auth', article1, outputDir, 'hash1');

        const article2 = { ...createTestArticle('auth'), content: 'Updated content' };
        saveArticle('auth', article2, outputDir, 'hash2');

        const loaded = getCachedArticle('auth', outputDir);
        expect(loaded!.content).toBe('Updated content');
    });

    it('should preserve article type and title', () => {
        const article = createTestArticle('database');
        saveArticle('database', article, outputDir, 'hash1');

        const loaded = getCachedArticle('database', outputDir);
        expect(loaded!.type).toBe('module');
        expect(loaded!.title).toBe('database Module');
    });
});

// ============================================================================
// saveAllArticles / getCachedArticles
// ============================================================================

describe('bulk article cache', () => {
    it('should save and load all articles', async () => {
        const articles = [
            createTestArticle('auth'),
            createTestArticle('database'),
            createTestArticle('api'),
        ];

        await saveAllArticles(articles, outputDir, '/repo');

        const loaded = getCachedArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(3);
        expect(loaded!.map(a => a.moduleId).sort()).toEqual(['api', 'auth', 'database']);
    });

    it('should write metadata file', async () => {
        const articles = [createTestArticle('auth')];
        await saveAllArticles(articles, outputDir, '/repo');

        const metadataPath = getArticlesMetadataPath(outputDir);
        expect(fs.existsSync(metadataPath)).toBe(true);

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        expect(metadata.moduleCount).toBe(1);
        expect(metadata.version).toBe('1.0.0');
    });

    it('should only cache module-type articles', async () => {
        const articles = [
            createTestArticle('auth'),
            createIndexArticle(),
            createArchitectureArticle(),
        ];

        await saveAllArticles(articles, outputDir, '/repo');

        const loaded = getCachedArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
        expect(loaded![0].moduleId).toBe('auth');

        // Verify metadata count reflects only module articles
        const metadataPath = getArticlesMetadataPath(outputDir);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        expect(metadata.moduleCount).toBe(1);
    });

    it('should return null when no cache exists', () => {
        const loaded = getCachedArticles(outputDir);
        expect(loaded).toBeNull();
    });

    it('should return null when metadata is corrupted', () => {
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(
            path.join(articlesDir, '_metadata.json'),
            'not json',
            'utf-8'
        );

        const loaded = getCachedArticles(outputDir);
        expect(loaded).toBeNull();
    });

    it('should skip git hash check if hash unavailable', async () => {
        vi.mocked(getRepoHeadHash).mockResolvedValue(null);
        const articles = [createTestArticle('auth')];
        await saveAllArticles(articles, outputDir, '/repo');

        // Should not write anything (can't determine hash)
        const loaded = getCachedArticles(outputDir);
        expect(loaded).toBeNull();
    });

    it('should skip corrupted individual entries', async () => {
        const articles = [createTestArticle('auth'), createTestArticle('db')];
        await saveAllArticles(articles, outputDir, '/repo');

        // Corrupt one entry
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.writeFileSync(path.join(articlesDir, 'auth.json'), 'corrupted', 'utf-8');

        const loaded = getCachedArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
        expect(loaded![0].moduleId).toBe('db');
    });
});

// ============================================================================
// clearArticlesCache
// ============================================================================

describe('clearArticlesCache', () => {
    it('should remove all cached articles', async () => {
        const articles = [createTestArticle('auth')];
        await saveAllArticles(articles, outputDir, '/repo');

        const cleared = clearArticlesCache(outputDir);
        expect(cleared).toBe(true);

        const loaded = getCachedArticles(outputDir);
        expect(loaded).toBeNull();
    });

    it('should return false when no cache exists', () => {
        const cleared = clearArticlesCache(outputDir);
        expect(cleared).toBe(false);
    });
});

// ============================================================================
// scanIndividualArticlesCache
// ============================================================================

describe('scanIndividualArticlesCache', () => {
    it('should find individually cached modules with matching git hash', () => {
        const hash = 'abc123';
        saveArticle('auth', createTestArticle('auth'), outputDir, hash);
        saveArticle('db', createTestArticle('db'), outputDir, hash);

        const result = scanIndividualArticlesCache(
            ['auth', 'db', 'api'],
            outputDir,
            hash
        );

        expect(result.found).toHaveLength(2);
        expect(result.found.map(a => a.moduleId).sort()).toEqual(['auth', 'db']);
        expect(result.missing).toEqual(['api']);
    });

    it('should return all as missing when no cache exists', () => {
        const result = scanIndividualArticlesCache(
            ['auth', 'db'],
            outputDir,
            'somehash'
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['auth', 'db']);
    });

    it('should exclude modules with different git hash (stale cache)', () => {
        saveArticle('auth', createTestArticle('auth'), outputDir, 'old_hash');
        saveArticle('db', createTestArticle('db'), outputDir, 'current_hash');

        const result = scanIndividualArticlesCache(
            ['auth', 'db'],
            outputDir,
            'current_hash'
        );

        expect(result.found).toHaveLength(1);
        expect(result.found[0].moduleId).toBe('db');
        expect(result.missing).toEqual(['auth']);
    });

    it('should handle corrupted cache files', () => {
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(
            path.join(articlesDir, 'corrupted.json'),
            'not valid json!!!',
            'utf-8'
        );

        const result = scanIndividualArticlesCache(
            ['corrupted'],
            outputDir,
            'somehash'
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['corrupted']);
    });

    it('should handle empty module list', () => {
        const result = scanIndividualArticlesCache(
            [],
            outputDir,
            'somehash'
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual([]);
    });

    it('should recover partial cache from interrupted run (no metadata)', () => {
        // Simulate interrupted run: some articles saved individually, no metadata file
        const hash = 'current_hash_123';
        saveArticle('mod-1', createTestArticle('mod-1'), outputDir, hash);
        saveArticle('mod-2', createTestArticle('mod-2'), outputDir, hash);
        // mod-3 was not saved (process crashed)

        // No metadata file exists (getCachedArticles would return null)
        const bulkResult = getCachedArticles(outputDir);
        expect(bulkResult).toBeNull(); // Confirms no metadata

        // But scanIndividualArticlesCache can recover the saved articles
        const result = scanIndividualArticlesCache(
            ['mod-1', 'mod-2', 'mod-3'],
            outputDir,
            hash
        );

        expect(result.found).toHaveLength(2);
        expect(result.found.map(a => a.moduleId).sort()).toEqual(['mod-1', 'mod-2']);
        expect(result.missing).toEqual(['mod-3']);
    });

    it('should invalidate all modules when git hash changed', () => {
        const oldHash = 'old_hash_abc';
        saveArticle('auth', createTestArticle('auth'), outputDir, oldHash);
        saveArticle('db', createTestArticle('db'), outputDir, oldHash);

        const result = scanIndividualArticlesCache(
            ['auth', 'db'],
            outputDir,
            'new_hash_xyz'
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['auth', 'db']);
    });

    it('should handle cache file with missing article field', () => {
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(
            path.join(articlesDir, 'incomplete.json'),
            JSON.stringify({ gitHash: 'hash123', timestamp: Date.now() }),
            'utf-8'
        );

        const result = scanIndividualArticlesCache(
            ['incomplete'],
            outputDir,
            'hash123'
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['incomplete']);
    });

    it('should handle mixed cache states (valid, stale, missing, corrupted)', () => {
        const currentHash = 'current_hash';

        // Valid
        saveArticle('valid', createTestArticle('valid'), outputDir, currentHash);

        // Stale (different hash)
        saveArticle('stale', createTestArticle('stale'), outputDir, 'old_hash');

        // Corrupted
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.writeFileSync(
            path.join(articlesDir, 'corrupted.json'),
            'invalid json',
            'utf-8'
        );

        // Missing - not saved at all

        const result = scanIndividualArticlesCache(
            ['valid', 'stale', 'corrupted', 'missing'],
            outputDir,
            currentHash
        );

        expect(result.found).toHaveLength(1);
        expect(result.found[0].moduleId).toBe('valid');
        expect(result.missing.sort()).toEqual(['corrupted', 'missing', 'stale']);
    });

    it('should preserve full article content through save/scan round-trip', () => {
        const hash = 'test_hash';
        const article: GeneratedArticle = {
            type: 'module',
            slug: 'my-module',
            title: 'My Module',
            content: '# My Module\n\n## Overview\n\nDetailed content with **markdown**.\n\n```typescript\nconst x = 42;\n```',
            moduleId: 'my-module',
        };

        saveArticle('my-module', article, outputDir, hash);

        const result = scanIndividualArticlesCache(
            ['my-module'],
            outputDir,
            hash
        );

        expect(result.found).toHaveLength(1);
        expect(result.found[0]).toEqual(article);
    });
});

// ============================================================================
// Article cache isolation from analysis cache
// ============================================================================

describe('article cache isolation', () => {
    it('should store articles in articles/ subdirectory separate from analyses/', async () => {
        const articles = [createTestArticle('auth')];
        await saveAllArticles(articles, outputDir, '/repo');

        const articlesDir = getArticlesCacheDir(outputDir);
        expect(articlesDir).toContain('articles');
        expect(fs.existsSync(articlesDir)).toBe(true);

        // Verify file exists in the correct location
        const articleFile = path.join(articlesDir, 'auth.json');
        expect(fs.existsSync(articleFile)).toBe(true);
    });

    it('should not interfere with analysis cache', async () => {
        // Save an article
        saveArticle('auth', createTestArticle('auth'), outputDir, 'hash1');

        // The analyses dir should not exist (we only saved articles)
        const analysesDir = path.join(path.resolve(outputDir), '.wiki-cache', 'analyses');
        expect(fs.existsSync(analysesDir)).toBe(false);
    });
});

// ============================================================================
// Force flag behavior
// ============================================================================

describe('force flag behavior', () => {
    it('should allow fresh article generation to succeed even with existing cache', () => {
        const hash = 'current_hash';
        // Set up existing cache
        saveArticle('auth', createTestArticle('auth'), outputDir, hash);
        saveArticle('db', createTestArticle('db'), outputDir, hash);

        // When --force is set, the calling code skips cache loading entirely.
        // Verify that individual article cache still works for saving:
        const newArticle = { ...createTestArticle('auth'), content: 'Force-generated content' };
        saveArticle('auth', newArticle, outputDir, hash);

        const loaded = getCachedArticle('auth', outputDir);
        expect(loaded!.content).toBe('Force-generated content');
    });
});

// ============================================================================
// Cache structure validation
// ============================================================================

describe('cache structure', () => {
    it('should create .wiki-cache/articles/ directory structure', () => {
        saveArticle('test', createTestArticle('test'), outputDir, 'hash');

        const cacheDir = path.join(path.resolve(outputDir), '.wiki-cache');
        const articlesDir = path.join(cacheDir, 'articles');

        expect(fs.existsSync(cacheDir)).toBe(true);
        expect(fs.existsSync(articlesDir)).toBe(true);
    });

    it('should store metadata as _metadata.json in articles/ directory', async () => {
        await saveAllArticles([createTestArticle('auth')], outputDir, '/repo');

        const metadataPath = getArticlesMetadataPath(outputDir);
        expect(fs.existsSync(metadataPath)).toBe(true);
        expect(path.basename(metadataPath)).toBe('_metadata.json');
        expect(metadataPath).toContain('articles');
    });

    it('should store per-module article as moduleId.json', () => {
        saveArticle('my-component', createTestArticle('my-component'), outputDir, 'hash');

        const articlesDir = getArticlesCacheDir(outputDir);
        expect(fs.existsSync(path.join(articlesDir, 'my-component.json'))).toBe(true);
    });

    it('metadata should include git hash, timestamp, version, and module count', async () => {
        const articles = [
            createTestArticle('auth'),
            createTestArticle('db'),
            createTestArticle('api'),
        ];
        await saveAllArticles(articles, outputDir, '/repo');

        const metadataPath = getArticlesMetadataPath(outputDir);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

        expect(metadata.gitHash).toBe('abc123def456abc123def456abc123def456abc1');
        expect(metadata.timestamp).toBeGreaterThan(0);
        expect(metadata.version).toBe('1.0.0');
        expect(metadata.moduleCount).toBe(3);
    });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('edge cases', () => {
    it('should handle module ID with special characters', () => {
        const article = createTestArticle('my-complex_module.v2');
        saveArticle('my-complex_module.v2', article, outputDir, 'hash');

        const loaded = getCachedArticle('my-complex_module.v2', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.moduleId).toBe('my-complex_module.v2');
    });

    it('should handle article with very long content', () => {
        const longContent = '#'.repeat(100_000);
        const article: GeneratedArticle = {
            type: 'module',
            slug: 'big-module',
            title: 'Big Module',
            content: longContent,
            moduleId: 'big-module',
        };

        saveArticle('big-module', article, outputDir, 'hash');

        const loaded = getCachedArticle('big-module', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.content.length).toBe(100_000);
    });

    it('should handle article with empty content', () => {
        const article: GeneratedArticle = {
            type: 'module',
            slug: 'empty',
            title: 'Empty Module',
            content: '',
            moduleId: 'empty',
        };

        saveArticle('empty', article, outputDir, 'hash');

        const loaded = getCachedArticle('empty', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.content).toBe('');
    });

    it('should handle concurrent saves to different modules', () => {
        const hash = 'concurrent_hash';
        const moduleIds = Array.from({ length: 20 }, (_, i) => `module-${i}`);

        // Save all concurrently (synchronous, but simulates multiple saves)
        for (const id of moduleIds) {
            saveArticle(id, createTestArticle(id), outputDir, hash);
        }

        const result = scanIndividualArticlesCache(moduleIds, outputDir, hash);
        expect(result.found).toHaveLength(20);
        expect(result.missing).toHaveLength(0);
    });
});
