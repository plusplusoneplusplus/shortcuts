/**
 * PullRequestChatBindingStore
 *
 * Per-workspace SQLite store mapping prId → taskId for the PR-chat feature.
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
    private readonly stmtGet: Database.Statement;
    private readonly stmtBind: Database.Statement;
    private readonly stmtUnbind: Database.Statement;

    constructor(db: Database.Database) {
        this.db = db;
        this.stmtList = db.prepare(
            'SELECT pr_id, task_id, created_at FROM pull_request_chat_bindings WHERE workspace_id = ?',
        );
        this.stmtGet = db.prepare(
            'SELECT task_id, created_at FROM pull_request_chat_bindings WHERE workspace_id = ? AND pr_id = ?',
        );
        this.stmtBind = db.prepare(
            'INSERT OR REPLACE INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at) VALUES (?, ?, ?, ?)',
        );
        this.stmtUnbind = db.prepare(
            'DELETE FROM pull_request_chat_bindings WHERE workspace_id = ? AND pr_id = ?',
        );
    }

    /** Load all bindings for a workspace. Returns {} when none exist. */
    load(workspaceId: string): PullRequestChatBindings {
        const rows = this.stmtList.all(workspaceId) as Array<{ pr_id: string; task_id: string; created_at: string }>;
        const result: PullRequestChatBindings = {};
        for (const row of rows) {
            result[row.pr_id] = { taskId: row.task_id, createdAt: row.created_at };
        }
        return result;
    }

    /** Get the binding for a single PR, or undefined. */
    get(workspaceId: string, prId: string): PullRequestChatBinding | undefined {
        const row = this.stmtGet.get(workspaceId, prId) as { task_id: string; created_at: string } | undefined;
        if (!row) return undefined;
        return { taskId: row.task_id, createdAt: row.created_at };
    }

    /** Create or overwrite the binding for a PR. */
    bind(workspaceId: string, prId: string, taskId: string): void {
        this.stmtBind.run(workspaceId, prId, taskId, new Date().toISOString());
    }

    /** Remove the binding for a PR. No-op if not present. Returns true if a binding was removed. */
    unbind(workspaceId: string, prId: string): boolean {
        const info = this.stmtUnbind.run(workspaceId, prId);
        return info.changes > 0;
    }

    /** Return all bindings for a workspace (convenience alias for load). */
    list(workspaceId: string): PullRequestChatBindings {
        return this.load(workspaceId);
    }
}
