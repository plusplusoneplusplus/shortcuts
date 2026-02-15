/**
 * Discovery Cache — Intermediate Discovery Artifacts
 *
 * Caches intermediate results from the discovery phase (Phase 1):
 * seeds, probe results, structural scans, domain sub-graphs, and
 * round progress metadata. Enables crash recovery and avoids
 * redundant AI calls on retry.
 *
 * Cache structure:
 *   .wiki-cache/
 *   ├── discovery/
 *   │   ├── _metadata.json             # Round progress, convergence state
 *   │   ├── seeds.json                 # Cached auto-generated seeds
 *   │   ├── structural-scan.json       # Large-repo structural scan
 *   │   ├── probes/                    # Per-theme probe results
 *   │   │   ├── auth.json
 *   │   │   └── ...
 *   │   └── domains/                     # Per-domain sub-graphs (large repo)
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
    ThemeSeed,
    StructuralScanResult,
    ComponentGraph,
} from '../types';
import type {
    ThemeProbeResult,
} from '../discovery/iterative/types';
import type {
    CachedProbeResult,
    CachedSeeds,
    CachedStructuralScan,
    CachedDomainGraph,
    DiscoveryProgressMetadata,
} from './types';
import { normalizeComponentId } from '../schemas';
import { readCacheFile, readCacheFileIf, writeCacheFile, clearCacheDir, scanCacheItemsMap } from './cache-utils';

// ============================================================================
// Constants
// ============================================================================

/** Name of the cache directory (must match index.ts) */
const CACHE_DIR_NAME = '.wiki-cache';

/** Subdirectory for discovery cache */
const DISCOVERY_DIR = 'discovery';

/** Subdirectory for per-theme probe results */
const PROBES_DIR = 'probes';

/** Subdirectory for per-domain sub-graphs */
const DOMAINS_DIR = 'domains';

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
 * Get the domains cache directory.
 */
function getDomainsCacheDir(outputDir: string): string {
    return path.join(getDiscoveryCacheDir(outputDir), DOMAINS_DIR);
}

/**
 * Get the path to a single cached probe result.
 */
function getProbeCachePath(outputDir: string, theme: string): string {
    const slug = normalizeComponentId(theme);
    return path.join(getProbesCacheDir(outputDir), `${slug}.json`);
}

/**
 * Get the path to a single cached domain sub-graph.
 */
function getDomainCachePath(outputDir: string, domainId: string): string {
    const slug = normalizeComponentId(domainId);
    return path.join(getDomainsCacheDir(outputDir), `${slug}.json`);
}

// Local helpers (atomicWriteFileSync and safeReadJSON) have been replaced
// by shared primitives from cache-utils.ts (writeCacheFile and readCacheFile).

// ============================================================================
// Seeds Cache
// ============================================================================

/**
 * Save auto-generated seeds to the cache.
 *
 * @param seeds - The generated theme seeds
 * @param outputDir - Output directory
 * @param gitHash - Current git hash
 */
export function saveSeedsCache(
    seeds: ThemeSeed[],
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
): ThemeSeed[] | null {
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
): ThemeSeed[] | null {
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
 * @param theme - The theme that was probed
 * @param result - The probe result
 * @param outputDir - Output directory
 * @param gitHash - Current git hash
 */
export function saveProbeResult(
    theme: string,
    result: ThemeProbeResult,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedProbeResult>(getProbeCachePath(outputDir, theme), {
        probeResult: result,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Get a cached probe result if valid (git hash matches).
 *
 * @param theme - The theme to look up
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Cached probe result, or null if cache miss
 */
export function getCachedProbeResult(
    theme: string,
    outputDir: string,
    gitHash: string
): ThemeProbeResult | null {
    const cached = readCacheFileIf<CachedProbeResult>(
        getProbeCachePath(outputDir, theme),
        (d) => !!d.probeResult && d.gitHash === gitHash
    );
    return cached?.probeResult ?? null;
}

/**
 * Scan for cached probe results across multiple themes.
 *
 * @param themes - Theme names to scan
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Object with `found` (valid cached probes) and `missing` (themes not found or stale)
 */
export function scanCachedProbes(
    themes: string[],
    outputDir: string,
    gitHash: string
): { found: Map<string, ThemeProbeResult>; missing: string[] } {
    return scanCacheItemsMap<CachedProbeResult, ThemeProbeResult>(
        themes,
        (theme) => getProbeCachePath(outputDir, theme),
        (cached) => !!cached.probeResult && cached.gitHash === gitHash,
        (cached) => cached.probeResult
    );
}

/**
 * Scan for cached probe results regardless of git hash (--use-cache mode).
 */
export function scanCachedProbesAny(
    themes: string[],
    outputDir: string
): { found: Map<string, ThemeProbeResult>; missing: string[] } {
    return scanCacheItemsMap<CachedProbeResult, ThemeProbeResult>(
        themes,
        (theme) => getProbeCachePath(outputDir, theme),
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
// Domain Sub-Graph Cache (Large Repo)
// ============================================================================

/**
 * Save an domain sub-graph to the cache.
 *
 * @param domainId - The domain identifier (path or slug)
 * @param graph - The domain's sub-graph
 * @param outputDir - Output directory
 * @param gitHash - Current git hash
 */
export function saveDomainSubGraph(
    domainId: string,
    graph: ComponentGraph,
    outputDir: string,
    gitHash: string
): void {
    writeCacheFile<CachedDomainGraph>(getDomainCachePath(outputDir, domainId), {
        graph,
        gitHash,
        timestamp: Date.now(),
    });
}

/**
 * Get a cached domain sub-graph if valid (git hash matches).
 *
 * @param domainId - The domain identifier
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Cached sub-graph, or null if cache miss
 */
export function getCachedDomainSubGraph(
    domainId: string,
    outputDir: string,
    gitHash: string
): ComponentGraph | null {
    const cached = readCacheFileIf<CachedDomainGraph>(
        getDomainCachePath(outputDir, domainId),
        (d) => !!d.graph && d.gitHash === gitHash
    );
    return cached?.graph ?? null;
}

/**
 * Scan for cached domain sub-graphs across multiple domain IDs.
 *
 * @param domainIds - Domain identifiers to scan
 * @param outputDir - Output directory
 * @param gitHash - Current git hash for validation
 * @returns Object with `found` (valid cached graphs) and `missing` (domain IDs not found or stale)
 */
export function scanCachedDomains(
    domainIds: string[],
    outputDir: string,
    gitHash: string
): { found: Map<string, ComponentGraph>; missing: string[] } {
    return scanCacheItemsMap<CachedDomainGraph, ComponentGraph>(
        domainIds,
        (domainId) => getDomainCachePath(outputDir, domainId),
        (cached) => !!cached.graph && cached.gitHash === gitHash,
        (cached) => cached.graph
    );
}

/**
 * Scan for cached domain sub-graphs regardless of git hash (--use-cache mode).
 */
export function scanCachedDomainsAny(
    domainIds: string[],
    outputDir: string
): { found: Map<string, ComponentGraph>; missing: string[] } {
    return scanCacheItemsMap<CachedDomainGraph, ComponentGraph>(
        domainIds,
        (domainId) => getDomainCachePath(outputDir, domainId),
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
