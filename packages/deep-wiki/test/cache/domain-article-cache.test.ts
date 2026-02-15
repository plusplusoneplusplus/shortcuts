/**
 * Area-Scoped Article Cache Tests
 *
 * Tests for hierarchical article caching with domain subdirectories:
 * - Save/load articles with domainId
 * - Backward compat: articles without domainId still work
 * - scanIndividualArticlesCache finds articles in domain subdirectories
 * - getCachedArticles handles mixed flat + area layouts
 * - clearArticlesCache removes domain subdirectories
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { GeneratedArticle } from '../../src/types';

// Mock git-utils before importing cache
vi.mock('../../src/cache/git-utils', () => ({
    getRepoHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getFolderHeadHash: vi.fn().mockResolvedValue('abc123def456abc123def456abc123def456abc1'),
    getGitRoot: vi.fn().mockResolvedValue('/mock/git/root'),
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
    getArticleCachePath,
    scanIndividualArticlesCache,
    scanIndividualArticlesCacheAny,
} from '../../src/cache';
import { getRepoHeadHash, getFolderHeadHash } from '../../src/cache/git-utils';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

function createTestArticle(moduleId: string, domainId?: string): GeneratedArticle {
    return {
        type: 'module',
        slug: moduleId,
        title: `${moduleId} Module`,
        content: `# ${moduleId}\n\nArticle content for ${moduleId}.`,
        moduleId,
        domainId,
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-area-cache-test-'));
    outputDir = path.join(tempDir, 'output');
    vi.clearAllMocks();
    vi.mocked(getRepoHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
    vi.mocked(getFolderHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Area-Scoped Save/Load
// ============================================================================

describe('domain-scoped article save/load', () => {
    it('should save article in area subdirectory when domainId is set', () => {
        const article = createTestArticle('core-auth', 'packages-core');
        saveArticle('core-auth', article, outputDir, 'hash123');

        // Verify file is in area subdirectory
        const cachePath = getArticleCachePath(outputDir, 'core-auth', 'packages-core');
        expect(fs.existsSync(cachePath)).toBe(true);
        expect(cachePath).toContain(path.join('articles', 'packages-core', 'core-auth.json'));
    });

    it('should save article in flat directory when no domainId', () => {
        const article = createTestArticle('auth');
        saveArticle('auth', article, outputDir, 'hash123');

        // Verify file is in flat directory
        const cachePath = getArticleCachePath(outputDir, 'auth');
        expect(fs.existsSync(cachePath)).toBe(true);
        expect(cachePath).not.toContain(path.join('articles', 'packages-core'));
    });

    it('should load domain-scoped article with domainId hint', () => {
        const article = createTestArticle('core-auth', 'packages-core');
        saveArticle('core-auth', article, outputDir, 'hash123');

        const loaded = getCachedArticle('core-auth', outputDir, 'packages-core');
        expect(loaded).not.toBeNull();
        expect(loaded!.moduleId).toBe('core-auth');
        expect(loaded!.domainId).toBe('packages-core');
    });

    it('should load flat article without domainId hint', () => {
        const article = createTestArticle('auth');
        saveArticle('auth', article, outputDir, 'hash123');

        const loaded = getCachedArticle('auth', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.moduleId).toBe('auth');
    });

    it('should save multiple articles in different domain subdirectories', () => {
        saveArticle('core-auth', createTestArticle('core-auth', 'packages-core'), outputDir, 'hash');
        saveArticle('api-routes', createTestArticle('api-routes', 'packages-api'), outputDir, 'hash');

        const coreArticle = getCachedArticle('core-auth', outputDir, 'packages-core');
        const apiArticle = getCachedArticle('api-routes', outputDir, 'packages-api');

        expect(coreArticle).not.toBeNull();
        expect(apiArticle).not.toBeNull();
        expect(coreArticle!.domainId).toBe('packages-core');
        expect(apiArticle!.domainId).toBe('packages-api');
    });

    it('should preserve domainId through save/load round-trip', () => {
        const article = createTestArticle('my-module', 'my-area');
        saveArticle('my-module', article, outputDir, 'hash');

        const loaded = getCachedArticle('my-module', outputDir, 'my-area');
        expect(loaded!.domainId).toBe('my-area');
    });
});

// ============================================================================
// scanIndividualArticlesCache — Area Support
// ============================================================================

describe('scanIndividualArticlesCache — area support', () => {
    it('should find articles cached in domain subdirectories', () => {
        const hash = 'current_hash';
        saveArticle('core-auth', createTestArticle('core-auth', 'packages-core'), outputDir, hash);
        saveArticle('api-routes', createTestArticle('api-routes', 'packages-api'), outputDir, hash);

        const result = scanIndividualArticlesCache(
            ['core-auth', 'api-routes', 'missing'],
            outputDir,
            hash
        );

        expect(result.found).toHaveLength(2);
        expect(result.found.map(a => a.moduleId).sort()).toEqual(['api-routes', 'core-auth']);
        expect(result.missing).toEqual(['missing']);
    });

    it('should find articles in mixed flat + area layout', () => {
        const hash = 'current_hash';
        // Flat article
        saveArticle('flat-module', createTestArticle('flat-module'), outputDir, hash);
        // Area-scoped article
        saveArticle('area-module', createTestArticle('area-module', 'my-area'), outputDir, hash);

        const result = scanIndividualArticlesCache(
            ['flat-module', 'area-module'],
            outputDir,
            hash
        );

        expect(result.found).toHaveLength(2);
        expect(result.missing).toHaveLength(0);
    });

    it('should invalidate domain-scoped articles with wrong git hash', () => {
        saveArticle('mod', createTestArticle('mod', 'area1'), outputDir, 'old_hash');

        const result = scanIndividualArticlesCache(
            ['mod'],
            outputDir,
            'new_hash'
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['mod']);
    });

    it('should recover partial area cache from interrupted run', () => {
        const hash = 'current_hash';
        // Only some modules saved before crash
        saveArticle('mod-1', createTestArticle('mod-1', 'area1'), outputDir, hash);
        saveArticle('mod-2', createTestArticle('mod-2', 'area1'), outputDir, hash);
        // mod-3 was not saved (process crashed)

        const result = scanIndividualArticlesCache(
            ['mod-1', 'mod-2', 'mod-3'],
            outputDir,
            hash
        );

        expect(result.found).toHaveLength(2);
        expect(result.missing).toEqual(['mod-3']);
    });
});

describe('scanIndividualArticlesCacheAny — area support', () => {
    it('should find domain-scoped articles ignoring git hash', () => {
        saveArticle('mod', createTestArticle('mod', 'area1'), outputDir, 'some_hash');

        const result = scanIndividualArticlesCacheAny(
            ['mod'],
            outputDir
        );

        expect(result.found).toHaveLength(1);
        expect(result.found[0].moduleId).toBe('mod');
    });
});

// ============================================================================
// getCachedArticles — Area Support
// ============================================================================

describe('getCachedArticles — area support', () => {
    it('should load articles from both flat and domain subdirectories', async () => {
        // Save flat article
        saveArticle('flat-mod', createTestArticle('flat-mod'), outputDir, 'hash');
        // Save domain-scoped article
        saveArticle('area-mod', createTestArticle('area-mod', 'my-area'), outputDir, 'hash');

        // Write metadata to make getCachedArticles work
        await saveAllArticles(
            [createTestArticle('flat-mod'), createTestArticle('area-mod', 'my-area')],
            outputDir,
            '/repo'
        );

        const loaded = getCachedArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.length).toBeGreaterThanOrEqual(2);
    });
});

// ============================================================================
// clearArticlesCache — Area Support
// ============================================================================

describe('clearArticlesCache — area support', () => {
    it('should clear domain subdirectories', () => {
        saveArticle('mod1', createTestArticle('mod1', 'area1'), outputDir, 'hash');
        saveArticle('mod2', createTestArticle('mod2', 'area2'), outputDir, 'hash');

        const cleared = clearArticlesCache(outputDir);
        expect(cleared).toBe(true);

        // Verify everything is gone
        const articlesDir = getArticlesCacheDir(outputDir);
        expect(fs.existsSync(articlesDir)).toBe(false);
    });

    it('should clear mixed flat + area cache', () => {
        saveArticle('flat-mod', createTestArticle('flat-mod'), outputDir, 'hash');
        saveArticle('area-mod', createTestArticle('area-mod', 'area1'), outputDir, 'hash');

        const cleared = clearArticlesCache(outputDir);
        expect(cleared).toBe(true);

        const articlesDir = getArticlesCacheDir(outputDir);
        expect(fs.existsSync(articlesDir)).toBe(false);
    });
});

// ============================================================================
// getArticleCachePath
// ============================================================================

describe('getArticleCachePath', () => {
    it('should return flat path without domainId', () => {
        const cachePath = getArticleCachePath(outputDir, 'auth');
        expect(cachePath).toContain(path.join('articles', 'auth.json'));
        expect(cachePath).not.toContain('domains');
    });

    it('should return domain-scoped path with domainId', () => {
        const cachePath = getArticleCachePath(outputDir, 'auth', 'packages-core');
        expect(cachePath).toContain(path.join('articles', 'packages-core', 'auth.json'));
    });
});

// ============================================================================
// Backward Compatibility
// ============================================================================

describe('backward compatibility — no domainId', () => {
    it('should save and load articles exactly as before when no domainId', () => {
        const article = createTestArticle('auth');
        saveArticle('auth', article, outputDir, 'hash');

        const loaded = getCachedArticle('auth', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.moduleId).toBe('auth');
        expect(loaded!.domainId).toBeUndefined();
    });

    it('should find flat articles in scan', () => {
        saveArticle('auth', createTestArticle('auth'), outputDir, 'hash');

        const result = scanIndividualArticlesCache(['auth'], outputDir, 'hash');
        expect(result.found).toHaveLength(1);
    });

    it('should bulk save flat articles with metadata', async () => {
        const articles = [
            createTestArticle('auth'),
            createTestArticle('database'),
        ];

        await saveAllArticles(articles, outputDir, '/repo');

        const loaded = getCachedArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(2);
    });
});
