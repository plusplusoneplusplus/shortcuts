/**
 * Pull-Request-Chat Binding REST API Routes
 *
 * CRUD operations on pullRequest→chat bindings, modelled after
 * `api-commit-chat-routes.ts`. Workspace-scoped, following the
 * `/api/workspaces/:id/...` pattern.
 */

import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { PullRequestChatBindingStore } from '../processes/pull-request-chat-binding-store';

// PR IDs are typically numeric (GitHub, ADO) but can be longer opaque strings
// in the future. Allow URL-safe characters (alphanumerics, hyphen, underscore)
// with a reasonable length cap.
const PR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function registerPrChatRoutes(ctx: ApiRouteContext): void {
    const { routes, store, db } = ctx;
    const bindingStore = new PullRequestChatBindingStore(db!);

    // GET /api/workspaces/:id/pull-request-chat-bindings — List all bindings
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/pull-request-chat-bindings$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const bindings = bindingStore.list(ws.id);
            sendJSON(res, 200, { bindings });
        },
    });

    // GET /api/workspaces/:id/pull-request-chat-bindings/:prId — Get single binding
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/pull-request-chat-bindings\/([A-Za-z0-9_-]{1,64})$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const prId = match![2];
            const binding = bindingStore.get(ws.id, prId);
            if (!binding) {
                return handleAPIError(res, notFound('Binding'));
            }
            sendJSON(res, 200, { prId, taskId: binding.taskId });
        },
    });

    // POST /api/workspaces/:id/pull-request-chat-bindings — Create binding
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/pull-request-chat-bindings$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { prId, taskId } = body;
            if (typeof prId !== 'string' || !PR_ID_RE.test(prId)) {
                return handleAPIError(res, badRequest('Missing or invalid field: prId'));
            }
            if (typeof taskId !== 'string' || taskId.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: taskId'));
            }

            bindingStore.bind(ws.id, prId, taskId);
            sendJSON(res, 201, { prId, taskId });
        },
    });

    // DELETE /api/workspaces/:id/pull-request-chat-bindings/:prId — Remove binding
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/pull-request-chat-bindings\/([A-Za-z0-9_-]{1,64})$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const prId = match![2];
            bindingStore.unbind(ws.id, prId);
            res.writeHead(204);
            res.end();
        },
    });
}
