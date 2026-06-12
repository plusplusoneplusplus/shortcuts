/**
 * for-each-run-grouping — groups chat history around persisted For Each runs.
 *
 * Thin adapter over the generic {@link groupItemsByRun} engine: supplies the
 * For Each run accessors and the `for-each-run` entry discriminant. Children are
 * matched via the shared {@link deriveTaskGroupRef} (kind `for-each`).
 *
 * Pure utility: no React, no side effects.
 */

import type { ForEachRunSummary } from '@plusplusoneplusplus/coc-client';
import {
    groupItemsByRun,
    runBackedEntryTimestamp,
    type RunBackedGroup,
    type RunBackedHistoryEntry,
} from './run-group';

export type ForEachRunGroup = RunBackedGroup<ForEachRunSummary, 'for-each-run'>;
export type ForEachRunHistoryEntry = RunBackedHistoryEntry<ForEachRunSummary, 'for-each-run'>;

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
    return runBackedEntryTimestamp(entry);
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
    return groupItemsByRun(items, runs, {
        entryKind: 'for-each-run',
        taskGroupKind: 'for-each',
        getRunId: run => run.runId,
        getRunTimestamp,
        getGenerationProcessId: run => run.generationProcessId,
    }, unseenIds);
}
