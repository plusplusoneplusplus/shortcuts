import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { FileMapReduceRunStore } from './map-reduce-run-store';
import type {
    ClaimedMapReduceItems,
    ClaimedMapReduceReduceStep,
    MapReduceItem,
    MapReduceRun,
} from './types';
import type { CancelRunChildTask, EnqueueRunChildTask } from '../shared/run-executor-base';
import { buildChatChildTask, RunExecutorBase } from '../shared/run-executor-base';

export type EnqueueMapReduceChildTask = EnqueueRunChildTask;
export type CancelMapReduceChildTask = CancelRunChildTask;

export interface MapReduceRunExecutorOptions {
    store: FileMapReduceRunStore;
    enqueueChildTask: EnqueueMapReduceChildTask;
    cancelChildTask?: CancelMapReduceChildTask;
}

function jsonBlock(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

export function buildMapReduceMapChildPrompt(run: MapReduceRun, item: MapReduceItem): string {
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
        'You are executing one map child item from a CoC Map Reduce run.',
        'Focus only on this map item. Do not use sibling item results, parent progress journals, Ralph session state, timers, wakeups, workflow DAG context, or reduce-step context.',
        `Immutable run metadata:\n${jsonBlock(runMetadata)}`,
        `Immutable item metadata:\n${jsonBlock(itemMetadata)}`,
    ];
    if (run.sharedInstructions?.trim()) {
        parts.push(`Shared instructions for every map item:\n${run.sharedInstructions.trim()}`);
    }
    parts.push(`Map item task prompt:\n${item.prompt}`);
    return parts.join('\n\n');
}

export function buildMapReduceReduceChildPrompt(run: MapReduceRun): string {
    const runMetadata = {
        runId: run.runId,
        workspaceId: run.workspaceId,
        childMode: run.childMode,
        originalRequest: run.originalRequest,
        maxParallel: run.maxParallel,
    };
    const itemOutputs = run.items.map(item => ({
        id: item.id,
        title: item.title,
        status: item.status,
        dependsOn: item.dependsOn ?? [],
        metadata: item.metadata ?? {},
        output: item.output,
    }));
    return [
        'You are executing the reduce step from a CoC Map Reduce run.',
        'Aggregate only the completed map item outputs below. Do not launch new map work, inspect sibling processes directly, or rely on external parent progress state.',
        `Immutable run metadata:\n${jsonBlock(runMetadata)}`,
        `Reduce instructions:\n${run.reduceInstructions}`,
        `Map item outputs:\n${jsonBlock(itemOutputs)}`,
    ].join('\n\n');
}

function buildMapChildTask(run: MapReduceRun, item: MapReduceItem): CreateTaskInput {
    return buildChatChildTask({
        run,
        prompt: buildMapReduceMapChildPrompt(run, item),
        contextKey: 'mapReduce',
        contextValue: {
            workspaceId: run.workspaceId,
            runId: run.runId,
            itemId: item.id,
            phase: 'map',
            childMode: run.childMode,
        },
        groupType: 'map-reduce',
        role: 'item',
        itemKey: item.id,
        displayName: `[Map Reduce] ${item.title}`,
    });
}

function buildReduceChildTask(run: MapReduceRun): CreateTaskInput {
    return buildChatChildTask({
        run,
        prompt: buildMapReduceReduceChildPrompt(run),
        contextKey: 'mapReduce',
        contextValue: {
            workspaceId: run.workspaceId,
            runId: run.runId,
            phase: 'reduce',
            childMode: run.childMode,
        },
        groupType: 'map-reduce',
        role: 'reduce',
        displayName: `[Map Reduce] Reduce ${run.runId}`,
    });
}

type MapReduceTaskContext =
    | { workspaceId: string; runId: string; phase: 'map'; itemId: string }
    | { workspaceId: string; runId: string; phase: 'reduce' };

type EnqueueMapItemResult =
    | { item: MapReduceItem; taskId: string }
    | { item: MapReduceItem; error: unknown };

function getMapReduceContext(task: QueuedTask): MapReduceTaskContext | undefined {
    const context = (task.payload as { context?: { mapReduce?: unknown } } | undefined)?.context?.mapReduce;
    if (!context || typeof context !== 'object') {
        return undefined;
    }
    const record = context as Record<string, unknown>;
    if (typeof record.workspaceId !== 'string' || typeof record.runId !== 'string') {
        return undefined;
    }
    if (record.phase === 'map' && typeof record.itemId === 'string') {
        return {
            workspaceId: record.workspaceId,
            runId: record.runId,
            phase: 'map',
            itemId: record.itemId,
        };
    }
    if (record.phase === 'reduce') {
        return {
            workspaceId: record.workspaceId,
            runId: record.runId,
            phase: 'reduce',
        };
    }
    return undefined;
}

export class MapReduceRunExecutor extends RunExecutorBase<MapReduceRun> {
    protected readonly logLabel = 'MapReduce';
    private readonly store: FileMapReduceRunStore;

    constructor(options: MapReduceRunExecutorOptions) {
        super({ enqueueChildTask: options.enqueueChildTask, cancelChildTask: options.cancelChildTask });
        this.store = options.store;
    }

