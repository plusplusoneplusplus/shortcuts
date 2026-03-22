/**
 * Queue enqueue routes.
 *
 * POST /api/queue/enqueue — Legacy enqueue
 * POST /api/queue / POST /api/queue/tasks — Enqueue new task
 * POST /api/queue/bulk — Bulk enqueue
 * POST /api/queue/summarize — Summarize conversations
 * GET  /api/queue/models — List available AI models
 */

import { getActiveModels, modelMetadataStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError, parseBody } from '../api-handler';
import type { Route } from '../types';
import {
    serializeTask,
    validateAndParseTask,
    enqueueViaBridge,
    buildSummarizePrompt,
    type QueueRouteContext,
    type TaskValidationResult,
} from './queue-shared';

export function registerQueueEnqueueRoutes(routes: Route[], ctx: QueueRouteContext): void {
    const { bridge, store, globalWorkspaceRootPath, state } = ctx;

    // ------------------------------------------------------------------
    // GET /api/queue/models — List available AI model IDs
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/models',
        handler: async (_req, res) => {
            const live = modelMetadataStore.getCachedModels()
                .filter(m => m.policy?.state !== 'disabled');
            const models = live.length > 0
                ? live.map(m => m.id)
                : getActiveModels().map(m => m.id);
            sendJSON(res, 200, { models });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/enqueue — Legacy React enqueue endpoint
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/enqueue',
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const hasTaskEnvelope = typeof body?.type === 'string';
            if (!hasTaskEnvelope) {
                if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
                    return sendError(res, 400, 'Missing required field: prompt');
                }
            }

            const taskSpec = hasTaskEnvelope
                ? body
                : {
                    type: 'chat',
                    priority: typeof body?.priority === 'string' ? body.priority : 'normal',
                    payload: {
                        kind: 'chat' as const,
                        prompt: body.prompt.trim(),
                        ...(typeof body?.workspaceId === 'string' && body.workspaceId.trim()
                            ? { workspaceId: body.workspaceId.trim() }
                            : {}),
                        ...(typeof body?.folderPath === 'string' && body.folderPath.trim()
                            ? { folderPath: body.folderPath.trim() }
                            : {}),
                    },
                    config: {
                        ...(typeof body?.model === 'string' && body.model.trim()
                            ? { model: body.model.trim() }
                            : {}),
                        retryOnFailure: false,
                    },
                    ...(typeof body?.displayName === 'string' && body.displayName.trim()
                        ? { displayName: body.displayName.trim() }
                        : {}),
                    ...(Array.isArray(body?.images) && body.images.length > 0
                        ? { images: body.images }
                        : {}),
                };

            const validation = validateAndParseTask(taskSpec);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            try {
                const taskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
                const task = bridge.findManagerForTask(taskId)?.getTask(taskId);
                const inp = validation.input!;
                process.stderr.write(`[Queue] enqueue task=${taskId} type=${inp.type} priority=${inp.priority} repoId=${inp.repoId || '-'}\n`);
                sendJSON(res, 201, { task: task ? serializeTask(task) : { id: taskId } });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to enqueue task';
                return sendError(res, 400, message);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue — Enqueue a new task
    // POST /api/queue/tasks — Alias used by React components
    // ------------------------------------------------------------------
    const enqueueTaskHandler: Route['handler'] = async (req, res) => {
        let body: any;
        try {
            body = await parseBody(req);
        } catch {
            return sendError(res, 400, 'Invalid JSON');
        }

        const validation = validateAndParseTask(body);
        if (!validation.valid) {
            return sendError(res, 400, validation.error!);
        }

        try {
            const taskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
            const task = bridge.findManagerForTask(taskId)?.getTask(taskId);
            const inp = validation.input!;
            process.stderr.write(`[Queue] enqueue task=${taskId} type=${inp.type} priority=${inp.priority} repoId=${inp.repoId || '-'}\n`);
            sendJSON(res, 201, { task: task ? serializeTask(task) : { id: taskId } });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to enqueue task';
            return sendError(res, 400, message);
        }
    };
    routes.push({ method: 'POST', pattern: '/api/queue', handler: enqueueTaskHandler });
    routes.push({ method: 'POST', pattern: '/api/queue/tasks', handler: enqueueTaskHandler });

    // ------------------------------------------------------------------
    // POST /api/queue/bulk — Enqueue multiple tasks atomically
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/bulk',
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (!body.tasks || !Array.isArray(body.tasks)) {
                return sendError(res, 400, 'Missing or invalid field: tasks (must be an array)');
            }
            if (body.tasks.length === 0) {
                return sendError(res, 400, 'tasks array cannot be empty');
            }
            if (body.tasks.length > 100) {
                return sendError(res, 400, 'tasks array cannot exceed 100 items');
            }

            // Phase 1: Validate ALL tasks before enqueueing ANY
            const validations: TaskValidationResult[] = [];
            const validationErrors: Array<{ index: number; error: string; taskSpec: any }> = [];

            for (let i = 0; i < body.tasks.length; i++) {
                const taskSpec = body.tasks[i];
                const validation = validateAndParseTask(taskSpec);
                validations.push(validation);

                if (!validation.valid) {
                    validationErrors.push({ index: i, error: validation.error!, taskSpec });
                }
            }

            if (validationErrors.length > 0) {
                return sendJSON(res, 400, {
                    success: [],
                    failed: validationErrors,
                    summary: {
                        total: body.tasks.length,
                        succeeded: 0,
                        failed: validationErrors.length,
                    },
                });
            }

            // Phase 2: Enqueue all validated tasks
            const successResults: Array<{ index: number; taskId: string; task: Record<string, unknown> }> = [];
            const enqueueErrors: Array<{ index: number; error: string; taskSpec: any }> = [];

            for (let i = 0; i < validations.length; i++) {
                const validation = validations[i];
                const taskSpec = body.tasks[i];

                try {
                    const taskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
                    const task = bridge.findManagerForTask(taskId)?.getTask(taskId);

                    successResults.push({
                        index: i,
                        taskId,
                        task: task ? serializeTask(task) : { id: taskId },
                    });
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to enqueue task';
                    enqueueErrors.push({ index: i, error: message, taskSpec });
                }
            }

            if (successResults.length > 0) {
                const taskIds = successResults.map(r => r.taskId).join(',');
                process.stderr.write(`[Queue] bulk-enqueue count=${successResults.length} taskIds=${taskIds}\n`);
            }

            const response = {
                success: successResults,
                failed: enqueueErrors,
                summary: {
                    total: body.tasks.length,
                    succeeded: successResults.length,
                    failed: enqueueErrors.length,
                },
            };

            const statusCode = enqueueErrors.length === 0 ? 201 : 207;
            sendJSON(res, statusCode, response);
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/summarize — Summarize multiple conversations
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/summarize',
        handler: async (req, res) => {
            if (!store) {
                return sendError(res, 500, 'Process store not available');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (!Array.isArray(body.processIds)) {
                return sendError(res, 400, 'Missing or invalid field: processIds (must be an array)');
            }
            if (body.processIds.length < 2) {
                return sendError(res, 400, 'processIds must contain at least 2 items');
            }
            if (body.processIds.length > 20) {
                return sendError(res, 400, 'processIds cannot exceed 20 items');
            }
            if (!body.processIds.every((id: any) => typeof id === 'string' && id.trim().length > 0)) {
                return sendError(res, 400, 'Each processId must be a non-empty string');
            }

            if (typeof body.workspaceId !== 'string' || !body.workspaceId.trim()) {
                return sendError(res, 400, 'Missing required field: workspaceId');
            }

            const workspaceId = body.workspaceId.trim();
            const filePaths: string[] = body.processIds.map((id: string) => {
                const trimmed = id.trim();
                const normalized = trimmed.startsWith('queue_') ? trimmed : `queue_${trimmed}`;
                return store!.getProcessFilePath!(workspaceId, normalized);
            });

            const prompt = buildSummarizePrompt(filePaths);

            const taskSpec = {
                type: 'chat' as const,
                priority: 'normal' as const,
                payload: {
                    kind: 'chat' as const,
                    mode: 'ask' as const,
                    prompt,
                    workspaceId,
                },
                displayName: `Summarize ${body.processIds.length} conversations`,
            };

            const validation = validateAndParseTask(taskSpec);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            try {
                const taskId = await enqueueViaBridge(validation.input!, bridge, state, globalWorkspaceRootPath, store);
                process.stderr.write(
                    `[Queue] summarize processIds=${body.processIds.length} taskId=${taskId}\n`
                );
                sendJSON(res, 201, { taskId });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to enqueue summarize task';
                return sendError(res, 400, message);
            }
        },
    });
}
