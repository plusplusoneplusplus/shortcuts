/**
 * Pipeline Executor
 *
 * Executes YAML-defined pipelines using the map-reduce framework.
 * This is a thin wrapper that converts PipelineConfig to map-reduce job execution.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    createExecutor,
    ExecutorOptions,
    MapReduceResult,
    JobProgress
} from '../map-reduce';
import {
    createPromptMapJob,
    createPromptMapInput,
    PromptItem,
    PromptMapResult,
    PromptMapOutput,
    PromptMapSummary
} from '../map-reduce/jobs/prompt-map-job';
import { readCSVFile, resolveCSVPath } from './csv-reader';
import { extractVariables } from './template';
import {
    AIInvoker,
    CSVSource,
    isCSVSource,
    isGenerateConfig,
    PipelineConfig,
    PipelineParameter,
    ProcessTracker,
    FilterResult
} from './types';
import { validateGenerateConfig } from './input-generator';
import { executeFilter } from './filter-executor';
import { resolvePromptFile } from './prompt-resolver';
import { resolveSkill } from './skill-resolver';

/**
 * Default parallel concurrency limit
 */
export const DEFAULT_PARALLEL_LIMIT = 5;

/**
 * Error thrown for pipeline execution issues
 */
export class PipelineExecutionError extends Error {
    constructor(
        message: string,
        public readonly phase?: 'input' | 'filter' | 'map' | 'reduce'
    ) {
        super(message);
        this.name = 'PipelineExecutionError';
    }
}

/**
 * Options for executing a pipeline
 */
export interface ExecutePipelineOptions {
    /** AI invoker function */
    aiInvoker: AIInvoker;
    /** 
     * Pipeline directory for resolving relative paths (package directory where pipeline.yaml lives).
     * All CSV and resource paths in the pipeline config are resolved relative to this directory.
     */
    pipelineDirectory: string;
    /**
     * Workspace root directory for resolving skills.
     * Skills are located at {workspaceRoot}/.github/skills/{name}/prompt.md.
     * If not provided, defaults to pipelineDirectory's grandparent (assuming standard .vscode/pipelines/ structure).
     */
    workspaceRoot?: string;
    /** Optional process tracker for AI process manager integration */
    processTracker?: ProcessTracker;
    /** Progress callback */
    onProgress?: (progress: JobProgress) => void;
    /** Optional cancellation check function - returns true if execution should be cancelled */
    isCancelled?: () => boolean;
}

/**
 * Result type from pipeline execution
 */
export interface PipelineExecutionResult extends MapReduceResult<PromptMapResult, PromptMapOutput> {
    /** Filter result if filter was used */
    filterResult?: FilterResult;
}

/**
 * Resolved prompts from config (either inline or from files)
 */
interface ResolvedPrompts {
    mapPrompt: string;
    reducePrompt?: string;
}

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

    // Resolve prompts (from inline, files, or skills)
    const prompts = await resolvePrompts(config, options.pipelineDirectory, options.workspaceRoot);

    // Load items from input source
    let items = await loadInputItems(config, options.pipelineDirectory);

    // Apply limit and merge parameters
    items = prepareItems(items, config, prompts.mapPrompt);

    // Execute the pipeline with resolved prompts and items
    return executeWithItems(config, items, prompts, options);
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

    // Resolve prompts (from inline, files, or skills)
    const prompts = await resolvePrompts(config, options.pipelineDirectory, options.workspaceRoot);

    // Apply limit and merge parameters to provided items
    const processItems = prepareItems(items, config, prompts.mapPrompt);

    // Execute the pipeline with resolved prompts and items
    return executeWithItems(config, processItems, prompts, options);
}

/**
 * Validate pipeline configuration for execution (without input source validation)
 * Used when executing with pre-approved items.
 */
