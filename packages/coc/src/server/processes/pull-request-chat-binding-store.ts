/**
 * Origin-scoped SQLite store mapping prId -> taskId for the PR-chat feature.
 * Uses the shared `processes.db` database (same pattern as CommitChatBindingStore).
 */

import type Database from 'better-sqlite3';
import { ChatBindingStore, toBindings, type BindingRow, type ChatBinding, type ChatBindings } from '../shared/chat-binding-store';

// ============================================================================
// Types
// ============================================================================

/** A single binding entry. taskId is the process/task ID of the chat conversation. */
export type PullRequestChatBinding = ChatBinding;

/**
 * Map of prId → PullRequestChatBinding.
 * Keys are stringified PR IDs (numeric for GitHub/ADO, opaque for any future provider).
 */
export type PullRequestChatBindings = ChatBindings;

// ============================================================================
// PullRequestChatBindingStore
// ============================================================================

export class PullRequestChatBindingStore extends ChatBindingStore {
    private readonly stmtListByTask: Database.Statement;

    constructor(db: Database.Database) {
        super(db, 'pull_request_chat_bindings', 'pr_id');
        this.stmtListByTask = db.prepare(
            'SELECT pr_id AS key, task_id, created_at FROM pull_request_chat_bindings WHERE workspace_id = ? AND task_id = ?',
        );
    }

    /** Load all bindings for an origin scope. Returns {} when none exist. */
    load(scopeId: string, legacyScopeIds: readonly string[] = []): PullRequestChatBindings {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        return super.list(scopeId);
    }

    /** Return all bindings for an origin scope (convenience alias for load). */
    override list(scopeId: string, legacyScopeIds: readonly string[] = []): PullRequestChatBindings {
        return this.load(scopeId, legacyScopeIds);
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
        return toBindings(this.stmtListByTask.all(scopeId, taskId) as BindingRow[]);
    }

    /** Get the binding for a single PR, or undefined. */
    override get(scopeId: string, prId: string, legacyScopeIds: readonly string[] = []): PullRequestChatBinding | undefined {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        return super.get(scopeId, prId);
    }

    /** Create or overwrite the binding for a PR. */
    override bind(scopeId: string, prId: string, taskId: string, legacyScopeIds: readonly string[] = []): void {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        super.bind(scopeId, prId, taskId);
    }

    /** Remove the binding for a PR. No-op if not present. Returns true if a binding was removed. */
    override unbind(scopeId: string, prId: string, legacyScopeIds: readonly string[] = []): boolean {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        return super.unbind(scopeId, prId);
    }
}
