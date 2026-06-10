/**
 * Notes AI Create Handler
 *
 * REST endpoint for AI-powered note creation.
 * Enqueues a task that reads the notes tree, asks AI for a title and
 * placement, then creates the note file.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore, CreateTaskInput } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { isInheritedLensChatMode } from '../tasks/task-types';

// ============================================================================
// Route registration
// ============================================================================

export function registerNotesAICreateRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    bridge: MultiRepoQueueRouter,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/ai-create
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/ai-create$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (!body) return;

            const prompt = body.prompt as string | undefined;
            const chatTaskId = body.chatTaskId as string | undefined;
            const lensChat = isInheritedLensChatMode(body.lensChat) ? body.lensChat : undefined;
            if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
                return sendError(res, 400, 'Missing required field: prompt');
            }

            try {
                const wsRootPath = ws.rootPath || process.cwd();
                bridge.getOrCreateBridge(wsRootPath);
                const queueManager = bridge.registry.getQueueForRepo(wsRootPath);

                const input: CreateTaskInput = {
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt: prompt.trim(),
                        workspaceId: ws.id,
                        context: {
                            noteCreate: {
                                prompt: prompt.trim(),
                                ...(chatTaskId ? { chatTaskId } : {}),
                            },
                            ...(lensChat ? { lensChat } : {}),
                        },
                    },
                    config: {},
                    displayName: `AI note: ${prompt.trim().slice(0, 60)}`,
                };

                const taskId = await queueManager.enqueue(input);
                if (taskId) {
                    return sendJSON(res, 202, { taskId });
                }
                return sendError(res, 500, 'Failed to enqueue AI note creation task');
            } catch (err) {
                return sendError(res, 500, `Failed to create AI note: ${(err as Error).message}`);
            }
        },
    });
}
