/**
 * SQLite-backed Memory Candidate Store
 *
 * Durable candidate lifecycle for memory facts captured over time. Repeated
 * equivalent facts strengthen the same row instead of creating duplicates.
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
    MemoryCandidate,
    MemoryCandidateInput,
    MemoryCandidateStats,
    MemoryCandidateStatus,
    MemoryCandidateTarget,
} from './memory-candidate-types';
import { hashMemoryCandidateContent, normalizeMemoryCandidateContent } from './memory-content-normalization';

export interface MemoryCandidateStoreOptions {
    /** Absolute path to the .db file */
    dbPath: string;
}

interface CandidateRow {
    id: string;
    target: string;
    content: string;
    content_hash: string;
    source: string;
    workspace_id: string;
    process_id: string | null;
    turn_index: number | null;
    created_at: string;
    last_seen_at: string;
    signal_count: number;
    total_score: number;
    max_score: number;
    unique_process_count: number;
    recall_days_json: string;
    concept_tags_json: string;
    explicit_memory_intent: number;
    status: string;
    promoted_at: string | null;
    dropped_at: string | null;
    dropped_reason: string | null;
}

interface LegacyRawRecordRow {
    id: string;
    target: string;
    content: string;
    source: string;
    workspace_id: string;
    process_id: string | null;
    turn_index: number | null;
    created_at: string;
    metadata_json: string | null;
}

