/**
 * Read-only query service for the native GitHub Copilot CLI session store.
 *
 * The native store (`~/.copilot/session-store.db`) is external data owned by
 * the Copilot CLI. This service opens it with short-lived read-only SQLite
 * connections per request and never executes a write statement against it.
 * Missing or invalid stores produce typed unavailable results instead of
 * throwing, so the dashboard can render a non-fatal state.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import DatabaseConstructor from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import type {
    NativeCopilotSessionDetail,
    NativeCopilotSessionDetailResult,
    NativeCopilotSessionListItem,
    NativeCopilotSessionListOptions,
    NativeCopilotSessionListResult,
    NativeCopilotSessionTurn,
    NativeSessionWorkspaceScope,
} from './types';

export const DEFAULT_NATIVE_SESSION_LIST_LIMIT = 50;
const MAX_NATIVE_SESSION_LIST_LIMIT = 200;
const MAX_MATCH_SNIPPETS = 3;
const SUMMARY_PREVIEW_MAX_CHARS = 200;

/** Default native Copilot CLI session store location for the server user. */
export function getDefaultNativeCopilotSessionDbPath(): string {
    return path.join(os.homedir(), '.copilot', 'session-store.db');
}

interface SessionRow {
    id: string;
    cwd: string | null;
    repository: string | null;
    host_type: string | null;
    branch: string | null;
    summary: string | null;
    created_at: string | null;
    updated_at: string | null;
}

interface TurnRow {
    id: number;
    turn_index: number;
    user_message: string | null;
    assistant_response: string | null;
    timestamp: string | null;
}

type DbOpenResult =
    | { ok: true; db: Database }
    | { ok: false; reason: 'db-missing' | 'db-invalid' };

/** Normalize a filesystem path for cross-platform equality/prefix matching. */
function normalizePathForMatch(value: string): string {
    let normalized = path.normalize(value.trim()).replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** True when a native session belongs to the given CoC workspace. */
export function sessionMatchesWorkspace(
    row: { repository: string | null; cwd: string | null },
    scope: NativeSessionWorkspaceScope,
): boolean {
    if (scope.repository && row.repository
        && row.repository.trim().toLowerCase() === scope.repository.trim().toLowerCase()) {
        return true;
    }
    if (scope.rootPath && row.cwd) {
        const root = normalizePathForMatch(scope.rootPath);
        const cwd = normalizePathForMatch(row.cwd);
        if (cwd === root || cwd.startsWith(`${root}/`)) {
            return true;
        }
    }
    return false;
}

/**
 * Convert free text into a safe FTS5 MATCH expression: each whitespace-separated
 * term becomes a quoted string literal so user input can never inject FTS syntax.
 * Returns null when the query has no usable terms.
 */
export function buildFtsMatchExpression(query: string): string | null {
    const terms = query.split(/\s+/).map(term => term.trim()).filter(Boolean);
    if (terms.length === 0) {
        return null;
    }
    return terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' ');
}

function summaryPreview(summary: string | null): string {
    if (!summary) {
        return '';
    }
    const firstLine = summary.split('\n', 1)[0].trim();
    return firstLine.length > SUMMARY_PREVIEW_MAX_CHARS
        ? `${firstLine.slice(0, SUMMARY_PREVIEW_MAX_CHARS)}…`
        : firstLine;
}

function parseTimestamp(value: string | null | undefined): number {
    if (!value) {
        return Number.NaN;
    }
    return Date.parse(value);
}

function clampLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return DEFAULT_NATIVE_SESSION_LIST_LIMIT;
    }
    return Math.min(Math.max(Math.floor(limit), 1), MAX_NATIVE_SESSION_LIST_LIMIT);
}

function clampOffset(offset: number | undefined): number {
    if (offset === undefined || !Number.isFinite(offset)) {
        return 0;
    }
    return Math.max(Math.floor(offset), 0);
}

export interface NativeCopilotSessionServiceOptions {
    /** Override of the native session store path (tests use synthetic fixtures). */
    dbPath?: string;
}

export class NativeCopilotSessionService {
    private readonly dbPath: string;

    constructor(options: NativeCopilotSessionServiceOptions = {}) {
        this.dbPath = options.dbPath ?? getDefaultNativeCopilotSessionDbPath();
    }

