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
    StoredEffortTiersMap,
} from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory, resolveModelForProvider } from '@plusplusoneplusplus/forge';
import { truncateDisplayName } from '../shared/queue-utils';
import { TaskDefs, VALID_ENQUEUE_TYPES, VISIBLE_TASK_TYPE_LABELS, VALID_CHAT_PROVIDERS, normalizeChatMode } from '../tasks/task-types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import * as path from 'path';
import type { ParsedUrlQuery } from 'querystring';

// ============================================================================
// Constants
// ============================================================================

export const VALID_PRIORITIES: Set<string> = new Set(['high', 'normal', 'low']);
export const VALID_TASK_TYPES: Set<string> = new Set([...VALID_ENQUEUE_TYPES, 'custom']);

/** Human-readable labels for task types, used when auto-generating display names. */
export const TYPE_LABELS: Record<string, string> = VISIBLE_TASK_TYPE_LABELS;

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
    globalPausedUntil?: number;
    globalAutopilotPaused: boolean;
    globalAutopilotPausedUntil?: number;
    resumeInProgress: Set<string>;
}

export function normalizeGlobalQueueState(state: QueueGlobalState, now = Date.now()): void {
    if (state.globalPaused && state.globalPausedUntil !== undefined && state.globalPausedUntil <= now) {
        state.globalPaused = false;
        state.globalPausedUntil = undefined;
    }
    if (
        state.globalAutopilotPaused &&
        state.globalAutopilotPausedUntil !== undefined &&
        state.globalAutopilotPausedUntil <= now
    ) {
        state.globalAutopilotPaused = false;
        state.globalAutopilotPausedUntil = undefined;
    }
}

/**
 * Context object threaded through every queue route module.
 */
export interface QueueRouteContext {
    bridge: MultiRepoQueueRouter;
    store: ProcessStore | undefined;
    globalWorkspaceRootPath: string | undefined;
    state: QueueGlobalState;
    getDefaultProvider?: () => 'copilot' | 'codex' | 'claude';
    getEffortTiersForProvider?: (provider: 'copilot' | 'codex' | 'claude') => StoredEffortTiersMap | undefined;
}

export function getRepoIdentifierFromQuery(query: ParsedUrlQuery): string | undefined {
    return firstStringQueryValue(query.workspace) ?? firstStringQueryValue(query.repoId);
}

