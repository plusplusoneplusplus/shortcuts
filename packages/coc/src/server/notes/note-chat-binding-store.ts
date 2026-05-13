/**
 * NoteChatBindingStore
 *
 * Per-workspace SQLite store mapping notePath → taskId for the per-note chat
 * feature in the Notes view. Uses the shared `processes.db` database
 * (same pattern as CommitChatBindingStore / SqliteQueuePersistence).
 *
 * Note paths are stored relative to the notes root, with forward-slash
 * separators (callers must normalize before invoking).
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

/** Map of notePath → NoteChatBinding. Keys are forward-slash-normalized relative paths. */
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
    private readonly stmtUnbindByTask: Database.Statement;
    private readonly stmtRenamePath: Database.Transaction<(workspaceId: string, oldPath: string, newPath: string) => number>;
    private readonly stmtRenamePrefix: Database.Transaction<(workspaceId: string, oldPrefix: string, newPrefix: string) => number>;
    private readonly stmtDeletePrefix: Database.Statement;

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
        this.stmtUnbindByTask = db.prepare(
            'DELETE FROM note_chat_bindings WHERE workspace_id = ? AND task_id = ?',
        );
        this.stmtDeletePrefix = db.prepare(
            'DELETE FROM note_chat_bindings WHERE workspace_id = ? AND note_path LIKE ? ESCAPE \'\\\'',
        );

        // Single-path rename. Delete any colliding destination row first so the
        // primary-key update doesn't fail.
        const deleteByPathStmt = db.prepare(
            'DELETE FROM note_chat_bindings WHERE workspace_id = ? AND note_path = ?',
        );
        const updatePathStmt = db.prepare(
            'UPDATE note_chat_bindings SET note_path = ? WHERE workspace_id = ? AND note_path = ?',
        );
        this.stmtRenamePath = db.transaction((workspaceId: string, oldPath: string, newPath: string) => {
            if (oldPath === newPath) return 0;
            deleteByPathStmt.run(workspaceId, newPath);
            const info = updatePathStmt.run(newPath, workspaceId, oldPath);
            return info.changes;
        });

        // Folder rename: rewrite every row whose note_path starts with
        // `oldFolder + '/'`. Uses substring slicing so deeper path components
        // are preserved verbatim (no blind REPLACE). Deletes colliding
        // destinations first. `LIKE` uses an explicit escape character so that
        // `_` and `%` in path segments are not misinterpreted as wildcards.
        const selectChildrenStmt = db.prepare(
            'SELECT note_path FROM note_chat_bindings WHERE workspace_id = ? AND note_path LIKE ? ESCAPE \'\\\'',
        );
        this.stmtRenamePrefix = db.transaction((workspaceId: string, oldFolder: string, newFolder: string) => {
            const oldF = trimTrailingSlash(oldFolder);
            const newF = trimTrailingSlash(newFolder);
            if (oldF === newF) return 0;
            const rows = selectChildrenStmt.all(
                workspaceId,
                escapeLikePattern(oldF + '/') + '%',
            ) as Array<{ note_path: string }>;
            let moved = 0;
            for (const { note_path } of rows) {
                const suffix = note_path.slice(oldF.length + 1);
                const dest = newF + '/' + suffix;
                if (dest === note_path) continue;
                deleteByPathStmt.run(workspaceId, dest);
                updatePathStmt.run(dest, workspaceId, note_path);
                moved++;
            }
            return moved;
        });
    }

    /** Load all bindings for a workspace. Returns {} when none exist. */
    list(workspaceId: string): NoteChatBindings {
        const rows = this.stmtList.all(workspaceId) as Array<{ note_path: string; task_id: string; created_at: string }>;
        const result: NoteChatBindings = {};
        for (const row of rows) {
            result[row.note_path] = { taskId: row.task_id, createdAt: row.created_at };
        }
        return result;
    }

    /** Get the binding for a single note path, or undefined. */
    get(workspaceId: string, notePath: string): NoteChatBinding | undefined {
        const row = this.stmtGet.get(workspaceId, notePath) as { task_id: string; created_at: string } | undefined;
        if (!row) return undefined;
        return { taskId: row.task_id, createdAt: row.created_at };
    }

    /** Create or overwrite the binding for a note path. */
    bind(workspaceId: string, notePath: string, taskId: string): void {
        this.stmtBind.run(workspaceId, notePath, taskId, new Date().toISOString());
    }

    /** Remove the binding for a note path. Returns true if a row was removed. */
    unbind(workspaceId: string, notePath: string): boolean {
        const info = this.stmtUnbind.run(workspaceId, notePath);
        return info.changes > 0;
    }

    /**
     * Remove every binding pointing at the given task. Used when a chat task
     * is deleted so stale rows don't accumulate.
     */
    unbindByTask(workspaceId: string, taskId: string): number {
        const info = this.stmtUnbindByTask.run(workspaceId, taskId);
        return info.changes;
    }

    /**
     * Move the binding row from oldPath to newPath. No-op when there is no
     * row at oldPath. Returns the number of rows updated (0 or 1).
     */
    renamePath(workspaceId: string, oldPath: string, newPath: string): number {
        return this.stmtRenamePath(workspaceId, oldPath, newPath);
    }

    /**
     * Move every binding row under a folder rename. Both arguments are folder
     * paths without trailing slashes (forward-slash separators). Rows where
     * `note_path` starts with `oldFolder + '/'` are rewritten so the prefix
     * becomes `newFolder + '/'`. Returns the number of rows updated.
     */
    renamePrefix(workspaceId: string, oldFolder: string, newFolder: string): number {
        return this.stmtRenamePrefix(workspaceId, oldFolder, newFolder);
    }

    /**
     * Delete every binding row whose `note_path` starts with `folder + '/'`.
     * Used for folder deletes (the folder itself never has a binding).
     * Returns the number of rows removed.
     */
    deletePrefix(workspaceId: string, folder: string): number {
        const trimmed = trimTrailingSlash(folder);
        const info = this.stmtDeletePrefix.run(
            workspaceId,
            escapeLikePattern(trimmed + '/') + '%',
        );
        return info.changes;
    }
}

// ============================================================================
// Helpers
// ============================================================================

function trimTrailingSlash(p: string): string {
    return p.endsWith('/') ? p.slice(0, -1) : p;
}

/**
 * Escape SQL LIKE wildcard characters using `\` as the escape character.
 * Keep in sync with the `ESCAPE '\\'` clauses in the prepared statements.
 */
function escapeLikePattern(input: string): string {
    return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
