import type { ChatPayload, ChatMode } from './task-types';
import { isChatPayload, isBackgroundReviewPayload, isMemoryAggregatePayload, TaskDefs, getTaskDef } from './task-types';
import { applyFollowUpToTask } from './shared/queue-utils';
import { processToQueuedTask } from './shared/process-history-mapper';
import type { Attachment, ConversationTurn, CopilotSDKService, ProcessStore, QueuedTask, QueueExecutor, TaskExecutionResult, TaskExecutor, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { createQueueExecutor, DEFAULT_AI_TIMEOUT_MS, FileToolCallCacheStore, getCopilotSDKService, getLogger, LogCategory, normalizeExecutionPath, resolveToolCallCacheOptions, resolveWorkspaceExecutionContext, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import * as path from 'path';
import { BaseExecutor } from './executors/base-executor';
import { resolveSkillConfig } from './executors/skill-config-resolver';
import { generateTitleIfNeeded as generateTitleIfNeededFn } from './executors/title-generator';
import { ExecutorRegistry } from './executors/executor-registry';
import { shouldEnqueueReview, DEFAULT_REVIEW_CONFIG } from './memory/background-review';

export const DEFAULT_FOLLOW_UP_SUGGESTIONS = { enabled: true, count: 3 } as const;

export interface CLITaskExecutorOptions {
    approvePermissions?: boolean; workingDirectory?: string; dataDir?: string;
    aiService?: CopilotSDKService; defaultTimeoutMs?: number;
    followUpSuggestions?: { enabled: boolean; count: number };
    askUser?: { enabled: boolean };
    getWsServer?: () => import('./websocket').ProcessWebSocketServer | undefined;
}
export interface QueueExecutorBridgeOptions extends CLITaskExecutorOptions {
    maxConcurrency?: number; sharedConcurrency?: number; exclusiveConcurrency?: number;
    isExclusive?: (task: QueuedTask) => boolean; autoStart?: boolean;
    initialDelayMs?: number;
}
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
    cancelProcess?(processId: string): Promise<void>;
    steerProcess?(processId: string, message: string): Promise<boolean>;
    /** Answer a pending ask-user question. Returns true if the question was found and answered. */
    answerAskUserQuestion?(processId: string, questionId: string, answer: string | string[] | boolean): boolean;
    /** Skip a pending ask-user question. Returns true if the question was found and skipped. */
    skipAskUserQuestion?(processId: string, questionId: string): boolean;
}

function pathsReferToSameWorkspace(leftPath: string, rightPath: string): boolean {
    const left = resolveWorkspaceExecutionContext(leftPath);
    const right = resolveWorkspaceExecutionContext(rightPath);

    if (left.kind === 'wsl' && right.kind === 'wsl') {
        if (left.linuxWorkingDirectory !== right.linuxWorkingDirectory) {
            return false;
        }

        if (left.distro && right.distro) {
            return left.distro.toLowerCase() === right.distro.toLowerCase();
        }

        return true;
    }

    return normalizeExecutionPath(leftPath) === normalizeExecutionPath(rightPath);
}

export class CLITaskExecutor extends BaseExecutor implements TaskExecutor {
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;
    private readonly aiService: CopilotSDKService;
    private queueManager?: TaskQueueManager;
    private queueExecutor?: QueueExecutor;
    private readonly executors: ExecutorRegistry;

    constructor(store: ProcessStore, options: CLITaskExecutorOptions = {}) {
        super(store, options.dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService ?? getCopilotSDKService();
        const cacheStore = new FileToolCallCacheStore(resolveToolCallCacheOptions(options.workingDirectory, this.dataDir ? path.join(this.dataDir, 'memory') : undefined));
        const skillCfg = (wsId: string | undefined, workDir?: string) => resolveSkillConfig(store, this.dataDir, wsId, workDir);
        this.executors = new ExecutorRegistry(store, {
            approvePermissions: this.approvePermissions,
            defaultWorkingDirectory: this.defaultWorkingDirectory,
            aiService: this.aiService,
            dataDir: this.dataDir,
            defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
            followUpSuggestions: options.followUpSuggestions ?? DEFAULT_FOLLOW_UP_SUGGESTIONS,
            askUser: options.askUser,
            toolCallCacheStore: cacheStore,
            resolveSkillConfig: skillCfg,
            resolveWorkspaceIdForPath: (p: string) => this.resolveWorkspaceIdForPath(p),
            onTitleNeeded: (pid: string, turns: ConversationTurn[]) => this.generateTitleIfNeeded(pid, turns),
            onBackgroundReview: (pid: string, wsId: string, turns: ConversationTurn[]) => this.enqueueBackgroundReview(pid, wsId, turns),
            onMemoryCaptured: (wsId: string, target: string) => this.enqueueMemoryAggregate(wsId, target as 'memory' | 'system', 'capture-trigger'),
            getWsServer: options.getWsServer,
        });
    }

    setQueueManager(qm: TaskQueueManager): void { this.queueManager = qm; }
    setQueueExecutor(qe: QueueExecutor): void { this.queueExecutor = qe; }
    private generateTitleIfNeeded(processId: string, turns: ConversationTurn[]): void { generateTitleIfNeededFn(processId, turns, this.store, this.aiService, this.defaultWorkingDirectory, this.queueManager); }
    private enqueueBackgroundReview(processId: string, workspaceId: string, turns: ConversationTurn[]): void {
        if (!this.queueManager) return;
        const payload = shouldEnqueueReview(processId, workspaceId, turns, DEFAULT_REVIEW_CONFIG);
        if (!payload) return;
        // Dedup: skip if a review for this process is already queued or running
        const existing = this.queueManager.getAll()
            .find(t => t.type === TaskDefs.backgroundReview.kind && (t.payload as any)?.sourceProcessId === processId
                && (t.status === 'queued' || t.status === 'running'));
        if (existing) return;
        this.queueManager.enqueue({
            type: TaskDefs.backgroundReview.kind,
            repoId: workspaceId,
            priority: 'low',
            payload: payload as any,
            config: {},
            displayName: `Memory review (${processId})`,
        });
    }

    /**
     * Enqueue a memory-aggregate task with deduplication.
     * At most one queued or running aggregate task per (workspaceId, target).
     */
    enqueueMemoryAggregate(workspaceId: string, target: 'memory' | 'system', trigger?: string): void {
        if (!this.queueManager) return;
        const existing = this.queueManager.getAll()
            .find(t =>
                t.type === TaskDefs.memoryAggregate.kind
                && (t.payload as any)?.workspaceId === workspaceId
                && (t.payload as any)?.target === target
                && (t.status === 'queued' || t.status === 'running'),
            );
        if (existing) return;
        this.queueManager.enqueue({
            type: TaskDefs.memoryAggregate.kind,
            repoId: workspaceId,
            priority: 'low',
            payload: {
                kind: 'memory-aggregate',
                workspaceId,
                target,
                trigger: trigger ?? 'capture-trigger',
            } as any,
            config: {},
            displayName: `Memory aggregate (${target})`,
        });
    }
    private async resolveWorkspaceIdForPath(rootPath: string): Promise<string> {
        const ws = (await this.store.getWorkspaces())
            .find(w => pathsReferToSameWorkspace(w.rootPath, rootPath));
        return ws?.id ?? rootPath;
    }

    async requeueForFollowUp(taskId: string, prompt: string, attachments?: Attachment[], imageTempDir?: string, mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[]): Promise<void> {
        if (!this.queueManager) throw new Error('Queue manager is not available');
        const existingTask = this.queueManager.getTask(taskId);
        if (existingTask && existingTask.status !== 'running') {
            applyFollowUpToTask(this.queueManager, taskId, prompt, attachments, imageTempDir, mode, deliveryMode, images, selectedSkillNames);
            return;
        }
        // Fallback: task not in in-memory queue (e.g. after server restart)
        // or still in running map (drain race). Reconstruct from the process
        // store and enqueue as a new task.
        const derivedProcessId = existingTask?.processId ?? toQueueProcessId(taskId);
        const proc = await this.store.getProcess(derivedProcessId) ?? await this.store.getProcess(toQueueProcessId(taskId)) ?? await this.store.getProcess(taskId);
        if (!proc) throw new Error(`Task ${taskId} not found`);
        const reconstructed = processToQueuedTask(proc);
        this.queueManager.enqueue({
            // For server-restart (task absent), reuse the original ID.
            // For running tasks, omit id to auto-generate and avoid ID collision.
            ...(existingTask ? {} : { id: taskId }),
            processId: derivedProcessId,
            type: reconstructed.type ?? 'chat',
            priority: 'normal',
            payload: { ...(reconstructed.payload as any), prompt, attachments, imageTempDir, ...(images ? { images } : {}), ...(mode ? { mode } : {}), ...(deliveryMode ? { deliveryMode } : {}) },
            config: {},
            displayName: prompt.trim().substring(0, 57) + (prompt.trim().length > 57 ? '...' : ''),
        });
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        // Background-review and memory-aggregate tasks bypass the lifecycle
        // runner — they don't create visible processes or conversation turns.
        if (isBackgroundReviewPayload(task.payload) || isMemoryAggregatePayload(task.payload)) {
            try {
                const result = await this.executors.dispatch(task, '');
                return { success: true, result, durationMs: 0 };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error : new Error(String(error)), durationMs: 0 };
            }
        }
        try {
            return await this.executors.runner.run(task, {
                cancelledTasks: this.cancelledTasks,
                executeFollowUpFn: (pid, msg, att, mode, dm, imgs, skills, mdl) => this.executeFollowUp(pid, msg, att, mode as ChatMode | undefined, dm, imgs, skills, mdl),
                executeByTypeFn: (t, p) => this.executors.dispatch(t, p),
                getWorkingDirectoryFn: (t) => this.executors.getWorkingDirectory(t),
                onDrainPendingMessages: (processId, taskId) => this.drainPendingMessages(processId, taskId),
            });
        } finally {
            this.cancelledTasks.delete(task.id);
        }
    }

    cancel(taskId: string): void { this.cancelledTasks.add(taskId); }

    async cancelProcess(processId: string): Promise<void> {
        const taskId = toTaskId(processId);
        // Route through QueueExecutor so both cancelledTasks sets are updated
        // and the queue slot is freed once the SDK abort propagates
        if (this.queueExecutor) {
            this.queueExecutor.cancelTask(taskId);
        } else {
            this.cancelledTasks.add(taskId);
        }
        try {
            const proc = await this.store.getProcess(processId);
            if (proc?.sdkSessionId) { await this.aiService.softAbortSession(proc.sdkSessionId); }
        } catch (err) {
            getLogger().debug(LogCategory.AI, `[Bridge] Failed to abort SDK session for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async isSessionAlive(_processId: string): Promise<boolean> { return true; }

    async steerProcess(processId: string, message: string): Promise<boolean> {
        try {
            const proc = await this.store.getProcess(processId);
            if (!proc?.sdkSessionId) return false;
            return await this.aiService.steerSession(proc.sdkSessionId, message);
        } catch (err) {
            getLogger().debug(LogCategory.AI, `[Bridge] Failed to steer session for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    answerAskUserQuestion(processId: string, questionId: string, answer: string | string[] | boolean): boolean {
        const handles = this.executors.getAskUserHandles(processId);
        if (!handles) return false;
        return handles.answerQuestion(questionId, answer);
    }

    skipAskUserQuestion(processId: string, questionId: string): boolean {
        const handles = this.executors.getAskUserHandles(processId);
        if (!handles) return false;
        return handles.skipQuestion(questionId);
    }

    async executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: ChatMode, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string): Promise<void> {
        return this.executors.followUpExecutor.executeFollowUp(processId, message, attachments, mode, deliveryMode, images, selectedSkillNames, model);
    }

    /**
     * Drain one pending message from the process store and enqueue it as a follow-up.
     * Called by the lifecycle runner after a task completes.
     *
     * Enqueues directly (not via requeueForFollowUp) because at this point the
     * parent task is still in the running map — QueueExecutor has not yet called
     * markCompleted. Using requeueForFollowUp would hit applyFollowUpToTask →
     * requeueFromHistory which fails for running tasks.
     */
    private async drainPendingMessages(processId: string, _taskId: string): Promise<void> {
        const proc = await this.store.getProcess(processId);
        if (!proc?.pendingMessages?.length) return;
        if (!this.queueManager) return;
        const [nextMsg, ...rest] = proc.pendingMessages;

        // Append the deferred user turn at the correct position (after the
        // assistant response that just completed) before enqueuing the follow-up.
        const turnContent = nextMsg.displayContent ?? nextMsg.content;
        await this.store.appendConversationTurn(
            processId,
            (turnIndex) => ({
                role: 'user' as const,
                content: turnContent,
                timestamp: new Date(nextMsg.createdAt),
                turnIndex,
                timeline: [],
                ...(nextMsg.images ? { images: nextMsg.images } : {}),
                ...(nextMsg.pasteExternalized ? { pasteExternalized: true } : {}),
                ...(nextMsg.model ? { model: nextMsg.model } : {}),
            }),
        );

        // Enqueue follow-up first — only remove pending message after success
        // to prevent data loss if enqueue fails.
        this.queueManager.enqueue({
            processId,
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat' as const,
                processId,
                prompt: nextMsg.content,
                ...(nextMsg.mode ? { mode: nextMsg.mode } : {}),
            },
            config: {},
            displayName: nextMsg.content.trim().substring(0, 57) + (nextMsg.content.trim().length > 57 ? '...' : ''),
        });
        await this.store.updateProcess(processId, { pendingMessages: rest });
    }
}

/**
 * Determines whether a task should use the exclusive (serial) limiter or the shared (concurrent) limiter.
 *
 * Concurrency model:
 * - `run-workflow` tasks (including work items) → **exclusive** — serialized 1-at-a-time per repo queue.
 *   Work items must never run concurrently within the same workspace.
 * - `chat` tasks with `ask` or `plan` mode (e.g. coc-chat sessions) → **shared** — up to
 *   `sharedConcurrency` (default 5) run concurrently. Multiple background-agent chat sessions
 *   are fully supported and process in parallel.
 * - `chat` tasks with `autopilot` mode → **exclusive** — treated as long-running autonomous
 *   agents that must not interleave with other exclusive tasks in the same repo queue.
 */
export function defaultIsExclusive(task: QueuedTask): boolean {
    // Chat has mode-dependent exclusivity
    if (isChatPayload(task.payload)) {
        return (task.payload as any).mode === 'autopilot';
    }
    // All other types: look up from struct, default exclusive
    const def = getTaskDef(task.type);
    return def?.exclusive ?? true;
}

export function createQueueExecutorBridge(queueManager: TaskQueueManager, store: ProcessStore, options: QueueExecutorBridgeOptions = {}): { executor: QueueExecutor; bridge: QueueExecutorBridge } {
    const bridge = new CLITaskExecutor(store, options);
    bridge.setQueueManager(queueManager);
    const executor = createQueueExecutor(queueManager, bridge, { sharedConcurrency: options.sharedConcurrency ?? 5, exclusiveConcurrency: options.exclusiveConcurrency ?? 1, isExclusive: options.isExclusive ?? defaultIsExclusive, autoStart: options.autoStart !== false, initialDelayMs: options.initialDelayMs });
    bridge.setQueueExecutor(executor);
    return { executor, bridge };
}
