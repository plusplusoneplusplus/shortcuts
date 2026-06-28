/**
 * Diff Comments REST API Handler
 *
 * HTTP API routes for CRUD operations on git diff view comments.
 * Stores comments in JSON files under the CoC data directory.
 *
 * Storage layout:
 *   {dataDir}/repos/{workspaceId}/diff-comments/{sha256(repoId+oldRef+newRef+filePath)}.json
 *
 * For working-tree diffs (newRef === 'working-tree'), the storage key is
 *   sha256(repoId+filePath+'working-tree') and every comment is ephemeral.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { sendJSON, sendError, parseBody } from '../../core/api-handler';
import * as path from 'path';
import type { Route } from '../../types';
import type { ProcessWebSocketServer } from '../../streaming/websocket';
import type { ProcessStore, CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../../queue/multi-repo-queue-router';
import { isValidWorkspaceId } from './base-comments-manager';
import { DiffCommentsManager, isValidStorageKey, isValidContext } from './diff-comments-manager';
import { buildDiffEnrichedPrompt, buildDiffAIPrompt, buildMultiFileBatchResolvePrompt, DEFAULT_AI_COMMANDS } from './diff-comments-ai';
import { invokeCommentAI } from './comments-ai-helpers';

// Re-export types and classes so existing importers don't break
export type { DiffCommentReply, DiffCommentsStorage } from './diff-comments-manager';
export { DiffCommentsManager } from './diff-comments-manager';

// ============================================================================
// URL Patterns
// ============================================================================

// /api/diff-comment-counts/:wsId
const countsPattern = /^\/api\/diff-comment-counts\/([a-zA-Z0-9_-]+)$/;

// /api/diff-comment-totals/:wsId
const totalsPattern = /^\/api\/diff-comment-totals\/([a-zA-Z0-9_-]+)$/;

// /api/diff-comments/:wsId  (list all / create)
const collectionPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)$/;

// /api/diff-comments/:wsId/:storageKey
const storageKeyPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/([0-9a-f]{64})$/;

// /api/diff-comments/:wsId/:storageKey/:id
const itemPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/([0-9a-f]{64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// /api/diff-comments/:wsId/:storageKey/:id/replies
const replyPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/([0-9a-f]{64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/replies$/;

// /api/diff-comments/:wsId/:storageKey/:id/ask-ai
const askAiPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/([0-9a-f]{64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/ask-ai$/;

// /api/diff-comments/:wsId/resolve-with-ai
const resolveWithAiPattern = /^\/api\/diff-comments\/([a-zA-Z0-9_-]+)\/resolve-with-ai$/;

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register diff comments API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * Endpoints:
 *   GET    /api/diff-comment-counts/:wsId              — comment counts per storage key
 *   GET    /api/diff-comment-totals/:wsId             — total open comment counts per commit hash
 *   GET    /api/diff-comments/:wsId                    — list all comments in workspace
 *   POST   /api/diff-comments/:wsId                    — create comment
 *   GET    /api/diff-comments/:wsId/:key               — list comments for storage key
 *   GET    /api/diff-comments/:wsId/:key/:id           — get single comment
 *   PATCH  /api/diff-comments/:wsId/:key/:id           — update comment
 *   DELETE /api/diff-comments/:wsId/:key/:id           — delete comment
 *   POST   /api/diff-comments/:wsId/:key/:id/replies   — add reply
 *   POST   /api/diff-comments/:wsId/:key/:id/ask-ai    — AI clarification
 *
 * @param routes - Shared route table
 * @param dataDir - Directory for comment storage (e.g. ~/.coc)
 * @param bridge - Multi-repo queue bridge (reserved for future AI integration)
 * @param store - Optional process store (reserved for future workspace resolution)
 * @param getWsServer - Optional WebSocket server accessor (reserved for future events)
 */
