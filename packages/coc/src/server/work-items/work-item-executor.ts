/**
 * Work Item Executor
 *
 * Bridges work items to the task queue for execution.
 * When a work item is executed, creates a queue task from its plan,
 * transitions the work item to 'executing', and tracks the result.
 */

import * as crypto from 'crypto';
import type { WorkItemStore, WorkItem, WorkItemExecution, WorkItemChange, WorkItemPlanVersion } from './types';
import { getOwnWorkItemTrackerKind, isValidTransition } from './types';
import type { ChatMode, ChatProvider, ReasoningEffort } from '../tasks/task-types';
import { normalizeChatModeOrDefault } from '../tasks/task-types';

import type { SessionCategory } from '@plusplusoneplusplus/forge';

export interface ExecuteWorkItemOptions {
    /** Model override for the AI task. */
    model?: string;
    /** AI provider override for the chat task. */
    provider?: ChatProvider;
    /** Per-turn reasoning-effort override for the chat task. */
    reasoningEffort?: ReasoningEffort;
    /** Effort tier to expand after the task's provider is resolved. */
    effortTier?: string;
    /** Explicit request to resolve the provider through Auto at enqueue time. */
    autoProviderRouting?: boolean;
    /** Chat mode for execution (default: 'autopilot'). */
    mode?: Exclude<ChatMode, 'ralph'> | string;
    /** Git HEAD SHA captured immediately before execution enqueued. */
    headBefore?: string;
    /** Whether this execution was triggered automatically after comment resolution. */
    autoReExecuted?: boolean;
    /**
     * Absolute path to a pre-created task placeholder file.
     * When provided, the path is included in the task payload as `context.files[0]`
     * so the Tasks panel's `useQueueChat` hook can display a live indicator
     * for this work item while it is executing.
     */
    taskFilePath?: string;
    /** Skill names selected by the user for this execution. */
    skillNames?: string[];
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
    const mode = normalizeChatModeOrDefault(options?.mode, 'autopilot');
    const runNumber = (item.executionHistory?.length ?? 0) + 1;
    const selectedPlanVersion = item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version;

