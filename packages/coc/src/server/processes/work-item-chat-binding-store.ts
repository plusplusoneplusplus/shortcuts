/**
 * WorkItemChatBindingStore
 *
 * Per-workspace SQLite store mapping workItemId -> taskId for the Work Item
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
    private readonly stmtList: Database.Statement;
    private readonly stmtGet: Database.Statement;
    private readonly stmtBind: Database.Statement;
    private readonly stmtUnbind: Database.Statement;

    constructor(db: Database.Database) {
        this.stmtList = db.prepare(
            'SELECT work_item_id, task_id, created_at FROM work_item_chat_bindings WHERE workspace_id = ?',
        );
        this.stmtGet = db.prepare(
            'SELECT task_id, created_at FROM work_item_chat_bindings WHERE workspace_id = ? AND work_item_id = ?',
        );
        this.stmtBind = db.prepare(
            'INSERT OR REPLACE INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at) VALUES (?, ?, ?, ?)',
        );
        this.stmtUnbind = db.prepare(
            'DELETE FROM work_item_chat_bindings WHERE workspace_id = ? AND work_item_id = ?',
        );
    }

    list(workspaceId: string): WorkItemChatBindings {
        const rows = this.stmtList.all(workspaceId) as Array<{ work_item_id: string; task_id: string; created_at: string }>;
        const result: WorkItemChatBindings = {};
        for (const row of rows) {
            result[row.work_item_id] = { taskId: row.task_id, createdAt: row.created_at };
        }
        return result;
    }

    get(workspaceId: string, workItemId: string): WorkItemChatBinding | undefined {
        const row = this.stmtGet.get(workspaceId, workItemId) as { task_id: string; created_at: string } | undefined;
        if (!row) return undefined;
        return { taskId: row.task_id, createdAt: row.created_at };
    }

    bind(workspaceId: string, workItemId: string, taskId: string): void {
        this.stmtBind.run(workspaceId, workItemId, taskId, new Date().toISOString());
    }

    unbind(workspaceId: string, workItemId: string): boolean {
        const info = this.stmtUnbind.run(workspaceId, workItemId);
        return info.changes > 0;
    }
}
