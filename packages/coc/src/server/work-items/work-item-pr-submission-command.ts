/**
 * Owns the git choreography behind `POST .../work-items/:wid/submit-pr`:
 * eligibility checks, base-branch discovery, branch creation, cherry-picking,
 * push, `gh pr create`, cleanup/branch restoration on failure, and the Work
 * Item / change / execution settlement that follows a successful submission.
 *
 * All git and `gh` invocations go through the injected
 * {@link WorkItemCommandRunner} so the command sequence and its failure
 * behavior are testable without a real checkout. The default runner runs the
 * nine git commands in the native addon and only `gh pr create` as a child
 * process, so nothing here reads a git command's stderr on success.
 */

import { badRequest, notFound } from '../errors';
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

/** Extract the pull request URL (and number) from `gh pr create` output. */
export function parsePrUrl(stdout: string): { prUrl: string; prNumber?: number } | undefined {
    const prUrl = stdout
        .trim()
        .split(/\s+/)
        .find(token => /^https?:\/\/\S+\/pull\/\d+\/?$/.test(token));
    if (!prUrl) return undefined;
    const numberMatch = prUrl.match(/\/pull\/(\d+)\/?$/);
    return {
        prUrl,
        ...(numberMatch ? { prNumber: Number(numberMatch[1]) } : {}),
    };
}

async function resolveDefaultBaseBranch(repoRoot: string, runCommand: WorkItemCommandRunner): Promise<string> {
    try {
        const { stdout } = await runCommand('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: repoRoot });
        const trimmed = stdout.trim();
        if (trimmed.startsWith('origin/')) {
            return trimmed.slice('origin/'.length);
        }
    } catch {
        // Fall back to the common default branch when origin/HEAD is unavailable.
    }
    return 'main';
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
 * Run the git/gh sequence that turns a change's commits into an open PR.
 *
 * On any failure after the working branch is switched, an in-flight
 * cherry-pick is aborted and the original branch is restored before the error
 * propagates.
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
}): Promise<{ branchName: string; prUrl: string; prNumber?: number }> {
    const { item, change, repoRoot, runCommand } = options;
    const clean = await runCommand('git', ['status', '--porcelain'], { cwd: repoRoot });
    if (clean.stdout.trim()) {
        throw new Error('Cannot submit PR because the workspace has uncommitted changes');
    }

    const currentBranch = (await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot })).stdout.trim();
    if (!currentBranch || currentBranch === 'HEAD') {
        throw new Error('Cannot submit PR from a detached HEAD workspace');
    }

    const baseBranch = typeof options.baseBranch === 'string' && options.baseBranch.trim()
        ? options.baseBranch.trim()
        : await resolveDefaultBaseBranch(repoRoot, runCommand);
    if (!isSafeBranchName(baseBranch)) {
        throw new Error('Invalid baseBranch');
    }

    const branchName = (typeof options.branchName === 'string' ? options.branchName.trim() : undefined)
        ?? `coc/work-items/${sanitizeBranchSegment(item.title)}-${Date.now().toString(36)}`;
    if (!isSafeBranchName(branchName)) {
        throw new Error('Invalid branchName');
    }

    const title = typeof options.title === 'string' && options.title.trim()
        ? options.title.trim()
        : item.title;
    const body = typeof options.body === 'string' && options.body.trim()
        ? options.body.trim()
        : buildPrBody(item, change);

    let switched = false;
    try {
        await runCommand('git', ['fetch', 'origin', baseBranch], { cwd: repoRoot });
        await runCommand('git', ['switch', '-c', branchName, `origin/${baseBranch}`], { cwd: repoRoot });
        switched = true;
        for (const commit of [...change.commits].reverse()) {
            await runCommand('git', ['cherry-pick', commit.sha], { cwd: repoRoot });
        }
        await runCommand('git', ['push', '-u', 'origin', branchName], { cwd: repoRoot });
        const created = await runCommand('gh', ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch, '--head', branchName], { cwd: repoRoot });
        const parsed = parsePrUrl(`${created.stdout}\n${created.stderr}`);
        if (!parsed) {
            throw new Error('gh pr create did not return a pull request URL');
        }
        return { branchName, ...parsed };
    } catch (err) {
        if (switched) {
            await runCommand('git', ['cherry-pick', '--abort'], { cwd: repoRoot }).catch(() => {});
        }
        throw err;
    } finally {
        if (switched) {
            await runCommand('git', ['switch', currentBranch], { cwd: repoRoot }).catch(() => {});
        }
    }
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
