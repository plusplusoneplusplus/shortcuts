/**
 * Iterative Discovery Types — Phase 1 seed-based discovery interfaces.
 *
 * These types define the structures for the iterative breadth-first
 * discovery mode that uses topic seeds to probe the codebase.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ComponentGraph, TopicSeed } from '../../types';

/**
 * Result of probing a single topic in the codebase.
 */
export interface TopicProbeResult {
    /** The topic that was probed */
    topic: string;
    /** Components found related to this topic */
    foundComponents: ProbeFoundComponent[];
    /** New topics discovered during probing */
    discoveredTopics: DiscoveredTopic[];
    /** IDs of other topics this topic depends on */
    dependencies: string[];
    /** Confidence level (0-1) */
    confidence: number;
}

/**
 * A component found during topic probing.
 */
export interface ProbeFoundComponent {
    /** Suggested component ID (kebab-case) */
    id: string;
    /** Human-readable name */
    name: string;
    /** Path relative to repo root */
    path: string;
    /** Purpose description */
    purpose: string;
    /** Key files in this component */
    keyFiles: string[];
    /** Evidence of why this belongs to the topic */
    evidence: string;
    /** Optional line ranges for monolithic files [start, end][] */
    lineRanges?: [number, number][];
}

/**
 * A new topic discovered during probing (feeds next round).
 */
export interface DiscoveredTopic {
    /** Topic name (kebab-case) */
    topic: string;
    /** Description */
    description: string;
    /** Search hints */
    hints: string[];
    /** Where it was discovered */
    source: string;
}

/**
 * Options for iterative discovery.
 */
export interface IterativeDiscoveryOptions {
    /** Absolute path to the repository */
    repoPath: string;
    /** Initial topic seeds */
    seeds: TopicSeed[];
    /** AI model to use */
    model?: string;
    /** Timeout per probe session in milliseconds (default: 120000 = 2 min) */
    probeTimeout?: number;
    /** Timeout for merge session in milliseconds (default: 180000 = 3 min) */
    mergeTimeout?: number;
    /** Maximum parallel probe sessions (default: 5) */
    concurrency?: number;
    /** Maximum rounds of iteration (default: 3) */
    maxRounds?: number;
    /** File coverage threshold to stop (default: 0.8) */
    coverageThreshold?: number;
    /** Focus on a specific subtree */
    focus?: string;
    /** Output directory for cache (when provided, enables incremental caching) */
    outputDir?: string;
    /** Current git hash for cache validation (when provided with outputDir) */
    gitHash?: string;
    /** Use cached results regardless of git hash (--use-cache mode) */
    useCache?: boolean;
}

/**
 * Result of the merge + gap analysis step.
 */
export interface MergeResult {
    /** The merged component graph (growing) */
    graph: ComponentGraph;
    /** New topics to probe in the next round */
    newTopics: TopicSeed[];
    /** Whether convergence was reached */
    converged: boolean;
    /** Coverage estimate (0-1) */
    coverage: number;
    /** Reason for convergence (or reason not converged) */
    reason: string;
}
