/**
 * Analysis Executor
 *
 * Orchestrates Phase 2 (Deep Analysis) using the MapReduceExecutor
 * from pipeline-core. Converts ModuleInfo items into PromptItems,
 * runs parallel AI sessions with MCP tools, and parses results
 * into ModuleAnalysis objects.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    createPromptMapJob,
    createPromptMapInput,
    createExecutor,
    getLogger,
    LogCategory,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    AIInvoker,
    PromptItem,
    PromptMapResult,
    PromptMapOutput,
    JobProgress,
    ItemCompleteCallback,
} from '@plusplusoneplusplus/pipeline-core';
import type { ModuleInfo, ModuleGraph, ModuleAnalysis } from '../types';
import { buildAnalysisPromptTemplate, getAnalysisOutputFields } from './prompts';
import { parseAnalysisResponse } from './response-parser';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for running the analysis executor.
 */
export interface AnalysisExecutorOptions {
    /** AI invoker configured for analysis (with MCP tools) */
    aiInvoker: AIInvoker;
    /** Module graph from Phase 1 */
    graph: ModuleGraph;
    /** Analysis depth */
    depth: 'shallow' | 'normal' | 'deep';
    /** Maximum concurrent AI sessions (default: 5) */
    concurrency?: number;
    /** Timeout per module in milliseconds */
    timeoutMs?: number;
    /** Number of retry attempts for failed map operations (default: 1) */
    retryAttempts?: number;
    /** AI model to use */
    model?: string;
    /** Progress callback */
    onProgress?: (progress: JobProgress) => void;
    /** Cancellation check function */
    isCancelled?: () => boolean;
    /**
     * Optional callback invoked after each individual module analysis completes.
     * Useful for incremental per-module cache writes during long-running analysis.
     */
    onItemComplete?: ItemCompleteCallback;
}

/**
 * Result of the analysis executor.
 */
export interface AnalysisExecutorResult {
    /** Successfully parsed analyses */
    analyses: ModuleAnalysis[];
    /** Module IDs that failed analysis */
    failedModuleIds: string[];
    /** Total duration in milliseconds */
    duration: number;
}

// ============================================================================
// Module → PromptItem Conversion
// ============================================================================

/**
 * Convert a ModuleInfo into a PromptItem for template substitution.
 * PromptItem requires flat string key-value pairs.
 */
export function moduleToPromptItem(module: ModuleInfo, graph: ModuleGraph): PromptItem {
    return {
        moduleId: module.id,
        moduleName: module.name,
        modulePath: module.path,
        purpose: module.purpose,
        keyFiles: module.keyFiles.join(', '),
        dependencies: module.dependencies.join(', ') || 'none',
        dependents: module.dependents.join(', ') || 'none',
        complexity: module.complexity,
        category: module.category,
        projectName: graph.project.name,
        architectureNotes: graph.architectureNotes || 'No architecture notes available.',
    };
}

// ============================================================================
// Analysis Executor
// ============================================================================

/**
 * Run the analysis executor on all modules in the graph.
 *
 * Uses MapReduceExecutor from pipeline-core with:
 * - PromptMapJob for template substitution + AI invocation
 * - Analysis prompt template (depth-dependent)
 * - Structured JSON output parsing
 *
 * @param options Executor options
 * @returns Analysis results (successes + failures)
 */
export async function runAnalysisExecutor(
    options: AnalysisExecutorOptions
): Promise<AnalysisExecutorResult> {
    const startTime = Date.now();
    const {
        aiInvoker,
        graph,
        depth,
        concurrency = 5,
        timeoutMs,
        retryAttempts = 1,
        model,
        onProgress,
        isCancelled,
        onItemComplete,
    } = options;

    const modules = graph.modules;
    if (modules.length === 0) {
        return { analyses: [], failedModuleIds: [], duration: 0 };
    }

    // Build the prompt template and output fields (shared across all rounds)
    const promptTemplate = buildAnalysisPromptTemplate(depth);
    const outputFields = getAnalysisOutputFields();

    // Run initial analysis round
    const { analyses, failedModuleIds } = await executeAnalysisRound(
        modules, graph, aiInvoker, promptTemplate, outputFields,
        concurrency, timeoutMs, model, onProgress, isCancelled, onItemComplete
    );

    // Retry failed modules (up to retryAttempts rounds)
    if (failedModuleIds.length > 0 && retryAttempts > 0) {
        const logger = getLogger();
        let remainingFailed = [...failedModuleIds];

        for (let attempt = 0; attempt < retryAttempts && remainingFailed.length > 0; attempt++) {
            if (isCancelled?.()) break;

            logger.debug(LogCategory.MAP_REDUCE, `Retrying ${remainingFailed.length} failed module(s) (attempt ${attempt + 1}/${retryAttempts})`);

            // Get the modules that failed
            const retryModules = modules.filter(m => remainingFailed.includes(m.id));

            const retryResult = await executeAnalysisRound(
                retryModules, graph, aiInvoker, promptTemplate, outputFields,
                concurrency, timeoutMs, model, onProgress, isCancelled, onItemComplete
            );

            // Add newly succeeded analyses
            analyses.push(...retryResult.analyses);

            // Update remaining failures
            remainingFailed = retryResult.failedModuleIds;
        }

        // Replace failedModuleIds with the final set of failures
        failedModuleIds.length = 0;
        failedModuleIds.push(...remainingFailed);
    }

    return {
        analyses,
        failedModuleIds,
        duration: Date.now() - startTime,
    };
}

