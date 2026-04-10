/**
 * Notes REST API Handler — write/mutation routes.
 *
 * HTTP API routes for notes write operations (create, autosave, rename, delete)
 * for a given workspace.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from './api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from './shared/handler-utils';
import type { Route } from './types';
import { getRepoDataPath } from './paths';

// ============================================================================
// Helpers
// ============================================================================

function getNotesRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'notes');
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

            const { path: notePath, type } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!type || !['notebook', 'section', 'page'].includes(type)) {
                return sendError(res, 400, 'Missing or invalid field: type (must be notebook, section, or page)');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            await fs.promises.mkdir(notesRoot, { recursive: true });

            const resolved = path.resolve(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            try {
                if (type === 'notebook' || type === 'section') {
                    await fs.promises.mkdir(resolved, { recursive: true });
                    sendJSON(res, 201, { path: notePath, type });
                } else {
                    // page — auto-append .md if missing, then create parent dir and empty file
                    const effectivePath = notePath.endsWith('.md') ? notePath : `${notePath}.md`;
                    const resolvedPage = path.resolve(notesRoot, effectivePath);
                    if (!isWithinDirectory(resolvedPage, notesRoot)) {
                        return sendError(res, 403, 'Access denied: path is outside notes directory');
                    }
                    await fs.promises.mkdir(path.dirname(resolvedPage), { recursive: true });
                    await fs.promises.writeFile(resolvedPage, '', 'utf-8');
                    sendJSON(res, 201, { path: effectivePath, type });
                }
            } catch (err: any) {
                return sendError(res, 500, 'Failed to create: ' + (err.message || 'Unknown error'));
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

            const { path: notePath, content } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = path.resolve(notesRoot, notePath);

            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            try {
                await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
                await fs.promises.writeFile(resolved, content, 'utf-8');
                sendJSON(res, 200, { path: notePath, updated: true });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to write file: ' + (err.message || 'Unknown error'));
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

            const { oldPath, newPath } = body || {};
            if (!oldPath || typeof oldPath !== 'string') {
                return sendError(res, 400, 'Missing required field: oldPath');
            }
            if (!newPath || typeof newPath !== 'string') {
                return sendError(res, 400, 'Missing required field: newPath');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolvedOld = path.resolve(notesRoot, oldPath);
            const resolvedNew = path.resolve(notesRoot, newPath);

            if (!isWithinDirectory(resolvedOld, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }
            if (!isWithinDirectory(resolvedNew, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            // Check source exists
            try {
                await fs.promises.access(resolvedOld);
            } catch {
                return sendError(res, 404, 'Source path not found');
            }

            // Check collision
            try {
                await fs.promises.access(resolvedNew);
                return sendError(res, 409, 'Destination path already exists');
            } catch {
                // Expected — destination should not exist
            }

            try {
                await fs.promises.mkdir(path.dirname(resolvedNew), { recursive: true });
                await fs.promises.rename(resolvedOld, resolvedNew);

                // Cascade: rename sidecar comments file when it exists
                const oldSidecar = resolvedOld + '.comments.json';
                const newSidecar = resolvedNew + '.comments.json';
                try {
                    await fs.promises.rename(oldSidecar, newSidecar);
                } catch (err: any) {
                    if (err.code !== 'ENOENT') throw err;
                }

                sendJSON(res, 200, { oldPath, newPath });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to rename: ' + (err.message || 'Unknown error'));
            }
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

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = path.resolve(notesRoot, notePath);

            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            let stat: fs.Stats;
            try {
                stat = await fs.promises.stat(resolved);
            } catch {
                return sendError(res, 404, 'Path not found');
            }

            try {
                if (stat.isDirectory()) {
                    await fs.promises.rm(resolved, { recursive: true });
                } else {
                    await fs.promises.unlink(resolved);
                    // Cascade: remove sidecar comments file when it exists
                    const sidecarPath = resolved + '.comments.json';
                    try {
                        await fs.promises.unlink(sidecarPath);
                    } catch (err: any) {
                        if (err.code !== 'ENOENT') throw err;
                    }
                }
                res.writeHead(204);
                res.end();
            } catch (err: any) {
                return sendError(res, 500, 'Failed to delete: ' + (err.message || 'Unknown error'));
            }
        },
    });
}
