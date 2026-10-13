import { randomUUID } from 'node:crypto';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { SentinelTodoDependency, SentinelTodoDependencyEvaluation, SentinelTodoTrackedAdmission } from '@plusplusoneplusplus/coc-client';
import { SentinelTodoError, type SentinelTodoOwner, type SentinelTodoStore } from './sentinel-todo-store';

/** Execution receipt, created at admission rather than by a separate approval command. */
export interface DependencyAdmissionRecord {
    taskId: string;
    workspaceId: string;
    sessionId?: string;
    mode: string;
    itemRevision: number;
    dependencies: string;
    evidence?: string;
    started?: boolean;
    error?: string;
    requiresReview?: boolean;
    graphRevision?: number;
    lineage?: { itemId: string; revision?: number; evidence?: string }[];
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
    graphRevision?: number;
    invalidatedAt?: string;
    invalidatedReason?: string;
    lineage?: DependencyAdmissionRecord['lineage'];
}

export function dependencyWakePrompt(id: string, itemId: string): string {
    return [
        'Native Sentinel dependencies are satisfied. This receipt grants no execution authority.',
        'Read the current item and dependency evidence before deciding.',
        'Delegate only work authorized by the user under the Sentinel instructions. Readiness never means automatically executing every item.',
        'Respect later cancellations and do not retry started, blocked or uncertain work.',
        'Use send_to_conversation with todoItemId. Fulfillment remains unchanged.',
        `Receipt: ${id}; item: ${itemId}.`,
    ].join('\n');
}

/** Shared native writer; all operational receipts are machine-local and immutable in identity. */
export class SentinelDependencyStore {
    /** Resume/new-loop routes cannot escape tracking by omitting the launch context. */
    static ralphTracking(db: NativeDatabase, sessionId: unknown): SentinelTodoTrackedAdmission | undefined {
        if (typeof sessionId !== 'string') return;
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sentinel_dependency_admissions'").get()) return;
        const row = db.prepare("SELECT task_id FROM sentinel_dependency_admissions WHERE json_extract(record, '$.sessionId') = ?")
            .get<{ task_id: string }>(sessionId);
        return row ? SentinelDependencyStore.jobTracking(db, row.task_id, true) : undefined;
    }

    static jobTracking(db: NativeDatabase, processId: string, ralphOnly = false): SentinelTodoTrackedAdmission | undefined {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sentinel_dependency_admissions'").get()) return;
        const row = db.prepare(`SELECT workspace_id, parent_process_id, item_id, record
            FROM sentinel_dependency_admissions WHERE task_id = ?`)
            .get<{ workspace_id: string; parent_process_id: string; item_id: string; record: string }>(
                processId.replace(/^queue_/, ''));
        if (!row) return;
        const record: DependencyAdmissionRecord = JSON.parse(row.record);
        if (ralphOnly && record.mode !== 'ralph') return;
        return { owner: { workspaceId: row.workspace_id, processId: row.parent_process_id },
            itemId: row.item_id };
    }