export function registerDiffCommentsRoutes(
    routes: Route[],
    dataDir: string,
    bridge: MultiRepoQueueRouter,
    store?: ProcessStore,
    getWsServer?: () => ProcessWebSocketServer | undefined
): void {
    const manager = new DiffCommentsManager(dataDir);

    async function resolveWorkspaceRootPath(wsId: string): Promise<string | undefined> {
        if (!store) return undefined;
        try {
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find((w: any) => w.id === wsId.trim());
            return ws?.rootPath;
        } catch {
            return undefined;
        }
    }

    async function enqueueDiffResolveMultiTask(
        wsId: string,
        files: Array<{ storageKey: string; commentIds: string[]; filePath: string }>,
        prompt: string,
        oldRef: string,
        newRef: string,
        skills?: string[],
    ): Promise<string | undefined> {
        const wsRootPath = await resolveWorkspaceRootPath(wsId) || process.cwd();
        bridge.getOrCreateBridge(wsRootPath);
        const queueManager = bridge.registry.getQueueForRepo(wsRootPath);
        const totalComments = files.reduce((sum, f) => sum + f.commentIds.length, 0);
        const input: CreateTaskInput = {
            type: 'chat',
            priority: 'normal',
            // repoId is required so the task's resulting process inherits the
            // workspace_id column (process-lifecycle-runner falls back to
            // task.repoId when payload.workspaceId is missing). Without it,
            // the conversation is invisible to the workspace history endpoint
            // that powers the Activity tab.
            repoId: wsId,
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt,
                tools: ['resolve-comments'],
                workspaceId: wsId,
                workingDirectory: wsRootPath,
                context: {
                    files: files.map(f => path.resolve(wsRootPath, f.filePath)),
                    resolveDiffCommentsMulti: {
                        files,
                        wsId,
                        oldRef,
                        newRef,
                    },
                    ...(skills?.length ? { skills } : {}),
                },
            },
            config: {},
            displayName: files.length === 1
                ? `Resolve diff comments: ${files[0].filePath}`
                : `Resolve diff comments: ${files.length} files (${oldRef}..${newRef})`,
        };
        return queueManager.enqueue(input);
    }

    // ------------------------------------------------------------------
    // GET /api/diff-comment-counts/:wsId — comment counts per storage key
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: countsPattern,
        handler: async (req, res, match) => {
            const [, wsId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const url = new URL(req.url!, 'http://x');
                const oldRef = url.searchParams.get('oldRef') ?? undefined;
                const newRef = url.searchParams.get('newRef') ?? undefined;
                const statusParam = url.searchParams.get('status');
                const statuses = statusParam
                    ? statusParam.split(',').map(s => s.trim()).filter(Boolean)
                    : undefined;
                const counts = await manager.getCommentCounts(wsId, { oldRef, newRef, statuses });
                sendJSON(res, 200, { counts });
            } catch {
                sendError(res, 500, 'Failed to retrieve comment counts');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/diff-comment-totals/:wsId — total comment counts per commit
    // Query params: commits=hash1,hash2,...  status=open
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: totalsPattern,
        handler: async (req, res, match) => {
            const [, wsId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const url = new URL(req.url!, 'http://x');
                const commitsParam = url.searchParams.get('commits') ?? '';
                const commitHashes = commitsParam
                    ? commitsParam.split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                const statusParam = url.searchParams.get('status');
                const statuses = statusParam
                    ? statusParam.split(',').map(s => s.trim()).filter(Boolean)
                    : undefined;
                const totals = await manager.getCommentTotals(wsId, commitHashes, { statuses });
                sendJSON(res, 200, { totals });
            } catch {
                sendError(res, 500, 'Failed to retrieve comment totals');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/diff-comments/:wsId — list all comments in workspace
    // Optional query params: oldRef, newRef — filter by commit range
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: collectionPattern,
        handler: async (req, res, match) => {
            const [, wsId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const comments = await manager.listAllComments(wsId);
                const url = new URL(req.url!, 'http://x');
                const oldRef = url.searchParams.get('oldRef');
                const newRef = url.searchParams.get('newRef');
                const filtered = (oldRef && newRef)
                    ? comments.filter(c => c.context.oldRef === oldRef && c.context.newRef === newRef)
                    : newRef
                    ? comments.filter(c => c.context.newRef === newRef)
                    : comments;
                sendJSON(res, 200, { comments: filtered });
            } catch {
                sendError(res, 500, 'Failed to retrieve comments');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/diff-comments/:wsId — create comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: collectionPattern,
        handler: async (req, res, match) => {
            const [, wsId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }
            if (!isValidContext(body.context)) {
                return sendError(res, 400, 'Missing or invalid required field: context');
            }
            if (body.selection === undefined || body.selection === null) {
                return sendError(res, 400, 'Missing required field: selection');
            }
            if (body.selectedText === undefined || body.selectedText === null) {
                return sendError(res, 400, 'Missing required field: selectedText');
            }
            if (body.comment === undefined || body.comment === null) {
                return sendError(res, 400, 'Missing required field: comment');
            }
            try {
                const comment = await manager.addComment(wsId, body.context, {
                    context: body.context,
                    selection: body.selection,
                    selectedText: body.selectedText,
                    comment: body.comment,
                    status: body.status || 'open',
                    author: body.author,
                    tags: body.tags,
                    replies: body.replies,
                    aiResponse: body.aiResponse,
                });
                const storageKey = manager.hashContext(body.context);
                getWsServer?.()?.broadcastProcessEvent({
                    type: 'diff-comment-updated',
                    action: 'added',
                    workspaceId: wsId,
                    storageKey,
                    comment,
                });
                sendJSON(res, 201, { comment });
            } catch {
                sendError(res, 500, 'Failed to create comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/diff-comments/:wsId/:key — list comments for storage key
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: storageKeyPattern,
        handler: async (_req, res, match) => {
            const [, wsId, storageKey] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            if (!isValidStorageKey(storageKey)) {
                return sendError(res, 400, 'Invalid storage key');
            }
            try {
                const comments = await manager.getComments(wsId, storageKey);
                sendJSON(res, 200, { comments });
            } catch {
                sendError(res, 500, 'Failed to retrieve comments');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/diff-comments/:wsId/:key/:id — get single comment
    // (Must be registered before item PATCH/DELETE to avoid duplicate pattern issues)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: itemPattern,
        handler: async (_req, res, match) => {
            const [, wsId, storageKey, id] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const comment = await manager.getComment(wsId, storageKey, id);
                if (!comment) {
                    return sendError(res, 404, 'Comment not found');
                }
                sendJSON(res, 200, { comment });
            } catch {
                sendError(res, 500, 'Failed to retrieve comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/diff-comments/:wsId/:key/:id — update comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: itemPattern,
        handler: async (req, res, match) => {
            const [, wsId, storageKey, id] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }
            try {
                const comment = await manager.updateComment(wsId, storageKey, id, body);
                if (!comment) {
                    return sendError(res, 404, 'Comment not found');
                }
                getWsServer?.()?.broadcastProcessEvent({
                    type: 'diff-comment-updated',
                    action: 'updated',
                    workspaceId: wsId,
                    storageKey,
                    comment,
                });
                sendJSON(res, 200, { comment });
            } catch {
                sendError(res, 500, 'Failed to update comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/diff-comments/:wsId/:key/:id — delete comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: itemPattern,
        handler: async (_req, res, match) => {
            const [, wsId, storageKey, id] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const deleted = await manager.deleteComment(wsId, storageKey, id);
                if (!deleted) {
                    return sendError(res, 404, 'Comment not found');
                }
                getWsServer?.()?.broadcastProcessEvent({
                    type: 'diff-comment-updated',
                    action: 'deleted',
                    workspaceId: wsId,
                    storageKey,
                    commentId: id,
                });
                sendJSON(res, 204, null);
            } catch {
                sendError(res, 500, 'Failed to delete comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/diff-comments/:wsId/:key/:id/replies — add reply
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: replyPattern,
        handler: async (req, res, match) => {
            const [, wsId, storageKey, id] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }
            if (!body.text || typeof body.text !== 'string') {
                return sendError(res, 400, 'Missing required field: text');
            }
            try {
                const reply = await manager.addReply(wsId, storageKey, id, {
                    author: body.author || 'Anonymous',
                    text: body.text,
                    isAI: body.isAI,
                });
                if (!reply) {
                    return sendError(res, 404, 'Comment not found');
                }
                getWsServer?.()?.broadcastProcessEvent({
                    type: 'diff-comment-updated',
                    action: 'updated',
                    workspaceId: wsId,
                    storageKey,
                    comment: await manager.getComment(wsId, storageKey, id),
                });
                sendJSON(res, 201, { reply });
            } catch {
                sendError(res, 500, 'Failed to add reply');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/diff-comments/:wsId/:key/:id/ask-ai — AI clarification
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: askAiPattern,
        handler: async (req, res, match) => {
            const [, wsId, storageKey, commentId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }
            try {
                const comment = await manager.getComment(wsId, storageKey, commentId);
                if (!comment) {
                    return sendError(res, 404, 'Comment not found');
                }

                const commandId: string | undefined = body.commandId;
                const customQuestion: string | undefined = body.customQuestion;

                // Resolve branch — deprecated, use POST /api/diff-comments/:wsId/resolve-with-ai
                if (commandId === 'resolve') {
                    return sendJSON(res, 410, { error: 'Use POST /api/diff-comments/:wsId/resolve-with-ai instead' });
                }

                // Non-resolve commands (Clarify, Go Deeper, Custom) — sync path
                let prompt: string;
                if (commandId) {
                    const command = DEFAULT_AI_COMMANDS.find(c => c.id === commandId);
                    if (command) {
                        prompt = buildDiffEnrichedPrompt(command, comment, customQuestion);
                    } else {
                        const question = customQuestion || body.question || 'Please explain this section and suggest improvements.';
                        prompt = buildDiffAIPrompt(comment, question);
                    }
                } else {
                    const question = body.question || 'Please explain this section and suggest improvements.';
                    prompt = buildDiffAIPrompt(comment, question);
                }

                const aiResult = await invokeCommentAI(prompt);
                if (!aiResult.success) {
                    return sendError(res, aiResult.unavailable ? 503 : 502, aiResult.error);
                }
                const aiResponse = aiResult.response;

                await manager.updateComment(wsId, storageKey, commentId, { aiResponse });

                const reply = await manager.addReply(wsId, storageKey, commentId, {
                    author: 'AI',
                    text: aiResponse,
                    isAI: true,
                });

                getWsServer?.()?.broadcastProcessEvent({
                    type: 'diff-comment-updated',
                    action: 'updated',
                    workspaceId: wsId,
                    storageKey,
                    comment: await manager.getComment(wsId, storageKey, commentId),
                });

                sendJSON(res, 200, { aiResponse, reply });
            } catch {
                sendError(res, 500, 'Failed to process AI request');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/diff-comments/:wsId/resolve-with-ai — unified resolve endpoint
    // Modes: commit-level (no filePath/commentId), single-file (filePath), single-comment (commentId)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: resolveWithAiPattern,
        handler: async (req, res, match) => {
            const [, wsId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }
            try {
                const { oldRef, newRef, filePath, commentId, userContext, skills: rawSkills } = body;
                const skills: string[] | undefined = Array.isArray(rawSkills) ? rawSkills : undefined;
                if (!oldRef || !newRef) {
                    return sendError(res, 400, 'Missing required fields: oldRef, newRef');
                }

                let targetComments: Array<{ comment: any; storageKey: string }> = [];

                if (commentId) {
                    // Single-comment mode: find the comment by scanning all comments
                    const allComments = await manager.listAllComments(wsId);
                    const found = allComments.find(c => c.id === commentId);
                    if (found) {
                        const sk = manager.hashContext(found.context);
                        targetComments.push({ comment: found, storageKey: sk });
                    }
                } else if (filePath) {
                    // Single-file mode: build context, hash, get comments for that file
                    const context = { repositoryId: '', oldRef, newRef, filePath };
                    // We need to find comments matching oldRef/newRef/filePath.
                    // Scan all comments and filter.
                    const allComments = await manager.listAllComments(wsId);
                    for (const c of allComments) {
                        if (c.context.oldRef === oldRef && c.context.newRef === newRef && c.context.filePath === filePath) {
                            const sk = manager.hashContext(c.context);
                            targetComments.push({ comment: c, storageKey: sk });
                        }
                    }
                } else {
                    // Commit-level mode: all comments matching oldRef/newRef
                    const allComments = await manager.listAllComments(wsId);
                    for (const c of allComments) {
                        if (c.context.oldRef === oldRef && c.context.newRef === newRef) {
                            const sk = manager.hashContext(c.context);
                            targetComments.push({ comment: c, storageKey: sk });
                        }
                    }
                }

                // Filter to open comments (unless single commentId, include regardless of status)
                if (!commentId) {
                    targetComments = targetComments.filter(tc => tc.comment.status === 'open');
                }

                if (targetComments.length === 0) {
                    return sendError(res, 400, 'No open comments found');
                }

                // Group by storageKey
                const grouped = new Map<string, { storageKey: string; commentIds: string[]; filePath: string }>();
                for (const tc of targetComments) {
                    const sk = tc.storageKey;
                    if (!grouped.has(sk)) {
                        grouped.set(sk, { storageKey: sk, commentIds: [], filePath: tc.comment.context.filePath });
                    }
                    grouped.get(sk)!.commentIds.push(tc.comment.id);
                }

                const files = Array.from(grouped.values());

                // Build file entries for prompt (need comments per file)
                const fileEntries = files.map(f => ({
                    filePath: f.filePath,
                    comments: targetComments
                        .filter(tc => tc.storageKey === f.storageKey)
                        .map(tc => tc.comment),
                }));

                const prompt = buildMultiFileBatchResolvePrompt(fileEntries, oldRef, newRef, userContext);
                if (!prompt) {
                    return sendError(res, 400, 'No open comments found');
                }

                try {
                    const taskId = await enqueueDiffResolveMultiTask(wsId, files, prompt, oldRef, newRef, skills);
                    if (taskId) {
                        return sendJSON(res, 202, { taskId, totalCount: targetComments.length });
                    }
                } catch {
                    // Fall through to error response
                }
                return sendError(res, 503, 'Queue unavailable: unable to enqueue resolve task');
            } catch {
                sendError(res, 500, 'Failed to process resolve-with-ai request');
            }
        },
    });
}

