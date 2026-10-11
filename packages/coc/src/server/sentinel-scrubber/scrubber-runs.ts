import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { toQueueProcessId, toTaskId, type CreateTaskInput, type QueuedTask } from '@plusplusoneplusplus/forge';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import type { SentinelTodoItemView, SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import type { SentinelTodoOwner } from '../sentinel-todos/sentinel-todo-store';
import type { Trigger } from '../triggers/trigger-types';
import type { ScrubberEngine } from './scrubber-engine';
import { MAX_SCRUB_ITEMS, SCRUB_TIMEOUT_MS, scrubFindingInputSchema, type ScrubFindingInput } from './scrubber-model';
import { ScrubberStoreError, type ScrubberStore, type ScrubRunRecord, type ScrubTrigger } from './scrubber-store';

export const SUBMIT_SCRUB_FINDINGS_TOOL_NAME = 'submit_scrub_findings';

/** Carried on the child chat's task payload (`context.sentinelScrub`). */
export interface ScrubChildContext {
    workspaceId: string;
    /** The Sentinel chat that owns the ledger. */
    processId: string;
    runId: string;
}

export function getScrubChildContext(payload: unknown): ScrubChildContext | undefined {
    const value = (payload as { context?: { sentinelScrub?: Partial<ScrubChildContext> } } | undefined)?.context?.sentinelScrub;
    return value && typeof value.workspaceId === 'string' && typeof value.processId === 'string' && typeof value.runId === 'string'
        ? { workspaceId: value.workspaceId, processId: value.processId, runId: value.runId } : undefined;
}

/** Queue events the run service follows, with the registry's `(repoPath, task, …)` signature. */
export interface ScrubQueueEvents {
    on(event: 'taskCompleted' | 'taskFailed' | 'taskCancelled', listener: (repoPath: string, task: QueuedTask, detail?: unknown) => void): unknown;
}

export interface ScrubberRunServiceDeps {
    dataDir: string;
    todos: Pick<SentinelTodoService, 'list'>;
    scrubber: ScrubberStore;
    engine: Pick<ScrubberEngine, 'complete'>;
    /** Admits the child chat to the owner's workspace queue; returns the task id. */
    enqueue: (input: CreateTaskInput) => Promise<string>;
    cancelTask: (taskId: string) => boolean | Promise<boolean>;
    /** Armed PR rules feed the skip-if-unchanged fingerprint and the snapshot. */
    listTriggers?: (owner: SentinelTodoOwner) => Promise<Trigger[]>;
    /** Fired after any run change; `ledgerChanged` when findings were applied. */
    onChange?: (owner: SentinelTodoOwner, change: { runId: string; ledgerChanged?: boolean }) => void;
    now?: () => Date;
    timeoutMs?: number;
}

const OPEN_STATUSES = new Set(['todo', 'in_progress', 'needs_attention']);
const findingsSchema = z.array(scrubFindingInputSchema).max(MAX_SCRUB_ITEMS);

/**
 * Starts, follows and settles scrubber runs. A run is one queued, read-only
 * ask chat in the owner's workspace; its only output is one
 * `submit_scrub_findings` call, applied when the chat finishes. Cancel,
 * failure and timeout apply nothing.
 */
export class ScrubberRunService {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private readonly deps: ScrubberRunServiceDeps) {}

    attach(queue: ScrubQueueEvents): void {
        const follow = (outcome: 'completed' | 'failed' | 'cancelled') => (_repo: string, task: QueuedTask, detail?: unknown) => {
            void this.handleTaskTerminal(task, outcome, detail).catch(error =>
                console.error('[sentinel-scrubber] Could not settle a run:', error));
        };
        queue.on('taskCompleted', follow('completed'));
        queue.on('taskFailed', follow('failed'));
        queue.on('taskCancelled', follow('cancelled'));
    }

    /**
     * Starts a run over the open items (or the selected open ones). Scheduled
     * ticks never queue behind an active run or re-check an unchanged ledger:
     * they are recorded as `skipped` instead.
     */
    async start(owner: SentinelTodoOwner, opts: { trigger: ScrubTrigger; itemIds?: string[] }): Promise<ScrubRunRecord> {
        const ledger = await this.deps.todos.list(owner);
        const triggers = await this.listArmedTriggers(owner);
        let open = ledger.items.filter(item => OPEN_STATUSES.has(item.status) && !item.archived);
        if (opts.itemIds) {
            const selected = new Set(opts.itemIds);
            open = open.filter(item => selected.has(item.id));
            if (!open.length) throw new ScrubberStoreError('invalid', 'None of the selected items are open');
        }
        const awaiting = open.filter(awaitingReview);
        const eligible = open.filter(item => !awaitingReview(item))
            .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        const included = eligible.slice(0, MAX_SCRUB_ITEMS);
        const inputFingerprint = fingerprintInput(open, triggers);
        const base: ScrubRunRecord = {
            id: randomUUID(), trigger: opts.trigger, status: 'queued', createdAt: this.now().toISOString(),
            ...(opts.itemIds ? { selectedItemIds: open.map(item => item.id) } : {}),
            snapshot: included.map(item => ({ itemId: item.id, revision: item.revision })),
            deferredItemIds: eligible.slice(MAX_SCRUB_ITEMS).map(item => item.id),
            awaitingReviewItemIds: awaiting.map(item => item.id),
            inputFingerprint,
        };
        if (opts.trigger === 'schedule') {
            const skipReason = this.deps.scrubber.activeRun(owner) ? 'overlap'
                : this.deps.scrubber.getConfig(owner).lastInputFingerprint === inputFingerprint ? 'unchanged' : undefined;
            if (skipReason) return this.record(owner, { ...base, status: 'skipped', skipReason, finishedAt: base.createdAt });
        }
        if (!included.length) {
            // Nothing to assess is a finished run, not a chat.
            return this.record(owner, { ...base, status: 'completed', startedAt: base.createdAt, finishedAt: base.createdAt });
        }

        const run = this.deps.scrubber.createRun(owner, base);
        const snapshotPath = this.snapshotPath(owner, run.id);
        try {
            await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
            await fs.writeFile(snapshotPath, JSON.stringify(buildSnapshot(owner, run, included, awaiting, triggers), null, 2));
            const taskId = await this.deps.enqueue(buildChildTask(owner, run, snapshotPath));
            const linked = this.deps.scrubber.transitionRun(owner, run.id, ['queued'], { childProcessId: toQueueProcessId(taskId) });
            this.changed(owner, run.id);
            return linked ?? this.deps.scrubber.getRun(owner, run.id)!;
        } catch (error) {
            const failed = this.deps.scrubber.transitionRun(owner, run.id, ['queued'], {
                status: 'failed', finishedAt: this.now().toISOString(), error: `Could not start the scrub: ${message(error)}`,
            });
            this.finish(owner, run.id);
            if (failed) return failed;
            throw error;
        }
    }

    /** The child chat's first turn began: the run is live and the timeout starts. */
    markRunning(context: ScrubChildContext): ScrubRunRecord | undefined {
        const owner = ownerOf(context);
        const run = this.deps.scrubber.transitionRun(owner, context.runId, ['queued'],
            { status: 'running', startedAt: this.now().toISOString() });
        if (!run) return this.deps.scrubber.getRun(owner, context.runId);
        const timer = setTimeout(() => void this.timeOut(owner, run.id), this.deps.timeoutMs ?? SCRUB_TIMEOUT_MS);
        timer.unref?.();
        this.timers.set(timerKey(owner, run.id), timer);
        this.changed(owner, run.id);
        return run;
    }

    /**
     * Accepts the run's one findings batch. It is held until the chat
     * finishes; a cancel or timeout before then discards it.
     */
    submit(context: ScrubChildContext, input: unknown): { accepted: number; ignoredItemIds: string[] } {
        const owner = ownerOf(context);
        const parsed = findingsSchema.safeParse(input);
        if (!parsed.success) throw new ScrubberStoreError('invalid', z.prettifyError(parsed.error));
        return this.deps.scrubber.transaction(() => {
            const run = this.deps.scrubber.getRun(owner, context.runId);
            if (!run || run.status !== 'running') throw new ScrubberStoreError('conflict', 'This scrub run is no longer active');
            if (run.findingsSubmittedAt) throw new ScrubberStoreError('conflict', 'Findings were already submitted for this run');
            const snapshot = new Set(run.snapshot.map(entry => entry.itemId));
            const seen = new Set<string>();
            const accepted: ScrubFindingInput[] = [];
            const ignoredItemIds: string[] = [];
            for (const finding of parsed.data) {
                if (!snapshot.has(finding.itemId) || seen.has(finding.itemId)) ignoredItemIds.push(finding.itemId);
                else { seen.add(finding.itemId); accepted.push(finding); }
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
    async cancel(owner: SentinelTodoOwner, runId: string): Promise<ScrubRunRecord> {
        const run = this.deps.scrubber.transitionRun(owner, runId, ['queued', 'running'],
            { status: 'cancelled', finishedAt: this.now().toISOString() });
        if (!run) {
            const current = this.deps.scrubber.getRun(owner, runId);
            if (!current) throw new ScrubberStoreError('not_found', 'Scrub run not found');
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
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
    }

    /** Settles a run from its child chat's terminal queue event. */
    async handleTaskTerminal(task: QueuedTask, outcome: 'completed' | 'failed' | 'cancelled', detail?: unknown): Promise<void> {
        const context = getScrubChildContext(task.payload);
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
                : outcome === 'failed' ? `The scrub chat failed: ${message(detail)}`
                    : 'The scrub chat ended without submitting findings';
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
        const minutes = Math.round((this.deps.timeoutMs ?? SCRUB_TIMEOUT_MS) / 60_000);
        const run = this.deps.scrubber.transitionRun(owner, runId, ['running'], {
            status: 'timed_out', finishedAt: this.now().toISOString(), error: `The scrub did not finish within ${minutes} min`,
        });
        if (!run) return;
        await this.stopChild(run);
        this.finish(owner, runId);
    }

    private async stopChild(run: ScrubRunRecord): Promise<void> {
        if (!run.childProcessId) return;
        try { await this.deps.cancelTask(toTaskId(run.childProcessId)); }
        catch (error) { console.error('[sentinel-scrubber] Could not cancel the scrub chat:', error); }
    }

    private record(owner: SentinelTodoOwner, run: ScrubRunRecord): ScrubRunRecord {
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

/** Identity of what a scheduled tick would check; equal means nothing new to scrub. */
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
    run: ScrubRunRecord,
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

function buildChildTask(owner: SentinelTodoOwner, run: ScrubRunRecord, snapshotPath: string): CreateTaskInput {
    const context: ScrubChildContext = { workspaceId: owner.workspaceId, processId: owner.processId, runId: run.id };
    return {
        type: 'chat',
        priority: 'low',
        repoId: owner.workspaceId,
        payload: {
            kind: 'chat',
            mode: 'ask',
            prompt: buildScrubPrompt(run, snapshotPath),
            workspaceId: owner.workspaceId,
            context: { sentinelScrub: context },
        },
        config: {},
        displayName: `[Scrubber] ${run.snapshot.length} to-do${run.snapshot.length === 1 ? '' : 's'}`,
    };
}

export function buildScrubPrompt(run: ScrubRunRecord, snapshotPath: string): string {
    return [
        `You are the Sentinel To-do Scrubber (run ${run.id}). Check whether each open to-do in the snapshot is still accurate, using live evidence.`,
        '',
        `Snapshot (read it first): ${snapshotPath}`,
        '',
        'Rules:',
        '- This chat is read-only. Never edit files, run write commands, or message other chats. The server applies results; you only report them.',
        '- For each item, check its linked jobs, references, PRs and commits in its target repo (use `gh`/`git` read-only commands).',
        '- Verdicts: `done` (completion condition met), `obsolete` (no longer needed or superseded), `in_progress`, `needs_attention`, `unchanged` (status still right), `unverified` (evidence could not be checked: give `unverifiedReason`).',
        '- Never guess. If gh auth fails, a remote server is offline or a repo is missing, use `unverified`.',
        '- Every verdict except `unchanged`/`unverified` needs at least one evidence entry, each with `checkedAt` set to when you checked it.',
        '- Set `autoApply: true` only on `done` with `confidence: "high"`: a merged PR or a commit on the default branch clearly tied to the item, and its completion condition met. A successful job with no landed artifact, or a commit found only by search, is usually medium.',
        '- Jobs listed as awaiting Sentinel review are not in the snapshot; do not assess them.',
        `- When done, call \`${SUBMIT_SCRUB_FINDINGS_TOOL_NAME}\` exactly once with runId "${run.id}" and one finding per item. Later calls are rejected.`,
    ].join('\n');
}

function ownerOf(context: ScrubChildContext): SentinelTodoOwner {
    return { workspaceId: context.workspaceId, processId: context.processId };
}

function timerKey(owner: SentinelTodoOwner, runId: string): string {
    return `${owner.workspaceId}\u0000${owner.processId}\u0000${runId}`;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
}
