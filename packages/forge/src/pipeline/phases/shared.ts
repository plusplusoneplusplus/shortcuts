/**
 * Pipeline Shared Types & Helpers
 *
 * Shared types, error classes, and utility functions used across pipeline phases.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    AIInvoker,
    PipelineConfig,
    PipelineParameter,
    PipelinePhase,
    PipelinePhaseEvent,
    ProcessTracker,
    FilterResult,
} from '../types';
import {
    JobProgress,
    MapReduceResult,
    PromptItem,
    PromptMapResult,
    PromptMapOutput,
} from '../../map-reduce';
import { PipelineCoreError, ErrorCode } from '../../errors';

/**
 * Error thrown for pipeline execution issues
 */
export class PipelineExecutionError extends PipelineCoreError {
    /** Phase where the error occurred */
    readonly phase?: 'input' | 'filter' | 'map' | 'reduce' | 'job';

    constructor(
        message: string,
        phase?: 'input' | 'filter' | 'map' | 'reduce' | 'job'
    ) {
        super(message, {
            code: ErrorCode.PIPELINE_EXECUTION_FAILED,
            meta: phase ? { phase } : undefined,
        });
        this.name = 'PipelineExecutionError';
        this.phase = phase;
    }
}

/**
 * Options for executing a pipeline (subset needed by phases)
 */
export interface ExecutePipelineOptions {
    /** AI invoker function */
    aiInvoker: AIInvoker;
    /** Pipeline directory for resolving relative paths */
    pipelineDirectory: string;
    /** Workspace root directory for resolving skills */
    workspaceRoot?: string;
    /** Optional process tracker */
    processTracker?: ProcessTracker;
    /** Progress callback */
    onProgress?: (progress: JobProgress) => void;
    /** Phase change callback */
    onPhaseChange?: (event: PipelinePhaseEvent) => void;
    /** Cancellation check */
    isCancelled?: () => boolean;
    /** Item process creation callback */
    onItemProcessCreated?: (event: ItemProcessEvent) => void;
}

/**
 * Event emitted when a child process is created for an individual map/batch item
 */
export interface ItemProcessEvent {
    /** Zero-based index of the item in the original input array */
    itemIndex: number;
    /** Generated child process ID */
    processId: string;
    /** The input item being processed */
    item: PromptItem;
    /** Batch index (only present in batch mode) */
    batchIndex?: number;
    /** Which pipeline phase produced this child */
    phase: 'map' | 'job' | 'filter-ai' | 'reduce-ai';
    /** Whether the item succeeded */
    success: boolean;
    /** Error message if the item failed */
    error?: string;
    /** SDK session ID from the AI response (for session resume) */
    sessionId?: string;
    /** The AI's raw text response for this item (undefined if the item failed) */
    rawResponse?: string;
}

/**
 * Result type from pipeline execution
 */
export interface PipelineExecutionResult extends MapReduceResult<PromptMapResult, PromptMapOutput> {
    /** Filter result if filter was used */
    filterResult?: FilterResult;
    /** Child process IDs created for individual map/batch items */
    itemProcessIds?: string[];
}

/**
 * Resolved prompts from config (either inline or from files)
 */
export interface ResolvedPrompts {
    mapPrompt: string;
    reducePrompt?: string;
}

/**
 * Pipeline config narrowed to map-reduce mode (input, map, reduce are required)
 */
export type MapReducePipelineConfig = PipelineConfig & {
    input: NonNullable<PipelineConfig['input']>;
    map: NonNullable<PipelineConfig['map']>;
    reduce: NonNullable<PipelineConfig['reduce']>;
};

/** Emit a phase change event via the options callback (no-op when callback is absent). */
export function emitPhase(
    options: ExecutePipelineOptions,
    phase: PipelinePhase,
    status: PipelinePhaseEvent['status'],
    extra?: Partial<Pick<PipelinePhaseEvent, 'durationMs' | 'error' | 'itemCount'>>
): void {
    options.onPhaseChange?.({
        phase,
        status,
        timestamp: new Date().toISOString(),
        ...extra,
    });
}

/**
 * Wrap the original onProgress to detect MR phase transitions and emit pipeline phase events.
 */
export function createPhaseTrackingProgress(
    options: ExecutePipelineOptions,
    totalItems: number
): (progress: JobProgress) => void {
    let lastPhase: string | undefined;
    const mapStartTime = Date.now();
    return (progress: JobProgress) => {
        // Forward original progress callback
        options.onProgress?.(progress);
        // Detect phase transitions
        if (progress.phase !== lastPhase) {
            const prev = lastPhase;
            lastPhase = progress.phase;
            if (progress.phase === 'mapping' && (prev === 'splitting' || prev === undefined)) {
                emitPhase(options, 'map', 'started', { itemCount: totalItems });
            } else if (progress.phase === 'reducing') {
                emitPhase(options, 'map', 'completed', { durationMs: Date.now() - mapStartTime, itemCount: totalItems });
                emitPhase(options, 'reduce', 'started');
            } else if (progress.phase === 'complete') {
                emitPhase(options, 'reduce', 'completed');
            }
        }
    };
}

/**
 * Convert parameters array to object for merging with items
 */
export function convertParametersToObject(parameters: PipelineParameter[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const param of parameters) {
        result[param.name] = param.value;
    }
    return result;
}