function validatePipelineConfigForExecution(config: PipelineConfig): void {
    if (!config.name) {
        throw new PipelineExecutionError('Pipeline config missing "name"');
    }

    validateMapConfig(config);
    validateReduceConfig(config);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Derive workspace root from pipeline directory if not provided.
 * Assumes standard structure: {workspaceRoot}/.vscode/pipelines/{package}/
 */
function deriveWorkspaceRoot(pipelineDirectory: string, providedWorkspaceRoot?: string): string {
    if (providedWorkspaceRoot) {
        return providedWorkspaceRoot;
    }
    // Go up from pipeline package directory to workspace root
    // .vscode/pipelines/my-pipeline/ -> workspace root (3 levels up)
    const path = require('path');
    return path.resolve(pipelineDirectory, '..', '..', '..');
}

/**
 * Build a prompt with optional skill context prepended
 * 
 * When a skill is attached, the skill's prompt content is prepended as guidance:
 * ```
 * [Skill Guidance: {skillName}]
 * {skill prompt content}
 * 
 * [Task]
 * {main prompt}
 * ```
 */
function buildPromptWithSkill(mainPrompt: string, skillContent?: string, skillName?: string): string {
    if (!skillContent || !skillName) {
        return mainPrompt;
    }
    
    return `[Skill Guidance: ${skillName}]
${skillContent}

[Task]
${mainPrompt}`;
}

/**
 * Resolve all prompts from config (either inline or from files, with optional skill context)
 */
async function resolvePrompts(
    config: PipelineConfig,
    pipelineDirectory: string,
    workspaceRoot?: string
): Promise<ResolvedPrompts> {
    const effectiveWorkspaceRoot = deriveWorkspaceRoot(pipelineDirectory, workspaceRoot);
    
    let mapPrompt: string;
    try {
        // Resolve main prompt (either inline or from file)
        let mainMapPrompt: string;
        if (config.map.prompt) {
            mainMapPrompt = config.map.prompt;
        } else if (config.map.promptFile) {
            mainMapPrompt = await resolvePromptFile(config.map.promptFile, pipelineDirectory);
        } else {
            throw new PipelineExecutionError('Map phase must have either "prompt" or "promptFile"', 'map');
        }
        
        // Optionally load and attach skill context
        let skillContent: string | undefined;
        if (config.map.skill) {
            try {
                skillContent = await resolveSkill(config.map.skill, effectiveWorkspaceRoot);
            } catch (error) {
                throw new PipelineExecutionError(
                    `Failed to resolve map skill "${config.map.skill}": ${error instanceof Error ? error.message : String(error)}`,
                    'map'
                );
            }
        }
        
        mapPrompt = buildPromptWithSkill(mainMapPrompt, skillContent, config.map.skill);
    } catch (error) {
        if (error instanceof PipelineExecutionError) {
            throw error;
        }
        throw new PipelineExecutionError(
            `Failed to resolve map prompt: ${error instanceof Error ? error.message : String(error)}`,
            'map'
        );
    }

    let reducePrompt: string | undefined;
    if (config.reduce.type === 'ai') {
        try {
            // Resolve main reduce prompt (either inline or from file)
            let mainReducePrompt: string;
            if (config.reduce.prompt) {
                mainReducePrompt = config.reduce.prompt;
            } else if (config.reduce.promptFile) {
                mainReducePrompt = await resolvePromptFile(config.reduce.promptFile, pipelineDirectory);
            } else {
                throw new PipelineExecutionError('AI reduce must have either "prompt" or "promptFile"', 'reduce');
            }
            
            // Optionally load and attach skill context
            let skillContent: string | undefined;
            if (config.reduce.skill) {
                try {
                    skillContent = await resolveSkill(config.reduce.skill, effectiveWorkspaceRoot);
                } catch (error) {
                    throw new PipelineExecutionError(
                        `Failed to resolve reduce skill "${config.reduce.skill}": ${error instanceof Error ? error.message : String(error)}`,
                        'reduce'
                    );
                }
            }
            
            reducePrompt = buildPromptWithSkill(mainReducePrompt, skillContent, config.reduce.skill);
        } catch (error) {
            if (error instanceof PipelineExecutionError) {
                throw error;
            }
            throw new PipelineExecutionError(
                `Failed to resolve reduce prompt: ${error instanceof Error ? error.message : String(error)}`,
                'reduce'
            );
        }
    }

    return { mapPrompt, reducePrompt };
}

/**
 * Load items from input source (inline items, CSV, or inline array)
 */
async function loadInputItems(config: PipelineConfig, pipelineDirectory: string): Promise<PromptItem[]> {
    try {
        if (config.input.items) {
            return config.input.items;
        }
        
        if (config.input.from) {
            if (isCSVSource(config.input.from)) {
                const csvPath = resolveCSVPath(config.input.from.path, pipelineDirectory);
                const result = await readCSVFile(csvPath, {
                    delimiter: config.input.from.delimiter
                });
                return result.items;
            }
            
            if (Array.isArray(config.input.from)) {
                return config.input.from;
            }
            
            throw new PipelineExecutionError('Invalid "from" configuration', 'input');
        }
        
        throw new PipelineExecutionError('Input must have either "items" or "from"', 'input');
    } catch (error) {
        if (error instanceof PipelineExecutionError) {
            throw error;
        }
        throw new PipelineExecutionError(
            `Failed to read input: ${error instanceof Error ? error.message : String(error)}`,
            'input'
        );
    }
}

/**
 * Prepare items by applying limit, merging parameters, and validating template variables
 */
function prepareItems(items: PromptItem[], config: PipelineConfig, mapPrompt: string): PromptItem[] {
    // Apply limit
    const limit = config.input.limit ?? items.length;
    let result = items.slice(0, limit);

    // Merge parameters into each item (parameters take lower precedence than item fields)
    if (config.input.parameters && config.input.parameters.length > 0) {
        const paramValues = convertParametersToObject(config.input.parameters);
        result = result.map(item => ({ ...paramValues, ...item }));
    }

    // Validate that items have required template variables
    if (result.length > 0) {
        const templateVars = extractVariables(mapPrompt);
        const firstItem = result[0];
        const missingVars = templateVars.filter(v => !(v in firstItem));
        if (missingVars.length > 0) {
            throw new PipelineExecutionError(
                `Items missing required fields: ${missingVars.join(', ')}`,
                'input'
            );
        }
    }

    return result;
}

/**
 * Execute the pipeline with resolved prompts and prepared items
 * This is the core execution logic shared by both executePipeline and executePipelineWithItems
 */
async function executeWithItems(
    config: PipelineConfig,
    items: PromptItem[],
    prompts: ResolvedPrompts,
    options: ExecutePipelineOptions
): Promise<PipelineExecutionResult> {
    let processItems = items;
    
    // Filter Phase (optional): Filter items before map phase
    let filterResult: FilterResult | undefined;
    if (config.filter) {
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

            console.log(
                `Filter: ${filterResult.stats.includedCount}/${filterResult.stats.totalItems} items passed ` +
                `(${filterResult.stats.excludedCount} excluded, ${filterResult.stats.executionTimeMs}ms)`
            );

            if (processItems.length === 0) {
                console.warn('Filter excluded all items - map phase will have no work');
            }
        } catch (error) {
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
    config: PipelineConfig,
    processItems: PromptItem[],
    prompts: ResolvedPrompts,
    options: ExecutePipelineOptions,
    filterResult?: FilterResult
): Promise<PipelineExecutionResult> {
    const parallelLimit = config.map.parallel ?? DEFAULT_PARALLEL_LIMIT;
    const timeoutMs = config.map.timeoutMs ?? 600000;

    const executorOptions: ExecutorOptions = {
        aiInvoker: options.aiInvoker,
        maxConcurrency: parallelLimit,
        reduceMode: 'deterministic',
        showProgress: true,
        retryOnFailure: false,
        processTracker: options.processTracker,
        onProgress: options.onProgress,
        jobName: config.name,
        timeoutMs,
        isCancelled: options.isCancelled
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
        return { ...result, filterResult };
    } catch (error) {
        throw new PipelineExecutionError(
            `Pipeline execution failed: ${error instanceof Error ? error.message : String(error)}`,
            'map'
        );
    }
}

/**
 * Split items into batches of specified size
 */
function splitIntoBatches(items: PromptItem[], batchSize: number): PromptItem[][] {
    const batches: PromptItem[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * Execute pipeline in batch mode (multiple items per AI call)
 * 
 * In batch mode:
 * - Items are grouped into batches of `batchSize`
 * - Each batch is sent to AI as a single call with {{ITEMS}} containing the batch
 * - AI must return a JSON array with one result per input item
 * - Results are flattened back into individual PromptMapResult objects
 */
async function executeBatchMode(
    config: PipelineConfig,
    processItems: PromptItem[],
    prompts: ResolvedPrompts,
    options: ExecutePipelineOptions,
    filterResult?: FilterResult
): Promise<PipelineExecutionResult> {
    const batchSize = config.map.batchSize ?? 1;
    const parallelLimit = config.map.parallel ?? DEFAULT_PARALLEL_LIMIT;
    const timeoutMs = config.map.timeoutMs ?? 600000;
    const outputFields = config.map.output || [];
    const isTextMode = outputFields.length === 0;

    // Split items into batches
    const batches = splitIntoBatches(processItems, batchSize);
    const totalBatches = batches.length;

    // Register group process if tracker is available
    let groupId: string | undefined;
    if (options.processTracker && totalBatches > 1) {
        groupId = options.processTracker.registerGroup(`${config.name} (${totalBatches} batches)`);
    }

    // Report initial progress
    options.onProgress?.({
        phase: 'mapping',
        totalItems: totalBatches,
        completedItems: 0,
        failedItems: 0,
        percentage: 0,
        message: `Processing ${totalBatches} batches (${processItems.length} items, batch size ${batchSize})...`
    });

    // Process batches with concurrency limit
    const startTime = Date.now();
    const allResults: PromptMapResult[] = [];
    let completedBatches = 0;
    let failedBatches = 0;

    // Create a simple concurrency limiter for batch processing
    const processBatch = async (batch: PromptItem[], batchIndex: number): Promise<PromptMapResult[]> => {
        // Check for cancellation
        if (options.isCancelled?.()) {
            return batch.map(item => ({
                item,
                output: isTextMode ? {} : createEmptyOutput(outputFields),
                success: false,
                error: 'Operation cancelled'
            }));
        }

        // Register batch process
        let processId: string | undefined;
        if (options.processTracker) {
            processId = options.processTracker.registerProcess(
                `Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} items)`,
                groupId
            );
        }

        try {
            // Build the prompt with {{ITEMS}} containing the batch
            const batchPrompt = buildBatchPrompt(prompts.mapPrompt, batch, outputFields);
            
            // Resolve model (use first item for template substitution if model is templated)
            let model: string | undefined;
            if (config.map.model && typeof config.map.model === 'string') {
                // For batch mode, use the first item for model template substitution
                const substitutedModel = config.map.model.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
                    return varName in batch[0] ? batch[0][varName] : '';
                });
                model = substitutedModel || undefined;
            }

            // Call AI with timeout
            const aiResult = await Promise.race([
                options.aiInvoker(batchPrompt, { model }),
                createTimeoutPromise(timeoutMs, batchIndex, totalBatches)
            ]);

            if (!aiResult.success || !aiResult.response) {
                // AI call failed - mark all items in batch as failed
                if (options.processTracker && processId) {
                    options.processTracker.updateProcess(processId, 'failed', undefined, aiResult.error || 'AI invocation failed');
                }
                return batch.map(item => ({
                    item,
                    output: isTextMode ? {} : createEmptyOutput(outputFields),
                    success: false,
                    error: aiResult.error || 'AI invocation failed',
                    rawResponse: aiResult.response,
                    sessionId: aiResult.sessionId
                }));
            }

            // Parse batch response
            const batchResults = parseBatchResponse(
                aiResult.response,
                batch,
                outputFields,
                isTextMode,
                aiResult.sessionId
            );

            // Update process status
            if (options.processTracker && processId) {
                const successCount = batchResults.filter(r => r.success).length;
                options.processTracker.updateProcess(
                    processId,
                    'completed',
                    `${successCount}/${batch.length} items succeeded`,
                    undefined,
                    JSON.stringify(batchResults.map(r => r.output))
                );
            }

            return batchResults;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            // Check if it's a timeout - retry with doubled timeout
            if (errorMsg.includes('timed out')) {
                try {
                    const batchPrompt = buildBatchPrompt(prompts.mapPrompt, batch, outputFields);
                    let model: string | undefined;
                    if (config.map.model && typeof config.map.model === 'string') {
                        const substitutedModel = config.map.model.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
                            return varName in batch[0] ? batch[0][varName] : '';
                        });
                        model = substitutedModel || undefined;
                    }

                    const aiResult = await Promise.race([
                        options.aiInvoker(batchPrompt, { model }),
                        createTimeoutPromise(timeoutMs * 2, batchIndex, totalBatches)
                    ]);

                    if (aiResult.success && aiResult.response) {
                        const batchResults = parseBatchResponse(
                            aiResult.response,
                            batch,
                            outputFields,
                            isTextMode,
                            aiResult.sessionId
                        );

                        if (options.processTracker && processId) {
                            const successCount = batchResults.filter(r => r.success).length;
                            options.processTracker.updateProcess(
                                processId,
                                'completed',
                                `${successCount}/${batch.length} items succeeded (after retry)`,
                                undefined,
                                JSON.stringify(batchResults.map(r => r.output))
                            );
                        }

                        return batchResults;
                    }
                } catch (retryError) {
                    // Retry also failed
                }
            }

            // Mark all items in batch as failed
            if (options.processTracker && processId) {
                options.processTracker.updateProcess(processId, 'failed', undefined, errorMsg);
            }
            return batch.map(item => ({
                item,
                output: isTextMode ? {} : createEmptyOutput(outputFields),
                success: false,
                error: errorMsg
            }));
        }
    };

    // Process batches with concurrency limit
    const batchPromises: Promise<PromptMapResult[]>[] = [];
    const activeBatches: Promise<void>[] = [];

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        // Wait if we've reached the concurrency limit
        if (activeBatches.length >= parallelLimit) {
            await Promise.race(activeBatches);
        }

        const batchPromise = processBatch(batch, i).then(results => {
            allResults.push(...results);
            
            // Update progress
            const hasFailures = results.some(r => !r.success);
            if (hasFailures) {
                failedBatches++;
            } else {
                completedBatches++;
            }

            options.onProgress?.({
                phase: 'mapping',
                totalItems: totalBatches,
                completedItems: completedBatches,
                failedItems: failedBatches,
                percentage: Math.round(((completedBatches + failedBatches) / totalBatches) * 85),
                message: `Processing batch ${completedBatches + failedBatches}/${totalBatches}...`
            });

            return results;
        });

        batchPromises.push(batchPromise);
        
        // Track active batch for concurrency limiting
        const activePromise = batchPromise.then(() => {
            const index = activeBatches.indexOf(activePromise);
            if (index > -1) {
                activeBatches.splice(index, 1);
            }
        });
        activeBatches.push(activePromise);
    }

    // Wait for all batches to complete
    await Promise.all(batchPromises);

    const mapPhaseTimeMs = Date.now() - startTime;

    // Calculate statistics
    const successfulMaps = allResults.filter(r => r.success).length;
    const failedMaps = allResults.filter(r => !r.success).length;

    // Report map complete
    options.onProgress?.({
        phase: 'reducing',
        totalItems: processItems.length,
        completedItems: successfulMaps,
        failedItems: failedMaps,
        percentage: 90,
        message: 'Aggregating results...'
    });

    // Execute reduce phase
    const reduceStartTime = Date.now();
    const reduceParameters = config.input.parameters
        ? convertParametersToObject(config.input.parameters)
        : undefined;

    const reduceResult = await executeReducePhase(
        allResults,
        config,
        prompts,
        options,
        reduceParameters,
        groupId
    );

    const reducePhaseTimeMs = Date.now() - reduceStartTime;
    const totalTimeMs = Date.now() - startTime;

    // Build execution stats
    const executionStats = {
        totalItems: processItems.length,
        successfulMaps,
        failedMaps,
        mapPhaseTimeMs,
        reducePhaseTimeMs,
        maxConcurrency: parallelLimit
    };

    // Complete group process if registered
    if (options.processTracker && groupId) {
        options.processTracker.completeGroup(
            groupId,
            `Completed: ${successfulMaps}/${processItems.length} items processed in ${totalBatches} batches`,
            executionStats
        );
    }

    // Report complete
    options.onProgress?.({
        phase: 'complete',
        totalItems: processItems.length,
        completedItems: successfulMaps,
        failedItems: failedMaps,
        percentage: 100,
        message: `Complete: ${successfulMaps} succeeded, ${failedMaps} failed (${totalBatches} batches)`
    });

    // Build map results for compatibility with existing result structure
    const mapResults = allResults.map(r => ({
        workItemId: `item-${allResults.indexOf(r)}`,
        success: r.success,
        output: r,
        error: r.error,
        executionTimeMs: 0 // Not tracked per-item in batch mode
    }));

    const overallSuccess = failedMaps === 0;
    const result: PipelineExecutionResult = {
        success: overallSuccess,
        output: reduceResult,
        mapResults,
        reduceStats: {
            inputCount: allResults.length,
            outputCount: reduceResult ? 1 : 0,
            mergedCount: successfulMaps,
            reduceTimeMs: reducePhaseTimeMs,
            usedAIReduce: config.reduce.type === 'ai'
        },
        totalTimeMs,
        executionStats,
        filterResult
    };

    if (!overallSuccess) {
        const failedResults = allResults.filter(r => !r.success);
        if (failedResults.length === 1) {
            result.error = `1 item failed: ${failedResults[0].error || 'Unknown error'}`;
        } else {
            const uniqueErrors = [...new Set(failedResults.map(r => r.error || 'Unknown error'))];
            if (uniqueErrors.length === 1) {
                result.error = `${failedResults.length} items failed: ${uniqueErrors[0]}`;
            } else {
                result.error = `${failedResults.length} items failed with ${uniqueErrors.length} different errors`;
            }
        }
    }

    return result;
}

