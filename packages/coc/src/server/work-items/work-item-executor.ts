/**
 * Work Item Executor
 *
 * Bridges work items to the task queue for execution.
 * When a work item is executed, creates a queue task from its plan,
 * transitions the work item to 'executing', and tracks the result.
 */

import * as crypto from 'crypto';
import type { WorkItemStore, WorkItem, WorkItemExecution, WorkItemChange } from './types';
import { isValidTransition } from './types';

import type { SessionCategory } from '@plusplusoneplusplus/forge';

export interface ExecuteWorkItemOptions {
    /** Model override for the AI task. */
    model?: string;
    /** Chat mode for execution (default: 'autopilot'). */
    mode?: 'ask' | 'plan' | 'autopilot';
    /** Git HEAD SHA captured immediately before execution enqueued. */
    headBefore?: string;
    /** Whether this execution was triggered automatically after comment resolution. */
    autoReExecuted?: boolean;
    /**
     * Absolute path to a pre-created task placeholder file.
     * When provided, the path is included in the task payload as `context.files[0]`
     * so the Tasks panel's `useQueueActivity` hook can display a live indicator
     * for this work item while it is executing.
     */
    taskFilePath?: string;
}

export interface EnqueueFunction {
    (input: {
        type: string;
        priority: string;
        payload: Record<string, unknown>;
        config: Record<string, unknown>;
        displayName?: string;
    }): Promise<string>;
}

/**
 * Build a prompt from a work item's plan and description.
 */
export function buildExecutionPrompt(item: WorkItem): string {
    const parts: string[] = [];

    parts.push(`# Work Item: ${item.title}`);
    parts.push('');

    if (item.description) {
        parts.push('## Description');
        parts.push(item.description);
        parts.push('');
    }

    if (item.plan?.content) {
        parts.push('## Plan');
        parts.push(item.plan.content);
        parts.push('');
    }

    parts.push('Execute the plan above. Follow each step carefully.');

    return parts.join('\n');
}

/**
 * Execute a work item by enqueuing it as a task.
 *
 * @returns The queue task ID
 */
export async function executeWorkItem(
    workItemId: string,
    store: WorkItemStore,
    enqueue: EnqueueFunction,
    options?: ExecuteWorkItemOptions,
): Promise<{ taskId: string }> {
    const item = await store.getWorkItem(workItemId);
    if (!item) {
        throw new Error(`Work item not found: ${workItemId}`);
    }

    if (!isValidTransition(item.status, 'executing')) {
        throw new Error(
            `Cannot execute work item in status '${item.status}'. Must be 'readyToExecute' to execute.`
        );
    }

    const prompt = buildExecutionPrompt(item);
    const mode = options?.mode ?? 'autopilot';
    const runNumber = (item.executionHistory?.length ?? 0) + 1;

    const taskId = await enqueue({
        type: 'run-workflow',
        priority: item.priority ?? 'normal',
        payload: {
            kind: 'chat',
            mode,
            prompt,
            workspaceId: item.repoId,
            sessionCategory: 'generating-code' satisfies SessionCategory,
            workItemId: item.id,
            ...(options?.taskFilePath
                ? { context: { files: [options.taskFilePath] } }
                : {}),
        },
        config: {
            ...(options?.model ? { model: options.model } : {}),
        },
        displayName: `Run #${runNumber}: Code Implement`,
    });

    // Record the execution
    const execution: WorkItemExecution = {
        taskId,
        startedAt: new Date().toISOString(),
        status: 'running',
        sessionCategory: 'generating-code',
        title: 'Code Implement',
        ...(options?.autoReExecuted ? { autoReExecuted: true } : {}),
    };
    await store.addExecution(workItemId, execution);

    // Open or reuse a Change entry for this execution cycle
    const existingChanges = await store.getChanges(workItemId);
    const openChange = existingChanges.find(
        c => c.planVersion === (item.plan?.version ?? 0) && c.status === 'open' && !c.taskId,
    );
    if (openChange) {
        await store.updateChange(workItemId, openChange.id, {
            taskId,
            startedAt: execution.startedAt,
            ...(options?.headBefore !== undefined ? { headBefore: options.headBefore } : {}),
        });
    } else {
        const change: WorkItemChange = {
            id: crypto.randomUUID(),
            planVersion: item.plan?.version ?? 0,
            commits: [],
            startedAt: execution.startedAt,
            status: 'open',
            taskId,
            ...(options?.headBefore !== undefined ? { headBefore: options.headBefore } : {}),
        };
        await store.addChange(workItemId, change);
    }

    // Transition to executing
    await store.updateWorkItem(workItemId, { status: 'executing' });

    return { taskId };
}

