import type { CreateTaskInput, QueuedTask, RepoQueueRegistry } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';

/** Minimal run shape the shared child-task envelope reads. */
export interface ChildTaskRun {
    workspaceId: string;
    runId: string;
    childMode: 'ask' | 'autopilot';
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    autoProviderRouting?: { requested: true };
}

export interface BuildChatChildTaskParams {
    run: ChildTaskRun;
    prompt: string;
    /** Which run-context key carries the subsystem pointer: `forEach` or `mapReduce`. */
    contextKey: 'forEach' | 'mapReduce';
    /** The subsystem pointer object stored under `contextKey`. */
    contextValue: Record<string, unknown>;
    /** Task-group type, e.g. `for-each` or `map-reduce`. */
    groupType: string;
    /** Task-group role, e.g. `item` or `reduce`. */
    role: string;
    /** Task-group item key; omitted for phase-level work like the reduce step. */
    itemKey?: string;
    displayName: string;
}

/**
 * Builds the shared `CreateTaskInput` envelope for a For Each / Map Reduce child
 * chat task. The provider/model/reasoningEffort spreads, auto-provider routing,
 * task-group wiring, and config are identical across subsystems; only the
 * context pointer, group metadata, prompt, and display name vary.
 */
export function buildChatChildTask(params: BuildChatChildTaskParams): CreateTaskInput {
    const { run, prompt, contextKey, contextValue, groupType, role, itemKey, displayName } = params;
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
                ...(run.autoProviderRouting?.requested ? { autoProviderRouting: { requested: true as const } } : {}),
                [contextKey]: contextValue,
                taskGroup: {
                    groupId: run.runId,
                    groupType,
                    role,
                    ...(itemKey !== undefined ? { itemKey } : {}),
                    workspaceId: run.workspaceId,
                },
            },
        },
        config: {
            ...(run.model ? { model: run.model } : {}),
            ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
        },
        displayName,
    };
}

export type EnqueueRunChildTask = (input: CreateTaskInput) => string | Promise<string>;
export type CancelRunChildTask = (taskId: string) => boolean | Promise<boolean>;

export interface RunExecutorBaseOptions {
    enqueueChildTask: EnqueueRunChildTask;
    cancelChildTask?: CancelRunChildTask;
}

/**
 * Shared executor plumbing for the For Each and Map Reduce run executors: queue
 * registry wiring, the child-task-event error logger, and the single-child
 * enqueue → mark-failed-on-throw → link sequence. The per-event handlers stay
 * abstract because their run-state transitions are subsystem-specific.
 */
export abstract class RunExecutorBase<TRun> {
    protected readonly enqueueChildTask: EnqueueRunChildTask;
    protected readonly cancelChildTask?: CancelRunChildTask;

    /** Short subsystem tag used in warning logs, e.g. `ForEach` or `MapReduce`. */
    protected abstract readonly logLabel: string;

    constructor(options: RunExecutorBaseOptions) {
        this.enqueueChildTask = options.enqueueChildTask;
        this.cancelChildTask = options.cancelChildTask;
    }

    abstract handleChildTaskCompleted(task: QueuedTask, result?: unknown): Promise<void>;
    abstract handleChildTaskFailed(task: QueuedTask, error: Error | string): Promise<void>;
    abstract handleChildTaskCancelled(task: QueuedTask): Promise<void>;

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

    /**
     * Enqueues one child task, marking the owning run item/step failed if the
     * enqueue throws (then rethrowing), otherwise linking the queued task back
     * to the run. `onEnqueueError` and `link` carry the subsystem-specific store
     * calls (map item vs reduce step).
     */
    protected async enqueueSingleChild(
        task: CreateTaskInput,
        onEnqueueError: (message: string) => Promise<unknown>,
        link: (taskId: string) => Promise<TRun>,
    ): Promise<TRun> {
        let taskId: string;
        try {
            taskId = await this.enqueueChildTask(task);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await onEnqueueError(message);
            throw err;
        }
        return link(taskId);
    }

    protected logListenerError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        getLogger().warn(LogCategory.AI, `[${this.logLabel}] Failed to update run from child task event: ${message}`);
    }
}
