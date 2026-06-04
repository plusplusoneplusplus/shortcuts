import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';

export type ForEachChildMode = 'ask' | 'autopilot';

export type ForEachRunStatus =
    | 'draft'
    | 'approved'
    | 'running'
    | 'failed'
    | 'completed'
    | 'cancelled';

export type ForEachItemStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped';

export interface ForEachItem {
    id: string;
    title: string;
    prompt: string;
    dependsOn?: string[];
    metadata?: Record<string, unknown>;
    status: ForEachItemStatus;
    childProcessId?: string;
    childTaskId?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
}

export interface ForEachRunMetadata {
    runId: string;
    workspaceId: string;
    status: ForEachRunStatus;
    originalRequest: string;
    sharedInstructions?: string;
    childMode: ForEachChildMode;
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    createdAt: string;
    updatedAt: string;
    approvedAt?: string;
    cancelledAt?: string;
    completedAt?: string;
}

export interface ForEachRun extends ForEachRunMetadata {
    items: ForEachItem[];
}

export interface ForEachRunSummary extends ForEachRunMetadata {
    itemCount: number;
    itemStatusCounts: Record<ForEachItemStatus, number>;
}

export interface CreateForEachRunInput {
    workspaceId: string;
    originalRequest: string;
    sharedInstructions?: string;
    childMode: ForEachChildMode;
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    items: ForEachItem[];
}

export interface UpdateForEachPlanInput {
    items: ForEachItem[];
    sharedInstructions?: string;
    childMode?: ForEachChildMode;
}

export const FOR_EACH_ITEM_STATUSES: readonly ForEachItemStatus[] = [
    'pending',
    'running',
    'completed',
    'failed',
    'skipped',
];

export const FOR_EACH_CHILD_MODES: readonly ForEachChildMode[] = ['ask', 'autopilot'];

