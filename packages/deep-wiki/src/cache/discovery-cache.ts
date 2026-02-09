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

import * as fs from 'fs';
import * as path from 'path';
import type {
    TopicSeed,
    TopicProbeResult,
    StructuralScanResult,
    ModuleGraph,
    CachedProbeResult,
    CachedSeeds,
    CachedStructuralScan,
    CachedAreaGraph,
    DiscoveryProgressMetadata,
} from '../types';
import { normalizeModuleId } from '../schemas';

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

// ============================================================================
// Atomic Write Helper
// ============================================================================

/**
 * Write to a file atomically (write to temp file, then rename).
 * This prevents partial writes on crash.
 */
function atomicWriteFileSync(filePath: string, data: string): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, data, 'utf-8');
    fs.renameSync(tempPath, filePath);
}

/**
 * Safely read and parse a JSON cache file.
 * Returns null on any error (missing, corrupted, permission denied).
 */
function safeReadJSON<T>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch {
        return null; // Graceful degradation
    }
}

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
    const filePath = path.join(getDiscoveryCacheDir(outputDir), SEEDS_FILE);
    const cached: CachedSeeds = {
        seeds,
        gitHash,
        timestamp: Date.now(),
    };
    atomicWriteFileSync(filePath, JSON.stringify(cached, null, 2));
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
    const filePath = path.join(getDiscoveryCacheDir(outputDir), SEEDS_FILE);
    const cached = safeReadJSON<CachedSeeds>(filePath);
    if (!cached || !cached.seeds || cached.gitHash !== gitHash) {
        return null;
    }
    return cached.seeds;
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
    const filePath = path.join(getDiscoveryCacheDir(outputDir), SEEDS_FILE);
    const cached = safeReadJSON<CachedSeeds>(filePath);
    if (!cached || !cached.seeds) {
        return null;
    }
    return cached.seeds;
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
    const filePath = getProbeCachePath(outputDir, topic);
    const cached: CachedProbeResult = {
        probeResult: result,
        gitHash,
        timestamp: Date.now(),
    };
    atomicWriteFileSync(filePath, JSON.stringify(cached, null, 2));
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
    const filePath = getProbeCachePath(outputDir, topic);
    const cached = safeReadJSON<CachedProbeResult>(filePath);
    if (!cached || !cached.probeResult || cached.gitHash !== gitHash) {
        return null;
    }
    return cached.probeResult;
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
    const found = new Map<string, TopicProbeResult>();
    const missing: string[] = [];

    for (const topic of topics) {
        const result = getCachedProbeResult(topic, outputDir, gitHash);
        if (result) {
            found.set(topic, result);
        } else {
            missing.push(topic);
        }
    }

    return { found, missing };
}

/**
 * Scan for cached probe results regardless of git hash (--use-cache mode).
 */
export function scanCachedProbesAny(
    topics: string[],
    outputDir: string
): { found: Map<string, TopicProbeResult>; missing: string[] } {
    const found = new Map<string, TopicProbeResult>();
    const missing: string[] = [];

    for (const topic of topics) {
        const filePath = getProbeCachePath(outputDir, topic);
        const cached = safeReadJSON<CachedProbeResult>(filePath);
        if (cached?.probeResult) {
            found.set(topic, cached.probeResult);
        } else {
            missing.push(topic);
        }
    }

    return { found, missing };
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
    const filePath = path.join(getDiscoveryCacheDir(outputDir), STRUCTURAL_SCAN_FILE);
    const cached: CachedStructuralScan = {
        scanResult: scan,
        gitHash,
        timestamp: Date.now(),
    };
    atomicWriteFileSync(filePath, JSON.stringify(cached, null, 2));
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
    const filePath = path.join(getDiscoveryCacheDir(outputDir), STRUCTURAL_SCAN_FILE);
    const cached = safeReadJSON<CachedStructuralScan>(filePath);
    if (!cached || !cached.scanResult || cached.gitHash !== gitHash) {
        return null;
    }
    return cached.scanResult;
}

/**
 * Get a cached structural scan regardless of git hash (--use-cache mode).
 */
export function getCachedStructuralScanAny(
    outputDir: string
): StructuralScanResult | null {
    const filePath = path.join(getDiscoveryCacheDir(outputDir), STRUCTURAL_SCAN_FILE);
    const cached = safeReadJSON<CachedStructuralScan>(filePath);
    if (!cached || !cached.scanResult) {
        return null;
    }
    return cached.scanResult;
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
    const filePath = getAreaCachePath(outputDir, areaId);
    const cached: CachedAreaGraph = {
        graph,
        gitHash,
        timestamp: Date.now(),
    };
    atomicWriteFileSync(filePath, JSON.stringify(cached, null, 2));
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
    const filePath = getAreaCachePath(outputDir, areaId);
    const cached = safeReadJSON<CachedAreaGraph>(filePath);
    if (!cached || !cached.graph || cached.gitHash !== gitHash) {
        return null;
    }
    return cached.graph;
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
    const found = new Map<string, ModuleGraph>();
    const missing: string[] = [];

    for (const areaId of areaIds) {
        const graph = getCachedAreaSubGraph(areaId, outputDir, gitHash);
        if (graph) {
            found.set(areaId, graph);
        } else {
            missing.push(areaId);
        }
    }

    return { found, missing };
}

/**
 * Scan for cached area sub-graphs regardless of git hash (--use-cache mode).
 */
export function scanCachedAreasAny(
    areaIds: string[],
    outputDir: string
): { found: Map<string, ModuleGraph>; missing: string[] } {
    const found = new Map<string, ModuleGraph>();
    const missing: string[] = [];

    for (const areaId of areaIds) {
        const filePath = getAreaCachePath(outputDir, areaId);
        const cached = safeReadJSON<CachedAreaGraph>(filePath);
        if (cached?.graph) {
            found.set(areaId, cached.graph);
        } else {
            missing.push(areaId);
        }
    }

    return { found, missing };
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
    const filePath = path.join(getDiscoveryCacheDir(outputDir), METADATA_FILE);
    atomicWriteFileSync(filePath, JSON.stringify(metadata, null, 2));
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
    const filePath = path.join(getDiscoveryCacheDir(outputDir), METADATA_FILE);
    return safeReadJSON<DiscoveryProgressMetadata>(filePath);
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
    const discoveryDir = getDiscoveryCacheDir(outputDir);
    if (!fs.existsSync(discoveryDir)) {
        return false;
    }

    try {
        fs.rmSync(discoveryDir, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
}
