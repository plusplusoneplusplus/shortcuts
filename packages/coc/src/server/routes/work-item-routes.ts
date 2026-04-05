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
import { sendJSON, parseBody } from '../api-handler';
import { handleAPIError, missingFields, notFound, badRequest, conflict } from '../errors';
import type { WorkItemStore, WorkItemFilter, WorkItemStatus, WorkItemSource, WorkItemPriority } from '../work-items/types';
import { WORK_ITEM_STATUSES, isValidTransition } from '../work-items/types';
import type { WorkItem } from '../work-items/types';
import { executeWorkItem, type EnqueueFunction } from '../work-items/work-item-executor';
import type { ProcessWebSocketServer } from '../websocket';

const VALID_SOURCES: Set<string> = new Set(['manual', 'chat', 'schedule']);
const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);

export interface WorkItemRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    enqueue?: EnqueueFunction;
    getWsServer?: () => ProcessWebSocketServer;
}

export function registerWorkItemRoutes(ctx: WorkItemRouteContext): void {
    const { routes, workItemStore, enqueue, getWsServer } = ctx;

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

            const entries = await workItemStore.listWorkItems(filter);
            sendJSON(res, 200, entries);
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
                    await executeWorkItem(workItemId, workItemStore, enqueue);
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
            const commentBlock = comments.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n');
            const newContent = currentPlan + '\n\n## Review Comments (to address)\n\n' + commentBlock;
            const newVersion = (item.plan?.version ?? 0) + 1;

            const planVersion = {
                version: newVersion,
                content: newContent,
                createdAt: now,
                resolvedBy: 'user' as const,
                summary: `Incorporated ${comments.length} review comment(s)`,
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
}
