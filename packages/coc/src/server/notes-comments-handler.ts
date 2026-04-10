/**
 * Notes Comments REST API Handler.
 *
 * HTTP API routes for CRUD operations on comment threads and individual
 * comments attached to notes for a given workspace.
 *
 * Sidecar storage: each note `<path>.md` gets a `<path>.md.comments.json`
 * file in the same directory under the notes root.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as crypto from 'crypto';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from './api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from './shared/handler-utils';
import type { Route } from './types';
import { getRepoDataPath } from './paths';
import type { NoteSidecar, CommentThread, Comment } from './notes-comments-types';
import { createEmptySidecar } from './notes-comments-types';

// ============================================================================
// Helpers
// ============================================================================

function getNotesRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'notes');
}

function sidecarPath(notesRoot: string, notePath: string): string {
    return path.resolve(notesRoot, notePath + '.comments.json');
}

async function loadSidecar(filePath: string): Promise<NoteSidecar> {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(raw) as NoteSidecar;
    } catch (err: any) {
        if (err.code === 'ENOENT') return createEmptySidecar();
        throw err;
    }
}

async function saveSidecar(filePath: string, data: NoteSidecar): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register notes comments API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerNotesCommentsRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {

    // GET /api/workspaces/:id/notes/comments?path=...
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/comments$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url!, true);
            const notePath = parsed.query.path;
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = sidecarPath(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            const sidecar = await loadSidecar(resolved);
            sendJSON(res, 200, sidecar);
        },
    });

    // PUT /api/workspaces/:id/notes/comments
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/comments$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: notePath, threads } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!threads || typeof threads !== 'object') {
                return sendError(res, 400, 'Missing required field: threads');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = sidecarPath(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            const sidecar: NoteSidecar = { version: 1, threads: body.threads };
            await saveSidecar(resolved, sidecar);
            sendJSON(res, 200, sidecar);
        },
    });

    // POST /api/workspaces/:id/notes/comments/thread
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/comments\/thread$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: notePath, thread } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!thread) {
                return sendError(res, 400, 'Missing required field: thread');
            }
            if (!thread.anchor) {
                return sendError(res, 400, 'Missing required field: thread.anchor');
            }
            if (!Array.isArray(thread.comments)) {
                return sendError(res, 400, 'Missing required field: thread.comments');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = sidecarPath(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            const now = new Date().toISOString();
            const builtThread: CommentThread = {
                id: crypto.randomUUID(),
                status: 'open',
                createdAt: now,
                anchor: thread.anchor,
                comments: thread.comments.map((c: { content: string }): Comment => ({
                    id: crypto.randomUUID(),
                    content: c.content,
                    createdAt: now,
                })),
            };

            const sidecar = await loadSidecar(resolved);
            sidecar.threads[builtThread.id] = builtThread;
            await saveSidecar(resolved, sidecar);
            sendJSON(res, 201, { thread: builtThread });
        },
    });

    // PATCH /api/workspaces/:id/notes/comments/thread/:threadId
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/comments\/thread\/([^/]+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const threadId = decodeURIComponent(match![2]);
            const { path: notePath, status } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!status || (status !== 'open' && status !== 'resolved')) {
                return sendError(res, 400, 'Missing or invalid field: status (must be open or resolved)');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = sidecarPath(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            const sidecar = await loadSidecar(resolved);
            const thread = sidecar.threads[threadId];
            if (!thread) {
                return sendError(res, 404, 'Thread not found');
            }

            thread.status = status;
            if (status === 'resolved') {
                thread.resolvedAt = new Date().toISOString();
            } else {
                delete thread.resolvedAt;
            }

            await saveSidecar(resolved, sidecar);
            sendJSON(res, 200, { thread });
        },
    });

    // DELETE /api/workspaces/:id/notes/comments/thread/:threadId?path=...
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/comments\/thread\/([^/]+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const threadId = decodeURIComponent(match![2]);
            const parsed = url.parse(req.url!, true);
            const notePath = parsed.query.path;
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = sidecarPath(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            const sidecar = await loadSidecar(resolved);
            if (!sidecar.threads[threadId]) {
                return sendError(res, 404, 'Thread not found');
            }

            delete sidecar.threads[threadId];
            await saveSidecar(resolved, sidecar);
            res.writeHead(204);
            res.end();
        },
    });

    // POST /api/workspaces/:id/notes/comments/thread/:threadId/comment
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/comments\/thread\/([^/]+)\/comment$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const threadId = decodeURIComponent(match![2]);
            const { path: notePath, content } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!content || typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = sidecarPath(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            const sidecar = await loadSidecar(resolved);
            const thread = sidecar.threads[threadId];
            if (!thread) {
                return sendError(res, 404, 'Thread not found');
            }

            const comment: Comment = {
                id: crypto.randomUUID(),
                content,
                createdAt: new Date().toISOString(),
            };
            thread.comments.push(comment);
            await saveSidecar(resolved, sidecar);
            sendJSON(res, 201, { comment });
        },
    });

    // PATCH /api/workspaces/:id/notes/comments/thread/:threadId/comment/:commentId
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/comments\/thread\/([^/]+)\/comment\/([^/]+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const threadId = decodeURIComponent(match![2]);
            const commentId = decodeURIComponent(match![3]);
            const { path: notePath, content } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!content || typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = sidecarPath(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            const sidecar = await loadSidecar(resolved);
            const thread = sidecar.threads[threadId];
            if (!thread) {
                return sendError(res, 404, 'Thread not found');
            }

            const comment = thread.comments.find(c => c.id === commentId);
            if (!comment) {
                return sendError(res, 404, 'Comment not found');
            }

            comment.content = content;
            comment.updatedAt = new Date().toISOString();
            await saveSidecar(resolved, sidecar);
            sendJSON(res, 200, { comment });
        },
    });

    // DELETE /api/workspaces/:id/notes/comments/thread/:threadId/comment/:commentId?path=...
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/comments\/thread\/([^/]+)\/comment\/([^/]+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const threadId = decodeURIComponent(match![2]);
            const commentId = decodeURIComponent(match![3]);
            const parsed = url.parse(req.url!, true);
            const notePath = parsed.query.path;
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = sidecarPath(notesRoot, notePath);
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            const sidecar = await loadSidecar(resolved);
            const thread = sidecar.threads[threadId];
            if (!thread) {
                return sendError(res, 404, 'Thread not found');
            }

            const commentExists = thread.comments.some(c => c.id === commentId);
            if (!commentExists) {
                return sendError(res, 404, 'Comment not found');
            }

            thread.comments = thread.comments.filter(c => c.id !== commentId);
            await saveSidecar(resolved, sidecar);
            res.writeHead(204);
            res.end();
        },
    });
}
