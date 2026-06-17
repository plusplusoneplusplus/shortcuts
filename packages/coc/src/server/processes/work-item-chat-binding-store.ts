/**
 * WorkItemChatBindingStore
 *
 * Origin-scoped SQLite store mapping workItemId -> taskId for the Work Item
 * chat feature. Uses the shared `processes.db` database.
 */

import type Database from 'better-sqlite3';

export interface WorkItemChatBinding {
    taskId: string;
    createdAt: string;
}

export interface WorkItemChatBindings {
    [workItemId: string]: WorkItemChatBinding;
}

export class WorkItemChatBindingStore {
    private readonly db: Database.Database;
    private readonly stmtList: Database.Statement;
    private readonly stmtGet: Database.Statement;
    private readonly stmtBind: Database.Statement;
    private readonly stmtBindWithCreatedAt: Database.Statement;
    private readonly stmtUnbind: Database.Statement;
    private readonly stmtDeleteScope: Database.Statement;

    constructor(db: Database.Database) {
        this.db = db;
        this.stmtList = db.prepare(
            'SELECT work_item_id, task_id, created_at FROM work_item_chat_bindings WHERE workspace_id = ?',
        );
        this.stmtGet = db.prepare(
            'SELECT task_id, created_at FROM work_item_chat_bindings WHERE workspace_id = ? AND work_item_id = ?',
        );
        this.stmtBind = db.prepare(
            'INSERT OR REPLACE INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at) VALUES (?, ?, ?, ?)',
        );
        this.stmtBindWithCreatedAt = db.prepare(
            'INSERT INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at) VALUES (?, ?, ?, ?)',
        );
        this.stmtUnbind = db.prepare(
            'DELETE FROM work_item_chat_bindings WHERE workspace_id = ? AND work_item_id = ?',
        );
        this.stmtDeleteScope = db.prepare(
            'DELETE FROM work_item_chat_bindings WHERE workspace_id = ?',
        );
    }

    migrateLegacyScopes(scopeId: string, legacyScopeIds: readonly string[] = []): void {
        const legacyScopes = Array.from(new Set(legacyScopeIds.map(id => id.trim()).filter(id => id && id !== scopeId)));
        if (legacyScopes.length === 0) return;

        const migrate = this.db.transaction(() => {
            const selected = new Map<string, WorkItemChatBinding>();
            for (const legacyScope of legacyScopes) {
                const rows = this.stmtList.all(legacyScope) as Array<{ work_item_id: string; task_id: string; created_at: string }>;
                for (const row of rows) {
                    const current = selected.get(row.work_item_id);
                    if (!current || row.created_at > current.createdAt) {
                        selected.set(row.work_item_id, { taskId: row.task_id, createdAt: row.created_at });
                    }
                }
            }

            for (const [workItemId, binding] of selected) {
                if (!this.stmtGet.get(scopeId, workItemId)) {
                    this.stmtBindWithCreatedAt.run(scopeId, workItemId, binding.taskId, binding.createdAt);
                }
            }

            for (const legacyScope of legacyScopes) {
                this.stmtDeleteScope.run(legacyScope);
            }
        });
        migrate();
    }

    list(scopeId: string, legacyScopeIds: readonly string[] = []): WorkItemChatBindings {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        const rows = this.stmtList.all(scopeId) as Array<{ work_item_id: string; task_id: string; created_at: string }>;
        const result: WorkItemChatBindings = {};
        for (const row of rows) {
            result[row.work_item_id] = { taskId: row.task_id, createdAt: row.created_at };
        }
        return result;
    }

    get(scopeId: string, workItemId: string, legacyScopeIds: readonly string[] = []): WorkItemChatBinding | undefined {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        const row = this.stmtGet.get(scopeId, workItemId) as { task_id: string; created_at: string } | undefined;
        if (!row) return undefined;
        return { taskId: row.task_id, createdAt: row.created_at };
    }

    bind(scopeId: string, workItemId: string, taskId: string, legacyScopeIds: readonly string[] = []): void {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        this.stmtBind.run(scopeId, workItemId, taskId, new Date().toISOString());
    }

    unbind(scopeId: string, workItemId: string, legacyScopeIds: readonly string[] = []): boolean {
        this.migrateLegacyScopes(scopeId, legacyScopeIds);
        const info = this.stmtUnbind.run(scopeId, workItemId);
        return info.changes > 0;
    }
}
