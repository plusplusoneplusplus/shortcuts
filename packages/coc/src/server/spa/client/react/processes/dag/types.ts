import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';

export type DAGNodeState = 'waiting' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

export interface DAGNodeData {
    phase: PipelinePhase;
    state: DAGNodeState;
    label: string;
    itemCount?: number;
    totalItems?: number;
    failedItems?: number;
    durationMs?: number;
}

export interface DAGChartData {
    nodes: DAGNodeData[];
    totalDurationMs?: number;
}
