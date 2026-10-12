import { randomUUID } from 'node:crypto';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { SentinelTodoDependencyAction, SentinelTodoDependencyEvaluation, SentinelTodoTrackedAdmission } from '@plusplusoneplusplus/coc-client';
import { SentinelTodoError, type SentinelTodoOwner, type SentinelTodoStore } from './sentinel-todo-store';

export interface DependencyActionRecord {
    action: SentinelTodoDependencyAction;
    itemRevision: number;
    /** Authorization pins the graph independently of later bookkeeping revisions. */
    dependencies: string;
    evidence?: string;
    started?: boolean;
    generationRevision?: number;
    targetVersion?: string;
}

export interface DependencyWake {
    id: string;
    itemId: string;
    generation: string;
    evidence: SentinelTodoDependencyEvaluation;
    prompt: string;
    delivery: 'pending' | 'delivered';
    error?: string;
    /** Existing owner-bound merge rule transports this activation; never mutate that rule. */
    transportTriggerId?: string;
}

/** Shared native writer; all operational receipts are machine-local and immutable in identity. */
export class SentinelDependencyStore {
    /** Resume/new-loop routes cannot escape tracking by omitting the launch context. */
    static ralphTracking(db: NativeDatabase, sessionId: unknown): SentinelTodoTrackedAdmission | undefined {
        if (typeof sessionId !== 'string' || !sessionId.startsWith('ralph-approved-')) return;
        return SentinelDependencyStore.jobTracking(db, sessionId.slice('ralph-approved-'.length), true);
    }

    static jobTracking(db: NativeDatabase, processId: string, ralphOnly = false): SentinelTodoTrackedAdmission | undefined {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sentinel_dependency_admissions'").get()) return;
        const row = db.prepare(`SELECT workspace_id, parent_process_id, item_id, record
            FROM sentinel_dependency_admissions WHERE task_id = ?`)
            .get<{ workspace_id: string; parent_process_id: string; item_id: string; record: string }>(
                processId.replace(/^queue_/, ''));
        if (!row) return;
        const record: DependencyActionRecord = JSON.parse(row.record);
        if (ralphOnly && record.action.mode !== 'ralph') return;
        return { owner: { workspaceId: row.workspace_id, processId: row.parent_process_id },
            itemId: row.item_id, actionRevision: record.action.revision };
    }

    tracksJob(processId: string, sessionId?: string): boolean {
        return !!(SentinelDependencyStore.jobTracking(this.db, processId) || SentinelDependencyStore.ralphTracking(this.db, sessionId));
    }

    constructor(private readonly db: NativeDatabase, readonly todos: SentinelTodoStore) {
        db.transaction(() => db.exec(`
            CREATE TABLE IF NOT EXISTS sentinel_dependency_actions (
                workspace_id TEXT NOT NULL, parent_process_id TEXT NOT NULL, item_id TEXT NOT NULL,
                record TEXT NOT NULL, PRIMARY KEY (workspace_id, parent_process_id, item_id)
            );
            CREATE TABLE IF NOT EXISTS sentinel_dependency_wakes (
                workspace_id TEXT NOT NULL, parent_process_id TEXT NOT NULL, item_id TEXT NOT NULL,
                generation TEXT NOT NULL, id TEXT NOT NULL UNIQUE, receipt TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, item_id, generation)
            );
            CREATE TABLE IF NOT EXISTS sentinel_dependency_polls (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_process_id TEXT NOT NULL,
                next_tick_at TEXT
            );
            CREATE TABLE IF NOT EXISTS sentinel_dependency_admissions (
                task_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_process_id TEXT NOT NULL,
                item_id TEXT NOT NULL, record TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sentinel_dependency_ralph_starts (
                admission_task_id TEXT NOT NULL, step TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE,
                PRIMARY KEY (admission_task_id, step)
            );
        `))();
    }

    transaction<T>(owner: SentinelTodoOwner, operation: () => T): T {
        return this.todos.withCurrentEvidence(owner, this.todos.get(owner), operation);
    }

    action(owner: SentinelTodoOwner, itemId: string): DependencyActionRecord | undefined {
        const row = this.db.prepare(`SELECT record FROM sentinel_dependency_actions
            WHERE workspace_id = ? AND parent_process_id = ? AND item_id = ?`)
            .get<{ record: string }>(owner.workspaceId, owner.processId, itemId);
        return row ? JSON.parse(row.record) : undefined;
    }

    saveAction(owner: SentinelTodoOwner, itemId: string, record: DependencyActionRecord): void {
        this.db.prepare(`INSERT INTO sentinel_dependency_actions VALUES (?, ?, ?, ?)
            ON CONFLICT (workspace_id, parent_process_id, item_id) DO UPDATE SET record = excluded.record`)
            .run(owner.workspaceId, owner.processId, itemId, JSON.stringify(record));
    }

