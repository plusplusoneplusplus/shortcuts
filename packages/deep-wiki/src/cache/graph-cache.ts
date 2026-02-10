/**
 * Graph Cache — Module Graph Discovery Results
 *
 * Caches the module graph produced by Phase 1 (discovery).
 * Uses git HEAD hash for invalidation.
 */

import * as path from 'path';
import type {
    ModuleGraph,
    CachedGraph,
    CacheMetadata,
} from '../types';
import { getFolderHeadHash } from './git-utils';
import { readCacheFileIf, writeCacheFile } from './cache-utils';
import { getCacheDir, CACHE_VERSION, GRAPH_CACHE_FILE } from './cache-constants';

// ============================================================================
// Paths
// ============================================================================

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
// Read
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
        const currentHash = await getFolderHeadHash(repoPath);
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
// Write
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
    const currentHash = await getFolderHeadHash(repoPath);
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
