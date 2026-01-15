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
    PipelineConfig,
    PipelineParameter,
    ProcessTracker
} from './types';

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
        public readonly phase?: 'input' | 'map' | 'reduce'
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
}

/**
 * Result type from pipeline execution
 */
export type PipelineExecutionResult = MapReduceResult<PromptMapResult, PromptMapOutput>;

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

    // 1. Input Phase: Load items (inline, from CSV, or from inline array)
    let items: PromptItem[];
    try {
        if (config.input.items) {
            // Direct inline items
            items = config.input.items;
        } else if (config.input.from) {
            if (isCSVSource(config.input.from)) {
                // Load from CSV file
                items = await loadFromCSV(config.input.from, options.pipelineDirectory);
            } else if (Array.isArray(config.input.from)) {
                // Inline array (useful for multi-model fanout)
                items = config.input.from;
            } else {
                throw new PipelineExecutionError('Invalid "from" configuration', 'input');
            }
        } else {
            // This should be caught by validation, but be defensive
            throw new PipelineExecutionError('Input must have either "items" or "from"', 'input');
        }

        // Apply limit
        const limit = config.input.limit ?? items.length;
        items = items.slice(0, limit);

        // Merge parameters into each item (parameters take lower precedence than item fields)
        if (config.input.parameters && config.input.parameters.length > 0) {
            const paramValues = convertParametersToObject(config.input.parameters);
            items = items.map(item => ({ ...paramValues, ...item }));
        }

        if (items.length === 0) {
            // Allow empty input - results will just be empty
            // This is consistent with the previous behavior for empty CSV
        } else {
            // Validate that items have required template variables
            const templateVars = extractVariables(config.map.prompt);
            const firstItem = items[0];
            const missingVars = templateVars.filter(v => !(v in firstItem));
            if (missingVars.length > 0) {
                throw new PipelineExecutionError(
                    `Items missing required fields: ${missingVars.join(', ')}`,
                    'input'
                );
            }
        }
    } catch (error) {
        if (error instanceof PipelineExecutionError) {
            throw error;
        }
        throw new PipelineExecutionError(
            `Failed to read input: ${error instanceof Error ? error.message : String(error)}`,
            'input'
        );
    }

    // 2. Create and execute map-reduce job
    const parallelLimit = config.map.parallel ?? DEFAULT_PARALLEL_LIMIT;
    const model = config.map.model;
    const timeoutMs = config.map.timeoutMs ?? 300000; // Default to 5 minutes

    const executorOptions: ExecutorOptions = {
        aiInvoker: options.aiInvoker,
        maxConcurrency: parallelLimit,
        reduceMode: 'deterministic',
        showProgress: true,
        retryOnFailure: false,
        processTracker: options.processTracker,
        onProgress: options.onProgress,
        jobName: config.name,
        timeoutMs
    };

    const executor = createExecutor(executorOptions);

    // Convert parameters to object for reduce phase
    const reduceParameters = config.input.parameters
        ? convertParametersToObject(config.input.parameters)
        : undefined;

    const job = createPromptMapJob({
        aiInvoker: options.aiInvoker,
        outputFormat: config.reduce.type,
        model,
        maxConcurrency: parallelLimit,
        ...(config.reduce.type === 'ai' && {
            aiReducePrompt: config.reduce.prompt,
            aiReduceOutput: config.reduce.output,
            aiReduceModel: config.reduce.model,
            aiReduceParameters: reduceParameters
        })
    });

    const jobInput = createPromptMapInput(
        items,
        config.map.prompt,
        config.map.output || []  // Empty array for text mode
    );

    try {
        return await executor.execute(job, jobInput);
    } catch (error) {
        throw new PipelineExecutionError(
            `Pipeline execution failed: ${error instanceof Error ? error.message : String(error)}`,
            'map'
        );
    }
}

/**
 * Load items from CSV file
 */
async function loadFromCSV(
    source: CSVSource,
    baseDir: string
): Promise<PromptItem[]> {
    const csvPath = resolveCSVPath(source.path, baseDir);
    const result = await readCSVFile(csvPath, {
        delimiter: source.delimiter
    });
    return result.items;
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

/**
 * Validate pipeline configuration
 */
function validatePipelineConfig(config: PipelineConfig): void {
    if (!config.name) {
        throw new PipelineExecutionError('Pipeline config missing "name"');
    }

    if (!config.input) {
        throw new PipelineExecutionError('Pipeline config missing "input"');
    }

    // Must have either items or from
    if (!config.input.items && !config.input.from) {
        throw new PipelineExecutionError('Input must have either "items" or "from"');
    }

    // Cannot have both
    if (config.input.items && config.input.from) {
        throw new PipelineExecutionError('Input cannot have both "items" and "from"');
    }

    // Validate from source if present (can be CSVSource or inline array)
    if (config.input.from) {
        if (Array.isArray(config.input.from)) {
            // Inline array - validate it's not empty or has valid items
            // Empty arrays are allowed (will produce no results)
        } else if (isCSVSource(config.input.from)) {
            // CSV source - validate path exists
            if (!config.input.from.path) {
                throw new PipelineExecutionError('Pipeline config missing "input.from.path"');
            }
        } else {
            // Unknown format - check if it looks like a malformed CSV source
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
    }

    // Validate inline items if present
    if (config.input.items) {
        if (!Array.isArray(config.input.items)) {
            throw new PipelineExecutionError('Pipeline config "input.items" must be an array');
        }
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

    if (!config.map) {
        throw new PipelineExecutionError('Pipeline config missing "map"');
    }

    if (!config.map.prompt) {
        throw new PipelineExecutionError('Pipeline config missing "map.prompt"');
    }

    // map.output is optional - if omitted, text mode is used (raw AI response)
    // If provided, must be a non-empty array
    if (config.map.output !== undefined) {
        if (!Array.isArray(config.map.output)) {
            throw new PipelineExecutionError('Pipeline config "map.output" must be an array if provided');
        }
        // Empty array is allowed - equivalent to text mode
    }

    if (!config.reduce) {
        throw new PipelineExecutionError('Pipeline config missing "reduce"');
    }

    const validReduceTypes = ['list', 'table', 'json', 'csv', 'ai', 'text'];
    if (!validReduceTypes.includes(config.reduce.type)) {
        throw new PipelineExecutionError(`Unsupported reduce type: ${config.reduce.type}. Supported types: ${validReduceTypes.join(', ')}`);
    }

    // Validate AI reduce configuration
    if (config.reduce.type === 'ai') {
        if (!config.reduce.prompt) {
            throw new PipelineExecutionError('Pipeline config "reduce.prompt" is required when reduce.type is "ai"');
        }
        // reduce.output is optional for AI reduce - if omitted, returns raw text response
        if (config.reduce.output !== undefined && !Array.isArray(config.reduce.output)) {
            throw new PipelineExecutionError('Pipeline config "reduce.output" must be an array if provided');
        }
    }
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
