/**
 * Cache Layer — Cache Manager
 *
 * Manages cached module graph and per-module analysis results for incremental
 * discovery and analysis. Cache location: <output>/.wiki-cache/.
 * Uses git HEAD hash for invalidation with incremental rebuild support.
 *
 * Cache structure:
 *   .wiki-cache/
 *   ├── module-graph.json           # Phase 1 (discovery)
 *   └── analyses/                   # Phase 3 (analysis)
 *       ├── _metadata.json          # git hash + timestamp
 *       ├── auth.json               # per-module analysis
 *       ├── database.json
 *       └── ...
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    ModuleGraph,
    ModuleAnalysis,
    GeneratedArticle,
    CachedGraph,
    CachedAnalysis,
    CachedArticle,
    CachedConsolidation,
    CacheMetadata,
    AnalysisCacheMetadata,
} from '../types';
import { getRepoHeadHash, getChangedFiles } from './git-utils';
import { readCacheFile, readCacheFileIf, writeCacheFile, clearCacheFile, clearCacheDir, scanCacheItems } from './cache-utils';

// Re-export git utilities
export { getRepoHeadHash, getChangedFiles, hasChanges, isGitAvailable, isGitRepo } from './git-utils';

// Re-export discovery cache functions
export {
    getDiscoveryCacheDir,
    saveSeedsCache,
    getCachedSeeds,
    getCachedSeedsAny,
    saveProbeResult,
    getCachedProbeResult,
    scanCachedProbes,
    scanCachedProbesAny,
    saveStructuralScan,
    getCachedStructuralScan,
    getCachedStructuralScanAny,
    saveAreaSubGraph,
    getCachedAreaSubGraph,
    scanCachedAreas,
    scanCachedAreasAny,
    saveDiscoveryMetadata,
    getDiscoveryMetadata,
    clearDiscoveryCache,
} from './discovery-cache';

// ============================================================================
// Constants
// ============================================================================

/** Name of the cache directory */
const CACHE_DIR_NAME = '.wiki-cache';

/** Name of the cached module graph file */
const GRAPH_CACHE_FILE = 'module-graph.json';

/** Subdirectory for per-module analysis cache */
const ANALYSES_DIR = 'analyses';

/** Subdirectory for per-module article cache */
const ARTICLES_DIR = 'articles';

/** Name of the cached consolidated graph file */
const CONSOLIDATED_GRAPH_FILE = 'consolidated-graph.json';

/** Metadata file for the analyses cache */
const ANALYSES_METADATA_FILE = '_metadata.json';

/** Metadata file for reduce-phase article cache */
const REDUCE_METADATA_FILE = '_reduce-metadata.json';

/** Prefix for reduce article cache files */
const REDUCE_ARTICLE_PREFIX = '_reduce-';

/** Current version for cache metadata */
const CACHE_VERSION = '1.0.0';

// ============================================================================
// Cache Paths
// ============================================================================

/**
 * Get the cache directory path.
 *
 * @param outputDir - Output directory (the cache is stored inside it)
 * @returns Absolute path to the cache directory
 */
export function getCacheDir(outputDir: string): string {
    return path.join(path.resolve(outputDir), CACHE_DIR_NAME);
}

/**
 * Get the path to the cached module graph file.
 *
 * @param outputDir - Output directory
 * @returns Absolute path to the cached graph file
 */
export function getGraphCachePath(outputDir: string): string {
    return path.join(getCacheDir(outputDir), GRAPH_CACHE_FILE);
}

/**
 * Get the analyses cache directory.
 */
export function getAnalysesCacheDir(outputDir: string): string {
    return path.join(getCacheDir(outputDir), ANALYSES_DIR);
}

/**
 * Get the path to a single cached analysis file.
 */
export function getAnalysisCachePath(outputDir: string, moduleId: string): string {
    return path.join(getAnalysesCacheDir(outputDir), `${moduleId}.json`);
}

