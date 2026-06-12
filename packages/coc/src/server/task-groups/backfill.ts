/**
 * Task-group registry backfill.
 *
 * Projects runs/sessions persisted before the task-group framework existed
 * into the registry, so historical hierarchies are queryable through the
 * generic surface. Idempotent and derived-data only: it re-applies the same
 * projections the live change hooks use, never mutates feature stores, and
 * is safe to run on every server start.
 */

import { getLogger, LogCategory, type ProcessStore } from '@plusplusoneplusplus/forge';
import type { TaskGroupService } from './task-group-service';
import {
    syncDreamRunToTaskGroup,
    syncForEachRunToTaskGroup,
    syncMapReduceRunToTaskGroup,
    syncRalphSessionToTaskGroup,
} from './feature-sync';
import type { FileForEachRunStore } from '../for-each/for-each-run-store';
import type { FileMapReduceRunStore } from '../map-reduce/map-reduce-run-store';
import type { FileDreamStore } from '../dreams/dream-store';
import { RalphSessionStore } from '../ralph/ralph-session-store';

export interface BackfillTaskGroupsOptions {
    processStore: ProcessStore;
    taskGroupService: TaskGroupService;
    forEachRunStore: FileForEachRunStore;
    mapReduceRunStore: FileMapReduceRunStore;
    dreamStore: FileDreamStore;
    dataDir: string;
}

export interface BackfillTaskGroupsResult {
    workspaces: number;
    groups: number;
    errors: number;
}

export async function backfillTaskGroups(options: BackfillTaskGroupsOptions): Promise<BackfillTaskGroupsResult> {
    const { processStore, taskGroupService, forEachRunStore, mapReduceRunStore, dreamStore, dataDir } = options;
    const ralphSessionStore = new RalphSessionStore({ dataDir });
    const result: BackfillTaskGroupsResult = { workspaces: 0, groups: 0, errors: 0 };

    let workspaces;
    try {
        workspaces = await processStore.getWorkspaces();
    } catch (error) {
        warn('list workspaces', error);
        return { ...result, errors: 1 };
    }

    for (const workspace of workspaces) {
        result.workspaces += 1;

        try {
            for (const summary of await forEachRunStore.listRuns(workspace.id)) {
                const run = await forEachRunStore.getRun(workspace.id, summary.runId);
                if (!run) {continue;}
                syncForEachRunToTaskGroup(taskGroupService, run);
                result.groups += 1;
            }
        } catch (error) {
            result.errors += 1;
            warn(`for-each runs for ${workspace.id}`, error);
        }

        try {
            for (const summary of await mapReduceRunStore.listRuns(workspace.id)) {
                const run = await mapReduceRunStore.getRun(workspace.id, summary.runId);
                if (!run) {continue;}
                syncMapReduceRunToTaskGroup(taskGroupService, run);
                result.groups += 1;
            }
        } catch (error) {
            result.errors += 1;
            warn(`map-reduce runs for ${workspace.id}`, error);
        }

        try {
            for (const sessionId of await ralphSessionStore.listSessionIds(workspace.id)) {
                const record = await ralphSessionStore.readSessionRecord(workspace.id, sessionId);
                if (!record) {continue;}
                syncRalphSessionToTaskGroup(taskGroupService, record);
                result.groups += 1;
            }
        } catch (error) {
            result.errors += 1;
            warn(`ralph sessions for ${workspace.id}`, error);
        }

        try {
            for (const run of await dreamStore.listRuns(workspace.id)) {
                syncDreamRunToTaskGroup(taskGroupService, run);
                result.groups += 1;
            }
        } catch (error) {
            result.errors += 1;
            warn(`dream runs for ${workspace.id}`, error);
        }
    }

    if (result.groups > 0 || result.errors > 0) {
        getLogger().info(
            LogCategory.TASKS,
            `[TaskGroups] Backfill projected ${result.groups} group(s) across ${result.workspaces} workspace(s)` +
            (result.errors > 0 ? ` with ${result.errors} error(s)` : ''),
        );
    }
    return result;
}

function warn(scope: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    getLogger().warn(LogCategory.TASKS, `[TaskGroups] Backfill failed for ${scope}: ${message}`);
}
