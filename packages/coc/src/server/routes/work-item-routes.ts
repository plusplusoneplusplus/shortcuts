/**
 * Work Item REST API Routes
 *
 * CRUD operations for CoC work items.
 *
 * Routes:
 *   GET    /api/workspaces/:id/work-items              — List work items (with filters)
 *   POST   /api/workspaces/:id/work-items              — Create work item
 *   GET    /api/workspaces/:id/work-items/:workItemId   — Get work item detail
 *   PATCH  /api/workspaces/:id/work-items/:workItemId   — Update work item
 *   DELETE /api/workspaces/:id/work-items/:workItemId   — Delete work item
 */

import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { execGit } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, missingFields, notFound, badRequest, conflict } from '../errors';
import type { WorkItemStore, WorkItemFilter, WorkItemStatus, WorkItemSource, WorkItemPriority, WorkItemType, WorkItem } from '../work-items/types';
import { WORK_ITEM_STATUSES, WORK_ITEM_TYPES, isValidTransition } from '../work-items/types';
import { executeWorkItem, type EnqueueFunction } from '../work-items/work-item-executor';
import type { ProcessWebSocketServer } from '../streaming/websocket';

const VALID_SOURCES: Set<string> = new Set(['manual', 'chat', 'schedule']);
const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);
const VALID_TYPES: Set<string> = new Set(['work-item', 'bug']);

export interface WorkItemRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    enqueue?: EnqueueFunction;
    getWsServer?: () => ProcessWebSocketServer;
}

