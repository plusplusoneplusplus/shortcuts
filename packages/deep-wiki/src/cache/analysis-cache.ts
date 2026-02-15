/**
 * Analysis Cache — Per-Module Analysis Results
 *
 * Caches per-module analysis results from Phase 3.
 * Supports individual and bulk operations, crash recovery scanning,
 * and metadata-based validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    ComponentAnalysis,
} from '../types';
import type {
    CachedAnalysis,
    AnalysisCacheMetadata,
} from './types';
import { getFolderHeadHash } from './git-utils';
import { readCacheFile, readCacheFileIf, writeCacheFile, clearCacheDir, scanCacheItems } from './cache-utils';
import { getCacheDir, CACHE_VERSION, ANALYSES_DIR, ANALYSES_METADATA_FILE } from './cache-constants';

// ============================================================================
// Paths
// ============================================================================

/**
 * Get the analyses cache directory.
 */
export function getAnalysesCacheDir(outputDir: string): string {
    return path.join(getCacheDir(outputDir), ANALYSES_DIR);
}

/**
 * Get the path to a single cached analysis file.
 */
export function getAnalysisCachePath(outputDir: string, componentId: string): string {
    return path.join(getAnalysesCacheDir(outputDir), `${componentId}.json`);
}

/**
 * Get the path to the analyses metadata file.
 */
export function getAnalysesMetadataPath(outputDir: string): string {
    return path.join(getAnalysesCacheDir(outputDir), ANALYSES_METADATA_FILE);
}

// ============================================================================
// Read
// ============================================================================

/**
 * Get a single cached module analysis.
 *
 * @param componentId - Module ID to look up
 * @param outputDir - Output directory
 * @returns The cached analysis, or null if not found
 */
export function getCachedAnalysis(componentId: string, outputDir: string): ComponentAnalysis | null {
    const cached = readCacheFileIf<CachedAnalysis>(
        getAnalysisCachePath(outputDir, componentId),
        (d) => !!d.analysis && !!d.analysis.componentId
    );
    return cached?.analysis ?? null;
}

/**
 * Get all cached analyses if the cache is valid.
 *
 * @param outputDir - Output directory
 * @returns Array of cached analyses, or null if cache is invalid/missing
 */
export function getCachedAnalyses(outputDir: string): ComponentAnalysis[] | null {
    const metadata = readCacheFileIf<AnalysisCacheMetadata>(
        getAnalysesMetadataPath(outputDir),
        (d) => !!d.gitHash && !!d.componentCount
    );
    if (!metadata) {
        return null;
    }

    // Read all analysis files
    const analysesDir = getAnalysesCacheDir(outputDir);
    const analyses: ComponentAnalysis[] = [];

    try {
        const files = fs.readdirSync(analysesDir);
        for (const file of files) {
            if (file === ANALYSES_METADATA_FILE || !file.endsWith('.json')) {
                continue;
            }

            const cached = readCacheFileIf<CachedAnalysis>(
                path.join(analysesDir, file),
                (d) => !!d.analysis && !!d.analysis.componentId
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
// Write
// ============================================================================

/**
 * Save a single module analysis to the cache.
 *
 * @param componentId - Module ID
 * @param analysis - The analysis to cache
 * @param outputDir - Output directory
 * @param gitHash - Git hash when the analysis was produced
 */
export function saveAnalysis(
    componentId: string,
    analysis: ComponentAnalysis,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedAnalysis>(getAnalysisCachePath(outputDir, componentId), {
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
    analyses: ComponentAnalysis[],
    outputDir: string,
    repoPath: string
): Promise<void> {
    const currentHash = await getFolderHeadHash(repoPath);
    if (!currentHash) {
        return; // Can't determine git hash
    }

    // Write individual analysis files
    for (const analysis of analyses) {
        saveAnalysis(analysis.componentId, analysis, outputDir, currentHash);
    }

    // Write metadata
    writeCacheFile<AnalysisCacheMetadata>(getAnalysesMetadataPath(outputDir), {
        gitHash: currentHash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
        componentCount: analyses.length,
    });
}

// ============================================================================
// Scan (Crash Recovery)
// ============================================================================

/**
 * Scan for individually cached analyses (even without metadata).
 *
 * This is used for crash recovery: if the process was interrupted before
 * `saveAllAnalyses` wrote the metadata file, individual per-module files
 * may still exist from incremental saves via `onItemComplete`.
 *
 * @param componentIds - Module IDs to look for in the cache
 * @param outputDir - Output directory
 * @param currentGitHash - Current git hash for validation (modules cached with
 *                         a different hash are considered stale and excluded)
 * @returns Object with `found` (valid cached analyses) and `missing` (module IDs not found or stale)
 */
export function scanIndividualAnalysesCache(
    componentIds: string[],
    outputDir: string,
    currentGitHash: string
): { found: ComponentAnalysis[]; missing: string[] } {
    return scanCacheItems<CachedAnalysis, ComponentAnalysis>(
        componentIds,
        (id) => getAnalysisCachePath(outputDir, id),
        (cached) => !!cached.analysis && !!cached.analysis.componentId && cached.gitHash === currentGitHash,
        (cached) => cached.analysis
    );
}

/**
 * Scan for individually cached analyses, ignoring git hash validation.
 *
 * @param componentIds - Module IDs to look for in the cache
 * @param outputDir - Output directory
 * @returns Object with `found` (valid cached analyses) and `missing` (module IDs not found)
 */
export function scanIndividualAnalysesCacheAny(
    componentIds: string[],
    outputDir: string
): { found: ComponentAnalysis[]; missing: string[] } {
    return scanCacheItems<CachedAnalysis, ComponentAnalysis>(
        componentIds,
        (id) => getAnalysisCachePath(outputDir, id),
        (cached) => !!cached.analysis && !!cached.analysis.componentId,
        (cached) => cached.analysis
    );
}

// ============================================================================
// Invalidation
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
