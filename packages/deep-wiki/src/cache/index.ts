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
 *   └── analyses/                   # Phase 2 (analysis)
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
    CacheMetadata,
    AnalysisCacheMetadata,
} from '../types';
import { getRepoHeadHash, getChangedFiles } from './git-utils';

// Re-export git utilities
export { getRepoHeadHash, getChangedFiles, hasChanges, isGitAvailable, isGitRepo } from './git-utils';

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

/** Metadata file for the analyses cache */
const ANALYSES_METADATA_FILE = '_metadata.json';

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
    const cachePath = getGraphCachePath(outputDir);

    // Check if cache file exists
    if (!fs.existsSync(cachePath)) {
        return null;
    }

    // Read and parse cached data
    let cached: CachedGraph;
    try {
        const content = fs.readFileSync(cachePath, 'utf-8');
        cached = JSON.parse(content) as CachedGraph;
    } catch {
        return null; // Corrupted cache
    }

    // Validate cache structure
    if (!cached.metadata || !cached.graph) {
        return null;
    }

    // Check git hash
    const currentHash = await getRepoHeadHash(repoPath);
    if (!currentHash) {
        // Can't determine git hash — cache is unreliable
        return null;
    }

    if (cached.metadata.gitHash !== currentHash) {
        // Repo has changed since cache was created
        return null;
    }

    return cached;
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

    const cached: CachedGraph = {
        metadata,
        graph,
    };

    const cacheDir = getCacheDir(outputDir);
    const cachePath = getGraphCachePath(outputDir);

    // Ensure cache directory exists
    fs.mkdirSync(cacheDir, { recursive: true });

    // Write cache file
    fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2), 'utf-8');
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
    const cachePath = getAnalysisCachePath(outputDir, moduleId);

    if (!fs.existsSync(cachePath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(cachePath, 'utf-8');
        const cached = JSON.parse(content) as CachedAnalysis;
        if (!cached.analysis || !cached.analysis.moduleId) {
            return null;
        }
        return cached.analysis;
    } catch {
        return null; // Corrupted cache entry
    }
}

/**
 * Get all cached analyses if the cache is valid.
 *
 * @param outputDir - Output directory
 * @returns Array of cached analyses, or null if cache is invalid/missing
 */
