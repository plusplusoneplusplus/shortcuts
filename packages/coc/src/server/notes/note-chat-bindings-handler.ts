/**
 * Note-Chat Binding REST API Routes
 *
 * Read/write/delete operations on note → chat task bindings. Bindings are
 * normally created server-side as a side effect of enqueueing a chat task whose
 * payload carries `context.noteChat.notePath`. The one case that needs an
 * explicit write is widening an existing chat's scope — a per-note chat becoming
 * its folder's section chat has no new enqueue to hang a binding off, so `PUT
 * .../by-path` re-keys it.
 *
 * Workspace-scoped, following the `/api/workspaces/:id/...` pattern.
 */

import * as url from 'url';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, notFound, badRequest } from '../errors';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from '../routes/api-shared';
import { NoteChatBindingStore } from './note-chat-binding-store';

/**
 * Normalize a relative note path: forward slashes only, no leading slash,
 * collapse consecutive slashes, reject absolute paths and `..` traversal.
 * Returns null for invalid input.
 */
export function normalizeRelativeNotePath(input: unknown): string | null {
    if (typeof input !== 'string' || input.length === 0) return null;
    const fwd = input.replace(/\\/g, '/');
    if (fwd.startsWith('/')) return null;
    const segments = fwd.split('/').filter(seg => seg.length > 0);
    if (segments.length === 0) return null;
    for (const seg of segments) {
        if (seg === '.' || seg === '..') return null;
    }
    return segments.join('/');
}

/**
 * Nearest-parent folder of an already-normalized note path — the key a
 * `per-section` chat binds to. Returns null for a note sitting at the notes
 * root, which has no section.
 *
 * Nearest parent, not the top-level folder: `MultiModal/sub/note.md` belongs to
 * `MultiModal/sub`. A chat bound to `MultiModal` therefore does not pick up
 * notes under `MultiModal/sub` — they are a section of their own.
 */
export function noteSectionPath(notePath: string): string | null {
    const idx = notePath.lastIndexOf('/');
    return idx > 0 ? notePath.slice(0, idx) : null;
}

function firstStringQuery(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.find((v): v is string => typeof v === 'string');
    return undefined;
}

export function registerNoteChatBindingRoutes(ctx: ApiRouteContext): void {
    const { routes, store, db } = ctx;
    if (!db) return; // db is always provided in production; defensive guard
    const bindingStore = new NoteChatBindingStore(db);

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/chat-bindings — List all bindings
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/chat-bindings$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const bindings = bindingStore.list(ws.id);
            sendJSON(res, 200, { bindings });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/chat-bindings/by-path?path=<notePath>
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/chat-bindings\/by-path$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const query = url.parse(req.url || '', true).query;
            const notePath = normalizeRelativeNotePath(firstStringQuery(query.path));
            if (!notePath) {
                return handleAPIError(res, badRequest('Missing or invalid query parameter: path'));
            }

            const binding = bindingStore.get(ws.id, notePath);
            if (!binding) {
                return handleAPIError(res, notFound('Binding'));
            }
            sendJSON(res, 200, { notePath, taskId: binding.taskId, createdAt: binding.createdAt });
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/notes/chat-bindings/by-path?path=<notePath>
    //
    // Bind an EXISTING chat task to a path. The only caller is widening scope:
    // when a per-note chat becomes its folder's section chat there is no new
    // enqueue to create the folder-keyed row, so without this the conversation
    // would vanish the moment the user clicked a sibling.
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/chat-bindings\/by-path$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const query = url.parse(req.url || '', true).query;
            const notePath = normalizeRelativeNotePath(firstStringQuery(query.path));
            if (!notePath) {
                return handleAPIError(res, badRequest('Missing or invalid query parameter: path'));
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
            if (!taskId) {
                return handleAPIError(res, badRequest('Missing or invalid field: taskId'));
            }

            bindingStore.bind(ws.id, notePath, taskId);
            const bound = bindingStore.get(ws.id, notePath);
            sendJSON(res, 200, { notePath, taskId, createdAt: bound?.createdAt });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/notes/chat-bindings/by-path?path=<notePath>
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/chat-bindings\/by-path$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const query = url.parse(req.url || '', true).query;
            const notePath = normalizeRelativeNotePath(firstStringQuery(query.path));
            if (!notePath) {
                return handleAPIError(res, badRequest('Missing or invalid query parameter: path'));
            }

            bindingStore.unbind(ws.id, notePath);
            res.writeHead(204);
            res.end();
        },
    });
}
