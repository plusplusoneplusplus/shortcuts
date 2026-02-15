/**
 * Article Cache — Per-Module Article Results and Reduce-Phase Articles
 *
 * Caches per-module articles from Phase 4 and reduce-phase synthesis articles.
 * Supports flat and domain-scoped directory layouts, crash recovery scanning,
 * re-stamping for incremental invalidation, and metadata-based validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    GeneratedArticle,
} from '../types';
import type {
    CachedArticle,
    AnalysisCacheMetadata,
} from './types';
import { getFolderHeadHash } from './git-utils';
import { readCacheFile, readCacheFileIf, writeCacheFile, clearCacheDir, scanCacheItems } from './cache-utils';
import { getCacheDir, CACHE_VERSION, ARTICLES_DIR, ANALYSES_METADATA_FILE, REDUCE_METADATA_FILE, REDUCE_ARTICLE_PREFIX } from './cache-constants';

// ============================================================================
// Paths
// ============================================================================

/**
 * Get the articles cache directory.
 */
export function getArticlesCacheDir(outputDir: string): string {
    return path.join(getCacheDir(outputDir), ARTICLES_DIR);
}

/**
 * Get the path to a single cached article file.
 * When domainId is provided, articles are cached under `articles/{domain-id}/{module-id}.json`.
 * Without domainId, articles are cached as `articles/{module-id}.json` (backward compat).
 */
export function getArticleCachePath(outputDir: string, componentId: string, domainId?: string): string {
    if (domainId) {
        return path.join(getArticlesCacheDir(outputDir), domainId, `${componentId}.json`);
    }
    return path.join(getArticlesCacheDir(outputDir), `${componentId}.json`);
}

/**
 * Get the path to the articles metadata file.
 */
export function getArticlesMetadataPath(outputDir: string): string {
    return path.join(getArticlesCacheDir(outputDir), ANALYSES_METADATA_FILE);
}

// ============================================================================
// Reduce Article Paths
// ============================================================================

/**
 * Get the path to the reduce articles metadata file.
 */
export function getReduceMetadataPath(outputDir: string): string {
    return path.join(getArticlesCacheDir(outputDir), REDUCE_METADATA_FILE);
}

/**
 * Get the cache path for a reduce-phase article.
 *
 * Naming convention:
 * - `_reduce-index.json` for index article
 * - `_reduce-architecture.json` for architecture article
 * - `_reduce-getting-started.json` for getting-started article
 * - `_reduce-domain-{domainId}-index.json` for domain-index article
 * - `_reduce-domain-{domainId}-architecture.json` for domain-architecture article
 *
 * @param outputDir - Output directory
 * @param articleType - Article type (e.g., 'index', 'architecture', 'getting-started')
 * @param domainId - Optional domain ID for domain-scoped reduce articles
 * @returns Absolute path to the reduce article cache file
 */
export function getReduceArticleCachePath(
    outputDir: string,
    articleType: string,
    domainId?: string
): string {
    const filename = domainId
        ? `${REDUCE_ARTICLE_PREFIX}domain-${domainId}-${articleType}.json`
        : `${REDUCE_ARTICLE_PREFIX}${articleType}.json`;
    return path.join(getArticlesCacheDir(outputDir), filename);
}

// ============================================================================
// Read
// ============================================================================

/**
 * Get a single cached module article.
 * Checks domain-scoped path first (if domainId provided), then flat path.
 *
 * @param componentId - Module ID to look up
 * @param outputDir - Output directory
 * @param domainId - Optional domain ID for hierarchical lookup
 * @returns The cached article, or null if not found
 */
export function getCachedArticle(componentId: string, outputDir: string, domainId?: string): GeneratedArticle | null {
    // Try domain-scoped path first, then flat path
    const pathsToTry = domainId
        ? [getArticleCachePath(outputDir, componentId, domainId), getArticleCachePath(outputDir, componentId)]
        : [getArticleCachePath(outputDir, componentId)];

    for (const cachePath of pathsToTry) {
        const cached = readCacheFileIf<CachedArticle>(
            cachePath,
            (d) => !!d.article && !!d.article.slug
        );
        if (cached) {
            return cached.article;
        }
    }

    return null;
}

