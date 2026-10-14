import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';

/** Server-owned preferences, deliberately outside generic item authoring. */
export class SentinelPrOutcomeControls {
    constructor(private readonly db: NativeDatabase) {
        db.exec(`CREATE TABLE IF NOT EXISTS sentinel_pr_outcome_controls (
            workspace_id TEXT NOT NULL, process_id TEXT NOT NULL, item_id TEXT NOT NULL,
            paused INTEGER NOT NULL, revision INTEGER NOT NULL,
            PRIMARY KEY (workspace_id, process_id, item_id)
        )`);
    }

    get(owner: SentinelTodoOwner, itemId: string): { paused: boolean; revision: number } {
        const row = this.db.prepare(`SELECT paused, revision FROM sentinel_pr_outcome_controls
            WHERE workspace_id = ? AND process_id = ? AND item_id = ?`)
            .get(owner.workspaceId, owner.processId, itemId) as { paused: number; revision: number } | undefined;
        return row ? { paused: !!row.paused, revision: row.revision } : { paused: false, revision: 0 };
    }

    set(owner: SentinelTodoOwner, itemId: string, paused: boolean): void {
        this.db.prepare(`INSERT INTO sentinel_pr_outcome_controls VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(workspace_id, process_id, item_id)
            DO UPDATE SET paused = excluded.paused, revision = revision + 1`)
            .run(owner.workspaceId, owner.processId, itemId, paused ? 1 : 0);
    }
}
