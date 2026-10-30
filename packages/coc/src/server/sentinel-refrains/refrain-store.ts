import { randomUUID } from 'node:crypto';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { SentinelRefrain, SentinelRefrainInput, SentinelRefrainRun } from '@plusplusoneplusplus/coc-client';
import { z } from 'zod';
import { validateScrubCron } from '../schedule/scrub-cron';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';

export const refrainInputSchema = z.object({
    name: z.string().trim().min(1).max(120),
    instructions: z.string().trim().min(1).max(32_000),
    provider: z.enum(['copilot', 'codex', 'claude', 'opencode']),
    model: z.string().trim().min(1).max(200).optional(),
    effort: z.enum(['', 'low', 'medium', 'high', 'xhigh']).optional(),
    effortTier: z.enum(['', 'very-low', 'low', 'medium', 'high']).optional(),
    mode: z.enum(['ask', 'autopilot']).default('ask'),
    cron: z.string().trim().max(200).optional(),
    enabled: z.boolean().default(true),
    autoCompactThreshold: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(100_000),
    gateScript: z.string().max(32_000).optional(),
}).strict();

export type RefrainRecord = Omit<SentinelRefrain, 'runs' | 'activeRun' | 'latestRun' | 'runHistoryTruncated' | 'nextRunAt'> & { runCount: number; chatCreated?: boolean };
/** Runtime gate bookkeeping; ticks write it without a revision bump, user edits never set it. */
export type RefrainGateState = Pick<RefrainRecord, 'gateLastResult' | 'gateConsecutiveFailures' | 'gateLastError' | 'gatePaused'>;
const FRESH_GATE: RefrainGateState = { gateConsecutiveFailures: 0, gatePaused: false };
export interface RefrainRunRecord extends SentinelRefrainRun {
    taskId?: string;
    /** Sentinel handback bookkeeping from older servers; startup recovery cancels and clears it. */
    handbackTaskId?: string;
    handbackState?: string;
    result?: string;
    sentinelFollowUpHref?: string;
}
export class RefrainError extends Error {
    constructor(public readonly code: 'invalid' | 'not_found' | 'conflict' | 'limit', message: string) { super(message); }
}
type Row = { workspace_id: string; parent_process_id: string; record: string };
const active = (run: RefrainRunRecord) => run.status === 'queued' || run.status === 'running';

