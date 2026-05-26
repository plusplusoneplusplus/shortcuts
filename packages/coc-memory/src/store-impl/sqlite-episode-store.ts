/**
 * SQLite-backed episode store
 *
 * Persists compact session/turn/Ralph summaries with provenance.
 * Episodes are append-only (no update method) and scoped to either
 * global or workspace-isolated storage.
 */
import Database, { type Database as BetterDatabase } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { IMemoryEpisodeStore } from '../store-interface';
import type {
    MemoryEpisode,
    MemoryEpisodeFilter,
    MemoryEpisodeInput,
    MemoryScope,
} from '../types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS episodes (
  id               TEXT    PRIMARY KEY,
  scope            TEXT    NOT NULL CHECK(scope IN ('global', 'workspace')),
  workspace_id     TEXT,
  process_id       TEXT    NOT NULL,
  session_id       TEXT,
  ralph_id         TEXT,
  turn_index       INTEGER,
  iteration_index  INTEGER,
  summary          TEXT    NOT NULL,
  event_type       TEXT    NOT NULL,
  created_at       TEXT    NOT NULL,
  provenance       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_scope   ON episodes(scope, workspace_id);
CREATE INDEX IF NOT EXISTS idx_episodes_process ON episodes(process_id);
CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at DESC);
`;

// ---------------------------------------------------------------------------
// Row ↔ MemoryEpisode conversion
// ---------------------------------------------------------------------------

type DbRow = Record<string, unknown>;

function rowToEpisode(row: DbRow): MemoryEpisode {
    return {
        id: row.id as string,
        scope: row.scope as MemoryScope,
        workspaceId: (row.workspace_id as string | null) ?? undefined,
        processId: row.process_id as string,
        sessionId: (row.session_id as string | null) ?? undefined,
        ralphId: (row.ralph_id as string | null) ?? undefined,
        turnIndex: (row.turn_index as number | null) ?? undefined,
        iterationIndex: (row.iteration_index as number | null) ?? undefined,
        summary: row.summary as string,
        eventType: row.event_type as MemoryEpisode['eventType'],
        createdAt: row.created_at as string,
        provenance: JSON.parse(row.provenance as string) as MemoryEpisode['provenance'],
    };
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export class SqliteEpisodeStore implements IMemoryEpisodeStore {
    private readonly db: BetterDatabase;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.db.exec(SCHEMA_SQL);
    }

    async addEpisode(input: MemoryEpisodeInput): Promise<MemoryEpisode> {
        const id = randomUUID();
        const episode: MemoryEpisode = { ...input, id, createdAt: new Date().toISOString() };

        this.db.prepare(`
            INSERT INTO episodes (
                id, scope, workspace_id, process_id, session_id, ralph_id,
                turn_index, iteration_index, summary, event_type, created_at, provenance
            ) VALUES (
                @id, @scope, @workspace_id, @process_id, @session_id, @ralph_id,
                @turn_index, @iteration_index, @summary, @event_type, @created_at, @provenance
            )
        `).run({
            id: episode.id,
            scope: episode.scope,
            workspace_id: episode.workspaceId ?? null,
            process_id: episode.processId,
            session_id: episode.sessionId ?? null,
            ralph_id: episode.ralphId ?? null,
            turn_index: episode.turnIndex ?? null,
            iteration_index: episode.iterationIndex ?? null,
            summary: episode.summary,
            event_type: episode.eventType,
            created_at: episode.createdAt,
            provenance: JSON.stringify(episode.provenance),
        });

        return episode;
    }

    async getEpisode(id: string): Promise<MemoryEpisode | null> {
        const row = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as DbRow | undefined;
        return row ? rowToEpisode(row) : null;
    }

    async listEpisodes(filter?: MemoryEpisodeFilter): Promise<MemoryEpisode[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filter?.scope) {
            conditions.push('scope = ?');
            params.push(filter.scope);
        }
        if (filter?.workspaceId) {
            conditions.push('workspace_id = ?');
            params.push(filter.workspaceId);
        }
        if (filter?.processId) {
            conditions.push('process_id = ?');
            params.push(filter.processId);
        }
        if (filter?.eventTypes && filter.eventTypes.length > 0) {
            conditions.push(`event_type IN (${filter.eventTypes.map(() => '?').join(', ')})`);
            params.push(...filter.eventTypes);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filter?.limit ?? 100;
        const offset = filter?.offset ?? 0;

        const rows = this.db.prepare(`
            SELECT * FROM episodes ${where}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset) as DbRow[];

        return rows.map(rowToEpisode);
    }

    async wipe(scope: MemoryScope, workspaceId?: string): Promise<void> {
        if (scope === 'global') {
            this.db.prepare("DELETE FROM episodes WHERE scope = 'global'").run();
        } else if (scope === 'workspace' && workspaceId) {
            this.db.prepare("DELETE FROM episodes WHERE scope = 'workspace' AND workspace_id = ?").run(workspaceId);
        }
    }

    async exportEpisodes(scope: MemoryScope, workspaceId?: string): Promise<MemoryEpisode[]> {
        if (scope === 'global') {
            const rows = this.db.prepare(
                "SELECT * FROM episodes WHERE scope = 'global' ORDER BY created_at ASC"
            ).all() as DbRow[];
            return rows.map(rowToEpisode);
        }
        if (scope === 'workspace' && workspaceId) {
            const rows = this.db.prepare(
                "SELECT * FROM episodes WHERE scope = 'workspace' AND workspace_id = ? ORDER BY created_at ASC"
            ).all(workspaceId) as DbRow[];
            return rows.map(rowToEpisode);
        }
        return [];
    }

    close(): void {
        this.db.close();
    }
}
