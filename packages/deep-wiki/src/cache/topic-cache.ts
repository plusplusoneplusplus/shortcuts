/**
 * Topic Cache — Per-Topic Generation Artifacts
 *
 * Caches topic generation artifacts: probe results, outlines, analyses, and articles.
 * Follows the per-item incremental caching pattern from analysis-cache.ts.
 * Supports crash recovery via per-article incremental saves and git-hash-based invalidation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TopicOutline, TopicAnalysis, TopicArticle } from '../types';
import type { EnrichedProbeResult } from '../topic/topic-probe';
import type {
    CachedTopicProbe,
    CachedTopicOutline,
    CachedTopicAnalysis,
    CachedTopicArticle,
} from './types';
import { readCacheFile, readCacheFileIf, writeCacheFile, clearCacheDir } from './cache-utils';
import { getCacheDir, TOPICS_DIR } from './cache-constants';

// ============================================================================
// Path Helpers
// ============================================================================

/** Get the topics cache root directory. */
export function getTopicsCacheDir(outputDir: string): string {
    return path.join(getCacheDir(outputDir), TOPICS_DIR);
}

/** Get the directory for a specific topic. */
export function getTopicCacheDir(outputDir: string, topicId: string): string {
    return path.join(getTopicsCacheDir(outputDir), topicId);
}

/** Get the path to the cached probe result for a topic. */
function getTopicProbePath(outputDir: string, topicId: string): string {
    return path.join(getTopicCacheDir(outputDir, topicId), 'probe-result.json');
}

/** Get the path to the cached outline for a topic. */
function getTopicOutlinePath(outputDir: string, topicId: string): string {
    return path.join(getTopicCacheDir(outputDir, topicId), 'outline.json');
}

/** Get the path to the cached analysis for a topic. */
function getTopicAnalysisPath(outputDir: string, topicId: string): string {
    return path.join(getTopicCacheDir(outputDir, topicId), 'analysis.json');
}

/** Get the articles subdirectory for a topic. */
function getTopicArticlesDir(outputDir: string, topicId: string): string {
    return path.join(getTopicCacheDir(outputDir, topicId), 'articles');
}

/** Get the path to a cached article within a topic. */
function getTopicArticlePath(outputDir: string, topicId: string, slug: string): string {
    return path.join(getTopicArticlesDir(outputDir, topicId), `${slug}.json`);
}

// ============================================================================
// Probe Cache
// ============================================================================

/**
 * Get a cached topic probe result.
 *
 * @returns The enriched probe result, or null if not found/corrupted
 */
export function getCachedTopicProbe(topicId: string, outputDir: string): EnrichedProbeResult | null {
    const cached = readCacheFileIf<CachedTopicProbe>(
        getTopicProbePath(outputDir, topicId),
        (d) => !!d.result && !!d.result.probeResult
    );
    return cached?.result ?? null;
}

/**
 * Save a topic probe result to cache.
 */
export function saveTopicProbe(
    topicId: string,
    result: EnrichedProbeResult,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedTopicProbe>(getTopicProbePath(outputDir, topicId), {
        result,
        gitHash,
        timestamp: Date.now(),
    });
}

// ============================================================================
// Outline Cache
// ============================================================================

/**
 * Get a cached topic outline.
 *
 * @returns The topic outline, or null if not found/corrupted
 */
export function getCachedTopicOutline(topicId: string, outputDir: string): TopicOutline | null {
    const cached = readCacheFileIf<CachedTopicOutline>(
        getTopicOutlinePath(outputDir, topicId),
        (d) => !!d.outline && !!d.outline.topicId
    );
    return cached?.outline ?? null;
}

/**
 * Save a topic outline to cache.
 */
export function saveTopicOutline(
    topicId: string,
    outline: TopicOutline,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedTopicOutline>(getTopicOutlinePath(outputDir, topicId), {
        outline,
        gitHash,
        timestamp: Date.now(),
    });
}

// ============================================================================
// Analysis Cache
// ============================================================================

/**
 * Get a cached topic analysis.
 *
 * @returns The topic analysis, or null if not found/corrupted
 */
export function getCachedTopicAnalysis(topicId: string, outputDir: string): TopicAnalysis | null {
    const cached = readCacheFileIf<CachedTopicAnalysis>(
        getTopicAnalysisPath(outputDir, topicId),
        (d) => !!d.analysis && !!d.analysis.topicId
    );
    return cached?.analysis ?? null;
}

/**
 * Save a topic analysis to cache.
 */
export function saveTopicAnalysis(
    topicId: string,
    analysis: TopicAnalysis,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedTopicAnalysis>(getTopicAnalysisPath(outputDir, topicId), {
        analysis,
        gitHash,
        timestamp: Date.now(),
    });
}

// ============================================================================
// Article Cache (per-article incremental)
// ============================================================================

/**
 * Get a single cached topic article.
 *
 * @returns The topic article, or null if not found/corrupted
 */
export function getCachedTopicArticle(topicId: string, slug: string, outputDir: string): TopicArticle | null {
    const cached = readCacheFileIf<CachedTopicArticle>(
        getTopicArticlePath(outputDir, topicId, slug),
        (d) => !!d.article && !!d.article.slug
    );
    return cached?.article ?? null;
}

/**
 * Save a single topic article to cache (incremental).
 */
export function saveTopicArticle(
    topicId: string,
    article: TopicArticle,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedTopicArticle>(getTopicArticlePath(outputDir, topicId, article.slug), {
        article,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Get all cached topic articles for a topic.
 *
 * Reads all JSON files in the topic's articles/ subdirectory.
 * Returns null if no articles directory or no valid articles found.
 */
export function getCachedTopicArticles(topicId: string, outputDir: string): TopicArticle[] | null {
    const articlesDir = getTopicArticlesDir(outputDir, topicId);
    try {
        if (!fs.existsSync(articlesDir)) {
            return null;
        }
        const files = fs.readdirSync(articlesDir);
        const articles: TopicArticle[] = [];
        for (const file of files) {
            if (!file.endsWith('.json')) {
                continue;
            }
            const cached = readCacheFileIf<CachedTopicArticle>(
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
 * Clear all cached artifacts for a specific topic.
 *
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearTopicCache(topicId: string, outputDir: string): boolean {
    return clearCacheDir(getTopicCacheDir(outputDir, topicId));
}

/**
 * Clear all topic caches.
 *
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearAllTopicsCache(outputDir: string): boolean {
    return clearCacheDir(getTopicsCacheDir(outputDir));
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a topic's cache is valid based on git hash.
 *
 * Reads the probe result's git hash (the first artifact written)
 * and compares it to the current hash.
 *
 * @returns True if cache exists and git hash matches
 */
export function isTopicCacheValid(topicId: string, outputDir: string, currentGitHash: string): boolean {
    const cached = readCacheFile<CachedTopicProbe>(getTopicProbePath(outputDir, topicId));
    if (!cached || !cached.gitHash) {
        return false;
    }
    return cached.gitHash === currentGitHash;
}
