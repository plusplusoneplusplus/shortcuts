import { isQueueProcessId, toTaskId, type ProcessStore, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import { normalizeChatMode } from '../tasks/task-types';
import {
    SentinelTodoError,
    type SentinelTodoActor,
    type SentinelTodoCreate,
    type SentinelTodoItem,
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
        onChange?: (change: SentinelTodoChange) => void;
    }) {}

    async list(owner: SentinelTodoOwner): Promise<SentinelTodoLedger> {
        await this.assertOwner(owner);
        return this.deps.todos.get(owner);
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