/**
 * Get the path to the analyses metadata file.
 */
export function getAnalysesMetadataPath(outputDir: string): string {
    return path.join(getAnalysesCacheDir(outputDir), ANALYSES_METADATA_FILE);
}

// ============================================================================
// Graph Cache Read
// ============================================================================

/**
 * Get a cached module graph if it exists and is still valid (git hash matches).
 *
 * @param repoPath - Path to the git repository
 * @param outputDir - Output directory containing the cache
 * @returns The cached graph if valid, or null if cache miss
 */
export async function getCachedGraph(repoPath: string, outputDir: string): Promise<CachedGraph | null> {
    const cached = readCacheFileIf<CachedGraph>(
        getGraphCachePath(outputDir),
        (d) => !!d.metadata && !!d.graph
    );
    if (!cached) {
        return null;
    }

    try {
        const currentHash = await getRepoHeadHash(repoPath);
        if (!currentHash || currentHash !== cached.metadata.gitHash) {
            return null;
        }
    } catch {
        return null;
    }

    return cached;
}

/**
 * Get a cached module graph regardless of git hash (skip hash validation).
 *
 * @param outputDir - Output directory containing the cache
 * @returns The cached graph if it exists and is structurally valid, or null
 */
export function getCachedGraphAny(outputDir: string): CachedGraph | null {
    return readCacheFileIf<CachedGraph>(
        getGraphCachePath(outputDir),
        (d) => !!d.metadata && !!d.graph
    );
}

// ============================================================================
// Graph Cache Write
// ============================================================================

/**
 * Save a module graph to the cache.
 *
 * @param repoPath - Path to the git repository
 * @param graph - The module graph to cache
 * @param outputDir - Output directory for the cache
 * @param focus - Optional focus area used during discovery
 */
export async function saveGraph(
    repoPath: string,
    graph: ModuleGraph,
    outputDir: string,
    focus?: string
): Promise<void> {
    const currentHash = await getRepoHeadHash(repoPath);
    if (!currentHash) {
        // Can't determine git hash — skip caching
        return;
    }

    const metadata: CacheMetadata = {
        gitHash: currentHash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        focus,
    };

    writeCacheFile<CachedGraph>(getGraphCachePath(outputDir), { metadata, graph });
}

// ============================================================================
// Consolidation Cache Paths
// ============================================================================

/**
 * Get the path to the cached consolidated graph file.
 *
 * @param outputDir - Output directory
 * @returns Absolute path to the consolidated graph cache file
 */
export function getConsolidatedGraphCachePath(outputDir: string): string {
    return path.join(getCacheDir(outputDir), CONSOLIDATED_GRAPH_FILE);
}

// ============================================================================
// Consolidation Cache Read
// ============================================================================

/**
 * Get a cached consolidated graph if it exists and is still valid.
 *
 * The cache is valid when:
 * - The git hash matches current HEAD
 * - The input module count matches (discovery produced the same graph)
 *
 * @param repoPath - Path to the git repository
 * @param outputDir - Output directory containing the cache
 * @param inputModuleCount - Number of modules in the pre-consolidation graph
 * @returns The cached consolidated graph if valid, or null if cache miss
 */
export async function getCachedConsolidation(
    repoPath: string,
    outputDir: string,
    inputModuleCount: number
): Promise<CachedConsolidation | null> {
    const cached = readCacheFileIf<CachedConsolidation>(
        getConsolidatedGraphCachePath(outputDir),
        (d) => !!d.graph && !!d.gitHash && !!d.inputModuleCount && d.inputModuleCount === inputModuleCount
    );
    if (!cached) {
        return null;
    }

    try {
        const currentHash = await getRepoHeadHash(repoPath);
        if (!currentHash || currentHash !== cached.gitHash) {
            return null;
        }
    } catch {
        return null;
    }

    return cached;
}

