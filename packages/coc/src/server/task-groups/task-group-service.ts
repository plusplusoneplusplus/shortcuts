/**
 * TaskGroupService
 *
 * Server-side facade over the forge task-group registry — the canonical
 * record of parent/child task relationships shared by every hierarchical
 * feature (For Each, Map Reduce, Ralph, Dreams, future group types).
 *
 * Feature orchestrators call this service at the same code points where they
 * update their own run/session stores; the registry stores the relationship
 * and a normalized summary only. The dashboard reads it through
 * `GET /api/workspaces/:id/task-groups`.
 *
 * When the process store is not SQLite-backed (legacy file backend), the
 * registry lives in an in-memory database: linkage still works within the
 * server's lifetime, and the legacy metadata-tag fallbacks in the dashboard
 * keep grouping functional across restarts.
 */

import {
    Database,
    getLogger,
    initializeDatabase,
    LogCategory,
    SqliteProcessStore,
    SqliteTaskGroupStore,
    type ProcessStore,
    type ListTaskGroupsOptions,
    type TaskGroupChildLink,
    type TaskGroupStatus,
    type TaskGroupSummaryRecord,
} from '@plusplusoneplusplus/forge';

export interface CreateTaskGroupInput {
    workspaceId: string;
    groupId: string;
    type: string;
    title?: string;
    status?: TaskGroupStatus;
    hidden?: boolean;
    originProcessId?: string;
    extra?: Record<string, unknown>;
    /** Override the creation timestamp (used by backfill). */
    createdAt?: string;
    /** Completion timestamp; pass undefined to clear when a run resumes. */
    completedAt?: string;
}

export interface UpdateTaskGroupInput {
    title?: string;
    status?: TaskGroupStatus;
    originProcessId?: string;
    completedAt?: string;
    extra?: Record<string, unknown>;
}

export type LinkTaskGroupChildInput = Omit<TaskGroupChildLink, 'linkedAt'> & { linkedAt?: string };

export class TaskGroupService {
    private readonly store: SqliteTaskGroupStore;

    constructor(store: SqliteTaskGroupStore) {
        this.store = store;
    }

    /**
     * Build a service backed by the process store's SQLite database, or an
     * in-memory database when the process store is not SQLite-backed.
     */
    static fromProcessStore(processStore: ProcessStore): TaskGroupService {
        let db: Database.Database;
        if (processStore instanceof SqliteProcessStore) {
            db = processStore.getDatabase();
        } else {
            db = new Database(':memory:');
            initializeDatabase(db);
        }
        return new TaskGroupService(new SqliteTaskGroupStore(db));
    }

    /**
     * Register (or refresh) a group. Safe to call repeatedly — existing
     * groups keep their creation time and accumulate updates.
     */
    ensureGroup(input: CreateTaskGroupInput): TaskGroupSummaryRecord | undefined {
        const now = new Date().toISOString();
        try {
            this.store.upsertGroup({
                groupId: input.groupId,
                workspaceId: input.workspaceId,
                type: input.type,
                title: input.title,
                status: input.status ?? 'draft',
                hidden: input.hidden,
                originProcessId: input.originProcessId,
                createdAt: input.createdAt ?? now,
                updatedAt: now,
                completedAt: input.completedAt,
                extra: input.extra,
            });
            return this.store.getGroup(input.workspaceId, input.groupId);
        } catch (error) {
            this.warn('ensureGroup', input.workspaceId, input.groupId, error);
            return undefined;
        }
    }

    /** Partial-update a group. No-op (with a warning) when the group is missing. */
    updateGroup(workspaceId: string, groupId: string, updates: UpdateTaskGroupInput): TaskGroupSummaryRecord | undefined {
        try {
            return this.store.updateGroup(workspaceId, groupId, {
                ...updates,
                updatedAt: new Date().toISOString(),
            });
        } catch (error) {
            this.warn('updateGroup', workspaceId, groupId, error);
            return undefined;
        }
    }

    /** Record (or refresh) a child link for a group. */
    linkChild(workspaceId: string, groupId: string, link: LinkTaskGroupChildInput): void {
        try {
            this.store.linkChild(workspaceId, groupId, link);
        } catch (error) {
            this.warn('linkChild', workspaceId, groupId, error);
        }
    }

    getGroup(workspaceId: string, groupId: string): TaskGroupSummaryRecord | undefined {
        return this.store.getGroup(workspaceId, groupId);
    }

    listGroups(workspaceId: string, options?: ListTaskGroupsOptions): TaskGroupSummaryRecord[] {
        return this.store.listGroups(workspaceId, options);
    }

    removeGroup(workspaceId: string, groupId: string): boolean {
        return this.store.removeGroup(workspaceId, groupId);
    }

    /**
     * Registry writes are best-effort: a registry failure must never break
     * feature orchestration, so errors are logged and swallowed.
     */
    private warn(operation: string, workspaceId: string, groupId: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        getLogger().warn(LogCategory.TASKS, `[TaskGroupService] ${operation} failed for ${workspaceId}/${groupId}: ${message}`);
    }
}
