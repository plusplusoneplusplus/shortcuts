/**
 * Map-Reduce Framework Types
 *
 * Core types and interfaces for the map-reduce AI workflow framework.
 * Provides a reusable execution pipeline for AI map-reduce jobs with support
 * for pluggable splitters, mappers, reducers, and prompt templates.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

/**
 * A single work item to be processed by the mapper
 */
export interface WorkItem<TInput> {
    /** Unique identifier for this work item */
    id: string;
    /** The input data for this work item */
    data: TInput;
    /** Optional metadata about this work item */
    metadata?: Record<string, unknown>;
}

/**
 * Context provided to mapper functions during execution
 */
export interface MapContext {
    /** Unique ID for this map execution */
    executionId: string;
    /** Total number of work items being processed */
    totalItems: number;
    /** Index of this item (0-based) */
    itemIndex: number;
    /** Optional parent group ID for process tracking */
    parentGroupId?: string;
    /** Cancellation token (if supported) */
    isCancelled?: () => boolean;
}

/**
 * Result from a single map operation
 */
export interface MapResult<TMapOutput> {
    /** Work item ID this result corresponds to */
    workItemId: string;
    /** Whether the map operation succeeded */
    success: boolean;
    /** The output from the mapper (if successful) */
    output?: TMapOutput;
    /** Error message (if failed) */
    error?: string;
    /** Time taken for this map operation in ms */
    executionTimeMs: number;
    /** Optional process ID for tracking */
    processId?: string;
}

/**
 * Context provided to reducer functions during execution
 */
export interface ReduceContext {
    /** Unique ID for this reduce execution */
    executionId: string;
    /** Total execution time of map phase in ms */
    mapPhaseTimeMs: number;
    /** Number of successful map operations */
    successfulMaps: number;
    /** Number of failed map operations */
    failedMaps: number;
    /** Optional custom context data */
    customContext?: Record<string, unknown>;
    /** Optional process tracker for AI reduce tracking */
    processTracker?: ProcessTracker;
    /** Optional parent group ID for process tracking */
    parentGroupId?: string;
}

/**
 * Result from the reduce operation
 */
export interface ReduceResult<TReduceOutput> {
    /** The final output from the reducer */
    output: TReduceOutput;
    /** Statistics about the reduce operation */
    stats: ReduceStats;
}

/**
 * Statistics about the reduce phase
 */
export interface ReduceStats {
    /** Number of inputs before deduplication/reduction */
    inputCount: number;
    /** Number of outputs after reduction */
    outputCount: number;
    /** Number of items merged/deduplicated */
    mergedCount: number;
    /** Time taken for reduce phase in ms */
    reduceTimeMs: number;
    /** Whether AI-powered reduce was used */
    usedAIReduce: boolean;
}

/**
 * Mode for the reduce phase
 */
export type ReduceMode = 'deterministic' | 'ai' | 'hybrid';

/**
 * Options for map-reduce job execution
 */
export interface MapReduceOptions {
    /** Maximum number of concurrent map operations (default: 5) */
    maxConcurrency: number;
    /** Mode for the reduce phase (default: 'deterministic') */
    reduceMode: ReduceMode;
    /** Whether to show progress updates (default: true) */
    showProgress: boolean;
    /** Whether to retry failed map operations (default: false) */
    retryOnFailure: boolean;
    /** Number of retry attempts for failed operations (default: 1) */
    retryAttempts?: number;
    /** 
     * Timeout for each map operation in ms (default: 600000 = 10 minutes).
     * On timeout, the system automatically retries once with doubled timeout value.
     */
    timeoutMs?: number;
    /** Optional job name for display/logging */
    jobName?: string;
}

/**
 * Default options for map-reduce execution
 */
export const DEFAULT_MAP_REDUCE_OPTIONS: MapReduceOptions = {
    maxConcurrency: 5,
    reduceMode: 'deterministic',
    showProgress: true,
    retryOnFailure: false,
    retryAttempts: 1,
    timeoutMs: 600000 // 10 minutes
};

/**
 * Interface for a splitter that divides input into work items
 */
export interface Splitter<TInput, TWorkItemData> {
    /**
     * Split the input into work items
     * @param input The input to split
     * @returns Array of work items
     */
    split(input: TInput): WorkItem<TWorkItemData>[];
}

/**
 * Interface for a mapper that processes individual work items
 */
export interface Mapper<TWorkItemData, TMapOutput> {
    /**
     * Process a single work item
     * @param item The work item to process
     * @param context Context for the map operation
     * @returns Promise resolving to the map output
     */
    map(item: WorkItem<TWorkItemData>, context: MapContext): Promise<TMapOutput>;
}

/**
 * Interface for a reducer that aggregates map outputs
 */
export interface Reducer<TMapOutput, TReduceOutput> {
    /**
     * Reduce multiple map outputs into a single result
     * @param results Array of map results
     * @param context Context for the reduce operation
     * @returns Promise resolving to the reduce result
     */
    reduce(
        results: MapResult<TMapOutput>[],
        context: ReduceContext
    ): Promise<ReduceResult<TReduceOutput>>;
}

/**
 * Interface for a complete map-reduce job
 */