export function getCachedAnalyses(outputDir: string): ModuleAnalysis[] | null {
    const metadataPath = getAnalysesMetadataPath(outputDir);

    if (!fs.existsSync(metadataPath)) {
        return null;
    }

    // Read metadata
    let metadata: AnalysisCacheMetadata;
    try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        metadata = JSON.parse(content) as AnalysisCacheMetadata;
    } catch {
        return null;
    }

    if (!metadata.gitHash || !metadata.moduleCount) {
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

            try {
                const content = fs.readFileSync(path.join(analysesDir, file), 'utf-8');
                const cached = JSON.parse(content) as CachedAnalysis;
                if (cached.analysis && cached.analysis.moduleId) {
                    analyses.push(cached.analysis);
                }
            } catch {
                // Skip corrupted entries
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
    const metadataPath = getAnalysesMetadataPath(outputDir);
    if (!fs.existsSync(metadataPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        return JSON.parse(content) as AnalysisCacheMetadata;
    } catch {
        return null;
    }
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
    const analysesDir = getAnalysesCacheDir(outputDir);
    const cachePath = getAnalysisCachePath(outputDir, moduleId);

    fs.mkdirSync(analysesDir, { recursive: true });

    const cached: CachedAnalysis = {
        analysis,
        gitHash,
        timestamp: Date.now(),
    };

    fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2), 'utf-8');
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

    const analysesDir = getAnalysesCacheDir(outputDir);
    fs.mkdirSync(analysesDir, { recursive: true });

    // Write individual analysis files
    for (const analysis of analyses) {
        saveAnalysis(analysis.moduleId, analysis, outputDir, currentHash);
    }

    // Write metadata
    const metadata: AnalysisCacheMetadata = {
        gitHash: currentHash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        moduleCount: analyses.length,
    };

    const metadataPath = getAnalysesMetadataPath(outputDir);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
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
    const found: ModuleAnalysis[] = [];
    const missing: string[] = [];

    for (const moduleId of moduleIds) {
        const cachePath = getAnalysisCachePath(outputDir, moduleId);
        if (!fs.existsSync(cachePath)) {
            missing.push(moduleId);
            continue;
        }

        try {
            const content = fs.readFileSync(cachePath, 'utf-8');
            const cached = JSON.parse(content) as CachedAnalysis;
            if (
                cached.analysis &&
                cached.analysis.moduleId &&
                cached.gitHash === currentGitHash
            ) {
                found.push(cached.analysis);
            } else {
                // Stale (different git hash) or invalid — needs re-analysis
                missing.push(moduleId);
            }
        } catch {
            missing.push(moduleId);
        }
    }

    return { found, missing };
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
    const analysesDir = getAnalysesCacheDir(outputDir);
    if (!fs.existsSync(analysesDir)) {
        return false;
    }

    try {
        const files = fs.readdirSync(analysesDir);
        for (const file of files) {
            fs.unlinkSync(path.join(analysesDir, file));
        }
        fs.rmdirSync(analysesDir);
        return true;
    } catch {
        return false;
    }
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
 */
export function getArticleCachePath(outputDir: string, moduleId: string): string {
    return path.join(getArticlesCacheDir(outputDir), `${moduleId}.json`);
}

/**
 * Get the path to the articles metadata file.
 */
export function getArticlesMetadataPath(outputDir: string): string {
    return path.join(getArticlesCacheDir(outputDir), ANALYSES_METADATA_FILE);
}

// ============================================================================
// Article Cache Read
// ============================================================================

/**
 * Get a single cached module article.
 *
 * @param moduleId - Module ID to look up
 * @param outputDir - Output directory
 * @returns The cached article, or null if not found
 */
export function getCachedArticle(moduleId: string, outputDir: string): GeneratedArticle | null {
    const cachePath = getArticleCachePath(outputDir, moduleId);

    if (!fs.existsSync(cachePath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(cachePath, 'utf-8');
        const cached = JSON.parse(content) as CachedArticle;
        if (!cached.article || !cached.article.slug) {
            return null;
        }
        return cached.article;
    } catch {
        return null; // Corrupted cache entry
    }
}

/**
 * Get all cached articles if the cache is valid (has metadata).
 *
 * @param outputDir - Output directory
 * @returns Array of cached articles, or null if cache is invalid/missing
 */
export function getCachedArticles(outputDir: string): GeneratedArticle[] | null {
    const metadataPath = getArticlesMetadataPath(outputDir);

    if (!fs.existsSync(metadataPath)) {
        return null;
    }

    // Read metadata
    let metadata: AnalysisCacheMetadata;
    try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        metadata = JSON.parse(content) as AnalysisCacheMetadata;
    } catch {
        return null;
    }

    if (!metadata.gitHash || !metadata.moduleCount) {
        return null;
    }

    // Read all article files
    const articlesDir = getArticlesCacheDir(outputDir);
    const articles: GeneratedArticle[] = [];

    try {
        const files = fs.readdirSync(articlesDir);
        for (const file of files) {
            if (file === ANALYSES_METADATA_FILE || !file.endsWith('.json')) {
                continue;
            }

            try {
                const content = fs.readFileSync(path.join(articlesDir, file), 'utf-8');
                const cached = JSON.parse(content) as CachedArticle;
                if (cached.article && cached.article.slug) {
                    articles.push(cached.article);
                }
            } catch {
                // Skip corrupted entries
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
    const metadataPath = getArticlesMetadataPath(outputDir);
    if (!fs.existsSync(metadataPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        return JSON.parse(content) as AnalysisCacheMetadata;
    } catch {
        return null;
    }
}

// ============================================================================
// Article Cache Write
// ============================================================================

/**
 * Save a single module article to the cache.
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
    const articlesDir = getArticlesCacheDir(outputDir);
    const cachePath = getArticleCachePath(outputDir, moduleId);

    fs.mkdirSync(articlesDir, { recursive: true });

    const cached: CachedArticle = {
        article,
        gitHash,
        timestamp: Date.now(),
    };

    fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2), 'utf-8');
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

    // Only cache module-type articles (not index/architecture/getting-started)
    const moduleArticles = articles.filter(a => a.type === 'module' && a.moduleId);

    const articlesDir = getArticlesCacheDir(outputDir);
    fs.mkdirSync(articlesDir, { recursive: true });

    // Write individual article files
    for (const article of moduleArticles) {
        saveArticle(article.moduleId!, article, outputDir, currentHash);
    }

    // Write metadata
    const metadata: AnalysisCacheMetadata = {
        gitHash: currentHash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        moduleCount: moduleArticles.length,
    };

    const metadataPath = getArticlesMetadataPath(outputDir);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * Scan for individually cached articles (even without metadata).
 *
 * This is used for crash recovery: if the process was interrupted before
 * `saveAllArticles` wrote the metadata file, individual per-module files
 * may still exist from incremental saves via `onItemComplete`.
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
    const found: GeneratedArticle[] = [];
    const missing: string[] = [];

    for (const moduleId of moduleIds) {
        const cachePath = getArticleCachePath(outputDir, moduleId);
        if (!fs.existsSync(cachePath)) {
            missing.push(moduleId);
            continue;
        }

        try {
            const content = fs.readFileSync(cachePath, 'utf-8');
            const cached = JSON.parse(content) as CachedArticle;
            if (
                cached.article &&
                cached.article.slug &&
                cached.gitHash === currentGitHash
            ) {
                found.push(cached.article);
            } else {
                // Stale (different git hash) or invalid — needs regeneration
                missing.push(moduleId);
            }
        } catch {
            missing.push(moduleId);
        }
    }

    return { found, missing };
}

// ============================================================================
// Article Cache Invalidation
// ============================================================================

/**
 * Clear all cached articles.
 *
 * @param outputDir - Output directory
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearArticlesCache(outputDir: string): boolean {
    const articlesDir = getArticlesCacheDir(outputDir);
    if (!fs.existsSync(articlesDir)) {
        return false;
    }

    try {
        const files = fs.readdirSync(articlesDir);
        for (const file of files) {
            fs.unlinkSync(path.join(articlesDir, file));
        }
        fs.rmdirSync(articlesDir);
        return true;
    } catch {
        return false;
    }
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
    const cachePath = getGraphCachePath(outputDir);
    if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
        return true;
    }
    return false;
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
