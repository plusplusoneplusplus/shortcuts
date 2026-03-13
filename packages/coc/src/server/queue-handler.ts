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

import type { TaskQueueManager, QueuedTask, CreateTaskInput, TaskPriority, QueueStats, ProcessStore, ConversationTurn, PauseMarker } from '@plusplusoneplusplus/pipeline-core';
import { getActiveModels } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { ImageBlobStore } from './image-blob-store';
import type { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Validation Helpers
// ============================================================================

const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);
const VALID_TASK_TYPES: Set<string> = new Set(['chat', 'run-workflow', 'run-script', 'custom']);

/** Human-readable labels for task types, used when auto-generating display names. */
const TYPE_LABELS: Record<string, string> = {
    'chat': 'Chat',
    'run-workflow': 'Run Workflow',
    'run-script': 'Run Script',
};

/**
 * Auto-generate a display name for a task when the user doesn't provide one.
 * Derives a meaningful name from the task type and payload content.
 */
function generateDisplayName(type: string, payload: any): string {
    const typeLabel = TYPE_LABELS[type] || 'Task';

    // Try to extract a meaningful snippet from the payload
    if (payload) {
        // Chat follow-up: use prompt text
        if (payload.kind === 'chat' && payload.processId && typeof payload.prompt === 'string' && payload.prompt.trim()) {
            const snippet = payload.prompt.trim();
            return snippet.length > 60 ? snippet.substring(0, 57) + '...' : snippet;
        }
        // Chat with prompt: use prompt text
        if (typeof payload.prompt === 'string' && payload.prompt.trim()) {
            const snippet = payload.prompt.trim();
            return snippet.length > 60 ? snippet.substring(0, 57) + '...' : snippet;
        }
        // Chat with context files: use first file path basename
        if (payload.context?.files?.length > 0) {
            const filePath = payload.context.files[0];
            const basename = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
            return `${typeLabel}: ${basename}`;
        }
        // Run workflow: use workflow path basename
        if (typeof payload.workflowPath === 'string' && payload.workflowPath.trim()) {
            const basename = path.basename(payload.workflowPath);
            return `${typeLabel}: ${basename}`;
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
    const payload = task.payload as any;
    // Strip inline images and server-internal imagesFilePath; expose metadata only
    const { images, imagesFilePath, ...restPayload } = payload || {};
    const imagesCount = Array.isArray(images) ? images.length : (payload?.imagesCount ?? 0);
    const serializedPayload = {
        ...restPayload,
        imagesCount,
        hasImages: imagesCount > 0 || !!imagesFilePath,
    };
    return {
        id: task.id,
        repoId: task.repoId,
        folderPath: task.folderPath,
        type: task.type,
        priority: task.priority,
        status: task.status,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        payload: serializedPayload,
        config: task.config,
        displayName: task.displayName,
        processId: task.processId,
        result: task.result,
        error: task.error,
        retryCount: task.retryCount,
        frozen: task.frozen ?? undefined,
    };
}

/**
 * Serialize a queue item (task or pause marker) for JSON response.
 */
function serializeQueueItem(item: QueuedTask | PauseMarker): Record<string, unknown> {
    if ((item as PauseMarker).kind === 'pause-marker') {
        const marker = item as PauseMarker;
        return { kind: 'pause-marker', id: marker.id, createdAt: marker.createdAt };
    }
    return serializeTask(item as QueuedTask);
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

    const payload = taskSpec.payload || {};

    // Ensure chat payloads carry kind:'chat' and a valid mode so downstream
    // isChatPayload() guards match (e.g. extractPrompt, toAgentMode).
    if (taskSpec.type === 'chat' || taskSpec.type === 'custom') {
        if (!payload.kind) payload.kind = 'chat';
        if (!payload.mode) payload.mode = 'autopilot';
    }

    // Promote top-level prompt into payload when not already present
    if (typeof taskSpec.prompt === 'string' && taskSpec.prompt.trim()
        && !payload.prompt) {
        payload.prompt = taskSpec.prompt.trim();
    }

    // Promote nested data.prompt into payload when not already present (used by custom tasks)
    if (!payload.prompt && payload.data && typeof (payload.data as any).prompt === 'string') {
        payload.prompt = (payload.data as any).prompt;
    }

    // Promote top-level workingDirectory into payload when not already present
    if (typeof taskSpec.workingDirectory === 'string' && taskSpec.workingDirectory.trim()
        && !payload.workingDirectory) {
        payload.workingDirectory = taskSpec.workingDirectory.trim();
    }

    // Promote top-level workspaceId into payload when not already present
    // This enables resolveRootPath() to look up the workspace's rootPath as a fallback cwd.
    if (typeof taskSpec.workspaceId === 'string' && taskSpec.workspaceId.trim()
        && !payload.workspaceId) {
        payload.workspaceId = taskSpec.workspaceId.trim();
    }

    // Promote top-level images into payload when not already present
    if (Array.isArray(taskSpec.images) && taskSpec.images.length > 0 && !payload.images) {
        payload.images = taskSpec.images.filter((img: unknown) => typeof img === 'string');
    }

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

    // Pass through folderPath if provided
    if (typeof taskSpec.folderPath === 'string' && taskSpec.folderPath.trim()) {
        input.folderPath = taskSpec.folderPath.trim();
    }

    return { valid: true, input };
}

// ============================================================================
// Route Registration
// ============================================================================

// ============================================================================
// Bridge Helpers
// ============================================================================

/**
 * Aggregate stats across all per-repo TaskQueueManagers.
 */
function aggregateStats(bridge: MultiRepoQueueExecutorBridge): QueueStats {
    let queued = 0, running = 0, completed = 0, failed = 0, cancelled = 0, total = 0;
    let allPaused = true, any = false, anyDraining = false;
    for (const m of bridge.registry.getAllQueues().values()) {
        const s = m.getStats();
        queued += s.queued;
        running += s.running;
        completed += s.completed;
        failed += s.failed;
        cancelled += s.cancelled;
        total += s.total;
        if (!s.isPaused) { allPaused = false; }
        if (s.isDraining) { anyDraining = true; }
        any = true;
    }
    return { queued, running, completed, failed, cancelled, total, isPaused: any && allPaused, isDraining: anyDraining };
}

/**
 * Search for a task across all per-repo managers and return the owning manager.
 */
function findTaskManager(bridge: MultiRepoQueueExecutorBridge, id: string): TaskQueueManager | undefined {
    for (const m of bridge.registry.getAllQueues().values()) {
        if (m.getTask(id)) { return m; }
    }
    return undefined;
}

/**
 * Get the TaskQueueManager for a given repoId, or undefined if not found.
 */
function getManagerByRepoId(bridge: MultiRepoQueueExecutorBridge, repoId: string): TaskQueueManager | undefined {
    for (const [rootPath, m] of bridge.registry.getAllQueues()) {
        if (bridge.getRepoIdForPath(rootPath) === repoId) { return m; }
    }
    return undefined;
}

/**
 * Register all queue API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes - Route table to mutate
 * @param bridge - Multi-repo queue executor bridge for per-repo task routing
 * @param store - Optional process store (used by force-fail routes to update linked process status)
 */
/**
 * Enrich chat-type tasks with conversation metadata from the process store.
 * Only looks up processes for tasks with type === 'chat' and a processId.
 */
async function enrichChatTasks(
    tasks: Record<string, unknown>[],
    store: ProcessStore | undefined
): Promise<void> {
    if (!store) return;
    for (const task of tasks) {
        if (task.type !== 'chat' || !task.processId) continue;
        try {
            const process = await store.getProcess(task.processId as string);
            if (!process) continue;
            const turns = process.conversationTurns ?? [];
            const firstUserTurn = turns.find(t => t.role === 'user');
            // Compute lastActivityAt from the last turn's timestamp, falling back to completedAt then createdAt
            const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
            const lastTurnTs = lastTurn?.timestamp ? new Date(lastTurn.timestamp).getTime() : NaN;
            const lastActivityAt = Number.isFinite(lastTurnTs)
                ? lastTurnTs
                : (task.completedAt as number) ?? (task.createdAt as number) ?? 0;
            const firstContent = firstUserTurn?.content ?? '';
            task.chatMeta = {
                turnCount: turns.length,
                firstMessage: firstUserTurn
                    ? (firstContent.length > 120
                        ? firstContent.substring(0, 117) + '...'
                        : firstContent)
                    : undefined,
                lastActivityAt,
                title: process.title,
            };
            // Sync process status back to the task so follow-up messages
            // that set the process to 'running' are reflected in the history endpoint.
            if (process.status === 'running') {
                task.status = 'running';
            }
        } catch {
            // Non-fatal: process may not exist
        }
    }
}

/**
 * Maximum number of conversation turns to include in a cold-resume context prompt.
 * Prevents exceeding token limits for very long conversations.
 */
const MAX_RESUME_CONTEXT_TURNS = 20;

/**
 * Build a context prompt from prior conversation turns for cold session resume.
 * Includes the last N turns to stay within token limits.
 */
export function buildContextPrompt(turns: ConversationTurn[]): string {
    const recent = turns.slice(-MAX_RESUME_CONTEXT_TURNS);
    const formatted = recent
        .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
        .join('\n\n');
    return (
        'Continue this conversation. Here is the prior context:\n\n' +
        '<conversation_history>\n' +
        formatted + '\n' +
        '</conversation_history>\n\n' +
        'Acknowledge you have the context and are ready to continue.'
    );
}

export function registerQueueRoutes(routes: Route[], bridge: MultiRepoQueueExecutorBridge, store?: ProcessStore, globalWorkspaceRootPath?: string): void {

    // Track global pause state so newly-created bridges inherit it
    let globalPaused = false;

    /**
     * Resolve rootPath from payload.workingDirectory or payload.workspaceId (via store).
     * Returns undefined if neither is available.
     */
    async function resolveRootPath(payload: any): Promise<string | undefined> {
        if (typeof payload?.workingDirectory === 'string' && payload.workingDirectory.trim()) {
            return payload.workingDirectory.trim();
        }
        if (typeof payload?.workspaceId === 'string' && payload.workspaceId.trim() && store) {
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find((w: any) => w.id === payload.workspaceId.trim());
            if (ws?.rootPath) {
                payload.workingDirectory = ws.rootPath;
                return ws.rootPath;
            }
        }
        return undefined;
    }

    /**
     * Enqueue a validated task input via the bridge, resolving rootPath from payload.
     */
    async function enqueueViaBridge(input: CreateTaskInput): Promise<string> {
        const fallback = globalWorkspaceRootPath ?? process.cwd();
        const rootPath = await resolveRootPath(input.payload) || fallback;
        bridge.getOrCreateBridge(rootPath); // ensure executor bridge exists
        const queueManager = bridge.registry.getQueueForRepo(rootPath);
        // Auto-pause newly created managers if global pause is active
        if (globalPaused && !queueManager.getStats().isPaused) {
            queueManager.pause();
        }
        return queueManager.enqueue(input);
    }

    /**
     * Resolve manager by either:
     * 1) queue repoId (sha256(rootPath).slice(0, 16)), or
     * 2) workspace ID persisted in ProcessStore.
     */
    async function getManagerByRepoIdentifier(repoId: string): Promise<TaskQueueManager | undefined> {
        const managerByQueueRepoId = getManagerByRepoId(bridge, repoId);
        if (managerByQueueRepoId) {
            return managerByQueueRepoId;
        }
        if (!store) {
            return undefined;
        }

        const workspaces = await store.getWorkspaces();
        const workspace = workspaces.find((ws: any) => ws.id === repoId);
        if (!workspace?.rootPath) {
            return undefined;
        }

        const targetPath = path.resolve(workspace.rootPath);
        for (const [rootPath, manager] of bridge.registry.getAllQueues()) {
            if (path.resolve(rootPath) === targetPath) {
                return manager;
            }
        }
        return undefined;
    }

    /**
     * Get aggregate stats, incorporating global pause state for the edge case
     * where no bridges exist yet but pause was called.
     */
    function getAggregateStats(): QueueStats {
        const stats = aggregateStats(bridge);
        if (globalPaused && bridge.registry.getAllQueues().size === 0) {
            stats.isPaused = true;
        }
        return stats;
    }

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
                const taskId = await enqueueViaBridge(validation.input!);
                const task = findTaskManager(bridge, taskId)?.getTask(taskId);
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
            const typeFilter = typeof parsed.query.type === 'string' && parsed.query.type
                ? parsed.query.type
                : undefined;

            if (typeFilter && !VALID_TASK_TYPES.has(typeFilter)) {
                return sendError(res, 400, `Invalid type filter: ${typeFilter}. Valid types: ${Array.from(VALID_TASK_TYPES).join(', ')}`);
            }

            let queued: Record<string, unknown>[];
            let running: Record<string, unknown>[];
            let stats: QueueStats;

            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId);
                if (mgr) {
                    queued = mgr.getQueueItems().map(serializeQueueItem);
                    running = mgr.getRunning().map(serializeTask);
                    stats = mgr.getStats();
                } else {
                    queued = [];
                    running = [];
                    stats = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false };
                }
            } else {
                const globalPath = globalWorkspaceRootPath ?? process.cwd();
                const globalMgr = bridge.registry.getQueueForRepo(globalPath);
                queued = globalMgr.getQueueItems().map(serializeQueueItem);
                running = globalMgr.getRunning().map(serializeTask);
                stats = globalMgr.getStats();
            }

            if (typeFilter) {
                // Keep pause markers regardless of type filter so they remain visible inline
                queued = queued.filter(t => t.kind === 'pause-marker' || t.type === typeFilter);
                running = running.filter(t => t.type === typeFilter);
            }

            sendJSON(res, 200, { queued, running, stats });
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
            const taskId = await enqueueViaBridge(validation.input!);
            const task = findTaskManager(bridge, taskId)?.getTask(taskId);
            const inp = validation.input!;
            process.stderr.write(`[Queue] enqueue task=${taskId} type=${inp.type} priority=${inp.priority} repoId=${inp.repoId || '-'}\n`);
            sendJSON(res, 201, { task: task ? serializeTask(task) : { id: taskId } });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to enqueue task';
            return sendError(res, 400, message);
        }
    };
    routes.push({
        method: 'POST',
        pattern: '/api/queue',
        handler: enqueueTaskHandler,
    });
    routes.push({
        method: 'POST',
        pattern: '/api/queue/tasks',
        handler: enqueueTaskHandler,
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
                    const taskId = await enqueueViaBridge(validation.input!);
                    const task = findTaskManager(bridge, taskId)?.getTask(taskId);

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
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = typeof parsed.query.repoId === 'string' && parsed.query.repoId
                ? parsed.query.repoId
                : undefined;

            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
                sendJSON(res, 200, { stats: mgr.getStats() });
            } else {
                sendJSON(res, 200, { stats: getAggregateStats() });
            }
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
            const typeFilter = typeof parsed.query.type === 'string' && parsed.query.type
                ? parsed.query.type
                : undefined;

            if (typeFilter && !VALID_TASK_TYPES.has(typeFilter)) {
                return sendError(res, 400, `Invalid type filter: ${typeFilter}. Valid types: ${Array.from(VALID_TASK_TYPES).join(', ')}`);
            }

            let history: Record<string, unknown>[];
            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId);
                history = mgr
                    ? mgr.getHistory().map(serializeTask)
                    : [];
            } else {
                const globalPath = globalWorkspaceRootPath ?? process.cwd();
                const globalMgr = bridge.registry.getQueueForRepo(globalPath);
                history = globalMgr.getHistory().map(serializeTask);
            }

            if (typeFilter) {
                history = history.filter(t => t.type === typeFilter);
            }

            // For chat type, include running and queued tasks so the chat
            // session list shows newly created chats that haven't completed yet.
            if (typeFilter === 'chat') {
                const seenIds = new Set(history.map(t => t.id as string));
                const collectActive = (mgr: TaskQueueManager) => {
                    for (const task of [...mgr.getRunning(), ...mgr.getQueued()]) {
                        if (
                            (task.type as string) === 'chat' &&
                            !seenIds.has(task.id)
                        ) {
                            seenIds.add(task.id);
                            history.push(serializeTask(task));
                        }
                    }
                };
                if (repoId) {
                    const mgr = await getManagerByRepoIdentifier(repoId);
                    if (mgr) collectActive(mgr);
                } else {
                    const globalPath = globalWorkspaceRootPath ?? process.cwd();
                    const globalMgr = bridge.registry.getQueueForRepo(globalPath);
                    collectActive(globalMgr);
                }
                // Sort combined list by createdAt descending
                history.sort((a, b) => {
                    const ta = (a.createdAt as number) ?? 0;
                    const tb = (b.createdAt as number) ?? 0;
                    return tb - ta;
                });
            }

            const pipelineName = typeof parsed.query.pipelineName === 'string' && parsed.query.pipelineName
                ? parsed.query.pipelineName
                : undefined;
            if (pipelineName) {
                history = history.filter(t =>
                    (t as any).metadata?.pipelineName === pipelineName ||
                    (t as any).displayName?.includes(pipelineName)
                );
            }

            // Enrich chat tasks with conversation metadata when filtering by chat type,
            // then re-sort by lastActivityAt so recently-active conversations surface first
            if (typeFilter === 'chat') {
                await enrichChatTasks(history, store);
                history.sort((a, b) => {
                    const ta = ((a as any).chatMeta?.lastActivityAt as number) ?? (a.createdAt as number) ?? 0;
                    const tb = ((b as any).chatMeta?.lastActivityAt as number) ?? (b.createdAt as number) ?? 0;
                    return tb - ta;
                });
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
                const mgr = await getManagerByRepoIdentifier(repoId);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
                mgr.pause();
                process.stderr.write(`[Queue] pause repoId=${repoId}\n`);
                sendJSON(res, 200, { repoId, paused: true, stats: mgr.getStats() });
            } else {
                globalPaused = true;
                for (const m of bridge.registry.getAllQueues().values()) {
                    m.pause();
                }
                process.stderr.write(`[Queue] pause repoId=global\n`);
                sendJSON(res, 200, { paused: true, stats: getAggregateStats() });
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
                const mgr = await getManagerByRepoIdentifier(repoId);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
                mgr.resume();
                process.stderr.write(`[Queue] resume repoId=${repoId}\n`);
                sendJSON(res, 200, { repoId, paused: false, stats: mgr.getStats() });
            } else {
                globalPaused = false;
                for (const m of bridge.registry.getAllQueues().values()) {
                    m.resume();
                }
                process.stderr.write(`[Queue] resume repoId=global\n`);
                sendJSON(res, 200, { paused: false, stats: getAggregateStats() });
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
            const repos: Array<{ repoId: string; rootPath: string; isPaused: boolean; taskCount: number; queuedCount: number; runningCount: number }> = [];

            for (const [rootPath, m] of bridge.registry.getAllQueues()) {
                const repoId = bridge.getRepoIdForPath(rootPath);
                const queuedCount = m.getQueued().length;
                const runningCount = m.getRunning().length;
                repos.push({
                    repoId,
                    rootPath,
                    isPaused: m.isPaused(),
                    taskCount: queuedCount + runningCount,
                    queuedCount,
                    runningCount,
                });
            }

            sendJSON(res, 200, { repos });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/pause-marker — Insert a pause marker at a position
    // Body: { afterIndex: number, repoId?: string }
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: '/api/queue/pause-marker',
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const afterIndex = typeof body?.afterIndex === 'number' ? body.afterIndex : -1;
            const repoId = typeof body?.repoId === 'string' && body.repoId
                ? body.repoId
                : undefined;

            let mgr: TaskQueueManager | undefined;
            if (repoId) {
                mgr = await getManagerByRepoIdentifier(repoId);
                if (!mgr) {
                    return sendError(res, 404, `No queue found for repoId: ${repoId}`);
                }
            } else {
                // Use the first available manager
                const allQueues = bridge.registry.getAllQueues();
                if (allQueues.size === 0) {
                    return sendError(res, 400, 'No queue available — provide repoId');
                }
                mgr = allQueues.values().next().value as TaskQueueManager;
            }

            const markerId = mgr.insertPauseMarker(afterIndex);
            process.stderr.write(`[Queue] pause-marker inserted markerId=${markerId} afterIndex=${afterIndex} repoId=${repoId || '-'}\n`);
            sendJSON(res, 201, { markerId, afterIndex });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/pause-marker/:markerId — Remove a pause marker
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/queue\/pause-marker\/([^/]+)$/,
        handler: async (req, res, match) => {
            const markerId = decodeURIComponent(match![1]);

            // Search across all managers
            let removed = false;
            for (const m of bridge.registry.getAllQueues().values()) {
                if (m.removePauseMarker(markerId)) {
                    removed = true;
                    break;
                }
            }

            if (!removed) {
                return sendError(res, 404, 'Pause marker not found');
            }

            process.stderr.write(`[Queue] pause-marker removed markerId=${markerId}\n`);
            sendJSON(res, 200, { removed: true, markerId });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue — Clear all queued tasks
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: '/api/queue',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const repoId = typeof parsed.query.repoId === 'string' && parsed.query.repoId
                ? parsed.query.repoId
                : undefined;

            let count = 0;
            if (repoId) {
                const mgr = await getManagerByRepoIdentifier(repoId);
                if (mgr) {
                    count = mgr.getQueued().length;
                    mgr.clear();
                }
            } else {
                for (const m of bridge.registry.getAllQueues().values()) {
                    count += m.getQueued().length;
                    m.clear();
                }
            }
            sendJSON(res, 200, { cleared: count, stats: getAggregateStats() });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/history — Clear queue history
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: '/api/queue/history',
        handler: async (_req, res) => {
            for (const m of bridge.registry.getAllQueues().values()) {
                m.clearHistory();
            }
            sendJSON(res, 200, { cleared: true });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/queue/history/:taskId — Delete a single history entry
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/queue\/history\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const taskId = decodeURIComponent(match![1]);

            const mgr = findTaskManager(bridge, taskId);
            if (!mgr) {
                return sendError(res, 404, 'History entry not found');
            }

            const task = mgr.getTask(taskId);
            if (!task) {
                return sendError(res, 404, 'History entry not found');
            }

            const historyStatuses = new Set(['completed', 'failed', 'cancelled']);
            if (!historyStatuses.has(task.status)) {
                return sendError(res, 409, 'Task is still running or queued; cannot delete');
            }

            const processId = task.processId as string | undefined;

            // Remove child processes first, then the root process
            if (store && processId) {
                try {
                    const children = await store.getAllProcesses({ parentProcessId: processId });
                    for (const child of children) {
                        await store.removeProcess(child.id);
                    }
                    await store.removeProcess(processId);
                } catch (err) {
                    process.stderr.write(`[Queue] Failed to remove process for task ${taskId}: ${err}\n`);
                    // Continue to remove from queue history even if process deletion fails
                }
            }

            const removed = mgr.removeHistoryEntry(taskId);
            if (!removed) {
                return sendError(res, 404, 'History entry not found');
            }

            process.stderr.write(`[Queue] history entry deleted taskId=${taskId}\n`);
            sendJSON(res, 200, { deleted: true, taskId });
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
            const processIds: string[] = [];
            let count = 0;
            for (const m of bridge.registry.getAllQueues().values()) {
                const runningTasks = m.getRunning();
                processIds.push(
                    ...runningTasks.map(t => t.processId).filter((pid): pid is string => !!pid)
                );
                count += m.forceFailRunning(error);
            }

            process.stderr.write(`[Queue] force-fail-running count=${count}\n`);
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

            sendJSON(res, 200, { forceFailed: count, stats: getAggregateStats() });
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
            const mgr = findTaskManager(bridge, id);
            const task = mgr?.getTask(id);
            const processId = task?.processId;

            const success = mgr?.forceFailTask(id, error) ?? false;
            if (!success) {
                return sendError(res, 404, 'Task not found or not running');
            }

            process.stderr.write(`[Queue] force-fail task=${id}\n`);
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

            sendJSON(res, 200, { forceFailed: true, stats: getAggregateStats() });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/:id/resolved-prompt — Resolve full prompt with plan file content
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/queue\/([^/]+)\/resolved-prompt$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const task = findTaskManager(bridge, id)?.getTask(id);
            if (!task) {
                return sendError(res, 404, 'Task not found');
            }

            const payload = task.payload as any;
            const result: Record<string, unknown> = { taskId: id, type: task.type };

            // Resolve plan file content if available
            // Support both legacy planFilePath and new ChatPayload context.files[]
            const planFilePath: string | undefined =
                payload?.planFilePath ??
                (Array.isArray(payload?.context?.files) && typeof payload.context.files[0] === 'string'
                    ? payload.context.files[0]
                    : undefined);
            if (planFilePath) {
                result.planFilePath = planFilePath;
                try {
                    if (fs.existsSync(planFilePath)) {
                        result.planFileContent = fs.readFileSync(planFilePath, 'utf-8');
                    }
                } catch {
                    // Non-fatal: plan file may be inaccessible
                }
            }

            // Resolve prompt file content if available
            if (payload?.promptFilePath) {
                result.promptFilePath = payload.promptFilePath;
                try {
                    if (fs.existsSync(payload.promptFilePath)) {
                        result.promptFileContent = fs.readFileSync(payload.promptFilePath, 'utf-8');
                    }
                } catch {
                    // Non-fatal
                }
            }

            // Build assembled prompt text (mimicking extractPrompt logic)
            const parts: string[] = [];
            if (result.planFileContent) {
                parts.push('=== Plan File ===\n' + result.planFileContent);
            }
            if (payload?.additionalContext) {
                parts.push('=== Additional Context ===\n' + payload.additionalContext);
            }
            if (payload?.promptContent) {
                parts.push('=== Prompt Content ===\n' + payload.promptContent);
            } else if (payload?.prompt) {
                parts.push('=== Prompt ===\n' + payload.prompt);
            } else if (payload?.promptTemplate) {
                parts.push('=== Prompt ===\n' + payload.promptTemplate);
            }
            if (parts.length > 0) {
                result.resolvedPrompt = parts.join('\n\n');
            }

            sendJSON(res, 200, result);
        },
    });

    // ------------------------------------------------------------------
    // GET /api/queue/:id/images — Load externalized image blobs
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/queue\/([^/]+)\/images$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const task = findTaskManager(bridge, id)?.getTask(id);
            if (!task) {
                return sendError(res, 404, 'Task not found');
            }

            const filePath = (task.payload as any)?.imagesFilePath;
            if (filePath) {
                try {
                    const images = await ImageBlobStore.loadImages(filePath);
                    return sendJSON(res, 200, { images });
                } catch {
                    return sendJSON(res, 200, { images: [] });
                }
            }
            sendJSON(res, 200, { images: [] });
        },
    });

    // ------------------------------------------------------------------
    // Track in-progress resume operations to reject concurrent duplicate requests
    const resumeInProgress = new Set<string>();

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

            // Look up the task to get the processId
            const mgr = findTaskManager(bridge, taskId);
            const task = mgr?.getTask(taskId);
            if (!task) {
                return sendError(res, 404, 'Task not found');
            }

            const pid = task.processId ?? `queue_${taskId}`;

            // Reject concurrent resume requests synchronously, before any await,
            // so the guard reliably catches overlapping requests in the event loop.
            if (resumeInProgress.has(pid)) {
                return sendError(res, 409, 'Resume already in progress for this process');
            }
            resumeInProgress.add(pid);

            try {
                const proc = await store.getProcess(pid);
                if (!proc) {
                    return sendError(res, 404, 'Process not found');
                }

                // Don't resume an active session
                if (proc.status === 'running') {
                    return sendError(res, 400, 'Session is still active');
                }

                // Warm path: SDK session is still alive
                const sessionAlive = await bridge.isSessionAlive(pid);
                if (sessionAlive) {
                    // Clear error state so the session can accept follow-ups again
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

                // Check AI availability before attempting cold resume
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
                    const newTaskId = await enqueueViaBridge(validation.input!);
                    const newTask = findTaskManager(bridge, newTaskId)?.getTask(newTaskId);
                    const newProcessId = newTask?.processId ?? `queue_${newTaskId}`;

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
                resumeInProgress.delete(pid);
            }
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
            if (['stats', 'history', 'pause', 'resume', 'force-fail-running', 'bulk', 'repos', 'pause-marker'].includes(id)) {
                return sendError(res, 404, 'Task not found');
            }

            const task = findTaskManager(bridge, id)?.getTask(id);
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

            const mgr = findTaskManager(bridge, id);
            const cancelled = mgr?.cancelTask(id) ?? false;
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
            const moved = findTaskManager(bridge, id)?.moveToTop(id) ?? false;
            if (!moved) {
                return sendError(res, 404, 'Task not found in queue');
            }
            process.stderr.write(`[Queue] move-to-top task=${id}\n`);
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
            const moved = findTaskManager(bridge, id)?.moveUp(id) ?? false;
            if (!moved) {
                return sendError(res, 404, 'Task not found or already at top');
            }
            const position = findTaskManager(bridge, id)?.getPosition(id);
            process.stderr.write(`[Queue] move-up task=${id}\n`);
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
            const moved = findTaskManager(bridge, id)?.moveDown(id) ?? false;
            if (!moved) {
                return sendError(res, 404, 'Task not found or already at bottom');
            }
            const position = findTaskManager(bridge, id)?.getPosition(id);
            process.stderr.write(`[Queue] move-down task=${id}\n`);
            sendJSON(res, 200, { moved: true, position });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/move-to/:position — Move task to arbitrary position
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/move-to\/(\d+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const position = parseInt(match![2], 10);
            const moved = findTaskManager(bridge, id)?.moveToPosition(id, position) ?? false;
            if (!moved) {
                return sendError(res, 404, 'Task not found in queue');
            }
            const finalPos = findTaskManager(bridge, id)?.getPosition(id);
            process.stderr.write(`[Queue] move-to-position task=${id} position=${position}\n`);
            sendJSON(res, 200, { moved: true, position: finalPos });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/freeze — Freeze a queued task
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/freeze$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const frozen = findTaskManager(bridge, id)?.freezeTask(id) ?? false;
            if (!frozen) {
                return sendError(res, 404, 'Task not found in queue');
            }
            process.stderr.write(`[Queue] freeze task=${id}\n`);
            const task = findTaskManager(bridge, id)?.getTask(id);
            sendJSON(res, 200, { frozen: true, task });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/queue/:id/unfreeze — Unfreeze a frozen queued task
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/queue\/([^/]+)\/unfreeze$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const unfrozen = findTaskManager(bridge, id)?.unfreezeTask(id) ?? false;
            if (!unfrozen) {
                return sendError(res, 404, 'Task not found in queue or not frozen');
            }
            process.stderr.write(`[Queue] unfreeze task=${id}\n`);
            const task = findTaskManager(bridge, id)?.getTask(id);
            sendJSON(res, 200, { unfrozen: true, task });
        },
    });
}
