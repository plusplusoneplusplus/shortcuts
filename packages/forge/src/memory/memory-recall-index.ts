/**
 * SQLite-backed ranked recall for bounded memory entries.
 *
 * MEMORY.md remains the clean source of facts. This index stores normalized
 * copies for FTS lookup and recall telemetry, then callers decide which
 * recalled entries are injected into prompts.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { ENTRY_DELIMITER } from './bounded-memory-types';
import {
    hashMemoryCandidateContent,
    normalizeMemoryCandidateContent,
} from './memory-content-normalization';

export type MemoryRecallScope = 'repo' | 'system';

export interface MemoryRecallIndexOptions {
    /** Absolute path to the recall index database. */
    dbPath: string;
}

export interface MemoryRecallSyncInput {
    namespace: string;
    scope: MemoryRecallScope;
    entries: string[];
    isProtected?: (entry: string, context: { scope: MemoryRecallScope; ordinal: number }) => boolean;
    syncedAt?: string;
}

export interface MemoryRecallQuery {
    namespace: string;
    query: string;
    scopes?: MemoryRecallScope[];
    /** Maximum number of ranked entries. Protected entries do not count. */
    maxEntries?: number;
    /** Maximum serialized characters for ranked + protected entries. Protected entries are always kept. */
    charBudget?: number;
    /** FTS5 BM25 upper bound. Lower scores are better. */
    maxBm25Score?: number;
    includeProtected?: boolean;
    recalledAt?: string;
}

export interface MemoryRecallListQuery {
    namespace: string;
    scopes?: MemoryRecallScope[];
}

export interface MemoryRecallResultEntry {
    id: string;
    namespace: string;
    scope: MemoryRecallScope;
    ordinal: number;
    content: string;
    normalizedContent: string;
    contentHash: string;
    protected: boolean;
    bm25Score: number | null;
    recallCount: number;
    lastRecalledAt: string | null;
    lastQueryHash: string | null;
}

interface EntryRow {
    id: string;
    namespace: string;
    scope: string;
    ordinal: number;
    content: string;
    normalized_content: string;
    content_hash: string;
    protected_entry: number;
    recall_count: number;
    last_recalled_at: string | null;
    last_query_hash: string | null;
    bm25_score?: number | null;
}