    /** List native sessions scoped to one workspace, newest `updated_at` first. */
    listSessions(
        scope: NativeSessionWorkspaceScope,
        options: NativeCopilotSessionListOptions = {},
    ): NativeCopilotSessionListResult & { limit: number; offset: number } {
        const limit = clampLimit(options.limit);
        const offset = clampOffset(options.offset);
        const opened = this.openReadOnly();
        if (!opened.ok) {
            return { available: false, reason: opened.reason, limit, offset };
        }
        const db = opened.db;
        try {
            if (!this.hasValidSchema(db)) {
                return { available: false, reason: 'db-invalid', limit, offset };
            }
            const searchIndexAvailable = this.hasSearchIndex(db);

            // Text query resolves through the native FTS index first. Without
            // the index, text search yields no hits but stays non-fatal.
            let textHits: Map<string, string[]> | null = null;
            const matchExpression = options.q ? buildFtsMatchExpression(options.q) : null;
            if (matchExpression) {
                textHits = searchIndexAvailable ? this.queryTextHits(db, matchExpression) : new Map();
            }
            if (textHits && textHits.size === 0) {
                return { available: true, items: [], total: 0, searchIndexAvailable, deduplicatedCount: 0, limit, offset };
            }

            const rows = this.querySessionRows(db, options, textHits);

            const fromTs = options.from ? parseTimestamp(options.from) : undefined;
            const toTs = options.to ? parseTimestamp(options.to) : undefined;
            const excludeSessionIds = options.excludeSessionIds;
            let deduplicatedCount = 0;
            const scoped = rows.filter(row => {
                if (!sessionMatchesWorkspace(row, scope)) {
                    return false;
                }
                if (fromTs !== undefined || toTs !== undefined) {
                    const updated = parseTimestamp(row.updated_at);
                    if (Number.isNaN(updated)) {
                        return false;
                    }
                    if (fromTs !== undefined && !Number.isNaN(fromTs) && updated < fromTs) {
                        return false;
                    }
                    if (toTs !== undefined && !Number.isNaN(toTs) && updated > toTs) {
                        return false;
                    }
                }
                // Hide native sessions already tracked as CoC processes (dedup).
                if (excludeSessionIds && excludeSessionIds.has(row.id)) {
                    deduplicatedCount += 1;
                    return false;
                }
                return true;
            });

            scoped.sort((a, b) => {
                const aTs = parseTimestamp(a.updated_at);
                const bTs = parseTimestamp(b.updated_at);
                return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs);
            });

            const total = scoped.length;
            const page = scoped.slice(offset, offset + limit);
            const turnCounts = this.queryTurnCounts(db, page.map(row => row.id));

            const items: NativeCopilotSessionListItem[] = page.map(row => ({
                id: row.id,
                repository: row.repository,
                cwd: row.cwd,
                hostType: row.host_type,
                branch: row.branch,
                summaryPreview: summaryPreview(row.summary),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                turnCount: turnCounts.get(row.id) ?? 0,
                matchSnippets: textHits?.get(row.id)?.slice(0, MAX_MATCH_SNIPPETS) ?? [],
            }));

            return { available: true, items, total, searchIndexAvailable, deduplicatedCount, limit, offset };
        } catch {
            return { available: false, reason: 'db-invalid', limit, offset };
        } finally {
            db.close();
        }
    }

    /** Read one native session with ordered turns, scoped to the workspace. */
    getSession(
        scope: NativeSessionWorkspaceScope,
        sessionId: string,
    ): NativeCopilotSessionDetailResult {
        const opened = this.openReadOnly();
        if (!opened.ok) {
            return { available: false, reason: opened.reason };
        }
        const db = opened.db;
        try {
            if (!this.hasValidSchema(db)) {
                return { available: false, reason: 'db-invalid' };
            }
            const row = db.prepare(
                'SELECT id, cwd, repository, host_type, branch, summary, created_at, updated_at FROM sessions WHERE id = ?',
            ).get(sessionId) as SessionRow | undefined;
            if (!row || !sessionMatchesWorkspace(row, scope)) {
                return { available: true, session: null };
            }

            const turnRows = db.prepare(
                'SELECT id, turn_index, user_message, assistant_response, timestamp FROM turns WHERE session_id = ? ORDER BY turn_index ASC',
            ).all(sessionId) as TurnRow[];

            const indexDiagnostics = this.querySearchIndexDiagnostics(db, sessionId);

            const turns: NativeCopilotSessionTurn[] = turnRows.map(turn => {
                const userMessage = turn.user_message ?? '';
                const assistantResponse = turn.assistant_response ?? '';
                const sourceId = `${sessionId}:turn:${turn.turn_index}`;
                const indexedChars = indexDiagnostics.get(sourceId);
                return {
                    id: turn.id,
                    turnIndex: turn.turn_index,
                    timestamp: turn.timestamp,
                    userMessage,
                    assistantResponse,
                    userChars: userMessage.length,
                    assistantChars: assistantResponse.length,
                    searchIndexSourceId: indexedChars === undefined ? null : sourceId,
                    searchIndexChars: indexedChars === undefined ? null : indexedChars,
                };
            });

            const session: NativeCopilotSessionDetail = {
                id: row.id,
                repository: row.repository,
                cwd: row.cwd,
                hostType: row.host_type,
                branch: row.branch,
                summary: row.summary ?? '',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                turns,
            };
            return { available: true, session };
        } catch {
            return { available: false, reason: 'db-invalid' };
        } finally {
            db.close();
        }
    }

    private openReadOnly(): DbOpenResult {
        if (!fs.existsSync(this.dbPath)) {
            return { ok: false, reason: 'db-missing' };
        }
        try {
            const db = new DatabaseConstructor(this.dbPath, { readonly: true, fileMustExist: true });
            return { ok: true, db };
        } catch {
            return { ok: false, reason: 'db-invalid' };
        }
    }

    private hasValidSchema(db: Database): boolean {
        try {
            // prepare() fails when a table or expected column is absent.
            db.prepare('SELECT id, cwd, repository, host_type, branch, summary, created_at, updated_at FROM sessions LIMIT 0').all();
            db.prepare('SELECT id, session_id, turn_index, user_message, assistant_response, timestamp FROM turns LIMIT 0').all();
            return true;
        } catch {
            return false;
        }
    }

    private hasSearchIndex(db: Database): boolean {
        try {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_index'",
            ).get();
            return row !== undefined;
        } catch {
            return false;
        }
    }

    private queryTextHits(db: Database, matchExpression: string): Map<string, string[]> {
        const hits = new Map<string, string[]>();
        try {
            const rows = db.prepare(
                "SELECT session_id AS sessionId, snippet(search_index, 0, '', '', '…', 12) AS snip FROM search_index WHERE search_index MATCH ?",
            ).all(matchExpression) as { sessionId: string | null; snip: string | null }[];
            for (const row of rows) {
                if (!row.sessionId) {
                    continue;
                }
                const existing = hits.get(row.sessionId) ?? [];
                if (row.snip && existing.length < MAX_MATCH_SNIPPETS) {
                    existing.push(row.snip);
                }
                hits.set(row.sessionId, existing);
            }
        } catch {
            // A broken FTS index behaves like an absent one: no text hits.
            hits.clear();
        }
        return hits;
    }

    private querySessionRows(
        db: Database,
        options: NativeCopilotSessionListOptions,
        textHits: Map<string, string[]> | null,
    ): SessionRow[] {
        const where: string[] = [];
        const params: unknown[] = [];

        if (options.branch) {
            where.push('branch = ?');
            params.push(options.branch);
        }
        if (options.sessionId) {
            const escaped = options.sessionId.replace(/([\\%_])/g, '\\$1');
            where.push("(id = ? OR id LIKE ? ESCAPE '\\')");
            params.push(options.sessionId, `%${escaped}%`);
        }
        if (textHits) {
            const ids = [...textHits.keys()];
            where.push(`id IN (${ids.map(() => '?').join(', ')})`);
            params.push(...ids);
        }

        const whereClause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
        return db.prepare(
            `SELECT id, cwd, repository, host_type, branch, summary, created_at, updated_at FROM sessions${whereClause}`,
        ).all(...params) as SessionRow[];
    }

    private queryTurnCounts(db: Database, sessionIds: string[]): Map<string, number> {
        const counts = new Map<string, number>();
        if (sessionIds.length === 0) {
            return counts;
        }
        const rows = db.prepare(
            `SELECT session_id AS sessionId, COUNT(*) AS turnCount FROM turns WHERE session_id IN (${sessionIds.map(() => '?').join(', ')}) GROUP BY session_id`,
        ).all(...sessionIds) as { sessionId: string; turnCount: number }[];
        for (const row of rows) {
            counts.set(row.sessionId, row.turnCount);
        }
        return counts;
    }

    private querySearchIndexDiagnostics(db: Database, sessionId: string): Map<string, number> {
        const diagnostics = new Map<string, number>();
        if (!this.hasSearchIndex(db)) {
            return diagnostics;
        }
        try {
            const rows = db.prepare(
                'SELECT source_id AS sourceId, length(content) AS chars FROM search_index WHERE session_id = ?',
            ).all(sessionId) as { sourceId: string | null; chars: number | null }[];
            for (const row of rows) {
                if (row.sourceId) {
                    diagnostics.set(row.sourceId, row.chars ?? 0);
                }
            }
        } catch {
            // Index diagnostics are optional; a broken index reads as "not indexed".
            diagnostics.clear();
        }
        return diagnostics;
    }
}
