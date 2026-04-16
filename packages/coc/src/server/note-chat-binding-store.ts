/**
 * NoteChatBindingStore
 *
 * Per-workspace SQLite store mapping notePath → taskId for the note-chat feature.
 * Uses the shared `processes.db` database (same pattern as CommitChatBindingStore).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

/** A single binding entry. taskId is the process/task ID of the chat conversation. */
export interface NoteChatBinding {
    taskId: string;
    /** ISO-8601 timestamp of when the binding was created. */
    createdAt: string;
}

/**
 * Map of notePath → NoteChatBinding.
 * Keys are relative note paths (e.g. "folder/my-note.md").
 */
export interface NoteChatBindings {
    [notePath: string]: NoteChatBinding;
}

// ============================================================================
// NoteChatBindingStore
// ============================================================================

export class NoteChatBindingStore {
    private readonly db: Database.Database;
    private readonly stmtList: Database.Statement;
    private readonly stmtGet: Database.Statement;
    private readonly stmtBind: Database.Statement;
    private readonly stmtUnbind: Database.Statement;
    private readonly stmtRebind: Database.Transaction<(newPath: string, workspaceId: string, oldPath: string) => number>;

    constructor(db: Database.Database) {
        this.db = db;
        this.stmtList = db.prepare(
            'SELECT note_path, task_id, created_at FROM note_chat_bindings WHERE workspace_id = ?',
        );
        this.stmtGet = db.prepare(
            'SELECT task_id, created_at FROM note_chat_bindings WHERE workspace_id = ? AND note_path = ?',
        );
        this.stmtBind = db.prepare(
            'INSERT OR REPLACE INTO note_chat_bindings (workspace_id, note_path, task_id, created_at) VALUES (?, ?, ?, ?)',
        );
        this.stmtUnbind = db.prepare(
            'DELETE FROM note_chat_bindings WHERE workspace_id = ? AND note_path = ?',
        );

        const deleteStmt = db.prepare(
            'DELETE FROM note_chat_bindings WHERE workspace_id = ? AND note_path = ?',
        );
        const updateStmt = db.prepare(
            'UPDATE note_chat_bindings SET note_path = ? WHERE workspace_id = ? AND note_path = ?',
        );
        this.stmtRebind = db.transaction((newPath: string, workspaceId: string, oldPath: string) => {
            deleteStmt.run(workspaceId, newPath);
            const info = updateStmt.run(newPath, workspaceId, oldPath);
            return info.changes;
        });
    }

    /** Load all bindings for a workspace. Returns {} when none exist. */
    load(workspaceId: string): NoteChatBindings {
        const rows = this.stmtList.all(workspaceId) as Array<{ note_path: string; task_id: string; created_at: string }>;
        const result: NoteChatBindings = {};
        for (const row of rows) {
            result[row.note_path] = { taskId: row.task_id, createdAt: row.created_at };
        }
        return result;
    }

    /** Get the binding for a single note, or undefined. */
    get(workspaceId: string, notePath: string): NoteChatBinding | undefined {
        const row = this.stmtGet.get(workspaceId, notePath) as { task_id: string; created_at: string } | undefined;
        if (!row) return undefined;
        return { taskId: row.task_id, createdAt: row.created_at };
    }

    /** Create or overwrite the binding for a note. */
    bind(workspaceId: string, notePath: string, taskId: string): void {
        this.stmtBind.run(workspaceId, notePath, taskId, new Date().toISOString());
    }

    /** Remove the binding for a note. No-op if not present. Returns true if a binding was removed. */
    unbind(workspaceId: string, notePath: string): boolean {
        const info = this.stmtUnbind.run(workspaceId, notePath);
        return info.changes > 0;
    }

    /**
     * Atomically move a binding from oldPath to newPath.
     * Used after note rename to keep chat bound.
     * No-op if oldPath has no binding. Returns true if the rebind occurred.
     */
    rebind(workspaceId: string, oldPath: string, newPath: string): boolean {
        const changes = this.stmtRebind(newPath, workspaceId, oldPath);
        return changes > 0;
    }

    /** Return all bindings for a workspace (convenience alias for load). */
    list(workspaceId: string): NoteChatBindings {
        return this.load(workspaceId);
    }
}
