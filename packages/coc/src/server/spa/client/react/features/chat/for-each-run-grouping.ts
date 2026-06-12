/**
 * for-each-run-grouping — groups chat history around persisted For Each runs.
 *
 * Thin adapter over the shared task-group grouping engine; matching accepts
 * both the generic `taskGroup` tag and the legacy `forEach` context.
 *
 * Pure utility: no React, no side effects.
 */

import type { ForEachRunSummary } from '@plusplusoneplusplus/coc-client';
import {
    getTaskGroupIdForType,
    getTaskTimestamp,
    groupBySeededTaskGroups,
    type SeededTaskGroup,
} from './task-group-grouping';

export type ForEachRunGroup = SeededTaskGroup<'for-each-run', ForEachRunSummary>;

export type ForEachRunHistoryEntry = ForEachRunGroup | (any & { kind?: undefined });

export interface ForEachProcessContext {
    kind?: 'child' | 'generation';
    workspaceId?: string;
    runId?: string;
    itemId?: string;
    generationId?: string;
}

export function getForEachContext(task: any): ForEachProcessContext | undefined {
    const context = task?.payload?.context?.forEach ?? task?.forEach;
    if (!context || typeof context !== 'object') {return undefined;}
    return context as ForEachProcessContext;
}

export function getForEachRunId(task: any): string | undefined {
    const tagged = getTaskGroupIdForType(task, 'for-each');
    if (tagged) {return tagged;}
    const runId = getForEachContext(task)?.runId;
    return typeof runId === 'string' && runId.trim() ? runId : undefined;
}

export function isForEachRunTask(task: any): boolean {
    return !!getForEachRunId(task);
}

export function getForEachEntryTimestamp(entry: ForEachRunHistoryEntry): number {
    if (entry.kind === 'for-each-run') {return entry.latestTimestamp;}
    return getTaskTimestamp(entry);
}

function getRunTimestamp(run: ForEachRunSummary): number {
    const ts = run.updatedAt ?? run.completedAt ?? run.cancelledAt ?? run.approvedAt ?? run.createdAt;
    return ts ? +new Date(ts) : 0;
}

export function groupByForEachRun(
    items: any[],
    runs: ForEachRunSummary[],
    unseenIds?: Set<string>,
): ForEachRunHistoryEntry[] {
    return groupBySeededTaskGroups(items, runs, {
        kind: 'for-each-run',
        getSeedId: run => run.runId,
        getSeedTimestamp: getRunTimestamp,
        getSeedOriginProcessIds: run => run.generationProcessId ? [run.generationProcessId] : [],
        resolveTaskGroupId: getForEachRunId,
    }, unseenIds);
}
