/**
 * Consolidation Types — Phase 2 module consolidation interfaces.
 *
 * These types define the options, results, and intermediate structures
 * for the module consolidation pipeline (rule-based + AI clustering).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ModuleGraph } from '../types';

/**
 * Options for the consolidation phase (Phase 2).
 */
export interface ConsolidationOptions {
    /** Maximum number of modules to target after consolidation (default: 50) */
    targetModuleCount?: number;
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
    /** The consolidated module graph */
    graph: ModuleGraph;
    /** Number of modules before consolidation */
    originalCount: number;
    /** Number of modules after rule-based pass */
    afterRuleBasedCount: number;
    /** Number of modules after AI clustering (same as afterRuleBasedCount if AI skipped) */
    finalCount: number;
    /** Duration in milliseconds */
    duration: number;
}

/**
 * A cluster group produced by AI-assisted clustering.
 */
export interface ClusterGroup {
    /** Suggested ID for the merged module */
    id: string;
    /** Human-readable name for the cluster */
    name: string;
    /** IDs of modules to merge into this cluster */
    memberIds: string[];
    /** Combined purpose description */
    purpose: string;
}
