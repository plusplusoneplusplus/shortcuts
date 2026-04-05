/**
 * Work Item Execution & Chat Integration Routes
 *
 * Routes:
 *   POST /api/workspaces/:id/work-items/:wid/execute    — Execute work item as queue task
 *   POST /api/workspaces/:id/work-items/from-chat        — Create work item from chat session
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import type { WorkItemStore, WorkItem } from '../work-items/types';
import { executeWorkItem, type EnqueueFunction } from '../work-items/work-item-executor';
import { buildPlanFromContext } from '../work-items/plan-template';
import type { ProcessWebSocketServer } from '../websocket';

export interface WorkItemExecutionRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    processStore: ProcessStore;
    enqueue?: EnqueueFunction;
    getWsServer?: () => ProcessWebSocketServer;
}

export function registerWorkItemExecutionRoutes(ctx: WorkItemExecutionRouteContext): void {
    const { routes, workItemStore, processStore, enqueue, getWsServer } = ctx;

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

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            try {
                const result = await executeWorkItem(workItemId, workItemStore, enqueue, {
                    model: body.model,
                    mode: body.mode,
                });
                const updatedItem = await workItemStore.getWorkItem(workItemId);
                if (updatedItem) {
                    getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updatedItem });
                }
                sendJSON(res, 200, result);
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
                    content: process.result,
                    updatedAt: now,
                    resolvedBy: 'ai',
                };
            } else {
                item.plan = {
                    version: 1,
                    content: buildPlanFromContext(title, description),
                    updatedAt: now,
                    resolvedBy: 'user',
                };
            }

            await workItemStore.addWorkItem(item);

            // Persist the plan version record
            await workItemStore.savePlanVersion(item.id, {
                version: 1,
                content: item.plan.content,
                createdAt: now,
                resolvedBy: body.extractPlan && process.result ? 'ai' : 'user',
                summary: body.extractPlan && process.result
                    ? 'Extracted from chat session'
                    : 'Auto-generated plan template',
            });

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
