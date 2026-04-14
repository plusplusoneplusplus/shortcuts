/**
 * Shared utilities for queue route modules.
 *
 * Contains pure helpers, serializers, validators, and the shared mutable
 * state type that all queue route modules read/write via QueueRouteContext.
 */

import type {
    TaskQueueManager,
    QueuedTask,
    CreateTaskInput,
    TaskPriority,
    QueueStats,
    ProcessStore,
    ConversationTurn,
    PauseMarker,
} from '@plusplusoneplusplus/forge';
import { truncateDisplayName } from '../shared/queue-utils';
import type { MultiRepoQueueExecutorBridge } from '../multi-repo-executor-bridge';
import * as path from 'path';

// ============================================================================
// Constants
// ============================================================================

export const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);
export const VALID_TASK_TYPES: Set<string> = new Set(['chat', 'run-workflow', 'run-script', 'custom']);

/** Human-readable labels for task types, used when auto-generating display names. */
export const TYPE_LABELS: Record<string, string> = {
    'chat': 'Chat',
    'run-workflow': 'Run Workflow',
    'run-script': 'Run Script',
};

/**
 * Maximum number of conversation turns to include in a cold-resume context prompt.
 * Prevents exceeding token limits for very long conversations.
 */
export const MAX_RESUME_CONTEXT_TURNS = 20;

// ============================================================================
// Shared State
// ============================================================================

/**
 * Mutable global queue state shared across all route modules.
 * Passed by reference so all modules observe the same values.
 */
export interface QueueGlobalState {
    globalPaused: boolean;
    globalAutopilotPaused: boolean;
    resumeInProgress: Set<string>;
}

/**
 * Context object threaded through every queue route module.
 */
export interface QueueRouteContext {
    bridge: MultiRepoQueueExecutorBridge;
    store: ProcessStore | undefined;
    globalWorkspaceRootPath: string | undefined;
    state: QueueGlobalState;
}

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Serialize a QueuedTask for JSON response.
 */
export function serializeTask(task: QueuedTask): Record<string, unknown> {
    const payload = task.payload as any;
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
export function serializeQueueItem(item: QueuedTask | PauseMarker): Record<string, unknown> {
    if ((item as PauseMarker).kind === 'pause-marker') {
        const marker = item as PauseMarker;
        return { kind: 'pause-marker', id: marker.id, createdAt: marker.createdAt };
    }
    return serializeTask(item as QueuedTask);
}

/** Truncate a string to maxLen characters, appending '…' if truncated. */
function truncateString(value: unknown, maxLen: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    if (value.length <= maxLen) return value;
    return value.substring(0, maxLen - 1) + '…';
}

/**
 * Lightweight serialization for list views — omits result, config, and
 * full payload spread to keep /api/queue/history responses small.
 */
export function serializeTaskSummary(task: QueuedTask): Record<string, unknown> {
    const payload = task.payload as any;
    const imagesCount = Array.isArray(payload?.images)
        ? payload.images.length
        : (payload?.imagesCount ?? 0);

    // Only the payload sub-fields the SPA list views actually read
    const slimPayload: Record<string, unknown> = {
        mode: payload?.mode,
        kind: payload?.kind,
        prompt: truncateString(payload?.prompt, 200),
        promptContent: truncateString(payload?.promptContent, 200),
        planFilePath: payload?.planFilePath,
        filePath: payload?.filePath,
        workflowPath: payload?.workflowPath,
        workingDirectory: payload?.workingDirectory,
        workspaceId: payload?.workspaceId,
        scheduleId: payload?.scheduleId,
        imagesCount,
        hasImages: imagesCount > 0 || !!payload?.imagesFilePath,
    };

    // Nested payload fields used by SPA
    if (payload?.data?.originalTaskPath !== undefined) {
        slimPayload.data = { originalTaskPath: payload.data.originalTaskPath };
    }
    if (payload?.context?.files !== undefined) {
        slimPayload.context = { files: payload.context.files };
    }
    if (payload?.context?.taskGeneration !== undefined) {
        slimPayload.context = { ...slimPayload.context as any, taskGeneration: payload.context.taskGeneration };
    }

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
        payload: slimPayload,
        displayName: task.displayName,
        processId: task.processId,
        error: truncateString(task.error, 500),
        retryCount: task.retryCount,
        frozen: task.frozen ?? undefined,
        admitted: task.admitted ?? undefined,
    };
}