/**
 * Build the prompt for a batch, substituting {{ITEMS}} with the batch JSON
 * and other template variables from the first item (for parameters)
 */
function buildBatchPrompt(promptTemplate: string, batch: PromptItem[], outputFields: string[]): string {
    // Replace {{ITEMS}} with the batch JSON
    const batchJson = JSON.stringify(batch, null, 2);
    let prompt = promptTemplate.replace(/\{\{ITEMS\}\}/g, batchJson);
    
    // Substitute other template variables from the first item
    // This allows parameters (which are merged into all items) to be used in the prompt
    if (batch.length > 0) {
        const firstItem = batch[0];
        prompt = prompt.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
            // Skip special variables that are handled elsewhere
            if (['ITEMS', 'RESULTS', 'RESULTS_FILE', 'COUNT', 'SUCCESS_COUNT', 'FAILURE_COUNT'].includes(varName)) {
                return match;
            }
            return varName in firstItem ? firstItem[varName] : match;
        });
    }
    
    // Add output instruction if we have output fields
    if (outputFields.length > 0) {
        prompt += `\n\nReturn a JSON array with ${batch.length} objects, one for each input item. Each object must have these fields: ${outputFields.join(', ')}`;
    }
    
    return prompt;
}

/**
 * Create an empty output object with null values for all fields
 */
