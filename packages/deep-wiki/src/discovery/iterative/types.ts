/**
 * Iterative Discovery Types — Phase 1 seed-based discovery interfaces.
 *
 * These types define the structures for the iterative breadth-first
 * discovery mode that uses theme seeds to probe the codebase.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ComponentGraph, ThemeSeed } from '../../types';

/**
 * Result of probing a single theme in the codebase.
 */
export interface ThemeProbeResult {
    /** The theme that was probed */
    theme: string;
    /** Components found related to this theme */
    foundComponents: ProbeFoundComponent[];
    /** New themes discovered during probing */
    discoveredThemes: DiscoveredTheme[];
    /** IDs of other themes this theme depends on */
    dependencies: string[];
    /** Confidence level (0-1) */
    confidence: number;
}

/**
 * A component found during theme probing.
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
    /** Evidence of why this belongs to the theme */
    evidence: string;
    /** Optional line ranges for monolithic files [start, end][] */
    lineRanges?: [number, number][];
}

/**
 * A new theme discovered during probing (feeds next round).
 */
export interface DiscoveredTheme {
    /** Theme name (kebab-case) */
    theme: string;
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
    /** Initial theme seeds */
    seeds: ThemeSeed[];
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
    /** New themes to probe in the next round */
    newThemes: ThemeSeed[];
    /** Whether convergence was reached */
    converged: boolean;
    /** Coverage estimate (0-1) */
    coverage: number;
    /** Reason for convergence (or reason not converged) */
    reason: string;
}
