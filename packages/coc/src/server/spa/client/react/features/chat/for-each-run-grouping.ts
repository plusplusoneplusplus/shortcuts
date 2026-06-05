/**
 * for-each-run-grouping — groups chat history around persisted For Each runs.
 *
 * Pure utility: no React, no side effects.
 */

import type { ForEachRunSummary } from '@plusplusoneplusplus/coc-client';

export interface ForEachRunGroup {
    kind: 'for-each-run';
    runId: string;
    run: ForEachRunSummary;
    children: any[];
    latestTimestamp: number;
    hasUnseen: boolean;
}

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
    if (!context || typeof context !== 'object') return undefined;
    return context as ForEachProcessContext;
}

export function getForEachRunId(task: any): string | undefined {
    const runId = getForEachContext(task)?.runId;
    return typeof runId === 'string' && runId.trim() ? runId : undefined;
}

export function isForEachRunTask(task: any): boolean {
    return !!getForEachRunId(task);
}

export function getForEachEntryTimestamp(entry: ForEachRunHistoryEntry): number {
    if (entry.kind === 'for-each-run') return entry.latestTimestamp;
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

function getRunTimestamp(run: ForEachRunSummary): number {
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

export function groupByForEachRun(
    items: any[],
    runs: ForEachRunSummary[],
    unseenIds?: Set<string>,
): ForEachRunHistoryEntry[] {
    if (runs.length === 0) return items;

    const groups = new Map<string, ForEachRunGroup>();
    const runByGenerationProcessId = new Map<string, string>();
    for (const run of runs) {
        groups.set(run.runId, {
            kind: 'for-each-run',
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
        const runId = getForEachRunId(item) ?? taskMatchesGenerationProcess(item, runByGenerationProcessId);
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

    const entries: ForEachRunHistoryEntry[] = [...groups.values(), ...standalone];
    entries.sort((a, b) => getForEachEntryTimestamp(b) - getForEachEntryTimestamp(a));
    return entries;
}
