/**
 * SQLite-backed Task Group Store
 *
 * Generic registry for parent/child task relationships ("task groups").
 * A task group is a workspace-scoped record describing one hierarchical run
 * (a For Each run, Map Reduce run, Ralph session, Dream run, or any future
 * hierarchical feature). Children are linked with a role label so a single
 * flat membership table covers generation chats, per-item children, reduce
 * steps, iterations, and internal analysis steps.
 *
 * The registry stores the relationship and a normalized summary only —
 * feature-specific orchestration state (plans, items, journals, cards) stays
 * in each feature's own store.
 *
 * All methods are synchronous (better-sqlite3).
 */

import type Database from 'better-sqlite3';

/**
 * Normalized group lifecycle. Feature-specific states (e.g. 'reducing',
 * 'grilling') belong in `extra.detailStatus`, not here.
 */
export type TaskGroupStatus = 'draft' | 'running' | 'completed' | 'failed' | 'cancelled';

export const TASK_GROUP_STATUSES: readonly TaskGroupStatus[] = ['draft', 'running', 'completed', 'failed', 'cancelled'];

export function isTaskGroupStatus(value: unknown): value is TaskGroupStatus {
    return typeof value === 'string' && (TASK_GROUP_STATUSES as readonly string[]).includes(value);
}

/** One linked child of a task group. */
export interface TaskGroupChildLink {
    /** Child role within the group ('generation' | 'item' | 'reduce' | 'iteration' | 'grilling' | 'analyzer' | 'critic' | ...). */
    role: string;
    /** Queue task ID, when known. */
    taskId?: string;
    /** Process ID, when known (may be linked after the task starts). */
    processId?: string;
    /** Stable per-item key (For Each/Map Reduce item ID, Ralph iteration index, ...). */
    itemKey?: string;
    /** Optional ordering hint within the group (e.g. iteration number). */
    memberIndex?: number;
    /** ISO timestamp of when the link was first recorded. */
    linkedAt: string;
}

export interface TaskGroupRecord {
    groupId: string;
    workspaceId: string;
    /** Open group type: 'for-each' | 'map-reduce' | 'ralph' | 'dream' | future types. */
    type: string;
    title?: string;
    status: TaskGroupStatus;
    /** Hidden groups are linkage-only (e.g. Dream internals) — not rendered as chat-list groups. */
    hidden?: boolean;
    /** Process ID of the visible origin chat (generation chat, grilling chat). */
    originProcessId?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    /** Feature summary extras (itemCount, reduceStatus, detailStatus, loopCount, ...). */
    extra?: Record<string, unknown>;
}

/** Group record plus aggregated child links. */
export interface TaskGroupSummaryRecord extends TaskGroupRecord {
    childCount: number;
    children: TaskGroupChildLink[];
}

export interface ListTaskGroupsOptions {
    type?: string;
    status?: TaskGroupStatus | TaskGroupStatus[];
    /** Include hidden (linkage-only) groups. Default: false. */
    includeHidden?: boolean;
}

// ============================================================================
// Row types (snake_case, matching SQLite columns)
// ============================================================================

interface TaskGroupRow {
    workspace_id: string;
    group_id: string;
    type: string;
    title: string | null;
    status: string;
    hidden: number;
    origin_process_id: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    extra: string | null;
}

interface TaskGroupMemberRow {
    id: number;
    workspace_id: string;
    group_id: string;
    role: string;
    task_id: string | null;
    process_id: string | null;
    item_key: string | null;
    member_index: number | null;
    linked_at: string;
}

