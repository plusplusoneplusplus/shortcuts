import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { FileForEachRunStore } from './for-each-run-store';
import type { ClaimedForEachItem, ForEachItem, ForEachRun } from './types';
import type { CancelRunChildTask, EnqueueRunChildTask } from '../shared/run-executor-base';
import { buildChatChildTask, RunExecutorBase } from '../shared/run-executor-base';

export type EnqueueForEachChildTask = EnqueueRunChildTask;
export type CancelForEachChildTask = CancelRunChildTask;

export interface ForEachRunExecutorOptions {
    store: FileForEachRunStore;
    enqueueChildTask: EnqueueForEachChildTask;
    cancelChildTask?: CancelForEachChildTask;
}

function jsonBlock(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

export function buildForEachChildPrompt(run: ForEachRun, item: ForEachItem): string {
    const runMetadata = {
        runId: run.runId,
        workspaceId: run.workspaceId,
        childMode: run.childMode,
        originalRequest: run.originalRequest,
    };
    const itemMetadata = {
        id: item.id,
        title: item.title,
        dependsOn: item.dependsOn ?? [],
        metadata: item.metadata ?? {},
    };
    const parts = [
        'You are executing one child item from a CoC For Each run.',
        'Focus only on this item. Do not use sibling item results, parent progress journals, Ralph session state, timers, wakeups, or workflow DAG context.',
        `Immutable run metadata:\n${jsonBlock(runMetadata)}`,
        `Immutable item metadata:\n${jsonBlock(itemMetadata)}`,
    ];
    if (run.sharedInstructions?.trim()) {
        parts.push(`Shared instructions for every item:\n${run.sharedInstructions.trim()}`);
    }
    parts.push(`Item task prompt:\n${item.prompt}`);
    return parts.join('\n\n');
}

function buildChildTask(run: ForEachRun, item: ForEachItem): CreateTaskInput {
    return buildChatChildTask({
        run,
        prompt: buildForEachChildPrompt(run, item),
        contextKey: 'forEach',
        contextValue: {
            workspaceId: run.workspaceId,
            runId: run.runId,
            itemId: item.id,
            childMode: run.childMode,
        },
        groupType: 'for-each',
        role: 'item',
        itemKey: item.id,
        displayName: `[For Each] ${item.title}`,
    });
}

function getForEachContext(task: QueuedTask): { workspaceId: string; runId: string; itemId: string } | undefined {
    const context = (task.payload as { context?: { forEach?: unknown } } | undefined)?.context?.forEach;
    if (!context || typeof context !== 'object') return undefined;
    const record = context as Record<string, unknown>;
    if (typeof record.workspaceId !== 'string' || typeof record.runId !== 'string' || typeof record.itemId !== 'string') {
        return undefined;
    }
    return {
        workspaceId: record.workspaceId,
        runId: record.runId,
        itemId: record.itemId,
    };
}

export class ForEachRunExecutor extends RunExecutorBase<ForEachRun> {
    protected readonly logLabel = 'ForEach';
    private readonly store: FileForEachRunStore;

    constructor(options: ForEachRunExecutorOptions) {
        super({ enqueueChildTask: options.enqueueChildTask, cancelChildTask: options.cancelChildTask });
        this.store = options.store;
    }

    async startOrContinueRun(workspaceId: string, runId: string): Promise<ForEachRun> {
        const claimed = await this.store.claimNextRunnableItem(workspaceId, runId);
        if (!claimed) {
            const run = await this.store.getRun(workspaceId, runId);
            if (!run) throw new Error(`For Each run not found: ${runId}`);
            return run;
        }
        return this.enqueueClaimedItem(claimed);
    }

    async retryItem(workspaceId: string, runId: string, itemId: string): Promise<ForEachRun> {
        const claimed = await this.store.claimFailedItemForRetry(workspaceId, runId, itemId);
        return this.enqueueClaimedItem(claimed);
    }

    async skipItemAndContinue(workspaceId: string, runId: string, itemId: string): Promise<ForEachRun> {
        const skipped = await this.store.skipItem(workspaceId, runId, itemId);
        if (skipped.status === 'completed' || skipped.status === 'cancelled' || skipped.status === 'failed') {
            return skipped;
        }
        return this.startOrContinueRun(workspaceId, runId);
    }

    async cancelRun(workspaceId: string, runId: string): Promise<ForEachRun> {
        const result = await this.store.cancelRun(workspaceId, runId);
        if (this.cancelChildTask) {
            for (const childTaskId of result.childTaskIds) {
                await this.cancelChildTask(childTaskId);
            }
        }
        return result.run;
    }

    async handleChildTaskCompleted(task: QueuedTask): Promise<void> {
        const context = getForEachContext(task);
        if (!context) return;
        const taskId = task.id;
        const run = await this.store.markRunningItemCompleted(context.workspaceId, context.runId, context.itemId, taskId);
        if (run.status === 'running') {
            await this.startOrContinueRun(context.workspaceId, context.runId);
        }
    }

    async handleChildTaskFailed(task: QueuedTask, error: Error | string): Promise<void> {
        const context = getForEachContext(task);
        if (!context) return;
        const message = error instanceof Error ? error.message : error;
        await this.store.markRunningItemFailed(context.workspaceId, context.runId, context.itemId, message || 'Child task failed', task.id);
    }

    async handleChildTaskCancelled(task: QueuedTask): Promise<void> {
        const context = getForEachContext(task);
        if (!context) return;
        await this.store.markRunningItemFailed(context.workspaceId, context.runId, context.itemId, 'Child task cancelled', task.id);
    }

    private async enqueueClaimedItem(claimed: ClaimedForEachItem): Promise<ForEachRun> {
        const { workspaceId, runId } = claimed.run;
        const itemId = claimed.item.id;
        return this.enqueueSingleChild(
            buildChildTask(claimed.run, claimed.item),
            message => this.store.markRunningItemFailed(workspaceId, runId, itemId, `Failed to enqueue child task: ${message}`),
            taskId => this.store.linkRunningItemChild(workspaceId, runId, itemId, taskId, toQueueProcessId(taskId)),
        );
    }
}
