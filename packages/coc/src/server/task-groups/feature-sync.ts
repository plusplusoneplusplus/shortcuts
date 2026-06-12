/**
 * Feature → task-group registry projections.
 *
 * Each hierarchical feature keeps its own run/session store as the source of
 * truth for orchestration; these helpers project a run record into the
 * generic task-group registry (group summary + child links with roles).
 * They are invoked from the feature stores' change hooks, so every mutation
 * path keeps the registry in sync without scattering registry calls through
 * orchestration code.
 */

import type { TaskGroupStatus } from '@plusplusoneplusplus/forge';
import type { TaskGroupService } from './task-group-service';
import type { ForEachRun, ForEachRunStatus } from '../for-each/types';
import type { MapReduceRun, MapReduceRunStatus } from '../map-reduce/types';
import type { RalphSessionRecord } from '../ralph/types';
import type { DreamRunRecord } from '../dreams/types';

export const TASK_GROUP_TYPE_FOR_EACH = 'for-each';
export const TASK_GROUP_TYPE_MAP_REDUCE = 'map-reduce';
export const TASK_GROUP_TYPE_RALPH = 'ralph';
export const TASK_GROUP_TYPE_DREAM = 'dream';

const TITLE_MAX_LENGTH = 80;

/** Derive a compact single-line group title from free-form request text. */
export function toTaskGroupTitle(text: string | undefined): string | undefined {
    const collapsed = text?.replace(/\s+/g, ' ').trim();
    if (!collapsed) {return undefined;}
    return collapsed.length > TITLE_MAX_LENGTH
        ? `${collapsed.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
        : collapsed;
}

export function forEachStatusToTaskGroupStatus(status: ForEachRunStatus): TaskGroupStatus {
    switch (status) {
        case 'draft':
        case 'approved':
            return 'draft';
        case 'running':
            return 'running';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'cancelled';
    }
}

export function mapReduceStatusToTaskGroupStatus(status: MapReduceRunStatus): TaskGroupStatus {
    switch (status) {
        case 'draft':
        case 'approved':
            return 'draft';
        case 'running':
        case 'reducing':
            return 'running';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'cancelled';
    }
}

/**
 * Project a Dream run into the registry. Dream groups are hidden: the
 * relationship is recorded for linkage-only consumers, but the chat list
 * keeps its current presentation (internal steps stay internal).
 */
export function syncDreamRunToTaskGroup(service: TaskGroupService, run: DreamRunRecord): void {
    const status: TaskGroupStatus = run.status === 'running'
        ? 'running'
        : run.status === 'completed' ? 'completed' : 'failed';
    service.ensureGroup({
        workspaceId: run.workspaceId,
        groupId: run.id,
        type: TASK_GROUP_TYPE_DREAM,
        title: `Dream run (${run.trigger})`,
        status,
        hidden: true,
        createdAt: run.startedAt,
        completedAt: run.completedAt ?? run.failedAt,
        extra: {
            detailStatus: run.status,
            trigger: run.trigger,
            candidateCount: run.candidateCardIds.length,
            ...(run.error ? { error: run.error } : {}),
        },
    });
    if (run.analyzerProcessId) {
        service.linkChild(run.workspaceId, run.id, {
            role: 'analyzer',
            processId: run.analyzerProcessId,
            memberIndex: 1,
        });
    }
    if (run.criticProcessId) {
        service.linkChild(run.workspaceId, run.id, {
            role: 'critic',
            processId: run.criticProcessId,
            memberIndex: 2,
        });
    }
}

export function ralphSessionToTaskGroupStatus(record: RalphSessionRecord): TaskGroupStatus {
    switch (record.phase) {
        case 'grilling':
            return 'draft';
        case 'executing':
            return 'running';
        case 'complete':
            return record.terminalReason === 'CANCELLED' ? 'cancelled' : 'completed';
    }
}

/** Project a Ralph session record into the registry: group summary + child links. */
export function syncRalphSessionToTaskGroup(service: TaskGroupService, record: RalphSessionRecord): void {
    service.ensureGroup({
        workspaceId: record.workspaceId,
        groupId: record.sessionId,
        type: TASK_GROUP_TYPE_RALPH,
        title: toTaskGroupTitle(record.originalGoal),
        status: ralphSessionToTaskGroupStatus(record),
        createdAt: record.startedAt,
        completedAt: record.completedAt,
        extra: {
            detailStatus: record.phase,
            currentIteration: record.currentIteration,
            maxIterations: record.maxIterations,
            iterationCount: record.iterations.length,
            ...(record.loops?.length ? { loopCount: record.loops.length } : {}),
            ...(record.terminalReason ? { terminalReason: record.terminalReason } : {}),
        },
    });
    for (const iteration of record.iterations) {
        if (!iteration.taskId && !iteration.processId) {continue;}
        service.linkChild(record.workspaceId, record.sessionId, {
            role: 'iteration',
            taskId: iteration.taskId,
            processId: iteration.processId,
            itemKey: String(iteration.iteration),
            memberIndex: iteration.iteration,
        });
    }
    for (const check of record.finalChecks ?? []) {
        if (!check.taskId && !check.processId) {continue;}
        service.linkChild(record.workspaceId, record.sessionId, {
            role: 'final-check',
            taskId: check.taskId,
            processId: check.processId,
            itemKey: `check-${check.checkIndex}`,
            memberIndex: record.iterations.length + check.checkIndex,
        });
    }
}

/** Project a For Each run into the registry: group summary + child links. */
export function syncForEachRunToTaskGroup(service: TaskGroupService, run: ForEachRun): void {
    service.ensureGroup({
        workspaceId: run.workspaceId,
        groupId: run.runId,
        type: TASK_GROUP_TYPE_FOR_EACH,
        title: toTaskGroupTitle(run.originalRequest),
        status: forEachStatusToTaskGroupStatus(run.status),
        originProcessId: run.generationProcessId,
        createdAt: run.createdAt,
        completedAt: run.completedAt ?? run.cancelledAt,
        extra: {
            detailStatus: run.status,
            itemCount: run.items.length,
            childMode: run.childMode,
        },
    });
    if (run.generationProcessId) {
        service.linkChild(run.workspaceId, run.runId, {
            role: 'generation',
            processId: run.generationProcessId,
        });
    }
    run.items.forEach((item, index) => {
        if (!item.childTaskId && !item.childProcessId) {return;}
        service.linkChild(run.workspaceId, run.runId, {
            role: 'item',
            taskId: item.childTaskId,
            processId: item.childProcessId,
            itemKey: item.id,
            memberIndex: index + 1,
        });
    });
}

/** Project a Map Reduce run into the registry: group summary + child links. */
export function syncMapReduceRunToTaskGroup(service: TaskGroupService, run: MapReduceRun): void {
    service.ensureGroup({
        workspaceId: run.workspaceId,
        groupId: run.runId,
        type: TASK_GROUP_TYPE_MAP_REDUCE,
        title: toTaskGroupTitle(run.originalRequest),
        status: mapReduceStatusToTaskGroupStatus(run.status),
        originProcessId: run.generationProcessId,
        createdAt: run.createdAt,
        completedAt: run.completedAt ?? run.cancelledAt,
        extra: {
            detailStatus: run.status,
            itemCount: run.items.length,
            maxParallel: run.maxParallel,
            reduceStatus: run.reduceStep.status,
            childMode: run.childMode,
        },
    });
    if (run.generationProcessId) {
        service.linkChild(run.workspaceId, run.runId, {
            role: 'generation',
            processId: run.generationProcessId,
        });
    }
    run.items.forEach((item, index) => {
        if (!item.childTaskId && !item.childProcessId) {return;}
        service.linkChild(run.workspaceId, run.runId, {
            role: 'item',
            taskId: item.childTaskId,
            processId: item.childProcessId,
            itemKey: item.id,
            memberIndex: index + 1,
        });
    });
    if (run.reduceStep.childTaskId || run.reduceStep.childProcessId) {
        service.linkChild(run.workspaceId, run.runId, {
            role: 'reduce',
            taskId: run.reduceStep.childTaskId,
            processId: run.reduceStep.childProcessId,
            memberIndex: run.items.length + 1,
        });
    }
}
