/**
 * Owns `POST .../work-items/:wid/submit-pr`: eligibility checks, the PR itself
 * (through the shared create-PR service), and the Work Item / change /
 * execution settlement that follows a successful submission.
 *
 * The change's commits go to the service in commits mode, so the PR is built
 * in a temporary linked worktree: the workspace may be dirty and its branch
 * and HEAD never change. GitHub and Azure DevOps are both supported; the
 * provider comes from the `origin` remote. Every git/`gh`/`az` call goes
 * through the injected {@link WorkItemCommandRunner}.
 */

import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { badRequest, notFound } from '../errors';
import { createPullRequest } from '../git/create-pull-request-service';
import { recordPullRequestBinding } from '../processes/record-pull-request-binding';
import type { WorkItem, WorkItemChange } from './types';
import {
    defaultWorkItemCommandRunner,
    isLocalOnlyWorkflowLeaf,
    requireWorkItem,
    settleWorkItemBroadcast,
    workspaceRootPath,
    type WorkItemCommandRunner,
    type WorkItemCommandScope,
    type WorkItemExecutionCommandContext,
} from './work-item-execution-shared';

export interface SubmitWorkItemPrCommandInput extends WorkItemCommandScope {
    /** Explicit change to submit; defaults to the newest eligible change. */
    changeId?: unknown;
    title?: unknown;
    body?: unknown;
    baseBranch?: unknown;
    branchName?: unknown;
}

export interface SubmitWorkItemPrCommandResult {
    workItem: WorkItem;
    changeId: string;
    branchName: string;
    prNumber?: number;
    prUrl: string;
    prStatus: 'open';
}

/** Newest closed change with commits and no PR yet, or the explicitly requested one. */
export function findSubmitPrChange(item: WorkItem, requestedChangeId: unknown): WorkItemChange | undefined {
    const changes = item.changes ?? [];
    if (typeof requestedChangeId === 'string' && requestedChangeId.trim()) {
        return changes.find(change => change.id === requestedChangeId);
    }
    return [...changes].reverse().find(change =>
        change.status === 'closed'
        && change.commits.length > 0
        && !change.prUrl
    );
}

function sanitizeBranchSegment(value: string): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return normalized || 'work-item';
}

function isSafeBranchName(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const branch = value.trim();
    return branch.length > 0
        && branch.length <= 120
        && !branch.startsWith('/')
        && !branch.endsWith('/')
        && !branch.includes('..')
        && !branch.includes('\\')
        && /^[A-Za-z0-9._/-]+$/.test(branch);
}

function buildPrBody(item: WorkItem, change: WorkItemChange): string {
    const lines = [
        `Work Item: ${item.workItemNumber != null ? `#${item.workItemNumber}` : item.id}`,
        '',
        item.description?.trim() ? item.description.trim() : 'Submitted from the CoC Work Items workflow.',
        '',
        '## Execution',
        `- Version: v${change.planVersion}`,
        ...(change.taskId ? [`- Run: ${change.taskId}`] : []),
        '',
        '## Commits',
        ...change.commits.map(commit => `- ${commit.sha.slice(0, 12)} ${commit.message}`),
    ];
    return lines.join('\n');
}

/**
 * Turn a change's commits into an open PR through the shared create-PR
 * service. Auto-merge stays off, as it always was for Work Item PRs.
 */
