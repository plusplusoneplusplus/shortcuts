import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toQueueProcessId, toTaskId, type CreateTaskInput, type QueuedTask } from '@plusplusoneplusplus/forge';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { SENTINEL_COMPLETION_GUIDANCE } from '../delegation/sentinel-job-review-instructions';
import type { SentinelTodoItemView, SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { Trigger } from '../triggers/trigger-types';
import type { CodaEngine } from './coda-engine';
import { MAX_CODA_ITEMS, CODA_TIMEOUT_MS, codaFindingInputSchema, type CodaFindingInput } from './coda-model';
import { CodaStoreError, type CodaStore, type CodaRunRecord, type CodaRunSource } from './coda-store';

export const SUBMIT_CODA_FINDINGS_TOOL_NAME = 'submit_scrub_findings';

/** Carried on the child chat's task payload (`context.sentinelScrub`). */
export interface CodaChildContext {
    workspaceId: string;
    /** The Sentinel chat that owns the ledger. */
    processId: string;
    runId: string;
}

export function getCodaChildContext(payload: unknown): CodaChildContext | undefined {
    const value = (payload as { context?: { sentinelScrub?: Partial<CodaChildContext> } } | undefined)?.context?.sentinelScrub;
    return value && typeof value.workspaceId === 'string' && typeof value.processId === 'string' && typeof value.runId === 'string'
        ? { workspaceId: value.workspaceId, processId: value.processId, runId: value.runId } : undefined;
}

/** Queue events the run service follows, with the registry's `(repoPath, task, …)` signature. */
export interface CodaQueueEvents {
    off?(event: 'taskCompleted' | 'taskFailed' | 'taskCancelled', listener: (repoPath: string, task: QueuedTask, detail?: unknown) => void): unknown;
    on(event: 'taskCompleted' | 'taskFailed' | 'taskCancelled', listener: (repoPath: string, task: QueuedTask, detail?: unknown) => void): unknown;
}

export interface CodaRunServiceDeps {
    dataDir: string;
    todos: Pick<SentinelTodoService, 'list'>;
    scrubber: CodaStore;
    engine: Pick<CodaEngine, 'complete'>;
    /** Admits the child chat with its supplied id to the owner's workspace queue. */
    enqueue: (input: CreateTaskInput) => Promise<string>;
    cancelTask: (taskId: string) => boolean | Promise<boolean>;
    /** Armed PR rules feed the skip-if-unchanged fingerprint and the snapshot. */
    listTriggers?: (owner: SentinelTodoOwner) => Promise<Trigger[]>;
    /** Re-check live schedule gates after asynchronous snapshot reads. */
    canStartScheduled?: (owner: SentinelTodoOwner) => boolean;
    /** Fired after any run change; `ledgerChanged` when findings were applied. */
    onChange?: (owner: SentinelTodoOwner, change: { runId: string; ledgerChanged?: boolean }) => void;
    now?: () => Date;
    timeoutMs?: number;
}

const OPEN_STATUSES = new Set(['todo', 'in_progress', 'deferred', 'needs_attention']);
const findingsSchema = z.array(codaFindingInputSchema).max(MAX_CODA_ITEMS);

/**
 * Starts, follows and settles Coda runs. A run is one queued, read-only
 * ask chat in the owner's workspace; its only output is one
 * `submit_scrub_findings` call, applied when the chat finishes. Cancel,
 * failure and timeout apply nothing.
 */
export class CodaRunService {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    private detachQueue?: () => void;

    constructor(private readonly deps: CodaRunServiceDeps) {}

    attach(queue: CodaQueueEvents): void {
        this.detachQueue?.();
        const follow = (outcome: 'completed' | 'failed' | 'cancelled') => (_repo: string, task: QueuedTask, detail?: unknown) => {
            void this.handleTaskTerminal(task, outcome, detail).catch(error =>
                console.error('[sentinel-scrubber] Could not settle a run:', error));
        };
        const completed = follow('completed');
        const failed = follow('failed');
        const cancelled = follow('cancelled');
        queue.on('taskCompleted', completed);
        queue.on('taskFailed', failed);
        queue.on('taskCancelled', cancelled);
        this.detachQueue = () => {
            queue.off?.('taskCompleted', completed);
            queue.off?.('taskFailed', failed);
            queue.off?.('taskCancelled', cancelled);
        };
    }

    /**
     * Starts a run over the open items (or the selected open ones). Scheduled
     * ticks never queue behind an active run or re-check an unchanged ledger:
     * they are recorded as `skipped` instead.
     */
    async start(owner: SentinelTodoOwner, opts: { trigger: CodaRunSource; itemIds?: string[] }): Promise<CodaRunRecord> {
        const ledger = await this.deps.todos.list(owner);
        const triggers = await this.listArmedTriggers(owner);
        if (opts.trigger === 'schedule' && this.deps.canStartScheduled?.(owner) === false) {
            throw new CodaStoreError('conflict', 'The Coda schedule is disarmed');
        }
        if (opts.trigger === 'manual' && this.deps.scrubber.activeRun(owner)) {
            throw new CodaStoreError('conflict', 'A Coda run is already active');
        }
        let open = ledger.items.filter(item => OPEN_STATUSES.has(item.status) && !item.archived);
        if (opts.itemIds) {
            const selected = new Set(opts.itemIds);
            open = open.filter(item => selected.has(item.id));
            if (!open.length) throw new CodaStoreError('invalid', 'None of the selected items are open');
        }
        const awaiting = open.filter(awaitingReview);
        const previous = this.deps.scrubber.listRuns(owner).find(run => run.status === 'completed');
        const deferred = new Set(previous?.deferredItemIds);
        const eligible = open.filter(item => !awaitingReview(item))
            .sort((a, b) => Number(deferred.has(b.id)) - Number(deferred.has(a.id)) || a.updatedAt.localeCompare(b.updatedAt));
        const included = eligible.slice(0, MAX_CODA_ITEMS);
        const inputFingerprint = fingerprintInput(open, triggers);
        const base: CodaRunRecord = {
            id: randomUUID(), trigger: opts.trigger, status: 'queued', createdAt: this.now().toISOString(),
            ...(opts.itemIds ? { selectedItemIds: open.map(item => item.id) } : {}),
            snapshot: included.map(item => ({ itemId: item.id, revision: item.revision })),
            deferredItemIds: eligible.slice(MAX_CODA_ITEMS).map(item => item.id),
            awaitingReviewItemIds: awaiting.map(item => item.id),
            inputFingerprint,
        };
        if (opts.trigger === 'schedule') {
            const skipReason = this.deps.scrubber.activeRun(owner) ? 'overlap'
                : eligible.length <= MAX_CODA_ITEMS && this.deps.scrubber.getConfig(owner).lastInputFingerprint === inputFingerprint ? 'unchanged' : undefined;
            if (skipReason) return this.record(owner, { ...base, status: 'skipped', skipReason, finishedAt: base.createdAt });
        }
        const taskId = randomUUID();
        // Persist identity before admission: execution and cancellation can race enqueue.
        const run = this.deps.scrubber.createRun(owner, { ...base, childProcessId: toQueueProcessId(taskId) });
        const snapshotPath = this.snapshotPath(owner, run.id);
        try {
            await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
            await fs.writeFile(snapshotPath, JSON.stringify(buildSnapshot(owner, run, included, awaiting, triggers), null, 2));
            const beforeAdmission = this.deps.scrubber.getRun(owner, run.id);
            if (!beforeAdmission) throw new CodaStoreError('not_found', 'Coda run was removed during admission');
            if (beforeAdmission.status !== 'queued') return beforeAdmission;
            if (opts.trigger === 'schedule' && this.deps.canStartScheduled?.(owner) === false) {
                const cancelled = this.deps.scrubber.transitionRun(owner, run.id, ['queued'], {
                    status: 'cancelled', finishedAt: this.now().toISOString(), error: 'The Coda schedule was disarmed',
                });
                this.finish(owner, run.id);
                return cancelled ?? this.deps.scrubber.getRun(owner, run.id)!;
            }
            await this.deps.enqueue(buildChildTask(owner, run, snapshotPath, taskId));
            const admitted = this.deps.scrubber.getRun(owner, run.id);
            if (!admitted || ['cancelled', 'timed_out', 'interrupted', 'failed'].includes(admitted.status)) await this.stopChild(run);
            this.changed(owner, run.id);
            if (!admitted) throw new CodaStoreError('not_found', 'Coda run was removed during admission');
            return admitted;
        } catch (error) {
            const failed = this.deps.scrubber.transitionRun(owner, run.id, ['queued', 'running'], {
                status: 'failed', finishedAt: this.now().toISOString(), error: `Could not start Coda: ${message(error)}`,
            });
            if (failed) await this.stopChild(failed);
            this.finish(owner, run.id);
            if (failed) return failed;
            throw error;
        }
    }

    /** The child chat's first turn began: the run is live and the timeout starts. */
    markRunning(context: CodaChildContext): CodaRunRecord | undefined {
        const owner = ownerOf(context);
        const run = this.deps.scrubber.transitionRun(owner, context.runId, ['queued'],
            { status: 'running', startedAt: this.now().toISOString() });
        if (!run) return this.deps.scrubber.getRun(owner, context.runId);
        const timer = setTimeout(() => void this.timeOut(owner, run.id), this.deps.timeoutMs ?? CODA_TIMEOUT_MS);
        timer.unref?.();
        this.timers.set(timerKey(owner, run.id), timer);
        this.changed(owner, run.id);
        return run;
    }

    /**
     * Accepts the run's one findings batch. It is held until the chat
     * finishes; a cancel or timeout before then discards it.
     */
    submit(context: CodaChildContext, input: unknown): { accepted: number; ignoredItemIds: string[] } {
        const owner = ownerOf(context);
        const parsed = findingsSchema.safeParse(input);
        if (!parsed.success) throw new CodaStoreError('invalid', z.prettifyError(parsed.error));
        return this.deps.scrubber.transaction(() => {
            const run = this.deps.scrubber.getRun(owner, context.runId);
            if (!run || run.status !== 'running') throw new CodaStoreError('conflict', 'This Coda run is no longer active');
            if (run.findingsSubmittedAt) throw new CodaStoreError('conflict', 'Findings were already submitted for this run');
            const snapshot = new Set(run.snapshot.map(entry => entry.itemId));
            const seen = new Set<string>();
            const accepted: CodaFindingInput[] = [];
            const ignoredItemIds: string[] = [];
            for (const finding of parsed.data) {
                if (!snapshot.has(finding.itemId) || seen.has(finding.itemId)) ignoredItemIds.push(finding.itemId);
                else { seen.add(finding.itemId); accepted.push(finding); }
            }
            const missing = [...snapshot].filter(itemId => !seen.has(itemId));
            if (missing.length) {
                throw new CodaStoreError('invalid', `Findings missing for ${missing.length} snapshot item(s): ${missing.join(', ')}. Report unverified with a reason when evidence cannot be checked.`);
            }
            const revisions = new Map(run.snapshot.map(entry => [entry.itemId, entry.revision]));
            this.deps.scrubber.saveFindings(owner, run.id, accepted.map(finding => ({
                runId: run.id, itemId: finding.itemId, finding, fingerprint: '', itemRevision: revisions.get(finding.itemId)!,
                state: 'pending', audit: [],
            })));
            this.deps.scrubber.transitionRun(owner, run.id, ['running'], { findingsSubmittedAt: this.now().toISOString() });
            return { accepted: accepted.length, ignoredItemIds };
        });
    }

    /** Ends an active run as `cancelled`; nothing it found is applied. */
    async cancel(owner: SentinelTodoOwner, runId: string): Promise<CodaRunRecord> {
        const run = this.deps.scrubber.transitionRun(owner, runId, ['queued', 'running'],
            { status: 'cancelled', finishedAt: this.now().toISOString() });
        if (!run) {
            const current = this.deps.scrubber.getRun(owner, runId);
            if (!current) throw new CodaStoreError('not_found', 'Coda run not found');
            return current;
        }
        await this.stopChild(run);
        this.finish(owner, runId);
        return run;
    }

    /**
     * Startup recovery: active runs from a previous server process can no
     * longer be followed, so they end as `interrupted` with nothing applied.
     */
    async interruptActive(): Promise<number> {
        let count = 0;
        for (const { owner, run } of this.deps.scrubber.listActiveRuns()) {
            const interrupted = this.deps.scrubber.transitionRun(owner, run.id, ['queued', 'running'], {
                status: 'interrupted', finishedAt: this.now().toISOString(), error: 'The server restarted during this run',
            });
            if (!interrupted) continue;
            count++;
            await this.stopChild(interrupted);
            this.finish(owner, run.id);
        }
        return count;
    }

    dispose(): void {
        this.detachQueue?.();
        this.detachQueue = undefined;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
    }

    /** Settles a run from its child chat's terminal queue event. */
    async handleTaskTerminal(task: QueuedTask, outcome: 'completed' | 'failed' | 'cancelled', detail?: unknown): Promise<void> {
        const context = getCodaChildContext(task.payload);
        if (!context) return;
        const owner = ownerOf(context);
        const run = this.deps.scrubber.getRun(owner, context.runId);
        if (!run || run.childProcessId !== (task.processId ?? toQueueProcessId(task.id))) return;
        const finishedAt = this.now().toISOString();
        let ledgerChanged = false;
        if (outcome === 'completed' && run.findingsSubmittedAt) {
            const findings = this.deps.scrubber.listFindings(owner, run.id)
                .filter(record => record.state === 'pending').map(record => record.finding);
            const result = this.deps.engine.complete(owner, run.id, findings);
            ledgerChanged = !!result?.findings.some(record => record.state === 'applied');
        } else {
            const error = outcome === 'cancelled' ? undefined
                : outcome === 'failed' ? `The Coda chat failed: ${message(detail)}`
                    : 'The Coda chat ended without submitting findings';
            this.deps.scrubber.transitionRun(owner, run.id, ['queued', 'running'], {
                status: outcome === 'cancelled' ? 'cancelled' : 'failed', finishedAt, ...(error ? { error } : {}),
            });
        }
        this.finish(owner, run.id, ledgerChanged);
    }

    snapshotPath(owner: SentinelTodoOwner, runId: string): string {
        return getRepoDataPath(this.deps.dataDir, owner.workspaceId,
            path.join(this.runsDir(owner), runId, 'snapshot.json'));
    }

    private async timeOut(owner: SentinelTodoOwner, runId: string): Promise<void> {
        const minutes = Math.round((this.deps.timeoutMs ?? CODA_TIMEOUT_MS) / 60_000);
        const run = this.deps.scrubber.transitionRun(owner, runId, ['running'], {
            status: 'timed_out', finishedAt: this.now().toISOString(), error: `Coda did not finish within ${minutes} min`,
        });
        if (!run) return;
        await this.stopChild(run);
        this.finish(owner, runId);
    }

    private async stopChild(run: CodaRunRecord): Promise<void> {
        if (!run.childProcessId) return;
        try { await this.deps.cancelTask(toTaskId(run.childProcessId)); }
        catch (error) { console.error('[sentinel-scrubber] Could not cancel the Coda chat:', error); }
    }

    private record(owner: SentinelTodoOwner, run: CodaRunRecord): CodaRunRecord {
        this.deps.scrubber.createRun(owner, run);
        this.finish(owner, run.id);
        return run;
    }

    /** Terminal bookkeeping: stop the timer, keep the newest runs, notify. */
    private finish(owner: SentinelTodoOwner, runId: string, ledgerChanged = false): void {
        const key = timerKey(owner, runId);
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
        for (const pruned of this.deps.scrubber.pruneRuns(owner)) {
            void fs.rm(path.dirname(this.snapshotPath(owner, pruned)), { recursive: true, force: true }).catch(() => undefined);
        }
        this.changed(owner, runId, ledgerChanged);
    }

    private changed(owner: SentinelTodoOwner, runId: string, ledgerChanged = false): void {
        try { this.deps.onChange?.(owner, { runId, ...(ledgerChanged ? { ledgerChanged } : {}) }); }
        catch { /* Notifications never undo a committed change. */ }
    }

    private async listArmedTriggers(owner: SentinelTodoOwner): Promise<Trigger[]> {
        if (!this.deps.listTriggers) return [];
        try { return (await this.deps.listTriggers(owner)).filter(trigger => trigger.status === 'active'); }
        catch { return []; }
    }

    private runsDir(owner: SentinelTodoOwner): string {
        return path.join('sentinel-scrubber', encodeURIComponent(owner.processId));
    }

    private now(): Date {
        return this.deps.now?.() ?? new Date();
    }
}

/** A linked job result the Sentinel has not reviewed yet: the Sentinel owns that assessment. */
function awaitingReview(item: SentinelTodoItemView): boolean {
    return item.jobs.some(job => 'review' in job.execution && job.execution.review?.assessment === 'pending');
}

/** Identity of what a scheduled tick would check; equal means nothing new to check. */
function fingerprintInput(items: readonly SentinelTodoItemView[], triggers: readonly Trigger[]): string {
    const itemKeys = items.map(item => [item.id, item.revision,
        item.jobs.map(job => [job.processId, job.execution.state,
            'review' in job.execution ? job.execution.review?.assessment ?? '' : ''])]);
    const triggerKeys = triggers.map(trigger => [trigger.id, trigger.status, trigger.binding?.itemId ?? '']);
    const sort = (rows: unknown[][]) => rows.map(row => JSON.stringify(row)).sort();
    return createHash('sha256').update(JSON.stringify([sort(itemKeys), sort(triggerKeys)])).digest('hex');
}

function buildSnapshot(
    owner: SentinelTodoOwner,
    run: CodaRunRecord,
    items: readonly SentinelTodoItemView[],
    awaiting: readonly SentinelTodoItemView[],
    triggers: readonly Trigger[],
) {
    return {
        runId: run.id,
        ledger: owner,
        createdAt: run.createdAt,
        items: items.map(item => ({
            id: item.id, revision: item.revision, type: item.type, title: item.title,
            completionCondition: item.completionCondition, notes: item.notes, targetRepo: item.targetRepo,
            status: item.status, statusReason: item.statusReason, outcome: item.outcome,
            createdAt: item.createdAt, updatedAt: item.updatedAt, userEditedAt: item.userEditedAt,
            userVerdictRevision: item.userVerdictRevision,
            // Reviewed results and spec milestones are read-only evidence.
            jobs: item.jobs, references: item.references,
            prTriggers: triggers.filter(trigger => trigger.binding?.itemId === item.id)
                .map(trigger => ({ id: trigger.id, status: trigger.status, event: trigger.event })),
        })),
        deferredItemIds: run.deferredItemIds,
        awaitingSentinelReview: awaiting.map(item => ({ id: item.id, title: item.title })),
    };
}

function buildChildTask(owner: SentinelTodoOwner, run: CodaRunRecord, snapshotPath: string, taskId: string): CreateTaskInput {
    const context: CodaChildContext = { workspaceId: owner.workspaceId, processId: owner.processId, runId: run.id };
    return {
        id: taskId,
        type: 'chat',
        priority: 'low',
        repoId: owner.workspaceId,
        payload: {
            kind: 'chat',
            mode: 'ask',
            prompt: buildCodaPrompt(run, snapshotPath),
            workspaceId: owner.workspaceId,
            context: { sentinelScrub: context },
        },
        // Pin only reasoning effort; keep provider/model routing workspace-owned.
        config: { reasoningEffort: 'medium' },
        displayName: `[Coda] ${run.snapshot.length} to-do${run.snapshot.length === 1 ? '' : 's'}`,
    };
}

export function buildCodaPrompt(run: CodaRunRecord, snapshotPath: string): string {
    return [
        `You are Coda, this Sentinel's built-in to-do review (run ${run.id}). Check whether each open to-do in the snapshot is still accurate, using live evidence.`,
        '',
        `Snapshot (read it first): ${snapshotPath}`,
        '',
        'Rules:',
        '- This chat is read-only. Never edit files, run write commands, or message other chats. The server applies results; you only report them.',
        '- For each item, check its linked jobs, references, PRs and commits in its target repo (use `gh`/`git` read-only commands).',
        '- Verdicts: `done` (completion condition met), `obsolete` (no longer needed or superseded), `in_progress`, `deferred` (intentionally postponed, still open), `needs_attention`, `unchanged` (status still right), `unverified` (evidence could not be checked: give `unverifiedReason`).',
        '- ' + SENTINEL_COMPLETION_GUIDANCE,
        '- If closure is uncertain, report `unchanged` with the gap for the parent to ask the user; never auto-apply.',
        '- Never guess. If gh auth fails, a remote server is offline or a repo is missing, use `unverified`.',
        '- Every verdict except `unchanged`/`unverified` needs at least one evidence entry, each with `checkedAt` set to when you checked it.',
        '- Preserve Deferred items as postponed. Never auto-apply a status change to them; propose changes for the user instead. This status is separate from items deferred from a run due to active execution.',
        '- Set `autoApply: true` only on `done` with `confidence: "high"`: a merged PR or a commit on the default branch clearly tied to the item, and its completion condition met. A successful job with no landed artifact, or a commit found only by search, is usually medium.',
        '- Jobs listed as awaiting Sentinel review are not in the snapshot; do not assess them.',
        `- When done, call \`${SUBMIT_CODA_FINDINGS_TOOL_NAME}\` exactly once with runId "${run.id}" and one finding per item. Later calls are rejected.`,
    ].join('\n');
}

function ownerOf(context: CodaChildContext): SentinelTodoOwner {
    return { workspaceId: context.workspaceId, processId: context.processId };
}

function timerKey(owner: SentinelTodoOwner, runId: string): string {
    return `${owner.workspaceId}\u0000${owner.processId}\u0000${runId}`;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
}
