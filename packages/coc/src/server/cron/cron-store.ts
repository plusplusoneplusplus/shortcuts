/**
 * CRUD operations for `CronEntry` records in the shared `processes.db`.
 * Follows the same pattern as `SqliteScheduleRunPersistence`: receives a
 * shared Database handle, uses prepared statements for hot paths.
 *
 * The `crons` table is created by `initializeDatabase` in forge's
 * `sqlite-schema.ts`.
 */

import type Database from 'better-sqlite3';
import type { CronEntry, CronStatus } from './cron-types';
import { MAX_ACTIVE_CRONS } from './cron-types';

// ============================================================================
// CronStore
// ============================================================================

export class CronStore {
    private readonly db: Database.Database;

    // Prepared statements
    private readonly stmtInsert: Database.Statement;
    private readonly stmtUpdate: Database.Statement;
    private readonly stmtGetById: Database.Statement;
    private readonly stmtGetByProcess: Database.Statement;
    private readonly stmtGetByWorkspace: Database.Statement;
    private readonly stmtGetActive: Database.Statement;
    private readonly stmtGetAll: Database.Statement;
    private readonly stmtDelete: Database.Statement;
    private readonly stmtDeleteAll: Database.Statement;
    private readonly stmtCountActive: Database.Statement;
    private readonly stmtPauseActive: Database.Statement;

    constructor(db: Database.Database) {
        this.db = db;
        this.ensureTable();

        this.stmtInsert = db.prepare(`
            INSERT INTO crons (
                id, process_id, description, interval_ms, status,
                created_at, last_tick_at, next_tick_at, tick_count,
                consecutive_failures, expires_at, paused_reason,
                prompt, model, workspace_id
            ) VALUES (
                @id, @processId, @description, @intervalMs, @status,
                @createdAt, @lastTickAt, @nextTickAt, @tickCount,
                @consecutiveFailures, @expiresAt, @pausedReason,
                @prompt, @model, @workspaceId
            )
        `);

        this.stmtUpdate = db.prepare(`
            UPDATE crons SET
                description = @description,
                interval_ms = @intervalMs,
                status = @status,
                last_tick_at = @lastTickAt,
                next_tick_at = @nextTickAt,
                tick_count = @tickCount,
                consecutive_failures = @consecutiveFailures,
                expires_at = @expiresAt,
                paused_reason = @pausedReason,
                prompt = @prompt,
                model = @model,
                workspace_id = @workspaceId
            WHERE id = @id
        `);

        this.stmtGetById = db.prepare('SELECT * FROM crons WHERE id = ?');
        this.stmtGetByProcess = db.prepare('SELECT * FROM crons WHERE process_id = ? ORDER BY created_at DESC');
        this.stmtGetByWorkspace = db.prepare('SELECT * FROM crons WHERE workspace_id = ? ORDER BY created_at DESC');
        this.stmtGetActive = db.prepare("SELECT * FROM crons WHERE status = 'active' ORDER BY created_at ASC");
        this.stmtGetAll = db.prepare('SELECT * FROM crons ORDER BY created_at DESC');
        this.stmtDelete = db.prepare('DELETE FROM crons WHERE id = ?');
        this.stmtDeleteAll = db.prepare('DELETE FROM crons');
        this.stmtCountActive = db.prepare("SELECT COUNT(*) as cnt FROM crons WHERE status = 'active'");
        this.stmtPauseActive = db.prepare(`
            UPDATE crons SET status = 'paused', paused_reason = @reason, next_tick_at = NULL
            WHERE status = 'active'
        `);
    }

    // ========================================================================
    // CRUD
    // ========================================================================

    /**
     * Insert a new cron entry.
     * Throws if the server-wide active cron limit would be exceeded.
     */
    insert(cron: CronEntry): void {
        const activeCount = this.countActive();
        if (cron.status === 'active' && activeCount >= MAX_ACTIVE_CRONS) {
            throw new Error(`Server-wide active cron limit reached (${MAX_ACTIVE_CRONS})`);
        }
        this.stmtInsert.run(toRow(cron));
    }

    /** Update an existing cron entry (by id). */
    update(cron: CronEntry): void {
        this.stmtUpdate.run(toRow(cron));
    }

    /** Get a cron by id, or null if not found. */
    getById(id: string): CronEntry | null {
        const row = this.stmtGetById.get(id) as CronRow | undefined;
        return row ? rowToEntry(row) : null;
    }

    /** Get all crons for a given process, newest first. */
    getByProcess(processId: string): CronEntry[] {
        const rows = this.stmtGetByProcess.all(processId) as CronRow[];
        return rows.map(rowToEntry);
    }