    const contextFiles = options?.taskFilePath ? [options.taskFilePath] : [];
    const contextSkills = options?.skillNames ?? [];
    const context = contextFiles.length || contextSkills.length || options?.autoProviderRouting
        ? {
            ...(contextFiles.length ? { files: contextFiles } : {}),
            ...(contextSkills.length ? { skills: contextSkills } : {}),
            ...(options?.autoProviderRouting ? { autoProviderRouting: { requested: true } } : {}),
        }
        : undefined;

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
            ...(selectedPlanVersion !== undefined ? { planVersion: selectedPlanVersion } : {}),
            ...(options?.provider ? { provider: options.provider } : {}),
            ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
            ...(context ? { context } : {}),
        },
        config: {
            ...(options?.model ? { model: options.model } : {}),
            ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
            ...(options?.effortTier ? { effortTier: options.effortTier } : {}),
        },
        displayName: `Run #${runNumber}: Code Implement`,
    });

    // Record the execution
    const execution: WorkItemExecution = {
        taskId,
        ...(selectedPlanVersion !== undefined ? { planVersion: selectedPlanVersion } : {}),
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
        c => c.planVersion === (selectedPlanVersion ?? 0) && c.status === 'open' && !c.taskId,
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
            planVersion: selectedPlanVersion ?? 0,
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
    mode?: Exclude<ChatMode, 'ralph'> | string;
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
    const mode = normalizeChatModeOrDefault(options.mode, isPlan ? 'ask' : 'autopilot');

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

/**
 * Auto-create a new plan version after a successful resolve-plan-comments session.
 * Parses the AI's revised content from the process result and saves it as a new version
 * only when the content actually changed.
 *
 * @returns The updated work item if a new version was created, or undefined otherwise.
 */
export async function autoVersionPlanFromResolvedComments(
    workItemId: string,
    processResult: string | Record<string, unknown> | undefined,
    store: WorkItemStore,
): Promise<WorkItem | undefined> {
    if (!processResult) return undefined;

    const parsed = typeof processResult === 'string'
        ? JSON.parse(processResult)
        : processResult;
    const revisedContent: string | undefined = parsed?.revisedContent || parsed?.response;
    if (!revisedContent) return undefined;

    const item = await store.getWorkItem(workItemId);
    if (!item) return undefined;

    const currentContent = item.plan?.content ?? '';
    if (revisedContent.trim() === currentContent.trim()) return undefined;

    const now = new Date().toISOString();
    const newVersion = (item.plan?.version ?? 0) + 1;
    const planVersion: WorkItemPlanVersion = {
        version: newVersion,
        content: revisedContent,
        createdAt: now,
        resolvedBy: 'ai',
        source: 'ai',
        authorType: 'ai',
        reason: 'Plan updated from resolved comments',
        summary: 'Plan updated from resolved comments',
    };
    await store.savePlanVersion(workItemId, planVersion);
    return store.updateWorkItem(workItemId, {
        currentContentVersion: newVersion,
        plan: {
            version: newVersion,
            currentVersion: newVersion,
            content: revisedContent,
            updatedAt: now,
            resolvedBy: 'ai',
            source: 'ai',
            reason: planVersion.reason,
        },
    });
}

export interface SaveGoalGrillingSpecOptions {
    workspaceId: string;
    workItemId: string;
    responseText: string | undefined;
    processId?: string;
    store: WorkItemStore;
}

const GOAL_GRILLING_READY_STATUSES = new Set(['created', 'drafting', 'planning', 'readyToExecute', 'aiFailed']);

/** Extract the final Ralph grilling goal spec block from an assistant response. */
export function extractGoalSpecFromGrillingResponse(responseText: string | undefined): string | undefined {
    const raw = responseText?.trim();
    if (!raw) return undefined;

    const fenced = raw.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
    const body = (fenced?.[1] ?? raw).trim();
    const matches = [...body.matchAll(/^## Goal\b.*$/gm)];
    const lastGoalHeading = matches.at(-1);
    if (!lastGoalHeading || lastGoalHeading.index === undefined) return undefined;

    const spec = body.slice(lastGoalHeading.index).trim();
    return spec.length > '## Goal'.length ? spec : undefined;
}

function isLocalOnlyGoal(item: WorkItem, workspaceId: string): boolean {
    return item.repoId === workspaceId
        && item.type === 'goal'
        && getOwnWorkItemTrackerKind(item) === 'local-only'
        && !item.githubMirror
        && !item.azureBoardsMirror;
}

/**
 * Save the final Work-Item-bound Goal grilling spec as a new immutable
 * AI-authored content version. Returns undefined when the response is still a
 * clarification turn or the target is not a local-only Goal.
 */
export async function saveGoalGrillingSpecFromResponse(options: SaveGoalGrillingSpecOptions): Promise<WorkItem | undefined> {
    const content = extractGoalSpecFromGrillingResponse(options.responseText);
    if (!content) return undefined;

    const item = await options.store.getWorkItem(options.workItemId, options.workspaceId);
    if (!item || !isLocalOnlyGoal(item, options.workspaceId)) return undefined;

    const versions = await options.store.getPlanVersions(options.workItemId);
    const reason = 'Goal spec synthesized from grilling session';
    const summary = options.processId
        ? `Goal spec synthesized from ${options.processId}`
        : reason;
    const existingFromProcess = options.processId
        ? versions.find(version => version.source === 'ai' && version.summary === summary && version.content.trim() === content.trim())
        : undefined;
    if (existingFromProcess) return item;

    const newVersion = Math.max(item.plan?.version ?? 0, ...versions.map(version => version.version), 0) + 1;
    const now = new Date().toISOString();
    const planVersion: WorkItemPlanVersion = {
        version: newVersion,
        content,
        createdAt: now,
        resolvedBy: 'ai',
        source: 'ai',
        authorType: 'ai',
        reason,
        summary,
    };

    await options.store.savePlanVersion(options.workItemId, planVersion);
    const nextStatus = GOAL_GRILLING_READY_STATUSES.has(item.status) ? 'readyToExecute' : item.status;
    const updated = await options.store.updateWorkItem(options.workItemId, {
        currentContentVersion: newVersion,
        status: nextStatus,
        plan: {
            version: newVersion,
            currentVersion: newVersion,
            content,
            updatedAt: now,
            resolvedBy: 'ai',
            source: 'ai',
            reason,
        },
    });
    if (!updated) return undefined;

    await options.store.addChange(options.workItemId, {
        id: crypto.randomUUID(),
        planVersion: newVersion,
        commits: [],
        startedAt: now,
        status: 'open',
    });

    return updated;
}
