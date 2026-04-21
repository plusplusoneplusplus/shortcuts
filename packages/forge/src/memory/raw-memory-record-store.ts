/**
 * SQLite-backed Raw Memory Record Store
 *
 * Append-only store for raw memory capture. Supports claim/release/complete
 * lifecycle for batch aggregation. Uses better-sqlite3 with WAL mode.
 *
 * Path resolution is the caller's responsibility — the store accepts an
 * absolute dbPath and does not know about CoC directory conventions.
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { randomUUID } from 'crypto';

import type {
    RawMemoryRecord,
    RawMemoryRecordInput,
    RawMemoryBatch,
    RawMemoryRecordFilter,
    RawMemoryRecordStats,
    RawMemoryRecordStatus,
} from './raw-memory-record-types';

// ============================================================================
// Options
// ============================================================================

export interface RawMemoryRecordStoreOptions {
    /** Absolute path to the .db file */
    dbPath: string;
}

// ============================================================================
// SQLite row type (snake_case)
// ============================================================================

interface RecordRow {
    id: string;
    target: string;
    content: string;
    source: string;
    workspace_id: string;
    process_id: string | null;
    turn_index: number | null;
    created_at: string;
    status: string;
    batch_id: string | null;
    claimed_at: string | null;
    aggregated_at: string | null;
    dropped_at: string | null;
    fingerprint: string | null;
    metadata_json: string | null;
}

interface CountRow {
    cnt: number;
}