/**
 * Get all cached articles if the cache is valid (has metadata).
 * Supports both flat and domain-scoped directory layouts.
 *
 * @param outputDir - Output directory
 * @returns Array of cached articles, or null if cache is invalid/missing
 */
export function getCachedArticles(outputDir: string): GeneratedArticle[] | null {
    const metadata = readCacheFileIf<AnalysisCacheMetadata>(
        getArticlesMetadataPath(outputDir),
        (d) => !!d.gitHash && !!d.componentCount
    );
    if (!metadata) {
        return null;
    }

    // Read all article files (flat + domain-scoped)
    const articlesDir = getArticlesCacheDir(outputDir);
    const articles: GeneratedArticle[] = [];
    const articleValidator = (d: CachedArticle) => !!d.article && !!d.article.slug;

    try {
        const entries = fs.readdirSync(articlesDir, { withFileTypes: true });
        for (const entry of entries) {
            // Skip metadata and reduce-phase files
            if (entry.name === ANALYSES_METADATA_FILE || entry.name.startsWith(REDUCE_ARTICLE_PREFIX)) {
                continue;
            }

            if (entry.isFile() && entry.name.endsWith('.json')) {
                // Flat layout: articles/{module-id}.json
                const cached = readCacheFileIf<CachedArticle>(path.join(articlesDir, entry.name), articleValidator);
                if (cached) {
                    articles.push(cached.article);
                }
            } else if (entry.isDirectory()) {
                // Domain-scoped layout: articles/{domain-id}/{module-id}.json
                const domainDir = path.join(articlesDir, entry.name);
                try {
                    const domainFiles = fs.readdirSync(domainDir);
                    for (const file of domainFiles) {
                        if (!file.endsWith('.json')) { continue; }
                        const cached = readCacheFileIf<CachedArticle>(path.join(domainDir, file), articleValidator);
                        if (cached) {
                            articles.push(cached.article);
                        }
                    }
                } catch {
                    // Skip inaccessible domain directories
                }
            }
        }
    } catch {
        return null;
    }

    return articles.length > 0 ? articles : null;
}

/**
 * Get the articles cache metadata (for hash checking).
 */
export function getArticlesCacheMetadata(outputDir: string): AnalysisCacheMetadata | null {
    return readCacheFile<AnalysisCacheMetadata>(getArticlesMetadataPath(outputDir));
}

// ============================================================================
// Reduce Article Read
// ============================================================================

/**
 * Get the reduce articles cache metadata (for hash checking).
 */
export function getReduceCacheMetadata(outputDir: string): AnalysisCacheMetadata | null {
    return readCacheFile<AnalysisCacheMetadata>(getReduceMetadataPath(outputDir));
}

/**
 * Get all cached reduce-phase articles if the cache is valid.
 *
 * Reads all `_reduce-*.json` files (excluding `_reduce-metadata.json`) from the
 * articles cache directory. Validates against the provided git hash if specified.
 *
 * @param outputDir - Output directory
 * @param gitHash - Optional git hash for validation. If provided, only returns
 *                  articles if the reduce metadata git hash matches.
 * @returns Array of cached reduce articles, or null if cache miss
 */
export function getCachedReduceArticles(
    outputDir: string,
    gitHash?: string
): GeneratedArticle[] | null {
    // Check reduce metadata first
    const metadata = getReduceCacheMetadata(outputDir);
    if (!metadata) {
        return null;
    }

    // Validate git hash if provided
    if (gitHash && metadata.gitHash !== gitHash) {
        return null;
    }

    // Read all _reduce-*.json files (excluding metadata)
    const articlesDir = getArticlesCacheDir(outputDir);
    if (!fs.existsSync(articlesDir)) {
        return null;
    }

    const articles: GeneratedArticle[] = [];

    try {
        const files = fs.readdirSync(articlesDir);
        for (const file of files) {
            if (
                !file.startsWith(REDUCE_ARTICLE_PREFIX) ||
                file === REDUCE_METADATA_FILE ||
                !file.endsWith('.json')
            ) {
                continue;
            }

            const cached = readCacheFileIf<CachedArticle>(
                path.join(articlesDir, file),
                (d) => !!d.article && !!d.article.slug
            );
            if (cached) {
                articles.push(cached.article);
            }
        }
    } catch {
        return null;
    }

    return articles.length > 0 ? articles : null;
}

