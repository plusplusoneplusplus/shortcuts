/**
 * One row per completed agent turn in the `turn_performance` table of the
 * shared `processes.db`: TTFT/TPS timestamps and derived metrics. Follows the
 * same pattern as `WakeupStore`: receives a shared Database handle, uses
 * prepared statements for hot paths, and self-creates its table so it works
 * against databases predating the schema (e.g. in-memory test databases).
 *
 * Recording contract: a metric write must never fail or slow a turn. `record`
 * is an idempotent upsert (retried settlements cannot double-count) wrapped in
 * try/catch that logs at warn. When constructed without a DB handle (in-memory
 * process store setups), every method is a safe no-op.
 */

import type Database from 'better-sqlite3';
import type { TurnPerformanceEvent, TurnPerformanceStatus } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

export interface TurnPerformanceQuery {
    /** Restrict to events whose `startedAt` is within the last N days. */
    days?: number;
    /** Restrict to a single process (per-session view). */
    processId?: string;
    /** Restrict to `turnIndex = 0` — the "new session" TTFT question. */
    firstTurnOnly?: boolean;
    /** Restrict to these terminal statuses. */
    statuses?: TurnPerformanceStatus[];
    /** Reference "now" for the `days` window (epoch ms). Defaults to Date.now(). */
    now?: number;
}

// ============================================================================
// TurnPerformanceStore
// ============================================================================

export class TurnPerformanceStore {
    private readonly db: Database.Database | null;

    private stmtUpsert: Database.Statement | undefined;
    private stmtPrune: Database.Statement | undefined;

    constructor(db?: Database.Database | null) {
        this.db = db ?? null;
        if (!this.db) return;

        this.ensureTable(this.db);

        this.stmtUpsert = this.db.prepare(`
            INSERT INTO turn_performance (
                id, process_id, turn_index, workspace_id, provider, model,
                effort_tier, mode, kind, enqueued_at, started_at,
                first_output_at, ended_at, ttft_ms, queue_wait_ms,
                generation_ms, wall_ms, input_tokens, output_tokens,
                total_tokens, tps_generation, tps_wall, status
            ) VALUES (
                @id, @processId, @turnIndex, @workspaceId, @provider, @model,
                @effortTier, @mode, @kind, @enqueuedAt, @startedAt,
                @firstOutputAt, @endedAt, @ttftMs, @queueWaitMs,
                @generationMs, @wallMs, @inputTokens, @outputTokens,
                @totalTokens, @tpsGeneration, @tpsWall, @status
            )
            ON CONFLICT(id) DO UPDATE SET
                process_id = excluded.process_id,
                turn_index = excluded.turn_index,
                workspace_id = excluded.workspace_id,
                provider = excluded.provider,
                model = excluded.model,
                effort_tier = excluded.effort_tier,
                mode = excluded.mode,
                kind = excluded.kind,
                enqueued_at = excluded.enqueued_at,
                started_at = excluded.started_at,
                first_output_at = excluded.first_output_at,
                ended_at = excluded.ended_at,
                ttft_ms = excluded.ttft_ms,
                queue_wait_ms = excluded.queue_wait_ms,
                generation_ms = excluded.generation_ms,
                wall_ms = excluded.wall_ms,
                input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens,
                total_tokens = excluded.total_tokens,
                tps_generation = excluded.tps_generation,
                tps_wall = excluded.tps_wall,
                status = excluded.status
        `);

        this.stmtPrune = this.db.prepare('DELETE FROM turn_performance WHERE started_at < ?');
    }

    /** Whether a database handle is wired (false → every method no-ops). */
    isEnabled(): boolean {
        return this.db !== null;
    }

