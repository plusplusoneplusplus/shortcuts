/**
 * Component Consolidation Orchestrator
 *
 * Public API for Phase 2 — combines rule-based directory consolidation
 * with AI-assisted semantic clustering to reduce component count.
 *
 * Pipeline: Rule-based → AI clustering (optional)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import type { ComponentGraph } from '../types';
import type { ConsolidationOptions, ConsolidationResult } from './types';
import { consolidateByDirectory } from './rule-based-consolidator';
import { clusterWithAI } from './ai-consolidator';

// ============================================================================
// Constants
// ============================================================================

/** Default target component count for AI clustering */
const DEFAULT_TARGET_COMPONENT_COUNT = 50;

// ============================================================================
// Public API
// ============================================================================

/**
 * Run the full hybrid consolidation pipeline.
 *
 * 1. Rule-based pass: merge components by directory proximity
 * 2. AI-assisted pass: semantic clustering to target count (optional)
 *
 * @param graph - The original component graph from Phase 1 (Discovery)
 * @param aiInvoker - AI invoker for semantic clustering (null to skip AI)
 * @param options - Consolidation options
 * @returns Consolidation result with new graph and stats
 */
export async function consolidateComponents(
    graph: ComponentGraph,
    aiInvoker: AIInvoker | null,
    options: ConsolidationOptions = {}
): Promise<ConsolidationResult> {
    const startTime = Date.now();
    const originalCount = graph.components.length;
    const targetCount = options.targetComponentCount || DEFAULT_TARGET_COMPONENT_COUNT;

    // Step 1: Rule-based consolidation
    const ruleBasedGraph = consolidateByDirectory(graph);
    const afterRuleBasedCount = ruleBasedGraph.components.length;

    // Step 2: AI-assisted clustering (if enabled and needed)
    let finalGraph = ruleBasedGraph;

    if (!options.skipAI && aiInvoker && afterRuleBasedCount > targetCount) {
        try {
            finalGraph = await clusterWithAI(ruleBasedGraph, {
                aiInvoker,
                targetCount,
                model: options.model,
                timeoutMs: options.timeoutMs,
            });
        } catch {
            // AI clustering failed — use rule-based result
            finalGraph = ruleBasedGraph;
        }
    }

    return {
        graph: finalGraph,
        originalCount,
        afterRuleBasedCount,
        finalCount: finalGraph.components.length,
        duration: Date.now() - startTime,
    };
}