// ============================================================================
// Write
// ============================================================================

/**
 * Save a single module article to the cache.
 * Domain-scoped articles are cached under `articles/{domain-id}/{module-id}.json`.
 *
 * @param componentId - Module ID
 * @param article - The article to cache
 * @param outputDir - Output directory
 * @param gitHash - Git hash when the article was generated
 */
export function saveArticle(
    componentId: string,
    article: GeneratedArticle,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedArticle>(getArticleCachePath(outputDir, componentId, article.domainId), {
        article,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Save all articles to the cache (bulk save with metadata).
 *
 * @param articles - All component articles (only 'component' type articles are cached)
 * @param outputDir - Output directory
 * @param repoPath - Path to the git repository
 */
export async function saveAllArticles(
    articles: GeneratedArticle[],
    outputDir: string,
    repoPath: string
): Promise<void> {
    const currentHash = await getFolderHeadHash(repoPath);
    if (!currentHash) {
        return; // Can't determine git hash
    }

    // Only cache module-type articles (not index/architecture/getting-started/domain-*)
    const moduleArticles = articles.filter(a => a.type === 'component' && a.componentId);

    // Write individual article files (saveArticle handles domain subdirectories)
    for (const article of moduleArticles) {
        saveArticle(article.componentId!, article, outputDir, currentHash);
    }

    // Write metadata
    writeCacheFile<AnalysisCacheMetadata>(getArticlesMetadataPath(outputDir), {
        gitHash: currentHash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        componentCount: moduleArticles.length,
    });
}

// ============================================================================
// Reduce Article Write
// ============================================================================

/**
 * Save reduce-phase articles to the cache.
 *
 * Filters the provided articles to only reduce-type articles (NOT 'component'),
 * writes each to a `_reduce-{type}.json` file, and writes reduce metadata
 * with the git hash and count.
 *
 * @param articles - All articles (will be filtered to reduce types only)
 * @param outputDir - Output directory
 * @param gitHash - Git hash when the articles were generated
 */
export function saveReduceArticles(
    articles: GeneratedArticle[],
    outputDir: string,
    gitHash: string
): void {
    // Only cache reduce-type articles (not 'module')
    const reduceArticles = articles.filter(a => a.type !== 'component');
    if (reduceArticles.length === 0) {
        return;
    }

    // Write individual reduce article files
    for (const article of reduceArticles) {
        writeCacheFile<CachedArticle>(getReduceArticleCachePath(outputDir, article.type, article.domainId), {
            article,
            gitHash,
            timestamp: Date.now(),
        });
    }

    // Write reduce metadata
    writeCacheFile<AnalysisCacheMetadata>(getReduceMetadataPath(outputDir), {
        gitHash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        componentCount: reduceArticles.length,
    });
}

// ============================================================================
// Scan (Crash Recovery)
// ============================================================================

/**
 * Find all possible cache paths for a module article (checks domain subdirectories + flat).
 * Returns the first existing path, or null if none found.
 */
function findArticleCachePath(outputDir: string, componentId: string): string | null {
    // Check flat path first
    const flatPath = getArticleCachePath(outputDir, componentId);
    if (fs.existsSync(flatPath)) {
        return flatPath;
    }

    // Check domain subdirectories
    const articlesDir = getArticlesCacheDir(outputDir);
    if (fs.existsSync(articlesDir)) {
        try {
            const entries = fs.readdirSync(articlesDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name !== '_metadata.json') {
                    const domainPath = path.join(articlesDir, entry.name, `${componentId}.json`);
                    if (fs.existsSync(domainPath)) {
                        return domainPath;
                    }
                }
            }
        } catch {
            // Ignore errors scanning domain dirs
        }
    }

    return null;
}

/**
 * Scan for individually cached articles (even without metadata).
 *
 * This is used for crash recovery: if the process was interrupted before
 * `saveAllArticles` wrote the metadata file, individual per-module files
 * may still exist from incremental saves via `onItemComplete`.
 *
 * Supports both flat (`articles/{module-id}.json`) and domain-scoped
 * (`articles/{domain-id}/{module-id}.json`) cache layouts.
 *
 * @param componentIds - Module IDs to look for in the cache
 * @param outputDir - Output directory
 * @param currentGitHash - Current git hash for validation (modules cached with
 *                         a different hash are considered stale and excluded)
 * @returns Object with `found` (valid cached articles) and `missing` (module IDs not found or stale)
 */
export function scanIndividualArticlesCache(
    componentIds: string[],
    outputDir: string,
    currentGitHash: string
): { found: GeneratedArticle[]; missing: string[] } {
    return scanCacheItems<CachedArticle, GeneratedArticle>(
        componentIds,
        (id) => findArticleCachePath(outputDir, id),
        (cached) => !!cached.article && !!cached.article.slug && cached.gitHash === currentGitHash,
        (cached) => cached.article
    );
}

/**
 * Scan for individually cached articles, ignoring git hash validation.
 *
 * Supports both flat and domain-scoped cache layouts.
 *
 * @param componentIds - Module IDs to look for in the cache
 * @param outputDir - Output directory
 * @returns Object with `found` (valid cached articles) and `missing` (module IDs not found)
 */
export function scanIndividualArticlesCacheAny(
    componentIds: string[],
    outputDir: string
): { found: GeneratedArticle[]; missing: string[] } {
    return scanCacheItems<CachedArticle, GeneratedArticle>(
        componentIds,
        (id) => findArticleCachePath(outputDir, id),
        (cached) => !!cached.article && !!cached.article.slug,
        (cached) => cached.article
    );
}

// ============================================================================
// Re-stamping
// ============================================================================

/**
 * Re-stamp cached articles for unchanged modules with a new git hash.
 *
 * This is the key operation for Phase 4 incremental invalidation:
 * after Phase 3 identifies which modules changed, unchanged module articles
 * are re-stamped (their gitHash updated) so they pass validation on the
 * current run. Only I/O — no AI calls needed.
 *
 * @param componentIds - Module IDs whose articles should be re-stamped
 * @param outputDir - Output directory (cache lives here)
 * @param newGitHash - The current git hash to stamp onto the articles
 * @returns Number of articles successfully re-stamped
 */
export function restampArticles(
    componentIds: string[],
    outputDir: string,
    newGitHash: string
): number {
    let restamped = 0;

    for (const componentId of componentIds) {
        const cachePath = findArticleCachePath(outputDir, componentId);
        if (!cachePath) {
            continue; // No cached article for this module — it will be regenerated
        }

        const cached = readCacheFile<CachedArticle>(cachePath);
        if (!cached || !cached.article || !cached.article.slug) {
            continue; // Corrupted or invalid — skip, will be regenerated
        }

        // Already has the correct hash — no need to re-write
        if (cached.gitHash === newGitHash) {
            restamped++;
            continue;
        }

        // Re-stamp: write back with updated git hash (same article content)
        writeCacheFile<CachedArticle>(cachePath, {
            article: cached.article,
            gitHash: newGitHash,
            timestamp: Date.now(),
        });
        restamped++;
    }

    return restamped;
}

// ============================================================================
// Invalidation
// ============================================================================

/**
 * Clear all cached articles (including domain subdirectories).
 *
 * @param outputDir - Output directory
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearArticlesCache(outputDir: string): boolean {
    return clearCacheDir(getArticlesCacheDir(outputDir));
}
