/**
 * Shared base for the SQLite stores that map a domain key (commit hash, PR ID,
 * work item ID, note path) to a chat task ID.
 *
 * All four tables have the same shape — `workspace_id, <key>, task_id,
 * created_at` with `PRIMARY KEY (workspace_id, <key>)` — so statement
 * preparation and the CRUD core live here; subclasses supply the table and key
 * column and keep only their domain-specific methods.
 */

import type Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

/** A single binding entry. taskId is the process/task ID of the chat conversation. */
export interface ChatBinding {
    taskId: string;
    /** ISO-8601 timestamp of when the binding was created. */
    createdAt: string;
}

/** Map of domain key → binding. */
export type ChatBindings = Record<string, ChatBinding>;

/** Row shape returned by the list statements (the key column is aliased to `key`). */
export interface BindingRow {
    key: string;
    task_id: string;
    created_at: string;
}

// ============================================================================
// ChatBindingStore
// ============================================================================

export class ChatBindingStore {
    protected readonly stmtList: Database.Statement;
    protected readonly stmtGet: Database.Statement;
    protected readonly stmtBind: Database.Statement;
    protected readonly stmtBindWithCreatedAt: Database.Statement;
    protected readonly stmtUnbind: Database.Statement;
    protected readonly stmtDeleteScope: Database.Statement;

    /**
     * @param table      Table name. MUST be a compile-time literal supplied by a
     *                   subclass — never a runtime/user-provided string, since it
     *                   is interpolated into SQL.
     * @param keyColumn  Key column name. Same constraint as `table`.
     */
    constructor(
        protected readonly db: Database.Database,
        table: string,
        protected readonly keyColumn: string,
    ) {
        this.stmtList = db.prepare(
            `SELECT ${keyColumn} AS key, task_id, created_at FROM ${table} WHERE workspace_id = ?`,
        );
        this.stmtGet = db.prepare(
            `SELECT task_id, created_at FROM ${table} WHERE workspace_id = ? AND ${keyColumn} = ?`,
        );
        this.stmtBind = db.prepare(
            `INSERT OR REPLACE INTO ${table} (workspace_id, ${keyColumn}, task_id, created_at) VALUES (?, ?, ?, ?)`,
        );
        this.stmtBindWithCreatedAt = db.prepare(
            `INSERT INTO ${table} (workspace_id, ${keyColumn}, task_id, created_at) VALUES (?, ?, ?, ?)`,
        );
        this.stmtUnbind = db.prepare(
            `DELETE FROM ${table} WHERE workspace_id = ? AND ${keyColumn} = ?`,
        );
        this.stmtDeleteScope = db.prepare(
            `DELETE FROM ${table} WHERE workspace_id = ?`,
        );
    }

    /** Load all bindings for a scope. Returns {} when none exist. */
    list(scopeId: string): ChatBindings {
        return toBindings(this.stmtList.all(scopeId) as BindingRow[]);
    }

    /** Get the binding for a single key, or undefined. */
    get(scopeId: string, key: string): ChatBinding | undefined {
        const row = this.stmtGet.get(scopeId, key) as Omit<BindingRow, 'key'> | undefined;
        if (!row) return undefined;
        return { taskId: row.task_id, createdAt: row.created_at };
    }

    /** Create or overwrite the binding for a key. */
    bind(scopeId: string, key: string, taskId: string): void {
        this.stmtBind.run(scopeId, key, taskId, new Date().toISOString());
    }

    /** Remove the binding for a key. No-op if not present. Returns true if a binding was removed. */
    unbind(scopeId: string, key: string): boolean {
        const info = this.stmtUnbind.run(scopeId, key);
        return info.changes > 0;
    }

    /**
     * Move legacy scoped rows into a target scope's rowset.
     *
     * The SQLite tables keep their historical `workspace_id` column name; callers
     * pass a canonical scope ID (e.g. an origin ID) as the scope key. The newest
     * binding per key wins across the legacy scopes, rows already present in the
     * target scope are preserved, `created_at` carries over, and every legacy
     * scope is emptied — all in one transaction.
     */
    migrateLegacyScopes(scopeId: string, legacyScopeIds: readonly string[] = []): void {
        const legacyScopes = Array.from(new Set(legacyScopeIds.map(id => id.trim()).filter(id => id && id !== scopeId)));
        if (legacyScopes.length === 0) return;

        const migrate = this.db.transaction(() => {
            const selected = new Map<string, ChatBinding>();
            for (const legacyScope of legacyScopes) {
                const rows = this.stmtList.all(legacyScope) as BindingRow[];
                for (const row of rows) {
                    const current = selected.get(row.key);
                    if (!current || row.created_at > current.createdAt) {
                        selected.set(row.key, { taskId: row.task_id, createdAt: row.created_at });
                    }
                }
            }

            for (const [key, binding] of selected) {
                if (!this.stmtGet.get(scopeId, key)) {
                    this.stmtBindWithCreatedAt.run(scopeId, key, binding.taskId, binding.createdAt);
                }
            }

            for (const legacyScope of legacyScopes) {
                this.stmtDeleteScope.run(legacyScope);
            }
        });
        migrate();
    }
}

/** Map aliased rows into the `{ key: { taskId, createdAt } }` shape. */
export function toBindings(rows: readonly BindingRow[]): ChatBindings {
    const result: ChatBindings = {};
    for (const row of rows) {
        result[row.key] = { taskId: row.task_id, createdAt: row.created_at };
    }
    return result;
}
