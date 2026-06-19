/**
 * PullRequestChatBindingStore
 *
 * Origin-scoped SQLite store mapping prId -> taskId for the PR-chat feature.
 * Uses the shared `processes.db` database (same pattern as CommitChatBindingStore).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

/** A single binding entry. taskId is the process/task ID of the chat conversation. */
export interface PullRequestChatBinding {
    taskId: string;
    /** ISO-8601 timestamp of when the binding was created. */
    createdAt: string;
}

/**
 * Map of prId → PullRequestChatBinding.
 * Keys are stringified PR IDs (numeric for GitHub/ADO, opaque for any future provider).
 */
export interface PullRequestChatBindings {
    [prId: string]: PullRequestChatBinding;
}

// ============================================================================
// PullRequestChatBindingStore
// ============================================================================

export class PullRequestChatBindingStore {
    private readonly db: Database.Database;
    private readonly stmtList: Database.Statement;
    private readonly stmtListByTask: Database.Statement;
    private readonly stmtGet: Database.Statement;
    private readonly stmtBind: Database.Statement;
    private readonly stmtBindWithCreatedAt: Database.Statement;
    private readonly stmtUnbind: Database.Statement;
    private readonly stmtDeleteScope: Database.Statement;

    constructor(db: Database.Database) {
        this.db = db;
        this.stmtList = db.prepare(
            'SELECT pr_id, task_id, created_at FROM pull_request_chat_bindings WHERE workspace_id = ?',
        );
        this.stmtListByTask = db.prepare(
            'SELECT pr_id, task_id, created_at FROM pull_request_chat_bindings WHERE workspace_id = ? AND task_id = ?',
        );
        this.stmtGet = db.prepare(
            'SELECT task_id, created_at FROM pull_request_chat_bindings WHERE workspace_id = ? AND pr_id = ?',
        );
        this.stmtBind = db.prepare(
            'INSERT OR REPLACE INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at) VALUES (?, ?, ?, ?)',
        );
        this.stmtBindWithCreatedAt = db.prepare(
            'INSERT INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at) VALUES (?, ?, ?, ?)',
        );
        this.stmtUnbind = db.prepare(
            'DELETE FROM pull_request_chat_bindings WHERE workspace_id = ? AND pr_id = ?',
        );
        this.stmtDeleteScope = db.prepare(
            'DELETE FROM pull_request_chat_bindings WHERE workspace_id = ?',
        );
    }

    /**
     * Move legacy workspace-scoped rows into an origin-scoped rowset.
     *
     * The SQLite table keeps its historical `workspace_id` column name; callers
     * pass a canonical origin ID as the scope key.
     */
    migrateLegacyScopes(scopeId: string, legacyScopeIds: readonly string[] = []): void {
        const legacyScopes = Array.from(new Set(legacyScopeIds.map(id => id.trim()).filter(id => id && id !== scopeId)));
        if (legacyScopes.length === 0) return;

        const migrate = this.db.transaction(() => {
            const selected = new Map<string, PullRequestChatBinding>();
            for (const legacyScope of legacyScopes) {
                const rows = this.stmtList.all(legacyScope) as Array<{ pr_id: string; task_id: string; created_at: string }>;
                for (const row of rows) {
                    const current = selected.get(row.pr_id);
                    if (!current || row.created_at > current.createdAt) {
                        selected.set(row.pr_id, { taskId: row.task_id, createdAt: row.created_at });
                    }
                }
            }

            for (const [prId, binding] of selected) {
                if (!this.stmtGet.get(scopeId, prId)) {
                    this.stmtBindWithCreatedAt.run(scopeId, prId, binding.taskId, binding.createdAt);
                }
            }

            for (const legacyScope of legacyScopes) {
                this.stmtDeleteScope.run(legacyScope);
            }
        });
        migrate();
    }

    /** Load all bindings for an origin scope. Returns {} when none exist. */
    load(scopeId: string, legacyScopeIds: readonly string[] = []): PullRequestChatBindings {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        const rows = this.stmtList.all(scopeId) as Array<{ pr_id: string; task_id: string; created_at: string }>;
        const result: PullRequestChatBindings = {};
        for (const row of rows) {
            result[row.pr_id] = { taskId: row.task_id, createdAt: row.created_at };
        }
        return result;
    }

    /**
     * List the bindings for an origin scope that point at a given chat `taskId`.
     *
     * Used on chat load to recover the PRs a conversation created, even after
     * the creating turn has been collapsed/trimmed and is no longer scanned by
     * the client-side detection pass. Returns {} when the task owns no bindings.
     */
    listByTaskId(scopeId: string, taskId: string, legacyScopeIds: readonly string[] = []): PullRequestChatBindings {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        const rows = this.stmtListByTask.all(scopeId, taskId) as Array<{ pr_id: string; task_id: string; created_at: string }>;
        const result: PullRequestChatBindings = {};
        for (const row of rows) {
            result[row.pr_id] = { taskId: row.task_id, createdAt: row.created_at };
        }
        return result;
    }

    /** Get the binding for a single PR, or undefined. */
    get(scopeId: string, prId: string, legacyScopeIds: readonly string[] = []): PullRequestChatBinding | undefined {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        const row = this.stmtGet.get(scopeId, prId) as { task_id: string; created_at: string } | undefined;
        if (!row) return undefined;
        return { taskId: row.task_id, createdAt: row.created_at };
    }

    /** Create or overwrite the binding for a PR. */
    bind(scopeId: string, prId: string, taskId: string, legacyScopeIds: readonly string[] = []): void {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        this.stmtBind.run(scopeId, prId, taskId, new Date().toISOString());
    }

    /** Remove the binding for a PR. No-op if not present. Returns true if a binding was removed. */
    unbind(scopeId: string, prId: string, legacyScopeIds: readonly string[] = []): boolean {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        const info = this.stmtUnbind.run(scopeId, prId);
        return info.changes > 0;
    }

    /** Return all bindings for an origin scope (convenience alias for load). */
    list(scopeId: string, legacyScopeIds: readonly string[] = []): PullRequestChatBindings {
        return this.load(scopeId, legacyScopeIds);
    }
}
