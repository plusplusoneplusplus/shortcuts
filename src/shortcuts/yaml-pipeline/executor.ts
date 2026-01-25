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
    PromptMapOutput
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

    // Resolve prompts (from inline or files)
    const prompts = await resolvePrompts(config, options.pipelineDirectory);

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

    // Resolve prompts (from inline or files)
    const prompts = await resolvePrompts(config, options.pipelineDirectory);

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
 * Resolve all prompts from config (either inline or from files)
 */
async function resolvePrompts(config: PipelineConfig, pipelineDirectory: string): Promise<ResolvedPrompts> {
    let mapPrompt: string;
    try {
        if (config.map.prompt) {
            mapPrompt = config.map.prompt;
        } else if (config.map.promptFile) {
            mapPrompt = await resolvePromptFile(config.map.promptFile, pipelineDirectory);
        } else {
            throw new PipelineExecutionError('Map phase must have either "prompt" or "promptFile"', 'map');
        }
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
            if (config.reduce.prompt) {
                reducePrompt = config.reduce.prompt;
            } else if (config.reduce.promptFile) {
                reducePrompt = await resolvePromptFile(config.reduce.promptFile, pipelineDirectory);
            } else {
                throw new PipelineExecutionError('AI reduce must have either "prompt" or "promptFile"', 'reduce');
            }
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

    // Create and execute map-reduce job
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
 * Validate map configuration (prompt/promptFile and output)
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

    // map.output is optional - if omitted, text mode is used
    if (config.map.output !== undefined && !Array.isArray(config.map.output)) {
        throw new PipelineExecutionError('Pipeline config "map.output" must be an array if provided');
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