/**
 * Execute a single round of analysis for the given modules.
 * Returns successfully parsed analyses and the IDs of modules that failed.
 */
async function executeAnalysisRound(
    modules: ModuleInfo[],
    graph: ModuleGraph,
    aiInvoker: AIInvoker,
    promptTemplate: string,
    outputFields: string[],
    concurrency: number,
    timeoutMs: number | undefined,
    model: string | undefined,
    onProgress: ((progress: JobProgress) => void) | undefined,
    isCancelled: (() => boolean) | undefined,
    onItemComplete: ItemCompleteCallback | undefined,
): Promise<{ analyses: ModuleAnalysis[]; failedModuleIds: string[] }> {
    // Convert modules to PromptItems
    const items: PromptItem[] = modules.map(m => moduleToPromptItem(m, graph));

    // Create prompt map input
    const input = createPromptMapInput(items, promptTemplate, outputFields);

    // Create the job
    const job = createPromptMapJob({
        aiInvoker,
        outputFormat: 'json',
        model,
        maxConcurrency: concurrency,
    });

    // Create the executor (no executor-level retry — we handle retry at the analysis level)
    const executor = createExecutor({
        aiInvoker,
        maxConcurrency: concurrency,
        reduceMode: 'deterministic',
        showProgress: true,
        retryOnFailure: false,
        timeoutMs,
        jobName: 'Deep Analysis',
        onProgress,
        isCancelled,
        onItemComplete,
    });

    // Execute map-reduce
    const result = await executor.execute(job, input);

    // Parse results into ModuleAnalysis objects
    const analyses: ModuleAnalysis[] = [];
    const failedModuleIds: string[] = [];

    if (result.output) {
        const logger = getLogger();
        const output = result.output as PromptMapOutput;
        for (const mapResult of output.results) {
            const moduleId = mapResult.item.moduleId;

            if (mapResult.success && mapResult.rawResponse) {
                try {
                    const analysis = parseAnalysisResponse(mapResult.rawResponse, moduleId);
                    analyses.push(analysis);
                } catch (parseErr1) {
                    // Parse failed — try with the output fields
                    try {
                        const analysis = parseOutputAsAnalysis(mapResult.output, moduleId);
                        analyses.push(analysis);
                    } catch (parseErr2) {
                        logger.debug(LogCategory.MAP_REDUCE, `Analysis parse failed for module "${moduleId}". rawResponse (${mapResult.rawResponse.length} chars): ${mapResult.rawResponse.substring(0, 500)}`);
                        logger.debug(LogCategory.MAP_REDUCE, `  Parse error 1: ${parseErr1 instanceof Error ? parseErr1.message : String(parseErr1)}`);
                        logger.debug(LogCategory.MAP_REDUCE, `  Parse error 2: ${parseErr2 instanceof Error ? parseErr2.message : String(parseErr2)}`);
                        failedModuleIds.push(moduleId);
                    }
                }
            } else if (mapResult.success && mapResult.output) {
                // No raw response but has parsed output
                try {
                    const analysis = parseOutputAsAnalysis(mapResult.output, moduleId);
                    analyses.push(analysis);
                } catch {
                    failedModuleIds.push(moduleId);
                }
            } else if (!mapResult.success && mapResult.rawResponse) {
                // Map-reduce reported failure (e.g. pipeline-core JSON parse failed),
                // but raw response is available — try deep-wiki's more tolerant parser
                try {
                    const analysis = parseAnalysisResponse(mapResult.rawResponse, moduleId);
                    analyses.push(analysis);
                    logger.debug(LogCategory.MAP_REDUCE, `Analysis recovered for module "${moduleId}" from rawResponse (pipeline-core parse had failed: ${mapResult.error})`);
                } catch (recoveryErr) {
                    // Recovery also failed — try output fields as last resort
                    try {
                        const analysis = parseOutputAsAnalysis(mapResult.output, moduleId);
                        analyses.push(analysis);
                    } catch {
                        logger.debug(LogCategory.MAP_REDUCE, `Analysis failed for module "${moduleId}": success=${mapResult.success}, error=${mapResult.error || 'none'}, rawResponse=${mapResult.rawResponse.length} chars: ${mapResult.rawResponse.substring(0, 300)}`);
                        logger.debug(LogCategory.MAP_REDUCE, `  Recovery parse error: ${recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)}`);
                        failedModuleIds.push(moduleId);
                    }
                }
            } else {
                logger.debug(LogCategory.MAP_REDUCE, `Analysis failed for module "${moduleId}": success=${mapResult.success}, error=${mapResult.error || 'none'}, rawResponse=${mapResult.rawResponse ? `${mapResult.rawResponse.length} chars: ${mapResult.rawResponse.substring(0, 300)}` : 'none'}`);
                failedModuleIds.push(moduleId);
            }
        }
    } else {
        // All failed
        for (const module of modules) {
            failedModuleIds.push(module.id);
        }
    }

    return { analyses, failedModuleIds };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse a map result output (Record<string, unknown>) as a ModuleAnalysis.
 * Used as a fallback when rawResponse parsing fails but we have structured output.
 */
function parseOutputAsAnalysis(
    output: Record<string, unknown>,
    expectedModuleId: string
): ModuleAnalysis {
    // Wrap the output in a JSON string and pass through the main parser
    const jsonStr = JSON.stringify(output);
    return parseAnalysisResponse(jsonStr, expectedModuleId);
}