/**
 * Summary-serialize a queue item (task or pause marker) for list views.
 */
export function serializeQueueItemSummary(item: QueuedTask | PauseMarker): Record<string, unknown> {
    if ((item as PauseMarker).kind === 'pause-marker') {
        const marker = item as PauseMarker;
        return { kind: 'pause-marker', id: marker.id, createdAt: marker.createdAt };
    }
    return serializeTaskSummary(item as QueuedTask);
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Auto-generate a display name for a task when the user doesn't provide one.
 */
export function generateDisplayName(type: string, payload: any): string {
    const typeLabel = TYPE_LABELS[type] || 'Task';

    if (payload) {
        if (payload.kind === 'chat' && payload.processId && typeof payload.prompt === 'string' && payload.prompt.trim()) {
            return truncateDisplayName(payload.prompt.trim());
        }
        if (typeof payload.prompt === 'string' && payload.prompt.trim()) {
            return truncateDisplayName(payload.prompt.trim());
        }
        if (payload.context?.files?.length > 0) {
            const filePath = payload.context.files[0];
            const basename = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
            return `${typeLabel}: ${basename}`;
        }
        if (typeof payload.workflowPath === 'string' && payload.workflowPath.trim()) {
            const basename = path.basename(payload.workflowPath);
            return `${typeLabel}: ${basename}`;
        }
    }

    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${typeLabel} @ ${time}`;
}

/**
 * Validation result for a single task specification.
 */
export interface TaskValidationResult {
    valid: boolean;
    error?: string;
    input?: CreateTaskInput;
}

/**
 * Validate a single task specification and construct CreateTaskInput.
 */
export function validateAndParseTask(taskSpec: any): TaskValidationResult {
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

    if (taskSpec.type === 'chat' || taskSpec.type === 'custom') {
        if (!payload.kind) payload.kind = 'chat';
        if (!payload.mode) payload.mode = 'autopilot';
    }
    if (taskSpec.type === 'run-script' && !payload.kind) payload.kind = 'run-script';
    if (taskSpec.type === 'run-workflow' && !payload.kind) payload.kind = 'run-workflow';

    if (typeof taskSpec.prompt === 'string' && taskSpec.prompt.trim() && !payload.prompt) {
        payload.prompt = taskSpec.prompt.trim();
    }

    if (!payload.prompt && payload.data && typeof (payload.data as any).prompt === 'string') {
        payload.prompt = (payload.data as any).prompt;
    }

    if (typeof taskSpec.workingDirectory === 'string' && taskSpec.workingDirectory.trim()
        && !payload.workingDirectory) {
        payload.workingDirectory = taskSpec.workingDirectory.trim();
    }

    if (typeof taskSpec.workspaceId === 'string' && taskSpec.workspaceId.trim()
        && !payload.workspaceId) {
        payload.workspaceId = taskSpec.workspaceId.trim();
    }

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

    if (typeof taskSpec.repoId === 'string' && taskSpec.repoId.trim()) {
        input.repoId = taskSpec.repoId.trim();
    }

    if (typeof taskSpec.folderPath === 'string' && taskSpec.folderPath.trim()) {
        input.folderPath = taskSpec.folderPath.trim();
    }

    return { valid: true, input };
}

// ============================================================================
// Bridge / Stats Helpers
// ============================================================================

/**
 * Aggregate stats across all per-repo TaskQueueManagers.
 */
export function aggregateStats(bridge: MultiRepoQueueExecutorBridge): QueueStats {
    let queued = 0, running = 0, completed = 0, failed = 0, cancelled = 0, total = 0;
    let allPaused = true, allAutopilotPaused = true, any = false, anyDraining = false;
    for (const m of bridge.registry.getAllQueues().values()) {
        const s = m.getStats();
        queued += s.queued;
        running += s.running;
        completed += s.completed;
        failed += s.failed;
        cancelled += s.cancelled;
        total += s.total;
        if (!s.isPaused) { allPaused = false; }
        if (!s.isAutopilotPaused) { allAutopilotPaused = false; }
        if (s.isDraining) { anyDraining = true; }
        any = true;
    }
    return { queued, running, completed, failed, cancelled, total, isPaused: any && allPaused, isAutopilotPaused: any && allAutopilotPaused, isDraining: anyDraining };
}

/**
 * Get aggregate stats, incorporating global pause state for the edge case
 * where no bridges exist yet but pause was called.
 */
export function getAggregateStats(bridge: MultiRepoQueueExecutorBridge, state: QueueGlobalState): QueueStats {
    const stats = aggregateStats(bridge);
    if (state.globalPaused && bridge.registry.getAllQueues().size === 0) {
        stats.isPaused = true;
    }
    if (state.globalAutopilotPaused && bridge.registry.getAllQueues().size === 0) {
        stats.isAutopilotPaused = true;
    }
    return stats;
}

/**
 * Resolve rootPath from payload.workingDirectory or payload.workspaceId (via store).
 */
export async function resolveRootPath(
    payload: any,
    store: ProcessStore | undefined,
    globalWorkspaceRootPath: string | undefined
): Promise<string | undefined> {
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
export async function enqueueViaBridge(
    input: CreateTaskInput,
    bridge: MultiRepoQueueExecutorBridge,
    state: QueueGlobalState,
    globalWorkspaceRootPath: string | undefined,
    store: ProcessStore | undefined
): Promise<string> {
    const fallback = globalWorkspaceRootPath ?? process.cwd();
    const rootPath = await resolveRootPath(input.payload, store, globalWorkspaceRootPath) || fallback;
    bridge.getOrCreateBridge(rootPath);
    const queueManager = bridge.registry.getQueueForRepo(rootPath);
    if (state.globalPaused && !queueManager.getStats().isPaused) {
        queueManager.pause();
    }
    if (state.globalAutopilotPaused && !queueManager.getStats().isAutopilotPaused) {
        queueManager.pauseAutopilot();
    }
    return queueManager.enqueue(input);
}

/**
 * Resolve manager by either queue repoId (sha256 hash) or workspace ID from ProcessStore.
 */
export async function getManagerByRepoIdentifier(
    repoId: string,
    bridge: MultiRepoQueueExecutorBridge,
    store: ProcessStore | undefined
): Promise<TaskQueueManager | undefined> {
    const managerByQueueRepoId = bridge.getManagerByRepoId(repoId);
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
 * Build a context prompt from prior conversation turns for cold session resume.
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

/**
 * Build a prompt that asks the AI to summarize multiple conversations.
 *
 * @param conversations  Serializable conversation objects to summarize.
 * @param userPrompt     Optional focus question or instructions from the user (max 2000 chars).
 */
export function buildSummarizePrompt(conversations: SummarizeConversation[], userPrompt?: string): string {
    const sections = conversations.map((conv, i) =>
        `═══ Conversation ${i + 1} ═══\n${serializeConversationForSummary(conv)}`
    );

    let prompt =
        'Summarize the following conversation logs. Each conversation is delimited by ═══ markers.\n' +
        'Produce a concise summary that highlights: key topics discussed, decisions made, ' +
        'action items, and any unresolved questions.\n\n' +
        sections.join('\n\n');

    const trimmed = userPrompt?.trim();
    if (trimmed) {
        prompt += '\n\nAdditional focus / question from the user:\n' + trimmed;
    }
    return prompt;
}

// ============================================================================
// Conversation Serialization for Summarization
// ============================================================================

export interface SummarizeConversation {
    id: string;
    title?: string;
    status: string;
    turns: ConversationTurn[];
}

/**
 * Serialize a conversation into compact text for inclusion in a summarization prompt.
 * Truncates long assistant responses and strips tool calls.
 */
export function serializeConversationForSummary(conv: SummarizeConversation, maxTurnLength = 3000): string {
    const header = conv.title
        ? `## Process ${conv.id} — ${conv.title} [${conv.status}]`
        : `## Process ${conv.id} [${conv.status}]`;

    if (!conv.turns || conv.turns.length === 0) {
        return header;
    }

    const lines: string[] = [header];
    for (const turn of conv.turns) {
        const role = turn.role === 'user' ? 'User' : 'Assistant';
        let content = turn.content;
        if (turn.role === 'assistant' && content.length > maxTurnLength) {
            content = content.slice(0, maxTurnLength) + '… (truncated)';
        }
        lines.push(`[${role}] (turn ${turn.turnIndex}): ${content}`);
    }
    return lines.join('\n');
}