export interface MapReduceJob<TInput, TWorkItemData, TMapOutput, TReduceOutput> {
    /** Unique identifier for this job type */
    id: string;
    /** Display name for the job */
    name: string;
    /** Splitter that divides input into work items */
    splitter: Splitter<TInput, TWorkItemData>;
    /** Mapper that processes individual work items */
    mapper: Mapper<TWorkItemData, TMapOutput>;
    /** Reducer that aggregates map outputs */
    reducer: Reducer<TMapOutput, TReduceOutput>;
    /** Optional prompt template for map operations */
    promptTemplate?: PromptTemplate;
    /** Job-specific options (merged with defaults) */
    options?: Partial<MapReduceOptions>;
}

/**
 * Progress callback for tracking job execution
 */
export type ProgressCallback = (progress: JobProgress) => void;

/**
 * Progress information during job execution
 */
export interface JobProgress {
    /** Current phase of execution */
    phase: 'splitting' | 'mapping' | 'reducing' | 'complete';
    /** Total number of work items */
    totalItems: number;
    /** Number of completed items */
    completedItems: number;
    /** Number of failed items */
    failedItems: number;
    /** Progress percentage (0-100) */
    percentage: number;
    /** Optional message for display */
    message?: string;
}

/**
 * Result of a map-reduce job execution
 */
export interface MapReduceResult<TMapOutput, TReduceOutput> {
    /** Whether the overall job succeeded */
    success: boolean;
    /** The final reduced output */
    output?: TReduceOutput;
    /** Results from individual map operations */
    mapResults: MapResult<TMapOutput>[];
    /** Statistics about the reduce phase */
    reduceStats?: ReduceStats;
    /** Total execution time in ms */
    totalTimeMs: number;
    /** Execution statistics */
    executionStats: ExecutionStats;
    /** Error message if job failed */
    error?: string;
}

/**
 * Execution statistics for the job
 */
export interface ExecutionStats {
    /** Total number of work items */
    totalItems: number;
    /** Number of successful map operations */
    successfulMaps: number;
    /** Number of failed map operations */
    failedMaps: number;
    /** Time spent in map phase */
    mapPhaseTimeMs: number;
    /** Time spent in reduce phase */
    reducePhaseTimeMs: number;
    /** Max concurrency used */
    maxConcurrency: number;
}

/**
 * Prompt template for generating prompts from work items
 */
export interface PromptTemplate {
    /** The template string with {{variable}} placeholders */
    template: string;
    /** Required variables that must be provided */
    requiredVariables: string[];
    /** Optional system prompt */
    systemPrompt?: string;
    /** Optional function to parse the AI response */
    responseParser?: (response: string) => unknown;
}

/**
 * Options for prompt rendering
 */
export interface PromptRenderOptions {
    /** Variables to substitute in the template */
    variables: Record<string, string | number | boolean>;
    /** Whether to include system prompt */
    includeSystemPrompt?: boolean;
}

/**
 * AI invocation function type
 */
export type AIInvoker = (prompt: string, options?: AIInvokerOptions) => Promise<AIInvokerResult>;

/**
 * Options for AI invocation
 */
export interface AIInvokerOptions {
    /** Model to use (optional, uses default if not specified) */
    model?: string;
    /** Working directory for execution */
    workingDirectory?: string;
    /** Timeout in ms */
    timeoutMs?: number;
}

/**
 * Result from AI invocation
 */
export interface AIInvokerResult {
    /** Whether the invocation succeeded */
    success: boolean;
    /** The AI response (if successful) */
    response?: string;
    /** Error message (if failed) */
    error?: string;
    /** SDK session ID if the request was made via SDK (for session resume) */
    sessionId?: string;
}

/**
 * Session metadata for session resume functionality
 */
export interface SessionMetadata {
    /** SDK session ID for resuming sessions */
    sessionId?: string;
    /** Backend type used for this process */
    backend?: 'copilot-sdk' | 'copilot-cli' | 'clipboard';
    /** Working directory used for the session */
    workingDirectory?: string;
}

/**
 * Process tracking hooks for integration with AI process manager
 */
export interface ProcessTracker {
    /**
     * Register a new process for tracking
     * @param description Description of the process
     * @param parentGroupId Optional parent group ID
     * @returns Process ID
     */
    registerProcess(description: string, parentGroupId?: string): string;

    /**
     * Update process status
     * @param processId Process ID
     * @param status New status
     * @param response Optional response
     * @param error Optional error
     * @param structuredResult Optional structured result (JSON string)
     */
    updateProcess(
        processId: string,
        status: 'running' | 'completed' | 'failed',
        response?: string,
        error?: string,
        structuredResult?: string
    ): void;

    /**
     * Attach session metadata to a process for session resume functionality.
     * This should be called after the AI invocation completes with the session ID.
     * @param processId Process ID
     * @param metadata Session metadata (sessionId, backend, workingDirectory)
     */
    attachSessionMetadata?(processId: string, metadata: SessionMetadata): void;

    /**
     * Register a group of processes
     * @param description Description of the group
     * @returns Group ID
     */
    registerGroup(description: string): string;

    /**
     * Complete a process group
     * @param groupId Group ID
     * @param summary Summary text
     * @param stats Execution statistics
     */
    completeGroup(
        groupId: string,
        summary: string,
        stats: ExecutionStats
    ): void;
}

/**
 * Executor options that combine job options with runtime options
 */
export interface ExecutorOptions extends MapReduceOptions {
    /** AI invoker function for map operations */
    aiInvoker: AIInvoker;
    /** Optional process tracker for integration */
    processTracker?: ProcessTracker;
    /** Optional progress callback */
    onProgress?: ProgressCallback;
    /** Optional cancellation check function - returns true if execution should be cancelled */
    isCancelled?: () => boolean;
}
