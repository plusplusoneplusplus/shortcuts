/**
 * Work Item Changes REST API Routes
 *
 * A "Change" bundles a plan version with the git commits produced during
 * the corresponding execution cycle.
 *
 * Routes:
 *   GET   /api/workspaces/:id/work-items/:wid/changes             — List changes
 *   POST  /api/workspaces/:id/work-items/:wid/changes             — Create change
 *   PATCH /api/workspaces/:id/work-items/:wid/changes/:changeId   — Update change
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Route } from '../types';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import type { WorkItemStore, WorkItemChange } from '../work-items/types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { clearWorkItemResponseCacheForWorkspace } from '../work-items/work-item-response-cache';

export interface WorkItemChangesRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    getWsServer?: () => ProcessWebSocketServer;
}

export function registerWorkItemChangesRoutes(ctx: WorkItemChangesRouteContext): void {
    const { routes, workItemStore } = ctx;

    const changesBase = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/changes$/;
    const changesById = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/changes\/([^/]+)$/;

    // GET — list changes
    routes.push({
        method: 'GET',
        pattern: changesBase,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) return handleAPIError(res, notFound('Work item'));

            const changes = await workItemStore.getChanges(workItemId);
            sendJSON(res, 200, changes);
        },
    });

    // POST — create change (e.g., triggered by plan save)
    routes.push({
        method: 'POST',
        pattern: changesBase,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try { body = await parseBody(req); } catch { return handleAPIError(res, badRequest('Invalid JSON body')); }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) return handleAPIError(res, notFound('Work item'));

            const now = new Date().toISOString();
            const change: WorkItemChange = {
                id: crypto.randomUUID(),
                planVersion: typeof body.planVersion === 'number' ? body.planVersion : (item.plan?.version ?? 0),
                commits: [],
                startedAt: now,
                status: 'open',
                ...(body.taskId ? { taskId: body.taskId } : {}),
                ...(body.headBefore ? { headBefore: body.headBefore } : {}),
            };

            await workItemStore.addChange(workItemId, change);
            clearWorkItemResponseCacheForWorkspace(repoId);
            sendJSON(res, 201, change);
        },
    });

    // PATCH — update change (attach commits, close)
    routes.push({
        method: 'PATCH',
        pattern: changesById,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);
            const changeId = decodeURIComponent(match![3]);

            let body: any;
            try { body = await parseBody(req); } catch { return handleAPIError(res, badRequest('Invalid JSON body')); }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) return handleAPIError(res, notFound('Work item'));

            const changes = await workItemStore.getChanges(workItemId);
            const existing = changes.find(c => c.id === changeId);
            if (!existing) return handleAPIError(res, notFound('Change'));

            const updates: Partial<WorkItemChange> = {};
            if (body.commits !== undefined) updates.commits = body.commits;
            if (body.status !== undefined) {
                if (body.status !== 'open' && body.status !== 'closed') {
                    return handleAPIError(res, badRequest('status must be "open" or "closed"'));
                }
                updates.status = body.status;
            }
            if (body.completedAt !== undefined) updates.completedAt = body.completedAt;
            if (body.taskId !== undefined) updates.taskId = body.taskId;
            if (body.headBefore !== undefined) updates.headBefore = body.headBefore;

            await workItemStore.updateChange(workItemId, changeId, updates);
            clearWorkItemResponseCacheForWorkspace(repoId);

            const updatedItem = await workItemStore.getWorkItem(workItemId);
            const updatedChange = updatedItem?.changes?.find(c => c.id === changeId);
            sendJSON(res, 200, updatedChange ?? { ...existing, ...updates });
        },
    });
}
