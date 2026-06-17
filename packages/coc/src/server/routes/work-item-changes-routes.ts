/**
 * Work Item Changes REST API Routes
 *
 * A "Change" bundles a plan version with the git commits produced during
 * the corresponding execution cycle.
 *
 * Routes:
 *   GET   /api/origins/:originId/work-items/:wid/changes             — List changes
 *   POST  /api/origins/:originId/work-items/:wid/changes             — Create change
 *   PATCH /api/origins/:originId/work-items/:wid/changes/:changeId   — Update change
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import type { WorkItemStore, WorkItemChange } from '../work-items/types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { clearWorkItemResponseCacheForWorkspace } from '../work-items/work-item-response-cache';
import {
    queryWorkspaceId,
    resolveWorkItemRouteScope,
    type WorkItemRouteScope,
} from './work-item-route-scope';

export interface WorkItemChangesRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore?: Pick<ProcessStore, 'getWorkspaces' | 'updateWorkspace'>;
    getWsServer?: () => ProcessWebSocketServer;
}

const changesBase = /^\/api\/origins\/([^/]+)\/work-items\/([^/]+)\/changes$/;
const changesById = /^\/api\/origins\/([^/]+)\/work-items\/([^/]+)\/changes\/([^/]+)$/;

function bodyWorkspaceId(body: unknown): string | undefined {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const raw = (body as Record<string, unknown>).workspaceId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

async function resolveChangesRouteScope(
    ctx: WorkItemChangesRouteContext,
    req: http.IncomingMessage,
    originId: string,
    body?: unknown,
): Promise<WorkItemRouteScope> {
    const workspaceId = bodyWorkspaceId(body) ?? queryWorkspaceId(req);
    if (ctx.processStore) {
        return resolveWorkItemRouteScope(
            { processStore: ctx.processStore as ProcessStore },
            'origins',
            originId,
            workspaceId,
        );
    }

    return {
        kind: 'origins',
        routeScopeId: originId,
        storageRepoId: originId,
        commandRepoId: workspaceId ?? originId,
        workspaceId,
    };
}

export function registerWorkItemChangesRoutes(ctx: WorkItemChangesRouteContext): void {
    const { routes, workItemStore } = ctx;

    // GET — list changes
    routes.push({
        method: 'GET',
        pattern: changesBase,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const originId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let scope: WorkItemRouteScope;
            try {
                scope = await resolveChangesRouteScope(ctx, req, originId);
            } catch (err) {
                return handleAPIError(res, err);
            }

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            if (!item) return handleAPIError(res, notFound('Work item'));

            const changes = await workItemStore.getChanges(workItemId, scope.storageRepoId);
            sendJSON(res, 200, changes);
        },
    });

    // POST — create change (e.g., triggered by plan save)
    routes.push({
        method: 'POST',
        pattern: changesBase,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const originId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try { body = await parseBody(req); } catch { return handleAPIError(res, badRequest('Invalid JSON body')); }

            let scope: WorkItemRouteScope;
            try {
                scope = await resolveChangesRouteScope(ctx, req, originId, body);
            } catch (err) {
                return handleAPIError(res, err);
            }

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
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

            await workItemStore.addChange(workItemId, change, scope.storageRepoId);
            clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);
            sendJSON(res, 201, change);
        },
    });

    // PATCH — update change (attach commits, close)
    routes.push({
        method: 'PATCH',
        pattern: changesById,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const originId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);
            const changeId = decodeURIComponent(match![3]);

            let body: any;
            try { body = await parseBody(req); } catch { return handleAPIError(res, badRequest('Invalid JSON body')); }

            let scope: WorkItemRouteScope;
            try {
                scope = await resolveChangesRouteScope(ctx, req, originId, body);
            } catch (err) {
                return handleAPIError(res, err);
            }

            const item = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            if (!item) return handleAPIError(res, notFound('Work item'));

            const changes = await workItemStore.getChanges(workItemId, scope.storageRepoId);
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

            await workItemStore.updateChange(workItemId, changeId, updates, scope.storageRepoId);
            clearWorkItemResponseCacheForWorkspace(scope.storageRepoId);

            const updatedItem = await workItemStore.getWorkItem(workItemId, scope.storageRepoId);
            const updatedChange = updatedItem?.changes?.find(c => c.id === changeId);
            sendJSON(res, 200, updatedChange ?? { ...existing, ...updates });
        },
    });
}
