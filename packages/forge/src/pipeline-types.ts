/**
 * Pipeline execution phase and event types.
 * Used by process-store and server-side event streaming.
 */

import type { FilterStats } from '@plusplusoneplusplus/coc-workflow/workflow';

/** Pipeline execution phase. Mirrors the inline union in PipelineExecutionError.phase. */
export type PipelinePhase = 'input' | 'filter' | 'map' | 'reduce' | 'job';

/** Status of a pipeline phase. */
export type PipelinePhaseStatus = 'started' | 'completed' | 'failed';

/** Event emitted when a pipeline phase starts, completes, or fails. */
export interface PipelinePhaseEvent {
    phase: PipelinePhase;
    status: PipelinePhaseStatus;
    /** ISO 8601 timestamp */
    timestamp: string;
    /** Present when status is 'completed' or 'failed' */
    durationMs?: number;
    /** Present when status is 'failed' */
    error?: string;
    /** Items entering this phase */
    itemCount?: number;
}

/** Progress event emitted during a pipeline phase (e.g., map processing items). */
export interface PipelineProgressEvent {
    phase: PipelinePhase;
    totalItems: number;
    completedItems: number;
    failedItems: number;
    /** 0-100 */
    percentage: number;
    message?: string;
}

/** Event emitted when an individual map item's child process changes state. */
export interface ItemProcessEventData {
    /** Zero-based index of the item within the map input array. */
    itemIndex: number;
    /** Process ID of the child process handling this item. */
    processId: string;
    /** Current status of the item process. */
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    /** Pipeline phase the item is in (typically 'map'). */
    phase: PipelinePhase;
    /** Short label for UI display (e.g. first CSV column value). */
    itemLabel?: string;
    /** Error message when status is 'failed'. */
    error?: string;
}

/** Post-execution metadata for a single pipeline phase. */
export interface PipelinePhaseInfo {
    phase: PipelinePhase;
    status: PipelinePhaseStatus;
    /** ISO 8601 */
    startedAt: string;
    /** ISO 8601 */
    completedAt?: string;
    durationMs?: number;
    itemCount?: number;
    error?: string;
}

/** Metadata attached to completed pipeline process records. */
export interface PipelineProcessMetadata {
    pipelinePhases: PipelinePhaseInfo[];
    phaseTimings: Record<PipelinePhase, number>;
    inputItemCount?: number;
    filterStats?: FilterStats;
}
