import type { CreateTaskInput, QueuedTask, RepoQueueRegistry } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { FileMapReduceRunStore } from './map-reduce-run-store';
import type {
    ClaimedMapReduceItems,
    ClaimedMapReduceReduceStep,
    MapReduceItem,
    MapReduceRun,
} from './types';

export type EnqueueMapReduceChildTask = (input: CreateTaskInput) => string | Promise<string>;
export type CancelMapReduceChildTask = (taskId: string) => boolean | Promise<boolean>;

export interface MapReduceRunExecutorOptions {
    store: FileMapReduceRunStore;
    enqueueChildTask: EnqueueMapReduceChildTask;
    cancelChildTask?: CancelMapReduceChildTask;
}

function jsonBlock(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function childTaskConfig(run: MapReduceRun): CreateTaskInput['config'] {
    return {
        ...(run.model ? { model: run.model } : {}),
        ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
    };
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
    const prompt = buildMapReduceMapChildPrompt(run, item);
    return {
        type: 'chat',
        priority: 'normal',
        repoId: run.workspaceId,
        payload: {
            kind: 'chat',
            mode: run.childMode,
            prompt,
            workspaceId: run.workspaceId,
            ...(run.provider ? { provider: run.provider } : {}),
            ...(run.model ? { model: run.model } : {}),
            ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
            context: {
                mapReduce: {
                    workspaceId: run.workspaceId,
                    runId: run.runId,
                    itemId: item.id,
                    phase: 'map',
                    childMode: run.childMode,
                },
            },
        },
        config: childTaskConfig(run),
        displayName: `[Map Reduce] ${item.title}`,
    };
}

function buildReduceChildTask(run: MapReduceRun): CreateTaskInput {
    const prompt = buildMapReduceReduceChildPrompt(run);
    return {
        type: 'chat',
        priority: 'normal',
        repoId: run.workspaceId,
        payload: {
            kind: 'chat',
            mode: run.childMode,
            prompt,
            workspaceId: run.workspaceId,
            ...(run.provider ? { provider: run.provider } : {}),
            ...(run.model ? { model: run.model } : {}),
            ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
            context: {
                mapReduce: {
                    workspaceId: run.workspaceId,
                    runId: run.runId,
                    phase: 'reduce',
                    childMode: run.childMode,
                },
            },
        },
        config: childTaskConfig(run),
        displayName: `[Map Reduce] Reduce ${run.runId}`,
    };
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

export class MapReduceRunExecutor {
    private readonly store: FileMapReduceRunStore;
    private readonly enqueueChildTask: EnqueueMapReduceChildTask;
    private readonly cancelChildTask?: CancelMapReduceChildTask;

    constructor(options: MapReduceRunExecutorOptions) {
        this.store = options.store;
        this.enqueueChildTask = options.enqueueChildTask;
        this.cancelChildTask = options.cancelChildTask;
    }

    attachToQueueRegistry(registry: RepoQueueRegistry): void {
        registry.on('taskCompleted', (_repoPath: string, task: QueuedTask, result: unknown) => {
            void this.handleChildTaskCompleted(task, result).catch(err => this.logListenerError(err));
        });
        registry.on('taskFailed', (_repoPath: string, task: QueuedTask, error: Error) => {
            void this.handleChildTaskFailed(task, error).catch(err => this.logListenerError(err));
        });
        registry.on('taskCancelled', (_repoPath: string, task: QueuedTask) => {
            void this.handleChildTaskCancelled(task).catch(err => this.logListenerError(err));
        });
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
        let taskId: string;
        try {
            taskId = await this.enqueueChildTask(buildReduceChildTask(claimed.run));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.store.markRunningReduceFailed(
                claimed.run.workspaceId,
                claimed.run.runId,
                `Failed to enqueue reduce child task: ${message}`,
            );
            throw err;
        }
        return this.store.linkRunningReduceChild(
            claimed.run.workspaceId,
            claimed.run.runId,
            taskId,
            toQueueProcessId(taskId),
        );
    }

    private logListenerError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        getLogger().warn(LogCategory.AI, `[MapReduce] Failed to update run from child task event: ${message}`);
    }
}
