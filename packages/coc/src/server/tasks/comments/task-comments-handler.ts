/**
 * Task Comments REST API Handler
 *
 * HTTP API routes for CRUD operations on task file comments.
 * Stores comments in JSON files under the CoC data directory,
 * compatible with the extension's comment storage format.
 *
 * Storage layout:
 *   {dataDir}/repos/{workspaceId}/tasks-comments/{sha256(filePath)}.json
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import { sendJSON, sendError } from '../../core/api-handler';
import { parseBodyOrReject } from '../../shared/handler-utils';
import { isValidWorkspaceId } from './base-comments-manager';
import type { Route } from '../../types';
import type { ProcessWebSocketServer } from '../../streaming/websocket';
import { type CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../../queue/multi-repo-queue-router';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { resolveTaskRoot } from '../task-root-resolver';
import { TaskCommentsManager } from './task-comments-manager';
import type { TaskComment, DocumentContext } from './task-comments-manager';
import { relocateCommentsIfNeeded } from './task-comments-relocation';
import { buildEnrichedPrompt, buildBatchResolvePrompt, buildAIPrompt, DEFAULT_AI_COMMANDS } from './task-comments-ai';
import { invokeCommentAI } from './comments-ai-helpers';

// Re-export types and classes so existing importers don't break
export type { TaskComment, TaskCommentReply, CommentAnchor, DocumentContext, CommentsStorage } from './task-comments-manager';
export { TaskCommentsManager } from './task-comments-manager';
export { buildBatchResolvePrompt } from './task-comments-ai';

// ============================================================================
// Validation Helpers
// ============================================================================

/** Required fields for creating a comment. */
const REQUIRED_FIELDS = ['filePath', 'selection', 'selectedText', 'comment'] as const;

