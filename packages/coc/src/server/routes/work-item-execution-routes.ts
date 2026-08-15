/**
 * Work Item Execution & Chat Integration Routes
 *
 * Routes:
 *   POST /api/workspaces/:id/work-items/:wid/execute             — Execute work item as queue task
 *   POST /api/workspaces/:id/work-items/:wid/submit-pr           — Submit execution commits as a PR
 *   POST /api/workspaces/:id/work-items/:wid/ai-review           — Start optional review chat
 *   POST /api/workspaces/:id/work-items/:wid/resolve-comments    — Resolve comments as a Run# session
 *   POST /api/workspaces/:id/work-items/from-chat                — Create work item from chat session
 *
 * Handlers stay thin: parse the request (scope + shared AI setting parsers),
 * call the matching command service in `../work-items/`, then render the result
 * or the {@link APIError} the command threw.
 */

import * as http from 'http';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../core/api-handler';
import { APIError, handleAPIError, badRequest } from '../errors';
import {
    queryWorkspaceId,
    resolveWorkItemRouteScope,
    type WorkItemRouteScope,
    type WorkItemRouteScopeKind,
} from './work-item-route-scope';
import type { WorkItemStore } from '../work-items/types';
import type { EnqueueFunction } from '../work-items/work-item-executor';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { TaskCommentsManager } from '../tasks/comments/task-comments-manager';
import { DiffCommentsManager } from '../tasks/comments/diff-comments-manager';
import { parseWorktreeExecutionRequest } from '../worktree/worktree-request';
import {
    parseSkillNamesField,
    parseExecutionModeField,
    parseWorkItemAiSettings,
} from '../work-items/work-item-execution-settings';
import type {
    WorkItemCommandOptions,
    WorkItemCommandResult,
    WorkItemCommandRunner,
    WorkItemExecutionCommandContext,
} from '../work-items/work-item-execution-shared';
import { executeWorkItemCommand } from '../work-items/work-item-execution-command';
import { submitWorkItemPrCommand } from '../work-items/work-item-pr-submission-command';
import { startWorkItemAiReviewCommand } from '../work-items/work-item-ai-review-command';
import {
    parseCommentResolutionType,
    resolveWorkItemCommentsCommand,
    type WorkItemCommentResolutionContext,
} from '../work-items/work-item-comment-resolution-command';
import { createWorkItemFromChatCommand } from '../work-items/work-item-from-chat-command';

export type { WorkItemCommandOptions, WorkItemCommandResult, WorkItemCommandRunner };

const WORK_ITEM_EXECUTE_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/execute$/;
const WORK_ITEM_SUBMIT_PR_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/submit-pr$/;
const WORK_ITEM_AI_REVIEW_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/ai-review$/;
const WORK_ITEM_RESOLVE_COMMENTS_PATTERN = /^\/api\/(workspaces|origins)\/([^/]+)\/work-items\/([^/]+)\/resolve-comments$/;

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

/**
 * Render a command failure. {@link APIError}s (404/409/…) keep their status;
 * anything else becomes a 400 with the original message, matching the legacy
 * route behavior.
 */
function handleCommandError(res: http.ServerResponse, err: unknown, fallbackMessage?: string): void {
    if (err instanceof APIError) {
        return handleAPIError(res, err);
    }
    const message = err instanceof Error ? err.message : String(err);
    return handleAPIError(res, badRequest(message || fallbackMessage || 'Command failed'));
}

export function registerWorkItemExecutionRoutes(ctx: WorkItemExecutionRouteContext): void {
    const { routes, dataDir, getWorkflowEnabled } = ctx;
    const commandCtx: WorkItemExecutionCommandContext = ctx;
    const commentCtx: WorkItemCommentResolutionContext = {
        ...ctx,
        taskCommentsManager: new TaskCommentsManager(dataDir ?? ''),
        diffCommentsManager: new DiffCommentsManager(dataDir ?? ''),
    };

    // POST /api/origins/:originId/work-items/:wid/execute — Execute work item
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_EXECUTE_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);

            if (!ctx.enqueue) {
                return handleAPIError(res, badRequest('Task execution is not available'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            try {
                const scope = await resolveExecutionRouteScope(ctx, req, routeKind, routeScopeId, body);
                const worktree = parseWorktreeExecutionRequest(body.worktree);
                if (!worktree.ok) {
                    return handleAPIError(res, badRequest(worktree.error));
                }
                const result = await executeWorkItemCommand(commandCtx, {
                    workItemId,
                    storageRepoId: scope.storageRepoId,
                    commandRepoId: scope.commandRepoId,
                    settings: parseWorkItemAiSettings(body),
                    skillNames: parseSkillNamesField(body.skillNames),
                    worktree: worktree.value,
                    executionMode: parseExecutionModeField(body.executionMode),
                    mode: body.mode,
                });
                sendJSON(res, 200, result);
            } catch (err) {
                return handleCommandError(res, err);
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

            try {
                const scope = await resolveExecutionRouteScope(ctx, req, routeKind, routeScopeId, body);
                const result = await submitWorkItemPrCommand(commandCtx, {
                    workItemId,
                    storageRepoId: scope.storageRepoId,
                    commandRepoId: scope.commandRepoId,
                    changeId: body.changeId,
                    title: body.title,
                    body: body.body,
                    baseBranch: body.baseBranch,
                    branchName: body.branchName,
                });
                sendJSON(res, 200, result);
            } catch (err) {
                return handleCommandError(res, err, 'Failed to submit PR');
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
            if (!ctx.enqueue) {
                return handleAPIError(res, badRequest('Task execution is not available'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            try {
                const scope = await resolveExecutionRouteScope(ctx, req, routeKind, routeScopeId, body);
                const result = await startWorkItemAiReviewCommand(commandCtx, {
                    workItemId,
                    storageRepoId: scope.storageRepoId,
                    commandRepoId: scope.commandRepoId,
                    settings: parseWorkItemAiSettings(body),
                });
                sendJSON(res, 200, result);
            } catch (err) {
                return handleCommandError(res, err, 'Failed to start AI review');
            }
        },
    });

    // POST /api/origins/:originId/work-items/:wid/resolve-comments — Resolve comments as Run#
    routes.push({
        method: 'POST',
        pattern: WORK_ITEM_RESOLVE_COMMENTS_PATTERN,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const routeKind = match![1] as WorkItemRouteScopeKind;
            const routeScopeId = decodeURIComponent(match![2]);
            const workItemId = decodeURIComponent(match![3]);

            if (!ctx.enqueue) {
                return handleAPIError(res, badRequest('Task execution is not available'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            try {
                const scope = await resolveExecutionRouteScope(ctx, req, routeKind, routeScopeId, body);
                const result = await resolveWorkItemCommentsCommand(
                    commentCtx,
                    {
                        workItemId,
                        storageRepoId: scope.storageRepoId,
                        commandRepoId: scope.commandRepoId,
                        type: parseCommentResolutionType(body.type),
                        commitSha: body.commitSha,
                        sourceRunIndex: body.sourceRunIndex,
                        model: body.model,
                    },
                );
                sendJSON(res, 200, result);
            } catch (err) {
                return handleCommandError(res, err);
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

            try {
                const item = await createWorkItemFromChatCommand(commandCtx, {
                    repoId,
                    processId: body.processId,
                    id: body.id,
                    title: body.title,
                    description: body.description,
                    priority: body.priority,
                    tags: body.tags,
                    extractPlan: !!body.extractPlan,
                });
                sendJSON(res, 201, item);
            } catch (err) {
                return handleCommandError(res, err);
            }
        },
    });
}
