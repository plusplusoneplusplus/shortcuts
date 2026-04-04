/**
 * Work Item Executor
 *
 * Bridges work items to the task queue for execution.
 * When a work item is executed, creates a queue task from its plan,
 * transitions the work item to 'executing', and tracks the result.
 */

import type { WorkItemStore, WorkItem, WorkItemExecution } from './types';
import { isValidTransition } from './types';

export interface ExecuteWorkItemOptions {
    /** Model override for the AI task. */
    model?: string;
    /** Chat mode for execution (default: 'autopilot'). */
    mode?: 'ask' | 'plan' | 'autopilot';
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
            `Cannot execute work item in status '${item.status}'. Must be 'ready' to execute.`
        );
    }

    const prompt = buildExecutionPrompt(item);
    const mode = options?.mode ?? 'autopilot';

    const taskId = await enqueue({
        type: 'chat',
        priority: item.priority ?? 'normal',
        payload: {
            kind: 'chat',
            mode,
            prompt,
            workspaceId: item.repoId,
            // Link back to work item for status tracking
            workItemId: item.id,
        },
        config: {
            ...(options?.model ? { model: options.model } : {}),
        },
        displayName: `WI: ${item.title}`,
    });

    // Record the execution
    const execution: WorkItemExecution = {
        taskId,
        startedAt: new Date().toISOString(),
        status: 'running',
    };
    await store.addExecution(workItemId, execution);

    // Transition to executing
    await store.updateWorkItem(workItemId, { status: 'executing' });

    return { taskId };
}

/**
 * Handle task completion for a work item.
 * Called when a queue task linked to a work item finishes.
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

    const newStatus = result.status === 'completed' ? 'done' : 'failed';
    await store.updateWorkItem(workItemId, {
        status: newStatus,
        completedAt: new Date().toISOString(),
        processId: result.processId,
    });
}
