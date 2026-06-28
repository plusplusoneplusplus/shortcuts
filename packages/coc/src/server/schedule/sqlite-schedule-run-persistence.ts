/**
 * SqliteScheduleRunPersistence
 *
 * SQLite-backed persistence for schedule run history. Replaces the
 * file-based ScheduleRunPersistence with incremental row upserts in
 * the shared `processes.db` database.
 *
 * Follows the same pattern as SqliteQueuePersistence: receives a
 * shared Database handle, uses prepared statements for hot paths.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type Database from 'better-sqlite3';
import type { ScheduleRunRecord } from './schedule-manager';

// ============================================================================
// Constants
// ============================================================================

const MAX_RUNS_DEFAULT = 100;

// ============================================================================
// SqliteScheduleRunPersistence
// ============================================================================

export class SqliteScheduleRunPersistence {
    private readonly db: Database.Database;
    private readonly maxRuns: number;

    // Prepared statements (cached at construction time)
    private readonly stmtUpsert: Database.Statement;
    private readonly stmtLoadByRepo: Database.Statement;
    private readonly stmtLoadAll: Database.Statement;
    private readonly stmtDeleteByRepo: Database.Statement;
    private readonly stmtDeleteById: Database.Statement;
    private readonly stmtDeleteAll: Database.Statement;
    private readonly stmtCount: Database.Statement;
    private readonly stmtCountByRepo: Database.Statement;

    constructor(db: Database.Database, maxRuns: number = MAX_RUNS_DEFAULT) {
        this.db = db;
        this.maxRuns = maxRuns;

        this.stmtUpsert = db.prepare(`
            INSERT INTO schedule_runs (id, schedule_id, repo_id, started_at, completed_at, status, error, duration_ms, process_id, task_id)
            VALUES (@id, @scheduleId, @repoId, @startedAt, @completedAt, @status, @error, @durationMs, @processId, @taskId)
            ON CONFLICT(id) DO UPDATE SET
                schedule_id  = excluded.schedule_id,
                repo_id      = excluded.repo_id,
                started_at   = excluded.started_at,
                completed_at = excluded.completed_at,
                status       = excluded.status,
                error        = excluded.error,
                duration_ms  = excluded.duration_ms,
                process_id   = excluded.process_id,
                task_id      = excluded.task_id
        `);

        this.stmtLoadByRepo = db.prepare(
            'SELECT * FROM schedule_runs WHERE repo_id = ? ORDER BY started_at DESC',
        );

        this.stmtLoadAll = db.prepare(
            'SELECT * FROM schedule_runs ORDER BY started_at DESC',
        );

        this.stmtDeleteByRepo = db.prepare(
            'DELETE FROM schedule_runs WHERE repo_id = ?',
        );

        this.stmtDeleteById = db.prepare(
            'DELETE FROM schedule_runs WHERE id = ?',
        );

        this.stmtDeleteAll = db.prepare(
            'DELETE FROM schedule_runs',
        );

        this.stmtCount = db.prepare(
            'SELECT COUNT(*) as cnt FROM schedule_runs',
        );

        this.stmtCountByRepo = db.prepare(
            'SELECT COUNT(*) as cnt FROM schedule_runs WHERE repo_id = ?',
        );
    }

    /**
     * Insert or update a single run record.
     */
    upsert(run: ScheduleRunRecord): void {
        this.stmtUpsert.run({
            id: run.id,
            scheduleId: run.scheduleId,
            repoId: run.repoId,
            startedAt: run.startedAt,
            completedAt: run.completedAt ?? null,
            status: run.status,
            error: run.error ?? null,
            durationMs: run.durationMs ?? null,
            processId: run.processId ?? null,
            taskId: run.taskId ?? null,
        });
    }

    /**
     * Bulk-save all runs for a repo. Trims to maxRuns, protecting
     * running/missed entries. Used for import and restore paths.
     */
    save(repoId: string, allRuns: ScheduleRunRecord[]): void {
        const toSave = this.applyTrimming(allRuns);
        const batch = this.db.transaction(() => {
            this.stmtDeleteByRepo.run(repoId);
            for (const run of toSave) {
                this.stmtUpsert.run({
                    id: run.id,
                    scheduleId: run.scheduleId,
                    repoId: run.repoId,
                    startedAt: run.startedAt,
                    completedAt: run.completedAt ?? null,
                    status: run.status,
                    error: run.error ?? null,
                    durationMs: run.durationMs ?? null,
                    processId: run.processId ?? null,
                    taskId: run.taskId ?? null,
                });
            }
        });
        batch();
    }

    /**
     * Load runs for a specific repo. Returns [] if none exist.
     */
    load(repoId: string): ScheduleRunRecord[] {
        const rows = this.stmtLoadByRepo.all(repoId) as ScheduleRunRow[];
        return rows.map(rowToRecord);
    }

    /**
     * Load all run history, grouped by scheduleId.
     * Returns Map<scheduleId, ScheduleRunRecord[]>.
     */
    loadAll(): Map<string, ScheduleRunRecord[]> {
        const result = new Map<string, ScheduleRunRecord[]>();
        const rows = this.stmtLoadAll.all() as ScheduleRunRow[];
        for (const row of rows) {
            const scheduleId = row.schedule_id;
            if (!scheduleId) continue;
            if (!result.has(scheduleId)) {
                result.set(scheduleId, []);
            }
            result.get(scheduleId)!.push(rowToRecord(row));
        }
        return result;
    }

    /**
     * Delete all run history for a repo.
     */
    deleteRepo(repoId: string): void {
        this.stmtDeleteByRepo.run(repoId);
    }

    /**
     * Delete all schedule run rows (used by data wiper).
     */
    deleteAll(): void {
        this.stmtDeleteAll.run();
    }

    /**
     * Count total schedule run rows (used by data wiper).
     */
    count(): number {
        return (this.stmtCount.get() as { cnt: number }).cnt;
    }

    /**
     * Trim old terminal entries for a repo, keeping the newest up to
     * maxRuns while always protecting running/missed entries.
     */
    trim(repoId: string): void {
        const count = (this.stmtCountByRepo.get(repoId) as { cnt: number }).cnt;
        if (count <= this.maxRuns) return;

        const allRuns = this.load(repoId);
        const protected_ = allRuns.filter(r => r.status === 'running' || r.status === 'missed');
        const terminal = allRuns.filter(r => r.status === 'completed' || r.status === 'failed');
        // terminal is already sorted newest-first (from ORDER BY started_at DESC)
        const keepCount = Math.max(0, this.maxRuns - protected_.length);
        const toRemove = terminal.slice(keepCount);

        if (toRemove.length > 0) {
            const batch = this.db.transaction(() => {
                for (const run of toRemove) {
                    this.stmtDeleteById.run(run.id);
                }
            });
            batch();
        }
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    private applyTrimming(runs: ScheduleRunRecord[]): ScheduleRunRecord[] {
        if (runs.length <= this.maxRuns) return runs;

        const terminal = runs.filter(r => r.status === 'completed' || r.status === 'failed');
        const protected_ = runs.filter(r => r.status === 'running' || r.status === 'missed');
        const sorted = [...terminal].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        const keep = sorted.slice(0, Math.max(0, this.maxRuns - protected_.length));
        return [...protected_, ...keep];
    }
}

// ============================================================================
// Internal types & helpers
// ============================================================================

interface ScheduleRunRow {
    id: string;
    schedule_id: string;
    repo_id: string;
    started_at: string;
    completed_at: string | null;
    status: string;
    error: string | null;
    duration_ms: number | null;
    process_id: string | null;
    task_id: string | null;
}

function rowToRecord(row: ScheduleRunRow): ScheduleRunRecord {
    const record: ScheduleRunRecord = {
        id: row.id,
        scheduleId: row.schedule_id,
        repoId: row.repo_id,
        startedAt: row.started_at,
        status: row.status as ScheduleRunRecord['status'],
    };
    if (row.completed_at !== null) record.completedAt = row.completed_at;
    if (row.error !== null) record.error = row.error;
    if (row.duration_ms !== null) record.durationMs = row.duration_ms;
    if (row.process_id !== null) record.processId = row.process_id;
    if (row.task_id !== null) record.taskId = row.task_id;
    return record;
}