function createEmptyOutput(fields: string[]): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const field of fields) {
        output[field] = null;
    }
    return output;
}

/**
 * Create a timeout promise for batch processing
 */
function createTimeoutPromise(timeoutMs: number, batchIndex: number, totalBatches: number): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Batch ${batchIndex + 1}/${totalBatches} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
}

/**
 * Parse the AI response for a batch
 * 
 * Expected response format:
 * - JSON array with one object per input item
 * - Each object contains the output fields
 * 
 * If the response count doesn't match the batch size, all items are marked as failed.
 */
function parseBatchResponse(
    response: string,
    batch: PromptItem[],
    outputFields: string[],
    isTextMode: boolean,
    sessionId?: string
): PromptMapResult[] {
    // Text mode - not supported for batch processing
    if (isTextMode) {
        return batch.map(item => ({
            item,
            output: {},
            rawText: response,
            success: true,
            rawResponse: response,
            sessionId
        }));
    }

    try {
        // Extract JSON array from response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error('Response does not contain a JSON array');
        }

        const parsed = JSON.parse(jsonMatch[0]);
        
        if (!Array.isArray(parsed)) {
            throw new Error('Parsed response is not an array');
        }

        // Validate count matches
        if (parsed.length !== batch.length) {
            const errorMsg = `AI returned ${parsed.length} results but batch has ${batch.length} items`;
            return batch.map(item => ({
                item,
                output: createEmptyOutput(outputFields),
                success: false,
                error: errorMsg,
                rawResponse: response,
                sessionId
            }));
        }

        // Map results to items
        return batch.map((item, index) => {
            const resultObj = parsed[index];
            
            if (typeof resultObj !== 'object' || resultObj === null) {
                return {
                    item,
                    output: createEmptyOutput(outputFields),
                    success: false,
                    error: `Result at index ${index} is not an object`,
                    rawResponse: response,
                    sessionId
                };
            }

            // Extract only the declared output fields
            const output: Record<string, unknown> = {};
            for (const field of outputFields) {
                output[field] = field in resultObj ? resultObj[field] : null;
            }

            return {
                item,
                output,
                success: true,
                rawResponse: response,
                sessionId
            };
        });
    } catch (error) {
        const errorMsg = `Failed to parse batch response: ${error instanceof Error ? error.message : String(error)}`;
        return batch.map(item => ({
            item,
            output: createEmptyOutput(outputFields),
            success: false,
            error: errorMsg,
            rawResponse: response,
            sessionId
        }));
    }
}

