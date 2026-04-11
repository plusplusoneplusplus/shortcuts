/**
 * CommitChatBindingStore
 *
 * Per-workspace SQLite store mapping commitHash → taskId for the commit-chat feature.
 * Uses the shared `processes.db` database (same pattern as SqliteQueuePersistence).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

/** A single binding entry. taskId is the process/task ID of the chat conversation. */
export interface CommitChatBinding {
    taskId: string;
    /** ISO-8601 timestamp of when the binding was created. */
    createdAt: string;
}

/**
 * Map of commitHash → CommitChatBinding.
 * Keys are full commit hashes (40-char hex).
 */
export interface CommitChatBindings {
    [commitHash: string]: CommitChatBinding;
}

// ============================================================================
// CommitChatBindingStore
// ============================================================================

export class CommitChatBindingStore {
    private readonly db: Database.Database;
    private readonly stmtList: Database.Statement;
    private readonly stmtGet: Database.Statement;
    private readonly stmtBind: Database.Statement;
    private readonly stmtUnbind: Database.Statement;
    private readonly stmtRebind: Database.Transaction<(newHash: string, workspaceId: string, oldHash: string) => number>;

    constructor(db: Database.Database) {
        this.db = db;
        this.stmtList = db.prepare(
            'SELECT commit_hash, task_id, created_at FROM commit_chat_bindings WHERE workspace_id = ?',
        );
        this.stmtGet = db.prepare(
            'SELECT task_id, created_at FROM commit_chat_bindings WHERE workspace_id = ? AND commit_hash = ?',
        );
        this.stmtBind = db.prepare(
            'INSERT OR REPLACE INTO commit_chat_bindings (workspace_id, commit_hash, task_id, created_at) VALUES (?, ?, ?, ?)',
        );
        this.stmtUnbind = db.prepare(
            'DELETE FROM commit_chat_bindings WHERE workspace_id = ? AND commit_hash = ?',
        );

        const deleteStmt = db.prepare(
            'DELETE FROM commit_chat_bindings WHERE workspace_id = ? AND commit_hash = ?',
        );
        const updateStmt = db.prepare(
            'UPDATE commit_chat_bindings SET commit_hash = ? WHERE workspace_id = ? AND commit_hash = ?',
        );
        this.stmtRebind = db.transaction((newHash: string, workspaceId: string, oldHash: string) => {
            deleteStmt.run(workspaceId, newHash);
            const info = updateStmt.run(newHash, workspaceId, oldHash);
            return info.changes;
        });
    }

    /** Load all bindings for a workspace. Returns {} when none exist. */
    load(workspaceId: string): CommitChatBindings {
        const rows = this.stmtList.all(workspaceId) as Array<{ commit_hash: string; task_id: string; created_at: string }>;
        const result: CommitChatBindings = {};
        for (const row of rows) {
            result[row.commit_hash] = { taskId: row.task_id, createdAt: row.created_at };
        }
        return result;
    }

    /** Get the binding for a single commit, or undefined. */
    get(workspaceId: string, commitHash: string): CommitChatBinding | undefined {
        const row = this.stmtGet.get(workspaceId, commitHash) as { task_id: string; created_at: string } | undefined;
        if (!row) return undefined;
        return { taskId: row.task_id, createdAt: row.created_at };
    }

    /** Create or overwrite the binding for a commit. */
    bind(workspaceId: string, commitHash: string, taskId: string): void {
        this.stmtBind.run(workspaceId, commitHash, taskId, new Date().toISOString());
    }

    /** Remove the binding for a commit. No-op if not present. Returns true if a binding was removed. */
    unbind(workspaceId: string, commitHash: string): boolean {
        const info = this.stmtUnbind.run(workspaceId, commitHash);
        return info.changes > 0;
    }

    /**
     * Atomically move a binding from oldHash to newHash.
     * Used after amend/rebase when the commit hash changes but the chat should follow.
     * No-op if oldHash has no binding. Returns true if the rebind occurred.
     */
    rebind(workspaceId: string, oldHash: string, newHash: string): boolean {
        const changes = this.stmtRebind(newHash, workspaceId, oldHash);
        return changes > 0;
    }

    /** Return all bindings for a workspace (convenience alias for load). */
    list(workspaceId: string): CommitChatBindings {
        return this.load(workspaceId);
    }
}
