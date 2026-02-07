/**
 * Cache Layer — Cache Manager
 *
 * Manages cached module graph results for incremental discovery.
 * Cache location: <output>/.wiki-cache/ or custom --cache path.
 * Uses git HEAD hash for invalidation.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ModuleGraph, CachedGraph, CacheMetadata } from '../types';
import { getRepoHeadHash } from './git-utils';

// Re-export git utilities
export { getRepoHeadHash, getChangedFiles, hasChanges, isGitAvailable, isGitRepo } from './git-utils';

// ============================================================================
// Constants
// ============================================================================

/** Name of the cache directory */
const CACHE_DIR_NAME = '.wiki-cache';

/** Name of the cached module graph file */
const GRAPH_CACHE_FILE = 'module-graph.json';

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

// ============================================================================
// Cache Read
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
// Cache Write
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
// Cache Invalidation
// ============================================================================

/**
 * Clear the cache for a given output directory.
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
 * Check if a valid cache exists for the given configuration.
 *
 * @param repoPath - Path to the git repository
 * @param outputDir - Output directory
 * @returns True if a valid (non-expired) cache exists
 */
export async function hasCachedGraph(repoPath: string, outputDir: string): Promise<boolean> {
    const cached = await getCachedGraph(repoPath, outputDir);
    return cached !== null;
}