/**
 * Execute the reduce phase for batch mode results
 */
async function executeReducePhase(
    results: PromptMapResult[],
    config: PipelineConfig,
    prompts: ResolvedPrompts,
    options: ExecutePipelineOptions,
    reduceParameters?: Record<string, string>,
    parentGroupId?: string
): Promise<PromptMapOutput> {
    const outputFields = config.map.output || [];
    const successfulItems = results.filter(r => r.success).length;
    const failedItems = results.filter(r => !r.success).length;

    const summary: PromptMapSummary = {
        totalItems: results.length,
        successfulItems,
        failedItems,
        outputFields
    };

    // Handle AI reduce
    if (config.reduce.type === 'ai' && prompts.reducePrompt) {
        return await performAIReduce(
            results,
            summary,
            prompts.reducePrompt,
            config.reduce.output,
            config.reduce.model,
            reduceParameters,
            options,
            parentGroupId
        );
    }

    // Handle deterministic reduce
    const formattedOutput = formatResults(results, summary, config.reduce.type);

    return {
        results,
        formattedOutput,
        summary
    };
}

/**
 * Perform AI-powered reduce for batch mode
 */
async function performAIReduce(
    results: PromptMapResult[],
    summary: PromptMapSummary,
    reducePrompt: string,
    reduceOutput?: string[],
    reduceModel?: string,
    reduceParameters?: Record<string, string>,
    options?: ExecutePipelineOptions,
    parentGroupId?: string
): Promise<PromptMapOutput> {
    const isTextMode = !reduceOutput || reduceOutput.length === 0;

    // Register reduce process
    let reduceProcessId: string | undefined;
    if (options?.processTracker) {
        reduceProcessId = options.processTracker.registerProcess(
            'AI Reduce: Synthesizing results',
            parentGroupId
        );
    }

    // Build prompt with template substitution
    const successfulResults = results.filter(r => r.success);
    const resultsForPrompt = successfulResults.map(r => r.rawText !== undefined ? r.rawText : r.output);
    const resultsString = JSON.stringify(resultsForPrompt, null, 2);

    let prompt = reducePrompt
        .replace(/\{\{RESULTS\}\}/g, resultsString)
        .replace(/\{\{COUNT\}\}/g, String(summary.totalItems))
        .replace(/\{\{SUCCESS_COUNT\}\}/g, String(summary.successfulItems))
        .replace(/\{\{FAILURE_COUNT\}\}/g, String(summary.failedItems));

    // Substitute input parameters
    if (reduceParameters) {
        for (const [key, value] of Object.entries(reduceParameters)) {
            prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
    }

    // Add output instruction if not text mode
    if (!isTextMode) {
        prompt += `\n\nReturn JSON with these fields: ${reduceOutput!.join(', ')}`;
    }

    // Call AI
    const aiResult = await options?.aiInvoker(prompt, { model: reduceModel });

    if (!aiResult?.success || !aiResult.response) {
        if (options?.processTracker && reduceProcessId) {
            options.processTracker.updateProcess(
                reduceProcessId,
                'failed',
                undefined,
                aiResult?.error || 'Unknown error'
            );
        }
        throw new PipelineExecutionError(
            `AI reduce failed: ${aiResult?.error || 'Unknown error'}`,
            'reduce'
        );
    }

    // Text mode - return raw response
    if (isTextMode) {
        if (options?.processTracker && reduceProcessId) {
            options.processTracker.updateProcess(
                reduceProcessId,
                'completed',
                aiResult.response
            );
        }
        return {
            results,
            formattedOutput: aiResult.response,
            summary: { ...summary, outputFields: [] }
        };
    }

    // Parse structured response
    try {
        const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Response does not contain JSON object');
        }
        const parsed = JSON.parse(jsonMatch[0]);
        const formattedOutput = JSON.stringify(parsed, null, 2);

        if (options?.processTracker && reduceProcessId) {
            options.processTracker.updateProcess(
                reduceProcessId,
                'completed',
                formattedOutput,
                undefined,
                JSON.stringify(parsed)
            );
        }

        return {
            results,
            formattedOutput,
            summary: { ...summary, outputFields: reduceOutput! }
        };
    } catch (error) {
        if (options?.processTracker && reduceProcessId) {
            options.processTracker.updateProcess(
                reduceProcessId,
                'failed',
                undefined,
                error instanceof Error ? error.message : String(error)
            );
        }
        throw new PipelineExecutionError(
            `Failed to parse AI reduce response: ${error instanceof Error ? error.message : String(error)}`,
            'reduce'
        );
    }
}

