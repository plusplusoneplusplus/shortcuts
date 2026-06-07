/**
 * Work Item Plan REST API Routes
 *
 * Plan versioning and AI-assisted refinement for work items.
 *
 * Routes:
 *   GET  /api/workspaces/:id/work-items/:wid/plan             — Get current plan
 *   PUT  /api/workspaces/:id/work-items/:wid/plan             — Update plan (auto-versions)
 *   GET  /api/workspaces/:id/work-items/:wid/plan/versions    — List plan versions
 *   GET  /api/workspaces/:id/work-items/:wid/plan/versions/:v — Get specific version
 *   POST /api/workspaces/:id/work-items/:wid/plan/refine      — AI-assisted refinement
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Route } from '../types';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import type { WorkItemStore, WorkItemPlanVersion, WorkItemChange } from '../work-items/types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { clearWorkItemResponseCacheForWorkspace } from '../work-items/work-item-response-cache';

export interface WorkItemPlanRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    getWsServer?: () => ProcessWebSocketServer;
    /** Optional AI invoker for plan refinement. If not provided, refinement is unavailable. */
    refineWithAI?: (currentPlan: string, description: string, title: string, instructions?: string) => Promise<string>;
}

export function registerWorkItemPlanRoutes(ctx: WorkItemPlanRouteContext): void {
    const { routes, workItemStore, getWsServer, refineWithAI } = ctx;

    // Regex for plan routes: /api/workspaces/:repoId/work-items/:workItemId/plan
    const planBase = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan$/;
    const planVersions = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan\/versions$/;
    const planVersionById = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan\/versions\/(\d+)$/;
    const planRefine = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan\/refine$/;

    // GET /api/workspaces/:id/work-items/:wid/plan — Get current plan
    routes.push({
        method: 'GET',
        pattern: planBase,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            if (!item.plan) {
                sendJSON(res, 200, { plan: null, versions: 0 });
                return;
            }

            const versions = await workItemStore.getPlanVersions(workItemId);
            sendJSON(res, 200, {
                plan: item.plan,
                versions: versions.length,
            });
        },
    });

    // PUT /api/workspaces/:id/work-items/:wid/plan — Update plan (auto-version)
    routes.push({
        method: 'PUT',
        pattern: planBase,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            if (!body.content || typeof body.content !== 'string') {
                return handleAPIError(res, badRequest('Missing required field: content'));
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            const now = new Date().toISOString();
            const newVersion = (item.plan?.version ?? 0) + 1;

            const planVersion: WorkItemPlanVersion = {
                version: newVersion,
                content: body.content,
                createdAt: now,
                resolvedBy: body.resolvedBy || 'user',
                summary: body.summary,
            };

            await workItemStore.savePlanVersion(workItemId, planVersion);
            const updated = await workItemStore.updateWorkItem(workItemId, {
                plan: {
                    version: newVersion,
                    content: body.content,
                    updatedAt: now,
                    resolvedBy: body.resolvedBy || 'user',
                },
            });
            if (updated) {
                clearWorkItemResponseCacheForWorkspace(repoId);
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            }

            // Open a new Change entry linked to this plan version (fire-and-forget)
            const change: WorkItemChange = {
                id: crypto.randomUUID(),
                planVersion: newVersion,
                commits: [],
                startedAt: now,
                status: 'open',
            };
            workItemStore.addChange(workItemId, change).catch(() => { /* non-fatal */ });

            sendJSON(res, 200, { plan: planVersion, version: newVersion });
        },
    });

    // GET /api/workspaces/:id/work-items/:wid/plan/versions — List plan versions
    routes.push({
        method: 'GET',
        pattern: planVersions,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            const versions = await workItemStore.getPlanVersions(workItemId);
            sendJSON(res, 200, versions);
        },
    });

    // GET /api/workspaces/:id/work-items/:wid/plan/versions/:v — Get specific version
    routes.push({
        method: 'GET',
        pattern: planVersionById,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);
            const version = parseInt(match![3], 10);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            const planVersion = await workItemStore.getPlanVersion(workItemId, version);
            if (!planVersion) {
                return handleAPIError(res, notFound(`Plan version ${version}`));
            }

            sendJSON(res, 200, planVersion);
        },
    });

    // POST /api/workspaces/:id/work-items/:wid/plan/refine — AI-assisted refinement
    routes.push({
        method: 'POST',
        pattern: planRefine,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            if (!refineWithAI) {
                return handleAPIError(res, badRequest('AI refinement is not available'));
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            if (!item.plan?.content) {
                return handleAPIError(res, badRequest('Work item has no plan to refine'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            const refinedContent = await refineWithAI(
                item.plan.content,
                item.description,
                item.title,
                body.instructions || undefined,
            );

            const now = new Date().toISOString();
            const newVersion = item.plan.version + 1;

            const planVersion: WorkItemPlanVersion = {
                version: newVersion,
                content: refinedContent,
                createdAt: now,
                resolvedBy: 'ai',
                summary: body.summary || (body.instructions ? `AI resolved: ${String(body.instructions).slice(0, 80)}` : 'AI-refined plan'),
            };

            await workItemStore.savePlanVersion(workItemId, planVersion);
            const updated = await workItemStore.updateWorkItem(workItemId, {
                plan: {
                    version: newVersion,
                    content: refinedContent,
                    updatedAt: now,
                    resolvedBy: 'ai',
                },
            });
            if (updated) {
                clearWorkItemResponseCacheForWorkspace(repoId);
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            }

            // Open a new Change for the refined plan version (fire-and-forget)
            const refineChange: WorkItemChange = {
                id: crypto.randomUUID(),
                planVersion: newVersion,
                commits: [],
                startedAt: now,
                status: 'open',
            };
            workItemStore.addChange(workItemId, refineChange).catch(() => { /* non-fatal */ });

            sendJSON(res, 200, {
                plan: planVersion,
                version: newVersion,
                previousVersion: item.plan.version,
            });
        },
    });
}