export function registerWorkItemRoutes(ctx: WorkItemRouteContext): void {
    const { routes, workItemStore, processStore, enqueue, getWsServer } = ctx;

    // GET /api/workspaces/:id/work-items — List with optional filters
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const parsed = url.parse(req.url || '/', true);
            const query = parsed.query;

            const filter: WorkItemFilter = { repoId };
            if (typeof query.status === 'string' && query.status) {
                const statuses = query.status.split(',').filter(s => WORK_ITEM_STATUSES.includes(s as WorkItemStatus));
                if (statuses.length === 1) {
                    filter.status = statuses[0] as WorkItemStatus;
                } else if (statuses.length > 1) {
                    filter.status = statuses as WorkItemStatus[];
                }
            }
            if (typeof query.source === 'string' && VALID_SOURCES.has(query.source)) {
                filter.source = query.source as WorkItemSource;
            }
            if (typeof query.priority === 'string' && VALID_PRIORITIES.has(query.priority)) {
                filter.priority = query.priority as WorkItemPriority;
            }
            if (typeof query.tags === 'string' && query.tags) {
                filter.tags = query.tags.split(',');
            }
            if (typeof query.type === 'string' && VALID_TYPES.has(query.type)) {
                filter.type = query.type as WorkItemType;
            }
            if (typeof query.q === 'string' && query.q.trim()) {
                filter.search = query.q.trim();
            }
            if (typeof query.offset === 'string') {
                const n = parseInt(query.offset, 10);
                if (!isNaN(n) && n >= 0) filter.offset = n;
            }
            if (typeof query.limit === 'string') {
                const n = parseInt(query.limit, 10);
                if (!isNaN(n) && n > 0) filter.limit = n;
            }

            const result = await workItemStore.listWorkItems(filter);
            const hasMore = (filter.offset ?? 0) + result.items.length < result.total;
            sendJSON(res, 200, { items: result.items, total: result.total, hasMore });
        },
    });

    // GET /api/workspaces/:id/work-items/grouped — List grouped by status with per-group pagination
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/grouped$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const parsed = url.parse(req.url || '/', true);
            const query = parsed.query;

            const filter: WorkItemFilter = { repoId };
            if (typeof query.source === 'string' && VALID_SOURCES.has(query.source)) {
                filter.source = query.source as WorkItemSource;
            }
            if (typeof query.priority === 'string' && VALID_PRIORITIES.has(query.priority)) {
                filter.priority = query.priority as WorkItemPriority;
            }
            if (typeof query.tags === 'string' && query.tags) {
                filter.tags = query.tags.split(',');
            }
            if (typeof query.type === 'string' && VALID_TYPES.has(query.type)) {
                filter.type = query.type as WorkItemType;
            }
            if (typeof query.q === 'string' && query.q.trim()) {
                filter.search = query.q.trim();
            }
            if (typeof query.limit === 'string') {
                const n = parseInt(query.limit, 10);
                if (!isNaN(n) && n > 0) filter.limit = n;
            }

            const result = await workItemStore.listWorkItemsGrouped(filter);
            // Add hasMore to each group
            const groups: Record<string, { items: any[]; total: number; hasMore: boolean }> = {};
            for (const [status, group] of Object.entries(result.groups)) {
                groups[status] = {
                    items: group.items,
                    total: group.total,
                    hasMore: group.items.length < group.total,
                };
            }
            sendJSON(res, 200, { groups });
        },
    });

    // POST /api/workspaces/:id/work-items — Create work item
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const missing: string[] = [];
            if (!body.title) missing.push('title');
            if (missing.length) {
                return handleAPIError(res, missingFields(missing));
            }

            const now = new Date().toISOString();
            const item: WorkItem = {
                id: body.id || crypto.randomUUID(),
                repoId,
                title: body.title,
                description: body.description || '',
                status: 'created',
                type: VALID_TYPES.has(body.type) ? body.type : undefined,
                createdAt: now,
                updatedAt: now,
                source: VALID_SOURCES.has(body.source) ? body.source : 'manual',
                sourceId: body.sourceId,
                priority: VALID_PRIORITIES.has(body.priority) ? body.priority : undefined,
                tags: Array.isArray(body.tags) ? body.tags : undefined,
                autoExecute: body.autoExecute === true,
            };

            if (body.plan?.content) {
                item.plan = {
                    version: 1,
                    content: body.plan.content,
                    updatedAt: now,
                    resolvedBy: body.plan.resolvedBy || 'user',
                };
            }

            try {
                await workItemStore.addWorkItem(item);
            } catch (err: any) {
                if (err?.message?.includes('already exists')) {
                    return handleAPIError(res, conflict(err.message));
                }
                throw err;
            }

            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-added', workspaceId: repoId, item });
            sendJSON(res, 201, item);
        },
    });

    // GET /api/workspaces/:id/work-items/:workItemId — Get detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }
            sendJSON(res, 200, item);
        },
    });

    // PATCH /api/workspaces/:id/work-items/:workItemId — Update work item
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            // Validate status transition if status is being changed
            if (body.status) {
                if (!WORK_ITEM_STATUSES.includes(body.status)) {
                    return handleAPIError(res, badRequest(`Invalid status: ${body.status}`));
                }
                const current = await workItemStore.getWorkItem(workItemId, repoId);
                if (!current) {
                    return handleAPIError(res, notFound('Work item'));
                }
                if (current.status !== body.status && !isValidTransition(current.status, body.status)) {
                    return handleAPIError(res, badRequest(
                        `Invalid status transition: ${current.status} → ${body.status}`
                    ));
                }
            }

            const updates: Partial<WorkItem> = {};
            if (body.title !== undefined) updates.title = body.title;
            if (body.description !== undefined) updates.description = body.description;
            if (body.status !== undefined) updates.status = body.status;
            if (body.priority !== undefined) updates.priority = body.priority;
            if (body.tags !== undefined) updates.tags = body.tags;
            if (body.autoExecute !== undefined) updates.autoExecute = body.autoExecute;
            if (body.completedAt !== undefined) updates.completedAt = body.completedAt;
            if (body.reviewComments !== undefined) updates.reviewComments = body.reviewComments;

            const updated = await workItemStore.updateWorkItem(workItemId, updates);
            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            // Auto-execute if status transitioned to 'readyToExecute' and autoExecute is enabled
            if (updated.status === 'readyToExecute' && updated.autoExecute && enqueue) {
                try {
                    // Capture git HEAD before execution for commit range tracking
                    let headBefore: string | undefined;
                    try {
                        const workspaces = await processStore.getWorkspaces();
                        const workspace = workspaces.find(w => w.id === repoId);
                        if (workspace?.rootPath) {
                            headBefore = execGit(['rev-parse', 'HEAD'], workspace.rootPath);
                        }
                    } catch { /* non-fatal */ }

                    await executeWorkItem(workItemId, workItemStore, enqueue, { headBefore });
                    const afterExec = await workItemStore.getWorkItem(workItemId);
                    if (afterExec) {
                        getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: afterExec });
                        return sendJSON(res, 200, afterExec);
                    }
                } catch {
                    // Auto-execute failed; still return the updated work item
                }
            }

            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            sendJSON(res, 200, updated);
        },
    });

    // POST /api/workspaces/:id/work-items/:workItemId/request-changes — Incorporate review comments into plan, transition to readyToExecute
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/request-changes$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const comments = body.comments;
            if (!Array.isArray(comments) || comments.length === 0) {
                return handleAPIError(res, badRequest('At least one comment is required'));
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            if (item.status !== 'aiDone') {
                return handleAPIError(res, badRequest(
                    `Cannot request changes in status '${item.status}'. Work item must be in 'aiDone' status.`
                ));
            }

            // Build new plan version incorporating the comments
            const now = new Date().toISOString();
            const currentPlan = item.plan?.content || '';
            const source: string | undefined = body.source; // 'diff-comments' | undefined
            const commentBlock = comments.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n');
            const heading = source === 'diff-comments'
                ? '## Diff Review Comments (to address)'
                : '## Review Comments (to address)';
            const newContent = currentPlan + '\n\n' + heading + '\n\n' + commentBlock;
            const newVersion = (item.plan?.version ?? 0) + 1;

            const planVersion = {
                version: newVersion,
                content: newContent,
                createdAt: now,
                resolvedBy: 'user' as const,
                summary: source === 'diff-comments'
                    ? `Incorporated ${comments.length} diff review comment(s)`
                    : `Incorporated ${comments.length} review comment(s)`,
            };

            await workItemStore.savePlanVersion(workItemId, planVersion);
            const updated = await workItemStore.updateWorkItem(workItemId, {
                status: 'readyToExecute',
                plan: {
                    version: newVersion,
                    content: newContent,
                    updatedAt: now,
                    resolvedBy: 'user',
                },
                reviewComments: [],
            });

            if (updated) {
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            }

            sendJSON(res, 200, { plan: planVersion, newVersion });
        },
    });

    // DELETE /api/workspaces/:id/work-items/:workItemId — Delete work item
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const removed = await workItemStore.removeWorkItem(workItemId);
            if (!removed) {
                return handleAPIError(res, notFound('Work item'));
            }
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-removed', workspaceId: repoId, itemId: workItemId });
            sendJSON(res, 204, null);
        },
    });

    // PATCH /api/workspaces/:id/work-items/:workItemId/pin — Pin/unpin work item
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/pin$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const pinned = body.pinned;
            if (typeof pinned !== 'boolean') {
                return handleAPIError(res, badRequest('Missing or invalid "pinned" field (boolean)'));
            }

            let updated: WorkItem | undefined;
            if (pinned) {
                updated = await workItemStore.pinWorkItem(workItemId, new Date().toISOString());
            } else {
                updated = await workItemStore.unpinWorkItem(workItemId);
            }

            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            sendJSON(res, 200, updated);
        },
    });

    // PATCH /api/workspaces/:id/work-items/:workItemId/archive — Archive/unarchive work item
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/archive$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            const archived = body.archived;
            if (typeof archived !== 'boolean') {
                return handleAPIError(res, badRequest('Missing or invalid "archived" field (boolean)'));
            }

            let updated: WorkItem | undefined;
            if (archived) {
                updated = await workItemStore.archiveWorkItem(workItemId, new Date().toISOString());
            } else {
                updated = await workItemStore.unarchiveWorkItem(workItemId);
            }

            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            sendJSON(res, 200, updated);
        },
    });
}