/** Additive tables on the ledger's processes.db connection; every key includes its owner. */
export class SentinelRefrainStore {
    constructor(private readonly db: NativeDatabase) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS sentinel_scheduled_jobs (
                workspace_id TEXT NOT NULL, parent_process_id TEXT NOT NULL, id TEXT NOT NULL,
                record TEXT NOT NULL, PRIMARY KEY (workspace_id, parent_process_id, id)
            );
            CREATE TABLE IF NOT EXISTS sentinel_scheduled_job_runs (
                workspace_id TEXT NOT NULL, parent_process_id TEXT NOT NULL, job_id TEXT NOT NULL,
                id TEXT NOT NULL, status TEXT NOT NULL, run_number INTEGER NOT NULL, record TEXT NOT NULL,
                PRIMARY KEY (workspace_id, parent_process_id, job_id, id),
                FOREIGN KEY (workspace_id, parent_process_id, job_id)
                    REFERENCES sentinel_scheduled_jobs (workspace_id, parent_process_id, id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS sentinel_scheduled_job_single_flight
                ON sentinel_scheduled_job_runs (workspace_id, parent_process_id, job_id) WHERE status IN ('queued', 'running');
        `);
    }

    list(owner: SentinelTodoOwner): RefrainRecord[] {
        return this.db.prepare('SELECT record FROM sentinel_scheduled_jobs WHERE workspace_id = ? AND parent_process_id = ? ORDER BY rowid')
            .all<{ record: string }>(owner.workspaceId, owner.processId).map(row => JSON.parse(row.record));
    }

    all(): Array<{ owner: SentinelTodoOwner; job: RefrainRecord }> {
        return this.db.prepare('SELECT workspace_id, parent_process_id, record FROM sentinel_scheduled_jobs')
            .all<Row>().map(row => ({ owner: { workspaceId: row.workspace_id, processId: row.parent_process_id }, job: JSON.parse(row.record) }));
    }

    get(owner: SentinelTodoOwner, id: string): RefrainRecord {
        const row = this.db.prepare('SELECT record FROM sentinel_scheduled_jobs WHERE workspace_id = ? AND parent_process_id = ? AND id = ?')
            .get<{ record: string }>(owner.workspaceId, owner.processId, id);
        if (!row) throw new RefrainError('not_found', 'Refrain not found');
        return JSON.parse(row.record);
    }

    create(owner: SentinelTodoOwner, input: SentinelRefrainInput): RefrainRecord {
        return this.db.transaction(() => {
            const parsed = this.validate(input);
            if (this.list(owner).length >= 10) throw new RefrainError('limit', 'A Sentinel can have at most 10 refrains');
            const job: RefrainRecord = { ...parsed, ...FRESH_GATE, id: randomUUID(), revision: 1, runCount: 0 };
            this.db.prepare('INSERT INTO sentinel_scheduled_jobs VALUES (?, ?, ?, ?)')
                .run(owner.workspaceId, owner.processId, job.id, JSON.stringify(job));
            return job;
        })();
    }

    update(owner: SentinelTodoOwner, id: string, input: Partial<SentinelRefrainInput>, expectedRevision: number): RefrainRecord {
        return this.db.transaction(() => {
            const togglingSchedule = Object.keys(input).length === 1 && typeof input.enabled === 'boolean';
            const current = this.mutable(owner, id, expectedRevision, togglingSchedule);
            const { id: _, revision: _revision, runCount: _count, processId: _process, chatCreated: _chat,
                gateLastResult, gateConsecutiveFailures, gateLastError, gatePaused, ...settings } = current;
            const merged: Partial<SentinelRefrainInput> = { ...settings, ...input };
            // An explicit model choice without a tier replaces a stored tier.
            if ('model' in input && !('effortTier' in input)) delete merged.effortTier;
            const parsed = this.validate(merged);
            // Gate state belongs to one script; a changed or cleared script starts fresh.
            const gate = parsed.gateScript === current.gateScript
                ? { gateLastResult, gateConsecutiveFailures, gateLastError, gatePaused } : FRESH_GATE;
            const next = { ...parsed, ...gate, id: current.id,
                processId: current.processId, chatCreated: current.chatCreated, runCount: current.runCount, revision: current.revision + 1 };
            this.save(owner, next);
            return next;
        })();
    }

    delete(owner: SentinelTodoOwner, id: string, expectedRevision: number): void {
        this.db.transaction(() => {
            this.mutable(owner, id, expectedRevision);
            this.db.prepare('DELETE FROM sentinel_scheduled_job_runs WHERE workspace_id = ? AND parent_process_id = ? AND job_id = ?')
                .run(owner.workspaceId, owner.processId, id);
            this.db.prepare('DELETE FROM sentinel_scheduled_jobs WHERE workspace_id = ? AND parent_process_id = ? AND id = ?')
                .run(owner.workspaceId, owner.processId, id);
        })();
    }

    runs(owner: SentinelTodoOwner, id: string): RefrainRunRecord[] {
        return this.db.prepare(`SELECT record FROM sentinel_scheduled_job_runs
            WHERE workspace_id = ? AND parent_process_id = ? AND job_id = ? ORDER BY run_number DESC`)
            .all<{ record: string }>(owner.workspaceId, owner.processId, id).map(row => JSON.parse(row.record));
    }

    run(owner: SentinelTodoOwner, id: string, runId: string): RefrainRunRecord {
        const row = this.db.prepare(`SELECT record FROM sentinel_scheduled_job_runs
            WHERE workspace_id = ? AND parent_process_id = ? AND job_id = ? AND id = ?`)
            .get<{ record: string }>(owner.workspaceId, owner.processId, id, runId);
        if (!row) throw new RefrainError('not_found', 'Refrain run not found');
        return JSON.parse(row.record);
    }

    /**
     * Claims single-flight, or records a skip: an active run always wins as `overlap` over a gate `skip`,
     * and a call with `skip` never claims. Only a claimed run adopts `processId` as the job chat.
     */
    createRun(owner: SentinelTodoOwner, id: string, trigger: RefrainRunRecord['trigger'], processId: string | undefined, now: string,
        skip?: NonNullable<RefrainRunRecord['skipReason']>): RefrainRunRecord {
        return this.db.transaction(() => {
            const job = this.get(owner, id);
            const overlap = this.runs(owner, id).some(active);
            if (overlap && trigger === 'manual') throw new RefrainError('conflict', 'This refrain already has an active run');
            const skipReason = overlap ? 'overlap' as const : skip;
            const run: RefrainRunRecord = { id: randomUUID(), runNumber: job.runCount + 1, trigger,
                status: skipReason ? 'skipped' : 'queued', createdAt: now,
                ...(skipReason ? { skipReason, finishedAt: now, durationMs: 0 } : {}) };
            this.save(owner, { ...job, processId: skipReason ? job.processId : job.processId ?? processId, runCount: run.runNumber });
            this.db.prepare('INSERT INTO sentinel_scheduled_job_runs VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(owner.workspaceId, owner.processId, id, run.id, run.status, run.runNumber, JSON.stringify(run));
            this.prune(owner, id);
            return run;
        })();
    }

    /** Applies gate bookkeeping only while `script` is still the job's gate; otherwise returns undefined. */
    updateGate(owner: SentinelTodoOwner, id: string, script: string,
        next: (job: RefrainRecord) => Partial<RefrainGateState>): RefrainRecord | undefined {
        return this.db.transaction(() => {
            const job = this.get(owner, id);
            if (!script || job.gateScript !== script) return undefined;
            const updated = { ...job, ...next(job) };
            this.save(owner, updated);
            return updated;
        })();
    }

    markChatCreated(owner: SentinelTodoOwner, id: string): void {
        this.db.transaction(() => this.save(owner, { ...this.get(owner, id), chatCreated: true }))();
    }

    patchRun(owner: SentinelTodoOwner, id: string, runId: string, patch: Partial<RefrainRunRecord>,
        from?: readonly RefrainRunRecord['status'][]): RefrainRunRecord | undefined {
        return this.db.transaction(() => {
            const current = this.run(owner, id, runId);
            if (from && !from.includes(current.status)) return undefined;
            const next = { ...current, ...patch };
            this.db.prepare(`UPDATE sentinel_scheduled_job_runs SET status = ?, record = ?
                WHERE workspace_id = ? AND parent_process_id = ? AND job_id = ? AND id = ?`)
                .run(next.status, JSON.stringify(next), owner.workspaceId, owner.processId, id, runId);
            return next;
        })();
    }

    private mutable(owner: SentinelTodoOwner, id: string, revision: number, togglingSchedule = false): RefrainRecord {
        const job = this.get(owner, id);
        if (job.revision !== revision) throw new RefrainError('conflict', 'Refrain changed since it was loaded');
        if (!togglingSchedule && this.runs(owner, id).some(active)) {
            throw new RefrainError('conflict', 'Cancel the active run or wait for it to finish before editing or deleting');
        }
        return job;
    }

    private validate(input: unknown): z.infer<typeof refrainInputSchema> {
        const parsed = refrainInputSchema.safeParse(input);
        if (!parsed.success) throw new RefrainError('invalid', 'Invalid refrain settings');
        const value = parsed.data;
        if (value.cron === '') delete value.cron;
        if (value.effort === '') delete value.effort;
        if (value.effortTier === '') delete value.effortTier;
        if (!value.gateScript?.trim()) delete value.gateScript;
        // A selected tier owns model and effort, so stale explicit values cannot override it.
        if (value.effortTier) {
            delete value.model;
            delete value.effort;
        } else if (!value.model) {
            throw new RefrainError('invalid', 'Invalid refrain settings');
        }
        if (value.cron) {
            const error = validateScrubCron(value.cron);
            if (error) throw new RefrainError('invalid', error);
        }
        if (value.gateScript && !value.cron) throw new RefrainError('invalid', 'A gate script needs a cron schedule');
        return value;
    }

    private save(owner: SentinelTodoOwner, job: RefrainRecord): void {
        this.db.prepare('UPDATE sentinel_scheduled_jobs SET record = ? WHERE workspace_id = ? AND parent_process_id = ? AND id = ?')
            .run(JSON.stringify(job), owner.workspaceId, owner.processId, job.id);
    }

    private prune(owner: SentinelTodoOwner, id: string): void {
        const runs = this.runs(owner, id);
        for (const run of runs.slice(20).filter(run => !active(run))) {
            this.db.prepare('DELETE FROM sentinel_scheduled_job_runs WHERE workspace_id = ? AND parent_process_id = ? AND job_id = ? AND id = ?')
                .run(owner.workspaceId, owner.processId, id, run.id);
        }
    }
}
