/**
 * YAML Pipeline Framework Types
 *
 * Core types and interfaces for the YAML-based MapReduce pipeline framework.
 * Supports CSV input, prompt templates, and list output.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

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
}

/**
 * Reduce phase configuration
 */
export interface ReduceConfig {
    /** Reduce type - currently only 'list' */
    type: 'list';
}

/**
 * A single item from CSV input (one row)
 */
export interface PipelineItem {
    /** Column values from CSV row */
    [column: string]: string;
}

/**
 * Result from AI processing a single item
 */
export interface PipelineMapResult {
    /** The original input item */
    item: PipelineItem;
    /** The AI-generated output (with declared fields) */
    output: Record<string, unknown>;
    /** Whether processing succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Raw AI response */
    rawResponse?: string;
}

/**
 * Overall pipeline execution result
 */
export interface PipelineResult {
    /** Pipeline name */
    name: string;
    /** Whether overall execution succeeded */
    success: boolean;
    /** Results from each item */
    results: PipelineMapResult[];
    /** Formatted output (from reduce phase) */
    formattedOutput: string;
    /** Execution statistics */
    stats: PipelineStats;
    /** Error message if pipeline failed */
    error?: string;
}

/**
 * Pipeline execution statistics
 */
export interface PipelineStats {
    /** Total items processed */
    totalItems: number;
    /** Successfully processed items */
    successfulItems: number;
    /** Failed items */
    failedItems: number;
    /** Total execution time in ms */
    totalTimeMs: number;
    /** Map phase time in ms */
    mapPhaseTimeMs: number;
    /** Reduce phase time in ms */
    reducePhaseTimeMs: number;
}

/**
 * Options for pipeline execution
 */
export interface PipelineExecutorOptions {
    /** AI invoker function */
    aiInvoker: AIInvoker;
    /** Working directory for resolving relative paths */
    workingDirectory: string;
    /** Progress callback */
    onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Progress information during pipeline execution
 */
export interface PipelineProgress {
    /** Current phase */
    phase: 'loading' | 'mapping' | 'reducing' | 'complete';
    /** Total items to process */
    totalItems: number;
    /** Completed items */
    completedItems: number;
    /** Failed items */
    failedItems: number;
    /** Progress percentage (0-100) */
    percentage: number;
    /** Optional message */
    message?: string;
}

/**
 * AI invoker function type
 */
export type AIInvoker = (prompt: string, options?: AIInvokerOptions) => Promise<AIInvokerResult>;

/**
 * Options for AI invocation
 */
export interface AIInvokerOptions {
    /** Model to use */
    model?: string;
    /** Timeout in ms */
    timeoutMs?: number;
}

/**
 * Result from AI invocation
 */
export interface AIInvokerResult {
    /** Whether invocation succeeded */
    success: boolean;
    /** AI response text */
    response?: string;
    /** Error message if failed */
    error?: string;
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
    items: PipelineItem[];
    /** Column headers */
    headers: string[];
    /** Number of rows (excluding header) */
    rowCount: number;
}
