/**
 * Pipeline Executor
 *
 * Executes YAML-defined pipelines: reads CSV, runs AI map phase, formats results.
 * Uses concurrency limiting for parallel AI calls.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { ConcurrencyLimiter } from '../map-reduce/concurrency-limiter';
import { readCSVFile, resolveCSVPath, validateCSVHeaders } from './csv-reader';
import { formatResultsAsList } from './list-reducer';
import { buildPromptFromTemplate, extractVariables, parseAIResponse } from './template';
import {
    PipelineConfig,
    PipelineExecutorOptions,
    PipelineItem,
    PipelineMapResult,
    PipelineProgress,
    PipelineResult,
    PipelineStats
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
 * Execute a pipeline from a configuration
 * @param config Pipeline configuration
 * @param options Execution options
 * @returns Pipeline execution result
 */
export async function executePipeline(
    config: PipelineConfig,
    options: PipelineExecutorOptions
): Promise<PipelineResult> {
    const startTime = Date.now();

    // Validate config
    validatePipelineConfig(config);

    // Report progress: loading
    reportProgress(options, {
        phase: 'loading',
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        percentage: 0,
        message: 'Loading input data...'
    });

    // 1. Input Phase: Read CSV
    let items: PipelineItem[];
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

    if (items.length === 0) {
        return createEmptyResult(config.name, startTime);
    }

    // 2. Map Phase: Process each item with AI
    const parallelLimit = config.map.parallel ?? DEFAULT_PARALLEL_LIMIT;
    const limiter = new ConcurrencyLimiter(parallelLimit);

    reportProgress(options, {
        phase: 'mapping',
        totalItems: items.length,
        completedItems: 0,
        failedItems: 0,
        percentage: 5,
        message: `Processing ${items.length} items (max ${parallelLimit} concurrent)...`
    });

    const mapStartTime = Date.now();
    let completedCount = 0;
    let failedCount = 0;

    const mapTasks = items.map((item, index) => {
        return () => processItem(
            item,
            config.map.prompt,
            config.map.output,
            options.aiInvoker
        ).then(result => {
            if (result.success) {
                completedCount++;
            } else {
                failedCount++;
            }

            // Report progress
            const progress = ((completedCount + failedCount) / items.length) * 85 + 5;
            reportProgress(options, {
                phase: 'mapping',
                totalItems: items.length,
                completedItems: completedCount,
                failedItems: failedCount,
                percentage: Math.round(progress),
                message: `Processed ${completedCount + failedCount}/${items.length} items...`
            });

            return result;
        });
    });

    let results: PipelineMapResult[];
    try {
        results = await limiter.all(mapTasks);
    } catch (error) {
        throw new PipelineExecutionError(
            `Map phase failed: ${error instanceof Error ? error.message : String(error)}`,
            'map'
        );
    }

    const mapPhaseTimeMs = Date.now() - mapStartTime;

    // 3. Reduce Phase: Format results
    reportProgress(options, {
        phase: 'reducing',
        totalItems: items.length,
        completedItems: completedCount,
        failedItems: failedCount,
        percentage: 90,
        message: 'Formatting results...'
    });

    const reduceStartTime = Date.now();

    const stats: PipelineStats = {
        totalItems: items.length,
        successfulItems: completedCount,
        failedItems: failedCount,
        totalTimeMs: 0, // Will be updated at the end
        mapPhaseTimeMs,
        reducePhaseTimeMs: 0 // Will be updated
    };

    let formattedOutput: string;
    try {
        formattedOutput = formatResultsAsList(results, stats);
    } catch (error) {
        throw new PipelineExecutionError(
            `Reduce phase failed: ${error instanceof Error ? error.message : String(error)}`,
            'reduce'
        );
    }

    const reducePhaseTimeMs = Date.now() - reduceStartTime;
    const totalTimeMs = Date.now() - startTime;

    // Update stats with final times
    stats.reducePhaseTimeMs = reducePhaseTimeMs;
    stats.totalTimeMs = totalTimeMs;

    // Report complete
    reportProgress(options, {
        phase: 'complete',
        totalItems: items.length,
        completedItems: completedCount,
        failedItems: failedCount,
        percentage: 100,
        message: `Complete: ${completedCount} succeeded, ${failedCount} failed`
    });

    return {
        name: config.name,
        success: failedCount === 0,
        results,
        formattedOutput,
        stats
    };
}

/**
 * Process a single item through the AI
 * @param item Pipeline item
 * @param promptTemplate Prompt template
 * @param outputFields Expected output fields
 * @param aiInvoker AI invoker function
 * @returns Map result
 */
async function processItem(
    item: PipelineItem,
    promptTemplate: string,
    outputFields: string[],
    aiInvoker: (prompt: string) => Promise<{ success: boolean; response?: string; error?: string }>
): Promise<PipelineMapResult> {
    try {
        // Build prompt
        const prompt = buildPromptFromTemplate(promptTemplate, item, outputFields);

        // Invoke AI
        const aiResult = await aiInvoker(prompt);

        if (!aiResult.success || !aiResult.response) {
            return {
                item,
                output: createEmptyOutput(outputFields),
                success: false,
                error: aiResult.error || 'AI invocation failed',
                rawResponse: aiResult.response
            };
        }

        // Parse response
        try {
            const output = parseAIResponse(aiResult.response, outputFields);
            return {
                item,
                output,
                success: true,
                rawResponse: aiResult.response
            };
        } catch (parseError) {
            return {
                item,
                output: createEmptyOutput(outputFields),
                success: false,
                error: `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                rawResponse: aiResult.response
            };
        }
    } catch (error) {
        return {
            item,
            output: createEmptyOutput(outputFields),
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
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
 * Create an empty result for when there are no input items
 */
function createEmptyResult(name: string, startTime: number): PipelineResult {
    const totalTimeMs = Date.now() - startTime;

    return {
        name,
        success: true,
        results: [],
        formattedOutput: '## Results (0 items)\n\nNo items to process.',
        stats: {
            totalItems: 0,
            successfulItems: 0,
            failedItems: 0,
            totalTimeMs,
            mapPhaseTimeMs: 0,
            reducePhaseTimeMs: 0
        }
    };
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

    if (config.reduce.type !== 'list') {
        throw new PipelineExecutionError(`Unsupported reduce type: ${config.reduce.type}. Only "list" is supported.`);
    }
}

/**
 * Report progress to the callback if provided
 */
function reportProgress(
    options: PipelineExecutorOptions,
    progress: PipelineProgress
): void {
    if (options.onProgress) {
        options.onProgress(progress);
    }
}

/**
 * Create a pipeline executor with bound options
 */
export function createPipelineExecutor(
    options: PipelineExecutorOptions
): (config: PipelineConfig) => Promise<PipelineResult> {
    return (config: PipelineConfig) => executePipeline(config, options);
}

/**
 * Parse a YAML pipeline configuration (utility for integrations)
 * Note: This requires js-yaml to be available (already a project dependency)
 */
export async function parsePipelineYAML(yamlContent: string): Promise<PipelineConfig> {
    // Dynamic import to avoid dependency issues in testing
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