function firstStringQueryValue(value: unknown): string | undefined {
    if (typeof value === 'string' && value) return value;
    if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string' && item.length > 0);
    return undefined;
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
        customTitle: (task as any).customTitle,
        lastMessagePreview: (task as any).lastMessagePreview,
        title: (task as any).title,
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
        workItemId: payload?.workItemId,
        imagesCount,
        hasImages: imagesCount > 0 || !!payload?.imagesFilePath,
        // Required by ChatListPane to color-code running/queued tasks by provider
        // (Copilot=green, Codex=indigo, Claude=coral). Without it, getTaskChatProvider
        // returns undefined and every running task defaults to Copilot green.
        provider: payload?.provider,
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
        customTitle: (task as any).customTitle,
        lastMessagePreview: (task as any).lastMessagePreview,
        title: (task as any).title,
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
        // Default mode to 'autopilot' only for *new* chats (no processId).
        // Follow-ups (processId set) must arrive with mode already resolved by
        // the caller — programmatic enqueuers go through resolveFollowUpMode,
        // and REST callers must supply mode explicitly. Leaving payload.mode
        // unset on a follow-up is treated as a bug and surfaced as a warning
        // in FollowUpExecutor.
        if (!payload.mode && !payload.processId) payload.mode = 'autopilot';
        const normalizedMode = normalizeChatMode(payload.mode);
        if (normalizedMode) payload.mode = normalizedMode;
        // Validate provider field if present.
        if (payload.provider !== undefined && !VALID_CHAT_PROVIDERS.has(payload.provider)) {
            return {
                valid: false,
                error: `Invalid provider: '${payload.provider}'. Valid providers: ${[...VALID_CHAT_PROVIDERS].join(', ')}`,
            };
        }
    }
    if (taskSpec.type === TaskDefs.runScript.kind && !payload.kind) payload.kind = TaskDefs.runScript.kind;
    if (taskSpec.type === TaskDefs.runWorkflow.kind && !payload.kind) payload.kind = TaskDefs.runWorkflow.kind;

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

    // Per-turn reasoning-effort override flows in via `payload.reasoningEffort`
    // and is normalised into `config.reasoningEffort` so the chat-base executor
    // can read it from a single canonical location alongside `config.model`.
    // Follow-up executions also read it from `task.config.reasoningEffort`
    // (see follow-up-executor.ts).
    const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
    const VALID_EFFORT_TIERS = new Set(['low', 'medium', 'high']);
    const payloadEffort = typeof payload.reasoningEffort === 'string' && VALID_EFFORTS.has(payload.reasoningEffort)
        ? (payload.reasoningEffort as 'low' | 'medium' | 'high' | 'xhigh')
        : undefined;
    const configEffort = typeof taskSpec.config?.reasoningEffort === 'string' && VALID_EFFORTS.has(taskSpec.config.reasoningEffort)
        ? (taskSpec.config.reasoningEffort as 'low' | 'medium' | 'high' | 'xhigh')
        : undefined;
    const resolvedEffort = configEffort ?? payloadEffort;
    const effortTier = taskSpec.config?.effortTier;
    if (effortTier !== undefined && (typeof effortTier !== 'string' || !VALID_EFFORT_TIERS.has(effortTier))) {
        return {
            valid: false,
            error: `Invalid effortTier: '${effortTier}'. Valid tiers: low, medium, high`,
        };
    }

    const taskProvider = taskSpec.type === 'chat' && typeof payload.provider === 'string' && VALID_CHAT_PROVIDERS.has(payload.provider)
        ? payload.provider
        : 'copilot';
    const rawModel = taskSpec.config?.model ?? (typeof payload.model === 'string' ? payload.model : undefined);
    const resolvedModel = resolveModelForProvider(taskProvider, rawModel);
    if (resolvedModel.coerced) {
        getLogger().warn(
            LogCategory.AI,
            `[Queue] Dropping model '${resolvedModel.requestedModel}' because provider '${taskProvider}' does not support it; using provider default.`,
        );
    }

    const input: CreateTaskInput = {
        type: taskSpec.type,
        priority,
        payload,
        config: {
            model: resolvedModel.model,
            timeoutMs: taskSpec.config?.timeoutMs,
            retryOnFailure: taskSpec.config?.retryOnFailure ?? false,
            retryAttempts: taskSpec.config?.retryAttempts,
            retryDelayMs: taskSpec.config?.retryDelayMs,
            ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
            ...(effortTier ? { effortTier } : {}),
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
export function aggregateStats(bridge: MultiRepoQueueRouter): QueueStats {
    let queued = 0, running = 0, completed = 0, failed = 0, cancelled = 0, total = 0;
    let allPaused = true, allAutopilotPaused = true, any = false, anyDraining = false;
    let pausedUntil: number | undefined;
    let autopilotPausedUntil: number | undefined;
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
        if (s.pausedUntil !== undefined) {
            pausedUntil = pausedUntil === undefined ? s.pausedUntil : Math.max(pausedUntil, s.pausedUntil);
        }
        if (s.autopilotPausedUntil !== undefined) {
            autopilotPausedUntil = autopilotPausedUntil === undefined ? s.autopilotPausedUntil : Math.max(autopilotPausedUntil, s.autopilotPausedUntil);
        }
        any = true;
    }
    const stats: QueueStats = {
        queued,
        running,
        completed,
        failed,
        cancelled,
        total,
        isPaused: any && allPaused,
        isAutopilotPaused: any && allAutopilotPaused,
        isDraining: anyDraining,
    };
    if (stats.isPaused && pausedUntil !== undefined) {
        stats.pausedUntil = pausedUntil;
    }
    if (stats.isAutopilotPaused && autopilotPausedUntil !== undefined) {
        stats.autopilotPausedUntil = autopilotPausedUntil;
    }
    return stats;
}

/**
 * Get aggregate stats, incorporating global pause state for the edge case
 * where no bridges exist yet but pause was called.
 */
export function getAggregateStats(bridge: MultiRepoQueueRouter, state: QueueGlobalState): QueueStats {
    normalizeGlobalQueueState(state);
    const stats = aggregateStats(bridge);
    if (state.globalPaused && bridge.registry.getAllQueues().size === 0) {
        stats.isPaused = true;
        stats.pausedUntil = state.globalPausedUntil;
    }
    if (state.globalAutopilotPaused && bridge.registry.getAllQueues().size === 0) {
        stats.isAutopilotPaused = true;
        stats.autopilotPausedUntil = state.globalAutopilotPausedUntil;
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
    bridge: MultiRepoQueueRouter,
    state: QueueGlobalState,
    globalWorkspaceRootPath: string | undefined,
    store: ProcessStore | undefined
): Promise<string> {
    normalizeGlobalQueueState(state);
    const fallback = globalWorkspaceRootPath ?? process.cwd();
    const rootPath = await resolveRootPath(input.payload, store, globalWorkspaceRootPath) || fallback;
    bridge.getOrCreateBridge(rootPath);
    if (!input.repoId) {
        input.repoId = bridge.getRepoIdForPath(rootPath);
    }
    const queueManager = bridge.registry.getQueueForRepo(rootPath);
    if (state.globalPaused && !queueManager.getStats().isPaused) {
        queueManager.pause(state.globalPausedUntil);
    }
    if (state.globalAutopilotPaused && !queueManager.getStats().isAutopilotPaused) {
        queueManager.pauseAutopilot(state.globalAutopilotPausedUntil);
    }
    return queueManager.enqueue(input);
}

/**
 * Resolve manager by either queue repoId (sha256 hash) or workspace ID from ProcessStore.
 */
export async function getManagerByRepoIdentifier(
    repoId: string,
    bridge: MultiRepoQueueRouter,
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
 * Resolve or lazily create a manager for the given repoId.
 *
 * Unlike `getManagerByRepoIdentifier`, this helper will materialise a new
 * per-repo `TaskQueueManager` when the repoId maps to a registered workspace
 * but no queue exists yet. Global pause / autopilot-pause state is applied to
 * the freshly created manager so existing global semantics are honoured.
 *
 * Returns `undefined` only when the repoId is genuinely unknown (not registered
 * in the process store). Callers should still return 404 in that case.
 */
export async function getOrCreateManagerByRepoIdentifier(
    repoId: string,
    bridge: MultiRepoQueueRouter,
    store: ProcessStore | undefined,
    state: QueueGlobalState
): Promise<TaskQueueManager | undefined> {
    // Fast path: manager already exists.
    const existing = await getManagerByRepoIdentifier(repoId, bridge, store);
    if (existing) {
        return existing;
    }

    // Slow path: workspace is registered but queue hasn't been materialised yet.
    if (!store) {
        return undefined;
    }
    const workspaces = await store.getWorkspaces();
    const workspace = workspaces.find((ws: any) => ws.id === repoId);
    if (!workspace?.rootPath) {
        return undefined;
    }

    // Materialise the queue (get-or-create) and wire up the executor bridge.
    const rootPath = workspace.rootPath;
    bridge.getOrCreateBridge(rootPath);
    const manager = bridge.registry.getQueueForRepo(rootPath);

    // Mirror current global pause / autopilot-pause state onto the new manager.
    normalizeGlobalQueueState(state);
    if (state.globalPaused && !manager.getStats().isPaused) {
        manager.pause(state.globalPausedUntil);
    }
    if (state.globalAutopilotPaused && !manager.getStats().isAutopilotPaused) {
        manager.pauseAutopilot(state.globalAutopilotPausedUntil);
    }

    return manager;
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