export async function submitWorkItemPullRequest(options: {
    item: WorkItem;
    change: WorkItemChange;
    repoRoot: string;
    title?: unknown;
    body?: unknown;
    baseBranch?: unknown;
    branchName?: unknown;
    runCommand: WorkItemCommandRunner;
    /** Parent directory for the temporary worktree. Defaults to `os.tmpdir()`. */
    tempDir?: string;
}): Promise<{ branchName: string; prUrl: string; prNumber: number }> {
    const { item, change, repoRoot } = options;

    const baseBranch = typeof options.baseBranch === 'string' && options.baseBranch.trim()
        ? options.baseBranch.trim()
        : undefined;
    if (baseBranch !== undefined && !isSafeBranchName(baseBranch)) {
        throw new Error('Invalid baseBranch');
    }

    const branchName = (typeof options.branchName === 'string' ? options.branchName.trim() : undefined)
        || `coc/work-items/${sanitizeBranchSegment(item.title)}-${Date.now().toString(36)}`;
    if (!isSafeBranchName(branchName)) {
        throw new Error('Invalid branchName');
    }

    const title = typeof options.title === 'string' && options.title.trim()
        ? options.title.trim()
        : item.title;
    const body = typeof options.body === 'string' && options.body.trim()
        ? options.body.trim()
        : buildPrBody(item, change);

    // `change.commits` is newest-first; the service cherry-picks oldest-first.
    const created = await createPullRequest({
        repoRoot,
        title,
        body,
        base: baseBranch,
        commits: [...change.commits].reverse().map(commit => commit.sha),
        branch: branchName,
        autoMerge: false,
    }, { runCommand: options.runCommand, tempDir: options.tempDir });
    return { branchName: created.branch, prUrl: created.url, prNumber: created.id };
}

export async function submitWorkItemPrCommand(
    ctx: WorkItemExecutionCommandContext,
    input: SubmitWorkItemPrCommandInput,
): Promise<SubmitWorkItemPrCommandResult> {
    const runCommand = ctx.runCommand ?? defaultWorkItemCommandRunner;
    const item = await requireWorkItem(ctx, input);

    if (!isLocalOnlyWorkflowLeaf(item)) {
        throw badRequest('PR submission is only available for local-only Work Items and Goals');
    }
    if (item.status !== 'aiDone') {
        throw badRequest(`Cannot submit PR in status '${item.status}'. Work item must be in Review.`);
    }

    const change = findSubmitPrChange(item, input.changeId);
    if (!change) {
        throw badRequest('No eligible execution commits are available for PR submission');
    }
    if (change.prUrl) {
        throw badRequest('This change already has a submitted PR');
    }
    if (change.commits.length === 0) {
        throw badRequest('No commits are available for PR submission');
    }

    const repoRoot = await workspaceRootPath(ctx, input.commandRepoId);
    if (!repoRoot) {
        throw badRequest('Workspace root is not available for PR submission');
    }

    const submitted = await submitWorkItemPullRequest({
        item,
        change,
        repoRoot,
        title: input.title,
        body: input.body,
        baseBranch: input.baseBranch,
        branchName: input.branchName,
        runCommand,
    });

    if (change.taskId) {
        // Link the execution chat to its PR. A failed link never fails the submission.
        await recordPullRequestBinding(ctx.processStore, input.commandRepoId, change.taskId, submitted.prNumber)
            .catch(err => getLogger().warn(
                LogCategory.AI,
                `[WorkItems] Could not link PR ${submitted.prUrl} to ${change.taskId}: ${err instanceof Error ? err.message : String(err)}`,
            ));
    }

    const completedAt = new Date().toISOString();
    await ctx.workItemStore.updateChange(input.workItemId, change.id, {
        branchName: submitted.branchName,
        prNumber: submitted.prNumber,
        prUrl: submitted.prUrl,
        prStatus: 'open',
    }, input.storageRepoId);
    if (change.taskId) {
        await ctx.workItemStore.updateExecution(input.workItemId, change.taskId, { prUrl: submitted.prUrl }, input.storageRepoId);
    }
    const updated = await ctx.workItemStore.updateWorkItem(input.workItemId, {
        status: 'done',
        completedAt,
    }, input.storageRepoId);
    if (!updated) {
        throw notFound('Work item');
    }

    settleWorkItemBroadcast(ctx, input.storageRepoId, updated);
    return {
        workItem: updated,
        changeId: change.id,
        branchName: submitted.branchName,
        prNumber: submitted.prNumber,
        prUrl: submitted.prUrl,
        prStatus: 'open',
    };
}
