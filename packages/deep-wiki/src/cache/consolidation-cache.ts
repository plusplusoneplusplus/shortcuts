/**
 * Consolidation Cache — Consolidated Module Graph
 *
 * Caches the consolidated graph produced after merging discovery results.
 * Validates against both git hash and input module count.
 */

import * as path from 'path';
import type {
    ComponentGraph,
} from '../types';
import type {
    CachedConsolidation,
} from './types';
import { getFolderHeadHash } from './git-utils';
import { readCacheFileIf, writeCacheFile, clearCacheFile } from './cache-utils';
import { getCacheDir, CONSOLIDATED_GRAPH_FILE } from './cache-constants';

// ============================================================================
// Paths
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
// Read
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
 * @param inputComponentCount - Number of modules in the pre-consolidation graph
 * @returns The cached consolidated graph if valid, or null if cache miss
 */
export async function getCachedConsolidation(
    repoPath: string,
    outputDir: string,
    inputComponentCount: number
): Promise<CachedConsolidation | null> {
    const cached = readCacheFileIf<CachedConsolidation>(
        getConsolidatedGraphCachePath(outputDir),
        (d) => !!d.graph && !!d.gitHash && !!d.inputComponentCount && d.inputComponentCount === inputComponentCount
    );
    if (!cached) {
        return null;
    }

    try {
        const currentHash = await getFolderHeadHash(repoPath);
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
 * @param inputComponentCount - Number of modules in the pre-consolidation graph
 * @returns The cached consolidated graph if structurally valid, or null
 */
export function getCachedConsolidationAny(
    outputDir: string,
    inputComponentCount: number
): CachedConsolidation | null {
    return readCacheFileIf<CachedConsolidation>(
        getConsolidatedGraphCachePath(outputDir),
        (d) => !!d.graph && !!d.gitHash && !!d.inputComponentCount && d.inputComponentCount === inputComponentCount
    );
}

// ============================================================================
// Write
// ============================================================================

/**
 * Save a consolidated graph to the cache.
 *
 * @param repoPath - Path to the git repository
 * @param graph - The consolidated module graph
 * @param outputDir - Output directory for the cache
 * @param inputComponentCount - Number of modules before consolidation
 */
export async function saveConsolidation(
    repoPath: string,
    graph: ComponentGraph,
    outputDir: string,
    inputComponentCount: number
): Promise<void> {
    const currentHash = await getFolderHeadHash(repoPath);
    if (!currentHash) {
        return; // Can't determine git hash
    }

    writeCacheFile<CachedConsolidation>(getConsolidatedGraphCachePath(outputDir), {
        graph,
        gitHash: currentHash,
        inputComponentCount,
        timestamp: Date.now(),
    });
}

// ============================================================================
// Invalidation
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
