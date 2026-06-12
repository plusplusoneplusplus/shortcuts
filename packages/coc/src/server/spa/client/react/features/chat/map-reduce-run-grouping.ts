/**
 * map-reduce-run-grouping — groups chat history around persisted Map Reduce runs.
 *
 * Thin adapter over the generic {@link groupItemsByRun} engine: supplies the
 * Map Reduce run accessors and the `map-reduce-run` entry discriminant. Children
 * are matched via the shared {@link deriveTaskGroupRef} (kind `map-reduce`).
 *
 * Pure utility: no React, no side effects.
 */

import type { MapReduceRunSummary } from '@plusplusoneplusplus/coc-client';
import {
    groupItemsByRun,
    runBackedEntryTimestamp,
    type RunBackedGroup,
    type RunBackedHistoryEntry,
} from './run-group';

export type MapReduceRunGroup = RunBackedGroup<MapReduceRunSummary, 'map-reduce-run'>;
export type MapReduceRunHistoryEntry = RunBackedHistoryEntry<MapReduceRunSummary, 'map-reduce-run'>;

export interface MapReduceProcessContext {
    kind?: 'generation';
    workspaceId?: string;
    runId?: string;
    generationId?: string;
    phase?: 'map' | 'reduce';
    itemId?: string;
}

export function getMapReduceContext(task: any): MapReduceProcessContext | undefined {
    const context = task?.payload?.context?.mapReduce ?? task?.mapReduce;
    if (!context || typeof context !== 'object') return undefined;
    return context as MapReduceProcessContext;
}

export function getMapReduceRunId(task: any): string | undefined {
    const runId = getMapReduceContext(task)?.runId;
    return typeof runId === 'string' && runId.trim() ? runId : undefined;
}

export function isMapReduceRunTask(task: any): boolean {
    return !!getMapReduceRunId(task);
}

export function getMapReduceEntryTimestamp(entry: MapReduceRunHistoryEntry): number {
    return runBackedEntryTimestamp(entry);
}

function getRunTimestamp(run: MapReduceRunSummary): number {
    const ts = run.updatedAt ?? run.completedAt ?? run.cancelledAt ?? run.approvedAt ?? run.createdAt;
    return ts ? +new Date(ts) : 0;
}

export function groupByMapReduceRun(
    items: any[],
    runs: MapReduceRunSummary[],
    unseenIds?: Set<string>,
): MapReduceRunHistoryEntry[] {
    return groupItemsByRun(items, runs, {
        entryKind: 'map-reduce-run',
        taskGroupKind: 'map-reduce',
        getRunId: run => run.runId,
        getRunTimestamp,
        getGenerationProcessId: run => run.generationProcessId,
    }, unseenIds);
}
