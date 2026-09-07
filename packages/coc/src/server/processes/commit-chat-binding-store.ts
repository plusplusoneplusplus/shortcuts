/**
 * Per-workspace SQLite store mapping commitHash → taskId for the commit-chat feature.
 * Uses the shared `processes.db` database (same pattern as SqliteQueuePersistence).
 */

import type Database from 'better-sqlite3';
import { ChatBindingStore, type ChatBinding, type ChatBindings } from '../shared/chat-binding-store';

// ============================================================================
// Types
// ============================================================================

/** A single binding entry. taskId is the process/task ID of the chat conversation. */
export type CommitChatBinding = ChatBinding;

/** Map of commitHash → CommitChatBinding. Keys are full commit hashes (40-char hex). */
export type CommitChatBindings = ChatBindings;

// ============================================================================
// CommitChatBindingStore
// ============================================================================

export class CommitChatBindingStore extends ChatBindingStore {
    private readonly stmtRebind: Database.Transaction<(newHash: string, workspaceId: string, oldHash: string) => number>;

    constructor(db: Database.Database) {
        super(db, 'commit_chat_bindings', 'commit_hash');

        const updateStmt = db.prepare(
            'UPDATE commit_chat_bindings SET commit_hash = ? WHERE workspace_id = ? AND commit_hash = ?',
        );
        this.stmtRebind = db.transaction((newHash: string, workspaceId: string, oldHash: string) => {
            // Clear any colliding destination row so the primary-key update can't fail.
            this.stmtUnbind.run(workspaceId, newHash);
            const info = updateStmt.run(newHash, workspaceId, oldHash);
            return info.changes;
        });
    }

    /** Load all bindings for a workspace. Returns {} when none exist. */
    load(workspaceId: string): CommitChatBindings {
        return this.list(workspaceId);
    }

    /**
     * Atomically move a binding from oldHash to newHash.
     * Used after amend/rebase when the commit hash changes but the chat should follow.
     * No-op if oldHash has no binding. Returns true if the rebind occurred.
     */
    rebind(workspaceId: string, oldHash: string, newHash: string): boolean {
        return this.stmtRebind(newHash, workspaceId, oldHash) > 0;
    }
}
