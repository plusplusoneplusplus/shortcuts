/**
 * Work Item Execution Command
 *
 * Owns everything the `POST .../work-items/:wid/execute` route used to do
 * inline: item lookup and type policy, git HEAD capture, the placeholder task
 * file, Ralph eligibility, worktree feature gating, executor invocation, and
 * cache/broadcast settlement.
 *
 * Request parsing stays in the route (see `work-item-execution-settings`); this
 * command only takes a typed input. Failures throw {@link APIError}.
 */

import { execGit } from '@plusplusoneplusplus/forge';
import { badRequest } from '../errors';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';
import { GitWorktreeService } from '../worktree/worktree-service';
import type { WorktreeExecutionRequest } from '../worktree/worktree-request';
import { HIERARCHY_CONTAINER_TYPES } from './types';
import { executeWorkItem } from './work-item-executor';
import { upsertWorkItemTaskFile } from './work-item-task-file';
import type { WorkItemAiSettings, WorkItemRequestedExecutionMode } from './work-item-execution-settings';
import {
    isLocalOnlyWorkflowLeaf,
    requireEnqueue,
    requireWorkItem,
    settleWorkItemUpdate,
    type WorkItemCommandScope,
    type WorkItemExecutionCommandContext,
} from './work-item-execution-shared';

export interface ExecuteWorkItemCommandInput extends WorkItemCommandScope {
    settings: WorkItemAiSettings;
    /** Selected skills, already filtered to non-blank strings. */
    skillNames?: string[];
    /** Validated opt-in worktree request, or `undefined` when not requested. */
    worktree?: WorktreeExecutionRequest;
    /** Requested strategy; `undefined` lets the command pick the default. */
    executionMode?: WorkItemRequestedExecutionMode;
    /** Chat mode passthrough (default resolved by the executor). */
    mode?: string;
}

export async function executeWorkItemCommand(
    ctx: WorkItemExecutionCommandContext,
    input: ExecuteWorkItemCommandInput,
): Promise<unknown> {
    const enqueue = requireEnqueue(ctx);
    const { dataDir } = ctx;
    const item = await requireWorkItem(ctx, input);

    // Only leaf types (work-item, bug) can be executed.
    const effectiveType = item.type ?? 'work-item';
    if (HIERARCHY_CONTAINER_TYPES.has(effectiveType)) {
        throw badRequest(`Only WorkItem and Bug items can be executed. "${effectiveType}" is a planning container.`);
    }

    // Capture git HEAD before execution for commit range tracking, and the
    // source checkout path (used as the worktree base when requested).
    let headBefore: string | undefined;
    let sourceRepoRoot: string | undefined;
    try {
        const workspaces = await ctx.processStore.getWorkspaces();
        const workspace = workspaces.find(w => w.id === input.commandRepoId);
        if (workspace?.rootPath) {
            sourceRepoRoot = workspace.rootPath;
            headBefore = execGit(['rev-parse', 'HEAD'], workspace.rootPath);
        }
    } catch { /* non-fatal — commit tracking will be skipped */ }

    // Create a placeholder task file so the item appears immediately in the
    // Tasks panel with a live "in-progress" indicator.
    let taskFilePath: string | undefined;
    if (dataDir) {
        try {
            taskFilePath = await upsertWorkItemTaskFile(
                dataDir, input.commandRepoId, input.workItemId, item.title, 'in-progress',
            );
            // Notify the Tasks panel about the new file.
            ctx.getWsServer?.()?.broadcastProcessEvent({
                type: 'tasks-changed',
                workspaceId: input.commandRepoId,
                timestamp: Date.now(),
            });
        } catch { /* non-fatal — live visibility is best-effort */ }
    }

    const executionMode = input.executionMode === undefined
        ? (item.type === 'goal' && ctx.getWorkflowEnabled?.() === true ? 'ralph' : 'one-shot')
        : input.executionMode;
    if (executionMode === 'ralph') {
        if (ctx.getWorkflowEnabled?.() !== true) {
            throw badRequest('Ralph Work Item execution requires workItems.workflow.enabled');
        }
        if (!isLocalOnlyWorkflowLeaf(item)) {
            throw badRequest('Ralph Work Item execution is only available for local-only Work Items and Goals');
        }
    }
    const maxRalphIterations = executionMode === 'ralph' && dataDir
        ? readRepoPreferences(dataDir, input.commandRepoId).maxRalphIterations ?? RALPH_DEFAULT_MAX_ITERATIONS
        : undefined;

    // Opt-in Git worktree execution: gate on the feature flag and resolve the
    // source checkout before handing the service to the executor, which creates
    // the worktree before queueing anything.
    let worktreeService: GitWorktreeService | undefined;
    if (input.worktree?.enabled) {
        if (ctx.getGitWorktreeExecutionEnabled?.() !== true) {
            throw badRequest('Git worktree execution is not enabled');
        }
        if (!dataDir) {
            throw badRequest('Git worktree execution is not available on this server');
        }
        if (!sourceRepoRoot) {
            throw badRequest('Workspace root is not available for worktree execution');
        }
        worktreeService = new GitWorktreeService({ dataDir });
    }

    const result = await executeWorkItem(input.workItemId, ctx.workItemStore, enqueue, {
        repoId: input.storageRepoId,
        workspaceId: input.commandRepoId,
        model: input.settings.model,
        provider: input.settings.provider,
        reasoningEffort: input.settings.reasoningEffort,
        effortTier: input.settings.effortTier,
        autoProviderRouting: input.settings.autoProviderRouting,
        executionMode,
        mode: input.mode,
        dataDir,
        maxRalphIterations,
        headBefore,
        taskFilePath,
        skillNames: input.skillNames?.length ? input.skillNames : undefined,
        worktree: input.worktree,
        worktreeService,
        sourceRepoRoot,
    });

    await settleWorkItemUpdate(ctx, input);
    return result;
}