/**
 * Format results based on reduce type
 */
function formatResults(
    results: PromptMapResult[],
    summary: PromptMapSummary,
    reduceType: string
): string {
    switch (reduceType) {
        case 'table':
            return formatAsTable(results);
        case 'json':
            return formatAsJSON(results);
        case 'csv':
            return formatAsCSV(results);
        case 'text':
            return formatAsText(results);
        default:
            return formatAsList(results, summary);
    }
}

// Formatting utilities for batch mode reduce
function formatAsList(results: PromptMapResult[], summary: PromptMapSummary): string {
    const lines: string[] = [`## Results (${summary.totalItems} items)`, ''];
    if (summary.failedItems > 0) {
        lines.push(`**Warning: ${summary.failedItems} items failed**`, '');
    }

    results.forEach((r, i) => {
        lines.push(`### Item ${i + 1}`);
        const inputStr = Object.entries(r.item).map(([k, v]) => `${k}=${truncate(v, 30)}`).join(', ');
        lines.push(`**Input:** ${inputStr}`);
        if (r.success) {
            const outputStr = Object.entries(r.output).map(([k, v]) => `${k}=${formatValue(v)}`).join(', ');
            lines.push(`**Output:** ${outputStr}`);
        } else {
            lines.push(`**Error:** ${r.error || 'Unknown error'}`);
        }
        lines.push('');
    });

    lines.push('---', `**Stats:** ${summary.successfulItems} succeeded, ${summary.failedItems} failed`);
    return lines.join('\n');
}