    admission(owner: SentinelTodoOwner, itemId: string, taskId: string): DependencyActionRecord | undefined {
        const row = this.db.prepare(`SELECT record FROM sentinel_dependency_admissions
            WHERE task_id = ? AND workspace_id = ? AND parent_process_id = ? AND item_id = ?`)
            .get<{ record: string }>(taskId, owner.workspaceId, owner.processId, itemId);
        return row ? JSON.parse(row.record) : undefined;
    }

    saveAdmission(owner: SentinelTodoOwner, itemId: string, record: DependencyActionRecord): void {
        this.db.prepare(`INSERT INTO sentinel_dependency_admissions VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(task_id) DO UPDATE SET record = excluded.record`)
            .run(record.action.taskId, owner.workspaceId, owner.processId, itemId, JSON.stringify(record));
    }

    startRalphStep(admissionTaskId: string, step: string, taskId: string): void {
        if (this.db.prepare('SELECT 1 FROM sentinel_dependency_ralph_starts WHERE admission_task_id = ? AND step = ?')
            .get(admissionTaskId, step)) {
            throw new SentinelTodoError('invalid', 'Saved Ralph step already started; execution replay requires fresh explicit authority');
        }
        this.db.prepare('INSERT INTO sentinel_dependency_ralph_starts VALUES (?, ?, ?)').run(admissionTaskId, step, taskId);
    }

    wakes(owner: SentinelTodoOwner, itemId?: string): DependencyWake[] {
        return this.db.prepare(`SELECT receipt FROM sentinel_dependency_wakes
            WHERE workspace_id = ? AND parent_process_id = ? ${itemId ? 'AND item_id = ?' : ''}`)
            .all<{ receipt: string }>(...[owner.workspaceId, owner.processId, ...(itemId ? [itemId] : [])])
            .map(row => JSON.parse(row.receipt));
    }

    reserveWake(owner: SentinelTodoOwner, evidence: SentinelTodoDependencyEvaluation,
        generation: string, prompt: (id: string) => string, transportTriggerId?: string): DependencyWake {
        const prior = this.wakes(owner, evidence.itemId).find(wake => wake.generation === generation);
        if (prior) return prior;
        const id = randomUUID();
        const wake: DependencyWake = { id, itemId: evidence.itemId, generation, evidence, prompt: prompt(id), delivery: 'pending',
            ...(transportTriggerId ? { transportTriggerId } : {}) };
        this.db.prepare('INSERT INTO sentinel_dependency_wakes VALUES (?, ?, ?, ?, ?, ?)')
            .run(owner.workspaceId, owner.processId, evidence.itemId, generation, id, JSON.stringify(wake));
        return wake;
    }

    delivery(owner: SentinelTodoOwner, wake: DependencyWake, error?: string): void {
        this.transaction(owner, () => {
            const current = this.wakes(owner, wake.itemId).find(receipt => receipt.id === wake.id);
            if (!current || current.delivery === 'delivered') return;
            this.db.prepare(`UPDATE sentinel_dependency_wakes SET receipt = ? WHERE id = ?`)
                .run(JSON.stringify({ ...current, delivery: error ? 'pending' : 'delivered', error }), wake.id);
        });
    }

    evaluation(owner: SentinelTodoOwner, itemId: string): SentinelTodoDependencyEvaluation | undefined {
        const row = this.db.prepare(`SELECT evaluation FROM sentinel_todo_evaluations
            WHERE workspace_id = ? AND parent_process_id = ? AND item_id = ?`)
            .get<{ evaluation: string }>(owner.workspaceId, owner.processId, itemId);
        return row ? JSON.parse(row.evaluation) : undefined;
    }

    polls() {
        const owners = this.db.prepare(`SELECT DISTINCT workspace_id, parent_process_id FROM sentinel_todo_dependencies
            UNION SELECT workspace_id, parent_process_id FROM sentinel_dependency_wakes WHERE json_extract(receipt, '$.delivery') = 'pending'`)
            .all<{ workspace_id: string; parent_process_id: string }>();
        return owners.map(row => {
            const id = `sentinel-dependency:${JSON.stringify([row.workspace_id, row.parent_process_id])}`;
            const poll = this.db.prepare('SELECT next_tick_at FROM sentinel_dependency_polls WHERE id = ?')
                .get<{ next_tick_at: string | null }>(id);
            return { id, status: 'active', nextTickAt: poll?.next_tick_at ?? null,
                dependencyPoll: true as const, owner: { workspaceId: row.workspace_id, processId: row.parent_process_id } };
        });
    }

    persistPoll(entry: { id: string; nextTickAt: string | null; owner: SentinelTodoOwner }): void {
        this.transaction(entry.owner, () => {
            this.db.prepare(`INSERT INTO sentinel_dependency_polls VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET next_tick_at = excluded.next_tick_at`)
                .run(entry.id, entry.owner.workspaceId, entry.owner.processId, entry.nextTickAt);
        });
    }

    requireAction(owner: SentinelTodoOwner, itemId: string): DependencyActionRecord {
        const record = this.action(owner, itemId);
        if (!record) throw new SentinelTodoError('invalid', 'Needs approval: no explicitly authorized dependency action');
        return record;
    }
}
