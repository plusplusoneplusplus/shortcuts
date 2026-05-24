/**
 * SQLite-backed fact store
 *
 * Uses FTS5 for BM25 full-text search. Vector search columns are reserved
 * here (BLOB `embedding`) but the ranking blending logic is added in AC-03
 * when the EmbeddingProvider is wired in.
 *
 * The store is synchronous under the hood (better-sqlite3) but exposes the
 * async IMemoryFactStore interface required by the rest of the system.
 */
import Database, { type Database as BetterDatabase } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { IMemoryFactStore } from '../store-interface';
import type {
    MemoryFact,
    MemoryFactFilter,
    MemoryFactInput,
    MemoryScope,
    MemorySearchQuery,
    MemorySearchResult,
} from '../types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS facts (
  id              TEXT    PRIMARY KEY,
  scope           TEXT    NOT NULL CHECK(scope IN ('global', 'workspace')),
  workspace_id    TEXT,
  content         TEXT    NOT NULL,
  importance      REAL    NOT NULL DEFAULT 0.5,
  confidence      REAL    NOT NULL DEFAULT 0.8,
  status          TEXT    NOT NULL DEFAULT 'active'
                          CHECK(status IN ('active', 'review', 'rejected', 'archived')),
  tags            TEXT    NOT NULL DEFAULT '[]',
  source          TEXT    NOT NULL
                          CHECK(source IN ('explicit', 'auto-extracted', 'imported')),
  source_process_id      TEXT,
  source_turn_index      INTEGER,
  source_ralph_iteration INTEGER,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  recalled_count  INTEGER NOT NULL DEFAULT 0,
  last_recalled_at TEXT,
  embedding       BLOB
);

