/**
 * Cache Layer — Barrel Re-export
 *
 * Re-exports all cache functions from domain-specific modules.
 * Consumers can import everything from 'cache/' or 'cache/index'.
 *
 * Also contains cross-domain functions (getComponentsNeedingReanalysis, clearCache,
 * hasCachedGraph) that depend on multiple cache domains.
 */

import type { ComponentGraph } from '../types';
import { getFolderHeadHash, getChangedFiles } from './git-utils';
import { clearCacheFile } from './cache-utils';

// Re-export constants and getCacheDir
export { getCacheDir } from './cache-constants';

// Re-export cache utilities
export * from './cache-utils';

// Re-export git utilities
export { getRepoHeadHash, getFolderHeadHash, getGitRoot, getChangedFiles, hasChanges, isGitAvailable, isGitRepo } from './git-utils';

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
    saveDomainSubGraph,
    getCachedDomainSubGraph,
    scanCachedDomains,
    scanCachedDomainsAny,
    saveDiscoveryMetadata,
    getDiscoveryMetadata,
    clearDiscoveryCache,
} from './discovery-cache';

// Re-export graph cache functions
export * from './graph-cache';

// Re-export consolidation cache functions
export * from './consolidation-cache';

// Re-export analysis cache functions
export * from './analysis-cache';

// Re-export article cache functions
export * from './article-cache';

// Re-export theme cache functions
export * from './theme-cache';

// ============================================================================
// Cross-Domain Functions
// ============================================================================

// Import from domain modules for use in cross-domain functions
import { getGraphCachePath, getCachedGraph } from './graph-cache';
import { getAnalysesCacheMetadata } from './analysis-cache';

/**
 * Determine which components need re-analysis based on git changes.
 *
 * Algorithm:
 * 1. Get changed files since the cached git hash
 * 2. For each component, check if any changed file falls under component.path or matches module.keyFiles
 * 3. Return affected component IDs
 *
 * @param graph - Component graph
 * @param outputDir - Output directory (for cache access)
 * @param repoPath - Path to the git repository
 * @returns Array of component IDs that need re-analysis, or null if full rebuild needed
 */
export async function getComponentsNeedingReanalysis(
    graph: ComponentGraph,
    outputDir: string,
    repoPath: string
): Promise<string[] | null> {
    // Get cached analyses metadata
    const metadata = getAnalysesCacheMetadata(outputDir);
    if (!metadata || !metadata.gitHash) {
        // No cache — full rebuild
        return null;
    }

    // Get current git hash (subfolder-scoped if repoPath is a subfolder)
    const currentHash = await getFolderHeadHash(repoPath);
    if (!currentHash) {
        // Can't determine hash — full rebuild
        return null;
    }

    // If same hash, nothing needs re-analysis
    if (metadata.gitHash === currentHash) {
        return [];
    }

    // Get changed files, scoped to repoPath so paths align with component paths in the graph
    const changedFiles = await getChangedFiles(repoPath, metadata.gitHash, repoPath);
    if (changedFiles === null) {
        // Can't determine changes — full rebuild
        return null;
    }

    if (changedFiles.length === 0) {
        return [];
    }

    // Normalize changed file paths (forward slashes)
    const normalizedChanged = changedFiles.map(f => f.replace(/\\/g, '/'));

    // Check each component
    const affectedComponents: string[] = [];
    for (const component of graph.components) {
        const componentPath = component.path.replace(/\\/g, '/').replace(/\/$/, '');
        const keyFiles = component.keyFiles.map(f => f.replace(/\\/g, '/'));

        const isAffected = normalizedChanged.some(changedFile => {
            // Check if changed file is under the component's path
            if (changedFile.startsWith(componentPath + '/') || changedFile === componentPath) {
                return true;
            }

            // Check if changed file matches any key file
            if (keyFiles.some(kf => changedFile === kf || changedFile.endsWith('/' + kf))) {
                return true;
            }

            return false;
        });

        if (isAffected) {
            affectedComponents.push(component.id);
        }
    }

    return affectedComponents;
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