    async startOrContinueRun(workspaceId: string, runId: string): Promise<MapReduceRun> {
        const claimed = await this.store.claimRunnableItems(workspaceId, runId);
        if (claimed) {
            return this.enqueueClaimedItems(claimed);
        }
        const reduceClaim = await this.store.claimReduceStep(workspaceId, runId);
        if (reduceClaim) {
            return this.enqueueClaimedReduceStep(reduceClaim);
        }
        const run = await this.store.getRun(workspaceId, runId);
        if (!run) {
            throw new Error(`Map Reduce run not found: ${runId}`);
        }
        return run;
    }

    async retryItem(workspaceId: string, runId: string, itemId: string): Promise<MapReduceRun> {
        const claimed = await this.store.claimFailedItemForRetry(workspaceId, runId, itemId);
        return this.enqueueClaimedItems(claimed);
    }

    async skipItemAndContinue(workspaceId: string, runId: string, itemId: string): Promise<MapReduceRun> {
        const skipped = await this.store.skipItem(workspaceId, runId, itemId);
        if (skipped.status === 'completed' || skipped.status === 'cancelled' || skipped.status === 'failed') {
            return skipped;
        }
        return this.startOrContinueRun(workspaceId, runId);
    }

    async retryReduce(workspaceId: string, runId: string): Promise<MapReduceRun> {
        const claimed = await this.store.claimFailedReduceStepForRetry(workspaceId, runId);
        return this.enqueueClaimedReduceStep(claimed);
    }

    async cancelRun(workspaceId: string, runId: string): Promise<MapReduceRun> {
        const result = await this.store.cancelRun(workspaceId, runId);
        if (this.cancelChildTask) {
            for (const childTaskId of result.childTaskIds) {
                await this.cancelChildTask(childTaskId);
            }
        }
        return result.run;
    }

    async handleChildTaskCompleted(task: QueuedTask, result: unknown = task.result): Promise<void> {
        const context = getMapReduceContext(task);
        if (!context) {
            return;
        }
        if (context.phase === 'reduce') {
            await this.store.markRunningReduceCompleted(context.workspaceId, context.runId, task.id);
            return;
        }
        const run = await this.store.markRunningItemCompleted(
            context.workspaceId,
            context.runId,
            context.itemId,
            task.id,
            result,
        );
        if (run.status === 'running' || run.status === 'reducing') {
            await this.startOrContinueRun(context.workspaceId, context.runId);
        }
    }

    async handleChildTaskFailed(task: QueuedTask, error: Error | string): Promise<void> {
        const context = getMapReduceContext(task);
        if (!context) {
            return;
        }
        const message = error instanceof Error ? error.message : error;
        if (context.phase === 'reduce') {
            await this.store.markRunningReduceFailed(context.workspaceId, context.runId, message || 'Reduce task failed', task.id);
            return;
        }
        await this.store.markRunningItemFailed(
            context.workspaceId,
            context.runId,
            context.itemId,
            message || 'Map child task failed',
            task.id,
        );
    }

    async handleChildTaskCancelled(task: QueuedTask): Promise<void> {
        const context = getMapReduceContext(task);
        if (!context) {
            return;
        }
        if (context.phase === 'reduce') {
            await this.store.markRunningReduceFailed(context.workspaceId, context.runId, 'Reduce task cancelled', task.id);
            return;
        }
        await this.store.markRunningItemFailed(context.workspaceId, context.runId, context.itemId, 'Map child task cancelled', task.id);
    }

    private async enqueueClaimedItems(claimed: ClaimedMapReduceItems): Promise<MapReduceRun> {
        const enqueueResults: EnqueueMapItemResult[] = await Promise.all(claimed.items.map(async (item) => {
            try {
                return {
                    item,
                    taskId: await this.enqueueChildTask(buildMapChildTask(claimed.run, item)),
                };
            } catch (error) {
                return { item, error };
            }
        }));

        let latestRun = claimed.run;
        let firstError: unknown;
        for (const result of enqueueResults) {
            if ('error' in result) {
                firstError ??= result.error;
                const message = result.error instanceof Error ? result.error.message : String(result.error);
                await this.store.markRunningItemFailed(
                    claimed.run.workspaceId,
                    claimed.run.runId,
                    result.item.id,
                    `Failed to enqueue map child task: ${message}`,
                );
                continue;
            }
            latestRun = await this.store.linkRunningItemChild(
                claimed.run.workspaceId,
                claimed.run.runId,
                result.item.id,
                result.taskId,
                toQueueProcessId(result.taskId),
            );
        }
        if (firstError !== undefined) {
            if (firstError instanceof Error) {
                throw firstError;
            }
            throw new Error(String(firstError));
        }
        return latestRun;
    }

    private async enqueueClaimedReduceStep(claimed: ClaimedMapReduceReduceStep): Promise<MapReduceRun> {
        const { workspaceId, runId } = claimed.run;
        return this.enqueueSingleChild(
            buildReduceChildTask(claimed.run),
            message => this.store.markRunningReduceFailed(workspaceId, runId, `Failed to enqueue reduce child task: ${message}`),
            taskId => this.store.linkRunningReduceChild(workspaceId, runId, taskId, toQueueProcessId(taskId)),
        );
    }
}
