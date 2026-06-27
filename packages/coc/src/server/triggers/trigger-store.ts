/**
 * Trigger Store — SQLite Persistence
 *
 * CRUD operations for `Trigger` records in the shared `processes.db`.
 * Follows the same pattern as `LoopStore`: receives a shared Database handle,
 * uses prepared statements, and self-creates its table (`ensureTable`) so it
 * works even when the schema migration has not been applied (e.g. in-memory
 * test databases).
 *
 * `event` and `action` are discriminated unions, persisted as JSON TEXT.
 */

import type Database from 'better-sqlite3';
import type { Trigger, TriggerStatus, TriggerEvent, TriggerAction } from './trigger-types';
import { MAX_ACTIVE_TRIGGERS } from './trigger-types';

// ============================================================================
// TriggerStore
// ============================================================================

export class TriggerStore {
    private readonly db: Database.Database;

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

    constructor(db: Database.Database) {
        this.db = db;
        this.ensureTable();

        this.stmtInsert = db.prepare(`
            INSERT INTO triggers (
                id, workspace_id, process_id, status,
                event, action, in_flight,
                created_at, expires_at, last_tick_at, next_tick_at
            ) VALUES (
                @id, @workspaceId, @processId, @status,
                @event, @action, @inFlight,
                @createdAt, @expiresAt, @lastTickAt, @nextTickAt
            )
        `);

        this.stmtUpdate = db.prepare(`
            UPDATE triggers SET
                workspace_id = @workspaceId,
                process_id = @processId,
                status = @status,
                event = @event,
                action = @action,
                in_flight = @inFlight,
                expires_at = @expiresAt,
                last_tick_at = @lastTickAt,
                next_tick_at = @nextTickAt
            WHERE id = @id
        `);

        this.stmtGetById = db.prepare('SELECT * FROM triggers WHERE id = ?');
        this.stmtGetByProcess = db.prepare('SELECT * FROM triggers WHERE process_id = ? ORDER BY created_at DESC');
        this.stmtGetByWorkspace = db.prepare('SELECT * FROM triggers WHERE workspace_id = ? ORDER BY created_at DESC');
        this.stmtGetActive = db.prepare("SELECT * FROM triggers WHERE status = 'active' ORDER BY created_at ASC");
        this.stmtGetAll = db.prepare('SELECT * FROM triggers ORDER BY created_at DESC');
        this.stmtDelete = db.prepare('DELETE FROM triggers WHERE id = ?');
        this.stmtDeleteAll = db.prepare('DELETE FROM triggers');
        this.stmtCountActive = db.prepare("SELECT COUNT(*) as cnt FROM triggers WHERE status = 'active'");
    }

    // ========================================================================
    // CRUD
    // ========================================================================

    /**
     * Insert a new trigger.
     * Throws if the server-wide active trigger limit would be exceeded.
     */
    insert(trigger: Trigger): void {
        if (trigger.status === 'active' && this.countActive() >= MAX_ACTIVE_TRIGGERS) {
            throw new Error(`Server-wide active trigger limit reached (${MAX_ACTIVE_TRIGGERS})`);
        }
        this.stmtInsert.run(toRow(trigger));
    }

    /** Update an existing trigger (by id). */
    update(trigger: Trigger): void {
        this.stmtUpdate.run(toRow(trigger));
    }

    /** Get a trigger by id, or null if not found. */
    getById(id: string): Trigger | null {
        const row = this.stmtGetById.get(id) as TriggerRow | undefined;
        return row ? rowToTrigger(row) : null;
    }

    /** Get all triggers for a given process, newest first. */
    getByProcess(processId: string): Trigger[] {
        return (this.stmtGetByProcess.all(processId) as TriggerRow[]).map(rowToTrigger);
    }

    /** Get all triggers for a given workspace, newest first. */
    getByWorkspace(workspaceId: string): Trigger[] {
        return (this.stmtGetByWorkspace.all(workspaceId) as TriggerRow[]).map(rowToTrigger);
    }

    /** Get all active triggers, oldest first. */
    getActive(): Trigger[] {
        return (this.stmtGetActive.all() as TriggerRow[]).map(rowToTrigger);
    }

    /** Get all triggers (any status). */
    getAll(): Trigger[] {
        return (this.stmtGetAll.all() as TriggerRow[]).map(rowToTrigger);
    }

    /** Delete a trigger by id. */
    delete(id: string): boolean {
        return this.stmtDelete.run(id).changes > 0;
    }

    /** Delete all triggers (used by data wiper). */
    deleteAll(): void {
        this.stmtDeleteAll.run();
    }

    /** Count active triggers server-wide. */
    countActive(): number {
        return (this.stmtCountActive.get() as { cnt: number }).cnt;
    }

    // ========================================================================
    // Table setup (idempotent)
    // ========================================================================

    private ensureTable(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS triggers (
                id            TEXT PRIMARY KEY,
                workspace_id  TEXT NOT NULL,
                process_id    TEXT NOT NULL,
                status        TEXT NOT NULL DEFAULT 'active',
                event         TEXT NOT NULL,
                action        TEXT NOT NULL,
                in_flight     INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL,
                expires_at    TEXT NOT NULL,
                last_tick_at  TEXT,
                next_tick_at  TEXT
            )
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_triggers_process_id ON triggers(process_id);
            CREATE INDEX IF NOT EXISTS idx_triggers_workspace_id ON triggers(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_triggers_status ON triggers(status);
        `);
    }
}

// ============================================================================
// Internal Row Type & Conversion
// ============================================================================

interface TriggerRow {
    id: string;
    workspace_id: string;
    process_id: string;
    status: string;
    event: string;
    action: string;
    in_flight: number;
    created_at: string;
    expires_at: string;
    last_tick_at: string | null;
    next_tick_at: string | null;
}

function rowToTrigger(row: TriggerRow): Trigger {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        processId: row.process_id,
        status: row.status as TriggerStatus,
        event: JSON.parse(row.event) as TriggerEvent,
        action: JSON.parse(row.action) as TriggerAction,
        inFlight: row.in_flight !== 0,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastTickAt: row.last_tick_at,
        nextTickAt: row.next_tick_at,
    };
}

function toRow(trigger: Trigger): Record<string, unknown> {
    return {
        id: trigger.id,
        workspaceId: trigger.workspaceId,
        processId: trigger.processId,
        status: trigger.status,
        event: JSON.stringify(trigger.event),
        action: JSON.stringify(trigger.action),
        inFlight: trigger.inFlight ? 1 : 0,
        createdAt: trigger.createdAt,
        expiresAt: trigger.expiresAt,
        lastTickAt: trigger.lastTickAt ?? null,
        nextTickAt: trigger.nextTickAt ?? null,
    };
}
