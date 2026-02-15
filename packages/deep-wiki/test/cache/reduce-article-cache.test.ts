/**
 * Reduce Article Cache Tests
 *
 * Tests for Phase 4 reduce-phase article caching:
 * - Save/load reduce articles (index, architecture, getting-started)
 * - Domain-scoped reduce articles (domain-index, domain-architecture)
 * - Reduce metadata read/write
 * - Git hash validation
 * - Cache invalidation when module articles change
 * - Isolation from module article cache
 * - Edge cases: corrupted cache, missing metadata, partial cache
 * - getCachedArticles skips reduce files
 * - clearArticlesCache also clears reduce files
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { GeneratedArticle, AnalysisCacheMetadata } from '../../src/types';

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
    saveReduceArticles,
    getCachedReduceArticles,
    getReduceCacheMetadata,
    getReduceMetadataPath,
    getReduceArticleCachePath,
    saveArticle,
    saveAllArticles,
    getCachedArticles,
    getCachedArticle,
    clearArticlesCache,
    getArticlesCacheDir,
    scanIndividualArticlesCache,
    scanIndividualArticlesCacheAny,
} from '../../src/cache';
import { getRepoHeadHash, getFolderHeadHash } from '../../src/cache/git-utils';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

function createModuleArticle(moduleId: string, domainId?: string): GeneratedArticle {
    return {
        type: 'module',
        slug: moduleId,
        title: `${moduleId} Module`,
        content: `# ${moduleId}\n\nArticle content for ${moduleId}.`,
        moduleId,
        domainId,
    };
}

function createIndexArticle(): GeneratedArticle {
    return {
        type: 'index',
        slug: 'index',
        title: 'Wiki Index',
        content: '# Index\n\nWelcome to the wiki.\n\n## Modules\n\n- auth\n- database',
    };
}

function createArchitectureArticle(): GeneratedArticle {
    return {
        type: 'architecture',
        slug: 'architecture',
        title: 'Architecture Overview',
        content: '# Architecture\n\nOverview of system architecture.',
    };
}

function createGettingStartedArticle(): GeneratedArticle {
    return {
        type: 'getting-started',
        slug: 'getting-started',
        title: 'Getting Started',
        content: '# Getting Started\n\nHow to get started with this project.',
    };
}

function createDomainIndexArticle(domainId: string): GeneratedArticle {
    return {
        type: 'domain-index',
        slug: `${domainId}-index`,
        title: `${domainId} Index`,
        content: `# ${domainId}\n\nIndex for domain ${domainId}.`,
        domainId,
    };
}

function createAreaArchitectureArticle(domainId: string): GeneratedArticle {
    return {
        type: 'domain-architecture',
        slug: `${domainId}-architecture`,
        title: `${domainId} Architecture`,
        content: `# ${domainId} Architecture\n\nArchitecture for domain ${domainId}.`,
        domainId,
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-reduce-cache-test-'));
    outputDir = path.join(tempDir, 'output');
    vi.clearAllMocks();
    vi.mocked(getRepoHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
    vi.mocked(getFolderHeadHash).mockResolvedValue('abc123def456abc123def456abc123def456abc1');
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// saveReduceArticles / getCachedReduceArticles
// ============================================================================

describe('saveReduceArticles / getCachedReduceArticles', () => {
    it('should save and load reduce articles', () => {
        const articles = [
            createIndexArticle(),
            createArchitectureArticle(),
            createGettingStartedArticle(),
        ];

        saveReduceArticles(articles, outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(3);
        expect(loaded!.map(a => a.type).sort()).toEqual([
            'architecture',
            'getting-started',
            'index',
        ]);
    });

    it('should filter out module articles when saving', () => {
        const articles = [
            createModuleArticle('auth'),
            createIndexArticle(),
            createArchitectureArticle(),
            createModuleArticle('database'),
        ];

        saveReduceArticles(articles, outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(2);
        expect(loaded!.every(a => a.type !== 'module')).toBe(true);
    });

    it('should not write anything when only module articles provided', () => {
        const articles = [
            createModuleArticle('auth'),
            createModuleArticle('database'),
        ];

        saveReduceArticles(articles, outputDir, 'hash123');

        const metadata = getReduceCacheMetadata(outputDir);
        expect(metadata).toBeNull();
    });

    it('should return null when no cache exists', () => {
        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).toBeNull();
    });

    it('should validate git hash when provided', () => {
        const articles = [createIndexArticle()];
        saveReduceArticles(articles, outputDir, 'hash123');

        // Matching hash
        const loaded = getCachedReduceArticles(outputDir, 'hash123');
        expect(loaded).not.toBeNull();

        // Non-matching hash
        const loadedStale = getCachedReduceArticles(outputDir, 'different_hash');
        expect(loadedStale).toBeNull();
    });

    it('should load without hash validation when no hash provided', () => {
        const articles = [createIndexArticle()];
        saveReduceArticles(articles, outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
    });

    it('should overwrite existing reduce cache', () => {
        saveReduceArticles([createIndexArticle()], outputDir, 'hash1');

        const updatedIndex: GeneratedArticle = {
            ...createIndexArticle(),
            content: 'Updated index content',
        };
        saveReduceArticles([updatedIndex, createArchitectureArticle()], outputDir, 'hash2');

        const loaded = getCachedReduceArticles(outputDir, 'hash2');
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(2);
        const index = loaded!.find(a => a.type === 'index');
        expect(index!.content).toBe('Updated index content');
    });

    it('should handle empty articles array', () => {
        saveReduceArticles([], outputDir, 'hash123');

        const metadata = getReduceCacheMetadata(outputDir);
        expect(metadata).toBeNull();
    });
});

// ============================================================================
// Area-Scoped Reduce Articles
// ============================================================================

describe('domain-scoped reduce articles', () => {
    it('should save and load domain-index articles', () => {
        const articles = [
            createDomainIndexArticle('packages-core'),
            createDomainIndexArticle('packages-api'),
        ];

        saveReduceArticles(articles, outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(2);
        expect(loaded!.every(a => a.type === 'domain-index')).toBe(true);
    });

    it('should save and load domain-architecture articles', () => {
        const articles = [
            createAreaArchitectureArticle('packages-core'),
        ];

        saveReduceArticles(articles, outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
        expect(loaded![0].type).toBe('domain-architecture');
        expect(loaded![0].domainId).toBe('packages-core');
    });

    it('should handle mixed reduce articles (global + domain-scoped)', () => {
        const articles = [
            createIndexArticle(),
            createArchitectureArticle(),
            createGettingStartedArticle(),
            createDomainIndexArticle('packages-core'),
            createAreaArchitectureArticle('packages-core'),
            createDomainIndexArticle('packages-api'),
        ];

        saveReduceArticles(articles, outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(6);
    });

    it('should preserve domainId through save/load round-trip', () => {
        const article = createDomainIndexArticle('my-domain');
        saveReduceArticles([article], outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded![0].domainId).toBe('my-domain');
    });
});

// ============================================================================
// getReduceArticleCachePath
// ============================================================================

describe('getReduceArticleCachePath', () => {
    it('should return path with _reduce- prefix for global articles', () => {
        const cachePath = getReduceArticleCachePath(outputDir, 'index');
        expect(cachePath).toContain('_reduce-index.json');
    });

    it('should return path with domain prefix for domain articles', () => {
        const cachePath = getReduceArticleCachePath(outputDir, 'index', 'packages-core');
        expect(cachePath).toContain('_reduce-domain-packages-core-index.json');
    });

    it('should return path for architecture article', () => {
        const cachePath = getReduceArticleCachePath(outputDir, 'architecture');
        expect(cachePath).toContain('_reduce-architecture.json');
    });

    it('should return path for getting-started article', () => {
        const cachePath = getReduceArticleCachePath(outputDir, 'getting-started');
        expect(cachePath).toContain('_reduce-getting-started.json');
    });

    it('should return path for domain-architecture article', () => {
        const cachePath = getReduceArticleCachePath(outputDir, 'domain-architecture', 'my-domain');
        expect(cachePath).toContain('_reduce-domain-my-domain-domain-architecture.json');
    });
});

// ============================================================================
// getReduceMetadataPath
// ============================================================================

describe('getReduceMetadataPath', () => {
    it('should return path in articles directory', () => {
        const metadataPath = getReduceMetadataPath(outputDir);
        expect(metadataPath).toContain('articles');
        expect(metadataPath).toContain('_reduce-metadata.json');
    });

    it('should be different from module articles metadata path', () => {
        const reduceMetadataPath = getReduceMetadataPath(outputDir);
        const articlesDir = getArticlesCacheDir(outputDir);
        const moduleMetadataPath = path.join(articlesDir, '_metadata.json');
        expect(reduceMetadataPath).not.toBe(moduleMetadataPath);
    });
});

// ============================================================================
// getReduceCacheMetadata
// ============================================================================

describe('getReduceCacheMetadata', () => {
    it('should return metadata after saving reduce articles', () => {
        saveReduceArticles([createIndexArticle()], outputDir, 'hash123');

        const metadata = getReduceCacheMetadata(outputDir);
        expect(metadata).not.toBeNull();
        expect(metadata!.gitHash).toBe('hash123');
        expect(metadata!.moduleCount).toBe(1);
        expect(metadata!.version).toBe('1.0.0');
        expect(metadata!.timestamp).toBeGreaterThan(0);
    });

    it('should return null when no reduce cache exists', () => {
        const metadata = getReduceCacheMetadata(outputDir);
        expect(metadata).toBeNull();
    });

    it('should return null for corrupted metadata', () => {
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(
            path.join(articlesDir, '_reduce-metadata.json'),
            'not valid json',
            'utf-8'
        );

        const metadata = getReduceCacheMetadata(outputDir);
        expect(metadata).toBeNull();
    });

    it('should track correct count for multiple reduce articles', () => {
        const articles = [
            createIndexArticle(),
            createArchitectureArticle(),
            createGettingStartedArticle(),
        ];
        saveReduceArticles(articles, outputDir, 'hash123');

        const metadata = getReduceCacheMetadata(outputDir);
        expect(metadata!.moduleCount).toBe(3);
    });
});

// ============================================================================
// Isolation from Module Article Cache
// ============================================================================

describe('isolation from module article cache', () => {
    it('should not interfere with module article save/load', () => {
        // Save module articles
        saveArticle('auth', createModuleArticle('auth'), outputDir, 'hash123');
        saveArticle('db', createModuleArticle('db'), outputDir, 'hash123');

        // Save reduce articles
        saveReduceArticles(
            [createIndexArticle(), createArchitectureArticle()],
            outputDir,
            'hash123'
        );

        // Module articles should still load correctly
        const auth = getCachedArticle('auth', outputDir);
        expect(auth).not.toBeNull();
        expect(auth!.moduleId).toBe('auth');

        const db = getCachedArticle('db', outputDir);
        expect(db).not.toBeNull();
        expect(db!.moduleId).toBe('db');
    });

    it('getCachedArticles should NOT include reduce articles', async () => {
        // Save module articles (with metadata)
        const moduleArticles = [
            createModuleArticle('auth'),
            createModuleArticle('db'),
        ];
        await saveAllArticles(moduleArticles, outputDir, '/repo');

        // Save reduce articles
        saveReduceArticles(
            [createIndexArticle(), createArchitectureArticle()],
            outputDir,
            'hash123'
        );

        // getCachedArticles should only return module articles
        const loaded = getCachedArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(2);
        expect(loaded!.every(a => a.type === 'module')).toBe(true);
    });

    it('scanIndividualArticlesCache should not find reduce articles', () => {
        // Save reduce articles
        saveReduceArticles([createIndexArticle()], outputDir, 'hash123');

        // scanIndividualArticlesCache should not find them
        const result = scanIndividualArticlesCache(
            ['index'],
            outputDir,
            'hash123'
        );
        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['index']);
    });

    it('scanIndividualArticlesCacheAny should not find reduce articles', () => {
        saveReduceArticles([createIndexArticle()], outputDir, 'hash123');

        const result = scanIndividualArticlesCacheAny(['index'], outputDir);
        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['index']);
    });

    it('module and reduce metadata files should be separate', async () => {
        // Save module articles
        await saveAllArticles([createModuleArticle('auth')], outputDir, '/repo');

        // Save reduce articles
        saveReduceArticles([createIndexArticle()], outputDir, 'hash123');

        const articlesDir = getArticlesCacheDir(outputDir);

        // Both metadata files should exist
        expect(fs.existsSync(path.join(articlesDir, '_metadata.json'))).toBe(true);
        expect(fs.existsSync(path.join(articlesDir, '_reduce-metadata.json'))).toBe(true);

        // They should have different counts
        const moduleMetadata = JSON.parse(
            fs.readFileSync(path.join(articlesDir, '_metadata.json'), 'utf-8')
        ) as AnalysisCacheMetadata;
        const reduceMetadata = JSON.parse(
            fs.readFileSync(path.join(articlesDir, '_reduce-metadata.json'), 'utf-8')
        ) as AnalysisCacheMetadata;

        expect(moduleMetadata.moduleCount).toBe(1);
        expect(reduceMetadata.moduleCount).toBe(1);
    });
});

// ============================================================================
// clearArticlesCache — Reduce Files
// ============================================================================

describe('clearArticlesCache includes reduce files', () => {
    it('should clear reduce articles when clearing articles cache', () => {
        // Save reduce articles
        saveReduceArticles(
            [createIndexArticle(), createArchitectureArticle()],
            outputDir,
            'hash123'
        );

        const cleared = clearArticlesCache(outputDir);
        expect(cleared).toBe(true);

        // Reduce articles should be gone
        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).toBeNull();

        const metadata = getReduceCacheMetadata(outputDir);
        expect(metadata).toBeNull();
    });

    it('should clear both module and reduce articles together', async () => {
        // Save module articles
        await saveAllArticles([createModuleArticle('auth')], outputDir, '/repo');

        // Save reduce articles
        saveReduceArticles([createIndexArticle()], outputDir, 'hash123');

        const cleared = clearArticlesCache(outputDir);
        expect(cleared).toBe(true);

        expect(getCachedArticles(outputDir)).toBeNull();
        expect(getCachedReduceArticles(outputDir)).toBeNull();
    });
});

// ============================================================================
// Cache File Structure
// ============================================================================

describe('reduce cache file structure', () => {
    it('should create _reduce-*.json files in articles directory', () => {
        saveReduceArticles(
            [createIndexArticle(), createArchitectureArticle()],
            outputDir,
            'hash123'
        );

        const articlesDir = getArticlesCacheDir(outputDir);
        expect(fs.existsSync(path.join(articlesDir, '_reduce-index.json'))).toBe(true);
        expect(fs.existsSync(path.join(articlesDir, '_reduce-architecture.json'))).toBe(true);
        expect(fs.existsSync(path.join(articlesDir, '_reduce-metadata.json'))).toBe(true);
    });

    it('should create domain-scoped reduce file names', () => {
        saveReduceArticles(
            [createDomainIndexArticle('packages-core')],
            outputDir,
            'hash123'
        );

        const articlesDir = getArticlesCacheDir(outputDir);
        expect(
            fs.existsSync(path.join(articlesDir, '_reduce-domain-packages-core-domain-index.json'))
        ).toBe(true);
    });

    it('CachedArticle structure should include gitHash and timestamp', () => {
        saveReduceArticles([createIndexArticle()], outputDir, 'hash123');

        const articlesDir = getArticlesCacheDir(outputDir);
        const content = JSON.parse(
            fs.readFileSync(path.join(articlesDir, '_reduce-index.json'), 'utf-8')
        );

        expect(content.article).toBeDefined();
        expect(content.article.type).toBe('index');
        expect(content.gitHash).toBe('hash123');
        expect(content.timestamp).toBeGreaterThan(0);
    });
});

// ============================================================================
// Git Hash Validation
// ============================================================================

describe('git hash validation', () => {
    it('should return articles when git hash matches', () => {
        const hash = 'matching_hash_123';
        saveReduceArticles([createIndexArticle()], outputDir, hash);

        const loaded = getCachedReduceArticles(outputDir, hash);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
    });

    it('should return null when git hash does not match', () => {
        saveReduceArticles([createIndexArticle()], outputDir, 'old_hash');

        const loaded = getCachedReduceArticles(outputDir, 'new_hash');
        expect(loaded).toBeNull();
    });

    it('should invalidate when any module article changes (via different git hash)', () => {
        // Save reduce articles with hash1
        saveReduceArticles(
            [createIndexArticle(), createArchitectureArticle()],
            outputDir,
            'hash_v1'
        );

        // Verify they load with hash1
        expect(getCachedReduceArticles(outputDir, 'hash_v1')).not.toBeNull();

        // After module change (new hash), reduce cache is stale
        expect(getCachedReduceArticles(outputDir, 'hash_v2')).toBeNull();
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
    it('should handle corrupted reduce article file', () => {
        // Save a valid reduce article
        saveReduceArticles([createIndexArticle()], outputDir, 'hash123');

        // Corrupt the file
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.writeFileSync(
            path.join(articlesDir, '_reduce-index.json'),
            'not valid json!!!',
            'utf-8'
        );

        // Should still return what it can (empty in this case)
        const loaded = getCachedReduceArticles(outputDir);
        // Metadata exists but no valid articles
        expect(loaded).toBeNull();
    });

    it('should handle missing reduce article files with valid metadata', () => {
        saveReduceArticles([createIndexArticle()], outputDir, 'hash123');

        // Delete the article file but keep metadata
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.unlinkSync(path.join(articlesDir, '_reduce-index.json'));

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).toBeNull(); // No articles found even though metadata exists
    });

    it('should handle reduce metadata without any reduce article files', () => {
        // Manually write only the metadata
        const articlesDir = getArticlesCacheDir(outputDir);
        fs.mkdirSync(articlesDir, { recursive: true });
        const metadata: AnalysisCacheMetadata = {
            gitHash: 'hash123',
            timestamp: Date.now(),
            version: '1.0.0',
            moduleCount: 3,
        };
        fs.writeFileSync(
            path.join(articlesDir, '_reduce-metadata.json'),
            JSON.stringify(metadata, null, 2),
            'utf-8'
        );

        const loaded = getCachedReduceArticles(outputDir, 'hash123');
        expect(loaded).toBeNull(); // Metadata present but no actual files
    });

    it('should handle articles directory not existing', () => {
        const loaded = getCachedReduceArticles(outputDir, 'hash123');
        expect(loaded).toBeNull();
    });

    it('should handle article with very long content', () => {
        const longArticle: GeneratedArticle = {
            ...createIndexArticle(),
            content: '#'.repeat(100_000),
        };

        saveReduceArticles([longArticle], outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded![0].content.length).toBe(100_000);
    });

    it('should handle article with empty content', () => {
        const emptyArticle: GeneratedArticle = {
            ...createIndexArticle(),
            content: '',
        };

        saveReduceArticles([emptyArticle], outputDir, 'hash123');

        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded![0].content).toBe('');
    });

    it('should preserve full article content through save/load round-trip', () => {
        const articles = [
            createIndexArticle(),
            createArchitectureArticle(),
            createGettingStartedArticle(),
        ];

        saveReduceArticles(articles, outputDir, 'hash123');
        const loaded = getCachedReduceArticles(outputDir);

        expect(loaded).not.toBeNull();
        for (const original of articles) {
            const cached = loaded!.find(a => a.type === original.type);
            expect(cached).toBeDefined();
            expect(cached!.slug).toBe(original.slug);
            expect(cached!.title).toBe(original.title);
            expect(cached!.content).toBe(original.content);
        }
    });
});

// ============================================================================
// Scenario Tests (simulating real usage)
// ============================================================================

describe('real-world scenarios', () => {
    it('scenario: first run saves both module and reduce articles', async () => {
        // Phase 4 first run: generate all articles
        const moduleArticles = [
            createModuleArticle('auth'),
            createModuleArticle('database'),
            createModuleArticle('api'),
        ];
        const reduceArticles = [
            createIndexArticle(),
            createArchitectureArticle(),
            createGettingStartedArticle(),
        ];

        const hash = 'initial_hash';

        // Save module articles (like saveAllArticles does)
        await saveAllArticles(moduleArticles, outputDir, '/repo');

        // Save reduce articles
        saveReduceArticles(reduceArticles, outputDir, hash);

        // Verify both are cached
        const loadedModules = getCachedArticles(outputDir);
        expect(loadedModules).toHaveLength(3);

        const loadedReduce = getCachedReduceArticles(outputDir, hash);
        expect(loadedReduce).toHaveLength(3);
    });

    it('scenario: second run loads everything from cache', async () => {
        // saveAllArticles calls getRepoHeadHash internally which returns the mocked hash
        const mockHash = 'abc123def456abc123def456abc123def456abc1';

        // First run: save everything
        await saveAllArticles(
            [createModuleArticle('auth'), createModuleArticle('db')],
            outputDir,
            '/repo'
        );
        saveReduceArticles(
            [createIndexArticle(), createArchitectureArticle()],
            outputDir,
            mockHash
        );

        // Second run: load from cache (using same hash as saveAllArticles used internally)
        const moduleArticles = scanIndividualArticlesCache(
            ['auth', 'db'],
            outputDir,
            mockHash
        );
        expect(moduleArticles.found).toHaveLength(2);
        expect(moduleArticles.missing).toHaveLength(0);

        const reduceArticles = getCachedReduceArticles(outputDir, mockHash);
        expect(reduceArticles).not.toBeNull();
        expect(reduceArticles).toHaveLength(2);

        // Total: 4 articles from cache, 0 AI sessions needed
    });

    it('scenario: module articles cached but reduce articles missing (regenerate reduce only)', async () => {
        const hash = 'current_hash';

        // Save only module articles (simulating old cache without reduce)
        saveArticle('auth', createModuleArticle('auth'), outputDir, hash);
        saveArticle('db', createModuleArticle('db'), outputDir, hash);

        // Module articles are cached
        const moduleResult = scanIndividualArticlesCache(
            ['auth', 'db'],
            outputDir,
            hash
        );
        expect(moduleResult.found).toHaveLength(2);
        expect(moduleResult.missing).toHaveLength(0);

        // Reduce articles are NOT cached
        const reduceArticles = getCachedReduceArticles(outputDir, hash);
        expect(reduceArticles).toBeNull();

        // → Should regenerate reduce articles only
    });

    it('scenario: reduce articles cached but module articles missing (regenerate everything)', () => {
        const hash = 'current_hash';

        // Save only reduce articles
        saveReduceArticles(
            [createIndexArticle(), createArchitectureArticle()],
            outputDir,
            hash
        );

        // Module articles are NOT cached
        const moduleResult = scanIndividualArticlesCache(
            ['auth', 'db'],
            outputDir,
            hash
        );
        expect(moduleResult.found).toHaveLength(0);
        expect(moduleResult.missing).toEqual(['auth', 'db']);

        // Reduce articles are cached
        const reduceArticles = getCachedReduceArticles(outputDir, hash);
        expect(reduceArticles).not.toBeNull();

        // → Since modules are missing, should regenerate everything
    });

    it('scenario: git hash changed invalidates both module and reduce cache', async () => {
        // Save with old hash
        saveArticle('auth', createModuleArticle('auth'), outputDir, 'old_hash');
        saveReduceArticles([createIndexArticle()], outputDir, 'old_hash');

        // With new hash, both should be invalidated
        const moduleResult = scanIndividualArticlesCache(
            ['auth'],
            outputDir,
            'new_hash'
        );
        expect(moduleResult.found).toHaveLength(0);

        const reduceArticles = getCachedReduceArticles(outputDir, 'new_hash');
        expect(reduceArticles).toBeNull();
    });

    it('scenario: --use-cache flag loads reduce articles without hash validation', () => {
        saveReduceArticles([createIndexArticle()], outputDir, 'any_hash');

        // Without hash (simulates --use-cache)
        const loaded = getCachedReduceArticles(outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
    });

    it('scenario: large repo with domain-scoped articles', () => {
        const hash = 'large_repo_hash';

        // Save domain-scoped reduce articles
        const articles = [
            createIndexArticle(),
            createArchitectureArticle(),
            createGettingStartedArticle(),
            createDomainIndexArticle('packages-core'),
            createAreaArchitectureArticle('packages-core'),
            createDomainIndexArticle('packages-api'),
            createAreaArchitectureArticle('packages-api'),
        ];

        saveReduceArticles(articles, outputDir, hash);

        const loaded = getCachedReduceArticles(outputDir, hash);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(7);

        // Verify domain-scoped articles preserved their domainId
        const domainArticles = loaded!.filter(a => a.domainId);
        expect(domainArticles).toHaveLength(4);
    });
});
