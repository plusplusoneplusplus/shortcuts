/**
 * Pipeline Executor
 *
 * Thin orchestrator that composes pipeline phases into a complete execution flow.
 * Individual phases are in the `phases/` directory for focused, single-responsibility modules.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as yaml from 'js-yaml';
import {
    createExecutor,
    ExecutorOptions,
    JobProgress,
    createPromptMapJob,
    createPromptMapInput,
    PromptItem,
    PromptMapResult,
} from '../map-reduce';
import { DEFAULT_AI_TIMEOUT_MS, DEFAULT_PARALLEL_LIMIT } from '../config/defaults';
import {
    PipelineConfig,
    FilterResult,
} from './types';
import { executeFilter } from './filter-executor';
import { getLogger, LogCategory } from '../logger';

// Import phase modules
import {
    PipelineExecutionError,
    ExecutePipelineOptions,
    ItemProcessEvent,
    PipelineExecutionResult,
    MapReducePipelineConfig,
    ResolvedPrompts,
    emitPhase,
    createPhaseTrackingProgress,
    convertParametersToObject,
    validatePipelineConfig,
    validatePipelineConfigForExecution,
    loadInputItems,
    prepareItems,
    resolvePrompts,
    executeSingleJob,
    executeBatchMode,
} from './phases';

// Re-export for backward compatibility
export { DEFAULT_PARALLEL_LIMIT } from '../config/defaults';
export { PipelineExecutionError } from './phases/shared';
export type { ExecutePipelineOptions, PipelineExecutionResult, ItemProcessEvent } from './phases/shared';

/**
 * Execute a pipeline from a YAML configuration
 * 
 * @param config Pipeline configuration (parsed from YAML)
 * @param options Execution options
 * @returns Map-reduce result containing pipeline output
 */
export async function executePipeline(
    config: PipelineConfig,
    options: ExecutePipelineOptions
): Promise<PipelineExecutionResult> {
    // Validate config
    validatePipelineConfig(config);

    // Single-job mode
    if (config.job) {
        return executeSingleJob(config, options);
    }

    // After validation, we know input/map/reduce are present in map-reduce mode
    const mrConfig = config as MapReducePipelineConfig;

    // Resolve prompts (from inline, files, or skills)
    const prompts = await resolvePrompts(mrConfig, options.pipelineDirectory, options.workspaceRoot);

    // Load items from input source
    emitPhase(options, 'input', 'started');
    const inputStart = Date.now();
    let items: PromptItem[];
    try {
        items = await loadInputItems(mrConfig, options.pipelineDirectory, options.aiInvoker);
        emitPhase(options, 'input', 'completed', { durationMs: Date.now() - inputStart, itemCount: items.length });
    } catch (error) {
        emitPhase(options, 'input', 'failed', { durationMs: Date.now() - inputStart, error: error instanceof Error ? error.message : String(error) });
        throw error;
    }

    // Apply limit and merge parameters
    items = prepareItems(items, mrConfig, prompts.mapPrompt);

    // Execute the pipeline with resolved prompts and items
    return executeWithItems(mrConfig, items, prompts, options);
}

/**
 * Execute a pipeline with pre-approved items
 *
 * This function bypasses the normal input loading and uses provided items directly.
 * Used when items have been generated via AI and approved by the user.
 *
 * @param config Pipeline configuration (parsed from YAML)
 * @param items Pre-approved items to process
 * @param options Execution options
 * @returns Map-reduce result containing pipeline output
 */
export async function executePipelineWithItems(
    config: PipelineConfig,
    items: PromptItem[],
    options: ExecutePipelineOptions
): Promise<PipelineExecutionResult> {
    // Validate basic config structure (but skip input validation since we're using pre-approved items)
    validatePipelineConfigForExecution(config);

    // After validation, we know map/reduce are present in map-reduce mode
    const mrConfig = config as MapReducePipelineConfig;

    // Resolve prompts (from inline, files, or skills)
    const prompts = await resolvePrompts(mrConfig, options.pipelineDirectory, options.workspaceRoot);

    // Apply limit and merge parameters to provided items
    emitPhase(options, 'input', 'completed', { itemCount: items.length });
    const processItems = prepareItems(items, mrConfig, prompts.mapPrompt);

    // Execute the pipeline with resolved prompts and items
    return executeWithItems(mrConfig, processItems, prompts, options);
}

/**
 * Execute the pipeline with resolved prompts and prepared items.
 * Core execution logic shared by both executePipeline and executePipelineWithItems.
 */