    constructor(private readonly db: NativeDatabase, readonly todos: SentinelTodoStore) {
        db.transaction(() => db.exec(`
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
        // Preserve admitted jobs and their replay guards while discarding approval-only settings.
        db.transaction(() => {
            for (const row of db.prepare('SELECT task_id, record FROM sentinel_dependency_admissions').all<{ task_id: string; record: string }>()) {
                const prior = JSON.parse(row.record);
                if (!prior.action) continue;
                const record: DependencyAdmissionRecord = {
                    taskId: row.task_id, workspaceId: prior.action.targetWorkspaceId, mode: prior.action.mode,
                    ...(prior.action.mode === 'ralph' ? { sessionId: `ralph-approved-${row.task_id}` } : {}),
                    itemRevision: prior.itemRevision, dependencies: prior.dependencies,
                    evidence: prior.evidence, started: prior.started, graphRevision: prior.graphRevision,
                    lineage: prior.lineage, requiresReview: prior.action.requiresReview,
                    error: prior.action.error ?? (prior.action.state === 'blocked' ? 'Previous admission was blocked' : undefined),
                };
                db.prepare('UPDATE sentinel_dependency_admissions SET record = ? WHERE task_id = ?').run(JSON.stringify(record), row.task_id);
            }
            // Reconcile pending transport guidance without changing receipt identities/evidence.
            for (const row of db.prepare('SELECT id, receipt FROM sentinel_dependency_wakes').all<{ id: string; receipt: string }>()) {
                const wake: DependencyWake = JSON.parse(row.receipt);
                const prompt = dependencyWakePrompt(wake.id, wake.itemId);
                if (wake.prompt !== prompt) db.prepare('UPDATE sentinel_dependency_wakes SET receipt = ? WHERE id = ?')
                    .run(JSON.stringify({ ...wake, prompt }), row.id);
            }
            db.exec('DROP TABLE IF EXISTS sentinel_dependency_actions');
        })();
    }

    transaction<T>(owner: SentinelTodoOwner, operation: () => T): T {
        return this.todos.withCurrentEvidence(owner, this.todos.get(owner), operation);
    }

    records(owner: SentinelTodoOwner): { itemId: string; record: DependencyAdmissionRecord }[] {
        return this.db.prepare(`SELECT item_id, record FROM sentinel_dependency_admissions
            WHERE workspace_id = ? AND parent_process_id = ?`)
            .all<{ item_id: string; record: string }>(owner.workspaceId, owner.processId)
            .map(row => ({ itemId: row.item_id, record: JSON.parse(row.record) }));
    }

    invalidateWake(owner: SentinelTodoOwner, wake: DependencyWake, reason: string): void {
        if (wake.invalidatedAt) return;
        this.db.prepare('UPDATE sentinel_dependency_wakes SET receipt = ? WHERE id = ? AND workspace_id = ? AND parent_process_id = ?')
            .run(JSON.stringify({ ...wake, invalidatedAt: new Date().toISOString(), invalidatedReason: reason }),
                wake.id, owner.workspaceId, owner.processId);
    }

    invalidateEvaluation(owner: SentinelTodoOwner, evaluation: SentinelTodoDependencyEvaluation, reason: string): void {
        this.db.prepare(`UPDATE sentinel_todo_evaluations SET evaluation = ?
            WHERE workspace_id = ? AND parent_process_id = ? AND item_id = ?`)
            .run(JSON.stringify({ ...evaluation, state: 'waiting', blocker: reason,
                edges: evaluation.edges.map(edge => ({ ...edge, satisfied: false, blocker: reason })) }),
                owner.workspaceId, owner.processId, evaluation.itemId);
    }

    admission(owner: SentinelTodoOwner, itemId: string, taskId: string): DependencyAdmissionRecord | undefined {
        const row = this.db.prepare(`SELECT record FROM sentinel_dependency_admissions
            WHERE task_id = ? AND workspace_id = ? AND parent_process_id = ? AND item_id = ?`)
            .get<{ record: string }>(taskId, owner.workspaceId, owner.processId, itemId);
        return row ? JSON.parse(row.record) : undefined;
    }

    reserveAdmission(owner: SentinelTodoOwner, itemId: string, record: DependencyAdmissionRecord): void {
        this.db.prepare('INSERT INTO sentinel_dependency_admissions VALUES (?, ?, ?, ?, ?)')
            .run(record.taskId, owner.workspaceId, owner.processId, itemId, JSON.stringify(record));
    }

    saveAdmission(owner: SentinelTodoOwner, itemId: string, record: DependencyAdmissionRecord): void {
        this.db.prepare(`UPDATE sentinel_dependency_admissions SET record = ?
            WHERE task_id = ? AND workspace_id = ? AND parent_process_id = ? AND item_id = ?`)
            .run(JSON.stringify(record), record.taskId, owner.workspaceId, owner.processId, itemId);
    }

    startRalphStep(admissionTaskId: string, step: string, taskId: string): void {
        if (this.db.prepare('SELECT 1 FROM sentinel_dependency_ralph_starts WHERE admission_task_id = ? AND step = ?')
            .get(admissionTaskId, step)) {
            throw new SentinelTodoError('invalid', 'Ralph step already started; execution replay is blocked');
        }
        this.db.prepare('INSERT INTO sentinel_dependency_ralph_starts VALUES (?, ?, ?)').run(admissionTaskId, step, taskId);
    }

    wakes(owner: SentinelTodoOwner, itemId?: string): DependencyWake[] {
        return this.db.prepare(`SELECT receipt FROM sentinel_dependency_wakes
            WHERE workspace_id = ? AND parent_process_id = ? ${itemId ? 'AND item_id = ?' : ''}`)
            .all<{ receipt: string }>(...[owner.workspaceId, owner.processId, ...(itemId ? [itemId] : [])])
            .map(row => JSON.parse(row.receipt));
    }

    currentWake(owner: SentinelTodoOwner, itemId: string, generation: string,
        graphRevision: number | undefined, dependencies: SentinelTodoDependency[]): DependencyWake | undefined {
        return this.wakes(owner, itemId).find(wake => wake.generation === generation
            || (graphRevision !== undefined && wake.graphRevision === graphRevision
                && JSON.stringify(wake.evidence.edges.map(edge => edge.dependency)) === JSON.stringify(dependencies)));
    }

    reserveWake(owner: SentinelTodoOwner, evidence: SentinelTodoDependencyEvaluation,
        generation: string, prompt: (id: string) => string, transportTriggerId?: string, graphRevision?: number,
        lineage?: DependencyAdmissionRecord['lineage']): DependencyWake {
        const prior = this.currentWake(owner, evidence.itemId, generation, graphRevision,
            evidence.edges.map(edge => edge.dependency));
        if (prior) return prior;
        const id = randomUUID();
        const wake: DependencyWake = { id, itemId: evidence.itemId, generation, evidence, prompt: prompt(id), delivery: 'pending',
            ...(graphRevision !== undefined ? { graphRevision } : {}),
            ...(lineage ? { lineage } : {}),
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
            UNION SELECT workspace_id, parent_process_id FROM sentinel_dependency_wakes
                WHERE json_extract(receipt, '$.delivery') = 'pending' AND json_extract(receipt, '$.invalidatedAt') IS NULL`)
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

}
