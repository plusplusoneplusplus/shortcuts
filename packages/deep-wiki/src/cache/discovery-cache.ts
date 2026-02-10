/**
 * Discovery Cache — Intermediate Discovery Artifacts
 *
 * Caches intermediate results from the discovery phase (Phase 1):
 * seeds, probe results, structural scans, area sub-graphs, and
 * round progress metadata. Enables crash recovery and avoids
 * redundant AI calls on retry.
 *
 * Cache structure:
 *   .wiki-cache/
 *   ├── discovery/
 *   │   ├── _metadata.json             # Round progress, convergence state
 *   │   ├── seeds.json                 # Cached auto-generated seeds
 *   │   ├── structural-scan.json       # Large-repo structural scan
 *   │   ├── probes/                    # Per-topic probe results
 *   │   │   ├── auth.json
 *   │   │   └── ...
 *   │   └── areas/                     # Per-area sub-graphs (large repo)
 *   │       ├── frontend.json
 *   │       └── ...
 *
 * Each file wraps its payload with { data, gitHash, timestamp } for invalidation.
 * Follows the same pattern as saveAnalysis() / scanIndividualAnalysesCache().
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import type {
    TopicSeed,
    StructuralScanResult,
    ModuleGraph,
} from '../types';
import type {
    TopicProbeResult,
} from '../discovery/iterative/types';
import type {
    CachedProbeResult,
    CachedSeeds,
    CachedStructuralScan,
    CachedAreaGraph,
    DiscoveryProgressMetadata,
} from './types';
import { normalizeModuleId } from '../schemas';
import { readCacheFile, readCacheFileIf, writeCacheFile, clearCacheDir, scanCacheItemsMap } from './cache-utils';

// ============================================================================
// Constants
// ============================================================================

/** Name of the cache directory (must match index.ts) */
const CACHE_DIR_NAME = '.wiki-cache';

/** Subdirectory for discovery cache */
const DISCOVERY_DIR = 'discovery';

/** Subdirectory for per-topic probe results */
const PROBES_DIR = 'probes';

/** Subdirectory for per-area sub-graphs */
const AREAS_DIR = 'areas';

/** File name for discovery progress metadata */
const METADATA_FILE = '_metadata.json';

/** File name for cached seeds */
const SEEDS_FILE = 'seeds.json';

/** File name for cached structural scan */
const STRUCTURAL_SCAN_FILE = 'structural-scan.json';

// ============================================================================
// Cache Paths
// ============================================================================

/**
 * Get the discovery cache directory path.
 *
 * @param outputDir - Output directory (the cache is stored inside it)
 * @returns Absolute path to the discovery cache directory
 */
export function getDiscoveryCacheDir(outputDir: string): string {
    return path.join(path.resolve(outputDir), CACHE_DIR_NAME, DISCOVERY_DIR);
}

/**
 * Get the probes cache directory.
 */
function getProbesCacheDir(outputDir: string): string {
    return path.join(getDiscoveryCacheDir(outputDir), PROBES_DIR);
}

/**
 * Get the areas cache directory.
 */
function getAreasCacheDir(outputDir: string): string {
    return path.join(getDiscoveryCacheDir(outputDir), AREAS_DIR);
}

/**
 * Get the path to a single cached probe result.
 */
function getProbeCachePath(outputDir: string, topic: string): string {
    const slug = normalizeModuleId(topic);
    return path.join(getProbesCacheDir(outputDir), `${slug}.json`);
}

/**
 * Get the path to a single cached area sub-graph.
 */
function getAreaCachePath(outputDir: string, areaId: string): string {
    const slug = normalizeModuleId(areaId);
    return path.join(getAreasCacheDir(outputDir), `${slug}.json`);
}

// Local helpers (atomicWriteFileSync and safeReadJSON) have been replaced
// by shared primitives from cache-utils.ts (writeCacheFile and readCacheFile).

// ============================================================================
// Seeds Cache
// ============================================================================