function formatAsTable(results: PromptMapResult[]): string {
    if (results.length === 0) return 'No results to display.';

    const inKeys = [...new Set(results.flatMap(r => Object.keys(r.item)))];
    const outKeys = [...new Set(results.flatMap(r => Object.keys(r.output)))];
    const headers = ['#', ...inKeys.map(k => `[in] ${k}`), ...outKeys.map(k => `[out] ${k}`), 'Status'];

    const lines = [
        '| ' + headers.join(' | ') + ' |',
        '| ' + headers.map(() => '---').join(' | ') + ' |'
    ];

    results.forEach((r, i) => {
        const cells = [
            String(i + 1),
            ...inKeys.map(k => truncate(r.item[k] ?? '', 20)),
            ...outKeys.map(k => formatValue(r.output[k])),
            r.success ? 'OK' : 'FAIL'
        ];
        lines.push('| ' + cells.join(' | ') + ' |');
    });

    return lines.join('\n');
}

function formatAsJSON(results: PromptMapResult[]): string {
    return JSON.stringify(results.map(r => ({
        input: r.item,
        output: r.output,
        success: r.success,
        ...(r.error && { error: r.error })
    })), null, 2);
}

function formatAsCSV(results: PromptMapResult[]): string {
    if (results.length === 0) return '';

    const inKeys = [...new Set(results.flatMap(r => Object.keys(r.item)))];
    const outKeys = [...new Set(results.flatMap(r => Object.keys(r.output)))];
    const headers = [...inKeys, ...outKeys.map(k => `out_${k}`), 'success'];

    const lines = [headers.join(',')];
    for (const r of results) {
        const values = [
            ...inKeys.map(k => escapeCSV(r.item[k] ?? '')),
            ...outKeys.map(k => escapeCSV(formatValue(r.output[k]))),
            r.success ? 'true' : 'false'
        ];
        lines.push(values.join(','));
    }
    return lines.join('\n');
}

function formatAsText(results: PromptMapResult[]): string {
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length === 0) {
        return 'No successful results.';
    }

    if (successfulResults.length === 1) {
        const r = successfulResults[0];
        return r.rawText || JSON.stringify(r.output, null, 2);
    }

    return successfulResults
        .map((r, i) => {
            const text = r.rawText || JSON.stringify(r.output, null, 2);
            return `--- Item ${i + 1} ---\n${text}`;
        })
        .join('\n\n');
}

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return value.length > 50 ? value.substring(0, 47) + '...' : value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function truncate(value: string, max: number = 30): string {
    return value.length <= max ? value : value.substring(0, max - 3) + '...';
}

function escapeCSV(value: string): string {
    return (value.includes(',') || value.includes('"') || value.includes('\n'))
        ? `"${value.replace(/"/g, '""')}"`
        : value;
}

/**
 * Convert parameters array to object for merging with items
 */