    /** Get all crons for a given workspace, newest first. */
    getByWorkspace(workspaceId: string): CronEntry[] {
        const rows = this.stmtGetByWorkspace.all(workspaceId) as CronRow[];
        return rows.map(rowToEntry);
    }

    /** Get all active crons. */
    getActive(): CronEntry[] {
        const rows = this.stmtGetActive.all() as CronRow[];
        return rows.map(rowToEntry);
    }

    /** Get all crons (any status). */
    getAll(): CronEntry[] {
        const rows = this.stmtGetAll.all() as CronRow[];
        return rows.map(rowToEntry);
    }

    /** Delete a cron by id. */
    delete(id: string): boolean {
        const result = this.stmtDelete.run(id);
        return result.changes > 0;
    }

    /** Delete all crons (used by data wiper). */
    deleteAll(): void {
        this.stmtDeleteAll.run();
    }

    /** Count active crons server-wide. */
    countActive(): number {
        return (this.stmtCountActive.get() as { cnt: number }).cnt;
    }

    /** Pause all active crons with the given reason. */
    pauseAllActive(reason: string): number {
        const result = this.stmtPauseActive.run({ reason });
        return result.changes;
    }

    // ========================================================================
    // Table setup (idempotent)
    // ========================================================================

    /**
     * Ensure the crons table exists. Called in the constructor so that
     * the store works even if the schema migration hasn't been applied yet
     * (e.g. in tests using in-memory databases).
     */
    private ensureTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS crons (
                id                    TEXT PRIMARY KEY,
                process_id            TEXT NOT NULL,
                description           TEXT NOT NULL DEFAULT '',
                interval_ms           INTEGER NOT NULL,
                status                TEXT NOT NULL DEFAULT 'active',
                created_at            TEXT NOT NULL,
                last_tick_at          TEXT,
                next_tick_at          TEXT,
                tick_count            INTEGER NOT NULL DEFAULT 0,
                consecutive_failures  INTEGER NOT NULL DEFAULT 0,
                expires_at            TEXT NOT NULL,
                paused_reason         TEXT,
                prompt                TEXT NOT NULL DEFAULT '',
                model                 TEXT,
                workspace_id          TEXT
            )
        `);

        // Migrate existing databases that lack the workspace_id column.
        const cols = this.db.pragma('table_info(crons)') as Array<{ name: string }>;
        if (!cols.some(c => c.name === 'workspace_id')) {
            this.db.exec('ALTER TABLE crons ADD COLUMN workspace_id TEXT');
        }

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_crons_process_id ON crons(process_id);
            CREATE INDEX IF NOT EXISTS idx_crons_status ON crons(status);
            CREATE INDEX IF NOT EXISTS idx_crons_workspace_id ON crons(workspace_id);
        `);
    }
}

// ============================================================================
// Internal Row Type & Conversion
// ============================================================================

interface CronRow {
    id: string;
    process_id: string;
    description: string;
    interval_ms: number;
    status: string;
    created_at: string;
    last_tick_at: string | null;
    next_tick_at: string | null;
    tick_count: number;
    consecutive_failures: number;
    expires_at: string;
    paused_reason: string | null;
    prompt: string;
    model: string | null;
    workspace_id: string | null;
}

function rowToEntry(row: CronRow): CronEntry {
    return {
        id: row.id,
        processId: row.process_id,
        description: row.description,
        intervalMs: row.interval_ms,
        status: row.status as CronStatus,
        createdAt: row.created_at,
        lastTickAt: row.last_tick_at,
        nextTickAt: row.next_tick_at,
        tickCount: row.tick_count,
        consecutiveFailures: row.consecutive_failures,
        expiresAt: row.expires_at,
        pausedReason: row.paused_reason,
        prompt: row.prompt,
        model: row.model,
        ...(row.workspace_id != null ? { workspaceId: row.workspace_id } : {}),
    };
}

function toRow(entry: CronEntry): Record<string, unknown> {
    return {
        id: entry.id,
        processId: entry.processId,
        description: entry.description,
        intervalMs: entry.intervalMs,
        status: entry.status,
        createdAt: entry.createdAt,
        lastTickAt: entry.lastTickAt ?? null,
        nextTickAt: entry.nextTickAt ?? null,
        tickCount: entry.tickCount,
        consecutiveFailures: entry.consecutiveFailures,
        expiresAt: entry.expiresAt,
        pausedReason: entry.pausedReason ?? null,
        prompt: entry.prompt,
        model: entry.model ?? null,
        workspaceId: entry.workspaceId ?? null,
    };
}
