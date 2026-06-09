/**
 * Work-Item-Chat Binding REST API Routes
 *
 * CRUD operations on workspace + workItemId -> chat task bindings.
 */

import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { WorkItemChatBindingStore } from '../processes/work-item-chat-binding-store';

const MAX_WORK_ITEM_ID_LENGTH = 512;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

function isValidWorkItemId(value: unknown): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= MAX_WORK_ITEM_ID_LENGTH
        && !CONTROL_CHAR_RE.test(value);
}

export function registerWorkItemChatRoutes(ctx: ApiRouteContext): void {
    const { routes, store, db } = ctx;
    const bindingStore = new WorkItemChatBindingStore(db!);

    // GET /api/workspaces/:id/work-item-chat-bindings — List all bindings
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-item-chat-bindings$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            sendJSON(res, 200, { bindings: bindingStore.list(ws.id) });
        },
    });

    // GET /api/workspaces/:id/work-item-chat-bindings/:workItemId — Get single binding
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-item-chat-bindings\/([^/]{1,512})$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const workItemId = decodeURIComponent(match![2]);
            if (!isValidWorkItemId(workItemId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: workItemId'));
            }
            const binding = bindingStore.get(ws.id, workItemId);
            if (!binding) {
                return handleAPIError(res, notFound('Binding'));
            }
            sendJSON(res, 200, { workItemId, taskId: binding.taskId });
        },
    });

    // POST /api/workspaces/:id/work-item-chat-bindings — Create binding
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-item-chat-bindings$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { workItemId, taskId } = body;
            if (!isValidWorkItemId(workItemId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: workItemId'));
            }
            if (typeof taskId !== 'string' || taskId.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: taskId'));
            }

            bindingStore.bind(ws.id, workItemId, taskId);
            sendJSON(res, 201, { workItemId, taskId });
        },
    });

    // DELETE /api/workspaces/:id/work-item-chat-bindings/:workItemId — Remove binding
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/work-item-chat-bindings\/([^/]{1,512})$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const workItemId = decodeURIComponent(match![2]);
            if (!isValidWorkItemId(workItemId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: workItemId'));
            }
            bindingStore.unbind(ws.id, workItemId);
            res.writeHead(204);
            res.end();
        },
    });
}
