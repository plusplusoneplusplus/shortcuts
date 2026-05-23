/**
 * Notes Comments REST API Handler.
 *
 * HTTP API routes for CRUD operations on comment threads and individual
 * comments attached to notes for a given workspace.
 *
 * Sidecar storage:
 * - Default root: each note `<path>.md` gets a `<path>.md.comments.json`
 *   file co-located in the same directory under the managed notes root.
 * - Repo-folder roots: sidecar files are stored in the managed area at
 *   `~/.coc/repos/<workspaceId>/notes-comments/<encoded-root-path>/`
 *   to keep the workspace repo clean.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as crypto from 'crypto';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ProcessStore, CreateTaskInput } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { getRepoDataPath } from '../paths';
import { readRepoPreferences } from '../preferences-handler';
import type { NoteSidecar, CommentThread, Comment } from './notes-comments-types';
import { createEmptySidecar } from './notes-comments-types';
import { buildNotesBatchResolvePrompt } from './notes-comments-ai';
import { resolveNotesRoot, isRootResolveError, resolveCommentsSidecarPath } from './notes-root-resolver';
import type { ResolvedNotesRoot } from './notes-root-resolver';

// ============================================================================
// Helpers
// ============================================================================

function getNotesRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'notes');
}

function getWorkspaceDataDir(dataDir: string, workspaceId: string): string {
    return path.join(dataDir, 'repos', workspaceId);
}

function getCopilotDir(): string {
    return path.join(os.homedir(), '.copilot');
}

function isAllowedPath(resolved: string, wsDataDir: string, wsRootPath?: string): boolean {
    return isWithinDirectory(resolved, wsDataDir)
        || isWithinDirectory(resolved, getCopilotDir())
        || (!!wsRootPath && isWithinDirectory(resolved, wsRootPath));
}

/**
 * Resolve the sidecar file path for a note, taking the active root into account.
 * For non-default roots, the sidecar path already points into the managed area,
 * so the isAllowedPath check will pass naturally.
 */
function resolveSidecar(
    dataDir: string,
    workspaceId: string,
    root: ResolvedNotesRoot,
    notePath: string,
): string {
    return resolveCommentsSidecarPath(dataDir, workspaceId, root, notePath);
}

/**
 * Resolve the root from query/body `root` param, reading preferences to validate.
 */
function resolveRoot(
    dataDir: string,
    ws: { id: string; rootPath?: string },
    rootParam: string | undefined,
): ResolvedNotesRoot | { error: string; statusCode: number } {
    const prefs = readRepoPreferences(dataDir, ws.id);
    return resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
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
    bridge?: MultiRepoQueueRouter,
): void {

    // GET /api/workspaces/:id/notes/comments?path=...&root=...
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

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
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

            const { path: notePath, threads, root: rootParam } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!threads || typeof threads !== 'object') {
                return sendError(res, 400, 'Missing required field: threads');
            }

            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
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

            const { path: notePath, thread, root: rootParam } = body || {};
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

            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
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
            const { path: notePath, status, root: rootParam } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!status || (status !== 'open' && status !== 'resolved')) {
                return sendError(res, 400, 'Missing or invalid field: status (must be open or resolved)');
            }

            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
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

    // DELETE /api/workspaces/:id/notes/comments/thread/:threadId?path=...&root=...
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

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
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
            const { path: notePath, content, root: rootParam } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!content || typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
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
            const { path: notePath, content, root: rootParam } = body || {};
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required field: path');
            }
            if (!content || typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
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

    // DELETE /api/workspaces/:id/notes/comments/thread/:threadId/comment/:commentId?path=...&root=...
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

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
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

    // POST /api/workspaces/:id/notes/batch-resolve?path=...&root=...
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/batch-resolve$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url!, true);
            const notePath = parsed.query.path;
            if (!notePath || typeof notePath !== 'string') {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const documentContent: string | undefined = body.documentContent;
            if (!documentContent || typeof documentContent !== 'string') {
                return sendError(res, 400, 'Missing required field: documentContent');
            }

            const userContext: string | undefined = body.userContext;

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const root = resolveRoot(dataDir, ws, rootParam);
            if (isRootResolveError(root)) {
                return sendError(res, root.statusCode, root.error);
            }

            const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
            const resolved = resolveSidecar(dataDir, ws.id, root, notePath);
            if (!isAllowedPath(resolved, wsDataDir)) {
                return sendError(res, 403, 'Access denied: path is outside workspace data directory');
            }

            const sidecar = await loadSidecar(resolved);
            const openThreads = Object.values(sidecar.threads).filter(t => t.status === 'open');
            if (openThreads.length === 0) {
                return sendError(res, 400, 'No open comments to resolve');
            }

            if (!bridge) {
                return sendError(res, 503, 'Queue unavailable: bridge not configured');
            }

            const prompt = buildNotesBatchResolvePrompt(openThreads, notePath, documentContent, userContext);
            const threadIds = openThreads.map(t => t.id);

            try {
                const wsRootPath = ws.rootPath || process.cwd();
                bridge.getOrCreateBridge(wsRootPath);
                const queueManager = bridge.registry.getQueueForRepo(wsRootPath);
                const input: CreateTaskInput = {
                    type: 'chat',
                    priority: 'normal',
                    repoId: ws.id,
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt,
                        tools: ['resolve-comments'],
                        workspaceId: ws.id,
                        workingDirectory: wsRootPath,
                        context: {
                            resolveComments: {
                                documentUri: notePath,
                                commentIds: threadIds,
                                documentContent,
                                wsId: ws.id,
                            },
                        },
                    },
                    config: {},
                    displayName: `Resolve note comments: ${notePath}`,
                };
                const taskId = await queueManager.enqueue(input);
                if (taskId) {
                    return sendJSON(res, 202, { taskId });
                }
            } catch {
                // Fall through to error response
            }
            return sendError(res, 503, 'Queue unavailable: unable to enqueue resolve task');
        },
    });
}
