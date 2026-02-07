/**
 * Analysis Module — Public API
 *
 * Phase 2 (Deep Analysis) entry point. Converts ModuleGraph modules
 * into PromptItems and runs parallel AI sessions with MCP tools
 * to produce detailed ModuleAnalysis results.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AnalysisOptions, AnalysisResult, ModuleAnalysis } from '../types';
import type { AIInvoker, JobProgress, ItemCompleteCallback } from '@plusplusoneplusplus/pipeline-core';
import { runAnalysisExecutor } from './analysis-executor';

// Re-export for convenience
export { parseAnalysisResponse, extractJSON } from './response-parser';
export { buildAnalysisPromptTemplate, getAnalysisOutputFields, getInvestigationSteps } from './prompts';
export { moduleToPromptItem, runAnalysisExecutor } from './analysis-executor';
export type { AnalysisExecutorOptions, AnalysisExecutorResult } from './analysis-executor';

// ============================================================================
// Public API
// ============================================================================

/**
 * Analyze all modules in the graph using AI with MCP tool access.
 *
 * @param options Analysis options
 * @param aiInvoker Configured AI invoker for analysis (with MCP tools)
 * @param onProgress Optional progress callback
 * @param isCancelled Optional cancellation check
 * @param onItemComplete Optional per-item completion callback for incremental saving
 * @returns Analysis results
 */
export async function analyzeModules(
    options: AnalysisOptions,
    aiInvoker: AIInvoker,
    onProgress?: (progress: JobProgress) => void,
    isCancelled?: () => boolean,
    onItemComplete?: ItemCompleteCallback,
): Promise<AnalysisResult> {
    const startTime = Date.now();

    const result = await runAnalysisExecutor({
        aiInvoker,
        graph: options.graph,
        depth: options.depth || 'normal',
        concurrency: options.concurrency || 5,
        timeoutMs: options.timeout || 180_000,
        model: options.model,
        onProgress,
        isCancelled,
        onItemComplete,
    });

    return {
        analyses: result.analyses,
        duration: Date.now() - startTime,
    };
}
