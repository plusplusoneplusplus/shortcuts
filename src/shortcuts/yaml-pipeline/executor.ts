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
import { readCSVFile, resolveCSVPath, validateCSVHeaders } from './csv-reader';
import { extractVariables } from './template';
import {
    AIInvoker,
    PipelineConfig,
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
    /** Working directory for resolving relative paths */
    workingDirectory: string;
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

    // 1. Input Phase: Read CSV
    let items: PromptItem[];
    try {
        const csvPath = resolveCSVPath(config.input.path, options.workingDirectory);
        const csvResult = await readCSVFile(csvPath, {
            delimiter: config.input.delimiter
        });

        items = csvResult.items;

        // Validate that CSV has required template variables
        const templateVars = extractVariables(config.map.prompt);
        const validation = validateCSVHeaders(csvResult.headers, templateVars);
        if (!validation.valid) {
            throw new PipelineExecutionError(
                `CSV missing required columns: ${validation.missingColumns.join(', ')}`,
                'input'
            );
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

    const executorOptions: ExecutorOptions = {
        aiInvoker: options.aiInvoker,
        maxConcurrency: parallelLimit,
        reduceMode: 'deterministic',
        showProgress: true,
        retryOnFailure: false,
        processTracker: options.processTracker,
        onProgress: options.onProgress,
        jobName: config.name
    };

    const executor = createExecutor(executorOptions);
    const job = createPromptMapJob({
        aiInvoker: options.aiInvoker,
        outputFormat: config.reduce.type,
        model,
        maxConcurrency: parallelLimit
    });

    const jobInput = createPromptMapInput(
        items,
        config.map.prompt,
        config.map.output
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
 * Validate pipeline configuration
 */
function validatePipelineConfig(config: PipelineConfig): void {
    if (!config.name) {
        throw new PipelineExecutionError('Pipeline config missing "name"');
    }

    if (!config.input) {
        throw new PipelineExecutionError('Pipeline config missing "input"');
    }

    if (config.input.type !== 'csv') {
        throw new PipelineExecutionError(`Unsupported input type: ${config.input.type}. Only "csv" is supported.`);
    }

    if (!config.input.path) {
        throw new PipelineExecutionError('Pipeline config missing "input.path"');
    }

    if (!config.map) {
        throw new PipelineExecutionError('Pipeline config missing "map"');
    }

    if (!config.map.prompt) {
        throw new PipelineExecutionError('Pipeline config missing "map.prompt"');
    }

    if (!config.map.output || !Array.isArray(config.map.output) || config.map.output.length === 0) {
        throw new PipelineExecutionError('Pipeline config "map.output" must be a non-empty array of field names');
    }

    if (!config.reduce) {
        throw new PipelineExecutionError('Pipeline config missing "reduce"');
    }

    const validReduceTypes = ['list', 'table', 'json', 'csv'];
    if (!validReduceTypes.includes(config.reduce.type)) {
        throw new PipelineExecutionError(`Unsupported reduce type: ${config.reduce.type}. Supported types: ${validReduceTypes.join(', ')}`);
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
