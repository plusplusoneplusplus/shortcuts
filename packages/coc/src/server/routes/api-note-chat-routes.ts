/**
 * Note-Chat Binding REST API Routes
 *
 * CRUD operations on note→chat bindings, plus a rebind endpoint
 * for when notes are renamed. Uses query params for note paths
 * (since paths contain slashes).
 * Workspace-scoped, following the `/api/workspaces/:id/...` pattern.
 */

import * as url from 'url';
import { sendJSON } from '../api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { NoteChatBindingStore } from '../note-chat-binding-store';

export function registerNoteChatRoutes(ctx: ApiRouteContext): void {
    const { routes, store, db } = ctx;
    const bindingStore = new NoteChatBindingStore(db!);

    // POST /api/workspaces/:id/note-chat-bindings/rebind — Re-map binding after rename
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/note-chat-bindings\/rebind$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { oldPath, newPath } = body;
            if (typeof oldPath !== 'string' || oldPath.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: oldPath'));
            }
            if (typeof newPath !== 'string' || newPath.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: newPath'));
            }

            const moved = bindingStore.rebind(ws.id, oldPath, newPath);
            if (!moved) {
                return handleAPIError(res, notFound('Binding'));
            }

            const binding = bindingStore.get(ws.id, newPath)!;
            sendJSON(res, 200, { oldPath, newPath, taskId: binding.taskId });
        },
    });

    // GET /api/workspaces/:id/note-chat-bindings — List all or get single (via ?path=)
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/note-chat-bindings$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const notePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';

            if (notePath) {
                // Single binding lookup
                const binding = bindingStore.get(ws.id, notePath);
                if (!binding) {
                    return handleAPIError(res, notFound('Binding'));
                }
                sendJSON(res, 200, { notePath, taskId: binding.taskId });
            } else {
                // List all
                const bindings = bindingStore.list(ws.id);
                sendJSON(res, 200, { bindings });
            }
        },
    });

    // POST /api/workspaces/:id/note-chat-bindings — Create binding
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/note-chat-bindings$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { notePath, taskId } = body;
            if (typeof notePath !== 'string' || notePath.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: notePath'));
            }
            if (typeof taskId !== 'string' || taskId.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: taskId'));
            }

            bindingStore.bind(ws.id, notePath, taskId);
            sendJSON(res, 201, { notePath, taskId });
        },
    });

    // DELETE /api/workspaces/:id/note-chat-bindings — Remove binding (via ?path=)
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/note-chat-bindings$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const notePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!notePath) {
                return handleAPIError(res, badRequest('Missing required query parameter: path'));
            }

            bindingStore.unbind(ws.id, notePath);
            res.writeHead(204);
            res.end();
        },
    });
}
