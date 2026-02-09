/**
 * Module Consolidation Orchestrator
 *
 * Public API for Phase 1.5 — combines rule-based directory consolidation
 * with AI-assisted semantic clustering to reduce module count.
 *
 * Pipeline: Rule-based → AI clustering (optional)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import type { ModuleGraph, ConsolidationOptions, ConsolidationResult } from '../types';
import { consolidateByDirectory } from './rule-based-consolidator';
import { clusterWithAI } from './ai-consolidator';

// ============================================================================
// Constants
// ============================================================================

/** Default target module count for AI clustering */
const DEFAULT_TARGET_MODULE_COUNT = 50;

// ============================================================================
// Public API
// ============================================================================

/**
 * Run the full hybrid consolidation pipeline.
 *
 * 1. Rule-based pass: merge modules by directory proximity
 * 2. AI-assisted pass: semantic clustering to target count (optional)
 *
 * @param graph - The original module graph from Phase 1
 * @param aiInvoker - AI invoker for semantic clustering (null to skip AI)
 * @param options - Consolidation options
 * @returns Consolidation result with new graph and stats
 */
export async function consolidateModules(
    graph: ModuleGraph,
    aiInvoker: AIInvoker | null,
    options: ConsolidationOptions = {}
): Promise<ConsolidationResult> {
    const startTime = Date.now();
    const originalCount = graph.modules.length;
    const targetCount = options.targetModuleCount || DEFAULT_TARGET_MODULE_COUNT;

    // Step 1: Rule-based consolidation
    const ruleBasedGraph = consolidateByDirectory(graph);
    const afterRuleBasedCount = ruleBasedGraph.modules.length;

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
        finalCount: finalGraph.modules.length,
        duration: Date.now() - startTime,
    };
}
