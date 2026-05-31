/**
 * Queue follow-up routes (chat session operations).
 *
 * POST /api/queue/:id/resume-chat — Resume an expired chat session
 */

import { sendJSON, sendError } from '../core/api-handler';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import {
    serializeTask,
    validateAndParseTask,
    enqueueViaBridge,
    buildContextPrompt,
    type QueueRouteContext,
} from './queue-shared';

export function registerQueueFollowUpRoutes(routes: Route[], ctx: QueueRouteContext): void {
    const { bridge, store, globalWorkspaceRootPath, state } = ctx;

    // ------------------------------------------------------------------
    // POST /api/queue/:id/resume-chat — Resume an expired chat session
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/resume-chat$/,
        handler: async (_req, res, match) => {
            const taskId = decodeURIComponent(match![1]);

            if (!store) {
                return sendError(res, 500, 'Process store not available');
            }

            const mgr = bridge.findManagerForTask(taskId);
            const task = mgr?.getTask(taskId);
            if (!task) {
                return sendError(res, 404, 'Task not found');
            }

            const pid = task.processId ?? toQueueProcessId(taskId);

            // Reject concurrent resume requests synchronously, before any await,
            // so the guard reliably catches overlapping requests in the event loop.
            if (state.resumeInProgress.has(pid)) {
                return sendError(res, 409, 'Resume already in progress for this process');
            }
            state.resumeInProgress.add(pid);

            try {
                const wsId = (task.payload as any)?.workspaceId as string | undefined;
                const proc = await store.getProcess(pid, wsId);
                if (!proc) {
                    return sendError(res, 404, 'Process not found');
                }

                if (proc.status === 'running') {
                    return sendError(res, 400, 'Session is still active');
                }

                // Warm path: SDK session is still alive
                const sessionAlive = await bridge.isSessionAlive(pid);
                if (sessionAlive) {
                    await store.updateProcess(pid, {
                        status: 'completed',
                        error: undefined,
                    });
                    process.stderr.write(`[Queue] resume-chat warm taskId=${taskId} processId=${pid}\n`);
                    return sendJSON(res, 200, { resumed: true, processId: pid });
                }

                // Cold path: create a new chat task with context from old conversation
                const oldTurns = proc.conversationTurns ?? [];
                if (oldTurns.length === 0) {
                    return sendError(res, 409, 'No conversation history to resume from');
                }

                const aiAvailable = await bridge.isAIAvailable();
                if (!aiAvailable) {
                    return sendError(res, 503, 'AI service unavailable');
                }

                const contextPrompt = buildContextPrompt(oldTurns);
                const payload = task.payload as any;

                const newTaskSpec: any = {
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        prompt: contextPrompt,
                        resumedFrom: pid,
                        ...(payload?.workingDirectory ? { workingDirectory: payload.workingDirectory } : {}),
                        ...(payload?.workspaceId ? { workspaceId: payload.workspaceId } : {}),
                        ...(payload?.provider ? { provider: payload.provider } : {}),
                    },
                    config: {
                        ...(task.config ?? {}),
                        retryOnFailure: false,
                    },
                    displayName: task.displayName ?? 'Resumed Chat',
                };

                const validation = validateAndParseTask(newTaskSpec);
                if (!validation.valid) {
                    return sendError(res, 400, validation.error!);
                }

                try {
                    const newTaskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
                    const newTask = bridge.findManagerForTask(newTaskId)?.getTask(newTaskId);
                    const newProcessId = newTask?.processId ?? toQueueProcessId(newTaskId);

                    process.stderr.write(`[Queue] resume-chat cold taskId=${taskId} -> newTaskId=${newTaskId}\n`);
                    sendJSON(res, 200, {
                        resumed: false,
                        newTaskId,
                        newProcessId,
                        task: newTask ? serializeTask(newTask) : { id: newTaskId },
                    });
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to create resume task';
                    return sendError(res, 400, message);
                }
            } finally {
                state.resumeInProgress.delete(pid);
            }
        },
    });
}
