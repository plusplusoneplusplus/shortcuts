import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isQueueProcessId, toTaskId, toQueueProcessId, type CreateTaskInput, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { ReasoningEffort, SentinelScheduledJob } from '@plusplusoneplusplus/coc-client';
import { getRepoDataPath } from '../paths';
import { nextCronTime } from '../schedule/cron-utils';
import { readAutoCompact } from '../processes/auto-compact';
import type { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import { SentinelTodoError, type SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import { JobError, SentinelJobStore, type JobRecord, type JobRunRecord } from './job-store';
import { getJobTaskContext, type JobTaskContext } from './job-metadata';
export { getJobTaskContext } from './job-metadata';

export interface JobServiceDeps {
    dataDir: string;
    jobs: SentinelJobStore;
    todos: Pick<SentinelTodoService, 'list' | 'assertOwner'>;
    store: ProcessStore;
    getEnabled: () => boolean;
    enqueue: (input: CreateTaskInput) => Promise<string>;
    cancelTask: (id: string) => boolean | Promise<boolean>;
    getTask: (id: string) => (Pick<QueuedTask, 'status'> & Partial<Pick<QueuedTask, 'payload'>>) | undefined;
    onChange?: (owner: SentinelTodoOwner) => void;
    now?: () => Date;
}

const ACTIVE = ['queued', 'running'] as const;
const pending = (run: JobRunRecord) => run.handbackState === 'pending' || run.handbackState === 'queued';
const href = (owner: SentinelTodoOwner, processId: string, turnIndex = 0) =>
    `#repos/${owner.workspaceId}/chats/${encodeURIComponent(processId)}?turn=${turnIndex}`;

/** One persistent chat per job, using only the existing workspace task queue. */
export class SentinelJobService {
    private disposed = false;
    private readonly admissions = new Set<Promise<unknown>>();
    private detach?: () => void;

    constructor(readonly deps: JobServiceDeps) {}

    async assertOwner(owner: SentinelTodoOwner): Promise<void> {
        if (this.disposed || !this.deps.getEnabled()) throw new JobError('not_found', 'Sentinel jobs are disabled');
        await this.deps.todos.assertOwner(owner);
        if (!(await this.deps.store.getWorkspaces()).some(workspace => workspace.id === owner.workspaceId)) {
            throw new JobError('not_found', 'Workspace not found');
        }
        if (this.disposed || !this.deps.getEnabled()) throw new JobError('not_found', 'Sentinel jobs are disabled');
    }

    view(owner: SentinelTodoOwner, job: JobRecord): SentinelScheduledJob {
        const { runCount: _, chatCreated: _chat, ...settings } = job;
        const runs = this.deps.jobs.runs(owner, job.id);
        const next = job.enabled && job.cron && this.deps.getEnabled() ? nextCronTime(job.cron, this.now()) : undefined;
        const publicRun = (run: JobRunRecord) => {
            const { taskId: _task, handbackTaskId: _handback, handbackState: _state, result: _result, ...value } = run;
            return value;
        };
        const activeRun = runs.find(run => ACTIVE.includes(run.status as typeof ACTIVE[number]));
        return { ...settings, runs: runs.slice(0, 20).map(publicRun),
            ...(activeRun ? { activeRun: publicRun(activeRun) } : {}),
            ...(next ? { nextRunAt: next.toISOString() } : {}) };
    }

    async start(owner: SentinelTodoOwner, jobId: string, trigger: JobRunRecord['trigger'] = 'manual',
        scheduleCurrent?: () => boolean): Promise<JobRunRecord> {
        const operation = this.startRun(owner, jobId, trigger, scheduleCurrent);
        return this.track(operation);
    }

    private async startRun(owner: SentinelTodoOwner, jobId: string, trigger: JobRunRecord['trigger'],
        scheduleCurrent?: () => boolean): Promise<JobRunRecord> {
        await this.assertOwner(owner);
        if (scheduleCurrent?.() === false) throw new JobError('conflict', 'Job schedule changed during admission');
        let job = this.deps.jobs.get(owner, jobId);
        if (!job.enabled && trigger === 'schedule') throw new JobError('conflict', 'Job schedule is paused');
        const taskId = randomUUID();
        // Claim single-flight before reading the snapshot or awaiting filesystem I/O.
        const run = this.deps.jobs.createRun(owner, jobId, trigger, toQueueProcessId(taskId), this.now().toISOString());
        this.changed(owner);
        if (run.status === 'skipped') return run;
        this.deps.jobs.patchRun(owner, jobId, run.id, { taskId });
        try {
            job = this.deps.jobs.get(owner, jobId);
            await this.ensureChat(owner, job);
            const ledger = await this.deps.todos.list(owner);
            const snapshotPath = this.snapshotPath(owner, jobId, run.id);
            await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
            await fs.writeFile(snapshotPath, JSON.stringify({ owner, jobId, runId: run.id,
                createdAt: run.createdAt, readOnly: true, ledger }, null, 2), { flag: 'wx', mode: 0o400 });
            await this.pruneSnapshots(owner, jobId);
            await this.assertOwner(owner);
            if (scheduleCurrent?.() === false) throw new JobError('conflict', 'Job schedule changed during admission');
            job = this.deps.jobs.get(owner, jobId);
            if (this.deps.jobs.run(owner, jobId, run.id).status !== 'queued') {
                return this.deps.jobs.run(owner, jobId, run.id);
            }
            if (!job.enabled && trigger === 'schedule') throw new JobError('conflict', 'Job schedule is paused');
            const process = await this.deps.store.getProcess(job.processId!, owner.workspaceId);
            if (!process) throw new JobError('conflict', 'Persistent job chat was removed');
            await this.assertOwner(owner);
            if (this.deps.jobs.run(owner, jobId, run.id).status !== 'queued') return this.deps.jobs.run(owner, jobId, run.id);
            const context: JobTaskContext = { ...owner, jobId, runId: run.id, kind: 'run' };
            await this.deps.enqueue({
                id: taskId, type: 'chat', priority: 'low', repoId: owner.workspaceId, processId: job.processId,
                payload: { kind: 'chat', mode: job.mode, provider: job.provider, model: job.model,
                    workspaceId: owner.workspaceId,
                    processId: job.processId, relayRequestId: `sentinel-job:${run.id}`,
                    prompt: [
                        job.instructions, '',
                        `Fresh read-only Sentinel to-do snapshot: ${snapshotPath}`,
                        'Read that file for this run; never modify the snapshot or the Sentinel ledger.',
                        'You are a job chat, not the owning Sentinel. You have no ledger-writing authority.',
                        'Return the result in your final response. The server queues the handback to the Sentinel.',
                    ].join('\n'),
                    context: { sentinelScheduledJob: context },
                },
                config: { model: job.model, ...(job.effort ? { reasoningEffort: job.effort as ReasoningEffort } : {}),
                    retryAttempts: 0, retryOnFailure: false, timeoutMs: 0 },
                displayName: `[Job: ${job.name}] run #${run.runNumber}`,
            });
            const admitted = this.deps.jobs.run(owner, jobId, run.id);
            if (!ACTIVE.includes(admitted.status as typeof ACTIVE[number])) await this.deps.cancelTask(taskId);
            this.changed(owner);
            return admitted;
        } catch (error) {
            await this.finish(owner, jobId, run.id, this.disposed ? 'interrupted' : 'failed',
                this.disposed ? 'Server stopped during this run' : message(error), true);
            return this.deps.jobs.run(owner, jobId, run.id);
        }
    }

    /** Execution boundary: re-prove live ownership and persisted task identity before any SDK call. */
    async guard(task: QueuedTask): Promise<void> {
        const context = getJobTaskContext(task);
        if (!context) return;
        await this.assertOwner(context);
        const job = this.deps.jobs.get(context, context.jobId);
        const run = this.deps.jobs.run(context, context.jobId, context.runId);
        if (task.repoId !== context.workspaceId || task.payload.workspaceId !== context.workspaceId) {
            throw new JobError('conflict', 'Job task workspace does not match its owner');
        }
        const target = task.processId ?? task.payload.processId ?? toQueueProcessId(task.id);
        if (context.kind === 'handback') {
            if (run.handbackTaskId !== task.id || run.handbackState !== 'queued'
                || target !== context.processId || task.payload.mode !== 'sentinel') {
                throw new JobError('conflict', 'Job handback is no longer authorized');
            }
            return;
        }
        if ((!job.enabled && run.trigger === 'schedule') || run.taskId !== task.id || !ACTIVE.includes(run.status as typeof ACTIVE[number])
            || target !== job.processId || task.payload.mode !== job.mode || task.payload.provider !== job.provider) {
            throw new JobError('conflict', 'Job run is no longer authorized');
        }
        const process = await this.deps.store.getProcess(job.processId!, context.workspaceId);
        const index = process?.conversationTurns?.length
            ? Math.max(...process.conversationTurns.map(turn => turn.turnIndex)) + 1 : 0;
        if (process) {
            const state = readAutoCompact(process.metadata);
            await this.deps.store.updateProcess(process.id, { metadata: {
                ...process.metadata!, ...this.metadataForTask(task),
                mode: job.mode, provider: job.provider, model: job.model,
                ...(state?.thresholdTokens === job.autoCompactThreshold ? { autoCompact: state } : {}),
            } });
        }
        this.deps.jobs.patchRun(context, job.id, run.id, {
            status: 'running', startedAt: run.startedAt ?? this.now().toISOString(),
            turnIndex: run.turnIndex ?? index, jobTurnHref: run.jobTurnHref ?? href(context, job.processId!, index),
        }, ACTIVE);
        this.changed(context);
    }

    metadataForTask(task: QueuedTask): Record<string, unknown> {
        const context = getJobTaskContext(task);
        if (!context || context.kind !== 'run') return {};
        const job = this.deps.jobs.get(context, context.jobId);
        return { sentinelScheduledJob: { workspaceId: context.workspaceId, processId: context.processId, jobId: job.id },
            autoCompact: { enabled: true, thresholdTokens: job.autoCompactThreshold } };
    }

    async cancel(owner: SentinelTodoOwner, id: string, runId: string): Promise<JobRunRecord> {
        return this.track(this.cancelRun(owner, id, runId));
    }

    private async cancelRun(owner: SentinelTodoOwner, id: string, runId: string): Promise<JobRunRecord> {
        await this.assertOwner(owner);
        this.deps.jobs.get(owner, id);
        const run = this.deps.jobs.run(owner, id, runId);
        if (ACTIVE.includes(run.status as typeof ACTIVE[number])) {
            await this.finish(owner, id, runId, 'cancelled', 'Cancelled by user', true);
        }
        return this.deps.jobs.run(owner, id, runId);
    }

    attach(queue: {
        on(event: 'taskCompleted' | 'taskFailed' | 'taskCancelled', listener: (repo: string, task: QueuedTask, detail?: unknown) => void): unknown;
        off?(event: 'taskCompleted' | 'taskFailed' | 'taskCancelled', listener: (repo: string, task: QueuedTask, detail?: unknown) => void): unknown;
    }): void {
        this.detach?.();
        const events = [
            ['taskCompleted', 'completed'], ['taskFailed', 'failed'], ['taskCancelled', 'cancelled'],
        ] as const;
        const listeners = events.map(([event, status]) => {
            const listener = (_repo: string, task: QueuedTask, detail?: unknown) => {
                if (!getJobTaskContext(task)) return;
                void this.track(this.terminal(task, status, detail)).catch(error =>
                    console.error('[sentinel-jobs] Could not settle job task:', error));
            };
            queue.on(event, listener);
            return { event, listener };
        });
        this.detach = () => { for (const { event, listener } of listeners) queue.off?.(event, listener); };
    }

    /** No job retries/catch-up: interrupted turns terminate, pending handbacks recover by stable queue identity. */
    async recover(): Promise<number> {
        let count = 0;
        for (const { owner, job } of this.deps.jobs.all()) {
            for (const run of this.deps.jobs.runs(owner, job.id)) {
                if (ACTIVE.includes(run.status as typeof ACTIVE[number])) {
                    await this.finish(owner, job.id, run.id, 'interrupted', 'Server restarted during this run', true);
                    count++;
                } else if (pending(run)) {
                    const sentinel = await this.deps.store.getProcess(owner.processId, owner.workspaceId);
                    const turns = sentinel?.conversationTurns ?? [];
                    const user = turns.find(turn => turn.relayRequestId === `sentinel-job-handback:${run.id}`);
                    const response = user && turns.filter(turn => !turn.displayOnly && turn.turnIndex > user.turnIndex)
                        .sort((a, b) => a.turnIndex - b.turnIndex)[0];
                    if (user && response?.role === 'assistant' && !response.streaming) {
                        this.deps.jobs.patchRun(owner, job.id, run.id, { handbackState: 'delivered',
                            sentinelFollowUpHref: href(owner, owner.processId, user.turnIndex) });
                        if (run.handbackTaskId) await this.deps.cancelTask(run.handbackTaskId);
                        continue;
                    }
                    const task = run.handbackTaskId && this.deps.getTask(run.handbackTaskId);
                    if (task && (task.status === 'queued' || task.status === 'running')) continue;
                    // A recorded completed task is definitive; do not repeat its Sentinel turn.
                    if (task) this.deps.jobs.patchRun(owner, job.id, run.id, {
                        handbackState: task.status === 'completed' ? 'delivered' : 'failed',
                    });
                    else await this.handback(owner, job, run);
                }
            }
        }
        await this.invalidate();
        return count;
    }

    /** Live flag/owner invalidation cancels queued/running work and revokes undelivered handbacks. */
    async invalidate(): Promise<void> {
        if (this.disposed) return;
        return this.track(this.invalidateOwners());
    }

    private async invalidateOwners(): Promise<void> {
        for (const { owner, job } of this.deps.jobs.all()) {
            try { await this.assertOwner(owner); continue; }
            catch (error) { if (!ownerUnavailable(error)) throw error; }
            for (const run of this.deps.jobs.runs(owner, job.id)) {
                if (pending(run)) {
                    this.deps.jobs.patchRun(owner, job.id, run.id, { handbackState: 'suppressed' });
                    if (run.handbackTaskId) await this.deps.cancelTask(run.handbackTaskId);
                }
                if (ACTIVE.includes(run.status as typeof ACTIVE[number])) {
                    await this.finish(owner, job.id, run.id, 'cancelled', 'Sentinel jobs or their owner became unavailable', true);
                }
            }
            this.changed(owner);
        }
    }

    async shutdown(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.detach?.();
        await Promise.allSettled([...this.admissions]);
        for (const { owner, job } of this.deps.jobs.all()) for (const run of this.deps.jobs.runs(owner, job.id)) {
            if (ACTIVE.includes(run.status as typeof ACTIVE[number])) {
                const at = this.now().toISOString();
                this.deps.jobs.patchRun(owner, job.id, run.id, { status: 'interrupted',
                    finishedAt: at, durationMs: Math.max(0, Date.parse(at) - Date.parse(run.startedAt ?? run.createdAt)),
                    error: 'Server stopped during this run', handbackState: 'pending' }, ACTIVE);
                if (run.taskId) await this.deps.cancelTask(run.taskId);
            }
            if (pending(run) && run.handbackTaskId) {
                await this.deps.cancelTask(run.handbackTaskId);
                this.deps.jobs.patchRun(owner, job.id, run.id, { handbackState: 'pending', handbackTaskId: undefined });
            }
        }
    }

    private async terminal(task: QueuedTask, status: 'completed' | 'failed' | 'cancelled', detail?: unknown): Promise<void> {
        const context = getJobTaskContext(task)!;
        let run: JobRunRecord;
        try { run = this.deps.jobs.run(context, context.jobId, context.runId); }
        catch (error) {
            if (error instanceof JobError && error.code === 'not_found') return;
            throw error;
        }
        if (context.kind === 'handback') {
            if (run.handbackTaskId !== task.id || run.handbackState !== 'queued') return;
            const process = await this.deps.store.getProcess(context.processId, context.workspaceId);
            const turn = process?.conversationTurns?.find(turn => turn.relayRequestId === `sentinel-job-handback:${run.id}`);
            this.deps.jobs.patchRun(context, context.jobId, context.runId, {
                handbackState: status === 'completed' ? 'delivered' : 'failed',
                ...(turn ? { sentinelFollowUpHref: href(context, context.processId, turn.turnIndex) } : {}),
            });
            this.changed(context);
            return;
        }
        if (run.taskId !== task.id) return;
        await this.finish(context, context.jobId, context.runId, status,
            status === 'completed' ? undefined : message(detail ?? (status === 'cancelled' ? 'Cancelled' : 'Job failed')));
    }

    private async finish(owner: SentinelTodoOwner, id: string, runId: string,
        status: 'completed' | 'failed' | 'cancelled' | 'interrupted', error?: string, stopTask = false): Promise<void> {
        const current = this.deps.jobs.run(owner, id, runId);
        const at = this.now().toISOString();
        const run = this.deps.jobs.patchRun(owner, id, runId, { status, finishedAt: at,
            durationMs: Math.max(0, Date.parse(at) - Date.parse(current.startedAt ?? current.createdAt)),
            error, handbackState: 'pending' }, ACTIVE);
        if (!run) return;
        this.changed(owner);
        if (stopTask && run.taskId) {
            try { await this.deps.cancelTask(run.taskId); }
            catch (cancelError) { console.error('[sentinel-jobs] Could not cancel job task:', cancelError); }
        }
        if (this.disposed) return;
        const job = this.deps.jobs.get(owner, id);
        try {
            const process = job.processId ? await this.deps.store.getProcess(job.processId, owner.workspaceId) : undefined;
            const response = process?.conversationTurns?.filter(turn => !turn.displayOnly
                && turn.turnIndex > (run.turnIndex ?? -1)).sort((a, b) => a.turnIndex - b.turnIndex)[0];
            const assistant = response?.role === 'assistant' && !response.streaming ? response : undefined;
            const result = assistant?.content || 'Completed without a final response';
            const updated = this.deps.jobs.patchRun(owner, id, runId, { result: result.slice(0, 16_000) })!;
            await this.handback(owner, job, updated);
        } catch (handbackError) {
            this.deps.jobs.patchRun(owner, id, runId, { handbackState: this.disposed ? 'pending' : 'failed' });
            console.error('[sentinel-jobs] Could not queue Sentinel handback:', handbackError);
        }
        this.changed(owner);
    }

    private async handback(owner: SentinelTodoOwner, job: JobRecord, run: JobRunRecord): Promise<void> {
        try { await this.assertOwner(owner); }
        catch (error) {
            if (!ownerUnavailable(error)) throw error;
            this.deps.jobs.patchRun(owner, job.id, run.id, { handbackState: this.disposed ? 'pending' : 'suppressed' });
            return;
        }
        const sentinel = await this.deps.store.getProcess(owner.processId, owner.workspaceId);
        const parentTask = !sentinel && isQueueProcessId(owner.processId) ? this.deps.getTask(toTaskId(owner.processId)) : undefined;
        const queuedSentinel = parentTask && ACTIVE.includes(parentTask.status as typeof ACTIVE[number])
            && parentTask.payload?.mode === 'sentinel' && parentTask.payload.workspaceId === owner.workspaceId;
        if (!sentinel && !queuedSentinel) {
            this.deps.jobs.patchRun(owner, job.id, run.id, { handbackState: this.disposed ? 'pending' : 'suppressed' }); return;
        }
        const taskId = run.handbackTaskId ?? randomUUID();
        const context: JobTaskContext = { ...owner, jobId: job.id, runId: run.id, kind: 'handback' };
        const text = run.status === 'completed'
            ? `[Job: ${job.name}] run #${run.runNumber} finished — ${run.result ?? 'Completed'}`
            : `[Job: ${job.name}] run #${run.runNumber} failed: ${run.error ?? run.status}`;
        this.deps.jobs.patchRun(owner, job.id, run.id, { handbackTaskId: taskId, handbackState: 'queued' });
        await this.assertOwner(owner);
        await this.deps.enqueue({
            id: taskId, type: 'chat', priority: 'low', repoId: owner.workspaceId, processId: owner.processId,
            payload: { kind: 'chat', mode: 'sentinel', workspaceId: owner.workspaceId, processId: owner.processId,
                provider: sentinel?.metadata?.provider ?? parentTask?.payload?.provider,
                prompt: text + (run.jobTurnHref ? `\n\n[Job turn](${run.jobTurnHref})` : ''),
                relayRequestId: `sentinel-job-handback:${run.id}`, context: { sentinelScheduledJob: context } },
            config: { retryAttempts: 0, retryOnFailure: false }, displayName: `[Job: ${job.name}] handback #${run.runNumber}`,
        });
        // Revocation can race asynchronous queue admission.
        const current = this.deps.jobs.run(owner, job.id, run.id);
        if (this.disposed || !this.deps.getEnabled() || current.handbackState !== 'queued') await this.deps.cancelTask(taskId);
    }

    private snapshotPath(owner: SentinelTodoOwner, id: string, runId: string): string {
        return getRepoDataPath(this.deps.dataDir, owner.workspaceId,
            path.join('sentinel-jobs', encodeURIComponent(owner.processId), id, `${runId}.json`));
    }

    async removeSnapshots(owner: SentinelTodoOwner, id: string): Promise<void> {
        try { await fs.rm(path.dirname(this.snapshotPath(owner, id, 'unused')), { recursive: true, force: true }); }
        catch (error) { console.error('[sentinel-jobs] Could not remove old snapshots:', error); }
    }

    private async pruneSnapshots(owner: SentinelTodoOwner, id: string): Promise<void> {
        const directory = path.dirname(this.snapshotPath(owner, id, 'unused'));
        const retained = new Set(this.deps.jobs.runs(owner, id).map(run => `${run.id}.json`));
        for (const filename of await fs.readdir(directory)) {
            if (filename.endsWith('.json') && !retained.has(filename)) {
                await fs.rm(path.join(directory, filename), { force: true });
            }
        }
    }

    private async ensureChat(owner: SentinelTodoOwner, job: JobRecord): Promise<void> {
        const existing = await this.deps.store.getProcess(job.processId!, owner.workspaceId);
        if (existing) {
            if (!job.chatCreated) this.deps.jobs.markChatCreated(owner, job.id);
            return;
        }
        if (job.chatCreated) throw new JobError('conflict', 'Persistent job chat was removed; create a new job to start a new chat');
        await this.assertOwner(owner);
        const workspace = (await this.deps.store.getWorkspaces()).find(workspace => workspace.id === owner.workspaceId);
        await this.deps.store.addProcess({
            id: job.processId!, type: 'chat', status: 'completed', startTime: this.now(),
            parentProcessId: owner.processId, customTitle: `[Job: ${job.name}]`,
            promptPreview: job.name, fullPrompt: '', conversationTurns: [], workingDirectory: workspace?.rootPath,
            metadata: { type: 'chat', workspaceId: owner.workspaceId, mode: job.mode, provider: job.provider, model: job.model,
                sentinelScheduledJob: { ...owner, jobId: job.id },
                autoCompact: { enabled: true, thresholdTokens: job.autoCompactThreshold } },
        });
        this.deps.jobs.markChatCreated(owner, job.id);
    }
    private changed(owner: SentinelTodoOwner): void { this.deps.onChange?.(owner); }
    private now(): Date { return this.deps.now?.() ?? new Date(); }
    private track<T>(operation: Promise<T>): Promise<T> {
        this.admissions.add(operation);
        void operation.finally(() => this.admissions.delete(operation)).catch(() => {});
        return operation;
    }
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown failure';
}

function ownerUnavailable(error: unknown): boolean {
    return (error instanceof JobError || error instanceof SentinelTodoError) && error.code === 'not_found';
}
