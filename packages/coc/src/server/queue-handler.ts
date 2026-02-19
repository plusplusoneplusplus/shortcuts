/**
 * Queue REST API Handler
 *
 * HTTP API routes for task queue management: enqueue, dequeue, reorder,
 * pause/resume, cancel, and stats. Mirrors the VS Code extension's
 * AIQueueService feature for the standalone coc serve dashboard.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { TaskQueueManager, QueuedTask, CreateTaskInput, TaskPriority, QueueStats, ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { getActiveModels } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { computeRepoId } from './queue-persistence';
import { extractRepoId } from '@plusplusoneplusplus/coc-server';
import * as url from 'url';

// ============================================================================
// Validation Helpers
// ============================================================================

const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);
const VALID_TASK_TYPES: Set<string> = new Set(['follow-prompt', 'resolve-comments', 'code-review', 'ai-clarification', 'custom']);

/** Human-readable labels for task types, used when auto-generating display names. */
const TYPE_LABELS: Record<string, string> = {
    'follow-prompt': 'Follow Prompt',
    'resolve-comments': 'Resolve Comments',
    'code-review': 'Code Review',
    'ai-clarification': 'AI Clarification',
    'custom': 'Task',
};

/**
 * Auto-generate a display name for a task when the user doesn't provide one.
 * Derives a meaningful name from the task type and payload content.
 */
