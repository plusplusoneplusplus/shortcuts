import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';

export type MapReduceChildMode = 'ask' | 'autopilot';

export type MapReduceRunStatus =
    | 'draft'
    | 'approved'
    | 'running'
    | 'reducing'
    | 'failed'
    | 'completed'
    | 'cancelled';

export type MapReduceItemStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped';

export type MapReduceReduceStepStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface MapReduceItem {
    id: string;
    title: string;
    prompt: string;
    dependsOn?: string[];
    metadata?: Record<string, unknown>;
    status: MapReduceItemStatus;
    childProcessId?: string;
    childTaskId?: string;
    output?: unknown;
    startedAt?: string;
    completedAt?: string;
    error?: string;
}

export interface MapReduceReduceStep {
    status: MapReduceReduceStepStatus;
    childProcessId?: string;
    childTaskId?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
}

export interface MapReduceRunMetadata {
    runId: string;
    workspaceId: string;
    status: MapReduceRunStatus;
    originalRequest: string;
    sharedInstructions?: string;
    reduceInstructions: string;
    maxParallel: number;
    childMode: MapReduceChildMode;
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    createdAt: string;
    updatedAt: string;
    approvedAt?: string;
    cancelledAt?: string;
    completedAt?: string;
    generationProcessId?: string;
    generationId?: string;
}

export interface MapReduceRun extends MapReduceRunMetadata {
    items: MapReduceItem[];
    reduceStep: MapReduceReduceStep;
}

export interface MapReduceRunSummary extends MapReduceRunMetadata {
    itemCount: number;
    itemStatusCounts: Record<MapReduceItemStatus, number>;
    reduceStatus: MapReduceReduceStepStatus;
}

export interface CreateMapReduceRunInput {
    workspaceId: string;
    originalRequest: string;
    sharedInstructions?: string;
    reduceInstructions: string;
    maxParallel?: number;
    childMode: MapReduceChildMode;
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    generationProcessId?: string;
    generationId?: string;
    items: MapReduceItem[];
}

export interface UpdateMapReducePlanInput {
    items: MapReduceItem[];
    sharedInstructions?: string;
    reduceInstructions?: string;
    maxParallel?: number;
    childMode?: MapReduceChildMode;
}

export interface ClaimedMapReduceItems {
    run: MapReduceRun;
    items: MapReduceItem[];
}

export interface ClaimedMapReduceReduceStep {
    run: MapReduceRun;
    reduceStep: MapReduceReduceStep;
}

export interface CancelMapReduceRunResult {
    run: MapReduceRun;
    childTaskIds: string[];
}

export const DEFAULT_MAP_REDUCE_MAX_PARALLEL = 3;

export const MAP_REDUCE_ITEM_STATUSES: readonly MapReduceItemStatus[] = [
    'pending',
    'running',
    'completed',
    'failed',
    'skipped',
];

export const MAP_REDUCE_REDUCE_STEP_STATUSES: readonly MapReduceReduceStepStatus[] = [
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled',
];

export const MAP_REDUCE_CHILD_MODES: readonly MapReduceChildMode[] = ['ask', 'autopilot'];
