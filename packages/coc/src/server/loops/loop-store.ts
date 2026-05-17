/**
 * Loop Store — SQLite Persistence
 *
 * CRUD operations for `LoopEntry` records in the shared `processes.db`.
 * Follows the same pattern as `SqliteScheduleRunPersistence`: receives a
 * shared Database handle, uses prepared statements for hot paths.
 *
 * The `loops` table is created by `initializeDatabase` in forge's
 * `sqlite-schema.ts`.
 */

import type Database from 'better-sqlite3';
import type { LoopEntry, LoopStatus } from './loop-types';
import { MAX_ACTIVE_LOOPS } from './loop-types';

// ============================================================================
// LoopStore
// ============================================================================

export class LoopStore {
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
            INSERT INTO loops (
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
            UPDATE loops SET
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

        this.stmtGetById = db.prepare('SELECT * FROM loops WHERE id = ?');
        this.stmtGetByProcess = db.prepare('SELECT * FROM loops WHERE process_id = ? ORDER BY created_at DESC');
        this.stmtGetByWorkspace = db.prepare('SELECT * FROM loops WHERE workspace_id = ? ORDER BY created_at DESC');
        this.stmtGetActive = db.prepare("SELECT * FROM loops WHERE status = 'active' ORDER BY created_at ASC");
        this.stmtGetAll = db.prepare('SELECT * FROM loops ORDER BY created_at DESC');
        this.stmtDelete = db.prepare('DELETE FROM loops WHERE id = ?');
        this.stmtDeleteAll = db.prepare('DELETE FROM loops');
        this.stmtCountActive = db.prepare("SELECT COUNT(*) as cnt FROM loops WHERE status = 'active'");
        this.stmtPauseActive = db.prepare(`
            UPDATE loops SET status = 'paused', paused_reason = @reason, next_tick_at = NULL
            WHERE status = 'active'
        `);
    }

    // ========================================================================
    // CRUD
    // ========================================================================

    /**
     * Insert a new loop entry.
     * Throws if the server-wide active loop limit would be exceeded.
     */
    insert(loop: LoopEntry): void {
        const activeCount = this.countActive();
        if (loop.status === 'active' && activeCount >= MAX_ACTIVE_LOOPS) {
            throw new Error(`Server-wide active loop limit reached (${MAX_ACTIVE_LOOPS})`);
        }
        this.stmtInsert.run(toRow(loop));
    }

    /** Update an existing loop entry (by id). */
    update(loop: LoopEntry): void {
        this.stmtUpdate.run(toRow(loop));
    }

    /** Get a loop by id, or null if not found. */
    getById(id: string): LoopEntry | null {
        const row = this.stmtGetById.get(id) as LoopRow | undefined;
        return row ? rowToEntry(row) : null;
    }

    /** Get all loops for a given process, newest first. */
    getByProcess(processId: string): LoopEntry[] {
        const rows = this.stmtGetByProcess.all(processId) as LoopRow[];
        return rows.map(rowToEntry);
    }

    /** Get all loops for a given workspace, newest first. */
    getByWorkspace(workspaceId: string): LoopEntry[] {
        const rows = this.stmtGetByWorkspace.all(workspaceId) as LoopRow[];
        return rows.map(rowToEntry);
    }

    /** Get all active loops. */
    getActive(): LoopEntry[] {
        const rows = this.stmtGetActive.all() as LoopRow[];
        return rows.map(rowToEntry);
    }

    /** Get all loops (any status). */
    getAll(): LoopEntry[] {
        const rows = this.stmtGetAll.all() as LoopRow[];
        return rows.map(rowToEntry);
    }

    /** Delete a loop by id. */
    delete(id: string): boolean {
        const result = this.stmtDelete.run(id);
        return result.changes > 0;
    }

    /** Delete all loops (used by data wiper). */
    deleteAll(): void {
        this.stmtDeleteAll.run();
    }

    /** Count active loops server-wide. */
    countActive(): number {
        return (this.stmtCountActive.get() as { cnt: number }).cnt;
    }

    /** Pause all active loops with the given reason. */
    pauseAllActive(reason: string): number {
        const result = this.stmtPauseActive.run({ reason });
        return result.changes;
    }

    // ========================================================================
    // Table setup (idempotent)
    // ========================================================================

    /**
     * Ensure the loops table exists. Called in the constructor so that
     * the store works even if the schema migration hasn't been applied yet
     * (e.g. in tests using in-memory databases).
     */
    private ensureTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS loops (
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
        const cols = this.db.pragma('table_info(loops)') as Array<{ name: string }>;
        if (!cols.some(c => c.name === 'workspace_id')) {
            this.db.exec('ALTER TABLE loops ADD COLUMN workspace_id TEXT');
        }

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_loops_process_id ON loops(process_id);
            CREATE INDEX IF NOT EXISTS idx_loops_status ON loops(status);
            CREATE INDEX IF NOT EXISTS idx_loops_workspace_id ON loops(workspace_id);
        `);
    }
}

// ============================================================================
// Internal Row Type & Conversion
// ============================================================================

interface LoopRow {
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

function rowToEntry(row: LoopRow): LoopEntry {
    return {
        id: row.id,
        processId: row.process_id,
        description: row.description,
        intervalMs: row.interval_ms,
        status: row.status as LoopStatus,
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

function toRow(entry: LoopEntry): Record<string, unknown> {
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