/**
 * Save auto-generated seeds to the cache.
 *
 * @param seeds - The generated topic seeds
 * @param outputDir - Output directory
 * @param gitHash - Current git hash
 */
export function saveSeedsCache(
    seeds: TopicSeed[],
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedSeeds>(path.join(getDiscoveryCacheDir(outputDir), SEEDS_FILE), {
        seeds,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Get cached seeds if valid (git hash matches).
 *
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Cached seeds, or null if cache miss
 */
export function getCachedSeeds(
    outputDir: string,
    gitHash: string
): TopicSeed[] | null {
    const cached = readCacheFileIf<CachedSeeds>(
        path.join(getDiscoveryCacheDir(outputDir), SEEDS_FILE),
        (d) => !!d.seeds && d.gitHash === gitHash
    );
    return cached?.seeds ?? null;
}

/**
 * Get cached seeds regardless of git hash (--use-cache mode).
 *
 * @param outputDir - Output directory
 * @returns Cached seeds, or null if not found
 */
export function getCachedSeedsAny(
    outputDir: string
): TopicSeed[] | null {
    const cached = readCacheFileIf<CachedSeeds>(
        path.join(getDiscoveryCacheDir(outputDir), SEEDS_FILE),
        (d) => !!d.seeds
    );
    return cached?.seeds ?? null;
}

// ============================================================================
// Probe Results Cache
// ============================================================================

/**
 * Save a single probe result to the cache.
 *
 * @param topic - The topic that was probed
 * @param result - The probe result
 * @param outputDir - Output directory
 * @param gitHash - Current git hash
 */
export function saveProbeResult(
    topic: string,
    result: TopicProbeResult,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedProbeResult>(getProbeCachePath(outputDir, topic), {
        probeResult: result,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Get a cached probe result if valid (git hash matches).
 *
 * @param topic - The topic to look up
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Cached probe result, or null if cache miss
 */
export function getCachedProbeResult(
    topic: string,
    outputDir: string,
    gitHash: string
): TopicProbeResult | null {
    const cached = readCacheFileIf<CachedProbeResult>(
        getProbeCachePath(outputDir, topic),
        (d) => !!d.probeResult && d.gitHash === gitHash
    );
    return cached?.probeResult ?? null;
}

/**
 * Scan for cached probe results across multiple topics.
 *
 * @param topics - Topic names to scan
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Object with `found` (valid cached probes) and `missing` (topics not found or stale)
 */
export function scanCachedProbes(
    topics: string[],
    outputDir: string,
    gitHash: string
): { found: Map<string, TopicProbeResult>; missing: string[] } {
    return scanCacheItemsMap<CachedProbeResult, TopicProbeResult>(
        topics,
        (topic) => getProbeCachePath(outputDir, topic),
        (cached) => !!cached.probeResult && cached.gitHash === gitHash,
        (cached) => cached.probeResult
    );
}

/**
 * Scan for cached probe results regardless of git hash (--use-cache mode).
 */
export function scanCachedProbesAny(
    topics: string[],
    outputDir: string
): { found: Map<string, TopicProbeResult>; missing: string[] } {
    return scanCacheItemsMap<CachedProbeResult, TopicProbeResult>(
        topics,
        (topic) => getProbeCachePath(outputDir, topic),
        (cached) => !!cached.probeResult,
        (cached) => cached.probeResult
    );
}

// ============================================================================
// Structural Scan Cache (Large Repo)
// ============================================================================

/**
 * Save a structural scan result to the cache.
 *
 * @param scan - The structural scan result
 * @param outputDir - Output directory
 * @param gitHash - Current git hash
 */
export function saveStructuralScan(
    scan: StructuralScanResult,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedStructuralScan>(path.join(getDiscoveryCacheDir(outputDir), STRUCTURAL_SCAN_FILE), {
        scanResult: scan,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Get a cached structural scan if valid (git hash matches).
 *
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Cached scan result, or null if cache miss
 */
export function getCachedStructuralScan(
    outputDir: string,
    gitHash: string
): StructuralScanResult | null {
    const cached = readCacheFileIf<CachedStructuralScan>(
        path.join(getDiscoveryCacheDir(outputDir), STRUCTURAL_SCAN_FILE),
        (d) => !!d.scanResult && d.gitHash === gitHash
    );
    return cached?.scanResult ?? null;
}

/**
 * Get a cached structural scan regardless of git hash (--use-cache mode).
 */
export function getCachedStructuralScanAny(
    outputDir: string
): StructuralScanResult | null {
    const cached = readCacheFileIf<CachedStructuralScan>(
        path.join(getDiscoveryCacheDir(outputDir), STRUCTURAL_SCAN_FILE),
        (d) => !!d.scanResult
    );
    return cached?.scanResult ?? null;
}

// ============================================================================
// Area Sub-Graph Cache (Large Repo)
// ============================================================================

/**
 * Save an area sub-graph to the cache.
 *
 * @param areaId - The area identifier (path or slug)
 * @param graph - The area's sub-graph
 * @param outputDir - Output directory
 * @param gitHash - Current git hash
 */
export function saveAreaSubGraph(
    areaId: string,
    graph: ModuleGraph,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedAreaGraph>(getAreaCachePath(outputDir, areaId), {
        graph,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Get a cached area sub-graph if valid (git hash matches).
 *
 * @param areaId - The area identifier
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Cached sub-graph, or null if cache miss
 */
export function getCachedAreaSubGraph(
    areaId: string,
    outputDir: string,
    gitHash: string
): ModuleGraph | null {
    const cached = readCacheFileIf<CachedAreaGraph>(
        getAreaCachePath(outputDir, areaId),
        (d) => !!d.graph && d.gitHash === gitHash
    );
    return cached?.graph ?? null;
}

/**
 * Scan for cached area sub-graphs across multiple area IDs.
 *
 * @param areaIds - Area identifiers to scan
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Object with `found` (valid cached graphs) and `missing` (area IDs not found or stale)
 */
export function scanCachedAreas(
    areaIds: string[],
    outputDir: string,
    gitHash: string
): { found: Map<string, ModuleGraph>; missing: string[] } {
    return scanCacheItemsMap<CachedAreaGraph, ModuleGraph>(
        areaIds,
        (areaId) => getAreaCachePath(outputDir, areaId),
        (cached) => !!cached.graph && cached.gitHash === gitHash,
        (cached) => cached.graph
    );
}

/**
 * Scan for cached area sub-graphs regardless of git hash (--use-cache mode).
 */
export function scanCachedAreasAny(
    areaIds: string[],
    outputDir: string
): { found: Map<string, ModuleGraph>; missing: string[] } {
    return scanCacheItemsMap<CachedAreaGraph, ModuleGraph>(
        areaIds,
        (areaId) => getAreaCachePath(outputDir, areaId),
        (cached) => !!cached.graph,
        (cached) => cached.graph
    );
}

// ============================================================================
// Discovery Progress Metadata
// ============================================================================

/**
 * Save discovery progress metadata for round resumption.
 *
 * @param metadata - The progress metadata
 * @param outputDir - Output directory
 */
export function saveDiscoveryMetadata(
    metadata: DiscoveryProgressMetadata,
    outputDir: string
): void {
    writeCacheFile(path.join(getDiscoveryCacheDir(outputDir), METADATA_FILE), metadata);
}

/**
 * Get discovery progress metadata.
 *
 * @param outputDir - Output directory
 * @returns Metadata, or null if not found or corrupted
 */
export function getDiscoveryMetadata(
    outputDir: string
): DiscoveryProgressMetadata | null {
    return readCacheFile<DiscoveryProgressMetadata>(path.join(getDiscoveryCacheDir(outputDir), METADATA_FILE));
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clear all discovery cache artifacts.
 *
 * @param outputDir - Output directory
 * @returns True if cache was cleared, false if no cache existed
 */
export function clearDiscoveryCache(outputDir: string): boolean {
    return clearCacheDir(getDiscoveryCacheDir(outputDir));
}
