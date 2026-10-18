import { randomUUID } from 'node:crypto';
import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { SentinelScheduledJob, SentinelScheduledJobInput, SentinelScheduledJobRun } from '@plusplusoneplusplus/coc-client';
import { z } from 'zod';
import { validateScrubCron } from '../schedule/scrub-cron';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';

export const jobInputSchema = z.object({
    name: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(50_000),
    provider: z.enum(['copilot', 'codex', 'claude', 'opencode']),
    model: z.string().trim().min(1).max(200),
    effort: z.string().trim().min(1).max(100).optional(),
    mode: z.enum(['ask', 'autopilot']).default('ask'),
    cron: z.string().trim().max(200).optional(),
    enabled: z.boolean().default(true),
    autoCompactThreshold: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(100_000),
}).strict();

export type JobRecord = Omit<SentinelScheduledJob, 'runs' | 'activeRun' | 'nextRunAt'> & { runCount: number };
export interface JobRunRecord extends SentinelScheduledJobRun {
    taskId?: string;
    handbackTaskId?: string;
    handbackState?: 'pending' | 'queued' | 'delivered' | 'suppressed' | 'failed';
    result?: string;
}
export class JobError extends Error {
    constructor(public readonly code: 'invalid' | 'not_found' | 'conflict' | 'limit', message: string) { super(message); }
}
type Row = { workspace_id: string; parent_process_id: string; record: string };
const active = (run: JobRunRecord) => run.status === 'queued' || run.status === 'running';
const pending = (run: JobRunRecord) => run.handbackState === 'pending' || run.handbackState === 'queued';

/** Additive tables on the ledger's processes.db connection; every key includes its owner. */
export class SentinelJobStore {
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

    list(owner: SentinelTodoOwner): JobRecord[] {
        return this.db.prepare('SELECT record FROM sentinel_scheduled_jobs WHERE workspace_id = ? AND parent_process_id = ? ORDER BY rowid')
            .all<{ record: string }>(owner.workspaceId, owner.processId).map(row => JSON.parse(row.record));
    }

    all(): Array<{ owner: SentinelTodoOwner; job: JobRecord }> {
        return this.db.prepare('SELECT workspace_id, parent_process_id, record FROM sentinel_scheduled_jobs')
            .all<Row>().map(row => ({ owner: { workspaceId: row.workspace_id, processId: row.parent_process_id }, job: JSON.parse(row.record) }));
    }

    get(owner: SentinelTodoOwner, id: string): JobRecord {
        const row = this.db.prepare('SELECT record FROM sentinel_scheduled_jobs WHERE workspace_id = ? AND parent_process_id = ? AND id = ?')
            .get<{ record: string }>(owner.workspaceId, owner.processId, id);
        if (!row) throw new JobError('not_found', 'Job not found');
        return JSON.parse(row.record);
    }

    create(owner: SentinelTodoOwner, input: SentinelScheduledJobInput): JobRecord {
        return this.db.transaction(() => {
            const parsed = this.validate(input);
            if (this.list(owner).length >= 10) throw new JobError('limit', 'A Sentinel can have at most 10 user jobs');
            const job: JobRecord = { ...parsed, id: randomUUID(), revision: 1, runCount: 0 };
            this.db.prepare('INSERT INTO sentinel_scheduled_jobs VALUES (?, ?, ?, ?)')
                .run(owner.workspaceId, owner.processId, job.id, JSON.stringify(job));
            return job;
        })();
    }

    update(owner: SentinelTodoOwner, id: string, input: Partial<SentinelScheduledJobInput>, expectedRevision: number): JobRecord {
        return this.db.transaction(() => {
            const current = this.mutable(owner, id, expectedRevision);
            const { id: _, revision: _revision, runCount: _count, processId: _process, ...settings } = current;
            const next = { ...this.validate({ ...settings, ...input }), id: current.id,
                processId: current.processId, runCount: current.runCount, revision: current.revision + 1 };
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

    runs(owner: SentinelTodoOwner, id: string): JobRunRecord[] {
        return this.db.prepare(`SELECT record FROM sentinel_scheduled_job_runs
            WHERE workspace_id = ? AND parent_process_id = ? AND job_id = ? ORDER BY run_number DESC`)
            .all<{ record: string }>(owner.workspaceId, owner.processId, id).map(row => JSON.parse(row.record));
    }

    run(owner: SentinelTodoOwner, id: string, runId: string): JobRunRecord {
        const row = this.db.prepare(`SELECT record FROM sentinel_scheduled_job_runs
            WHERE workspace_id = ? AND parent_process_id = ? AND job_id = ? AND id = ?`)
            .get<{ record: string }>(owner.workspaceId, owner.processId, id, runId);
        if (!row) throw new JobError('not_found', 'Job run not found');
        return JSON.parse(row.record);
    }

    createRun(owner: SentinelTodoOwner, id: string, trigger: JobRunRecord['trigger'], processId: string, now: string): JobRunRecord {
        return this.db.transaction(() => {
            const job = this.get(owner, id);
            const overlap = this.runs(owner, id).some(active);
            if (overlap && trigger === 'manual') throw new JobError('conflict', 'This job already has an active run');
            const run: JobRunRecord = { id: randomUUID(), runNumber: job.runCount + 1, trigger,
                status: overlap ? 'skipped' : 'queued', createdAt: now,
                ...(overlap ? { skipReason: 'overlap' as const, finishedAt: now, durationMs: 0 } : {}) };
            this.save(owner, { ...job, processId: job.processId ?? processId, runCount: run.runNumber });
            this.db.prepare('INSERT INTO sentinel_scheduled_job_runs VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(owner.workspaceId, owner.processId, id, run.id, run.status, run.runNumber, JSON.stringify(run));
            this.prune(owner, id);
            return run;
        })();
    }

    patchRun(owner: SentinelTodoOwner, id: string, runId: string, patch: Partial<JobRunRecord>,
        from?: readonly JobRunRecord['status'][]): JobRunRecord | undefined {
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

    private mutable(owner: SentinelTodoOwner, id: string, revision: number): JobRecord {
        const job = this.get(owner, id);
        if (job.revision !== revision) throw new JobError('conflict', 'Job changed since it was loaded');
        if (this.runs(owner, id).some(run => active(run) || pending(run))) {
            throw new JobError('conflict', 'Cancel the active run and wait for its Sentinel handback before editing or deleting');
        }
        return job;
    }

    private validate(input: unknown): z.infer<typeof jobInputSchema> {
        const parsed = jobInputSchema.safeParse(input);
        if (!parsed.success) throw new JobError('invalid', 'Invalid job settings');
        const value = parsed.data;
        if (value.cron === '') delete value.cron;
        if (value.cron) {
            const error = validateScrubCron(value.cron);
            if (error) throw new JobError('invalid', error);
        }
        return value;
    }

    private save(owner: SentinelTodoOwner, job: JobRecord): void {
        this.db.prepare('UPDATE sentinel_scheduled_jobs SET record = ? WHERE workspace_id = ? AND parent_process_id = ? AND id = ?')
            .run(JSON.stringify(job), owner.workspaceId, owner.processId, job.id);
    }

    private prune(owner: SentinelTodoOwner, id: string): void {
        const runs = this.runs(owner, id);
        for (const run of runs.slice(20).filter(run => !active(run) && !pending(run))) {
            this.db.prepare('DELETE FROM sentinel_scheduled_job_runs WHERE workspace_id = ? AND parent_process_id = ? AND job_id = ? AND id = ?')
                .run(owner.workspaceId, owner.processId, id, run.id);
        }
    }
}
