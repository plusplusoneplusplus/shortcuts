import { isQueueProcessId, toTaskId, type ProcessStore, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { DelegatedJob, DelegatedJobStore } from '../delegation/delegated-job-store';
import { normalizeChatMode } from '../tasks/task-types';
import {
    SentinelTodoError,
    type SentinelTodoActor,
    type SentinelTodoCreate,
    type SentinelTodoItem,
    type SentinelTodoJobLink,
    type SentinelTodoJobLinkInput,
    type SentinelTodoLedger,
    type SentinelTodoOwner,
    type SentinelTodoPatch,
    type SentinelTodoStore,
} from './sentinel-todo-store';

export interface SentinelTodoChange {
    owner: SentinelTodoOwner;
    ledgerRevision: number;
    item: SentinelTodoItem;
}

/**
 * A linked job's execution state, derived on read and kept apart from the
 * item's fulfillment status. Remote jobs are `unavailable`: their results
 * never return here, so only an explicit reviewed outcome settles them.
 */
export type SentinelTodoJobExecution =
    | { state: 'queued' | 'running' | 'unknown' | 'unavailable' }
    | {
        state: 'completed' | 'failed' | 'cancelled' | 'capped';
        reason?: string;
        /** Delivery of the result review to this chat (not a fulfillment verdict). */
        review?: { state: 'pending' | 'queued' | 'delivered' | 'failed'; reason?: string };
    };
export type SentinelTodoJobLinkView = SentinelTodoJobLink & { execution: SentinelTodoJobExecution };
export type SentinelTodoItemView = Omit<SentinelTodoItem, 'jobs'> & { jobs: SentinelTodoJobLinkView[] };
export type SentinelTodoLedgerView = { revision: number; items: SentinelTodoItemView[] };

/**
 * The one command surface for Sentinel to-do bookkeeping, shared by REST and
 * the AI tools. Every call proves the owner is a Sentinel chat of the given
 * parent workspace before touching the ledger, and change events fire only
 * after the write committed. Nothing here starts, retries, or cancels a job.
 */
export class SentinelTodoService {
    constructor(private readonly deps: {
        todos: SentinelTodoStore;
        store: Pick<ProcessStore, 'getProcess'>;
        /** A Sentinel's first turn can still be queued, before its process exists. */
        getTask?: TaskQueueManager['getTask'];
        /** Delegation receipts, read only to show linked jobs' execution status. */
        jobs?: Pick<DelegatedJobStore, 'list'>;
        onChange?: (change: SentinelTodoChange) => void;
    }) {}

    async list(owner: SentinelTodoOwner): Promise<SentinelTodoLedgerView> {
        await this.assertOwner(owner);
        const ledger: SentinelTodoLedger = this.deps.todos.get(owner);
        let delegated: DelegatedJob[] = [];
        if (ledger.items.some(item => item.jobs.some(job => !job.serverId))) {
            try { delegated = this.deps.jobs?.list(owner.workspaceId) ?? []; }
            catch { /* Execution status degrades to the recorded link result. */ }
        }
        return {
            revision: ledger.revision,
            items: ledger.items.map(item => ({
                ...item,
                jobs: item.jobs.map(link => ({ ...link, execution: this.execution(link, owner, delegated) })),
            })),
        };
    }

    /** Links an admitted job to the invoking Sentinel's item; never launches anything. */
    async linkJob(
        owner: SentinelTodoOwner,
        itemId: string,
        link: SentinelTodoJobLinkInput,
    ): Promise<{ item: SentinelTodoItem; ledgerRevision: number }> {
        await this.assertOwner(owner);
        const result = this.deps.todos.linkJob(owner, itemId, link);
        if (result.changed) this.emit({ owner, item: result.item, ledgerRevision: result.ledgerRevision });
        return { item: result.item, ledgerRevision: result.ledgerRevision };
    }

    /**
     * Records a server-observed terminal result of a registered delegation on
     * the item that links it. The owner comes from the server-authored
     * delegation receipt, never from child output.
     */
    recordJobResult(job: DelegatedJob): SentinelTodoItem | undefined {
        const terminal = job.terminal?.result;
        if (!terminal || job.child.serverId) return undefined;
        const owner = { workspaceId: job.parent.workspaceId, processId: job.parent.processId };
        const result = this.deps.todos.recordJobResult(owner, job.id, {
            terminalEventId: terminal.terminalEventId,
            outcome: terminal.outcome,
            ...(terminal.reason ? { reason: terminal.reason.slice(0, 2_000) } : {}),
        }, link => `Job ${JSON.stringify(link.title ?? job.title)} ${terminal.outcome}`
            + (terminal.reason ? `: ${terminal.reason}` : '.'));
        if (result) this.emit({ owner, ...result });
        return result?.item;
    }

    /** The item linking a local delegated job, for its parent review prompt. */
    findLinkedItem(job: DelegatedJob): SentinelTodoItem | undefined {
        return this.deps.todos.get(job.parent).items
            .find(item => item.jobs.some(link => link.processId === job.id && !link.serverId));
    }

    private execution(link: SentinelTodoJobLink, owner: SentinelTodoOwner, delegated: DelegatedJob[]): SentinelTodoJobExecution {
        if (link.serverId) return { state: 'unavailable' };
        const terminal = delegated.find(job => job.id === link.processId
            && job.parent.processId === owner.processId)?.terminal;
        if (terminal) {
            const delivery = terminal.delivery;
            return {
                state: terminal.result.outcome,
                ...(terminal.result.reason ? { reason: terminal.result.reason } : {}),
                review: { state: delivery.state, ...(delivery.state === 'failed' ? { reason: delivery.reason } : {}) },
            };
        }
        if (link.result) {
            return { state: link.result.outcome, ...(link.result.reason ? { reason: link.result.reason } : {}) };
        }
        // A Ralph session spans many queue tasks; only its whole-session result settles it.
        if (link.kind === 'ralph') return { state: 'running' };
        const task = isQueueProcessId(link.processId) ? this.deps.getTask?.(toTaskId(link.processId)) : undefined;
        if (task?.status === 'queued' || task?.status === 'running') return { state: task.status };
        return { state: 'unknown' };
    }

    async create(
        owner: SentinelTodoOwner,
        input: SentinelTodoCreate,
        opts: { actor: SentinelTodoActor; idempotencyKey?: string },
    ): Promise<{ item: SentinelTodoItem; created: boolean; ledgerRevision: number }> {
        await this.assertOwner(owner);
        const result = this.deps.todos.create(owner, input, opts);
        if (result.created) this.emit({ owner, ledgerRevision: result.ledgerRevision, item: result.item });
        return result;
    }

    async update(
        owner: SentinelTodoOwner,
        itemId: string,
        expectedRevision: number,
        patch: SentinelTodoPatch,
        actor: SentinelTodoActor,
    ): Promise<{ item: SentinelTodoItem; ledgerRevision: number }> {
        await this.assertOwner(owner);
        const result = this.deps.todos.update(owner, itemId, expectedRevision, patch, actor);
        this.emit({ owner, ...result });
        return result;
    }

    private emit(change: SentinelTodoChange): void {
        try {
            this.deps.onChange?.(change);
        } catch {
            // The write already committed; a failed notification must not report failure.
        }
    }

    private async assertOwner(owner: SentinelTodoOwner): Promise<void> {
        const process = await this.deps.store.getProcess(owner.processId);
        const task = !process && isQueueProcessId(owner.processId)
            ? this.deps.getTask?.(toTaskId(owner.processId)) : undefined;
        const live = task?.type === 'chat' && (task.status === 'queued' || task.status === 'running') ? task : undefined;
        const mode = process ? process.metadata?.mode : (live?.payload as { mode?: unknown } | undefined)?.mode;
        const workspaceId = process ? process.metadata?.workspaceId : live?.repoId;
        if (normalizeChatMode(mode) !== 'sentinel' || workspaceId !== owner.workspaceId) {
            throw new SentinelTodoError('not_found', 'Sentinel chat not found in this workspace');
        }
    }
}