async function executeWithItems(
    config: MapReducePipelineConfig,
    items: PromptItem[],
    prompts: ResolvedPrompts,
    options: ExecutePipelineOptions
): Promise<PipelineExecutionResult> {
    let processItems = items;
    
    // Filter Phase (optional): Filter items before map phase
    let filterResult: FilterResult | undefined;
    if (config.filter) {
        emitPhase(options, 'filter', 'started', { itemCount: processItems.length });
        const filterStart = Date.now();
        try {
            filterResult = await executeFilter(processItems, config.filter, {
                aiInvoker: options.aiInvoker,
                processTracker: options.processTracker,
                onProgress: (progress) => {
                    options.onProgress?.({
                        phase: 'splitting',
                        totalItems: progress.total,
                        completedItems: progress.processed,
                        failedItems: 0,
                        percentage: Math.round((progress.processed / progress.total) * 100)
                    });
                },
                isCancelled: options.isCancelled
            });

            processItems = filterResult.included;
            emitPhase(options, 'filter', 'completed', { durationMs: Date.now() - filterStart, itemCount: filterResult.stats.includedCount });

            getLogger().info(
                LogCategory.PIPELINE,
                `Filter: ${filterResult.stats.includedCount}/${filterResult.stats.totalItems} items passed ` +
                `(${filterResult.stats.excludedCount} excluded, ${filterResult.stats.executionTimeMs}ms)`
            );

            if (processItems.length === 0) {
                getLogger().warn(LogCategory.PIPELINE, 'Filter excluded all items - map phase will have no work');
            }
        } catch (error) {
            emitPhase(options, 'filter', 'failed', { durationMs: Date.now() - filterStart, error: error instanceof Error ? error.message : String(error) });
            if (error instanceof PipelineExecutionError) {
                throw error;
            }
            throw new PipelineExecutionError(
                `Failed to execute filter: ${error instanceof Error ? error.message : String(error)}`,
                'filter'
            );
        }
    }

    // Check if batch mode is enabled
    const batchSize = config.map.batchSize ?? 1;
    
    if (batchSize > 1) {
        // Batch mode: process items in batches
        return executeBatchMode(config, processItems, prompts, options, filterResult);
    }

    // Standard mode: process items individually
    return executeStandardMode(config, processItems, prompts, options, filterResult);
}

/**
 * Execute pipeline in standard mode (one item per AI call)
 */
async function executeStandardMode(
    config: MapReducePipelineConfig,
    processItems: PromptItem[],
    prompts: ResolvedPrompts,
    options: ExecutePipelineOptions,
    filterResult?: FilterResult
): Promise<PipelineExecutionResult> {
    const parallelLimit = config.map.parallel ?? DEFAULT_PARALLEL_LIMIT;
    const timeoutMs = config.map.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;

    const itemProcessIds: string[] = [];
    const executorOptions: ExecutorOptions = {
        aiInvoker: options.aiInvoker,
        maxConcurrency: parallelLimit,
        reduceMode: 'deterministic',
        showProgress: true,
        retryOnFailure: false,
        processTracker: options.processTracker,
        onProgress: createPhaseTrackingProgress(options, processItems.length),
        jobName: config.name,
        timeoutMs,
        isCancelled: options.isCancelled,
        onItemComplete: (workItem, result) => {
            if (result.processId) {
                itemProcessIds.push(result.processId);
            }
            if (options.onItemProcessCreated) {
                const itemIndex = parseInt(workItem.id.replace(/\D/g, ''), 10) || 0;
                const innerSuccess = (result.output as any)?.success ?? result.success;
                const innerError = (result.output as any)?.error ?? result.error;
                try {
                    options.onItemProcessCreated({
                        itemIndex,
                        processId: result.processId || workItem.id,
                        item: workItem.data as PromptItem,
                        phase: 'map',
                        success: innerSuccess,
                        error: innerError,
                        sessionId: (result.output as any)?.sessionId,
                        rawResponse: innerSuccess ? (result.output as any)?.rawResponse : undefined,
                    });
                } catch { /* callback errors don't break execution */ }
            }
        }
    };

    const executor = createExecutor(executorOptions);

    const reduceParameters = config.input.parameters
        ? convertParametersToObject(config.input.parameters)
        : undefined;

    const job = createPromptMapJob({
        aiInvoker: options.aiInvoker,
        outputFormat: config.reduce.type,
        model: config.map.model,
        maxConcurrency: parallelLimit,
        ...(config.reduce.type === 'ai' && {
            aiReducePrompt: prompts.reducePrompt,
            aiReduceOutput: config.reduce.output,
            aiReduceModel: config.reduce.model,
            aiReduceParameters: reduceParameters
        })
    });

    const jobInput = createPromptMapInput(
        processItems,
        prompts.mapPrompt,
        config.map.output || []
    );

    try {
        const result = await executor.execute(job, jobInput);
        return { ...result, filterResult, itemProcessIds: itemProcessIds.length > 0 ? itemProcessIds : undefined };
    } catch (error) {
        emitPhase(options, 'map', 'failed', { error: error instanceof Error ? error.message : String(error) });
        throw new PipelineExecutionError(
            `Pipeline execution failed: ${error instanceof Error ? error.message : String(error)}`,
            'map'
        );
    }
}

/**
 * Parse a YAML pipeline configuration
 */
export async function parsePipelineYAML(yamlContent: string): Promise<PipelineConfig> {
    const config = yaml.load(yamlContent) as PipelineConfig;
    validatePipelineConfig(config);
    return config;
}

/**
 * Parse a YAML pipeline configuration synchronously
 */
export function parsePipelineYAMLSync(yamlContent: string): PipelineConfig {
    const config = yaml.load(yamlContent) as PipelineConfig;
    validatePipelineConfig(config);
    return config;
}