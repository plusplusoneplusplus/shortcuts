/**
 * run-group — generic engine for run-backed task groups (For Each, Map Reduce).
 *
 * Both features group a flat history list around a list of persisted "runs":
 * children are matched to their run either by the shared {@link TaskGroupRef}
 * (kind + groupId) or by the run's generation-chat process id. This module is
 * the single implementation; the per-feature modules are thin adapters that
 * supply the run accessors and the entry discriminant.
 *
 * Pure utility: no React, no side effects.
 */

import { deriveTaskGroupRef, type TaskGroupKind } from '@plusplusoneplusplus/coc-client';

/** A run-backed group: one persisted run plus the child tasks that belong to it. */
export interface RunBackedGroup<TRun, TKind extends string> {
    kind: TKind;
    runId: string;
    run: TRun;
    children: any[];
    latestTimestamp: number;
    hasUnseen: boolean;
}

export type RunBackedHistoryEntry<TRun, TKind extends string> = RunBackedGroup<TRun, TKind> | (any & { kind?: undefined });

export interface RunBackedGroupingConfig<TRun, TKind extends string> {
    /** Discriminant set on each emitted group entry (e.g. 'for-each-run'). */
    entryKind: TKind;
    /** Task-group kind used to match child tasks via {@link deriveTaskGroupRef} (e.g. 'for-each'). */
    taskGroupKind: TaskGroupKind;
    getRunId: (run: TRun) => string;
    getRunTimestamp: (run: TRun) => number;
    getGenerationProcessId: (run: TRun) => string | undefined;
}

/** Activity-aware timestamp fallback chain shared by run-backed groupings. */
export function getTaskTimestamp(task: any): number {
    const ts = task?.lastActivityAt
        ?? task?.endTime
        ?? task?.completedAt
        ?? task?.startedAt
        ?? task?.startTime
        ?? task?.createdAt
        ?? 0;
    return typeof ts === 'number' ? ts : +new Date(ts);
}

export function getTaskIds(task: any): string[] {
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

/** Resolve the run id a task belongs to: explicit/legacy group ref first, then generation-process match. */
function resolveRunId(
    task: any,
    taskGroupKind: TaskGroupKind,
    runByGenerationProcessId: Map<string, string>,
): string | undefined {
    const ref = deriveTaskGroupRef(task);
    const refRunId = ref && ref.kind === taskGroupKind ? ref.groupId : undefined;
    return refRunId ?? taskMatchesGenerationProcess(task, runByGenerationProcessId);
}

/**
 * Group a flat history list around persisted runs. Returns group entries (one
 * per run, newest activity first) interleaved with standalone (ungrouped)
 * items, sorted by latest activity descending. When there are no runs the
 * original list is returned unchanged.
 */
export function groupItemsByRun<TRun, TKind extends string>(
    items: any[],
    runs: TRun[],
    config: RunBackedGroupingConfig<TRun, TKind>,
    unseenIds?: Set<string>,
): RunBackedHistoryEntry<TRun, TKind>[] {
    if (runs.length === 0) return items;

    const groups = new Map<string, RunBackedGroup<TRun, TKind>>();
    const runByGenerationProcessId = new Map<string, string>();
    for (const run of runs) {
        const runId = config.getRunId(run);
        groups.set(runId, {
            kind: config.entryKind,
            runId,
            run,
            children: [],
            latestTimestamp: config.getRunTimestamp(run),
            hasUnseen: false,
        });
        const generationProcessId = config.getGenerationProcessId(run);
        if (generationProcessId) {
            runByGenerationProcessId.set(generationProcessId, runId);
        }
    }

    const standalone: any[] = [];
    for (const item of items) {
        const runId = resolveRunId(item, config.taskGroupKind, runByGenerationProcessId);
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
        group.latestTimestamp = Math.max(config.getRunTimestamp(group.run), ...childTimestamps);
        group.hasUnseen = group.children.some(child => isUnseenTask(child, unseenIds));
    }

    const entries: RunBackedHistoryEntry<TRun, TKind>[] = [...groups.values(), ...standalone];
    entries.sort((a, b) => runBackedEntryTimestamp(b) - runBackedEntryTimestamp(a));
    return entries;
}

/** Timestamp used to order a run-backed entry (group: latestTimestamp; standalone: activity fallback). */
export function runBackedEntryTimestamp(entry: any): number {
    if (entry && typeof entry === 'object' && typeof entry.kind === 'string' && typeof entry.latestTimestamp === 'number') {
        return entry.latestTimestamp;
    }
    return getTaskTimestamp(entry);
}
