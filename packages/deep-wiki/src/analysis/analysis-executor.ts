/**
 * Analysis Executor
 *
 * Orchestrates Phase 3 (Deep Analysis) using the MapReduceExecutor
 * from pipeline-core. Converts ComponentInfo items into PromptItems,
 * runs parallel AI sessions with MCP tools, and parses results
 * into ComponentAnalysis objects.
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
import type { ComponentInfo, ComponentGraph, ComponentAnalysis } from '../types';
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
    /** Component graph from Phase 1 (Discovery) */
    graph: ComponentGraph;
    /** Analysis depth */
    depth: 'shallow' | 'normal' | 'deep';
    /** Maximum concurrent AI sessions (default: 5) */
    concurrency?: number;
    /** Timeout per component in milliseconds */
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
     * Optional callback invoked after each individual component analysis completes.
     * Useful for incremental per-component cache writes during long-running analysis.
     */
    onItemComplete?: ItemCompleteCallback;
}

/**
 * Result of the analysis executor.
 */
export interface AnalysisExecutorResult {
    /** Successfully parsed analyses */
    analyses: ComponentAnalysis[];
    /** Component IDs that failed analysis */
    failedComponentIds: string[];
    /** Total duration in milliseconds */
    duration: number;
}

// ============================================================================
// Component → PromptItem Conversion
// ============================================================================

/**
 * Convert a ComponentInfo into a PromptItem for template substitution.
 * PromptItem requires flat string key-value pairs.
 */
export function componentToPromptItem(component: ComponentInfo, graph: ComponentGraph): PromptItem {
    return {
        componentId: component.id,
        componentName: component.name,
        componentPath: component.path,
        purpose: component.purpose,
        keyFiles: component.keyFiles.join(', '),
        dependencies: component.dependencies.join(', ') || 'none',
        dependents: component.dependents.join(', ') || 'none',
        complexity: component.complexity,
        category: component.category,
        projectName: graph.project.name,
        architectureNotes: graph.architectureNotes || 'No architecture notes available.',
    };
}

// ============================================================================
// Analysis Executor
// ============================================================================

/**
 * Run the analysis executor on all components in the graph.
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

    const components = graph.components;
    if (components.length === 0) {
        return { analyses: [], failedComponentIds: [], duration: 0 };
    }

    // Build the prompt template and output fields (shared across all rounds)
    const promptTemplate = buildAnalysisPromptTemplate(depth);
    const outputFields = getAnalysisOutputFields();

    // Run initial analysis round
    const { analyses, failedComponentIds } = await executeAnalysisRound({
        components, graph, aiInvoker, promptTemplate, outputFields,
        concurrency, timeoutMs, model, onProgress, isCancelled, onItemComplete,
    });

    // Retry failed components (up to retryAttempts rounds)
    if (failedComponentIds.length > 0 && retryAttempts > 0) {
        const logger = getLogger();
        let remainingFailed = [...failedComponentIds];

        for (let attempt = 0; attempt < retryAttempts && remainingFailed.length > 0; attempt++) {
            if (isCancelled?.()) break;

            logger.debug(LogCategory.MAP_REDUCE, `Retrying ${remainingFailed.length} failed component(s) (attempt ${attempt + 1}/${retryAttempts})`);

            // Get the components that failed
            const retryComponents = components.filter(m => remainingFailed.includes(m.id));

            const retryResult = await executeAnalysisRound({
                components: retryComponents, graph, aiInvoker, promptTemplate, outputFields,
                concurrency, timeoutMs, model, onProgress, isCancelled, onItemComplete,
            });

            // Add newly succeeded analyses
            analyses.push(...retryResult.analyses);

            // Update remaining failures
            remainingFailed = retryResult.failedComponentIds;
        }

        // Replace failedComponentIds with the final set of failures
        failedComponentIds.length = 0;
        failedComponentIds.push(...remainingFailed);
    }

    return {
        analyses,
        failedComponentIds,
        duration: Date.now() - startTime,
    };
}

/**
 * Options for a single analysis round.
 */
interface AnalysisRoundOptions {
    components: ComponentInfo[];
    graph: ComponentGraph;
    aiInvoker: AIInvoker;
    promptTemplate: string;
    outputFields: string[];
    concurrency: number;
    timeoutMs?: number;
    model?: string;
    onProgress?: (progress: JobProgress) => void;
    isCancelled?: () => boolean;
    onItemComplete?: ItemCompleteCallback;
}