CREATE INDEX IF NOT EXISTS idx_facts_scope   ON facts(scope, workspace_id);
CREATE INDEX IF NOT EXISTS idx_facts_status  ON facts(status);
CREATE INDEX IF NOT EXISTS idx_facts_created ON facts(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  content,
  content='facts',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE OF content ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO facts_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`;

// ---------------------------------------------------------------------------
// Row ↔ MemoryFact conversion
// ---------------------------------------------------------------------------

type DbRow = Record<string, unknown>;

function rowToFact(row: DbRow): MemoryFact {
    return {
        id: row.id as string,
        scope: row.scope as MemoryScope,
        workspaceId: (row.workspace_id as string | null) ?? undefined,
        content: row.content as string,
        importance: row.importance as number,
        confidence: row.confidence as number,
        status: row.status as MemoryFact['status'],
        tags: JSON.parse((row.tags as string) || '[]') as string[],
        source: row.source as MemoryFact['source'],
        sourceProcessId: (row.source_process_id as string | null) ?? undefined,
        sourceTurnIndex: (row.source_turn_index as number | null) ?? undefined,
        sourceRalphIteration: (row.source_ralph_iteration as number | null) ?? undefined,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        recalledCount: row.recalled_count as number,
        lastRecalledAt: (row.last_recalled_at as string | null) ?? undefined,
    };
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export class SqliteFactStore implements IMemoryFactStore {
    private readonly db: BetterDatabase;

    constructor(dbPath: string) {
        this.db = new Database(dbPath);
        this.db.exec(SCHEMA_SQL);
    }

    async addFact(input: MemoryFactInput): Promise<MemoryFact> {
        const now = new Date().toISOString();
        const id = randomUUID();
        const fact: MemoryFact = { ...input, id, createdAt: now, updatedAt: now, recalledCount: 0 };

        this.db.prepare(`
            INSERT INTO facts (
                id, scope, workspace_id, content, importance, confidence, status,
                tags, source, source_process_id, source_turn_index, source_ralph_iteration,
                created_at, updated_at, recalled_count, last_recalled_at
            ) VALUES (
                @id, @scope, @workspace_id, @content, @importance, @confidence, @status,
                @tags, @source, @source_process_id, @source_turn_index, @source_ralph_iteration,
                @created_at, @updated_at, @recalled_count, @last_recalled_at
            )
        `).run({
            id: fact.id,
            scope: fact.scope,
            workspace_id: fact.workspaceId ?? null,
            content: fact.content,
            importance: fact.importance,
            confidence: fact.confidence,
            status: fact.status,
            tags: JSON.stringify(fact.tags),
            source: fact.source,
            source_process_id: fact.sourceProcessId ?? null,
            source_turn_index: fact.sourceTurnIndex ?? null,
            source_ralph_iteration: fact.sourceRalphIteration ?? null,
            created_at: fact.createdAt,
            updated_at: fact.updatedAt,
            recalled_count: 0,
            last_recalled_at: fact.lastRecalledAt ?? null,
        });

        return fact;
    }

    async getFact(id: string): Promise<MemoryFact | null> {
        const row = this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as DbRow | undefined;
        return row ? rowToFact(row) : null;
    }

    async updateFact(id: string, updates: Partial<MemoryFact>): Promise<MemoryFact | null> {
        const existing = await this.getFact(id);
        if (!existing) return null;

        const now = new Date().toISOString();
        const merged: MemoryFact = { ...existing, ...updates, id, updatedAt: now };

        this.db.prepare(`
            UPDATE facts SET
                scope                  = @scope,
                workspace_id           = @workspace_id,
                content                = @content,
                importance             = @importance,
                confidence             = @confidence,
                status                 = @status,
                tags                   = @tags,
                source                 = @source,
                source_process_id      = @source_process_id,
                source_turn_index      = @source_turn_index,
                source_ralph_iteration = @source_ralph_iteration,
                updated_at             = @updated_at,
                recalled_count         = @recalled_count,
                last_recalled_at       = @last_recalled_at
            WHERE id = @id
        `).run({
            id: merged.id,
            scope: merged.scope,
            workspace_id: merged.workspaceId ?? null,
            content: merged.content,
            importance: merged.importance,
            confidence: merged.confidence,
            status: merged.status,
            tags: JSON.stringify(merged.tags),
            source: merged.source,
            source_process_id: merged.sourceProcessId ?? null,
            source_turn_index: merged.sourceTurnIndex ?? null,
            source_ralph_iteration: merged.sourceRalphIteration ?? null,
            updated_at: merged.updatedAt,
            recalled_count: merged.recalledCount,
            last_recalled_at: merged.lastRecalledAt ?? null,
        });

        return merged;
    }

    async deleteFact(id: string): Promise<boolean> {
        const result = this.db.prepare('DELETE FROM facts WHERE id = ?').run(id);
        return result.changes > 0;
    }

    async searchFacts(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
        const statuses = query.statuses ?? ['active'];
        const limit = query.limit ?? 10;

        // Build scope clause
        const scopeParams: unknown[] = [];
        let scopeClause = '';
        if (query.scope === 'workspace' && query.workspaceId) {
            scopeClause = "AND f.scope = 'workspace' AND f.workspace_id = ?";
            scopeParams.push(query.workspaceId);
        } else if (query.scope === 'global') {
            scopeClause = "AND f.scope = 'global'";
        }

        const statusPlaceholders = statuses.map(() => '?').join(', ');

        let rows: Array<DbRow & { bm25_score: number }>;
        try {
            rows = this.db.prepare(`
                SELECT f.*, -bm25(facts_fts) AS bm25_score
                FROM facts_fts
                JOIN facts f ON facts_fts.rowid = f.rowid
                WHERE facts_fts MATCH ?
                  AND f.status IN (${statusPlaceholders})
                  ${scopeClause}
                ORDER BY bm25_score DESC
                LIMIT ?
            `).all(query.text, ...statuses, ...scopeParams, limit) as Array<DbRow & { bm25_score: number }>;
        } catch {
            // FTS5 query parse error — return empty
            return [];
        }

        // Post-filter by tags and minScore
        const tagFilter = query.tags;
        const minScore = query.minScore ?? 0;

        return rows
            .filter(row => {
                if (!tagFilter || tagFilter.length === 0) return true;
                const tags = JSON.parse((row.tags as string) || '[]') as string[];
                return tagFilter.every(t => tags.includes(t));
            })
            .map(row => {
                const rawBm25 = row.bm25_score as number;
                // Normalise BM25 to approximate [0, 1]: typical values are 0–20
                const normBm25 = Math.min(1, Math.max(0, rawBm25 / 20));
                // Blend with importance for final score (AC-03 adds vector component)
                const fact = rowToFact(row);
                const score = normBm25 * 0.7 + fact.importance * 0.3;
                return {
                    fact,
                    score,
                    bm25Score: normBm25,
                    vectorScore: null,
                } satisfies MemorySearchResult;
            })
            .filter(r => r.score >= minScore);
    }

    async listFacts(filter?: MemoryFactFilter): Promise<MemoryFact[]> {
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
        if (filter?.statuses && filter.statuses.length > 0) {
            conditions.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
            params.push(...filter.statuses);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filter?.limit ?? 100;
        const offset = filter?.offset ?? 0;

        const rows = this.db.prepare(`
            SELECT * FROM facts ${where}
            ORDER BY importance DESC, created_at DESC
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset) as DbRow[];

        let results = rows.map(rowToFact);

        // Tag filter is applied post-query (SQLite has no native JSON array contains)
        if (filter?.tags && filter.tags.length > 0) {
            results = results.filter(f => filter.tags!.every(t => f.tags.includes(t)));
        }

        return results;
    }

    async recordRecall(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const now = new Date().toISOString();
        const stmt = this.db.prepare(
            'UPDATE facts SET recalled_count = recalled_count + 1, last_recalled_at = ? WHERE id = ?'
        );
        const run = this.db.transaction(() => {
            for (const id of ids) {
                stmt.run(now, id);
            }
        });
        run();
    }

    async wipe(scope: MemoryScope, workspaceId?: string): Promise<void> {
        if (scope === 'global') {
            this.db.prepare("DELETE FROM facts WHERE scope = 'global'").run();
        } else if (scope === 'workspace' && workspaceId) {
            this.db.prepare("DELETE FROM facts WHERE scope = 'workspace' AND workspace_id = ?").run(workspaceId);
        }
        // Rebuild FTS index to stay consistent after bulk delete
        this.db.exec("INSERT INTO facts_fts(facts_fts) VALUES ('rebuild')");
    }

    async exportFacts(scope: MemoryScope, workspaceId?: string): Promise<MemoryFact[]> {
        if (scope === 'global') {
            const rows = this.db.prepare(
                "SELECT * FROM facts WHERE scope = 'global' ORDER BY created_at ASC"
            ).all() as DbRow[];
            return rows.map(rowToFact);
        }
        if (scope === 'workspace' && workspaceId) {
            const rows = this.db.prepare(
                "SELECT * FROM facts WHERE scope = 'workspace' AND workspace_id = ? ORDER BY created_at ASC"
            ).all(workspaceId) as DbRow[];
            return rows.map(rowToFact);
        }
        return [];
    }

    /** Store a pre-computed embedding BLOB for a fact (used by AC-03 vector search) */
    storeEmbedding(id: string, embedding: Buffer): void {
        this.db.prepare('UPDATE facts SET embedding = ? WHERE id = ?').run(embedding, id);
    }

    /** Retrieve the raw embedding BLOB for a fact, or null if absent */
    getEmbedding(id: string): Buffer | null {
        const row = this.db.prepare('SELECT embedding FROM facts WHERE id = ?').get(id) as
            | { embedding: Buffer | null }
            | undefined;
        return row?.embedding ?? null;
    }

    /** Iterate over all facts that lack an embedding (for backfill). */
    listFactsWithoutEmbedding(): MemoryFact[] {
        const rows = this.db.prepare(
            "SELECT * FROM facts WHERE embedding IS NULL AND status = 'active'"
        ).all() as DbRow[];
        return rows.map(rowToFact);
    }

    close(): void {
        this.db.close();
    }
}