// ============================================================================
// Comment Resolve Execution
// ============================================================================

export interface ResolveWorkItemCommentsOptions {
    /** Model override for the AI task. */
    model?: string;
    /** Resolve type: plan inline comments or commit diff comments. */
    type: 'plan' | 'commit';
    /** For commit resolve: the commit SHA being resolved. */
    commitSha?: string;
    /** Which Run# triggered the comments being resolved (display only). */
    sourceRunIndex?: number;
    /** Pre-built prompt for the AI resolve session. */
    prompt: string;
    /** Context payload for the resolve executor (resolveComments or resolveDiffCommentsMulti). */
    resolveContext: Record<string, unknown>;
    /** Chat mode override (default: 'ask' for plan, 'autopilot' for commit). */
    mode?: 'ask' | 'plan' | 'autopilot';
}

/**
 * Resolve work item comments by creating a Run# execution session.
 *
 * Unlike `executeWorkItem`, this does **not** transition the work item status
 * or create/update Change entries. The resolve task appears in `executionHistory`
 * alongside regular code-implement runs.
 */
export async function resolveWorkItemComments(
    workItemId: string,
    store: WorkItemStore,
    enqueue: EnqueueFunction,
    options: ResolveWorkItemCommentsOptions,
): Promise<{ taskId: string }> {
    const item = await store.getWorkItem(workItemId);
    if (!item) {
        throw new Error(`Work item not found: ${workItemId}`);
    }

    const runNumber = (item.executionHistory?.length ?? 0) + 1;
    const isPlan = options.type === 'plan';
    const sessionCategory = isPlan ? 'resolve-plan-comments' : 'resolve-commit-comments';
    const title = isPlan
        ? 'Comment Resolve'
        : `Code Comment Resolve${options.commitSha ? ` (${options.commitSha.slice(0, 7)})` : ''}`;
    const displayName = `Run #${runNumber}: ${title}`;
    const mode = options.mode ?? (isPlan ? 'ask' : 'autopilot');

    const taskId = await enqueue({
        type: 'run-workflow',
        priority: item.priority ?? 'normal',
        payload: {
            kind: 'chat',
            mode,
            prompt: options.prompt,
            workspaceId: item.repoId,
            sessionCategory,
            workItemId: item.id,
            tools: ['resolve-comments'],
            context: options.resolveContext,
        },
        config: {
            ...(options.model ? { model: options.model } : {}),
        },
        displayName,
    });

    const execution: WorkItemExecution = {
        taskId,
        startedAt: new Date().toISOString(),
        status: 'running',
        sessionCategory,
        title,
    };
    await store.addExecution(workItemId, execution);

    return { taskId };
}

/** Check whether a session category represents a comment-resolve task. */
export function isResolveSessionCategory(category: string | undefined): boolean {
    return category === 'resolve-plan-comments' || category === 'resolve-commit-comments';
}

/**
 * Handle task completion for a work item.
 * Called when a queue task linked to a work item finishes.
 *
 * Status mapping (regular executions only):
 *   completed  → aiDone (AI finished successfully; awaiting user review)
 *   failed     → aiFailed (AI execution failed; user can retry)
 *   cancelled  → readyToExecute (execution was cancelled; user can retry)
 *
 * Comment-resolve sessions update the execution entry but do NOT
 * transition the work item's status.
 */
