/**
 * SQLite-backed Queue Store
 *
 * Persists queue tasks and per-repo queue state in the existing SQLite
 * database.  All methods are synchronous (better-sqlite3).
 */

import type Database from 'better-sqlite3';
import type { QueuedTask, QueueStatus, PauseReason, QueueItem, PauseMarker, PauseDurationHours } from './queue/types';

// ============================================================================
// Row types (snake_case, matching SQLite columns)
// ============================================================================

interface QueueTaskRow {
    id: string;
    repo_id: string;
    folder_path: string | null;
    type: string;
    priority: string;
    status: string;
    created_at: number;
    started_at: number | null;
    completed_at: number | null;
    display_name: string | null;
    process_id: string | null;
    error: string | null;
    retry_count: number;
    concurrency_mode: string | null;
    frozen: number;
    admitted: number;
    kind?: string | null;
    queue_position?: number | null;
    duration_hours?: number | null;
    payload: string;
    config: string;
    result: string | null;
}

export interface QueueRepoState {
    isPaused: boolean;
    pauseReason?: PauseReason;
    queuePaused?: boolean;
    queuePausedUntil?: number;
    autopilotPaused?: boolean;
    autopilotPausedUntil?: number;
}

interface RepoStateRow {
    repo_id: string;
    is_paused: number;
    pause_reason: string | null;
    queue_paused?: number;
    queue_paused_until?: number | null;
    autopilot_paused?: number;
    autopilot_paused_until?: number | null;
}

// ============================================================================
// Serialization helpers
// ============================================================================

const ALLOWED_PAUSE_DURATION_HOURS = new Set<PauseDurationHours>([1, 2, 3, 4, 8]);

function normalizePauseDurationHours(value: number | null | undefined): PauseDurationHours | undefined {
    if (value === null || value === undefined) return undefined;
    if (ALLOWED_PAUSE_DURATION_HOURS.has(value as PauseDurationHours)) {
        return value as PauseDurationHours;
    }
    throw new Error(`Invalid persisted pause marker durationHours: ${value}`);
}

function taskToRow(task: QueuedTask, queuePosition?: number): QueueTaskRow {
    return {
        id: task.id,
        repo_id: task.repoId ?? '',
        folder_path: task.folderPath ?? null,
        type: task.type,
        priority: task.priority,
        status: task.status,
        created_at: task.createdAt,
        started_at: task.startedAt ?? null,
        completed_at: task.completedAt ?? null,
        display_name: task.displayName ?? null,
        process_id: task.processId ?? null,
        error: task.error ?? null,
        retry_count: task.retryCount ?? 0,
        concurrency_mode: task.concurrencyMode ?? null,
        frozen: task.frozen ? 1 : 0,
        admitted: task.admitted ? 1 : 0,
        kind: 'task',
        queue_position: queuePosition ?? null,
        duration_hours: null,
        payload: JSON.stringify(task.payload),
        config: JSON.stringify(task.config),
        result: task.result !== undefined ? JSON.stringify(task.result) : null,
    };
}

function pauseMarkerToRow(marker: PauseMarker, repoId: string, queuePosition?: number): QueueTaskRow {
    return {
        id: marker.id,
        repo_id: marker.repoId ?? repoId,
        folder_path: null,
        type: 'pause-marker',
        priority: 'normal',
        status: 'queued',
        created_at: marker.createdAt,
        started_at: null,
        completed_at: null,
        display_name: null,
        process_id: null,
        error: null,
        retry_count: 0,
        concurrency_mode: null,
        frozen: 0,
        admitted: 0,
        kind: 'pause-marker',
        queue_position: queuePosition ?? null,
        duration_hours: marker.durationHours ?? null,
        payload: '{}',
        config: '{}',
        result: null,
    };
}

function rowToTask(row: QueueTaskRow): QueuedTask {
    const task: QueuedTask = {
        id: row.id,
        type: row.type,
        priority: row.priority as QueuedTask['priority'],
        status: row.status as QueuedTask['status'],
        createdAt: row.created_at,
        payload: JSON.parse(row.payload),
        config: JSON.parse(row.config),
    };

    if (row.repo_id) task.repoId = row.repo_id;
    if (row.folder_path !== null) task.folderPath = row.folder_path;
    if (row.started_at !== null) task.startedAt = row.started_at;
    if (row.completed_at !== null) task.completedAt = row.completed_at;
    if (row.display_name !== null) task.displayName = row.display_name;
    if (row.process_id !== null) task.processId = row.process_id;
    if (row.result !== null) task.result = JSON.parse(row.result);
    if (row.error !== null) task.error = row.error;
    if (row.retry_count !== 0) task.retryCount = row.retry_count;
    if (row.concurrency_mode !== null) task.concurrencyMode = row.concurrency_mode as QueuedTask['concurrencyMode'];
    if (row.frozen === 1) task.frozen = true;
    if (row.admitted === 1) task.admitted = true;

    return task;
}

