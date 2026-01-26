/**
 * Pipeline Result Viewer Types
 *
 * Types for the enhanced pipeline execution result viewer.
 * Provides individual node viewing with detailed results.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    ExecutionStats,
    ReduceStats,
    AIInvoker,
    PromptMapResult,
    PromptMapOutput,
    PromptMapSummary,
    PromptItem,
    PipelineConfig
} from '@plusplusoneplusplus/pipeline-core';

/**
 * Retry state for tracking retry operations
 */
export interface RetryState {
    /** Whether a retry operation is in progress */
    isRetrying: boolean;
    /** Number of items completed in current retry batch */
    completedCount: number;
    /** Total number of items being retried */
    totalCount: number;
    /** IDs of items currently being retried */
    retryingItemIds: string[];
    /** Whether the retry was cancelled */
    cancelled: boolean;
}

/**
 * Complete result from a pipeline execution for display
 */
export interface PipelineResultViewData {
    /** Pipeline name */
    pipelineName: string;
    /** Pipeline package name */
    packageName: string;
    /** Whether the execution was successful overall */
    success: boolean;
    /** Total execution time in milliseconds */
    totalTimeMs: number;
    /** Execution statistics */
    executionStats: ExecutionStats;
    /** Reduce phase statistics */
    reduceStats?: ReduceStats;
    /** Output from reduce phase */
    output?: PromptMapOutput;
    /** Individual item results for node display */
    itemResults: PipelineItemResultNode[];
    /** Error message if execution failed */
    error?: string;
    /** Timestamp when execution completed */
    completedAt: Date;
    /** Original pipeline configuration (stored for retry consistency) */
    pipelineConfig?: PipelineConfig;
    /** Path to the pipeline package directory */
    pipelineDirectory?: string;
    /** Timestamp of last retry operation */
    lastRetryAt?: Date;
}

/**
 * Individual item result node for tree display
 */
export interface PipelineItemResultNode {
    /** Unique identifier (work item ID) */
    id: string;
    /** Index in the original input (0-based) */
    index: number;
    /** The original input item */
    input: PromptItem;
    /** The AI-generated output (structured mode) */
    output: Record<string, unknown>;
    /** Raw text output when in text mode (no output fields specified) */
    rawText?: string;
    /** Whether processing succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Raw AI response (for debugging) */
    rawResponse?: string;
    /** Execution time for this item in milliseconds */
    executionTimeMs?: number;
    /** Number of retry attempts for this item */
    retryCount?: number;
    /** Error from the first attempt (if retried) */
    originalError?: string;
    /** Timestamp of the last retry */
    retriedAt?: Date;
}

/**
 * Message types for result viewer webview communication
 */
export type ResultViewerMessageType =
    | 'nodeClick'
    | 'exportResults'
    | 'copyResults'
    | 'refresh'
    | 'openItem'
    | 'filterResults'
    | 'ready'
    | 'retryFailed'
    | 'retryItem'
    | 'retrySelected'
    | 'cancelRetry';

/**
 * Message from result viewer webview to extension
 */
export interface ResultViewerMessage {
    type: ResultViewerMessageType;
    payload?: {
        nodeId?: string;
        nodeIndex?: number;
        filterType?: 'all' | 'success' | 'failed';
        exportFormat?: 'json' | 'csv' | 'markdown';
        /** Item IDs to retry (for retrySelected) */
        itemIds?: string[];
    };
}

/**
 * Message types from extension to webview
 */
export type ResultViewerExtensionMessageType =
    | 'retryProgress'
    | 'itemRetryResult'
    | 'retryComplete'
    | 'retryError'
    | 'retryStarted'
    | 'retryCancelled';

/**
 * Message from extension to result viewer webview
 */
export interface ResultViewerExtensionMessage {
    type: ResultViewerExtensionMessageType;
    payload?: {
        /** Number of completed retry items */
        completed?: number;
        /** Total number of items being retried */
        total?: number;
        /** Item ID that was retried */
        itemId?: string;
        /** Updated result for the item */
        result?: PipelineItemResultNode;
        /** Updated execution stats */
        stats?: ExecutionStats;
        /** Error message */
        error?: string;
        /** IDs of items being retried */
        itemIds?: string[];
    };
}

/**
 * Filter state for the result viewer
 */
export interface ResultViewerFilterState {
    /** Show all results */
    showAll: boolean;
    /** Show only successful results */
    showSuccess: boolean;
    /** Show only failed results */
    showFailed: boolean;
}

/**
 * Node type in the result diagram
 */
export type ResultNodeType = 'summary' | 'item' | 'error' | 'stats';

/**
 * Convert MapResult to PipelineItemResultNode
 */
export function mapResultToNode(
    result: PromptMapResult,
    index: number,
    executionTimeMs?: number
): PipelineItemResultNode {
    return {
        id: `item-${index}`,
        index,
        input: result.item,
        output: result.output,
        rawText: result.rawText,
        success: result.success,
        error: result.error,
        rawResponse: result.rawResponse,
        executionTimeMs
    };
}

/**
 * Create preview text for an item result
 */
export function getItemPreview(node: PipelineItemResultNode, maxLength: number = 50): string {
    const firstInputKey = Object.keys(node.input)[0];
    const firstValue = firstInputKey ? String(node.input[firstInputKey]) : '';
    return firstValue.length > maxLength
        ? firstValue.substring(0, maxLength - 3) + '...'
        : firstValue;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}m ${seconds}s`;
    }
}

/**
 * Get status icon for a result node
 */
export function getStatusIcon(success: boolean): string {
    return success ? '✅' : '❌';
}

/**
 * Get status CSS class for a result node
 */
export function getStatusClass(success: boolean): string {
    return success ? 'status-success' : 'status-error';
}
