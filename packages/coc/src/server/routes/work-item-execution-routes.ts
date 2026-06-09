/**
 * Work Item Execution & Chat Integration Routes
 *
 * Routes:
 *   POST /api/workspaces/:id/work-items/:wid/execute             — Execute work item as queue task
 *   POST /api/workspaces/:id/work-items/:wid/resolve-comments    — Resolve comments as a Run# session
 *   POST /api/workspaces/:id/work-items/from-chat                — Create work item from chat session
 */

import * as http from 'http';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { execGit } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import type { WorkItemStore, WorkItem } from '../work-items/types';
import { HIERARCHY_CONTAINER_TYPES } from '../work-items/types';
import { executeWorkItem, resolveWorkItemComments, type EnqueueFunction } from '../work-items/work-item-executor';
import { upsertWorkItemTaskFile } from '../work-items/work-item-task-file';
import { buildPlanFromContext } from '../work-items/plan-template';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { TaskCommentsManager } from '../tasks/comments/task-comments-manager';
import { DiffCommentsManager } from '../tasks/comments/diff-comments-manager';
import { buildBatchResolvePrompt } from '../tasks/comments/task-comments-ai';
import { buildMultiFileBatchResolvePrompt } from '../tasks/comments/diff-comments-ai';
import { VALID_CHAT_PROVIDERS, VALID_REASONING_EFFORTS, type ChatProvider, type ReasoningEffort } from '../tasks/task-types';
import { clearWorkItemResponseCacheForWorkspace } from '../work-items/work-item-response-cache';

const VALID_EFFORT_TIERS = new Set(['very-low', 'low', 'medium', 'high']);

export interface WorkItemExecutionRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    enqueue?: EnqueueFunction;
    getWsServer?: () => ProcessWebSocketServer;
    /** CoC data directory (e.g. ~/.coc). When provided, a placeholder task file is
     *  created in the workspace tasks folder as soon as execution is enqueued so that
     *  the Tasks panel shows live activity immediately. */
    dataDir?: string;
}

export function registerWorkItemExecutionRoutes(ctx: WorkItemExecutionRouteContext): void {
    const { routes, workItemStore, processStore, enqueue, getWsServer, dataDir } = ctx;

    // POST /api/workspaces/:id/work-items/:wid/execute — Execute work item
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/execute$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            if (!enqueue) {
                return handleAPIError(res, badRequest('Task execution is not available'));
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            // Only leaf types (work-item, bug) can be executed.
            const effectiveType = item.type ?? 'work-item';
            if (HIERARCHY_CONTAINER_TYPES.has(effectiveType)) {
                return handleAPIError(res, badRequest(`Only WorkItem and Bug items can be executed. "${effectiveType}" is a planning container.`));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            // Capture git HEAD before execution for commit range tracking
            let headBefore: string | undefined;
            try {
                const workspaces = await processStore.getWorkspaces();
                const workspace = workspaces.find(w => w.id === repoId);
                if (workspace?.rootPath) {
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

                const result = await executeWorkItem(workItemId, workItemStore, enqueue, {
                    model: body.model,
                    provider,
                    reasoningEffort,
                    effortTier,
                    autoProviderRouting: body.autoProviderRouting === true,
                    mode: body.mode,
                    headBefore,
                    taskFilePath,
                    skillNames: skillNames?.length ? skillNames : undefined,
                });
                const updatedItem = await workItemStore.getWorkItem(workItemId);
                if (updatedItem) {
                    clearWorkItemResponseCacheForWorkspace(repoId);
                    getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updatedItem });
                }
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest(err.message));
            }
        },
    });

    // POST /api/workspaces/:id/work-items/:wid/resolve-comments — Resolve comments as Run#
    const taskCommentsManager = new TaskCommentsManager(dataDir ?? '');
    const diffCommentsManager = new DiffCommentsManager(dataDir ?? '');

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/resolve-comments$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            if (!enqueue) {
                return handleAPIError(res, badRequest('Task execution is not available'));
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            // Only leaf types (work-item, bug) can run resolve-comments.
            const effectiveResolveType = item.type ?? 'work-item';
            if (HIERARCHY_CONTAINER_TYPES.has(effectiveResolveType)) {
                return handleAPIError(res, badRequest(`Only WorkItem and Bug items can have comments resolved. "${effectiveResolveType}" is a planning container.`));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
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

                    const updatedItem = await workItemStore.getWorkItem(workItemId);
                    if (updatedItem) {
                        clearWorkItemResponseCacheForWorkspace(repoId);
                        getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updatedItem });
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

                    const updatedItem = await workItemStore.getWorkItem(workItemId);
                    if (updatedItem) {
                        clearWorkItemResponseCacheForWorkspace(repoId);
                        getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updatedItem });
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

            clearWorkItemResponseCacheForWorkspace(repoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-added', workspaceId: repoId, item });
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