function rowToQueueItem(row: QueueTaskRow): QueueItem {
    if (row.kind === 'pause-marker' || row.type === 'pause-marker') {
        const durationHours = normalizePauseDurationHours(row.duration_hours);
        return {
            kind: 'pause-marker',
            id: row.id,
            ...(row.repo_id ? { repoId: row.repo_id } : {}),
            createdAt: row.created_at,
            ...(durationHours !== undefined ? { durationHours } : {}),
        };
    }
    return rowToTask(row);
}

function pauseReasonToJson(r?: PauseReason): string | null {
    return r !== undefined ? JSON.stringify(r) : null;
}

function jsonToPauseReason(s: string | null): PauseReason | undefined {
    return s !== null ? (JSON.parse(s) as PauseReason) : undefined;
}

// ============================================================================
// SqliteQueueStore
// ============================================================================

export interface SqliteQueueStoreOptions {
    db: Database.Database;
}

export class SqliteQueueStore {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    // ── queue_tasks ──────────────────────────────────────────────────

    /** INSERT OR REPLACE a task row. Serializes payload/config/result to JSON. */
    upsertQueueTask(task: QueuedTask, queuePosition?: number): void {
        const row = taskToRow(task, queuePosition);
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO queue_tasks
                (id, repo_id, folder_path, type, priority, status,
                 created_at, started_at, completed_at, display_name,
                 process_id, error, retry_count, concurrency_mode,
                 frozen, admitted, kind, queue_position, duration_hours,
                 payload, config, result)
            VALUES
                (@id, @repo_id, @folder_path, @type, @priority, @status,
                 @created_at, @started_at, @completed_at, @display_name,
                 @process_id, @error, @retry_count, @concurrency_mode,
                 @frozen, @admitted, @kind, @queue_position, @duration_hours,
                 @payload, @config, @result)
        `);
        stmt.run(row);
    }

    /** INSERT OR REPLACE any queued item row, including pause markers. */
    upsertQueueItem(item: QueueItem, repoId: string, queuePosition?: number): void {
        if ((item as PauseMarker).kind === 'pause-marker') {
            const row = pauseMarkerToRow(item as PauseMarker, repoId, queuePosition);
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO queue_tasks
                    (id, repo_id, folder_path, type, priority, status,
                     created_at, started_at, completed_at, display_name,
                     process_id, error, retry_count, concurrency_mode,
                     frozen, admitted, kind, queue_position, duration_hours,
                     payload, config, result)
                VALUES
                    (@id, @repo_id, @folder_path, @type, @priority, @status,
                     @created_at, @started_at, @completed_at, @display_name,
                     @process_id, @error, @retry_count, @concurrency_mode,
                     @frozen, @admitted, @kind, @queue_position, @duration_hours,
                     @payload, @config, @result)
            `);
            stmt.run(row);
            return;
        }
        this.upsertQueueTask(item as QueuedTask, queuePosition);
    }

    /** DELETE a single task by id. No-op if not found. */
    removeQueueTask(id: string): void {
        this.db.prepare('DELETE FROM queue_tasks WHERE id = ?').run(id);
    }

    /**
     * SELECT tasks with optional filters.
     * If repoId is provided, filters by repo_id.
     * If statuses is provided (non-empty), filters by status IN (...).
     * Returns deserialized QueuedTask[].
     */
    getQueueTasks(repoId?: string, statuses?: QueueStatus[]): QueuedTask[] {
        const clauses: string[] = [];
        const params: Record<string, unknown> = {};

        if (repoId !== undefined) {
            clauses.push('repo_id = @repoId');
            params.repoId = repoId;
        }

        if (statuses !== undefined && statuses.length > 0) {
            const placeholders = statuses.map((_, i) => `@s${i}`);
            clauses.push(`status IN (${placeholders.join(', ')})`);
            statuses.forEach((s, i) => { params[`s${i}`] = s; });
        }

        clauses.push("(kind IS NULL OR kind = 'task')");

        let sql = 'SELECT * FROM queue_tasks';
        if (clauses.length > 0) {
            sql += ' WHERE ' + clauses.join(' AND ');
        }
        sql += ' ORDER BY CASE WHEN queue_position IS NULL THEN 1 ELSE 0 END, queue_position ASC, created_at ASC';

        const rows = this.db.prepare(sql).all(params) as QueueTaskRow[];
        return rows.map(rowToTask);
    }

    /**
     * SELECT queued items with optional filters. Includes pause markers.
     */
    getQueueItems(repoId?: string, statuses?: QueueStatus[]): QueueItem[] {
        const clauses: string[] = [];
        const params: Record<string, unknown> = {};

        if (repoId !== undefined) {
            clauses.push('repo_id = @repoId');
            params.repoId = repoId;
        }

        if (statuses !== undefined && statuses.length > 0) {
            const placeholders = statuses.map((_, i) => `@s${i}`);
            clauses.push(`status IN (${placeholders.join(', ')})`);
            statuses.forEach((s, i) => { params[`s${i}`] = s; });
        }

        let sql = 'SELECT * FROM queue_tasks';
        if (clauses.length > 0) {
            sql += ' WHERE ' + clauses.join(' AND ');
        }
        sql += ' ORDER BY CASE WHEN queue_position IS NULL THEN 1 ELSE 0 END, queue_position ASC, created_at ASC';

        const rows = this.db.prepare(sql).all(params) as QueueTaskRow[];
        return rows.map(rowToQueueItem);
    }

    /**
     * DELETE tasks. If repoId is provided, scoped to that repo.
     * Otherwise deletes all tasks.
     */
    clearQueueTasks(repoId?: string): void {
        if (repoId !== undefined) {
            this.db.prepare('DELETE FROM queue_tasks WHERE repo_id = ?').run(repoId);
        } else {
            this.db.prepare('DELETE FROM queue_tasks').run();
        }
    }

    // ── queue_repo_state ────────────────────────────────────────────

    /** SELECT queue_repo_state for a repo. Returns undefined if not found. */
    getQueueRepoState(repoId: string): QueueRepoState | undefined {
        const row = this.db.prepare(
            'SELECT * FROM queue_repo_state WHERE repo_id = ?',
        ).get(repoId) as RepoStateRow | undefined;

        if (!row) return undefined;

        return {
            isPaused: row.is_paused === 1,
            pauseReason: jsonToPauseReason(row.pause_reason),
            queuePaused: row.queue_paused === 1,
            queuePausedUntil: row.queue_paused_until ?? undefined,
            autopilotPaused: row.autopilot_paused === 1,
            autopilotPausedUntil: row.autopilot_paused_until ?? undefined,
        };
    }

    /** INSERT OR REPLACE queue_repo_state. Serializes pauseReason to JSON. */
    setQueueRepoState(repoId: string, isPaused: boolean, pauseReason?: PauseReason): void {
        this.db.prepare(`
            INSERT INTO queue_repo_state (repo_id, is_paused, pause_reason)
            VALUES (?, ?, ?)
            ON CONFLICT(repo_id) DO UPDATE SET
                is_paused = excluded.is_paused,
                pause_reason = excluded.pause_reason
        `).run(repoId, isPaused ? 1 : 0, pauseReasonToJson(pauseReason));
    }

    /** Persist manager-level queue and autopilot pause state for this repo queue. */
    setQueueControlState(
        repoId: string,
        state: {
            queuePaused: boolean;
            queuePausedUntil?: number;
            autopilotPaused: boolean;
            autopilotPausedUntil?: number;
        }
    ): void {
        this.db.prepare(`
            INSERT INTO queue_repo_state (
                repo_id,
                queue_paused,
                queue_paused_until,
                autopilot_paused,
                autopilot_paused_until
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(repo_id) DO UPDATE SET
                queue_paused = excluded.queue_paused,
                queue_paused_until = excluded.queue_paused_until,
                autopilot_paused = excluded.autopilot_paused,
                autopilot_paused_until = excluded.autopilot_paused_until
        `).run(
            repoId,
            state.queuePaused ? 1 : 0,
            state.queuePausedUntil ?? null,
            state.autopilotPaused ? 1 : 0,
            state.autopilotPausedUntil ?? null,
        );
    }

    /** DELETE queue_repo_state row for a repo. No-op if not found. */
    removeQueueRepoState(repoId: string): void {
        this.db.prepare('DELETE FROM queue_repo_state WHERE repo_id = ?').run(repoId);
    }

    /** SELECT all queue_repo_state rows. Returns a Map keyed by repoId. */
    getAllQueueRepoStates(): Map<string, QueueRepoState> {
        const rows = this.db.prepare('SELECT * FROM queue_repo_state').all() as RepoStateRow[];
        const map = new Map<string, QueueRepoState>();

        for (const row of rows) {
            map.set(row.repo_id, {
                isPaused: row.is_paused === 1,
                pauseReason: jsonToPauseReason(row.pause_reason),
                queuePaused: row.queue_paused === 1,
                queuePausedUntil: row.queue_paused_until ?? undefined,
                autopilotPaused: row.autopilot_paused === 1,
                autopilotPausedUntil: row.autopilot_paused_until ?? undefined,
            });
        }

        return map;
    }
}