function convertParametersToObject(parameters: PipelineParameter[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const param of parameters) {
        result[param.name] = param.value;
    }
    return result;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate map configuration (prompt/promptFile and optional skill)
 */
function validateMapConfig(config: PipelineConfig): void {
    if (!config.map) {
        throw new PipelineExecutionError('Pipeline config missing "map"');
    }

    // Validate prompt configuration (must have exactly one of prompt or promptFile)
    const hasPrompt = !!config.map.prompt;
    const hasPromptFile = !!config.map.promptFile;
    
    if (!hasPrompt && !hasPromptFile) {
        throw new PipelineExecutionError('Pipeline config must have either "map.prompt" or "map.promptFile"');
    }
    if (hasPrompt && hasPromptFile) {
        throw new PipelineExecutionError('Pipeline config cannot have both "map.prompt" and "map.promptFile"');
    }

    // Validate skill name if provided (skill is optional and can be combined with prompt/promptFile)
    if (config.map.skill !== undefined && typeof config.map.skill !== 'string') {
        throw new PipelineExecutionError('Pipeline config "map.skill" must be a string');
    }

    // map.output is optional - if omitted, text mode is used
    if (config.map.output !== undefined && !Array.isArray(config.map.output)) {
        throw new PipelineExecutionError('Pipeline config "map.output" must be an array if provided');
    }

    // Validate batchSize if provided
    if (config.map.batchSize !== undefined) {
        if (typeof config.map.batchSize !== 'number' || !Number.isInteger(config.map.batchSize)) {
            throw new PipelineExecutionError('Pipeline config "map.batchSize" must be a positive integer');
        }
        if (config.map.batchSize < 1) {
            throw new PipelineExecutionError('Pipeline config "map.batchSize" must be at least 1');
        }
        // When batchSize > 1, prompt should contain {{ITEMS}}
        if (config.map.batchSize > 1) {
            const prompt = config.map.prompt || '';
            if (!prompt.includes('{{ITEMS}}')) {
                console.warn('Warning: batchSize > 1 but prompt does not contain {{ITEMS}}. Consider using {{ITEMS}} to access batch items.');
            }
        }
    }
}

/**
 * Validate reduce configuration
 */
function validateReduceConfig(config: PipelineConfig): void {
    if (!config.reduce) {
        throw new PipelineExecutionError('Pipeline config missing "reduce"');
    }

    const validReduceTypes = ['list', 'table', 'json', 'csv', 'ai', 'text'];
    if (!validReduceTypes.includes(config.reduce.type)) {
        throw new PipelineExecutionError(
            `Unsupported reduce type: ${config.reduce.type}. Supported types: ${validReduceTypes.join(', ')}`
        );
    }

    // Validate AI reduce configuration
    if (config.reduce.type === 'ai') {
        const hasPrompt = !!config.reduce.prompt;
        const hasPromptFile = !!config.reduce.promptFile;
        
        if (!hasPrompt && !hasPromptFile) {
            throw new PipelineExecutionError(
                'Pipeline config must have either "reduce.prompt" or "reduce.promptFile" when reduce.type is "ai"'
            );
        }
        if (hasPrompt && hasPromptFile) {
            throw new PipelineExecutionError('Pipeline config cannot have both "reduce.prompt" and "reduce.promptFile"');
        }
        
        // Validate skill name if provided (skill is optional and can be combined with prompt/promptFile)
        if (config.reduce.skill !== undefined && typeof config.reduce.skill !== 'string') {
            throw new PipelineExecutionError('Pipeline config "reduce.skill" must be a string');
        }
        
        if (config.reduce.output !== undefined && !Array.isArray(config.reduce.output)) {
            throw new PipelineExecutionError('Pipeline config "reduce.output" must be an array if provided');
        }
    }
}

/**
 * Validate input configuration
 */
function validateInputConfig(config: PipelineConfig): void {
    if (!config.input) {
        throw new PipelineExecutionError('Pipeline config missing "input"');
    }

    // Count how many input sources are specified
    const hasItems = !!config.input.items;
    const hasFrom = !!config.input.from;
    const hasGenerate = !!config.input.generate;
    const sourceCount = [hasItems, hasFrom, hasGenerate].filter(Boolean).length;

    if (sourceCount === 0) {
        throw new PipelineExecutionError('Input must have one of "items", "from", or "generate"');
    }
    if (sourceCount > 1) {
        throw new PipelineExecutionError('Input can only have one of "items", "from", or "generate"');
    }

    // Validate generate config if present
    if (hasGenerate) {
        if (!isGenerateConfig(config.input.generate)) {
            throw new PipelineExecutionError('Invalid generate configuration');
        }
        const validation = validateGenerateConfig(config.input.generate);
        if (!validation.valid) {
            throw new PipelineExecutionError(
                `Invalid generate configuration: ${validation.errors.join('; ')}`
            );
        }
        throw new PipelineExecutionError(
            'Pipelines with "generate" input require interactive approval. Use the Pipeline Preview to generate and approve items first.',
            'input'
        );
    }

    // Validate from source if present
    if (config.input.from) {
        if (!Array.isArray(config.input.from) && !isCSVSource(config.input.from)) {
            const fromObj = config.input.from as Record<string, unknown>;
            if (fromObj.type && fromObj.type !== 'csv') {
                throw new PipelineExecutionError(
                    `Unsupported source type: ${fromObj.type}. Only "csv" is supported.`
                );
            }
            throw new PipelineExecutionError(
                'Invalid "from" configuration. Must be either a CSV source {type: "csv", path: "..."} or an inline array.'
            );
        }
        if (isCSVSource(config.input.from) && !config.input.from.path) {
            throw new PipelineExecutionError('Pipeline config missing "input.from.path"');
        }
    }

    // Validate inline items if present
    if (config.input.items && !Array.isArray(config.input.items)) {
        throw new PipelineExecutionError('Pipeline config "input.items" must be an array');
    }

    // Validate parameters if present
    if (config.input.parameters) {
        if (!Array.isArray(config.input.parameters)) {
            throw new PipelineExecutionError('Pipeline config "input.parameters" must be an array');
        }
        for (const param of config.input.parameters) {
            if (!param.name || typeof param.name !== 'string') {
                throw new PipelineExecutionError('Each parameter must have a "name" string');
            }
            if (param.value === undefined || param.value === null) {
                throw new PipelineExecutionError(`Parameter "${param.name}" must have a "value"`);
            }
        }
    }
}

/**
 * Validate full pipeline configuration (including input)
 */
function validatePipelineConfig(config: PipelineConfig): void {
    if (!config.name) {
        throw new PipelineExecutionError('Pipeline config missing "name"');
    }

    validateInputConfig(config);
    validateMapConfig(config);
    validateReduceConfig(config);
}

/**
 * Parse a YAML pipeline configuration
 */
export async function parsePipelineYAML(yamlContent: string): Promise<PipelineConfig> {
    const yaml = await import('js-yaml');
    const config = yaml.load(yamlContent) as PipelineConfig;
    validatePipelineConfig(config);
    return config;
}

/**
 * Parse a YAML pipeline configuration synchronously
 */
export function parsePipelineYAMLSync(yamlContent: string): PipelineConfig {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require('js-yaml');
    const config = yaml.load(yamlContent) as PipelineConfig;
    validatePipelineConfig(config);
    return config;
}
