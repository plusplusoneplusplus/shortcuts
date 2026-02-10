/**
 * Cache Types — Interfaces for cached artifacts.
 *
 * These types define the shape of data stored in the .wiki-cache/ directory.
 * Each cached item wraps its payload with metadata (git hash, timestamp)
 * for invalidation and version tracking.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ModuleGraph, ModuleAnalysis, GeneratedArticle, TopicSeed, StructuralScanResult } from '../types';
import type { TopicProbeResult } from '../discovery/iterative/types';

// ============================================================================
// Graph Cache Types
// ============================================================================

/**
 * Metadata stored alongside cached results.
 */
export interface CacheMetadata {
    /** Git HEAD hash when the cache was created */
    gitHash: string;
    /** Timestamp when the cache was created */
    timestamp: number;
    /** Deep-wiki version that created the cache */
    version: string;
    /** Focus area used during discovery (undefined = full repo) */
    focus?: string;
}

/**
 * A cached module graph with metadata.
 */
export interface CachedGraph {
    /** Cache metadata */
    metadata: CacheMetadata;
    /** The cached module graph */
    graph: ModuleGraph;
}

// ============================================================================
// Analysis Cache Types
// ============================================================================

/**
 * Metadata for cached analyses.
 */
export interface AnalysisCacheMetadata {
    /** Git HEAD hash when analyses were created */
    gitHash: string;
    /** Timestamp when analyses were saved */
    timestamp: number;
    /** Deep-wiki version */
    version: string;
    /** Number of cached modules */
    moduleCount: number;
}

/**
 * A cached per-module analysis result.
 */
export interface CachedAnalysis {
    /** The analysis result */
    analysis: ModuleAnalysis;
    /** Git hash when this analysis was created */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
}

// ============================================================================
// Article Cache Types
// ============================================================================

/**
 * A cached per-module generated article.
 */
export interface CachedArticle {
    /** The generated article */
    article: GeneratedArticle;
    /** Git hash when this article was generated */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
}

// ============================================================================
// Consolidation Cache Types
// ============================================================================

/**
 * A cached consolidation result (Phase 2).
 *
 * Keyed by git hash and the number of input modules (pre-consolidation count),
 * so the cache is invalidated when either the repo changes or the discovery
 * graph produces a different module set.
 */
export interface CachedConsolidation {
    /** The consolidated module graph */
    graph: ModuleGraph;
    /** Git hash when the consolidation was performed */
    gitHash: string;
    /** Number of input modules before consolidation */
    inputModuleCount: number;
    /** Timestamp */
    timestamp: number;
}

// ============================================================================
// Discovery Cache Types
// ============================================================================

/**
 * A cached probe result.
 */
export interface CachedProbeResult {
    /** The probe result */
    probeResult: TopicProbeResult;
    /** Git hash when this probe was executed */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
}

/**
 * Cached seeds from auto-generation.
 */
export interface CachedSeeds {
    /** The generated seeds */
    seeds: TopicSeed[];
    /** Git hash when seeds were generated */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
}

/**
 * A cached structural scan result (large repos).
 */
export interface CachedStructuralScan {
    /** The structural scan result */
    scanResult: StructuralScanResult;
    /** Git hash when scan was performed */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
}

/**
 * A cached area sub-graph (large repos).
 */
export interface CachedAreaGraph {
    /** The area sub-graph */
    graph: ModuleGraph;
    /** Git hash when this area was discovered */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
}

/**
 * Metadata tracking discovery progress for round resumption.
 */
export interface DiscoveryProgressMetadata {
    /** Git hash at the start of discovery */
    gitHash: string;
    /** Timestamp */
    timestamp: number;
    /** Discovery mode */
    mode: 'standard' | 'iterative' | 'large-repo';
    /** Current round number */
    currentRound: number;
    /** Maximum rounds configured */
    maxRounds: number;
    /** Topics that have been completed */
    completedTopics: string[];
    /** Topics pending execution */
    pendingTopics: string[];
    /** Whether convergence was reached */
    converged: boolean;
    /** Coverage estimate (0-1) */
    coverage: number;
}