const DEFAULT_MAX_ENTRIES = 8;
const MAX_QUERY_TERMS = 12;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_recall_entries (
    id                TEXT PRIMARY KEY,
    namespace         TEXT NOT NULL,
    scope             TEXT NOT NULL CHECK(scope IN ('repo', 'system')),
    ordinal           INTEGER NOT NULL,
    content           TEXT NOT NULL,
    normalized_content TEXT NOT NULL,
    content_hash      TEXT NOT NULL,
    protected_entry   INTEGER NOT NULL DEFAULT 0 CHECK(protected_entry IN (0, 1)),
    recall_count      INTEGER NOT NULL DEFAULT 0 CHECK(recall_count >= 0),
    last_recalled_at  TEXT,
    last_query_hash   TEXT,
    last_synced_at    TEXT NOT NULL,
    UNIQUE(namespace, scope, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_mre_namespace_scope
    ON memory_recall_entries(namespace, scope);

CREATE TABLE IF NOT EXISTS memory_recall_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id      TEXT NOT NULL,
    namespace     TEXT NOT NULL,
    scope         TEXT NOT NULL CHECK(scope IN ('repo', 'system')),
    query_hash    TEXT NOT NULL,
    recalled_at   TEXT NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES memory_recall_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mre_events_entry
    ON memory_recall_events(entry_id, recalled_at);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_recall_fts
    USING fts5(entry_id UNINDEXED, content, normalized_content);
`;

export class MemoryRecallIndex {
    private readonly dbPath: string;
    private readonly db: DatabaseType;
    private readonly stmtInsertEntry: Statement;
    private readonly stmtUpdateEntry: Statement;
    private readonly stmtInsertFts: Statement;
    private readonly stmtDeleteFts: Statement;
    private readonly stmtDeleteEntry: Statement;
    private readonly stmtSelectProtected: Statement;
    private readonly stmtUpdateRecall: Statement;
    private readonly stmtInsertRecallEvent: Statement;

    constructor(options: MemoryRecallIndexOptions) {
        this.dbPath = options.dbPath;
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.exec(SCHEMA_SQL);

        this.stmtInsertEntry = this.db.prepare(`
            INSERT INTO memory_recall_entries
                (id, namespace, scope, ordinal, content, normalized_content, content_hash,
                 protected_entry, last_synced_at)
            VALUES
                (@id, @namespace, @scope, @ordinal, @content, @normalizedContent, @contentHash,
                 @protectedEntry, @lastSyncedAt)
        `);
        this.stmtUpdateEntry = this.db.prepare(`
            UPDATE memory_recall_entries
            SET ordinal = @ordinal,
                content = @content,
                normalized_content = @normalizedContent,
                protected_entry = @protectedEntry,
                last_synced_at = @lastSyncedAt
            WHERE id = @id
        `);
        this.stmtInsertFts = this.db.prepare(`
            INSERT INTO memory_recall_fts (entry_id, content, normalized_content)
            VALUES (@id, @content, @normalizedContent)
        `);
        this.stmtDeleteFts = this.db.prepare(`DELETE FROM memory_recall_fts WHERE entry_id = @id`);
        this.stmtDeleteEntry = this.db.prepare(`DELETE FROM memory_recall_entries WHERE id = @id`);
        this.stmtSelectProtected = this.db.prepare(`
            SELECT *, NULL AS bm25_score
            FROM memory_recall_entries
            WHERE namespace = @namespace AND protected_entry = 1
            ORDER BY scope DESC, ordinal ASC, id ASC
        `);
        this.stmtUpdateRecall = this.db.prepare(`
            UPDATE memory_recall_entries
            SET recall_count = recall_count + 1,
                last_recalled_at = @recalledAt,
                last_query_hash = @queryHash
            WHERE id = @id
        `);
        this.stmtInsertRecallEvent = this.db.prepare(`
            INSERT INTO memory_recall_events (entry_id, namespace, scope, query_hash, recalled_at)
            VALUES (@id, @namespace, @scope, @queryHash, @recalledAt)
        `);
    }

    syncEntries(input: MemoryRecallSyncInput): void {
        const namespace = normalizeNamespace(input.namespace);
        const scope = normalizeScope(input.scope);
        const syncedAt = input.syncedAt ?? new Date().toISOString();
        const rows = this.prepareRows({
            ...input,
            namespace,
            scope,
            syncedAt,
        });

        this.db.transaction(() => {
            const existing = this.db.prepare(`
                SELECT id FROM memory_recall_entries
                WHERE namespace = @namespace AND scope = @scope
            `).all({ namespace, scope }) as { id: string }[];
            const existingIds = new Set(existing.map(row => row.id));
            const nextIds = new Set(rows.map(row => row.id as string));

            for (const row of existing) {
                if (!nextIds.has(row.id)) {
                    this.stmtDeleteFts.run({ id: row.id });
                    this.stmtDeleteEntry.run({ id: row.id });
                }
            }

            for (const row of rows) {
                if (existingIds.has(row.id as string)) {
                    this.stmtUpdateEntry.run(row);
                    this.stmtDeleteFts.run(row);
                } else {
                    this.stmtInsertEntry.run(row);
                }
                this.stmtInsertFts.run(row);
            }
        })();
    }

    recall(options: MemoryRecallQuery): MemoryRecallResultEntry[] {
        const namespace = normalizeNamespace(options.namespace);
        const scopes = normalizeScopes(options.scopes);
        const queryTerms = tokenizeRecallQuery(options.query);
        const protectedEntries = options.includeProtected === false
            ? []
            : this.selectProtected(namespace, scopes);
        const protectedIds = new Set(protectedEntries.map(entry => entry.id));

        const ranked = queryTerms.length > 0
            ? this.searchRanked(namespace, scopes, queryTerms, options.maxBm25Score)
                .filter(entry => !protectedIds.has(entry.id))
                .slice(0, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
            : [];

        const selected = applyRecallBudget(
            [...protectedEntries, ...ranked],
            options.charBudget,
        );

        if (selected.length > 0 && queryTerms.length > 0) {
            this.recordRecall(selected, options.query, options.recalledAt);
        }

        return selected;
    }

    listEntries(options: MemoryRecallListQuery): MemoryRecallResultEntry[] {
        const namespace = normalizeNamespace(options.namespace);
        const scopes = normalizeScopes(options.scopes);
        const rows = this.db.prepare(`
            SELECT *, NULL AS bm25_score
            FROM memory_recall_entries
            WHERE namespace = @namespace
            ORDER BY ordinal ASC, id ASC
        `).all({ namespace }) as EntryRow[];

        return rows
            .filter(row => scopes.includes(normalizeScope(row.scope)))
            .map(rowToResultEntry);
    }

    recordRecall(entries: MemoryRecallResultEntry[], query: string, recalledAt = new Date().toISOString()): void {
        if (entries.length === 0) return;
        const queryHash = hashRecallQuery(query);

        this.db.transaction(() => {
            for (const entry of entries) {
                this.stmtUpdateRecall.run({ id: entry.id, queryHash, recalledAt });
                this.stmtInsertRecallEvent.run({
                    id: entry.id,
                    namespace: entry.namespace,
                    scope: entry.scope,
                    queryHash,
                    recalledAt,
                });
            }
        })();
    }

    close(): void {
        this.db.close();
    }

    private prepareRows(input: MemoryRecallSyncInput & { syncedAt: string }): Array<Record<string, unknown>> {
        const seen = new Set<string>();
        const rows: Array<Record<string, unknown>> = [];

        input.entries.forEach((entry, ordinal) => {
            const content = entry.trim();
            const normalizedContent = normalizeMemoryCandidateContent(content);
            if (!normalizedContent || seen.has(normalizedContent)) return;
            seen.add(normalizedContent);

            const contentHash = hashMemoryCandidateContent(normalizedContent);
            rows.push({
                id: createEntryId(input.namespace, input.scope, contentHash),
                namespace: input.namespace,
                scope: input.scope,
                ordinal,
                content,
                normalizedContent,
                contentHash,
                protectedEntry: input.isProtected?.(content, { scope: input.scope, ordinal }) ? 1 : 0,
                lastSyncedAt: input.syncedAt,
            });
        });

        return rows;
    }

    private selectProtected(namespace: string, scopes: MemoryRecallScope[]): MemoryRecallResultEntry[] {
        const rows = this.stmtSelectProtected.all({ namespace }) as EntryRow[];
        return rows
            .filter(row => scopes.includes(normalizeScope(row.scope)))
            .map(rowToResultEntry);
    }

    private searchRanked(
        namespace: string,
        scopes: MemoryRecallScope[],
        terms: string[],
        maxBm25Score: number | undefined,
    ): MemoryRecallResultEntry[] {
        const scopeSql = scopes.length === 1
            ? `e.scope = '${scopes[0]}'`
            : `e.scope IN ('repo', 'system')`;
        const thresholdSql = typeof maxBm25Score === 'number' && Number.isFinite(maxBm25Score)
            ? 'AND m.bm25_score <= @maxBm25Score'
            : '';
        const stmt = this.db.prepare(`
            WITH matches AS (
                SELECT entry_id, bm25(memory_recall_fts) AS bm25_score
                FROM memory_recall_fts
                WHERE memory_recall_fts MATCH @matchQuery
            )
            SELECT e.*, m.bm25_score
            FROM matches m
            JOIN memory_recall_entries e ON e.id = m.entry_id
            WHERE e.namespace = @namespace AND ${scopeSql}
            ${thresholdSql}
            ORDER BY e.protected_entry DESC, m.bm25_score ASC, e.ordinal ASC, e.id ASC
        `);
        return (stmt.all({
            namespace,
            matchQuery: terms.map(term => `${term}*`).join(' OR '),
            maxBm25Score,
        }) as EntryRow[]).map(rowToResultEntry);
    }
}

function rowToResultEntry(row: EntryRow): MemoryRecallResultEntry {
    return {
        id: row.id,
        namespace: row.namespace,
        scope: normalizeScope(row.scope),
        ordinal: row.ordinal,
        content: row.content,
        normalizedContent: row.normalized_content,
        contentHash: row.content_hash,
        protected: row.protected_entry === 1,
        bm25Score: row.bm25_score ?? null,
        recallCount: row.recall_count,
        lastRecalledAt: row.last_recalled_at,
        lastQueryHash: row.last_query_hash,
    };
}

function normalizeNamespace(namespace: string): string {
    const trimmed = namespace.trim();
    if (!trimmed) {
        throw new Error('Memory recall namespace cannot be empty.');
    }
    return trimmed;
}

function normalizeScope(scope: string): MemoryRecallScope {
    if (scope === 'repo' || scope === 'system') return scope;
    throw new Error(`Unknown memory recall scope: ${scope}`);
}

function normalizeScopes(scopes: MemoryRecallScope[] | undefined): MemoryRecallScope[] {
    const normalized = scopes?.map(normalizeScope) ?? ['repo', 'system'];
    return [...new Set(normalized)];
}

function tokenizeRecallQuery(query: string): string[] {
    const tokens = query
        .toLowerCase()
        .match(/[a-z0-9_]{2,}/g) ?? [];
    return [...new Set(tokens)].slice(0, MAX_QUERY_TERMS);
}

function hashRecallQuery(query: string): string {
    return createHash('sha256')
        .update(normalizeMemoryCandidateContent(query.toLowerCase()))
        .digest('hex');
}

function createEntryId(namespace: string, scope: MemoryRecallScope, contentHash: string): string {
    return createHash('sha256')
        .update(`${namespace}\0${scope}\0${contentHash}`)
        .digest('hex');
}

function applyRecallBudget(
    entries: MemoryRecallResultEntry[],
    charBudget: number | undefined,
): MemoryRecallResultEntry[] {
    if (typeof charBudget !== 'number' || !Number.isFinite(charBudget) || charBudget <= 0) {
        return entries;
    }

    const selected: MemoryRecallResultEntry[] = [];
    let used = 0;

    for (const entry of entries) {
        const projected = selected.length === 0
            ? entry.content.length
            : used + ENTRY_DELIMITER.length + entry.content.length;
        if (entry.protected || projected <= charBudget) {
            selected.push(entry);
            used = projected;
        }
    }

    return selected;
}
