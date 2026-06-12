/**
 * map-reduce-run-grouping — groups chat history around persisted Map Reduce runs.
 *
 * Thin adapter over the shared task-group grouping engine; matching accepts
 * both the generic `taskGroup` tag and the legacy `mapReduce` context.
 *
 * Pure utility: no React, no side effects.
 */

import type { MapReduceRunSummary } from '@plusplusoneplusplus/coc-client';
import {
    getTaskGroupIdForType,
    getTaskTimestamp,
    groupBySeededTaskGroups,
    type SeededTaskGroup,
} from './task-group-grouping';

export type MapReduceRunGroup = SeededTaskGroup<'map-reduce-run', MapReduceRunSummary>;

export type MapReduceRunHistoryEntry = MapReduceRunGroup | (any & { kind?: undefined });

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
    if (!context || typeof context !== 'object') {return undefined;}
    return context as MapReduceProcessContext;
}

export function getMapReduceRunId(task: any): string | undefined {
    const tagged = getTaskGroupIdForType(task, 'map-reduce');
    if (tagged) {return tagged;}
    const runId = getMapReduceContext(task)?.runId;
    return typeof runId === 'string' && runId.trim() ? runId : undefined;
}

export function isMapReduceRunTask(task: any): boolean {
    return !!getMapReduceRunId(task);
}

export function getMapReduceEntryTimestamp(entry: MapReduceRunHistoryEntry): number {
    if (entry.kind === 'map-reduce-run') {return entry.latestTimestamp;}
    return getTaskTimestamp(entry);
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
    return groupBySeededTaskGroups(items, runs, {
        kind: 'map-reduce-run',
        getSeedId: run => run.runId,
        getSeedTimestamp: getRunTimestamp,
        getSeedOriginProcessIds: run => run.generationProcessId ? [run.generationProcessId] : [],
        resolveTaskGroupId: getMapReduceRunId,
    }, unseenIds);
}
