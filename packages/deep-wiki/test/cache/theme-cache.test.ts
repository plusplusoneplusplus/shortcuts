/**
 * Theme Cache Tests
 *
 * Tests for theme generation artifact caching:
 * probe results, outlines, analyses, per-article incremental saves,
 * cache invalidation, clear operations, and corrupted file handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ThemeOutline, ThemeAnalysis, ThemeArticle } from '../../src/types';
import type { EnrichedProbeResult } from '../../src/theme/theme-probe';

import {
    getCachedThemeProbe,
    saveThemeProbe,
    getCachedThemeOutline,
    saveThemeOutline,
    getCachedThemeAnalysis,
    saveThemeAnalysis,
    getCachedThemeArticle,
    saveThemeArticle,
    getCachedThemeArticles,
    clearThemeCache,
    clearAllThemesCache,
    isThemeCacheValid,
    getThemesCacheDir,
    getThemeCacheDir,
} from '../../src/cache/theme-cache';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

function createTestProbeResult(): EnrichedProbeResult {
    return {
        probeResult: {
            theme: 'compaction',
            foundComponents: [
                {
                    id: 'auth',
                    name: 'Auth Module',
                    path: 'src/auth',
                    purpose: 'Authentication',
                    keyFiles: ['src/auth/index.ts'],
                    evidence: 'Handles user auth',
                },
            ],
            discoveredThemes: [],
            dependencies: [],
            confidence: 0.9,
        },
        existingModuleIds: ['auth'],
        newModuleIds: [],
        allKeyFiles: ['src/auth/index.ts'],
    };
}

function createTestOutline(themeId: string): ThemeOutline {
    return {
        themeId,
        title: `Theme: ${themeId}`,
        layout: 'area',
        articles: [
            {
                slug: 'index',
                title: 'Overview',
                description: 'Index article',
                isIndex: true,
                coveredComponentIds: ['auth'],
                coveredFiles: ['src/auth/index.ts'],
            },
            {
                slug: 'details',
                title: 'Details',
                description: 'Detail article',
                isIndex: false,
                coveredComponentIds: ['auth'],
                coveredFiles: ['src/auth/jwt.ts'],
            },
        ],
        involvedComponents: [
            { componentId: 'auth', role: 'primary', keyFiles: ['src/auth/index.ts'] },
        ],
    };
}

function createTestAnalysis(themeId: string): ThemeAnalysis {
    return {
        themeId,
        overview: `Overview of ${themeId}`,
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

function createTestArticle(themeId: string, slug: string): ThemeArticle {
    return {
        type: slug === 'index' ? 'theme-index' : 'theme-article',
        slug,
        title: `Article: ${slug}`,
        content: `# ${slug}\n\nContent for ${slug}`,
        themeId,
        coveredComponentIds: ['auth'],
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-theme-cache-test-'));
    outputDir = path.join(tempDir, 'output');
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Probe Cache
// ============================================================================

describe('theme probe cache', () => {
    it('should save and retrieve probe result', () => {
        const probe = createTestProbeResult();
        saveThemeProbe('compaction', probe, outputDir, 'hash123');

        const loaded = getCachedThemeProbe('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.probeResult.confidence).toBe(0.9);
        expect(loaded!.existingModuleIds).toEqual(['auth']);
        expect(loaded!.allKeyFiles).toEqual(['src/auth/index.ts']);
    });

    it('should return null for non-existent theme', () => {
        const loaded = getCachedThemeProbe('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted probe cache', () => {
        const themeDir = getThemeCacheDir(outputDir, 'corrupted');
        fs.mkdirSync(themeDir, { recursive: true });
        fs.writeFileSync(path.join(themeDir, 'probe-result.json'), 'not valid json', 'utf-8');

        const loaded = getCachedThemeProbe('corrupted', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle probe cache with missing result field', () => {
        const themeDir = getThemeCacheDir(outputDir, 'incomplete');
        fs.mkdirSync(themeDir, { recursive: true });
        fs.writeFileSync(
            path.join(themeDir, 'probe-result.json'),
            JSON.stringify({ gitHash: 'abc', timestamp: Date.now() }),
            'utf-8'
        );

        const loaded = getCachedThemeProbe('incomplete', outputDir);
        expect(loaded).toBeNull();
    });
});

// ============================================================================
// Outline Cache
// ============================================================================

describe('theme outline cache', () => {
    it('should save and retrieve outline', () => {
        const outline = createTestOutline('compaction');
        saveThemeOutline('compaction', outline, outputDir, 'hash123');

        const loaded = getCachedThemeOutline('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.themeId).toBe('compaction');
        expect(loaded!.articles).toHaveLength(2);
        expect(loaded!.layout).toBe('area');
    });

    it('should return null for non-existent outline', () => {
        const loaded = getCachedThemeOutline('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted outline cache', () => {
        const themeDir = getThemeCacheDir(outputDir, 'bad');
        fs.mkdirSync(themeDir, { recursive: true });
        fs.writeFileSync(path.join(themeDir, 'outline.json'), '{broken', 'utf-8');

        const loaded = getCachedThemeOutline('bad', outputDir);
        expect(loaded).toBeNull();
    });

    it('should overwrite existing outline', () => {
        const outline1 = createTestOutline('compaction');
        saveThemeOutline('compaction', outline1, outputDir, 'hash1');

        const outline2 = { ...createTestOutline('compaction'), title: 'Updated Title' };
        saveThemeOutline('compaction', outline2, outputDir, 'hash2');

        const loaded = getCachedThemeOutline('compaction', outputDir);
        expect(loaded!.title).toBe('Updated Title');
    });
});

// ============================================================================
// Analysis Cache
// ============================================================================

describe('theme analysis cache', () => {
    it('should save and retrieve analysis', () => {
        const analysis = createTestAnalysis('compaction');
        saveThemeAnalysis('compaction', analysis, outputDir, 'hash123');

        const loaded = getCachedThemeAnalysis('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.themeId).toBe('compaction');
        expect(loaded!.overview).toContain('compaction');
        expect(loaded!.perArticle).toHaveLength(1);
    });

    it('should return null for non-existent analysis', () => {
        const loaded = getCachedThemeAnalysis('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should handle corrupted analysis cache', () => {
        const themeDir = getThemeCacheDir(outputDir, 'bad');
        fs.mkdirSync(themeDir, { recursive: true });
        fs.writeFileSync(path.join(themeDir, 'analysis.json'), '!!!', 'utf-8');

        const loaded = getCachedThemeAnalysis('bad', outputDir);
        expect(loaded).toBeNull();
    });
});

// ============================================================================
// Article Cache (per-article incremental)
// ============================================================================

describe('theme article cache', () => {
    it('should save and retrieve a single article', () => {
        const article = createTestArticle('compaction', 'index');
        saveThemeArticle('compaction', article, outputDir, 'hash123');

        const loaded = getCachedThemeArticle('compaction', 'index', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.slug).toBe('index');
        expect(loaded!.themeId).toBe('compaction');
        expect(loaded!.type).toBe('theme-index');
    });

    it('should return null for non-existent article', () => {
        const loaded = getCachedThemeArticle('compaction', 'nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should save multiple articles incrementally and retrieve all', () => {
        const articles = [
            createTestArticle('compaction', 'index'),
            createTestArticle('compaction', 'compaction-styles'),
            createTestArticle('compaction', 'compaction-picker'),
        ];

        for (const article of articles) {
            saveThemeArticle('compaction', article, outputDir, 'hash123');
        }

        const loaded = getCachedThemeArticles('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(3);
        expect(loaded!.map(a => a.slug).sort()).toEqual(
            ['compaction-picker', 'compaction-styles', 'index']
        );
    });

    it('should return null when no articles directory exists', () => {
        const loaded = getCachedThemeArticles('nonexistent', outputDir);
        expect(loaded).toBeNull();
    });

    it('should skip corrupted article files in bulk read', () => {
        saveThemeArticle('compaction', createTestArticle('compaction', 'good'), outputDir, 'hash123');

        // Write a corrupted article
        const articlesDir = path.join(getThemeCacheDir(outputDir, 'compaction'), 'articles');
        fs.writeFileSync(path.join(articlesDir, 'bad.json'), 'not json', 'utf-8');

        const loaded = getCachedThemeArticles('compaction', outputDir);
        expect(loaded).not.toBeNull();
        expect(loaded).toHaveLength(1);
        expect(loaded![0].slug).toBe('good');
    });

    it('should handle corrupted single article gracefully', () => {
        const articlesDir = path.join(getThemeCacheDir(outputDir, 'compaction'), 'articles');
        fs.mkdirSync(articlesDir, { recursive: true });
        fs.writeFileSync(path.join(articlesDir, 'broken.json'), 'oops', 'utf-8');

        const loaded = getCachedThemeArticle('compaction', 'broken', outputDir);
        expect(loaded).toBeNull();
    });
});

// ============================================================================
// Cache Invalidation
// ============================================================================

describe('theme cache validation', () => {
    it('should report valid when git hash matches', () => {
        saveThemeProbe('compaction', createTestProbeResult(), outputDir, 'hashA');

        expect(isThemeCacheValid('compaction', outputDir, 'hashA')).toBe(true);
    });

    it('should report invalid when git hash differs', () => {
        saveThemeProbe('compaction', createTestProbeResult(), outputDir, 'hashA');

        expect(isThemeCacheValid('compaction', outputDir, 'hashB')).toBe(false);
    });

    it('should report invalid when no cache exists', () => {
        expect(isThemeCacheValid('nonexistent', outputDir, 'hashA')).toBe(false);
    });

    it('should report invalid when probe cache is corrupted', () => {
        const themeDir = getThemeCacheDir(outputDir, 'bad');
        fs.mkdirSync(themeDir, { recursive: true });
        fs.writeFileSync(path.join(themeDir, 'probe-result.json'), 'corrupt', 'utf-8');

        expect(isThemeCacheValid('bad', outputDir, 'hashA')).toBe(false);
    });
});

// ============================================================================
// Clear Operations
// ============================================================================

describe('theme cache clear', () => {
    it('should clear all artifacts for a specific theme', () => {
        saveThemeProbe('compaction', createTestProbeResult(), outputDir, 'hash');
        saveThemeOutline('compaction', createTestOutline('compaction'), outputDir, 'hash');
        saveThemeAnalysis('compaction', createTestAnalysis('compaction'), outputDir, 'hash');
        saveThemeArticle('compaction', createTestArticle('compaction', 'index'), outputDir, 'hash');

        const cleared = clearThemeCache('compaction', outputDir);
        expect(cleared).toBe(true);

        expect(getCachedThemeProbe('compaction', outputDir)).toBeNull();
        expect(getCachedThemeOutline('compaction', outputDir)).toBeNull();
        expect(getCachedThemeAnalysis('compaction', outputDir)).toBeNull();
        expect(getCachedThemeArticles('compaction', outputDir)).toBeNull();
    });

    it('should return false when clearing non-existent theme cache', () => {
        const cleared = clearThemeCache('nonexistent', outputDir);
        expect(cleared).toBe(false);
    });

    it('should not affect other themes when clearing one', () => {
        saveThemeProbe('theme-a', createTestProbeResult(), outputDir, 'hash');
        saveThemeProbe('theme-b', createTestProbeResult(), outputDir, 'hash');

        clearThemeCache('theme-a', outputDir);

        expect(getCachedThemeProbe('theme-a', outputDir)).toBeNull();
        expect(getCachedThemeProbe('theme-b', outputDir)).not.toBeNull();
    });

    it('should clear all theme caches at once', () => {
        saveThemeProbe('theme-a', createTestProbeResult(), outputDir, 'hash');
        saveThemeProbe('theme-b', createTestProbeResult(), outputDir, 'hash');

        const cleared = clearAllThemesCache(outputDir);
        expect(cleared).toBe(true);

        expect(getCachedThemeProbe('theme-a', outputDir)).toBeNull();
        expect(getCachedThemeProbe('theme-b', outputDir)).toBeNull();
    });

    it('should return false when clearing empty themes cache', () => {
        const cleared = clearAllThemesCache(outputDir);
        expect(cleared).toBe(false);
    });
});

// ============================================================================
// Cache Directory Structure
// ============================================================================

describe('cache directory structure', () => {
    it('should create correct directory structure', () => {
        const themeId = 'compaction';
        saveThemeProbe(themeId, createTestProbeResult(), outputDir, 'hash');
        saveThemeOutline(themeId, createTestOutline(themeId), outputDir, 'hash');
        saveThemeAnalysis(themeId, createTestAnalysis(themeId), outputDir, 'hash');
        saveThemeArticle(themeId, createTestArticle(themeId, 'index'), outputDir, 'hash');
        saveThemeArticle(themeId, createTestArticle(themeId, 'compaction-styles'), outputDir, 'hash');

        const themeDir = getThemeCacheDir(outputDir, themeId);
        expect(fs.existsSync(path.join(themeDir, 'probe-result.json'))).toBe(true);
        expect(fs.existsSync(path.join(themeDir, 'outline.json'))).toBe(true);
        expect(fs.existsSync(path.join(themeDir, 'analysis.json'))).toBe(true);
        expect(fs.existsSync(path.join(themeDir, 'articles', 'index.json'))).toBe(true);
        expect(fs.existsSync(path.join(themeDir, 'articles', 'compaction-styles.json'))).toBe(true);
    });

    it('should store themes under .wiki-cache/themes/', () => {
        const themesDir = getThemesCacheDir(outputDir);
        expect(themesDir).toContain('.wiki-cache');
        expect(themesDir).toMatch(/themes$/);
    });
});
