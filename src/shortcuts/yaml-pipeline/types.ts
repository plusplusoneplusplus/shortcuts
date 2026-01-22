/**
 * YAML Pipeline Framework Types
 *
 * Configuration types for YAML-based pipeline definitions.
 * Execution types are re-exported from the map-reduce framework.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { OutputFormat as MROutputFormat, PromptItem as MRPromptItem } from '../map-reduce/jobs/prompt-map-job';

// Re-export execution types from map-reduce framework
export type {
    AIInvoker,
    AIInvokerOptions,
    AIInvokerResult,
    ProcessTracker,
    ExecutorOptions,
    JobProgress,
    MapReduceResult
} from '../map-reduce/types';

export type {
    PromptItem,
    PromptMapResult,
    PromptMapInput,
    PromptMapOutput,
    PromptMapSummary,
    PromptMapJobOptions,
    OutputFormat
} from '../map-reduce/jobs/prompt-map-job';

/**
 * Pipeline configuration as defined in YAML file
 */
export interface PipelineConfig {
    /** Name of the pipeline */
    name: string;
    /** Input configuration */
    input: InputConfig;
    /** Map phase configuration */
    map: MapConfig;
    /** Reduce phase configuration */
    reduce: ReduceConfig;
}

/**
 * CSV source configuration for loading items from a file
 */
export interface CSVSource {
    /** Source type - currently only 'csv' */
    type: 'csv';
    /** Path to CSV file (relative to pipeline directory or absolute) */
    path: string;
    /** CSV delimiter (default: ",") */
    delimiter?: string;
}

/**
 * Type guard to check if a value is a CSVSource
 */
export function isCSVSource(value: unknown): value is CSVSource {
    return (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        (value as CSVSource).type === 'csv' &&
        'path' in value &&
        typeof (value as CSVSource).path === 'string'
    );
}

/**
 * Parameter definition for pipeline input
 */
export interface PipelineParameter {
    /** Parameter name (used as {{name}} in templates) */
    name: string;
    /** Parameter value */
    value: string;
}

/**
 * Configuration for AI-generated inputs
 * 
 * Allows users to generate pipeline input items using AI based on a natural language prompt.
 * The AI will return items matching the specified schema.
 */
export interface GenerateInputConfig {
    /** 
     * Natural language prompt describing items to generate.
     * Include count in the prompt (e.g., "Generate 10 test cases for...")
     */
    prompt: string;
    /** 
     * Field names for each generated item.
     * These will be the keys in each generated object.
     */
    schema: string[];
    /**
     * Optional model to use for generation.
     * If not specified, uses the default model.
     */
    model?: string;
}

/**
 * Type guard to check if a value is a GenerateInputConfig
 */
export function isGenerateConfig(value: unknown): value is GenerateInputConfig {
    return (
        typeof value === 'object' &&
        value !== null &&
        'prompt' in value &&
        typeof (value as GenerateInputConfig).prompt === 'string' &&
        'schema' in value &&
        Array.isArray((value as GenerateInputConfig).schema)
    );
}

/**
 * Input configuration - supports inline items, CSV file, inline list for fanout, or AI-generated items
 * 
 * Input is always a list of items. You can either:
 * - Provide the list inline in YAML via `items`
 * - Load from CSV file via `from` (CSVSource)
 * - Provide a simple list via `from` (array) - useful for multi-model fanout
 * - Generate items using AI via `generate` (GenerateInputConfig)
 * 
 * Must have exactly one of `items`, `from`, or `generate`.
 * 
 * Optional `parameters` can define static values available to all items
 * in the map phase template (e.g., {{paramName}}).
 * 
 * Multi-model fanout example:
 * ```yaml
 * input:
 *   from:
 *     - model: gpt-4
 *     - model: claude-sonnet
 *   parameters:
 *     - name: code
 *       value: "function add(a, b) { return a + b; }"
 * ```
 * 
 * AI-generated input example:
 * ```yaml
 * input:
 *   generate:
 *     prompt: "Generate 10 test cases for user login validation"
 *     schema:
 *       - testName
 *       - input
 *       - expected
 * ```
 */
export interface InputConfig {
    /** Direct list of items (inline) */
    items?: MRPromptItem[];

    /** 
     * Load items from source:
     * - CSVSource: Load from CSV file
     * - PromptItem[]: Inline list (useful for multi-model fanout with parameters)
     */
    from?: CSVSource | MRPromptItem[];

    /** 
     * Generate items using AI based on a prompt and schema.
     * The user will be able to review and edit generated items before execution.
     */
    generate?: GenerateInputConfig;

    /** Limit number of items to process (default: all) */
    limit?: number;

    /** Static parameters available to all items in the map template */
    parameters?: PipelineParameter[];
}

/**
 * Map phase configuration
 */
export interface MapConfig {
    /** Prompt template with {{column}} placeholders */
    prompt: string;
    /** Output field names expected from AI. If omitted, text mode is used (raw AI response) */
    output?: string[];
    /** Maximum concurrent AI calls (default: 5) */
    parallel?: number;
    /** 
     * Model to use for AI calls. Supports {{variable}} template syntax for per-item models.
     * 
     * Static model example: `model: "gpt-4"`
     * Dynamic model example: `model: "{{model}}"` (reads from item's model field)
     */
    model?: string;
    /** 
     * Timeout for each AI call in milliseconds (default: 600000 = 10 minutes).
     * On timeout, the system automatically retries once with doubled timeout value.
     */
    timeoutMs?: number;
}

/**
 * Reduce phase configuration
 */
export interface ReduceConfig {
    /** Reduce type / output format (includes 'text' for pure text concatenation) */
    type: MROutputFormat;
    /** AI prompt template (required if type is 'ai') */
    prompt?: string;
    /** AI output fields. If omitted with type 'ai', returns raw AI text response */
    output?: string[];
    /** Model to use for AI reduce (optional) */
    model?: string;
}

/**
 * CSV parsing options
 */
export interface CSVParseOptions {
    /** Delimiter character (default: ",") */
    delimiter?: string;
    /** Whether first row is headers (default: true) */
    hasHeaders?: boolean;
    /** Encoding (default: "utf-8") */
    encoding?: BufferEncoding;
}

/**
 * CSV parsing result
 */
export interface CSVParseResult {
    /** Parsed items */
    items: MRPromptItem[];
    /** Column headers */
    headers: string[];
    /** Number of rows (excluding header) */
    rowCount: number;
}