// ============================================================================
// Schema
// ============================================================================

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS raw_memory_records (
    id              TEXT PRIMARY KEY,
    target          TEXT NOT NULL,
    content         TEXT NOT NULL,
    source          TEXT NOT NULL,
    workspace_id    TEXT NOT NULL,
    process_id      TEXT,
    turn_index      INTEGER,
    created_at      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    batch_id        TEXT,
    claimed_at      TEXT,
    aggregated_at   TEXT,
    dropped_at      TEXT,
    fingerprint     TEXT,
    metadata_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_rmr_status ON raw_memory_records(status);
CREATE INDEX IF NOT EXISTS idx_rmr_workspace_id ON raw_memory_records(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rmr_batch_id ON raw_memory_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_rmr_fingerprint ON raw_memory_records(fingerprint);
`;

// ============================================================================
// Store
// ============================================================================

export class RawMemoryRecordStore {
    private readonly dbPath: string;
    private db: DatabaseType;

    // Prepared statements (lazily created after schema init)
    private stmtInsert!: Statement;
    private stmtSelectPending!: Statement;
    private stmtClaim!: Statement;
    private stmtReleaseClaim!: Statement;
    private stmtMarkAggregated!: Statement;
    private stmtMarkDropped!: Statement;

    constructor(options: RawMemoryRecordStoreOptions) {
        this.dbPath = options.dbPath;

        // Ensure parent directory exists
        const dir = path.dirname(this.dbPath);
        fs.mkdirSync(dir, { recursive: true });

        this.db = new Database(this.dbPath);
        this.initializeSchema();
        this.prepareStatements();
    }

    // ========================================================================
    // Schema
    // ========================================================================

    private initializeSchema(): void {
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.exec(SCHEMA_SQL);
    }

    private prepareStatements(): void {
        this.stmtInsert = this.db.prepare(`
            INSERT INTO raw_memory_records
                (id, target, content, source, workspace_id, process_id, turn_index,
                 created_at, status, fingerprint, metadata_json)
            VALUES
                (@id, @target, @content, @source, @workspaceId, @processId, @turnIndex,
                 @createdAt, 'pending', @fingerprint, @metadataJson)
        `);

        this.stmtSelectPending = this.db.prepare(`
            SELECT * FROM raw_memory_records
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT @limit
        `);

        this.stmtClaim = this.db.prepare(`
            UPDATE raw_memory_records
            SET status = 'claimed', batch_id = @batchId, claimed_at = @claimedAt
            WHERE id = @id AND status = 'pending'
        `);

        this.stmtReleaseClaim = this.db.prepare(`
            UPDATE raw_memory_records
            SET status = 'pending', batch_id = NULL, claimed_at = NULL
            WHERE batch_id = @batchId AND status = 'claimed'
        `);

        this.stmtMarkAggregated = this.db.prepare(`
            UPDATE raw_memory_records
            SET status = 'aggregated', aggregated_at = @aggregatedAt
            WHERE batch_id = @batchId AND status = 'claimed'
        `);

        this.stmtMarkDropped = this.db.prepare(`
            UPDATE raw_memory_records
            SET status = 'dropped', dropped_at = @droppedAt
            WHERE batch_id = @batchId AND status = 'claimed'
        `);
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Append a new raw memory record. Returns the generated record.
     */
    async append(input: RawMemoryRecordInput): Promise<RawMemoryRecord> {
        const id = randomUUID();
        const createdAt = new Date().toISOString();

        this.stmtInsert.run({
            id,
            target: input.target,
            content: input.content,
            source: input.source,
            workspaceId: input.workspaceId,
            processId: input.processId ?? null,
            turnIndex: input.turnIndex ?? null,
            createdAt,
            fingerprint: input.fingerprint ?? null,
            metadataJson: input.metadataJson ?? null,
        });

        return this.rowToRecord({
            id,
            target: input.target,
            content: input.content,
            source: input.source,
            workspace_id: input.workspaceId,
            process_id: input.processId ?? null,
            turn_index: input.turnIndex ?? null,
            created_at: createdAt,
            status: 'pending',
            batch_id: null,
            claimed_at: null,
            aggregated_at: null,
            dropped_at: null,
            fingerprint: input.fingerprint ?? null,
            metadata_json: input.metadataJson ?? null,
        });
    }

    /**
     * List pending records, optionally bounded by limit.
     */
    async listPending(limit = 100): Promise<RawMemoryRecord[]> {
        const rows = this.stmtSelectPending.all({ limit }) as RecordRow[];
        return rows.map(r => this.rowToRecord(r));
    }

    /**
     * Atomically claim up to `limit` pending records into a new batch.
     * Returns the batch with claimed records, or null if none are pending.
     */
    async claimPending(limit = 50): Promise<RawMemoryBatch | null> {
        const batchId = randomUUID();
        const claimedAt = new Date().toISOString();

        const result = this.db.transaction(() => {
            const rows = this.stmtSelectPending.all({ limit }) as RecordRow[];
            if (rows.length === 0) return null;

            for (const row of rows) {
                this.stmtClaim.run({ batchId, claimedAt, id: row.id });
            }

            // Re-read claimed rows to get updated state
            const claimed = this.db.prepare(
                `SELECT * FROM raw_memory_records WHERE batch_id = ? AND status = 'claimed' ORDER BY created_at ASC`
            ).all(batchId) as RecordRow[];

            return {
                batchId,
                records: claimed.map(r => this.rowToRecord(r)),
            };
        })();

        return result;
    }

    /**
     * Release a claimed batch, returning all its records to pending status.
     * Used when aggregation fails and the records should be retried.
     */
    async releaseClaim(batchId: string): Promise<number> {
        const info = this.stmtReleaseClaim.run({ batchId });
        return info.changes;
    }

    /**
     * Mark all records in a batch as aggregated (successfully merged into MEMORY.md).
     */
    async markAggregated(batchId: string): Promise<number> {
        const aggregatedAt = new Date().toISOString();
        const info = this.stmtMarkAggregated.run({ batchId, aggregatedAt });
        return info.changes;
    }

    /**
     * Mark all records in a batch as dropped (intentionally discarded).
     */
    async markDropped(batchId: string): Promise<number> {
        const droppedAt = new Date().toISOString();
        const info = this.stmtMarkDropped.run({ batchId, droppedAt });
        return info.changes;
    }

    /**
     * Get aggregate counts by status.
     */
    async getStats(): Promise<RawMemoryRecordStats> {
        const rows = this.db.prepare(
            `SELECT status, COUNT(*) as cnt FROM raw_memory_records GROUP BY status`
        ).all() as { status: string; cnt: number }[];

        const stats: RawMemoryRecordStats = {
            pending: 0,
            claimed: 0,
            aggregated: 0,
            dropped: 0,
            total: 0,
        };

        for (const row of rows) {
            const s = row.status as RawMemoryRecordStatus;
            if (s in stats) {
                stats[s] = row.cnt;
            }
            stats.total += row.cnt;
        }

        return stats;
    }

    /**
     * Close the database connection.
     */
    close(): void {
        this.db.close();
    }

    // ========================================================================
    // Internal
    // ========================================================================

    private rowToRecord(row: RecordRow): RawMemoryRecord {
        return {
            id: row.id,
            target: row.target,
            content: row.content,
            source: row.source,
            workspaceId: row.workspace_id,
            processId: row.process_id,
            turnIndex: row.turn_index,
            createdAt: row.created_at,
            status: row.status as RawMemoryRecordStatus,
            batchId: row.batch_id,
            claimedAt: row.claimed_at,
            aggregatedAt: row.aggregated_at,
            droppedAt: row.dropped_at,
            fingerprint: row.fingerprint,
            metadataJson: row.metadata_json,
        };
    }
}
