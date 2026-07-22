/**
 * Wakeup Store — SQLite Persistence
 *
 * CRUD operations for `WakeupEntry` records in the shared `processes.db`.
 * Follows the same pattern as `LoopStore`: receives a shared Database handle,
 * uses prepared statements for hot paths, and self-creates its table so it
 * works even against databases predating the `wakeups` schema (e.g. in-memory
 * test databases).
 */

import type Database from 'better-sqlite3';
import type { WakeupEntry, WakeupStatus } from './wakeup-types';

// ============================================================================
// WakeupStore
// ============================================================================

export class WakeupStore {
    private readonly db: Database.Database;

    private readonly stmtInsert: Database.Statement;
    private readonly stmtGetById: Database.Statement;
    private readonly stmtGetByProcess: Database.Statement;
    private readonly stmtGetByWorkspace: Database.Statement;
    private readonly stmtGetPending: Database.Statement;
    private readonly stmtGetAll: Database.Statement;
    private readonly stmtMarkFired: Database.Statement;
    private readonly stmtMarkFailed: Database.Statement;
    private readonly stmtCancel: Database.Statement;
    private readonly stmtDelete: Database.Statement;
    private readonly stmtDeleteAll: Database.Statement;
    private readonly stmtPruneTerminalBefore: Database.Statement;

    constructor(db: Database.Database) {
        this.db = db;
        this.ensureTable();

        this.stmtInsert = db.prepare(`
            INSERT INTO wakeups (
                id, process_id, prompt, model, status,
                created_at, fires_at, fired_at, failure_reason, workspace_id
            ) VALUES (
                @id, @processId, @prompt, @model, @status,
                @createdAt, @firesAt, @firedAt, @failureReason, @workspaceId
            )
        `);

        this.stmtGetById = db.prepare('SELECT * FROM wakeups WHERE id = ?');
        this.stmtGetByProcess = db.prepare('SELECT * FROM wakeups WHERE process_id = ? ORDER BY created_at DESC');
        this.stmtGetByWorkspace = db.prepare('SELECT * FROM wakeups WHERE workspace_id = ? ORDER BY created_at DESC');
        this.stmtGetPending = db.prepare("SELECT * FROM wakeups WHERE status = 'pending' ORDER BY fires_at ASC");
        this.stmtGetAll = db.prepare('SELECT * FROM wakeups ORDER BY created_at DESC');
        this.stmtMarkFired = db.prepare("UPDATE wakeups SET status = 'fired', fired_at = @firedAt, failure_reason = NULL WHERE id = @id AND status = 'pending'");
        this.stmtMarkFailed = db.prepare("UPDATE wakeups SET status = 'failed', fired_at = @firedAt, failure_reason = @failureReason WHERE id = @id AND status = 'pending'");
        this.stmtCancel = db.prepare("UPDATE wakeups SET status = 'cancelled', fired_at = NULL WHERE id = @id AND status = 'pending'");
        this.stmtDelete = db.prepare('DELETE FROM wakeups WHERE id = ?');
        this.stmtDeleteAll = db.prepare('DELETE FROM wakeups');
        this.stmtPruneTerminalBefore = db.prepare("DELETE FROM wakeups WHERE status != 'pending' AND created_at < ?");
    }

    // ========================================================================
    // CRUD
    // ========================================================================

    /** Insert a new wakeup entry. */
    insert(wakeup: WakeupEntry): void {
        this.stmtInsert.run(toRow(wakeup));
    }

    /** Get a wakeup by id, or null if not found. */
    getById(id: string): WakeupEntry | null {
        const row = this.stmtGetById.get(id) as WakeupRow | undefined;
        return row ? rowToEntry(row) : null;
    }

    /** Get all wakeups for a given process, newest first. */
    getByProcess(processId: string): WakeupEntry[] {
        return (this.stmtGetByProcess.all(processId) as WakeupRow[]).map(rowToEntry);
    }