    /**
     * Upsert one turn event. Idempotent on `id` so a retried settlement
     * replaces rather than double-counts. Never throws: failures are logged
     * at warn and swallowed so a metric write cannot fail a turn.
     * Returns whether a row was written.
     */
    record(event: TurnPerformanceEvent): boolean {
        if (!this.stmtUpsert) return false;
        try {
            this.stmtUpsert.run(toRow(event));
            return true;
        } catch (err) {
            getLogger().warn(
                LogCategory.AI,
                `[TurnPerformanceStore] Failed to record turn event ${event.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return false;
        }
    }

    /**
     * Read raw events, newest first, optionally filtered by day window,
     * process, first-turn-only, and status. Aggregation happens in pure
     * functions over these rows, never in SQL.
     */
    queryEvents(query: TurnPerformanceQuery = {}): TurnPerformanceEvent[] {
        if (!this.db) return [];

        const clauses: string[] = [];
        const params: unknown[] = [];

        if (query.days !== undefined) {
            const now = query.now ?? Date.now();
            const cutoff = new Date(now - query.days * 24 * 60 * 60 * 1000).toISOString();
            clauses.push('started_at >= ?');
            params.push(cutoff);
        }
        if (query.processId !== undefined) {
            clauses.push('process_id = ?');
            params.push(query.processId);
        }
        if (query.firstTurnOnly) {
            clauses.push('turn_index = 0');
        }
        if (query.statuses && query.statuses.length > 0) {
            clauses.push(`status IN (${query.statuses.map(() => '?').join(', ')})`);
            params.push(...query.statuses);
        }

        const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
        const rows = this.db
            .prepare(`SELECT * FROM turn_performance${where} ORDER BY started_at DESC, turn_index DESC`)
            .all(...params) as TurnPerformanceRow[];
        return rows.map(rowToEvent);
    }

    /** Delete events whose `startedAt` is before the ISO cutoff. Returns the row count. */
    pruneOlderThan(cutoffIso: string): number {
        if (!this.stmtPrune) return 0;
        return this.stmtPrune.run(cutoffIso).changes;
    }

    /** Delete all events (used by data wiper / tests). */
    deleteAll(): void {
        this.db?.prepare('DELETE FROM turn_performance').run();
    }

    // ========================================================================
    // Table setup (idempotent)
    // ========================================================================

    private ensureTable(db: Database.Database): void {
        db.exec(`
            CREATE TABLE IF NOT EXISTS turn_performance (
                id                TEXT PRIMARY KEY,
                process_id        TEXT NOT NULL,
                turn_index        INTEGER NOT NULL,
                workspace_id      TEXT,
                provider          TEXT,
                model             TEXT,
                effort_tier       TEXT,
                mode              TEXT,
                kind              TEXT,
                enqueued_at       TEXT,
                started_at        TEXT NOT NULL,
                first_output_at   TEXT,
                ended_at          TEXT NOT NULL,
                ttft_ms           INTEGER,
                queue_wait_ms     INTEGER,
                generation_ms     INTEGER,
                wall_ms           INTEGER NOT NULL,
                input_tokens      INTEGER,
                output_tokens     INTEGER,
                total_tokens      INTEGER,
                tps_generation    REAL,
                tps_wall          REAL,
                status            TEXT NOT NULL
            )
        `);

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_turn_perf_process_id ON turn_performance(process_id);
            CREATE INDEX IF NOT EXISTS idx_turn_perf_started_at ON turn_performance(started_at);
            CREATE INDEX IF NOT EXISTS idx_turn_perf_workspace  ON turn_performance(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_turn_perf_model      ON turn_performance(model);
        `);
    }
}

// ============================================================================
// Internal Row Type & Conversion
// ============================================================================

interface TurnPerformanceRow {
    id: string;
    process_id: string;
    turn_index: number;
    workspace_id: string | null;
    provider: string | null;
    model: string | null;
    effort_tier: string | null;
    mode: string | null;
    kind: string | null;
    enqueued_at: string | null;
    started_at: string;
    first_output_at: string | null;
    ended_at: string;
    ttft_ms: number | null;
    queue_wait_ms: number | null;
    generation_ms: number | null;
    wall_ms: number;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    tps_generation: number | null;
    tps_wall: number | null;
    status: string;
}

function rowToEvent(row: TurnPerformanceRow): TurnPerformanceEvent {
    return {
        id: row.id,
        processId: row.process_id,
        turnIndex: row.turn_index,
        workspaceId: row.workspace_id,
        provider: row.provider,
        model: row.model,
        effortTier: row.effort_tier,
        mode: row.mode,
        kind: row.kind,
        enqueuedAt: row.enqueued_at,
        startedAt: row.started_at,
        firstOutputAt: row.first_output_at,
        endedAt: row.ended_at,
        ttftMs: row.ttft_ms,
        queueWaitMs: row.queue_wait_ms,
        generationMs: row.generation_ms,
        wallMs: row.wall_ms,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens,
        tpsGeneration: row.tps_generation,
        tpsWall: row.tps_wall,
        status: row.status as TurnPerformanceStatus,
    };
}

function toRow(event: TurnPerformanceEvent): Record<string, unknown> {
    return {
        id: event.id,
        processId: event.processId,
        turnIndex: event.turnIndex,
        workspaceId: event.workspaceId,
        provider: event.provider,
        model: event.model,
        effortTier: event.effortTier,
        mode: event.mode,
        kind: event.kind,
        enqueuedAt: event.enqueuedAt,
        startedAt: event.startedAt,
        firstOutputAt: event.firstOutputAt,
        endedAt: event.endedAt,
        ttftMs: event.ttftMs,
        queueWaitMs: event.queueWaitMs,
        generationMs: event.generationMs,
        wallMs: event.wallMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        totalTokens: event.totalTokens,
        tpsGeneration: event.tpsGeneration,
        tpsWall: event.tpsWall,
        status: event.status,
    };
}
