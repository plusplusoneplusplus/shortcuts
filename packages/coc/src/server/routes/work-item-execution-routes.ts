/**
 * Work Item Execution & Chat Integration Routes
 *
 * Routes:
 *   POST /api/workspaces/:id/work-items/:wid/execute             — Execute work item as queue task
 *   POST /api/workspaces/:id/work-items/:wid/ai-review           — Start optional review chat
 *   POST /api/workspaces/:id/work-items/:wid/resolve-comments    — Resolve comments as a Run# session
 *   POST /api/workspaces/:id/work-items/from-chat                — Create work item from chat session
 */

import * as http from 'http';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { execGit } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import {
    queryWorkspaceId,
    resolveWorkItemRouteScope,
    type WorkItemRouteScope,
    type WorkItemRouteScopeKind,
} from './work-item-route-scope';
import type { WorkItemStore, WorkItem, WorkItemChange } from '../work-items/types';
import { getOwnWorkItemTrackerKind, HIERARCHY_CONTAINER_TYPES } from '../work-items/types';
import { executeWorkItem, resolveWorkItemComments, type EnqueueFunction } from '../work-items/work-item-executor';
import { upsertWorkItemTaskFile } from '../work-items/work-item-task-file';
import { buildPlanFromContext } from '../work-items/plan-template';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { TaskCommentsManager } from '../tasks/comments/task-comments-manager';
import { DiffCommentsManager } from '../tasks/comments/diff-comments-manager';
import { buildBatchResolvePrompt } from '../tasks/comments/task-comments-ai';
import { buildMultiFileBatchResolvePrompt } from '../tasks/comments/diff-comments-ai';
import { VALID_CHAT_PROVIDERS, VALID_REASONING_EFFORTS, type ChatProvider, type ReasoningEffort } from '../tasks/task-types';
import {
    clearWorkItemResponseCacheForWorkspace,
    clearWorkItemResponseCacheForWorkspaces,
    resolveWorkItemResponseCacheWorkspaceIds,
} from '../work-items/work-item-response-cache';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';
import { parseWorktreeExecutionRequest } from '../worktree/worktree-request';
import { GitWorktreeService } from '../worktree/worktree-service';

const VALID_EFFORT_TIERS = new Set(['very-low', 'low', 'medium', 'high']);
const execFileAsync = promisify(execFile);
const WORK_ITEM_EXECUTE_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/execute$/;
const WORK_ITEM_SUBMIT_PR_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/submit-pr$/;
const WORK_ITEM_AI_REVIEW_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/ai-review$/;
const WORK_ITEM_RESOLVE_COMMENTS_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/resolve-comments$/;

export interface WorkItemCommandResult {
    stdout: string;
    stderr: string;
}

export interface WorkItemCommandOptions {
    cwd: string;
}

export interface WorkItemCommandRunner {
    (command: string, args: string[], options: WorkItemCommandOptions): Promise<WorkItemCommandResult>;
}

