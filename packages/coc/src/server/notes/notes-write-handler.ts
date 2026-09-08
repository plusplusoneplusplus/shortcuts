/**
 * HTTP API routes for notes write operations (create, autosave, rename, delete)
 * for a given workspace.
 *
 * Every filesystem step — path containment, the atomic autosave, the sidecar
 * carry-along, `.order.json` upkeep — lives in the native `notes_fs` core. What
 * stays here is request parsing, root resolution, and the SQLite chat-binding
 * cascade, which the native layer cannot reach.
 */

import * as url from 'url';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { loadNativeNotesFs, toNotesFsError } from '@plusplusoneplusplus/coc-native';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { SYSTEM_FOLDER_NAMES } from './notes-constants';
import { NoteChatBindingStore } from './note-chat-binding-store';
import { resolveNotesRoot, isRootResolveError } from './notes-root-resolver';
import { contentAllowedPrefixes } from './notes-read-handler';
import { readRepoPreferences } from '../preferences-handler';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Answer a rejection from `notes_fs` with the status and message it carries.
 *
 * The core encodes the HTTP status alongside the body text, so a 403 for a
 * traversal attempt and a 500 for a failed rename stay distinguishable without
 * the route re-deriving either from an errno.
 */
function sendNotesFsError(res: Parameters<typeof sendError>[0], err: unknown): void {
    const { statusCode, message } = toNotesFsError(err);
    sendError(res, statusCode, message);
}

// ============================================================================
// Write Route Registration
// ============================================================================

/**
 * Register notes write (mutation) API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerNotesWriteRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {
    // Resolve the per-note chat binding store once. Bindings live in the
    // shared `processes.db`, so the SQLite-backed process store exposes the
    // database handle we need. With other backends (or in tests without a
    // SQLite store) we leave the cascade disabled — rename/delete still
    // succeed for the filesystem operation; only the binding row is not
    // touched.
    let bindingStore: NoteChatBindingStore | null = null;
    if (store instanceof SqliteProcessStore) {
        try {
            bindingStore = new NoteChatBindingStore(store.getDatabase());
        } catch {
            bindingStore = null;
        }
    }

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/page — Create page/section/notebook
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/page$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: notePath, type, root: rootParam } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!type || !['notebook', 'section', 'page'].includes(type)) {
                return sendError(res, 400, 'Missing or invalid field: type (must be notebook, section, or page)');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            try {
                // The core creates the notes root, appends `.md` for a page, and
                // makes the parent directories.
                const created = await loadNativeNotesFs().createNotesEntry(rootResult.absolutePath, notePath, type, {
                    isDefaultRoot: rootResult.isDefault,
                    systemFolderNames: SYSTEM_FOLDER_NAMES,
                });
                sendJSON(res, 201, { path: created.path, type: created.kind });
            } catch (err) {
                return sendNotesFsError(res, err);
            }
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/notes/content — Autosave
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/content$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: notePath, content, expectedMtime, root: rootParam } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            try {
                // Optimistic locking, the atomic temp-file write, and the
                // write-through into the live search index all happen inside the
                // core, in that order and without a second boundary crossing.
                const result = await loadNativeNotesFs().writeNote(
                    rootResult.absolutePath,
                    notePath,
                    content,
                    typeof expectedMtime === 'number' ? expectedMtime : undefined,
                    {
                        isDefaultRoot: rootResult.isDefault,
                        allowedPrefixes: contentAllowedPrefixes(dataDir, ws.id, ws.rootPath),
                    },
                );
                if (result.status === 'conflict') {
                    return sendJSON(res, 409, {
                        error: 'conflict',
                        reason: 'mtime_mismatch',
                        currentMtime: result.currentMtime,
                        currentContent: result.currentContent,
                    });
                }
                sendJSON(res, 200, { path: notePath, updated: true, mtime: result.mtimeMs });
            } catch (err) {
                return sendNotesFsError(res, err);
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/notes/path — Rename
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/path$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { oldPath, newPath, root: rootParam } = body || {};
            if (!oldPath || typeof oldPath !== 'string') {
                return sendError(res, 400, 'Missing required field: oldPath');
            }
            if (!newPath || typeof newPath !== 'string') {
                return sendError(res, 400, 'Missing required field: newPath');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            let renamed;
            try {
                renamed = await loadNativeNotesFs().renameNotesEntry(rootResult.absolutePath, oldPath, newPath, {
                    isDefaultRoot: rootResult.isDefault,
                    systemFolderNames: SYSTEM_FOLDER_NAMES,
                });
            } catch (err) {
                return sendNotesFsError(res, err);
            }

            // Cascade: move per-note chat binding rows. `kind` is absent when the
            // renamed entry could not be stat'd afterwards (a race); the cascade
            // is then skipped rather than guessing which rows to move.
            let bindingsMoved = 0;
            if (bindingStore && renamed.kind) {
                bindingsMoved = renamed.kind === 'dir'
                    ? bindingStore.renamePrefix(ws.id, renamed.oldRel, renamed.newRel)
                    : bindingStore.renamePath(ws.id, renamed.oldRel, renamed.newRel);
            }

            sendJSON(res, 200, { oldPath, newPath: renamed.effectiveNewPath, bindingsMoved });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/notes/path?path=... — Delete
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/path$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const notePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!notePath) {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            let deleted;
            try {
                deleted = await loadNativeNotesFs().deleteNotesEntry(rootResult.absolutePath, notePath, {
                    isDefaultRoot: rootResult.isDefault,
                    systemFolderNames: SYSTEM_FOLDER_NAMES,
                });
            } catch (err) {
                return sendNotesFsError(res, err);
            }

            // Cascade: drop per-note chat binding rows for the deleted entry.
            // Chats themselves remain in the global Chat list.
            if (bindingStore) {
                if (deleted.kind === 'dir') {
                    bindingStore.deletePrefix(ws.id, deleted.rel);
                } else {
                    bindingStore.unbind(ws.id, deleted.rel);
                }
            }

            res.writeHead(204);
            res.end();
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/notes/order — Persist custom sibling order
    // Body: { parentPath: string, order: string[] }
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/order$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { parentPath, order, root: rootParam } = body || {};

            // parentPath can be '' (root) or a relative path
            if (typeof parentPath !== 'string') {
                return sendError(res, 400, 'Missing required field: parentPath');
            }
            if (!Array.isArray(order) || !order.every(n => typeof n === 'string')) {
                return sendError(res, 400, 'Missing or invalid field: order (must be string[])');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            try {
                await loadNativeNotesFs().writeNotesOrder(rootResult.absolutePath, parentPath, order, {
                    isDefaultRoot: rootResult.isDefault,
                    systemFolderNames: SYSTEM_FOLDER_NAMES,
                });
                sendJSON(res, 200, { parentPath, order });
            } catch (err) {
                return sendNotesFsError(res, err);
            }
        },
    });
}
