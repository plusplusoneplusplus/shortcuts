/**
 * map-reduce-run-grouping — groups chat history around persisted Map Reduce runs.
 *
 * Pure utility: no React, no side effects.
 */

import type { MapReduceRunSummary } from '@plusplusoneplusplus/coc-client';

export interface MapReduceRunGroup {
    kind: 'map-reduce-run';
    runId: string;
    run: MapReduceRunSummary;
    children: any[];
    latestTimestamp: number;
    hasUnseen: boolean;
}

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
    if (entry.kind === 'map-reduce-run') return entry.latestTimestamp;
    return getTaskTimestamp(entry);
}

function getTaskTimestamp(task: any): number {
    const ts = task?.lastActivityAt
        ?? task?.endTime
        ?? task?.completedAt
        ?? task?.startedAt
        ?? task?.startTime
        ?? task?.createdAt
        ?? 0;
    return typeof ts === 'number' ? ts : +new Date(ts);
}

function getRunTimestamp(run: MapReduceRunSummary): number {
    const ts = run.updatedAt ?? run.completedAt ?? run.cancelledAt ?? run.approvedAt ?? run.createdAt;
    return ts ? +new Date(ts) : 0;
}

function getTaskIds(task: any): string[] {
    return [task?.id, task?.processId].filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function taskMatchesGenerationProcess(task: any, runByGenerationProcessId: Map<string, string>): string | undefined {
    for (const id of getTaskIds(task)) {
        const runId = runByGenerationProcessId.get(id);
        if (runId) return runId;
    }
    return undefined;
}

function isUnseenTask(task: any, unseenIds?: Set<string>): boolean {
    if (!unseenIds) return false;
    return getTaskIds(task).some(id => unseenIds.has(id));
}

export function groupByMapReduceRun(
    items: any[],
    runs: MapReduceRunSummary[],
    unseenIds?: Set<string>,
): MapReduceRunHistoryEntry[] {
    if (runs.length === 0) return items;

    const groups = new Map<string, MapReduceRunGroup>();
    const runByGenerationProcessId = new Map<string, string>();
    for (const run of runs) {
        groups.set(run.runId, {
            kind: 'map-reduce-run',
            runId: run.runId,
            run,
            children: [],
            latestTimestamp: getRunTimestamp(run),
            hasUnseen: false,
        });
        if (run.generationProcessId) {
            runByGenerationProcessId.set(run.generationProcessId, run.runId);
        }
    }

    const standalone: any[] = [];
    for (const item of items) {
        const runId = getMapReduceRunId(item) ?? taskMatchesGenerationProcess(item, runByGenerationProcessId);
        const group = runId ? groups.get(runId) : undefined;
        if (!group) {
            standalone.push(item);
            continue;
        }
        group.children.push(item);
    }

    for (const group of groups.values()) {
        group.children.sort((a, b) => getTaskTimestamp(a) - getTaskTimestamp(b));
        const childTimestamps = group.children.map(getTaskTimestamp).filter(Number.isFinite);
        group.latestTimestamp = Math.max(getRunTimestamp(group.run), ...childTimestamps);
        group.hasUnseen = group.children.some(child => isUnseenTask(child, unseenIds));
    }

    const entries: MapReduceRunHistoryEntry[] = [...groups.values(), ...standalone];
    entries.sort((a, b) => getMapReduceEntryTimestamp(b) - getMapReduceEntryTimestamp(a));
    return entries;
}