function generateDisplayName(type: string, payload: any): string {
    const typeLabel = TYPE_LABELS[type] || 'Task';

    // Try to extract a meaningful snippet from the payload
    if (payload) {
        // AI clarification: use prompt text
        if (typeof payload.prompt === 'string' && payload.prompt.trim()) {
            const snippet = payload.prompt.trim();
            return snippet.length > 60 ? snippet.substring(0, 57) + '...' : snippet;
        }
        // Follow prompt: use file path basename
        if (typeof payload.promptFilePath === 'string' && payload.promptFilePath.trim()) {
            const filePath = payload.promptFilePath.trim();
            const basename = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
            return `${typeLabel}: ${basename}`;
        }
        // Code review: use commit SHA or diff type
        if (payload.diffType) {
            const sha = payload.commitSha ? ` (${String(payload.commitSha).substring(0, 7)})` : '';
            return `${typeLabel}: ${payload.diffType}${sha}`;
        }
        // Custom: use data.prompt if available
        if (payload.data && typeof payload.data.prompt === 'string' && payload.data.prompt.trim()) {
            const snippet = payload.data.prompt.trim();
            return snippet.length > 60 ? snippet.substring(0, 57) + '...' : snippet;
        }
    }

    // Fallback: type label with timestamp
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${typeLabel} @ ${time}`;
}

/**
 * Serialize a QueuedTask for JSON response.
 * Converts internal representation to a clean API response.
 */
function serializeTask(task: QueuedTask): Record<string, unknown> {
    return {
        id: task.id,
        repoId: task.repoId,
        type: task.type,
        priority: task.priority,
        status: task.status,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        payload: task.payload,
        config: task.config,
        displayName: task.displayName,
        processId: task.processId,
        result: task.result,
        error: task.error,
        retryCount: task.retryCount,
    };
}

// ============================================================================
// Shared Validation
// ============================================================================

/**
 * Validation result for a single task specification.
 * Used internally for bulk validation before enqueueing.
 */
interface TaskValidationResult {
    valid: boolean;
    error?: string;
    input?: CreateTaskInput;
}

/**
 * Validate a single task specification and construct CreateTaskInput.
 * Extracted from POST /api/queue handler to enable reuse in bulk endpoint.
 */
function validateAndParseTask(taskSpec: any): TaskValidationResult {
    if (!taskSpec.type) {
        return { valid: false, error: 'Missing required field: type' };
    }
    if (!VALID_TASK_TYPES.has(taskSpec.type)) {
        return {
            valid: false,
            error: `Invalid task type: ${taskSpec.type}. Valid types: ${Array.from(VALID_TASK_TYPES).join(', ')}`,
        };
    }

    const priority: TaskPriority = VALID_PRIORITIES.has(taskSpec.priority)
        ? taskSpec.priority
        : 'normal';

    const payload = taskSpec.payload || { data: {} };
    const displayName = (typeof taskSpec.displayName === 'string' && taskSpec.displayName.trim())
        ? taskSpec.displayName.trim()
        : generateDisplayName(taskSpec.type, payload);

    const input: CreateTaskInput = {
        type: taskSpec.type,
        priority,
        payload,
        config: {
            model: taskSpec.config?.model,
            timeoutMs: taskSpec.config?.timeoutMs,
            retryOnFailure: taskSpec.config?.retryOnFailure ?? false,
            retryAttempts: taskSpec.config?.retryAttempts,
            retryDelayMs: taskSpec.config?.retryDelayMs,
        },
        displayName,
    };

    // Pass through repoId if provided
    if (typeof taskSpec.repoId === 'string' && taskSpec.repoId.trim()) {
        input.repoId = taskSpec.repoId.trim();
    }

    return { valid: true, input };
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all queue API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes - Route table to mutate
 * @param queueManager - Task queue manager
 * @param store - Optional process store (used by force-fail routes to update linked process status)
 */
export function registerQueueRoutes(routes: Route[], queueManager: TaskQueueManager, store?: ProcessStore): void {

    // ------------------------------------------------------------------
    // GET /api/queue/models — List available AI model IDs
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/models',
        handler: async (_req, res) => {
            const models = getActiveModels().map(model => model.id);
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

            // Legacy dialog sends { prompt, model, workspaceId } without task wrapper.
            const hasTaskEnvelope = typeof body?.type === 'string';
            if (!hasTaskEnvelope) {
                if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
                    return sendError(res, 400, 'Missing required field: prompt');
                }
            }

            const taskSpec = hasTaskEnvelope
                ? body
                : {
                    type: 'ai-clarification',
                    priority: typeof body?.priority === 'string' ? body.priority : 'normal',
                    payload: {
                        prompt: body.prompt.trim(),
                        ...(typeof body?.workspaceId === 'string' && body.workspaceId.trim()
                            ? { workspaceId: body.workspaceId.trim() }
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
                };

            const validation = validateAndParseTask(taskSpec);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            try {
                const taskId = queueManager.enqueue(validation.input!);
                const task = queueManager.getTask(taskId);
                sendJSON(res, 201, { task: task ? serializeTask(task) : { id: taskId } });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to enqueue task';
                return sendError(res, 400, message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue — List all queued tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = typeof parsed.query.repoId === 'string' && parsed.query.repoId
                ? parsed.query.repoId
                : undefined;

            let queued: Record<string, unknown>[];
            let running: Record<string, unknown>[];

            if (repoId) {
                const matchesRepo = (task: QueuedTask): boolean =>
                    task.repoId === repoId || extractRepoId(task.payload) === repoId;
                queued = queueManager.getQueued().filter(matchesRepo).map(serializeTask);
                running = queueManager.getRunning().filter(matchesRepo).map(serializeTask);
            } else {
                queued = queueManager.getQueued().map(serializeTask);
                running = queueManager.getRunning().map(serializeTask);
            }

            const stats = queueManager.getStats();
            sendJSON(res, 200, { queued, running, stats });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue — Enqueue a new task
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue',
        handler: async (req, res) => {
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
                const taskId = queueManager.enqueue(validation.input!);
                const task = queueManager.getTask(taskId);
                sendJSON(res, 201, { task: task ? serializeTask(task) : { id: taskId } });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to enqueue task';
                return sendError(res, 400, message);
            }
        },
    });

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

            // Validate request structure
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
                    validationErrors.push({
                        index: i,
                        error: validation.error!,
                        taskSpec,
                    });
                }
            }

            // If any task failed validation, abort with 400
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
                    const taskId = queueManager.enqueue(validation.input!);
                    const task = queueManager.getTask(taskId);

                    successResults.push({
                        index: i,
                        taskId,
                        task: task ? serializeTask(task) : { id: taskId },
                    });
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to enqueue task';
                    enqueueErrors.push({
                        index: i,
                        error: message,
                        taskSpec,
                    });
                }
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

            // 201 if all succeeded, 207 (Multi-Status) if partial success
            const statusCode = enqueueErrors.length === 0 ? 201 : 207;
            sendJSON(res, statusCode, response);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/stats — Queue statistics
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/stats',
        handler: async (_req, res) => {
            const stats: QueueStats = queueManager.getStats();
            sendJSON(res, 200, { stats });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/history — Queue task history
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/history',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = typeof parsed.query.repoId === 'string' && parsed.query.repoId
                ? parsed.query.repoId
                : undefined;

            let history: Record<string, unknown>[];
            if (repoId) {
                const matchesRepo = (task: QueuedTask): boolean =>
                    task.repoId === repoId || extractRepoId(task.payload) === repoId;
                history = queueManager.getHistory().filter(matchesRepo).map(serializeTask);
            } else {
                history = queueManager.getHistory().map(serializeTask);
            }

            sendJSON(res, 200, { history });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/pause — Pause queue processing (global or per-repo)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/pause',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = typeof parsed.query.repoId === 'string' ? parsed.query.repoId : undefined;

            if (repoId) {
                queueManager.pauseRepo(repoId);
                sendJSON(res, 200, { repoId, paused: true, stats: queueManager.getStats() });
            } else {
                queueManager.pause();
                sendJSON(res, 200, { paused: true, stats: queueManager.getStats() });
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/resume — Resume queue processing (global or per-repo)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/resume',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = typeof parsed.query.repoId === 'string' ? parsed.query.repoId : undefined;

            if (repoId) {
                queueManager.resumeRepo(repoId);
                sendJSON(res, 200, { repoId, paused: false, stats: queueManager.getStats() });
            } else {
                queueManager.resume();
                sendJSON(res, 200, { paused: false, stats: queueManager.getStats() });
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/repos — List repos with pause states and task counts
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue/repos',
        handler: async (_req, res) => {
            const allTasks = [...queueManager.getQueued(), ...queueManager.getRunning()];
            const repoMap = new Map<string, { repoId: string; rootPath: string; isPaused: boolean; taskCount: number }>();

            for (const task of allTasks) {
                const payload = task.payload as Record<string, unknown>;
                const rootPath = (typeof payload?.workingDirectory === 'string' && payload.workingDirectory)
                    ? payload.workingDirectory
                    : process.cwd();
                const repoId = computeRepoId(rootPath);

                if (!repoMap.has(repoId)) {
                    repoMap.set(repoId, {
                        repoId,
                        rootPath,
                        isPaused: queueManager.isRepoPaused(repoId),
                        taskCount: 0,
                    });
                }
                repoMap.get(repoId)!.taskCount++;
            }

            // Also include paused repos that may have no active tasks
            for (const pausedId of queueManager.getPausedRepos()) {
                if (!repoMap.has(pausedId)) {
                    repoMap.set(pausedId, {
                        repoId: pausedId,
                        rootPath: '',
                        isPaused: true,
                        taskCount: 0,
                    });
                }
            }

            sendJSON(res, 200, { repos: Array.from(repoMap.values()) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue — Clear all queued tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: '/api/queue',
        handler: async (_req, res) => {
            const count = queueManager.getQueued().length;
            queueManager.clear();
            sendJSON(res, 200, { cleared: count, stats: queueManager.getStats() });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/history — Clear queue history
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: '/api/queue/history',
        handler: async (_req, res) => {
            queueManager.clearHistory();
            sendJSON(res, 200, { cleared: true });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/force-fail-running — Force-fail all stale running tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/force-fail-running',
        handler: async (req, res) => {
            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                // Use defaults
            }
            const error = (typeof body.error === 'string' && body.error.trim())
                ? body.error.trim()
                : 'Task was force-failed (assumed stale)';

            // Collect running task process IDs before force-failing
            const runningTasks = queueManager.getRunning();
            const processIds = runningTasks
                .map(t => t.processId)
                .filter((pid): pid is string => !!pid);

            const count = queueManager.forceFailRunning(error);

            // Also update linked processes in the store
            if (store && processIds.length > 0) {
                for (const pid of processIds) {
                    try {
                        await store.updateProcess(pid, {
                            status: 'failed',
                            endTime: new Date(),
                            error,
                        });
                    } catch {
                        // Non-fatal: process may not exist in store
                    }
                }
            }

            sendJSON(res, 200, { forceFailed: count, stats: queueManager.getStats() });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/force-fail — Force-fail a single running task
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/force-fail$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                // Use defaults
            }
            const error = (typeof body.error === 'string' && body.error.trim())
                ? body.error.trim()
                : 'Task was force-failed (assumed stale)';

            // Get the task's linked process ID before force-failing
            const task = queueManager.getTask(id);
            const processId = task?.processId;

            const success = queueManager.forceFailTask(id, error);
            if (!success) {
                return sendError(res, 404, 'Task not found or not running');
            }

            // Also update the linked process in the store
            if (store && processId) {
                try {
                    await store.updateProcess(processId, {
                        status: 'failed',
                        endTime: new Date(),
                        error,
                    });
                } catch {
                    // Non-fatal
                }
            }

            sendJSON(res, 200, { forceFailed: true, stats: queueManager.getStats() });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/:id — Get a single task by ID
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/queue\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);

            // Skip known sub-routes
            if (['stats', 'history', 'pause', 'resume', 'force-fail-running', 'bulk', 'repos'].includes(id)) {
                return sendError(res, 404, 'Task not found');
            }

            const task = queueManager.getTask(id);
            if (!task) {
                return sendError(res, 404, 'Task not found');
            }
            sendJSON(res, 200, { task: serializeTask(task) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/:id — Cancel a task
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/queue\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);

            // Skip known sub-routes
            if (['history'].includes(id)) {
                return sendError(res, 404, 'Task not found');
            }

            const cancelled = queueManager.cancelTask(id);
            if (!cancelled) {
                return sendError(res, 404, 'Task not found or not cancellable');
            }
            sendJSON(res, 200, { cancelled: true });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/move-to-top — Move task to top of queue
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/move-to-top$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const moved = queueManager.moveToTop(id);
            if (!moved) {
                return sendError(res, 404, 'Task not found in queue');
            }
            sendJSON(res, 200, { moved: true, position: 1 });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/move-up — Move task up one position
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/move-up$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const moved = queueManager.moveUp(id);
            if (!moved) {
                return sendError(res, 404, 'Task not found or already at top');
            }
            const position = queueManager.getPosition(id);
            sendJSON(res, 200, { moved: true, position });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/move-down — Move task down one position
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/move-down$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const moved = queueManager.moveDown(id);
            if (!moved) {
                return sendError(res, 404, 'Task not found or already at bottom');
            }
            const position = queueManager.getPosition(id);
            sendJSON(res, 200, { moved: true, position });
        },
    });
}
