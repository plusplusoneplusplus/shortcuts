/**
 * Topic Cache Tests
 *
 * Tests for topic generation artifact caching:
 * probe results, outlines, analyses, per-article incremental saves,
 * cache invalidation, clear operations, and corrupted file handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TopicOutline, TopicAnalysis, TopicArticle } from '../../src/types';
import type { EnrichedProbeResult } from '../../src/topic/topic-probe';

import {
    getCachedTopicProbe,
    saveTopicProbe,
    getCachedTopicOutline,
    saveTopicOutline,
    getCachedTopicAnalysis,
    saveTopicAnalysis,
    getCachedTopicArticle,
    saveTopicArticle,
    getCachedTopicArticles,
    clearTopicCache,
    clearAllTopicsCache,
    isTopicCacheValid,
    getTopicsCacheDir,
    getTopicCacheDir,
} from '../../src/cache/topic-cache';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

function createTestProbeResult(): EnrichedProbeResult {
    return {
        probeResult: {
            topic: 'compaction',
            foundModules: [
                {
                    id: 'auth',
                    name: 'Auth Module',
                    path: 'src/auth',
                    purpose: 'Authentication',
                    keyFiles: ['src/auth/index.ts'],
                    evidence: 'Handles user auth',
                },
            ],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0.9,
        },
        existingModuleIds: ['auth'],
        newModuleIds: [],
        allKeyFiles: ['src/auth/index.ts'],
    };
}

function createTestOutline(topicId: string): TopicOutline {
    return {
        topicId,
        title: `Topic: ${topicId}`,
        layout: 'area',
        articles: [
            {
                slug: 'index',
                title: 'Overview',
                description: 'Index article',
                isIndex: true,
                coveredModuleIds: ['auth'],
                coveredFiles: ['src/auth/index.ts'],
            },
            {
                slug: 'details',
                title: 'Details',
                description: 'Detail article',
                isIndex: false,
                coveredModuleIds: ['auth'],
                coveredFiles: ['src/auth/jwt.ts'],
            },
        ],
        involvedModules: [
            { moduleId: 'auth', role: 'primary', keyFiles: ['src/auth/index.ts'] },
        ],
    };
}

function createTestAnalysis(topicId: string): TopicAnalysis {
    return {
        topicId,
        overview: `Overview of ${topicId}`,
        perArticle: [
            {
                slug: 'index',
                keyConcepts: [{ name: 'Auth', description: 'Authentication' }],
                dataFlow: 'Request → Auth → Token',
                codeExamples: [],
                internalDetails: 'JWT-based',
            },
        ],
        crossCutting: {
            architecture: 'Layered',
            dataFlow: 'Top-down',
            suggestedDiagram: 'graph LR; A-->B',
        },
    };
}

function createTestArticle(topicId: string, slug: string): TopicArticle {
    return {
        type: slug === 'index' ? 'topic-index' : 'topic-article',
        slug,
        title: `Article: ${slug}`,
        content: `# ${slug}\n\nContent for ${slug}`,
        topicId,
        coveredModuleIds: ['auth'],
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-topic-cache-test-'));
    outputDir = path.join(tempDir, 'output');
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Probe Cache
// ============================================================================

describe('topic probe cache', () => {
    it('should save and retrieve probe result', () => {
        const probe = createTestProbeResult();
        saveTopicProbe('compaction', probe, outputDir, 'hash123');

        const loaded = getCachedTopicProbe('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.probeResult.confidence).toBe(0.9);
        expect(loaded!.existingModuleIds).toEqual(['auth']);
        expect(loaded!.allKeyFiles).toEqual(['src/auth/index.ts']);
    });

    it('should return null for non-existent topic', () => {
        const loaded = getCachedTopicProbe('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted probe cache', () => {
        const topicDir = getTopicCacheDir(outputDir, 'corrupted');
        fs.mkdirSync(topicDir, { recursive: true });
        fs.writeFileSync(path.join(topicDir, 'probe-result.json'), 'not valid json', 'utf-8');

        const loaded = getCachedTopicProbe('corrupted', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle probe cache with missing result field', () => {
        const topicDir = getTopicCacheDir(outputDir, 'incomplete');
        fs.mkdirSync(topicDir, { recursive: true });
        fs.writeFileSync(
            path.join(topicDir, 'probe-result.json'),
            JSON.stringify({ gitHash: 'abc', timestamp: Date.now() }),
            'utf-8'
        );

        const loaded = getCachedTopicProbe('incomplete', outputDir);
        expect(loaded).toBeNull();
    });
});

// ============================================================================
// Outline Cache
// ============================================================================

describe('topic outline cache', () => {
    it('should save and retrieve outline', () => {
        const outline = createTestOutline('compaction');
        saveTopicOutline('compaction', outline, outputDir, 'hash123');

        const loaded = getCachedTopicOutline('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.topicId).toBe('compaction');
        expect(loaded!.articles).toHaveLength(2);
        expect(loaded!.layout).toBe('area');
    });

    it('should return null for non-existent outline', () => {
        const loaded = getCachedTopicOutline('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted outline cache', () => {
        const topicDir = getTopicCacheDir(outputDir, 'bad');
        fs.mkdirSync(topicDir, { recursive: true });
        fs.writeFileSync(path.join(topicDir, 'outline.json'), '{broken', 'utf-8');

        const loaded = getCachedTopicOutline('bad', outputDir);
        expect(loaded).toBeNull();
    });

    it('should overwrite existing outline', () => {
        const outline1 = createTestOutline('compaction');
        saveTopicOutline('compaction', outline1, outputDir, 'hash1');

        const outline2 = { ...createTestOutline('compaction'), title: 'Updated Title' };
        saveTopicOutline('compaction', outline2, outputDir, 'hash2');

        const loaded = getCachedTopicOutline('compaction', outputDir);
        expect(loaded!.title).toBe('Updated Title');
    });
});

// ============================================================================
// Analysis Cache
// ============================================================================

describe('topic analysis cache', () => {
    it('should save and retrieve analysis', () => {
        const analysis = createTestAnalysis('compaction');
        saveTopicAnalysis('compaction', analysis, outputDir, 'hash123');

        const loaded = getCachedTopicAnalysis('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.topicId).toBe('compaction');
        expect(loaded!.overview).toContain('compaction');
        expect(loaded!.perArticle).toHaveLength(1);
    });

    it('should return null for non-existent analysis', () => {
        const loaded = getCachedTopicAnalysis('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted analysis cache', () => {
        const topicDir = getTopicCacheDir(outputDir, 'bad');
        fs.mkdirSync(topicDir, { recursive: true });
        fs.writeFileSync(path.join(topicDir, 'analysis.json'), '!!!', 'utf-8');

        const loaded = getCachedTopicAnalysis('bad', outputDir);
        expect(loaded).toBeNull();
    });
});

// ============================================================================
// Article Cache (per-article incremental)
// ============================================================================

describe('topic article cache', () => {
    it('should save and retrieve a single article', () => {
        const article = createTestArticle('compaction', 'index');
        saveTopicArticle('compaction', article, outputDir, 'hash123');

        const loaded = getCachedTopicArticle('compaction', 'index', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.slug).toBe('index');
        expect(loaded!.topicId).toBe('compaction');
        expect(loaded!.type).toBe('topic-index');
    });

    it('should return null for non-existent article', () => {
        const loaded = getCachedTopicArticle('compaction', 'nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should save multiple articles incrementally and retrieve all', () => {
        const articles = [
            createTestArticle('compaction', 'index'),
            createTestArticle('compaction', 'compaction-styles'),
            createTestArticle('compaction', 'compaction-picker'),
        ];

        for (const article of articles) {
            saveTopicArticle('compaction', article, outputDir, 'hash123');
        }

        const loaded = getCachedTopicArticles('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(3);
        expect(loaded!.map(a => a.slug).sort()).toEqual(
            ['compaction-picker', 'compaction-styles', 'index']
        );
    });

    it('should return null when no articles directory exists', () => {
        const loaded = getCachedTopicArticles('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should skip corrupted article files in bulk read', () => {
        saveTopicArticle('compaction', createTestArticle('compaction', 'good'), outputDir, 'hash123');

        // Write a corrupted article
        const articlesDir = path.join(getTopicCacheDir(outputDir, 'compaction'), 'articles');
        fs.writeFileSync(path.join(articlesDir, 'bad.json'), 'not json', 'utf-8');

        const loaded = getCachedTopicArticles('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
        expect(loaded![0].slug).toBe('good');
    });

    it('should handle corrupted single article gracefully', () => {
        const articlesDir = path.join(getTopicCacheDir(outputDir, 'compaction'), 'articles');
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(path.join(articlesDir, 'broken.json'), 'oops', 'utf-8');

        const loaded = getCachedTopicArticle('compaction', 'broken', outputDir);
        expect(loaded).toBeNull();
    });
});

// ============================================================================
// Cache Invalidation
// ============================================================================

describe('topic cache validation', () => {
    it('should report valid when git hash matches', () => {
        saveTopicProbe('compaction', createTestProbeResult(), outputDir, 'hashA');

        expect(isTopicCacheValid('compaction', outputDir, 'hashA')).toBe(true);
    });

    it('should report invalid when git hash differs', () => {
        saveTopicProbe('compaction', createTestProbeResult(), outputDir, 'hashA');

        expect(isTopicCacheValid('compaction', outputDir, 'hashB')).toBe(false);
    });

    it('should report invalid when no cache exists', () => {
        expect(isTopicCacheValid('nonexistent', outputDir, 'hashA')).toBe(false);
    });

    it('should report invalid when probe cache is corrupted', () => {
        const topicDir = getTopicCacheDir(outputDir, 'bad');
        fs.mkdirSync(topicDir, { recursive: true });
        fs.writeFileSync(path.join(topicDir, 'probe-result.json'), 'corrupt', 'utf-8');

        expect(isTopicCacheValid('bad', outputDir, 'hashA')).toBe(false);
    });
});

// ============================================================================
// Clear Operations
// ============================================================================

describe('topic cache clear', () => {
    it('should clear all artifacts for a specific topic', () => {
        saveTopicProbe('compaction', createTestProbeResult(), outputDir, 'hash');
        saveTopicOutline('compaction', createTestOutline('compaction'), outputDir, 'hash');
        saveTopicAnalysis('compaction', createTestAnalysis('compaction'), outputDir, 'hash');
        saveTopicArticle('compaction', createTestArticle('compaction', 'index'), outputDir, 'hash');

        const cleared = clearTopicCache('compaction', outputDir);
        expect(cleared).toBe(true);

        expect(getCachedTopicProbe('compaction', outputDir)).toBeNull();
        expect(getCachedTopicOutline('compaction', outputDir)).toBeNull();
        expect(getCachedTopicAnalysis('compaction', outputDir)).toBeNull();
        expect(getCachedTopicArticles('compaction', outputDir)).toBeNull();
    });

    it('should return false when clearing non-existent topic cache', () => {
        const cleared = clearTopicCache('nonexistent', outputDir);
        expect(cleared).toBe(false);
    });

    it('should not affect other topics when clearing one', () => {
        saveTopicProbe('topic-a', createTestProbeResult(), outputDir, 'hash');
        saveTopicProbe('topic-b', createTestProbeResult(), outputDir, 'hash');

        clearTopicCache('topic-a', outputDir);

        expect(getCachedTopicProbe('topic-a', outputDir)).toBeNull();
        expect(getCachedTopicProbe('topic-b', outputDir)).not.toBeNull();
    });

    it('should clear all topic caches at once', () => {
        saveTopicProbe('topic-a', createTestProbeResult(), outputDir, 'hash');
        saveTopicProbe('topic-b', createTestProbeResult(), outputDir, 'hash');

        const cleared = clearAllTopicsCache(outputDir);
        expect(cleared).toBe(true);

        expect(getCachedTopicProbe('topic-a', outputDir)).toBeNull();
        expect(getCachedTopicProbe('topic-b', outputDir)).toBeNull();
    });

    it('should return false when clearing empty topics cache', () => {
        const cleared = clearAllTopicsCache(outputDir);
        expect(cleared).toBe(false);
    });
});

// ============================================================================
// Cache Directory Structure
// ============================================================================

describe('cache directory structure', () => {
    it('should create correct directory structure', () => {
        const topicId = 'compaction';
        saveTopicProbe(topicId, createTestProbeResult(), outputDir, 'hash');
        saveTopicOutline(topicId, createTestOutline(topicId), outputDir, 'hash');
        saveTopicAnalysis(topicId, createTestAnalysis(topicId), outputDir, 'hash');
        saveTopicArticle(topicId, createTestArticle(topicId, 'index'), outputDir, 'hash');
        saveTopicArticle(topicId, createTestArticle(topicId, 'compaction-styles'), outputDir, 'hash');

        const topicDir = getTopicCacheDir(outputDir, topicId);
        expect(fs.existsSync(path.join(topicDir, 'probe-result.json'))).toBe(true);
        expect(fs.existsSync(path.join(topicDir, 'outline.json'))).toBe(true);
        expect(fs.existsSync(path.join(topicDir, 'analysis.json'))).toBe(true);
        expect(fs.existsSync(path.join(topicDir, 'articles', 'index.json'))).toBe(true);
        expect(fs.existsSync(path.join(topicDir, 'articles', 'compaction-styles.json'))).toBe(true);
    });

    it('should store topics under .wiki-cache/topics/', () => {
        const topicsDir = getTopicsCacheDir(outputDir);
        expect(topicsDir).toContain('.wiki-cache');
        expect(topicsDir).toMatch(/topics$/);
    });
});
