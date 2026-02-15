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

import type { TaskQueueManager, QueuedTask, CreateTaskInput, TaskPriority, QueueStats } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from './api-handler';
import type { Route } from './types';

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
// Route Registration
// ============================================================================

/**
 * Register all queue API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerQueueRoutes(routes: Route[], queueManager: TaskQueueManager): void {

    // ------------------------------------------------------------------
    // GET /api/queue — List all queued tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/queue',
        handler: async (_req, res) => {
            const queued = queueManager.getQueued().map(serializeTask);
            const running = queueManager.getRunning().map(serializeTask);
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

            // Validate required fields
            if (!body.type) {
                return sendError(res, 400, 'Missing required field: type');
            }
            if (!VALID_TASK_TYPES.has(body.type)) {
                return sendError(res, 400, `Invalid task type: ${body.type}. Valid types: ${Array.from(VALID_TASK_TYPES).join(', ')}`);
            }

            const priority: TaskPriority = VALID_PRIORITIES.has(body.priority) ? body.priority : 'normal';

            const payload = body.payload || { data: {} };
            const displayName = (typeof body.displayName === 'string' && body.displayName.trim())
                ? body.displayName.trim()
                : generateDisplayName(body.type, payload);

            const input: CreateTaskInput = {
                type: body.type,
                priority,
                payload,
                config: {
                    model: body.config?.model,
                    timeoutMs: body.config?.timeoutMs,
                    retryOnFailure: body.config?.retryOnFailure ?? false,
                    retryAttempts: body.config?.retryAttempts,
                    retryDelayMs: body.config?.retryDelayMs,
                },
                displayName,
            };

            try {
                const taskId = queueManager.enqueue(input);
                const task = queueManager.getTask(taskId);
                sendJSON(res, 201, { task: task ? serializeTask(task) : { id: taskId } });
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to enqueue task';
                return sendError(res, 400, message);
            }
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
        handler: async (_req, res) => {
            const history = queueManager.getHistory().map(serializeTask);
            sendJSON(res, 200, { history });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/pause — Pause queue processing
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/pause',
        handler: async (_req, res) => {
            queueManager.pause();
            sendJSON(res, 200, { paused: true, stats: queueManager.getStats() });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/resume — Resume queue processing
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/resume',
        handler: async (_req, res) => {
            queueManager.resume();
            sendJSON(res, 200, { paused: false, stats: queueManager.getStats() });
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
    // GET /api/queue/:id — Get a single task by ID
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/queue\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);

            // Skip known sub-routes
            if (['stats', 'history', 'pause', 'resume'].includes(id)) {
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
