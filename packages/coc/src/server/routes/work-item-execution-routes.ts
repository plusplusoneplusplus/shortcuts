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
                status: 'created',
                createdAt: now,
                updatedAt: now,
                source: 'chat',
                sourceId: body.processId,
                priority: body.priority || 'normal',
                tags: body.tags,
            };

            // If the chat was in plan mode and has a result, use it as the initial plan
            if (body.extractPlan && process.result) {
                item.plan = {
                    version: 1,
                    content: process.result,
                    updatedAt: now,
                    resolvedBy: 'ai',
                };
                item.status = 'planning';
            }

            await workItemStore.addWorkItem(item);

            // Save plan version if plan was extracted
            if (item.plan) {
                await workItemStore.savePlanVersion(item.id, {
                    version: 1,
                    content: item.plan.content,
                    createdAt: now,
                    resolvedBy: 'ai',
                    summary: 'Extracted from chat session',
                });
            }

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