/**
 * Get a cached consolidated graph regardless of git hash (--use-cache mode).
 *
 * Still validates the input module count so we don't reuse a consolidation
 * from a different discovery result.
 *
 * @param outputDir - Output directory containing the cache
 * @param inputModuleCount - Number of modules in the pre-consolidation graph
 * @returns The cached consolidated graph if structurally valid, or null
 */
export function getCachedConsolidationAny(
    outputDir: string,
    inputModuleCount: number
): CachedConsolidation | null {
    return readCacheFileIf<CachedConsolidation>(
        getConsolidatedGraphCachePath(outputDir),
        (d) => !!d.graph && !!d.gitHash && !!d.inputModuleCount && d.inputModuleCount === inputModuleCount
    );
}

// ============================================================================
// Consolidation Cache Write
// ============================================================================

/**
 * Save a consolidated graph to the cache.
 *
 * @param repoPath - Path to the git repository
 * @param graph - The consolidated module graph
 * @param outputDir - Output directory for the cache
 * @param inputModuleCount - Number of modules before consolidation
 */
export async function saveConsolidation(
    repoPath: string,
    graph: ModuleGraph,
    outputDir: string,
    inputModuleCount: number
): Promise<void> {
    const currentHash = await getRepoHeadHash(repoPath);
    if (!currentHash) {
        return; // Can't determine git hash
    }

    writeCacheFile<CachedConsolidation>(getConsolidatedGraphCachePath(outputDir), {
        graph,
        gitHash: currentHash,
        inputModuleCount,
        timestamp: Date.now(),
    });
}

// ============================================================================
// Consolidation Cache Invalidation
// ============================================================================

/**
 * Clear the consolidated graph cache.
 *
 * @param outputDir - Output directory
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearConsolidationCache(outputDir: string): boolean {
    return clearCacheFile(getConsolidatedGraphCachePath(outputDir));
}

// ============================================================================
// Analysis Cache Read
// ============================================================================

/**
 * Get a single cached module analysis.
 *
 * @param moduleId - Module ID to look up
 * @param outputDir - Output directory
 * @returns The cached analysis, or null if not found
 */
export function getCachedAnalysis(moduleId: string, outputDir: string): ModuleAnalysis | null {
    const cached = readCacheFileIf<CachedAnalysis>(
        getAnalysisCachePath(outputDir, moduleId),
        (d) => !!d.analysis && !!d.analysis.moduleId
    );
    return cached?.analysis ?? null;
}

/**
 * Get all cached analyses if the cache is valid.
 *
 * @param outputDir - Output directory
 * @returns Array of cached analyses, or null if cache is invalid/missing
 */
export function getCachedAnalyses(outputDir: string): ModuleAnalysis[] | null {
    const metadata = readCacheFileIf<AnalysisCacheMetadata>(
        getAnalysesMetadataPath(outputDir),
        (d) => !!d.gitHash && !!d.moduleCount
    );
    if (!metadata) {
        return null;
    }

    // Read all analysis files
    const analysesDir = getAnalysesCacheDir(outputDir);
    const analyses: ModuleAnalysis[] = [];

    try {
        const files = fs.readdirSync(analysesDir);
        for (const file of files) {
            if (file === ANALYSES_METADATA_FILE || !file.endsWith('.json')) {
                continue;
            }

            const cached = readCacheFileIf<CachedAnalysis>(
                path.join(analysesDir, file),
                (d) => !!d.analysis && !!d.analysis.moduleId
            );
            if (cached) {
                analyses.push(cached.analysis);
            }
        }
    } catch {
        return null;
    }

    return analyses.length > 0 ? analyses : null;
}

/**
 * Get the analyses cache metadata (for hash checking).
 */
export function getAnalysesCacheMetadata(outputDir: string): AnalysisCacheMetadata | null {
    return readCacheFile<AnalysisCacheMetadata>(getAnalysesMetadataPath(outputDir));
}

// ============================================================================
// Analysis Cache Write
// ============================================================================