/**
 * Execute a single round of analysis for the given components.
 * Returns successfully parsed analyses and the IDs of components that failed.
 */
async function executeAnalysisRound(
    options: AnalysisRoundOptions
): Promise<{ analyses: ComponentAnalysis[]; failedComponentIds: string[] }> {
    const { components, graph, aiInvoker, promptTemplate, outputFields, concurrency, timeoutMs, model, onProgress, isCancelled, onItemComplete } = options;
    // Convert components to PromptItems
    const items: PromptItem[] = components.map(c => componentToPromptItem(c, graph));

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

    // Parse results into ComponentAnalysis objects
    const analyses: ComponentAnalysis[] = [];
    const failedComponentIds: string[] = [];

    if (result.output) {
        const logger = getLogger();
        const output = result.output as PromptMapOutput;
        for (const mapResult of output.results) {
            const componentId = mapResult.item.componentId;

            if (mapResult.success && mapResult.rawResponse) {
                try {
                    const analysis = parseAnalysisResponse(mapResult.rawResponse, componentId);
                    analyses.push(analysis);
                } catch (parseErr1) {
                    // Parse failed — try with the output fields
                    try {
                        const analysis = parseOutputAsAnalysis(mapResult.output, componentId);
                        analyses.push(analysis);
                    } catch (parseErr2) {
                        logger.debug(LogCategory.MAP_REDUCE, `Analysis parse failed for component "${componentId}". rawResponse (${mapResult.rawResponse.length} chars): ${mapResult.rawResponse.substring(0, 500)}`);
                        logger.debug(LogCategory.MAP_REDUCE, `  Parse error 1: ${parseErr1 instanceof Error ? parseErr1.message : String(parseErr1)}`);
                        logger.debug(LogCategory.MAP_REDUCE, `  Parse error 2: ${parseErr2 instanceof Error ? parseErr2.message : String(parseErr2)}`);
                        failedComponentIds.push(componentId);
                    }
                }
            } else if (mapResult.success && mapResult.output) {
                // No raw response but has parsed output
                try {
                    const analysis = parseOutputAsAnalysis(mapResult.output, componentId);
                    analyses.push(analysis);
                } catch {
                    failedComponentIds.push(componentId);
                }
            } else if (!mapResult.success && mapResult.rawResponse) {
                // Map-reduce reported failure (e.g. pipeline-core JSON parse failed),
                // but raw response is available — try deep-wiki's more tolerant parser
                try {
                    const analysis = parseAnalysisResponse(mapResult.rawResponse, componentId);
                    analyses.push(analysis);
                    logger.debug(LogCategory.MAP_REDUCE, `Analysis recovered for component "${componentId}" from rawResponse (pipeline-core parse had failed: ${mapResult.error})`);
                } catch (recoveryErr) {
                    // Recovery also failed — try output fields as last resort
                    try {
                        const analysis = parseOutputAsAnalysis(mapResult.output, componentId);
                        analyses.push(analysis);
                    } catch {
                        logger.debug(LogCategory.MAP_REDUCE, `Analysis failed for component "${componentId}": success=${mapResult.success}, error=${mapResult.error || 'none'}, rawResponse=${mapResult.rawResponse.length} chars: ${mapResult.rawResponse.substring(0, 300)}`);
                        logger.debug(LogCategory.MAP_REDUCE, `  Recovery parse error: ${recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)}`);
                        failedComponentIds.push(componentId);
                    }
                }
            } else {
                logger.debug(LogCategory.MAP_REDUCE, `Analysis failed for component "${componentId}": success=${mapResult.success}, error=${mapResult.error || 'none'}, rawResponse=${mapResult.rawResponse ? `${mapResult.rawResponse.length} chars: ${mapResult.rawResponse.substring(0, 300)}` : 'none'}`);
                failedComponentIds.push(componentId);
            }
        }
    } else {
        // All failed
        for (const component of components) {
            failedComponentIds.push(component.id);
        }
    }

    return { analyses, failedComponentIds };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse a map result output (Record<string, unknown>) as a ComponentAnalysis.
 * Used as a fallback when rawResponse parsing fails but we have structured output.
 */
function parseOutputAsAnalysis(
    output: Record<string, unknown>,
    expectedComponentId: string
): ComponentAnalysis {
    // Wrap the output in a JSON string and pass through the main parser
    const jsonStr = JSON.stringify(output);
    return parseAnalysisResponse(jsonStr, expectedComponentId);
}