/** Validate that the comment body has all required fields. Returns the missing field name or null. */
function findMissingField(body: any): string | null {
    for (const field of REQUIRED_FIELDS) {
        if (body[field] === undefined || body[field] === null) {
            return field;
        }
    }
    return null;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register task comments API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * Endpoints:
 *   GET    /api/workspaces/:wsId/tasks/comment-counts  — comment counts per file
 *   GET    /api/comments/:wsId/:taskPath(*)           — list comments
 *   POST   /api/comments/:wsId/:taskPath(*)           — create comment
 *   GET    /api/comments/:wsId/:taskPath(*)/:id       — get single comment
 *   PATCH  /api/comments/:wsId/:taskPath(*)/:id       — update comment
 *   DELETE /api/comments/:wsId/:taskPath(*)/:id       — delete comment
 *   POST   /api/comments/:wsId/:taskPath(*)/:id/replies   — add reply
 *   POST   /api/comments/:wsId/:taskPath(*)/:id/ask-ai    — AI clarification
 *   POST   /api/comments/:wsId/:taskPath(*)/batch-resolve — batch AI resolve
 *
 * @param routes - Shared route table
 * @param dataDir - Directory for comment storage (e.g. ~/.coc)
 * @param bridge - Multi-repo queue bridge for async AI execution
 * @param store - Optional process store for workspace resolution
 */
export function registerTaskCommentsRoutes(routes: Route[], dataDir: string, bridge: MultiRepoQueueRouter, store?: ProcessStore, getWsServer?: () => ProcessWebSocketServer | undefined): void {
    const manager = new TaskCommentsManager(dataDir);

    /**
     * Resolve workspace rootPath from a workspace ID via the process store.
     */
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

    /**
     * Resolve the absolute task root path for a workspace.
     * Returns the task root directory (e.g. ~/.coc/repos/<repoId>/tasks).
     */
    async function resolveTaskRootPath(wsId: string): Promise<string | undefined> {
        if (!store) return undefined;
        try {
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find((w: any) => w.id === wsId.trim());
            if (!ws?.rootPath) return undefined;
            const { absolutePath } = resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id });
            return absolutePath;
        } catch {
            return undefined;
        }
    }

    /**
     * Enqueue a resolve-comments task via the multi-repo bridge.
     * Returns the task ID, or undefined if enqueueing fails.
     */
    async function enqueueResolveTask(
        wsId: string,
        taskPath: string,
        commentIds: string[],
        prompt: string,
        documentContent: string,
        skills?: string[],
    ): Promise<string | undefined> {
        const wsRootPath = await resolveWorkspaceRootPath(wsId) || process.cwd();
        bridge.getOrCreateBridge(wsRootPath);
        const queueManager = bridge.registry.getQueueForRepo(wsRootPath);
        const input: CreateTaskInput = {
            type: 'chat',
            priority: 'normal',
            // repoId is required so the task's resulting process inherits the
            // workspace_id column (process-lifecycle-runner falls back to
            // task.repoId when payload.workspaceId is missing). Without it,
            // the resolved-comments conversation is invisible to the workspace
            // history endpoint that powers the Activity tab.
            repoId: wsId,
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt,
                tools: ['resolve-comments'],
                workspaceId: wsId,
                workingDirectory: wsRootPath,
                context: {
                    files: [path.resolve(wsRootPath, taskPath)],
                    resolveComments: {
                        documentUri: taskPath,
                        commentIds,
                        documentContent,
                        filePath: taskPath,
                        wsId,
                    },
                    ...(skills?.length ? { skills } : {}),
                },
            },
            config: {},
            displayName: `Resolve comments: ${taskPath}`,
        };
        return queueManager.enqueue(input);
    }

    // Pattern for comment counts endpoint: /api/workspaces/{wsId}/tasks/comment-counts
    const countsPattern = /^\/api\/workspaces\/([a-zA-Z0-9_-]+)\/tasks\/comment-counts$/;

    // Pattern for collection endpoints: /api/comments/{wsId}/{taskPath...}
    // taskPath is everything after the wsId segment, captured greedily.
    const collectionPattern = /^\/api\/comments\/([a-zA-Z0-9_-]+)\/(.+)$/;

    // Pattern for item endpoints: /api/comments/{wsId}/{taskPath...}/{uuid}
    // UUID is a standard v4 UUID at the end of the path.
    const itemPattern = /^\/api\/comments\/([a-zA-Z0-9_-]+)\/(.+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

    // Pattern for reply endpoints: /api/comments/{wsId}/{taskPath...}/{uuid}/replies
    const replyPattern = /^\/api\/comments\/([a-zA-Z0-9_-]+)\/(.+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/replies$/;

    // Pattern for AI ask endpoint: /api/comments/{wsId}/{taskPath...}/{uuid}/ask-ai
    const askAiPattern = /^\/api\/comments\/([a-zA-Z0-9_-]+)\/(.+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/ask-ai$/;

    // Pattern for batch resolve endpoint: /api/comments/{wsId}/{taskPath...}/batch-resolve
    const batchResolvePattern = /^\/api\/comments\/([a-zA-Z0-9_-]+)\/(.+)\/batch-resolve$/;

    // ------------------------------------------------------------------
    // GET /api/workspaces/:wsId/tasks/comment-counts — comment counts per file
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: countsPattern,
        handler: async (_req, res, match) => {
            const [, wsId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const counts = await manager.getCommentCounts(wsId);
                sendJSON(res, 200, { counts });
            } catch {
                sendError(res, 500, 'Failed to retrieve comment counts');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/comments/:wsId/:taskPath(*)/:id — single comment
    // (Must be before the collection GET to avoid greedy match)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: itemPattern,
        handler: async (_req, res, match) => {
            const [, wsId, rawTaskPath, commentId] = match!;
            const taskPath = decodeURIComponent(rawTaskPath);
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const comment = await manager.getComment(wsId, taskPath, commentId);
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
    // GET /api/comments/:wsId/:taskPath(*) — list all comments
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: collectionPattern,
        handler: async (_req, res, match) => {
            const [, wsId, rawTaskPath] = match!;
            const taskPath = decodeURIComponent(rawTaskPath);
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                let comments = await manager.getComments(wsId, taskPath);
                if (comments.length > 0) {
                    const taskRoot = await resolveTaskRootPath(wsId);
                    if (taskRoot) {
                        comments = await relocateCommentsIfNeeded(
                            manager, wsId, taskPath, comments, taskRoot
                        );
                    }
                }
                sendJSON(res, 200, { comments });
            } catch {
                sendError(res, 500, 'Failed to retrieve comments');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/comments/:wsId/:taskPath(*)/:id/replies — add reply
    // (Must be before the collection POST to avoid greedy match)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: replyPattern,
        handler: async (req, res, match) => {
            const [, wsId, rawTaskPath, commentId] = match!;
            const taskPath = decodeURIComponent(rawTaskPath);
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!body.text || typeof body.text !== 'string') {
                return sendError(res, 400, 'Missing required field: text');
            }
            try {
                const reply = await manager.addReply(wsId, taskPath, commentId, {
                    author: body.author || 'Anonymous',
                    text: body.text,
                    isAI: body.isAI,
                });
                if (!reply) {
                    return sendError(res, 404, 'Comment not found');
                }
                sendJSON(res, 201, { reply });
            } catch {
                sendError(res, 500, 'Failed to add reply');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/comments/:wsId/:taskPath(*)/:id/ask-ai — AI clarification
    // (Must be before the collection POST to avoid greedy match)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: askAiPattern,
        handler: async (req, res, match) => {
            const [, wsId, rawTaskPath, commentId] = match!;
            const taskPath = decodeURIComponent(rawTaskPath);
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            try {
                const comment = await manager.getComment(wsId, taskPath, commentId);
                if (!comment) {
                    return sendError(res, 404, 'Comment not found');
                }

                // Extract new optional body fields
                const commandId: string | undefined = body.commandId;
                const customQuestion: string | undefined = body.customQuestion;
                const documentContext: DocumentContext | undefined = body.documentContext;

                // Resolve branch — returns revised document content, not a Q&A reply
                if (commandId === 'resolve') {
                    const documentContent: string | undefined = body.documentContent;
                    if (!documentContent || typeof documentContent !== 'string') {
                        return sendError(res, 400, 'Missing required field: documentContent');
                    }
                    const userContext: string | undefined = body.userContext;
                    const skills: string[] | undefined = Array.isArray(body.skills) ? body.skills : undefined;
                    const taskRoot = await resolveTaskRootPath(wsId);
                    const absoluteTaskPath = taskRoot ? path.join(taskRoot, taskPath) : taskPath;
                    const resolvePrompt = buildBatchResolvePrompt([comment], absoluteTaskPath, taskPath, userContext);

                    try {
                        const taskId = await enqueueResolveTask(wsId, taskPath, [comment.id], resolvePrompt, documentContent, skills);
                        if (taskId) {
                            return sendJSON(res, 202, { taskId });
                        }
                    } catch {
                        // Fall through to error response
                    }
                    return sendError(res, 503, 'Queue unavailable: unable to enqueue resolve task');
                }

                let prompt: string;
                if (commandId) {
                    const command = DEFAULT_AI_COMMANDS.find(c => c.id === commandId);
                    if (command) {
                        prompt = buildEnrichedPrompt(command, comment, customQuestion, documentContext);
                    } else {
                        // Unknown commandId: fall back to legacy behavior with question text
                        const question = customQuestion || body.question || 'Please explain this section and suggest improvements.';
                        prompt = buildAIPrompt(comment, question);
                    }
                } else {
                    // Legacy path: no commandId supplied
                    const question = body.question || 'Please explain this section and suggest improvements.';
                    prompt = buildAIPrompt(comment, question);
                }

                // Try to invoke AI
                const aiResult = await invokeCommentAI(prompt);
                if (!aiResult.success) {
                    return sendError(res, aiResult.unavailable ? 503 : 502, aiResult.error);
                }
                const aiResponse = aiResult.response;

                // Store AI response on the comment
                await manager.updateComment(wsId, taskPath, commentId, { aiResponse });

                // Also add as an AI reply
                const reply = await manager.addReply(wsId, taskPath, commentId, {
                    author: 'AI',
                    text: aiResponse,
                    isAI: true,
                });

                sendJSON(res, 200, { aiResponse, reply });
            } catch {
                sendError(res, 500, 'Failed to process AI request');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/comments/:wsId/:taskPath(*)/batch-resolve — batch AI resolve
    // (Must be before the collection POST to avoid greedy match)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: batchResolvePattern,
        handler: async (req, res, match) => {
            const [, wsId, rawTaskPath] = match!;
            const taskPath = decodeURIComponent(rawTaskPath);
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const documentContent: string | undefined = body.documentContent;
            if (!documentContent || typeof documentContent !== 'string') {
                return sendError(res, 400, 'Missing required field: documentContent');
            }

            const userContext: string | undefined = body.userContext;
            const skills: string[] | undefined = Array.isArray(body.skills) ? body.skills : undefined;

            // Load and filter open comments
            const allComments = await manager.getComments(wsId, taskPath);
            const openComments = allComments.filter(c => c.status === 'open');
            if (openComments.length === 0) {
                return sendError(res, 400, 'No open comments to resolve');
            }

            // Build prompt and invoke AI
            const taskRoot = await resolveTaskRootPath(wsId);
            const absoluteTaskPath = taskRoot ? path.join(taskRoot, taskPath) : taskPath;
            const prompt = buildBatchResolvePrompt(openComments, absoluteTaskPath, taskPath, userContext);
            const commentIds = openComments.map(c => c.id);

            try {
                const taskId = await enqueueResolveTask(wsId, taskPath, commentIds, prompt, documentContent, skills);
                if (taskId) {
                    return sendJSON(res, 202, { taskId });
                }
            } catch {
                // Fall through to error response
            }
            return sendError(res, 503, 'Queue unavailable: unable to enqueue resolve task');
        },
    });

    // ------------------------------------------------------------------
    // POST /api/comments/:wsId/:taskPath(*) — create comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: collectionPattern,
        handler: async (req, res, match) => {
            const [, wsId, rawTaskPath] = match!;
            const taskPath = decodeURIComponent(rawTaskPath);
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const missing = findMissingField(body);
            if (missing) {
                return sendError(res, 400, `Missing required field: ${missing}`);
            }
            if (!body.status) {
                body.status = 'open';
            }
            try {
                const comment = await manager.addComment(wsId, taskPath, body);
                sendJSON(res, 201, { comment });
            } catch {
                sendError(res, 500, 'Failed to create comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/comments/:wsId/:taskPath(*)/:id — update comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: itemPattern,
        handler: async (req, res, match) => {
            const [, wsId, rawTaskPath, commentId] = match!;
            const taskPath = decodeURIComponent(rawTaskPath);
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            try {
                const comment = await manager.updateComment(wsId, taskPath, commentId, body);
                if (!comment) {
                    return sendError(res, 404, 'Comment not found');
                }
                sendJSON(res, 200, { comment });
            } catch {
                sendError(res, 500, 'Failed to update comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/comments/:wsId/:taskPath(*)/:id — delete comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: itemPattern,
        handler: async (_req, res, match) => {
            const [, wsId, rawTaskPath, commentId] = match!;
            const taskPath = decodeURIComponent(rawTaskPath);
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const deleted = await manager.deleteComment(wsId, taskPath, commentId);
                if (!deleted) {
                    return sendError(res, 404, 'Comment not found');
                }
                res.writeHead(204);
                res.end();
            } catch {
                sendError(res, 500, 'Failed to delete comment');
            }
        },
    });
}