export async function handleWorkItemTaskComplete(
    workItemId: string,
    taskId: string,
    result: { status: 'completed' | 'failed' | 'cancelled'; error?: string; processId?: string },
    store: WorkItemStore,
): Promise<void> {
    await store.updateExecution(workItemId, taskId, {
        status: result.status,
        completedAt: new Date().toISOString(),
        error: result.error,
        processId: result.processId,
    });

    // Check if this is a comment-resolve session — skip status transition
    const item = await store.getWorkItem(workItemId);
    const matchedExec = item?.executionHistory?.find(e => e.taskId === taskId);
    if (isResolveSessionCategory(matchedExec?.sessionCategory)) {
        // Only update the processId reference, do not change work item status
        await store.updateWorkItem(workItemId, { processId: result.processId });
        return;
    }

    let newStatus: import('./types').WorkItemStatus;
    if (result.status === 'completed') {
        newStatus = 'aiDone';
    } else if (result.status === 'cancelled') {
        newStatus = 'readyToExecute';
    } else {
        newStatus = 'aiFailed';
    }

    const completedAt = newStatus === 'aiFailed' ? new Date().toISOString() : undefined;
    await store.updateWorkItem(workItemId, {
        status: newStatus,
        ...(completedAt ? { completedAt } : {}),
        processId: result.processId,
    });

    // Close the open Change for this taskId
    try {
        const changes = await store.getChanges(workItemId);
        const openChange = changes.find(c => c.taskId === taskId && c.status === 'open');
        if (openChange) {
            await store.updateChange(workItemId, openChange.id, {
                completedAt: new Date().toISOString(),
                status: 'closed',
            });
        }
    } catch { /* non-fatal */ }
}

// ============================================================================
// Reconciliation After Server Restart
// ============================================================================

export interface ReconcileOptions {
    /** Get all queued + running tasks from the live queue. */
    getQueuedTasks: () => { id: string; payload: Record<string, unknown> }[];
    /** Get a single task by ID from the live queue (queued, running, or history). */
    getTask: (id: string) => { id: string } | undefined;
}

export interface ReconcileResult {
    /** Work items whose taskId was updated to the re-queued task's new ID. */
    relinked: string[];
    /** Work items transitioned to aiFailed because no matching task was found. */
    failed: string[];
}

/**
 * Reconcile executing work items after a server restart.
 *
 * When the queue persistence layer re-enqueues running tasks, it assigns new
 * task IDs. Work items still reference the old IDs — this function patches
 * `workItem.taskId`, the matching `executionHistory` entry, and the open
 * `Change` entry so that `handleWorkItemTaskComplete` can find them when the
 * re-queued task completes.
 *
 * If no matching re-queued task is found (e.g. restart policy = 'fail'),
 * the work item is transitioned to `aiFailed`.
 *
 * Idempotent: if `taskId` already matches a live task, no changes are made.
 */
export async function reconcileExecutingWorkItems(
    store: WorkItemStore,
    options: ReconcileOptions,
): Promise<ReconcileResult> {
    const result: ReconcileResult = { relinked: [], failed: [] };

    const executingItems = await store.listWorkItems({ status: 'executing' });
    if (executingItems.items.length === 0) return result;

    const queuedTasks = options.getQueuedTasks();

    for (const entry of executingItems.items) {
        const item = await store.getWorkItem(entry.id);
        if (!item || item.status !== 'executing') continue;

        const oldTaskId = item.taskId;
        if (!oldTaskId) {
            // No taskId recorded — cannot reconcile; fail the work item
            await store.updateWorkItem(item.id, { status: 'aiFailed' });
            result.failed.push(item.id);
            continue;
        }

        // Check if the current taskId still exists in the live queue
        const existingTask = options.getTask(oldTaskId);
        if (existingTask) {
            // Task is still live — no reconciliation needed
            continue;
        }

        // Search for a re-queued task that carries this work item's ID
        const requeued = queuedTasks.find(
            t => (t.payload?.workItemId as string) === item.id,
        );

        if (requeued) {
            const newTaskId = requeued.id;

            // Patch the execution history entry (must happen before updateWorkItem
            // so the lookup key — the old taskId — is still valid)
            await store.updateExecution(item.id, oldTaskId, { taskId: newTaskId });

            // Update the work item's top-level taskId
            await store.updateWorkItem(item.id, { taskId: newTaskId });

            // Patch the open Change entry
            const changes = await store.getChanges(item.id);
            const openChange = changes.find(c => c.taskId === oldTaskId && c.status === 'open');
            if (openChange) {
                await store.updateChange(item.id, openChange.id, { taskId: newTaskId });
            }

            result.relinked.push(item.id);
        } else {
            // No re-queued task found — task was not re-enqueued (restart policy = 'fail')
            await store.updateWorkItem(item.id, { status: 'aiFailed' });
            result.failed.push(item.id);
        }
    }

    return result;
}
