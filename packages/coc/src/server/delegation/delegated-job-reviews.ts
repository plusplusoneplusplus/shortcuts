import { createHash } from 'node:crypto';
import { toQueueProcessId, type ProcessStore, type QueuedTask, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { buildDashboardChatReference } from '../shared/chat-reference';
import { onTaskTerminal } from '../messaging/chat-target';
import type { MessagingJobNotices } from '../messaging/job-notices';
import { findRequestAnswer, findRequestTurn, RELAY_ANSWER_TEXT, isTerminalStatus } from '../messaging/relay-answer';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import {
    emitDeliveryEvents, ProcessMessageDeliveryService, ReviewDeliveryRejectedError,
} from '../processes/process-message-delivery-service';
import { DelegatedJobStore, grillingResultJob, type DelegatedJob, type DelegatedJobDelivery } from './delegated-job-store';
import { normalizeChatMode } from '../tasks/task-types';
import { SENTINEL_JOB_REVIEW_INSTRUCTIONS, SENTINEL_JOB_REVIEW_PREFIX } from './sentinel-job-review-instructions';

export function delegatedReviewReceipt(job: DelegatedJob): string {
    const identity = [job.parent.workspaceId, job.parent.processId, job.id,
        job.child.workspaceId, job.child.processId, job.child.serverId, job.child.sessionId,
        job.terminal?.result.terminalEventId];
    return `delegated-review-${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

/** The Sentinel to-do item a delegated job serves, quoted as data in its review. */
export interface DelegatedReviewTodo {
    id: string;
    revision: number;
    title: string;
    completionCondition: string;
    status: string;
}

function reviewPrompt(job: DelegatedJob, sentinel: boolean, serverIdentity: string, repository?: WorkspaceInfo, todo?: DelegatedReviewTodo): string {
    return `${sentinel ? '' : `${SENTINEL_JOB_REVIEW_INSTRUCTIONS}\n\n`}${job.boundary === 'grill' ? 'This is the grilling milestone only. A validated goal is spec ready, awaiting explicit user implementation approval. Return pending feature work to Todo; only explicitly design-only work may finish. Do not start execution or mark implementation Done. Failed/cancelled grilling is not execution completion.\n' : ''}${SENTINEL_JOB_REVIEW_PREFIX}
${JSON.stringify({
        parent: job.parent, child: job.child, jobId: job.id, title: job.title,
        repository: { workspaceId: job.child.workspaceId, name: repository?.name, rootPath: repository?.rootPath },
        ...job.terminal!.result,
        links: [...new Set([buildDashboardChatReference(serverIdentity, job.child.workspaceId, job.child.processId),
            ...job.terminal!.result.links.filter(link => !/^(#\/process\/|#repos\/|\/api\/workspaces\/[^/]+\/ralph-sessions\/)/.test(link))])].slice(0, 20),
        ...(todo ? { todo } : {}),
    })}`;
}

/** Durable result delivery: AI reviews for outcomes, display-only notices for cancellation. */
export class DelegatedJobReviews {
    private readonly inFlight = new Map<string, Promise<void>>();
    private readonly unsubscribe: () => void;
    private disposed = false;

    constructor(private readonly deps: {
        jobs: DelegatedJobStore;
        store: ProcessStore;
        delivery: Pick<ProcessMessageDeliveryService, 'deliverOnce' | 'deliverNoticeOnce'>;
        queue: ScheduleQueueEventBus;
        queueMessagingResult?: MessagingJobNotices['queueResult'];
        reconcileMessagingNotices?: () => Promise<void>;
        recoverPendingMessages?: (workspaceId: string, processId: string) => Promise<void>;
        /** The linked Sentinel to-do item, when to-do tracking is enabled. */
        findTodo?: (job: DelegatedJob) => DelegatedReviewTodo | undefined;
        onDeliveryChange?: (job: DelegatedJob) => void;
    }) {
        this.unsubscribe = onTaskTerminal(deps.queue, task => {
            void this.settleTask({ ...task, payload: { ...task.payload } }).then(() => this.reconcileNotices()).catch(error =>
                console.error('[delegated-job-reviews] Could not settle review:', error));
        });
    }

    dispose(): void {
        this.disposed = true;
        this.unsubscribe();
    }

    /** Called for newly recorded results and registered terminal rows during startup. */
    schedule(job: DelegatedJob): Promise<void> {
        if (this.disposed || !job.terminal || job.child.serverId
            || (job.child.sessionId && job.terminal.result.terminalEventId !== `ralph:${job.child.workspaceId}:${job.child.sessionId}:${job.boundary === 'grill' ? 'grill' : 'terminal'}`)
            || !['pending', 'queued'].includes(job.terminal.delivery.state)) return Promise.resolve();
        const receiptId = delegatedReviewReceipt(job);
        const existing = this.inFlight.get(receiptId);
        if (existing) return existing;
        const work = this.admit(job, receiptId).finally(async () => {
            this.inFlight.delete(receiptId);
            await this.reconcileNotices();
        });
        this.inFlight.set(receiptId, work);
        return work;
    }

    private async reconcileNotices(): Promise<void> {
        try { await this.deps.reconcileMessagingNotices?.(); }
        catch (error) { console.error('[delegated-job-reviews] Could not reconcile direct notices:', error); }
    }

    private async admit(job: DelegatedJob, receiptId: string): Promise<void> {
        try {
            const repository = (await this.deps.store.getWorkspaces()).find(workspace => workspace.id === job.child.workspaceId);
            if (this.disposed) return;
            if (job.terminal!.result.outcome === 'cancelled') {
                // Fixed server wording, never partial child output or suggested work.
                const text = `Delegated job ${JSON.stringify(job.title)} in ${JSON.stringify(repository?.name ?? job.child.workspaceId)} was cancelled.`;
                const delivered = await this.deps.delivery.deliverNoticeOnce(
                    job.parent.workspaceId, job.parent.processId, receiptId, text,
                );
                if (delivered === 'delivered') {
                    this.queueMessagingResult(job, receiptId, text, 'cancelled', repository);
                    this.updateDelivery(job, 'pending', { state: 'queued', receiptId });
                    this.updateDelivery(job, 'queued', { state: 'delivered', receiptId });
                }
                return;
            }
            const parent = await this.deps.store.getProcess(job.parent.processId, job.parent.workspaceId);
            const sentinel = parent?.metadata?.workspaceId === job.parent.workspaceId
                && normalizeChatMode(parent.metadata.mode) === 'sentinel';
            const content = reviewPrompt(job, sentinel, this.deps.jobs.serverIdentity, repository, this.findTodo(job));
            const result = await this.deps.delivery.deliverOnce(
                job.parent.workspaceId, job.parent.processId, receiptId,
                { content, displayContent: content },
            );
            // Reused receipts carry no intents, even when the ledger acknowledgement failed.
            emitDeliveryEvents(this.deps.store, job.parent.processId, result.events);
            this.updateDelivery(job, 'pending', { state: 'queued', receiptId });
            if (result.path === 'buffered') {
                await this.deps.recoverPendingMessages?.(job.parent.workspaceId, job.parent.processId);
            }
            const task = this.deps.queue.getTask(receiptId);
            if (task && isTerminalStatus(task.status)) await this.settle(job, task, receiptId);
        } catch (error) {
            if (!(error instanceof ReviewDeliveryRejectedError)) throw error;
            this.updateDelivery(job, job.terminal!.delivery.state,
                { state: 'failed', reason: error.message.slice(0, 2_000) });
        }
    }

    private findTodo(job: DelegatedJob): DelegatedReviewTodo | undefined {
        try { return this.deps.findTodo?.(job); }
        catch (error) {
            // Bookkeeping must never block result delivery.
            console.error('[delegated-job-reviews] Could not read the linked to-do item:', error);
            return undefined;
        }
    }

    private updateDelivery(job: DelegatedJob, expected: DelegatedJobDelivery['state'], next: DelegatedJobDelivery): void {
        if (!this.deps.jobs.updateDelivery(job.parent.workspaceId, job.id, expected, next, job.boundary)) return;
        try { this.deps.onDeliveryChange?.(job); }
        catch (error) { console.error('[delegated-job-reviews] Could not notify review delivery:', error); }
    }

    private async settle(job: DelegatedJob, task: QueuedTask, receiptId: string): Promise<void> {
        if (task.type !== 'chat' || task.processId !== job.parent.processId
            || task.payload.processId !== job.parent.processId
            || task.payload.workspaceId !== job.parent.workspaceId
            || task.payload.relayRequestId !== receiptId) return;
        if (task.status === 'completed' && job.messagingOrigin && this.deps.queueMessagingResult) {
            const parent = await this.deps.store.getProcess(job.parent.processId, job.parent.workspaceId);
            if (!parent || parent.metadata?.workspaceId !== job.parent.workspaceId) {
                this.updateDelivery(job, 'queued',
                    { state: 'failed', reason: 'Parent unavailable when returning the review answer.' });
                return;
            }
            const turns = parent.conversationTurns ?? [];
            const start = findRequestTurn(turns, receiptId);
            const answer = start >= 0 ? findRequestAnswer(turns, start).answer : undefined;
            const repository = (await this.deps.store.getWorkspaces()).find(ws => ws.id === job.child.workspaceId);
            this.queueMessagingResult(job, receiptId, answer?.content?.trim() || RELAY_ANSWER_TEXT.empty,
                job.terminal?.result.outcome === 'failed' ? 'failed' : 'completed', repository);
        }
        this.updateDelivery(job, 'queued', task.status === 'completed'
            ? { state: 'delivered', receiptId }
            : { state: 'failed', reason: `Parent result review ${task.status}.` });
    }

    private queueMessagingResult(job: DelegatedJob, receiptId: string, body: string,
        status: 'completed' | 'failed' | 'cancelled', repository?: WorkspaceInfo): void {
        if (!job.messagingOrigin) return;
        this.deps.queueMessagingResult?.({
            workspaceId: job.parent.workspaceId, processId: job.parent.processId,
            origin: job.messagingOrigin, receiptId, body, status,
            repo: repository?.name ?? job.child.workspaceId, title: job.title,
        });
    }

    private async settleTask(task: QueuedTask): Promise<void> {
        if (this.disposed || !isTerminalStatus(task.status)) return;
        const workspaceId = task.payload.workspaceId ?? task.repoId;
        if (typeof workspaceId !== 'string') return;
        const rows = this.deps.jobs.list(workspaceId).flatMap(job => [job, ...(grillingResultJob(job) ? [grillingResultJob(job)!] : [])]);
        const processId = task.processId ?? toQueueProcessId(task.id);
        for (const row of rows) {
            if (row.parent.processId === processId && row.terminal?.result.outcome === 'cancelled') {
                try {
                    // A parent terminal event can race an admission that just deferred.
                    await this.inFlight.get(delegatedReviewReceipt(row))?.catch(() => {});
                    const current = this.deps.jobs.list(workspaceId).find(job => job.id === row.id);
                    if (current) await this.schedule(row.boundary === 'grill' ? grillingResultJob(current)! : current);
                }
                catch (error) { console.error('[delegated-job-reviews] Could not deliver cancellation:', error); }
            }
        }
        if (!task.payload.relayRequestId) return;
        const job = rows.find(row => row.terminal?.delivery.state === 'queued'
            && row.terminal.delivery.receiptId === task.id);
        if (job) await this.settle(job, task, task.id);
    }
}