function rowToRecord(row: TaskGroupRow): TaskGroupRecord {
    const record: TaskGroupRecord = {
        groupId: row.group_id,
        workspaceId: row.workspace_id,
        type: row.type,
        status: isTaskGroupStatus(row.status) ? row.status : 'draft',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
    if (row.title !== null) record.title = row.title;
    if (row.hidden === 1) record.hidden = true;
    if (row.origin_process_id !== null) record.originProcessId = row.origin_process_id;
    if (row.completed_at !== null) record.completedAt = row.completed_at;
    if (row.extra !== null) {
        try {
            const parsed = JSON.parse(row.extra);
            if (parsed && typeof parsed === 'object') {
                record.extra = parsed as Record<string, unknown>;
            }
        } catch {
            // Ignore malformed extra payloads — relationship data stays usable.
        }
    }
    return record;
}

function memberRowToLink(row: TaskGroupMemberRow): TaskGroupChildLink {
    const link: TaskGroupChildLink = {
        role: row.role,
        linkedAt: row.linked_at,
    };
    if (row.task_id !== null) link.taskId = row.task_id;
    if (row.process_id !== null) link.processId = row.process_id;
    if (row.item_key !== null) link.itemKey = row.item_key;
    if (row.member_index !== null) link.memberIndex = row.member_index;
    return link;
}

// ============================================================================
// SqliteTaskGroupStore
// ============================================================================

export class SqliteTaskGroupStore {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    /**
     * INSERT a group, or update its mutable fields when it already exists.
     * `createdAt` is preserved on conflict; `updatedAt` always refreshes.
     */
    upsertGroup(record: TaskGroupRecord): TaskGroupRecord {
        this.db.prepare(`
            INSERT INTO task_groups
                (workspace_id, group_id, type, title, status, hidden,
                 origin_process_id, created_at, updated_at, completed_at, extra)
            VALUES
                (@workspace_id, @group_id, @type, @title, @status, @hidden,
                 @origin_process_id, @created_at, @updated_at, @completed_at, @extra)
            ON CONFLICT(workspace_id, group_id) DO UPDATE SET
                type = excluded.type,
                title = COALESCE(excluded.title, task_groups.title),
                status = excluded.status,
                hidden = excluded.hidden,
                origin_process_id = COALESCE(excluded.origin_process_id, task_groups.origin_process_id),
                updated_at = excluded.updated_at,
                completed_at = excluded.completed_at,
                extra = COALESCE(excluded.extra, task_groups.extra)
        `).run({
            workspace_id: record.workspaceId,
            group_id: record.groupId,
            type: record.type,
            title: record.title ?? null,
            status: record.status,
            hidden: record.hidden ? 1 : 0,
            origin_process_id: record.originProcessId ?? null,
            created_at: record.createdAt,
            updated_at: record.updatedAt,
            completed_at: record.completedAt ?? null,
            extra: record.extra !== undefined ? JSON.stringify(record.extra) : null,
        });
        return this.getGroup(record.workspaceId, record.groupId) as TaskGroupRecord;
    }

    /**
     * Partial-update a group's mutable fields. Returns the updated record,
     * or undefined when the group does not exist.
     */
    updateGroup(
        workspaceId: string,
        groupId: string,
        updates: Partial<Pick<TaskGroupRecord, 'title' | 'status' | 'hidden' | 'originProcessId' | 'completedAt' | 'extra'>> & { updatedAt: string },
    ): TaskGroupSummaryRecord | undefined {
        const existing = this.getGroup(workspaceId, groupId);
        if (!existing) return undefined;

        const merged: TaskGroupRecord = {
            ...existing,
            title: updates.title !== undefined ? updates.title : existing.title,
            status: updates.status !== undefined ? updates.status : existing.status,
            hidden: updates.hidden !== undefined ? updates.hidden : existing.hidden,
            originProcessId: updates.originProcessId !== undefined ? updates.originProcessId : existing.originProcessId,
            completedAt: updates.completedAt !== undefined ? updates.completedAt : existing.completedAt,
            extra: updates.extra !== undefined ? { ...existing.extra, ...updates.extra } : existing.extra,
            updatedAt: updates.updatedAt,
        };
        this.upsertGroup(merged);
        return this.getGroup(workspaceId, groupId);
    }

    getGroup(workspaceId: string, groupId: string): TaskGroupSummaryRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM task_groups WHERE workspace_id = ? AND group_id = ?',
        ).get(workspaceId, groupId) as TaskGroupRow | undefined;
        if (!row) return undefined;

        const children = this.getChildren(workspaceId, groupId);
        return { ...rowToRecord(row), childCount: children.length, children };
    }

    listGroups(workspaceId: string, options?: ListTaskGroupsOptions): TaskGroupSummaryRecord[] {
        const clauses = ['workspace_id = @workspaceId'];
        const params: Record<string, unknown> = { workspaceId };

        if (options?.type !== undefined) {
            clauses.push('type = @type');
            params.type = options.type;
        }
        if (!options?.includeHidden) {
            clauses.push('hidden = 0');
        }
        const statuses = options?.status === undefined
            ? []
            : Array.isArray(options.status) ? options.status : [options.status];
        if (statuses.length > 0) {
            const placeholders = statuses.map((_, i) => `@status${i}`);
            clauses.push(`status IN (${placeholders.join(', ')})`);
            statuses.forEach((status, i) => { params[`status${i}`] = status; });
        }

        const rows = this.db.prepare(
            `SELECT * FROM task_groups WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`,
        ).all(params) as TaskGroupRow[];
        if (rows.length === 0) return [];

        const memberRows = this.db.prepare(
            'SELECT * FROM task_group_members WHERE workspace_id = ? ORDER BY member_index ASC, id ASC',
        ).all(workspaceId) as TaskGroupMemberRow[];
        const childrenByGroup = new Map<string, TaskGroupChildLink[]>();
        for (const memberRow of memberRows) {
            const links = childrenByGroup.get(memberRow.group_id);
            const link = memberRowToLink(memberRow);
            if (links) {
                links.push(link);
            } else {
                childrenByGroup.set(memberRow.group_id, [link]);
            }
        }

        return rows.map(row => {
            const children = childrenByGroup.get(row.group_id) ?? [];
            return { ...rowToRecord(row), childCount: children.length, children };
        });
    }

    /**
     * Record (or refresh) a child link. Matching precedence for upsert:
     * an existing row with the same taskId, then the same processId, then the
     * same (role, itemKey) when neither ID matched but the link carries an
     * itemKey with no IDs recorded yet. Otherwise a new row is inserted, so
     * retries of the same item legitimately add additional links.
     */
    linkChild(
        workspaceId: string,
        groupId: string,
        link: Omit<TaskGroupChildLink, 'linkedAt'> & { linkedAt?: string },
    ): void {
        const linkedAt = link.linkedAt ?? new Date().toISOString();
        const rows = this.db.prepare(
            'SELECT * FROM task_group_members WHERE workspace_id = ? AND group_id = ?',
        ).all(workspaceId, groupId) as TaskGroupMemberRow[];

        const match = (link.taskId !== undefined ? rows.find(row => row.task_id === link.taskId) : undefined)
            ?? (link.processId !== undefined ? rows.find(row => row.process_id === link.processId) : undefined)
            ?? (link.itemKey !== undefined
                ? rows.find(row => row.role === link.role && row.item_key === link.itemKey && row.task_id === null && row.process_id === null)
                : undefined);

        if (match) {
            this.db.prepare(`
                UPDATE task_group_members SET
                    role = @role,
                    task_id = COALESCE(@task_id, task_id),
                    process_id = COALESCE(@process_id, process_id),
                    item_key = COALESCE(@item_key, item_key),
                    member_index = COALESCE(@member_index, member_index)
                WHERE id = @id
            `).run({
                id: match.id,
                role: link.role,
                task_id: link.taskId ?? null,
                process_id: link.processId ?? null,
                item_key: link.itemKey ?? null,
                member_index: link.memberIndex ?? null,
            });
            return;
        }

        this.db.prepare(`
            INSERT INTO task_group_members
                (workspace_id, group_id, role, task_id, process_id, item_key, member_index, linked_at)
            VALUES
                (@workspace_id, @group_id, @role, @task_id, @process_id, @item_key, @member_index, @linked_at)
        `).run({
            workspace_id: workspaceId,
            group_id: groupId,
            role: link.role,
            task_id: link.taskId ?? null,
            process_id: link.processId ?? null,
            item_key: link.itemKey ?? null,
            member_index: link.memberIndex ?? null,
            linked_at: linkedAt,
        });
    }

    getChildren(workspaceId: string, groupId: string): TaskGroupChildLink[] {
        const rows = this.db.prepare(
            'SELECT * FROM task_group_members WHERE workspace_id = ? AND group_id = ? ORDER BY member_index ASC, id ASC',
        ).all(workspaceId, groupId) as TaskGroupMemberRow[];
        return rows.map(memberRowToLink);
    }

    /** DELETE a group and its member links. Returns true when the group existed. */
    removeGroup(workspaceId: string, groupId: string): boolean {
        this.db.prepare(
            'DELETE FROM task_group_members WHERE workspace_id = ? AND group_id = ?',
        ).run(workspaceId, groupId);
        const result = this.db.prepare(
            'DELETE FROM task_groups WHERE workspace_id = ? AND group_id = ?',
        ).run(workspaceId, groupId);
        return result.changes > 0;
    }
}