/**
 * Save a single module analysis to the cache.
 *
 * @param moduleId - Module ID
 * @param analysis - The analysis to cache
 * @param outputDir - Output directory
 * @param gitHash - Git hash when the analysis was produced
 */
export function saveAnalysis(
    moduleId: string,
    analysis: ModuleAnalysis,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedAnalysis>(getAnalysisCachePath(outputDir, moduleId), {
        analysis,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Save all analyses to the cache (bulk save with metadata).
 *
 * @param analyses - All module analyses
 * @param outputDir - Output directory
 * @param repoPath - Path to the git repository
 */
export async function saveAllAnalyses(
    analyses: ModuleAnalysis[],
    outputDir: string,
    repoPath: string
): Promise<void> {
    const currentHash = await getRepoHeadHash(repoPath);
    if (!currentHash) {
        return; // Can't determine git hash
    }

    // Write individual analysis files
    for (const analysis of analyses) {
        saveAnalysis(analysis.moduleId, analysis, outputDir, currentHash);
    }

    // Write metadata
    writeCacheFile<AnalysisCacheMetadata>(getAnalysesMetadataPath(outputDir), {
        gitHash: currentHash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        moduleCount: analyses.length,
    });
}

/**
 * Scan for individually cached analyses (even without metadata).
 *
 * This is used for crash recovery: if the process was interrupted before
 * `saveAllAnalyses` wrote the metadata file, individual per-module files
 * may still exist from incremental saves via `onItemComplete`.
 *
 * @param moduleIds - Module IDs to look for in the cache
 * @param outputDir - Output directory
 * @param currentGitHash - Current git hash for validation (modules cached with
 *                         a different hash are considered stale and excluded)
 * @returns Object with `found` (valid cached analyses) and `missing` (module IDs not found or stale)
 */
export function scanIndividualAnalysesCache(
    moduleIds: string[],
    outputDir: string,
    currentGitHash: string
): { found: ModuleAnalysis[]; missing: string[] } {
    return scanCacheItems<CachedAnalysis, ModuleAnalysis>(
        moduleIds,
        (id) => getAnalysisCachePath(outputDir, id),
        (cached) => !!cached.analysis && !!cached.analysis.moduleId && cached.gitHash === currentGitHash,
        (cached) => cached.analysis
    );
}

/**
 * Scan for individually cached analyses, ignoring git hash validation.
 *
 * @param moduleIds - Module IDs to look for in the cache
 * @param outputDir - Output directory
 * @returns Object with `found` (valid cached analyses) and `missing` (module IDs not found)
 */
export function scanIndividualAnalysesCacheAny(
    moduleIds: string[],
    outputDir: string
): { found: ModuleAnalysis[]; missing: string[] } {
    return scanCacheItems<CachedAnalysis, ModuleAnalysis>(
        moduleIds,
        (id) => getAnalysisCachePath(outputDir, id),
        (cached) => !!cached.analysis && !!cached.analysis.moduleId,
        (cached) => cached.analysis
    );
}

// ============================================================================
// Analysis Cache Invalidation
// ============================================================================

/**
 * Clear all cached analyses.
 *
 * @param outputDir - Output directory
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearAnalysesCache(outputDir: string): boolean {
    return clearCacheDir(getAnalysesCacheDir(outputDir));
}

// ============================================================================
// Article Cache Paths
// ============================================================================

/**
 * Get the articles cache directory.
 */
export function getArticlesCacheDir(outputDir: string): string {
    return path.join(getCacheDir(outputDir), ARTICLES_DIR);
}

/**
 * Get the path to a single cached article file.
 * When areaId is provided, articles are cached under `articles/{area-id}/{module-id}.json`.
 * Without areaId, articles are cached as `articles/{module-id}.json` (backward compat).
 */
export function getArticleCachePath(outputDir: string, moduleId: string, areaId?: string): string {
    if (areaId) {
        return path.join(getArticlesCacheDir(outputDir), areaId, `${moduleId}.json`);
    }
    return path.join(getArticlesCacheDir(outputDir), `${moduleId}.json`);
}

/**
 * Get the path to the articles metadata file.
 */
export function getArticlesMetadataPath(outputDir: string): string {
    return path.join(getArticlesCacheDir(outputDir), ANALYSES_METADATA_FILE);
}

// ============================================================================
// Reduce Article Cache Paths
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
 * - `_reduce-area-{areaId}-index.json` for area-index article
 * - `_reduce-area-{areaId}-architecture.json` for area-architecture article
 *
 * @param outputDir - Output directory
 * @param articleType - Article type (e.g., 'index', 'architecture', 'getting-started')
 * @param areaId - Optional area ID for area-scoped reduce articles
 * @returns Absolute path to the reduce article cache file
 */
export function getReduceArticleCachePath(
    outputDir: string,
    articleType: string,
    areaId?: string
): string {
    const filename = areaId
        ? `${REDUCE_ARTICLE_PREFIX}area-${areaId}-${articleType}.json`
        : `${REDUCE_ARTICLE_PREFIX}${articleType}.json`;
    return path.join(getArticlesCacheDir(outputDir), filename);
}

// ============================================================================
// Article Cache Read
// ============================================================================

/**
 * Get a single cached module article.
 * Checks area-scoped path first (if areaId provided), then flat path.
 *
 * @param moduleId - Module ID to look up
 * @param outputDir - Output directory
 * @param areaId - Optional area ID for hierarchical lookup
 * @returns The cached article, or null if not found
 */
export function getCachedArticle(moduleId: string, outputDir: string, areaId?: string): GeneratedArticle | null {
    // Try area-scoped path first, then flat path
    const pathsToTry = areaId
        ? [getArticleCachePath(outputDir, moduleId, areaId), getArticleCachePath(outputDir, moduleId)]
        : [getArticleCachePath(outputDir, moduleId)];

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
 * Supports both flat and area-scoped directory layouts.
 *
 * @param outputDir - Output directory
 * @returns Array of cached articles, or null if cache is invalid/missing
 */
export function getCachedArticles(outputDir: string): GeneratedArticle[] | null {
    const metadata = readCacheFileIf<AnalysisCacheMetadata>(
        getArticlesMetadataPath(outputDir),
        (d) => !!d.gitHash && !!d.moduleCount
    );
    if (!metadata) {
        return null;
    }

    // Read all article files (flat + area-scoped)
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
                // Area-scoped layout: articles/{area-id}/{module-id}.json
                const areaDir = path.join(articlesDir, entry.name);
                try {
                    const areaFiles = fs.readdirSync(areaDir);
                    for (const file of areaFiles) {
                        if (!file.endsWith('.json')) { continue; }
                        const cached = readCacheFileIf<CachedArticle>(path.join(areaDir, file), articleValidator);
                        if (cached) {
                            articles.push(cached.article);
                        }
                    }
                } catch {
                    // Skip inaccessible area directories
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
// Reduce Article Cache Read
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
// Article Cache Write
// ============================================================================

/**
 * Save a single module article to the cache.
 * Area-scoped articles are cached under `articles/{area-id}/{module-id}.json`.
 *
 * @param moduleId - Module ID
 * @param article - The article to cache
 * @param outputDir - Output directory
 * @param gitHash - Git hash when the article was generated
 */
export function saveArticle(
    moduleId: string,
    article: GeneratedArticle,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedArticle>(getArticleCachePath(outputDir, moduleId, article.areaId), {
        article,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Save all articles to the cache (bulk save with metadata).
 *
 * @param articles - All module articles (only 'module' type articles are cached)
 * @param outputDir - Output directory
 * @param repoPath - Path to the git repository
 */
export async function saveAllArticles(
    articles: GeneratedArticle[],
    outputDir: string,
    repoPath: string
): Promise<void> {
    const currentHash = await getRepoHeadHash(repoPath);
    if (!currentHash) {
        return; // Can't determine git hash
    }

    // Only cache module-type articles (not index/architecture/getting-started/area-*)
    const moduleArticles = articles.filter(a => a.type === 'module' && a.moduleId);

    // Write individual article files (saveArticle handles area subdirectories)
    for (const article of moduleArticles) {
        saveArticle(article.moduleId!, article, outputDir, currentHash);
    }

    // Write metadata
    writeCacheFile<AnalysisCacheMetadata>(getArticlesMetadataPath(outputDir), {
        gitHash: currentHash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        moduleCount: moduleArticles.length,
    });
}

// ============================================================================
// Reduce Article Cache Write
// ============================================================================

/**
 * Save reduce-phase articles to the cache.
 *
 * Filters the provided articles to only reduce-type articles (NOT 'module'),
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
    const reduceArticles = articles.filter(a => a.type !== 'module');
    if (reduceArticles.length === 0) {
        return;
    }

    // Write individual reduce article files
    for (const article of reduceArticles) {
        writeCacheFile<CachedArticle>(getReduceArticleCachePath(outputDir, article.type, article.areaId), {
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
        moduleCount: reduceArticles.length,
    });
}

/**
 * Find all possible cache paths for a module article (checks area subdirectories + flat).
 * Returns the first existing path, or null if none found.
 */
function findArticleCachePath(outputDir: string, moduleId: string): string | null {
    // Check flat path first
    const flatPath = getArticleCachePath(outputDir, moduleId);
    if (fs.existsSync(flatPath)) {
        return flatPath;
    }

    // Check area subdirectories
    const articlesDir = getArticlesCacheDir(outputDir);
    if (fs.existsSync(articlesDir)) {
        try {
            const entries = fs.readdirSync(articlesDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name !== '_metadata.json') {
                    const areaPath = path.join(articlesDir, entry.name, `${moduleId}.json`);
                    if (fs.existsSync(areaPath)) {
                        return areaPath;
                    }
                }
            }
        } catch {
            // Ignore errors scanning area dirs
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
 * Supports both flat (`articles/{module-id}.json`) and area-scoped
 * (`articles/{area-id}/{module-id}.json`) cache layouts.
 *
 * @param moduleIds - Module IDs to look for in the cache
 * @param outputDir - Output directory
 * @param currentGitHash - Current git hash for validation (modules cached with
 *                         a different hash are considered stale and excluded)
 * @returns Object with `found` (valid cached articles) and `missing` (module IDs not found or stale)
 */
export function scanIndividualArticlesCache(
    moduleIds: string[],
    outputDir: string,
    currentGitHash: string
): { found: GeneratedArticle[]; missing: string[] } {
    return scanCacheItems<CachedArticle, GeneratedArticle>(
        moduleIds,
        (id) => findArticleCachePath(outputDir, id),
        (cached) => !!cached.article && !!cached.article.slug && cached.gitHash === currentGitHash,
        (cached) => cached.article
    );
}

/**
 * Scan for individually cached articles, ignoring git hash validation.
 *
 * Supports both flat and area-scoped cache layouts.
 *
 * @param moduleIds - Module IDs to look for in the cache
 * @param outputDir - Output directory
 * @returns Object with `found` (valid cached articles) and `missing` (module IDs not found)
 */
export function scanIndividualArticlesCacheAny(
    moduleIds: string[],
    outputDir: string
): { found: GeneratedArticle[]; missing: string[] } {
    return scanCacheItems<CachedArticle, GeneratedArticle>(
        moduleIds,
        (id) => findArticleCachePath(outputDir, id),
        (cached) => !!cached.article && !!cached.article.slug,
        (cached) => cached.article
    );
}

// ============================================================================
// Article Cache Re-stamping
// ============================================================================

/**
 * Re-stamp cached articles for unchanged modules with a new git hash.
 *
 * This is the key operation for Phase 4 incremental invalidation:
 * after Phase 3 identifies which modules changed, unchanged module articles
 * are re-stamped (their gitHash updated) so they pass validation on the
 * current run. Only I/O — no AI calls needed.
 *
 * @param moduleIds - Module IDs whose articles should be re-stamped
 * @param outputDir - Output directory (cache lives here)
 * @param newGitHash - The current git hash to stamp onto the articles
 * @returns Number of articles successfully re-stamped
 */
export function restampArticles(
    moduleIds: string[],
    outputDir: string,
    newGitHash: string
): number {
    let restamped = 0;

    for (const moduleId of moduleIds) {
        const cachePath = findArticleCachePath(outputDir, moduleId);
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
// Article Cache Invalidation
// ============================================================================

/**
 * Clear all cached articles (including area subdirectories).
 *
 * @param outputDir - Output directory
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearArticlesCache(outputDir: string): boolean {
    return clearCacheDir(getArticlesCacheDir(outputDir));
}

// ============================================================================
// Incremental Rebuild
// ============================================================================

/**
 * Determine which modules need re-analysis based on git changes.
 *
 * Algorithm:
 * 1. Get changed files since the cached git hash
 * 2. For each module, check if any changed file falls under module.path or matches module.keyFiles
 * 3. Return affected module IDs
 *
 * @param graph - Module graph
 * @param outputDir - Output directory (for cache access)
 * @param repoPath - Path to the git repository
 * @returns Array of module IDs that need re-analysis, or null if full rebuild needed
 */
export async function getModulesNeedingReanalysis(
    graph: ModuleGraph,
    outputDir: string,
    repoPath: string
): Promise<string[] | null> {
    // Get cached analyses metadata
    const metadata = getAnalysesCacheMetadata(outputDir);
    if (!metadata || !metadata.gitHash) {
        // No cache — full rebuild
        return null;
    }

    // Get current git hash
    const currentHash = await getRepoHeadHash(repoPath);
    if (!currentHash) {
        // Can't determine hash — full rebuild
        return null;
    }

    // If same hash, nothing needs re-analysis
    if (metadata.gitHash === currentHash) {
        return [];
    }

    // Get changed files
    const changedFiles = await getChangedFiles(repoPath, metadata.gitHash);
    if (changedFiles === null) {
        // Can't determine changes — full rebuild
        return null;
    }

    if (changedFiles.length === 0) {
        return [];
    }

    // Normalize changed file paths (forward slashes)
    const normalizedChanged = changedFiles.map(f => f.replace(/\\/g, '/'));

    // Check each module
    const affectedModules: string[] = [];
    for (const module of graph.modules) {
        const modulePath = module.path.replace(/\\/g, '/').replace(/\/$/, '');
        const keyFiles = module.keyFiles.map(f => f.replace(/\\/g, '/'));

        const isAffected = normalizedChanged.some(changedFile => {
            // Check if changed file is under the module's path
            if (changedFile.startsWith(modulePath + '/') || changedFile === modulePath) {
                return true;
            }

            // Check if changed file matches any key file
            if (keyFiles.some(kf => changedFile === kf || changedFile.endsWith('/' + kf))) {
                return true;
            }

            return false;
        });

        if (isAffected) {
            affectedModules.push(module.id);
        }
    }

    return affectedModules;
}

// ============================================================================
// Graph Cache Invalidation
// ============================================================================

/**
 * Clear the graph cache for a given output directory.
 *
 * @param outputDir - Output directory containing the cache
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearCache(outputDir: string): boolean {
    return clearCacheFile(getGraphCachePath(outputDir));
}

/**
 * Check if a valid graph cache exists for the given configuration.
 *
 * @param repoPath - Path to the git repository
 * @param outputDir - Output directory
 * @returns True if a valid (non-expired) cache exists
 */
export async function hasCachedGraph(repoPath: string, outputDir: string): Promise<boolean> {
    const cached = await getCachedGraph(repoPath, outputDir);
    return cached !== null;
}