async function defaultCommandRunner(command: string, args: string[], options: WorkItemCommandOptions): Promise<WorkItemCommandResult> {
    const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

function isLocalOnlyWorkflowLeaf(item: WorkItem): boolean {
    const effectiveType = item.type ?? 'work-item';
    return (effectiveType === 'work-item' || effectiveType === 'goal')
        && getOwnWorkItemTrackerKind(item) === 'local-only'
        && !item.githubMirror
        && !item.azureBoardsMirror;
}

function findSubmitPrChange(item: WorkItem, requestedChangeId: unknown): WorkItemChange | undefined {
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

function findLatestImplementationExecution(item: WorkItem): { execution: NonNullable<WorkItem['executionHistory']>[number]; index: number } | undefined {
    return item.executionHistory
        ?.map((execution, index) => ({ execution, index }))
        .filter(({ execution }) => execution.status === 'completed' && execution.sessionCategory !== 'resolve-plan-comments' && execution.sessionCategory !== 'resolve-commit-comments' && execution.sessionCategory !== 'work-item-ai-review')
        .at(-1);
}

function buildWorkItemReviewPrompt(item: WorkItem, change: WorkItemChange | undefined, execution: NonNullable<WorkItem['executionHistory']>[number] | undefined): string {
    const effectiveType = item.type ?? 'work-item';
    const lines = [
        `# Work Item AI Review: ${item.title}`,
        '',
        'Review the implementation produced for this local Work Item workflow run. Do not modify files, create commits, or submit pull requests. Focus only on correctness, regressions, security, acceptance-criteria alignment, and important maintainability risks.',
        '',
        '## Work Item',
        `- ID: ${item.id}`,
        ...(item.workItemNumber != null ? [`- Number: ${item.workItemNumber}`] : []),
        `- Type: ${effectiveType}`,
        `- Status: ${item.status}`,
        ...(item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version ? [`- Content version: v${item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version}`] : []),
        '',
    ];

    if (item.description?.trim()) {
        lines.push('## Description', item.description.trim(), '');
    }
    if (item.plan?.content?.trim()) {
        lines.push('## Current Version Content', item.plan.content.trim(), '');
    }
    if (execution) {
        lines.push(
            '## Execution Under Review',
            `- Task: ${execution.taskId}`,
            ...(execution.processId ? [`- Process: ${execution.processId}`] : []),
            ...(execution.planVersion !== undefined ? [`- Version executed: v${execution.planVersion}`] : []),
            ...(execution.executionMode ? [`- Execution mode: ${execution.executionMode}`] : []),
            ...(execution.ralphSessionId ? [`- Ralph session: ${execution.ralphSessionId}`] : []),
            '',
        );
    }
    if (change) {
        lines.push('## Commits To Review');
        if (change.commits.length > 0) {
            for (const commit of change.commits) {
                lines.push(`- ${commit.sha} ${commit.message}`);
            }
        } else {
            lines.push('- No commits were recorded for this execution.');
        }
        lines.push('');
    }
    lines.push(
        '## Output Format',
        'Return Markdown with:',
        '- `## Review Summary`',
        '- `## Findings` with only actionable issues; include severity, file path, and line when possible',
        '- `## Verdict` as either `Approve` or `Request changes`',
    );
    return lines.join('\n');
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

function parsePrUrl(stdout: string): { prUrl: string; prNumber?: number } | undefined {
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

function bodyWorkspaceId(body: unknown): string | undefined {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const raw = (body as Record<string, unknown>).workspaceId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

async function resolveExecutionRouteScope(
    ctx: WorkItemExecutionRouteContext,
    req: http.IncomingMessage,
    kind: WorkItemRouteScopeKind,
    routeScopeId: string,
    body: unknown,
): Promise<WorkItemRouteScope> {
    const workspaceId = bodyWorkspaceId(body) ?? queryWorkspaceId(req);
    if (kind === 'origins' && !workspaceId) {
        throw badRequest('workspaceId is required for origin-scoped Work Item execution actions');
    }
    return resolveWorkItemRouteScope(ctx, kind, routeScopeId, workspaceId);
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

async function submitWorkItemPullRequest(options: {
    item: WorkItem;
    change: WorkItemChange;
    repoRoot: string;
    title?: string;
    body?: string;
    baseBranch?: string;
    branchName?: string;
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

    const branchName = options.branchName?.trim()
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

export interface WorkItemExecutionRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    enqueue?: EnqueueFunction;
    getWsServer?: () => ProcessWebSocketServer;
    getWorkflowEnabled?: () => boolean;
    /** Whether the opt-in Git worktree execution feature flag is enabled on this server. */
    getGitWorktreeExecutionEnabled?: () => boolean;
    runCommand?: WorkItemCommandRunner;
    /** CoC data directory (e.g. ~/.coc). When provided, a placeholder task file is
     *  created in the workspace tasks folder as soon as execution is enqueued so that
     *  the Tasks panel shows live activity immediately. */
    dataDir?: string;
}

export function registerWorkItemExecutionRoutes(ctx: WorkItemExecutionRouteContext): void {
    const { routes, workItemStore, processStore, enqueue, getWsServer, dataDir, getWorkflowEnabled, getGitWorktreeExecutionEnabled } = ctx;
    const runCommand = ctx.runCommand ?? defaultCommandRunner;

    // POST /api/origins/:originId/work-items/:wid/execute — Execute work item
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_EXECUTE_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);

            if (!enqueue) {
                return handleAPIError(res, badRequest('Task execution is not available'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveExecutionRouteScope(ctx, req, routeKind, routeScopeId, body);
            } catch (err) {
                return handleAPIError(res, err);
            }
            const repoId = scope.commandRepoId;

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            // Only leaf types (work-item, bug) can be executed.
            const effectiveType = item.type ?? 'work-item';
            if (HIERARCHY_CONTAINER_TYPES.has(effectiveType)) {
                return handleAPIError(res, badRequest(`Only WorkItem and Bug items can be executed. "${effectiveType}" is a planning container.`));
            }

            // Capture git HEAD before execution for commit range tracking, and
            // the source checkout path (used as the worktree base when requested).
            let headBefore: string | undefined;
            let sourceRepoRoot: string | undefined;
            try {
                const workspaces = await processStore.getWorkspaces();
                const workspace = workspaces.find(w => w.id === repoId);
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
                        dataDir, repoId, workItemId, item.title, 'in-progress',
                    );
                    // Notify the Tasks panel about the new file.
                    getWsServer?.()?.broadcastProcessEvent({
                        type: 'tasks-changed',
                        workspaceId: repoId,
                        timestamp: Date.now(),
                    });
                } catch { /* non-fatal — live visibility is best-effort */ }
            }

            try {
                const skillNames: string[] | undefined = Array.isArray(body.skillNames)
                    ? body.skillNames.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
                    : undefined;
                const provider: ChatProvider | undefined = body.provider === undefined
                    ? undefined
                    : typeof body.provider === 'string' && VALID_CHAT_PROVIDERS.has(body.provider as ChatProvider)
                        ? body.provider as ChatProvider
                        : undefined;
                if (body.provider !== undefined && !provider) {
                    return handleAPIError(res, badRequest(`Invalid provider: '${body.provider}'`));
                }
                const reasoningEffort: ReasoningEffort | undefined = body.reasoningEffort === undefined
                    ? undefined
                    : typeof body.reasoningEffort === 'string' && VALID_REASONING_EFFORTS.has(body.reasoningEffort as ReasoningEffort)
                        ? body.reasoningEffort as ReasoningEffort
                        : undefined;
                if (body.reasoningEffort !== undefined && !reasoningEffort) {
                    return handleAPIError(res, badRequest(`Invalid reasoningEffort: '${body.reasoningEffort}'`));
                }
                const effortTier: string | undefined = body.effortTier === undefined
                    ? undefined
                    : typeof body.effortTier === 'string' && VALID_EFFORT_TIERS.has(body.effortTier)
                        ? body.effortTier
                        : undefined;
                if (body.effortTier !== undefined && !effortTier) {
                    return handleAPIError(res, badRequest(`Invalid effortTier: '${body.effortTier}'`));
                }
                // Opt-in Git worktree request. Shape is validated here; the
                // worktree itself is created by a later wiring step. Omitting it
                // preserves existing behavior.
                const worktree = parseWorktreeExecutionRequest(body.worktree);
                if (!worktree.ok) {
                    return handleAPIError(res, badRequest(worktree.error));
                }
                const requestedExecutionMode = body.executionMode;
                if (requestedExecutionMode !== undefined && requestedExecutionMode !== 'one-shot' && requestedExecutionMode !== 'ralph') {
                    return handleAPIError(res, badRequest(`Invalid executionMode: '${requestedExecutionMode}'`));
                }
                const executionMode = requestedExecutionMode === undefined
                    ? (item.type === 'goal' && getWorkflowEnabled?.() === true ? 'ralph' : 'one-shot')
                    : requestedExecutionMode;
                if (executionMode === 'ralph') {
                    if (getWorkflowEnabled?.() !== true) {
                        return handleAPIError(res, badRequest('Ralph Work Item execution requires workItems.workflow.enabled'));
                    }
                    const isLocalOnlyWorkflowItem = (effectiveType === 'work-item' || effectiveType === 'goal')
                        && getOwnWorkItemTrackerKind(item) === 'local-only'
                        && !item.githubMirror
                        && !item.azureBoardsMirror;
                    if (!isLocalOnlyWorkflowItem) {
                        return handleAPIError(res, badRequest('Ralph Work Item execution is only available for local-only Work Items and Goals'));
                    }
                }
                const maxRalphIterations = executionMode === 'ralph' && dataDir
                    ? readRepoPreferences(dataDir, repoId).maxRalphIterations ?? RALPH_DEFAULT_MAX_ITERATIONS
                    : undefined;

                // Opt-in Git worktree execution: gate on the feature flag and
                // resolve the source checkout before handing the service to the
                // executor, which creates the worktree before queueing anything.
                let worktreeService: GitWorktreeService | undefined;
                if (worktree.value?.enabled) {
                    if (getGitWorktreeExecutionEnabled?.() !== true) {
                        return handleAPIError(res, badRequest('Git worktree execution is not enabled'));
                    }
                    if (!dataDir) {
                        return handleAPIError(res, badRequest('Git worktree execution is not available on this server'));
                    }
                    if (!sourceRepoRoot) {
                        return handleAPIError(res, badRequest('Workspace root is not available for worktree execution'));
                    }
                    worktreeService = new GitWorktreeService({ dataDir });
                }

                const result = await executeWorkItem(workItemId, workItemStore, enqueue, {
                    repoId: scope.storageRepoId,
                    workspaceId: repoId,
                    model: body.model,
                    provider,
                    reasoningEffort,
                    effortTier,
                    autoProviderRouting: body.autoProviderRouting === true,
                    executionMode,
                    mode: body.mode,
                    dataDir,
                    maxRalphIterations,
                    headBefore,
                    taskFilePath,
                    skillNames: skillNames?.length ? skillNames : undefined,
                    worktree: worktree.value,
                    worktreeService,
                    sourceRepoRoot,
                });
                const updatedItem = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
                if (updatedItem) {
                    clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
                    getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: scope.storageRepoId, item: updatedItem });
                }
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest(err.message));
            }
        },
    });

    // POST /api/origins/:originId/work-items/:wid/submit-pr — Create a PR from eligible execution commits
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_SUBMIT_PR_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);

            if (getWorkflowEnabled?.() !== true) {
                return handleAPIError(res, badRequest('Work Item PR submission requires workItems.workflow.enabled'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveExecutionRouteScope(ctx, req, routeKind, routeScopeId, body);
            } catch (err) {
                return handleAPIError(res, err);
            }
            const repoId = scope.commandRepoId;

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }
            if (!isLocalOnlyWorkflowLeaf(item)) {
                return handleAPIError(res, badRequest('PR submission is only available for local-only Work Items and Goals'));
            }
            if (item.status !== 'aiDone') {
                return handleAPIError(res, badRequest(`Cannot submit PR in status '${item.status}'. Work item must be in Review.`));
            }

            const change = findSubmitPrChange(item, body.changeId);
            if (!change) {
                return handleAPIError(res, badRequest('No eligible execution commits are available for PR submission'));
            }
            if (change.prUrl) {
                return handleAPIError(res, badRequest('This change already has a submitted PR'));
            }
            if (change.commits.length === 0) {
                return handleAPIError(res, badRequest('No commits are available for PR submission'));
            }

            let repoRoot: string | undefined;
            try {
                const workspaces = await processStore.getWorkspaces();
                repoRoot = workspaces.find(w => w.id === repoId)?.rootPath;
            } catch {
                repoRoot = undefined;
            }
            if (!repoRoot) {
                return handleAPIError(res, badRequest('Workspace root is not available for PR submission'));
            }

            try {
                const submitted = await submitWorkItemPullRequest({
                    item,
                    change,
                    repoRoot,
                    title: body.title,
                    body: body.body,
                    baseBranch: body.baseBranch,
                    branchName: body.branchName,
                    runCommand,
                });

                const completedAt = new Date().toISOString();
                await workItemStore.updateChange(workItemId, change.id, {
                    branchName: submitted.branchName,
                    prNumber: submitted.prNumber,
                    prUrl: submitted.prUrl,
                    prStatus: 'open',
                }, scope.storageRepoId);
                if (change.taskId) {
                    await workItemStore.updateExecution(workItemId, change.taskId, { prUrl: submitted.prUrl }, scope.storageRepoId);
                }
                const updated = await workItemStore.updateWorkItem(workItemId, {
                    status: 'done',
                    completedAt,
                }, scope.storageRepoId);
                if (!updated) {
                    return handleAPIError(res, notFound('Work item'));
                }

                clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: scope.storageRepoId, item: updated });
                sendJSON(res, 200, {
                    workItem: updated,
                    changeId: change.id,
                    branchName: submitted.branchName,
                    prNumber: submitted.prNumber,
                    prUrl: submitted.prUrl,
                    prStatus: 'open',
                });
            } catch (err: any) {
                return handleAPIError(res, badRequest(err.message || 'Failed to submit PR'));
            }
        },
    });

    // POST /api/origins/:originId/work-items/:wid/ai-review — Enqueue an explicit AI review for the Review state
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_AI_REVIEW_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);

            if (getWorkflowEnabled?.() !== true) {
                return handleAPIError(res, badRequest('Work Item AI review requires workItems.workflow.enabled'));
            }
            if (!enqueue) {
                return handleAPIError(res, badRequest('Task execution is not available'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveExecutionRouteScope(ctx, req, routeKind, routeScopeId, body);
            } catch (err) {
                return handleAPIError(res, err);
            }
            const repoId = scope.commandRepoId;

            const provider: ChatProvider | undefined = body.provider === undefined
                ? undefined
                : typeof body.provider === 'string' && VALID_CHAT_PROVIDERS.has(body.provider as ChatProvider)
                    ? body.provider as ChatProvider
                    : undefined;
            if (body.provider !== undefined && !provider) {
                return handleAPIError(res, badRequest(`Invalid provider: '${body.provider}'`));
            }
            const reasoningEffort: ReasoningEffort | undefined = body.reasoningEffort === undefined
                ? undefined
                : typeof body.reasoningEffort === 'string' && VALID_REASONING_EFFORTS.has(body.reasoningEffort as ReasoningEffort)
                    ? body.reasoningEffort as ReasoningEffort
                    : undefined;
            if (body.reasoningEffort !== undefined && !reasoningEffort) {
                return handleAPIError(res, badRequest(`Invalid reasoningEffort: '${body.reasoningEffort}'`));
            }
            const effortTier: string | undefined = body.effortTier === undefined
                ? undefined
                : typeof body.effortTier === 'string' && VALID_EFFORT_TIERS.has(body.effortTier)
                    ? body.effortTier
                    : undefined;
            if (body.effortTier !== undefined && !effortTier) {
                return handleAPIError(res, badRequest(`Invalid effortTier: '${body.effortTier}'`));
            }

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }
            if (!isLocalOnlyWorkflowLeaf(item)) {
                return handleAPIError(res, badRequest('AI review is only available for local-only Work Items and Goals'));
            }
            if (item.status !== 'aiDone') {
                return handleAPIError(res, badRequest(`Cannot start AI review in status '${item.status}'. Work item must be in Review.`));
            }
            const runningReview = item.executionHistory?.find(execution => execution.sessionCategory === 'work-item-ai-review' && execution.status === 'running');
            if (runningReview) {
                return handleAPIError(res, badRequest('An AI review is already running for this work item'));
            }

            const latestImplementation = findLatestImplementationExecution(item);
            const change = latestImplementation
                ? item.changes?.find(candidate => candidate.taskId === latestImplementation.execution.taskId)
                : undefined;
            const prompt = buildWorkItemReviewPrompt(item, change, latestImplementation?.execution);
            const runNumber = (item.executionHistory?.length ?? 0) + 1;
            const selectedVersion = item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version;
            try {
                const taskId = await enqueue({
                    type: 'run-workflow',
                    repoId,
                    priority: item.priority ?? 'normal',
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt,
                        workspaceId: repoId,
                        workItemStorageRepoId: scope.storageRepoId,
                        workItemId: item.id,
                        sessionCategory: 'work-item-ai-review',
                        ...(selectedVersion ? { planVersion: selectedVersion } : {}),
                        ...(provider ? { provider } : {}),
                        ...(reasoningEffort ? { reasoningEffort } : {}),
                        context: {
                            skills: ['code-review'],
                            workItemReview: {
                                workspaceId: repoId,
                                originId: scope.storageRepoId,
                                workItemId: item.id,
                                ...(latestImplementation ? { executionTaskId: latestImplementation.execution.taskId, executionRunIndex: latestImplementation.index + 1 } : {}),
                                ...(change ? { changeId: change.id, commits: change.commits.map(commit => commit.sha) } : {}),
                            },
                            ...(body.autoProviderRouting === true ? { autoProviderRouting: { requested: true } } : {}),
                        },
                    },
                    config: {
                        ...(body.model ? { model: body.model } : {}),
                        ...(reasoningEffort ? { reasoningEffort } : {}),
                        ...(effortTier ? { effortTier } : {}),
                    },
                    displayName: `Run #${runNumber}: AI Review`,
                });

                const startedAt = new Date().toISOString();
                await workItemStore.addExecution(workItemId, {
                    taskId,
                    startedAt,
                    status: 'running',
                    sessionCategory: 'work-item-ai-review',
                    title: 'AI Review',
                    kind: 'ai-review',
                    ...(selectedVersion ? { planVersion: selectedVersion } : {}),
                    ...(provider || body.model || reasoningEffort || effortTier || body.autoProviderRouting === true ? {
                        aiSettings: {
                            ...(provider ? { provider } : {}),
                            ...(body.model ? { model: body.model } : {}),
                            ...(reasoningEffort ? { reasoningEffort } : {}),
                            ...(effortTier ? { effortTier } : {}),
                            ...(body.autoProviderRouting === true ? { autoProviderRouting: true } : {}),
                        },
                    } : {}),
                    skillNames: ['code-review'],
                    ...(change ? { reviewedChangeId: change.id } : {}),
                    ...(latestImplementation ? { reviewedTaskId: latestImplementation.execution.taskId } : {}),
                }, scope.storageRepoId);

                const updatedItem = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
                if (updatedItem) {
                    clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
                    getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: scope.storageRepoId, item: updatedItem });
                }
                sendJSON(res, 200, { taskId, workItem: updatedItem });
            } catch (err: any) {
                return handleAPIError(res, badRequest(err.message || 'Failed to start AI review'));
            }
        },
    });

    // POST /api/origins/:originId/work-items/:wid/resolve-comments — Resolve comments as Run#
    const taskCommentsManager = new TaskCommentsManager(dataDir ?? '');
    const diffCommentsManager = new DiffCommentsManager(dataDir ?? '');

    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_RESOLVE_COMMENTS_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);

            if (!enqueue) {
                return handleAPIError(res, badRequest('Task execution is not available'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }
            let scope: WorkItemRouteScope;
            try {
                scope = await resolveExecutionRouteScope(ctx, req, routeKind, routeScopeId, body);
            } catch (err) {
                return handleAPIError(res, err);
            }
            const repoId = scope.commandRepoId;

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            // Only leaf types (work-item, bug) can run resolve-comments.
            const effectiveResolveType = item.type ?? 'work-item';
            if (HIERARCHY_CONTAINER_TYPES.has(effectiveResolveType)) {
                return handleAPIError(res, badRequest(`Only WorkItem and Bug items can have comments resolved. "${effectiveResolveType}" is a planning container.`));
            }

            const resolveType: 'plan' | 'commit' = body.type;
            if (resolveType !== 'plan' && resolveType !== 'commit') {
                return handleAPIError(res, badRequest('Missing or invalid field: type (must be "plan" or "commit")'));
            }

            try {
                if (resolveType === 'plan') {
                    // ── Plan comment resolve ──
                    const planCommentPath = `__wi-plan__/${workItemId}`;
                    const allComments = await taskCommentsManager.getComments(repoId, planCommentPath);
                    const openComments = allComments.filter(c => c.status === 'open');
                    if (openComments.length === 0) {
                        return handleAPIError(res, badRequest('No open plan comments to resolve'));
                    }

                    const documentContent = item.plan?.content ?? '';
                    const prompt = buildBatchResolvePrompt(openComments, planCommentPath, planCommentPath, undefined, documentContent);
                    const commentIds = openComments.map(c => c.id);

                    const result = await resolveWorkItemComments(workItemId, workItemStore, enqueue, {
                        type: 'plan',
                        repoId: scope.storageRepoId,
                        workspaceId: repoId,
                        model: body.model,
                        prompt,
                        resolveContext: {
                            files: [planCommentPath],
                            resolveComments: {
                                documentUri: planCommentPath,
                                commentIds,
                                documentContent,
                                filePath: planCommentPath,
                                wsId: repoId,
                            },
                        },
                    });

                    const updatedItem = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
                    if (updatedItem) {
                        clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
                        getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: scope.storageRepoId, item: updatedItem });
                    }
                    sendJSON(res, 200, result);
                } else {
                    // ── Commit comment resolve ──
                    const commitSha: string | undefined = body.commitSha;
                    if (!commitSha) {
                        return handleAPIError(res, badRequest('Missing required field: commitSha'));
                    }
                    const oldRef = `${commitSha}^`;
                    const newRef = commitSha;

                    const allComments = await diffCommentsManager.listAllComments(repoId);
                    let targetComments: Array<{ comment: any; storageKey: string }> = [];
                    for (const c of allComments) {
                        if (c.context.oldRef === oldRef && c.context.newRef === newRef) {
                            const sk = diffCommentsManager.hashContext(c.context);
                            targetComments.push({ comment: c, storageKey: sk });
                        }
                    }
                    targetComments = targetComments.filter(tc => tc.comment.status === 'open');

                    if (targetComments.length === 0) {
                        return handleAPIError(res, badRequest('No open diff comments for this commit'));
                    }

                    // Group by storageKey
                    const grouped = new Map<string, { storageKey: string; commentIds: string[]; filePath: string }>();
                    for (const tc of targetComments) {
                        const sk = tc.storageKey;
                        if (!grouped.has(sk)) {
                            grouped.set(sk, { storageKey: sk, commentIds: [], filePath: tc.comment.context.filePath });
                        }
                        grouped.get(sk)!.commentIds.push(tc.comment.id);
                    }
                    const files = Array.from(grouped.values());

                    const fileEntries = files.map(f => ({
                        filePath: f.filePath,
                        comments: targetComments
                            .filter(tc => tc.storageKey === f.storageKey)
                            .map(tc => tc.comment),
                    }));

                    const prompt = buildMultiFileBatchResolvePrompt(fileEntries, oldRef, newRef);
                    if (!prompt) {
                        return handleAPIError(res, badRequest('No open diff comments for this commit'));
                    }

                    // Resolve workspace root for file paths
                    let wsRootPath = process.cwd();
                    try {
                        const workspaces = await processStore.getWorkspaces();
                        const ws = workspaces.find(w => w.id === repoId);
                        if (ws?.rootPath) wsRootPath = ws.rootPath;
                    } catch { /* use cwd fallback */ }

                    const result = await resolveWorkItemComments(workItemId, workItemStore, enqueue, {
                        type: 'commit',
                        repoId: scope.storageRepoId,
                        workspaceId: repoId,
                        commitSha,
                        sourceRunIndex: body.sourceRunIndex,
                        model: body.model,
                        prompt,
                        resolveContext: {
                            files: files.map(f => path.resolve(wsRootPath, f.filePath)),
                            resolveDiffCommentsMulti: {
                                files,
                                wsId: repoId,
                                oldRef,
                                newRef,
                            },
                        },
                    });

                    const updatedItem = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
                    if (updatedItem) {
                        clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
                        getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: scope.storageRepoId, item: updatedItem });
                    }
                    sendJSON(res, 200, result);
                }
            } catch (err: any) {
                return handleAPIError(res, badRequest(err.message));
            }
        },
    });

    // POST /api/workspaces/:id/work-items/from-chat — Create work item from chat
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/from-chat$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            if (!body.processId) {
                return handleAPIError(res, badRequest('Missing required field: processId'));
            }

            // Look up the chat process to extract info
            const process = await processStore.getProcess(body.processId);
            if (!process) {
                return handleAPIError(res, notFound('Chat process'));
            }

            const title = body.title || process.title || process.promptPreview || 'Work item from chat';
            const description = body.description || extractDescriptionFromProcess(process);

            const now = new Date().toISOString();
            const item: WorkItem = {
                id: body.id || crypto.randomUUID(),
                repoId,
                title,
                description,
                status: 'planning',
                createdAt: now,
                updatedAt: now,
                source: 'chat',
                sourceId: body.processId,
                priority: body.priority || 'normal',
                tags: body.tags,
            };

            // Use AI result as plan when extractPlan is requested; otherwise auto-generate
            // a structured plan template populated with the work item's title and description.
            if (body.extractPlan && process.result) {
                item.plan = {
                    version: 1,
                    currentVersion: 1,
                    content: process.result,
                    updatedAt: now,
                    resolvedBy: 'ai',
                    source: 'ai',
                };
                item.currentContentVersion = 1;
            } else {
                item.plan = {
                    version: 1,
                    currentVersion: 1,
                    content: buildPlanFromContext(title, description),
                    updatedAt: now,
                    resolvedBy: 'user',
                    source: 'user',
                };
                item.currentContentVersion = 1;
            }

            await workItemStore.addWorkItem(item);

            // Persist the plan version record
            await workItemStore.savePlanVersion(item.id, {
                version: 1,
                content: item.plan.content,
                createdAt: now,
                resolvedBy: body.extractPlan && process.result ? 'ai' : 'user',
                source: body.extractPlan && process.result ? 'ai' : 'user',
                authorType: body.extractPlan && process.result ? 'ai' : 'user',
                reason: body.extractPlan && process.result
                    ? 'Extracted from chat session'
                    : 'Auto-generated plan template',
                summary: body.extractPlan && process.result
                    ? 'Extracted from chat session'
                    : 'Auto-generated plan template',
            });

            const scopeIds = await resolveWorkItemResponseCacheWorkspaceIds(workItemStore, repoId);
            clearWorkItemResponseCacheForWorkspaces(scopeIds);
            for (const scopeId of scopeIds) {
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-added', workspaceId: scopeId, item });
            }
            sendJSON(res, 201, item);
        },
    });
}

function extractDescriptionFromProcess(process: any): string {
    if (process.fullPrompt) {
        // Truncate to first 500 chars for description
        const full = process.fullPrompt;
        return full.length > 500 ? full.slice(0, 500) + '...' : full;
    }
    return process.promptPreview || '';
}
