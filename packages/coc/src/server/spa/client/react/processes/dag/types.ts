export type DAGNodeState = 'waiting' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

export interface DAGNodeData {
    phase: string;
    state: DAGNodeState;
    label: string;
    itemCount?: number;
    totalItems?: number;
    failedItems?: number;
    durationMs?: number;
    /** Epoch ms when this node started running (for elapsed time display). */
    startedAt?: number;
    /** When true, this node can be clicked to expand a detail sub-view (e.g., item grid). */
    expandable?: boolean;
}

export interface DAGChartData {
    nodes: DAGNodeData[];
    totalDurationMs?: number;
}

export interface ChildProcessSummary {
    processId: string;
    itemIndex: number;
    status: string;
    promptPreview?: string;
    durationMs?: number;
    error?: string;
    startedAt?: number;
}

export interface MapItemGridData {
    children: ChildProcessSummary[];
    totalCount: number;
    completedCount: number;
    failedCount: number;
    runningCount: number;
}