    /** Get all wakeups for a given workspace, newest first. */
    getByWorkspace(workspaceId: string): WakeupEntry[] {
        return (this.stmtGetByWorkspace.all(workspaceId) as WakeupRow[]).map(rowToEntry);
    }

    /** Get all pending wakeups, soonest fire time first. */
    getPending(): WakeupEntry[] {
        return (this.stmtGetPending.all() as WakeupRow[]).map(rowToEntry);
    }

    /** Get all wakeups (any status). */
    getAll(): WakeupEntry[] {
        return (this.stmtGetAll.all() as WakeupRow[]).map(rowToEntry);
    }

    /**
     * Mark a pending wakeup as fired. No-op (returns false) if the wakeup is
     * missing or already terminal, so a duplicate fire cannot resurrect state.
     */
    markFired(id: string, firedAt: string): boolean {
        return this.stmtMarkFired.run({ id, firedAt }).changes > 0;
    }

    /**
     * Mark a pending wakeup as failed with a reason. No-op (returns false) if
     * the wakeup is missing or already terminal.
     */
    markFailed(id: string, failureReason: string, firedAt: string): boolean {
        return this.stmtMarkFailed.run({ id, failureReason, firedAt }).changes > 0;
    }

    /**
     * Cancel a pending wakeup. No-op (returns false) if the wakeup is missing
     * or already terminal.
     */
    cancel(id: string): boolean {
        return this.stmtCancel.run({ id }).changes > 0;
    }

    /** Delete a wakeup by id. */
    delete(id: string): boolean {
        return this.stmtDelete.run(id).changes > 0;
    }

    /** Delete all wakeups (used by data wiper). */
    deleteAll(): void {
        this.stmtDeleteAll.run();
    }

    /**
     * Prune terminal (fired/failed/cancelled) wakeups created before the given
     * ISO cutoff. Pending wakeups are never pruned. Returns the row count.
     */
    pruneTerminalBefore(cutoffIso: string): number {
        return this.stmtPruneTerminalBefore.run(cutoffIso).changes;
    }

    // ========================================================================
    // Table setup (idempotent)
    // ========================================================================

    private ensureTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS wakeups (
                id              TEXT PRIMARY KEY,
                process_id      TEXT NOT NULL,
                prompt          TEXT NOT NULL DEFAULT '',
                model           TEXT,
                status          TEXT NOT NULL DEFAULT 'pending',
                created_at      TEXT NOT NULL,
                fires_at        TEXT NOT NULL,
                fired_at        TEXT,
                failure_reason  TEXT,
                workspace_id    TEXT
            )
        `);

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_wakeups_process_id ON wakeups(process_id);
            CREATE INDEX IF NOT EXISTS idx_wakeups_status ON wakeups(status);
            CREATE INDEX IF NOT EXISTS idx_wakeups_workspace_id ON wakeups(workspace_id);
        `);
    }
}

// ============================================================================
// Internal Row Type & Conversion
// ============================================================================

interface WakeupRow {
    id: string;
    process_id: string;
    prompt: string;
    model: string | null;
    status: string;
    created_at: string;
    fires_at: string;
    fired_at: string | null;
    failure_reason: string | null;
    workspace_id: string | null;
}

function rowToEntry(row: WakeupRow): WakeupEntry {
    return {
        id: row.id,
        processId: row.process_id,
        prompt: row.prompt,
        model: row.model,
        status: row.status as WakeupStatus,
        createdAt: row.created_at,
        firesAt: row.fires_at,
        firedAt: row.fired_at,
        failureReason: row.failure_reason,
        ...(row.workspace_id != null ? { workspaceId: row.workspace_id } : {}),
    };
}

function toRow(entry: WakeupEntry): Record<string, unknown> {
    return {
        id: entry.id,
        processId: entry.processId,
        prompt: entry.prompt,
        model: entry.model ?? null,
        status: entry.status,
        createdAt: entry.createdAt,
        firesAt: entry.firesAt,
        firedAt: entry.firedAt ?? null,
        failureReason: entry.failureReason ?? null,
        workspaceId: entry.workspaceId ?? null,
    };
}