const KNOWN_STATUSES: readonly MemoryCandidateStatus[] = ['pending', 'promoted', 'dropped', 'ignored'];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_candidates (
    id                   TEXT PRIMARY KEY,
    target               TEXT NOT NULL CHECK(target IN ('repo', 'system')),
    content              TEXT NOT NULL,
    content_hash         TEXT NOT NULL,
    source               TEXT NOT NULL,
    workspace_id         TEXT NOT NULL,
    process_id           TEXT,
    turn_index           INTEGER,
    created_at           TEXT NOT NULL,
    last_seen_at         TEXT NOT NULL,
    signal_count         INTEGER NOT NULL DEFAULT 1 CHECK(signal_count >= 1),
    total_score          REAL NOT NULL DEFAULT 0,
    max_score            REAL NOT NULL DEFAULT 0,
    unique_process_count INTEGER NOT NULL DEFAULT 0 CHECK(unique_process_count >= 0),
    recall_days_json     TEXT NOT NULL DEFAULT '[]',
    concept_tags_json    TEXT NOT NULL DEFAULT '[]',
    explicit_memory_intent INTEGER NOT NULL DEFAULT 0 CHECK(explicit_memory_intent IN (0, 1)),
    status               TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'promoted', 'dropped', 'ignored')),
    promoted_at          TEXT,
    dropped_at           TEXT,
    dropped_reason       TEXT,
    UNIQUE(target, workspace_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_mc_status ON memory_candidates(status);
CREATE INDEX IF NOT EXISTS idx_mc_workspace_id ON memory_candidates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mc_scope_hash ON memory_candidates(target, workspace_id, content_hash);

CREATE TABLE IF NOT EXISTS memory_candidate_processes (
    candidate_id TEXT NOT NULL,
    process_key  TEXT NOT NULL,
    PRIMARY KEY(candidate_id, process_key),
    FOREIGN KEY(candidate_id) REFERENCES memory_candidates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_candidate_legacy_records (
    raw_record_id TEXT PRIMARY KEY,
    candidate_id  TEXT NOT NULL,
    FOREIGN KEY(candidate_id) REFERENCES memory_candidates(id) ON DELETE CASCADE
);
`;

export class MemoryCandidateStore {
    private readonly dbPath: string;
    private readonly db: DatabaseType;

    private stmtSelectByScopeHash!: Statement;
    private stmtSelectById!: Statement;
    private stmtInsertCandidate!: Statement;
    private stmtUpdateCandidateSignal!: Statement;
    private stmtSelectPending!: Statement;
    private stmtInsertProcess!: Statement;
    private stmtCountProcesses!: Statement;
    private stmtUpdateProcessCount!: Statement;
    private stmtStats!: Statement;

    constructor(options: MemoryCandidateStoreOptions) {
        this.dbPath = options.dbPath;
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

        this.db = new Database(this.dbPath);
        this.initializeSchema();
        this.prepareStatements();
        this.migratePendingRawRecords();
    }

    async upsertCandidate(input: MemoryCandidateInput): Promise<MemoryCandidate> {
        return this.db.transaction(() => this.upsertCandidateSync(input))();
    }

    async listPendingCandidates(limit = 100): Promise<MemoryCandidate[]> {
        const rows = this.stmtSelectPending.all({ limit }) as CandidateRow[];
        return rows.map(row => this.rowToCandidate(row));
    }

    async getCandidate(id: string): Promise<MemoryCandidate | null> {
        const row = this.stmtSelectById.get({ id }) as CandidateRow | undefined;
        return row ? this.rowToCandidate(row) : null;
    }

    async markPromoted(ids: string[], promotedAt = new Date().toISOString()): Promise<number> {
        if (ids.length === 0) return 0;
        const stmt = this.db.prepare(`
            UPDATE memory_candidates
            SET status = 'promoted', promoted_at = @promotedAt
            WHERE id = @id AND status = 'pending'
        `);
        return this.db.transaction(() => {
            let changes = 0;
            for (const id of ids) {
                changes += stmt.run({ id, promotedAt }).changes;
            }
            return changes;
        })();
    }

    async markDropped(ids: string[], reason: string, droppedAt = new Date().toISOString()): Promise<number> {
        if (ids.length === 0) return 0;
        const stmt = this.db.prepare(`
            UPDATE memory_candidates
            SET status = 'dropped', dropped_at = @droppedAt, dropped_reason = @reason
            WHERE id = @id AND status = 'pending'
        `);
        return this.db.transaction(() => {
            let changes = 0;
            for (const id of ids) {
                changes += stmt.run({ id, reason, droppedAt }).changes;
            }
            return changes;
        })();
    }

    async markIgnored(ids: string[], reason: string): Promise<number> {
        if (ids.length === 0) return 0;
        const stmt = this.db.prepare(`
            UPDATE memory_candidates
            SET status = 'ignored', dropped_reason = @reason
            WHERE id = @id AND status = 'pending'
        `);
        return this.db.transaction(() => {
            let changes = 0;
            for (const id of ids) {
                changes += stmt.run({ id, reason }).changes;
            }
            return changes;
        })();
    }

    async getStats(): Promise<MemoryCandidateStats> {
        const rows = this.stmtStats.all() as { status: string; cnt: number }[];
        const stats: MemoryCandidateStats = {
            pending: 0,
            promoted: 0,
            dropped: 0,
            ignored: 0,
            total: 0,
        };

        for (const row of rows) {
            if (isKnownStatus(row.status)) {
                stats[row.status] = row.cnt;
            }
            stats.total += row.cnt;
        }

        return stats;
    }

    close(): void {
        this.db.close();
    }

    private initializeSchema(): void {
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.exec(SCHEMA_SQL);
        this.ensureExplicitMemoryIntentColumn();
    }

    private ensureExplicitMemoryIntentColumn(): void {
        const columns = this.db.prepare(`PRAGMA table_info(memory_candidates)`).all() as { name: string }[];
        if (columns.some(column => column.name === 'explicit_memory_intent')) return;
        this.db.exec(`ALTER TABLE memory_candidates ADD COLUMN explicit_memory_intent INTEGER NOT NULL DEFAULT 0`);
    }

    private prepareStatements(): void {
        this.stmtSelectByScopeHash = this.db.prepare(`
            SELECT * FROM memory_candidates
            WHERE target = @target AND workspace_id = @workspaceId AND content_hash = @contentHash
        `);
        this.stmtSelectById = this.db.prepare(`SELECT * FROM memory_candidates WHERE id = @id`);
        this.stmtInsertCandidate = this.db.prepare(`
            INSERT INTO memory_candidates
                (id, target, content, content_hash, source, workspace_id, process_id, turn_index,
                 created_at, last_seen_at, signal_count, total_score, max_score, unique_process_count,
                 recall_days_json, concept_tags_json, explicit_memory_intent, status)
            VALUES
                (@id, @target, @content, @contentHash, @source, @workspaceId, @processId, @turnIndex,
                 @createdAt, @lastSeenAt, 1, @score, @score, 0,
                 @recallDaysJson, @conceptTagsJson, @explicitMemoryIntent, 'pending')
        `);
        this.stmtUpdateCandidateSignal = this.db.prepare(`
            UPDATE memory_candidates
            SET last_seen_at = @lastSeenAt,
                signal_count = signal_count + 1,
                total_score = total_score + @score,
                max_score = MAX(max_score, @score),
                recall_days_json = @recallDaysJson,
                concept_tags_json = @conceptTagsJson,
                explicit_memory_intent = MAX(explicit_memory_intent, @explicitMemoryIntent)
            WHERE id = @id
        `);
        this.stmtSelectPending = this.db.prepare(`
            SELECT * FROM memory_candidates
            WHERE status = 'pending'
            ORDER BY max_score DESC, signal_count DESC, created_at ASC, id ASC
            LIMIT @limit
        `);
        this.stmtInsertProcess = this.db.prepare(`
            INSERT OR IGNORE INTO memory_candidate_processes (candidate_id, process_key)
            VALUES (@candidateId, @processKey)
        `);
        this.stmtCountProcesses = this.db.prepare(`
            SELECT COUNT(*) as cnt FROM memory_candidate_processes WHERE candidate_id = @candidateId
        `);
        this.stmtUpdateProcessCount = this.db.prepare(`
            UPDATE memory_candidates SET unique_process_count = @count WHERE id = @candidateId
        `);
        this.stmtStats = this.db.prepare(`
            SELECT status, COUNT(*) as cnt FROM memory_candidates GROUP BY status
        `);
    }

    private upsertCandidateSync(input: MemoryCandidateInput): MemoryCandidate {
        const target = normalizeTarget(input.target);
        const content = normalizeMemoryCandidateContent(input.content);
        if (!content) {
            throw new Error('Memory candidate content cannot be empty.');
        }

        const workspaceId = input.workspaceId;
        const seenAt = input.seenAt ?? new Date().toISOString();
        const score = normalizeScore(input.score);
        const contentHash = hashMemoryCandidateContent(content);
        const recallDay = seenAt.slice(0, 10);
        const conceptTags = normalizeConceptTags(input.conceptTags);
        const explicitMemoryIntent = input.explicitMemoryIntent ? 1 : 0;

        const existing = this.stmtSelectByScopeHash.get({
            target,
            workspaceId,
            contentHash,
        }) as CandidateRow | undefined;

        let candidateId: string;
        if (!existing) {
            candidateId = randomUUID();
            this.stmtInsertCandidate.run({
                id: candidateId,
                target,
                content,
                contentHash,
                source: input.source,
                workspaceId,
                processId: input.processId ?? null,
                turnIndex: input.turnIndex ?? null,
                createdAt: seenAt,
                lastSeenAt: seenAt,
                score,
                recallDaysJson: JSON.stringify([recallDay]),
                conceptTagsJson: JSON.stringify(conceptTags),
                explicitMemoryIntent,
            });
        } else {
            candidateId = existing.id;
            this.stmtUpdateCandidateSignal.run({
                id: candidateId,
                lastSeenAt: seenAt,
                score,
                recallDaysJson: JSON.stringify(mergeJsonArray(existing.recall_days_json, [recallDay])),
                conceptTagsJson: JSON.stringify(mergeJsonArray(existing.concept_tags_json, conceptTags)),
                explicitMemoryIntent,
            });
        }

        this.recordProcessSignal(candidateId, input.processId ?? null);
        const row = this.stmtSelectById.get({ id: candidateId }) as CandidateRow | undefined;
        if (!row) {
            throw new Error(`Memory candidate not found after upsert: ${candidateId}`);
        }
        return this.rowToCandidate(row);
    }

    private recordProcessSignal(candidateId: string, processId: string | null): void {
        if (!processId) return;
        this.stmtInsertProcess.run({ candidateId, processKey: processId });
        const row = this.stmtCountProcesses.get({ candidateId }) as { cnt: number };
        this.stmtUpdateProcessCount.run({ candidateId, count: row.cnt });
    }

    private migratePendingRawRecords(): void {
        const hasRawTable = this.db.prepare(`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'raw_memory_records'
        `).get();
        if (!hasRawTable) return;

        const pendingRows = this.db.prepare(`
            SELECT r.id, r.target, r.content, r.source, r.workspace_id, r.process_id, r.turn_index, r.created_at, r.metadata_json
            FROM raw_memory_records r
            LEFT JOIN memory_candidate_legacy_records m ON m.raw_record_id = r.id
            WHERE r.status = 'pending' AND m.raw_record_id IS NULL
            ORDER BY r.created_at ASC
        `).all() as LegacyRawRecordRow[];

        if (pendingRows.length === 0) return;

        const insertMigration = this.db.prepare(`
            INSERT OR IGNORE INTO memory_candidate_legacy_records (raw_record_id, candidate_id)
            VALUES (@rawRecordId, @candidateId)
        `);

        this.db.transaction(() => {
            for (const row of pendingRows) {
                const candidate = this.upsertCandidateSync({
                    target: normalizeLegacyTarget(row.target),
                    content: row.content,
                    source: row.source,
                    workspaceId: row.workspace_id,
                    processId: row.process_id,
                    turnIndex: row.turn_index,
                    seenAt: row.created_at,
                    explicitMemoryIntent: parseExplicitMemoryIntent(row.metadata_json),
                });
                insertMigration.run({ rawRecordId: row.id, candidateId: candidate.id });
            }
        })();
    }

    private rowToCandidate(row: CandidateRow): MemoryCandidate {
        return {
            id: row.id,
            target: normalizeTarget(row.target),
            content: row.content,
            contentHash: row.content_hash,
            source: row.source,
            workspaceId: row.workspace_id,
            processId: row.process_id,
            turnIndex: row.turn_index,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
            signalCount: row.signal_count,
            totalScore: row.total_score,
            maxScore: row.max_score,
            uniqueProcessCount: row.unique_process_count,
            recallDays: parseJsonArray(row.recall_days_json),
            conceptTags: parseJsonArray(row.concept_tags_json),
            explicitMemoryIntent: row.explicit_memory_intent === 1,
            status: normalizeStatus(row.status),
            promotedAt: row.promoted_at,
            droppedAt: row.dropped_at,
            droppedReason: row.dropped_reason,
        };
    }
}

function normalizeScore(score: number | undefined): number {
    return typeof score === 'number' && Number.isFinite(score) ? score : 0;
}

function normalizeConceptTags(tags: string[] | undefined): string[] {
    if (!tags) return [];
    return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].sort();
}

function mergeJsonArray(json: string, values: string[]): string[] {
    return [...new Set([...parseJsonArray(json), ...values])].sort();
}

function parseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed)
            ? parsed.filter((value): value is string => typeof value === 'string')
            : [];
    } catch {
        return [];
    }
}

function parseExplicitMemoryIntent(metadataJson: string | null): boolean {
    if (!metadataJson) return false;
    try {
        const parsed = JSON.parse(metadataJson) as { explicitMemoryIntent?: unknown };
        return parsed.explicitMemoryIntent === true;
    } catch {
        return false;
    }
}

function normalizeTarget(target: string): MemoryCandidateTarget {
    if (target === 'repo' || target === 'system') return target;
    throw new Error(`Unknown memory candidate target: ${target}`);
}

function normalizeLegacyTarget(target: string): MemoryCandidateTarget {
    return target === 'system' ? 'system' : 'repo';
}

function normalizeStatus(status: string): MemoryCandidateStatus {
    if (isKnownStatus(status)) return status;
    throw new Error(`Unknown memory candidate status: ${status}`);
}

function isKnownStatus(status: string): status is MemoryCandidateStatus {
    return (KNOWN_STATUSES as readonly string[]).includes(status);
}
