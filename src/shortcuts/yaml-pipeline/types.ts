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
 * Input configuration - currently only CSV supported
 */
export interface InputConfig {
    /** Input type - currently only 'csv' */
    type: 'csv';
    /** Path to input file (relative to workspace or absolute) */
    path: string;
    /** CSV delimiter (default: ",") */
    delimiter?: string;
}

/**
 * Map phase configuration
 */
export interface MapConfig {
    /** Prompt template with {{column}} placeholders */
    prompt: string;
    /** Output field names expected from AI */
    output: string[];
    /** Maximum concurrent AI calls (default: 5) */
    parallel?: number;
    /** Model to use for AI calls */
    model?: string;
}

/**
 * Reduce phase configuration
 */
export interface ReduceConfig {
    /** Reduce type / output format */
    type: MROutputFormat;
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
