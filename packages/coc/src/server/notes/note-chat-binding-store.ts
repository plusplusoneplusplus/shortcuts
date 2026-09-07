/**
 * Per-workspace SQLite store mapping notePath → taskId for the per-note chat
 * feature in the Notes view. Uses the shared `processes.db` database
 * (same pattern as CommitChatBindingStore / SqliteQueuePersistence).
 *
 * Note paths are stored relative to the notes root, with forward-slash
 * separators (callers must normalize before invoking).
 */

import type Database from 'better-sqlite3';
import { ChatBindingStore, type ChatBinding, type ChatBindings } from '../shared/chat-binding-store';

// ============================================================================
// Types
// ============================================================================

/** A single binding entry. taskId is the process/task ID of the chat conversation. */
export type NoteChatBinding = ChatBinding;

/** Map of notePath → NoteChatBinding. Keys are forward-slash-normalized relative paths. */
export type NoteChatBindings = ChatBindings;

// ============================================================================
// NoteChatBindingStore
// ============================================================================

export class NoteChatBindingStore extends ChatBindingStore {
    private readonly stmtUnbindByTask: Database.Statement;
    private readonly stmtRenamePath: Database.Transaction<(workspaceId: string, oldPath: string, newPath: string) => number>;
    private readonly stmtRenamePrefix: Database.Transaction<(workspaceId: string, oldPrefix: string, newPrefix: string) => number>;
    private readonly stmtDeletePrefix: Database.Statement;

    constructor(db: Database.Database) {
        super(db, 'note_chat_bindings', 'note_path');

        this.stmtUnbindByTask = db.prepare(
            'DELETE FROM note_chat_bindings WHERE workspace_id = ? AND task_id = ?',
        );
        this.stmtDeletePrefix = db.prepare(
            'DELETE FROM note_chat_bindings WHERE workspace_id = ? AND note_path LIKE ? ESCAPE \'\\\'',
        );

        // Single-path rename. Delete any colliding destination row first so the
        // primary-key update doesn't fail.
        const deleteByPath = (workspaceId: string, notePath: string) => { this.stmtUnbind.run(workspaceId, notePath); };
        const updatePathStmt = db.prepare(
            'UPDATE note_chat_bindings SET note_path = ? WHERE workspace_id = ? AND note_path = ?',
        );
        this.stmtRenamePath = db.transaction((workspaceId: string, oldPath: string, newPath: string) => {
            if (oldPath === newPath) return 0;
            deleteByPath(workspaceId, newPath);
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
                deleteByPath(workspaceId, dest);
                updatePathStmt.run(dest, workspaceId, note_path);
                moved++;
            }
            // A section-scoped chat is keyed on the folder path itself, which the
            // `oldFolder/%` sweep above cannot match. Move it too, or renaming the
            // folder would strand the section chat.
            deleteByPath(workspaceId, newF);
            moved += updatePathStmt.run(newF, workspaceId, oldF).changes;
            return moved;
        });
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
     * becomes `newFolder + '/'`, and the section row keyed on the folder itself
     * moves with them. Returns the number of rows updated.
     */
    renamePrefix(workspaceId: string, oldFolder: string, newFolder: string): number {
        return this.stmtRenamePrefix(workspaceId, oldFolder, newFolder);
    }

    /**
     * Delete every binding row whose `note_path` starts with `folder + '/'`,
     * plus the section row keyed on the folder itself. Used for folder deletes.
     * Returns the number of rows removed.
     */
    deletePrefix(workspaceId: string, folder: string): number {
        const trimmed = trimTrailingSlash(folder);
        const info = this.stmtDeletePrefix.run(
            workspaceId,
            escapeLikePattern(trimmed + '/') + '%',
        );
        // Section-scoped chats are keyed on the folder path itself, so the
        // `folder/%` sweep above never sees them.
        const sectionInfo = this.stmtUnbind.run(workspaceId, trimmed);
        return info.changes + sectionInfo.changes;
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
