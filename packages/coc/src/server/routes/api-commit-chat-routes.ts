/**
 * Commit-Chat Binding REST API Routes
 *
 * CRUD operations on commit→chat bindings, plus a rebind endpoint
 * for when commit hashes change (e.g. after rebase/amend).
 * Workspace-scoped, following the `/api/workspaces/:id/...` pattern.
 */

import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import { CommitChatBindingStore } from '../processes/commit-chat-binding-store';
import { startFreshLensChat } from '../processes/fresh-lens-chat-binding';

const COMMIT_HASH_RE = /^[a-f0-9]{4,40}$/;

export function registerCommitChatRoutes(ctx: ApiRouteContext): void {
    const { routes, store, db } = ctx;
    const bindingStore = new CommitChatBindingStore(db!);

    // POST /api/workspaces/:id/commit-chat-bindings/:hash/fresh — Archive current chat and clear binding
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/commit-chat-bindings\/([a-f0-9]{4,40})\/fresh$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const hash = match![2];
            try {
                const archivedTaskId = await startFreshLensChat({
                    store,
                    workspaceId: ws.id,
                    binding: bindingStore.get(ws.id, hash),
                    unbind: () => bindingStore.unbind(ws.id, hash),
                });
                sendJSON(res, 200, { commitHash: hash, archivedTaskId });
            } catch (error) {
                handleAPIError(res, error);
            }
        },
    });

    // POST /api/workspaces/:id/commit-chat-bindings/rebind — Re-map binding
    // Registered before /:hash routes as a defensive measure.
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/commit-chat-bindings\/rebind$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { oldHash, newHash } = body;
            if (typeof oldHash !== 'string' || !COMMIT_HASH_RE.test(oldHash)) {
                return handleAPIError(res, badRequest('Missing or invalid field: oldHash'));
            }
            if (typeof newHash !== 'string' || !COMMIT_HASH_RE.test(newHash)) {
                return handleAPIError(res, badRequest('Missing or invalid field: newHash'));
            }

            const moved = bindingStore.rebind(ws.id, oldHash, newHash);
            if (!moved) {
                return handleAPIError(res, notFound('Binding'));
            }

            const binding = bindingStore.get(ws.id, newHash)!;
            sendJSON(res, 200, { oldHash, newHash, taskId: binding.taskId });
        },
    });

    // GET /api/workspaces/:id/commit-chat-bindings — List all bindings
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/commit-chat-bindings$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const bindings = bindingStore.list(ws.id);
            sendJSON(res, 200, { bindings });
        },
    });

    // GET /api/workspaces/:id/commit-chat-bindings/:hash — Get single binding
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/commit-chat-bindings\/([a-f0-9]{4,40})$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const hash = match![2];
            const binding = bindingStore.get(ws.id, hash);
            if (!binding) {
                return handleAPIError(res, notFound('Binding'));
            }
            sendJSON(res, 200, { commitHash: hash, taskId: binding.taskId });
        },
    });

    // POST /api/workspaces/:id/commit-chat-bindings — Create binding
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/commit-chat-bindings$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { commitHash, taskId } = body;
            if (typeof commitHash !== 'string' || !COMMIT_HASH_RE.test(commitHash)) {
                return handleAPIError(res, badRequest('Missing or invalid field: commitHash'));
            }
            if (typeof taskId !== 'string' || taskId.length === 0) {
                return handleAPIError(res, badRequest('Missing or invalid field: taskId'));
            }

            bindingStore.bind(ws.id, commitHash, taskId);
            sendJSON(res, 201, { commitHash, taskId });
        },
    });

    // DELETE /api/workspaces/:id/commit-chat-bindings/:hash — Remove binding
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/commit-chat-bindings\/([a-f0-9]{4,40})$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const hash = match![2];
            bindingStore.unbind(ws.id, hash);
            res.writeHead(204);
            res.end();
        },
    });
}
