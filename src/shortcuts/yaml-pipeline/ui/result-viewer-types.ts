/**
 * Pipeline Result Viewer Types
 *
 * Types for the enhanced pipeline execution result viewer.
 * Provides individual node viewing with detailed results.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { ExecutionStats, ReduceStats } from '../../map-reduce/types';
import { PromptMapResult, PromptMapOutput, PromptMapSummary, PromptItem } from '../../map-reduce/jobs/prompt-map-job';

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
    | 'ready';

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
