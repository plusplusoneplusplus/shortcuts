/**
 * Origin-scoped SQLite store mapping workItemId -> taskId for the Work Item
 * chat feature. Uses the shared `processes.db` database.
 */

import type Database from 'better-sqlite3';
import { ChatBindingStore, type ChatBinding, type ChatBindings } from '../shared/chat-binding-store';

export type WorkItemChatBinding = ChatBinding;
export type WorkItemChatBindings = ChatBindings;

export class WorkItemChatBindingStore extends ChatBindingStore {
    constructor(db: Database.Database) {
        super(db, 'work_item_chat_bindings', 'work_item_id');
    }

    /** Load all bindings for an origin scope. Returns {} when none exist. */
    override list(scopeId: string, legacyScopeIds: readonly string[] = []): WorkItemChatBindings {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        return super.list(scopeId);
    }

    /** Get the binding for a single work item, or undefined. */
    override get(scopeId: string, workItemId: string, legacyScopeIds: readonly string[] = []): WorkItemChatBinding | undefined {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        return super.get(scopeId, workItemId);
    }

    /** Create or overwrite the binding for a work item. */
    override bind(scopeId: string, workItemId: string, taskId: string, legacyScopeIds: readonly string[] = []): void {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        super.bind(scopeId, workItemId, taskId);
    }

    /** Remove the binding for a work item. Returns true if a binding was removed. */
    override unbind(scopeId: string, workItemId: string, legacyScopeIds: readonly string[] = []): boolean {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        return super.unbind(scopeId, workItemId);
    }
}
