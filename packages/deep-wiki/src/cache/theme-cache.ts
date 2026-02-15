/**
 * Theme Cache — Per-Theme Generation Artifacts
 *
 * Caches theme generation artifacts: probe results, outlines, analyses, and articles.
 * Follows the per-item incremental caching pattern from analysis-cache.ts.
 * Supports crash recovery via per-article incremental saves and git-hash-based invalidation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ThemeOutline, ThemeAnalysis, ThemeArticle } from '../types';
import type { EnrichedProbeResult } from '../theme/theme-probe';
import type {
    CachedThemeProbe,
    CachedThemeOutline,
    CachedThemeAnalysis,
    CachedThemeArticle,
} from './types';
import { readCacheFile, readCacheFileIf, writeCacheFile, clearCacheDir } from './cache-utils';
import { getCacheDir, THEMES_DIR } from './cache-constants';

// ============================================================================
// Path Helpers
// ============================================================================

/** Get the themes cache root directory. */
export function getThemesCacheDir(outputDir: string): string {
    return path.join(getCacheDir(outputDir), THEMES_DIR);
}

/** Get the directory for a specific theme. */
export function getThemeCacheDir(outputDir: string, themeId: string): string {
    return path.join(getThemesCacheDir(outputDir), themeId);
}

/** Get the path to the cached probe result for a theme. */
function getThemeProbePath(outputDir: string, themeId: string): string {
    return path.join(getThemeCacheDir(outputDir, themeId), 'probe-result.json');
}

/** Get the path to the cached outline for a theme. */
function getThemeOutlinePath(outputDir: string, themeId: string): string {
    return path.join(getThemeCacheDir(outputDir, themeId), 'outline.json');
}

/** Get the path to the cached analysis for a theme. */
function getThemeAnalysisPath(outputDir: string, themeId: string): string {
    return path.join(getThemeCacheDir(outputDir, themeId), 'analysis.json');
}

/** Get the articles subdirectory for a theme. */
function getThemeArticlesDir(outputDir: string, themeId: string): string {
    return path.join(getThemeCacheDir(outputDir, themeId), 'articles');
}

/** Get the path to a cached article within a theme. */
function getThemeArticlePath(outputDir: string, themeId: string, slug: string): string {
    return path.join(getThemeArticlesDir(outputDir, themeId), `${slug}.json`);
}

// ============================================================================
// Probe Cache
// ============================================================================

/**
 * Get a cached theme probe result.
 *
 * @returns The enriched probe result, or null if not found/corrupted
 */
export function getCachedThemeProbe(themeId: string, outputDir: string): EnrichedProbeResult | null {
    const cached = readCacheFileIf<CachedThemeProbe>(
        getThemeProbePath(outputDir, themeId),
        (d) => !!d.result && !!d.result.probeResult
    );
    return cached?.result ?? null;
}

/**
 * Save a theme probe result to cache.
 */
export function saveThemeProbe(
    themeId: string,
    result: EnrichedProbeResult,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedThemeProbe>(getThemeProbePath(outputDir, themeId), {
        result,
        gitHash,
        timestamp: Date.now(),
    });
}

// ============================================================================
// Outline Cache
// ============================================================================

/**
 * Get a cached theme outline.
 *
 * @returns The theme outline, or null if not found/corrupted
 */
export function getCachedThemeOutline(themeId: string, outputDir: string): ThemeOutline | null {
    const cached = readCacheFileIf<CachedThemeOutline>(
        getThemeOutlinePath(outputDir, themeId),
        (d) => !!d.outline && !!d.outline.themeId
    );
    return cached?.outline ?? null;
}

/**
 * Save a theme outline to cache.
 */
export function saveThemeOutline(
    themeId: string,
    outline: ThemeOutline,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedThemeOutline>(getThemeOutlinePath(outputDir, themeId), {
        outline,
        gitHash,
        timestamp: Date.now(),
    });
}

// ============================================================================
// Analysis Cache
// ============================================================================

/**
 * Get a cached theme analysis.
 *
 * @returns The theme analysis, or null if not found/corrupted
 */
export function getCachedThemeAnalysis(themeId: string, outputDir: string): ThemeAnalysis | null {
    const cached = readCacheFileIf<CachedThemeAnalysis>(
        getThemeAnalysisPath(outputDir, themeId),
        (d) => !!d.analysis && !!d.analysis.themeId
    );
    return cached?.analysis ?? null;
}

/**
 * Save a theme analysis to cache.
 */
export function saveThemeAnalysis(
    themeId: string,
    analysis: ThemeAnalysis,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedThemeAnalysis>(getThemeAnalysisPath(outputDir, themeId), {
        analysis,
        gitHash,
        timestamp: Date.now(),
    });
}

// ============================================================================
// Article Cache (per-article incremental)
// ============================================================================

/**
 * Get a single cached theme article.
 *
 * @returns The theme article, or null if not found/corrupted
 */
export function getCachedThemeArticle(themeId: string, slug: string, outputDir: string): ThemeArticle | null {
    const cached = readCacheFileIf<CachedThemeArticle>(
        getThemeArticlePath(outputDir, themeId, slug),
        (d) => !!d.article && !!d.article.slug
    );
    return cached?.article ?? null;
}

/**
 * Save a single theme article to cache (incremental).
 */
export function saveThemeArticle(
    themeId: string,
    article: ThemeArticle,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedThemeArticle>(getThemeArticlePath(outputDir, themeId, article.slug), {
        article,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Get all cached theme articles for a theme.
 *
 * Reads all JSON files in the theme's articles/ subdirectory.
 * Returns null if no articles directory or no valid articles found.
 */
export function getCachedThemeArticles(themeId: string, outputDir: string): ThemeArticle[] | null {
    const articlesDir = getThemeArticlesDir(outputDir, themeId);
    try {
        if (!fs.existsSync(articlesDir)) {
            return null;
        }
        const files = fs.readdirSync(articlesDir);
        const articles: ThemeArticle[] = [];
        for (const file of files) {
            if (!file.endsWith('.json')) {
                continue;
            }
            const cached = readCacheFileIf<CachedThemeArticle>(
                path.join(articlesDir, file),
                (d) => !!d.article && !!d.article.slug
            );
            if (cached) {
                articles.push(cached.article);
            }
        }
        return articles.length > 0 ? articles : null;
    } catch {
        return null;
    }
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Clear all cached artifacts for a specific theme.
 *
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearThemeCache(themeId: string, outputDir: string): boolean {
    return clearCacheDir(getThemeCacheDir(outputDir, themeId));
}

/**
 * Clear all theme caches.
 *
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearAllThemesCache(outputDir: string): boolean {
    return clearCacheDir(getThemesCacheDir(outputDir));
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a theme's cache is valid based on git hash.
 *
 * Reads the probe result's git hash (the first artifact written)
 * and compares it to the current hash.
 *
 * @returns True if cache exists and git hash matches
 */
export function isThemeCacheValid(themeId: string, outputDir: string, currentGitHash: string): boolean {
    const cached = readCacheFile<CachedThemeProbe>(getThemeProbePath(outputDir, themeId));
    if (!cached || !cached.gitHash) {
        return false;
    }
    return cached.gitHash === currentGitHash;
}
