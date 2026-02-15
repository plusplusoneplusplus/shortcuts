/**
 * Consolidation Types — Phase 2 component consolidation interfaces.
 *
 * These types define the options, results, and intermediate structures
 * for the component consolidation pipeline (rule-based + AI clustering).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ComponentGraph } from '../types';

/**
 * Options for the consolidation phase (Phase 2).
 */
export interface ConsolidationOptions {
    /** Maximum number of components to target after consolidation (default: 50) */
    targetComponentCount?: number;
    /** AI model to use for semantic clustering */
    model?: string;
    /** Timeout for AI clustering session in milliseconds (default: 120000 = 2 min) */
    timeoutMs?: number;
    /** Skip AI clustering, only do rule-based consolidation */
    skipAI?: boolean;
}

/**
 * Result of the consolidation phase.
 */
export interface ConsolidationResult {
    /** The consolidated component graph */
    graph: ComponentGraph;
    /** Number of components before consolidation */
    originalCount: number;
    /** Number of components after rule-based pass */
    afterRuleBasedCount: number;
    /** Number of components after AI clustering (same as afterRuleBasedCount if AI skipped) */
    finalCount: number;
    /** Duration in milliseconds */
    duration: number;
}

/**
 * A cluster group produced by AI-assisted clustering.
 */
export interface ClusterGroup {
    /** Suggested ID for the merged component */
    id: string;
    /** Human-readable name for the cluster */
    name: string;
    /** IDs of components to merge into this cluster */
    memberIds: string[];
    /** Combined purpose description */
    purpose: string;
}
