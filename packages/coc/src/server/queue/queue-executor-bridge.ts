import type { ChatPayload, ChatMode } from '../tasks/task-types';
import { isChatPayload, isBackgroundReviewPayload, isMemoryPromotePayload, TaskDefs, getTaskDef } from '../tasks/task-types';
import { applyFollowUpToTask } from '../shared/queue-utils';
import { processToQueuedTask } from '../shared/process-history-mapper';
import type { Attachment, ConversationTurn, ISDKService, ProcessStore, QueuedTask, QueueExecutor, TaskExecutionResult, TaskExecutor, TaskQueueManager, TurnSource } from '@plusplusoneplusplus/forge';
import { createQueueExecutor, DEFAULT_AI_TIMEOUT_MS, FileToolCallCacheStore, sdkServiceRegistry, SDK_PROVIDER_COPILOT, getLogger, LogCategory, normalizeExecutionPath, resolveToolCallCacheOptions, resolveWorkspaceExecutionContext, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import * as path from 'path';
import { BaseExecutor } from '../executors/base-executor';
import { resolveSkillConfig } from '../executors/skill-config-resolver';
import { TitleGenerationService } from '../executors/title-generator';
import { ExecutorRegistry } from '../executors/executor-registry';
import { shouldEnqueueReview, DEFAULT_REVIEW_CONFIG } from '../memory/background-review';
import type { MemoryPromoteConfig } from '../memory/memory-promote';
import { parseRalphSignal } from '../executors/ralph-signal-parser';
import { recordRalphIteration } from '../ralph/record-iteration';

export const DEFAULT_FOLLOW_UP_SUGGESTIONS = { enabled: true, count: 3 } as const;

export interface CLITaskExecutorOptions {
    approvePermissions?: boolean; workingDirectory?: string; dataDir?: string;
    aiService?: ISDKService; defaultTimeoutMs?: number;
    followUpSuggestions?: { enabled: boolean; count: number };
    askUser?: { enabled: boolean };
    memoryPromotion?: MemoryPromoteConfig;
    getWsServer?: () => import('../streaming/websocket').ProcessWebSocketServer | undefined;
    getLoopInfra?: () => import('../executors/chat-base-executor').LoopInfraDeps | undefined;
    getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined;
}
export interface QueueExecutorBridgeOptions extends CLITaskExecutorOptions {
    maxConcurrency?: number; sharedConcurrency?: number; exclusiveConcurrency?: number;
    isExclusive?: (task: QueuedTask) => boolean; autoStart?: boolean;
    initialDelayMs?: number;
}
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
    cancelProcess?(processId: string): Promise<void>;
    steerProcess?(processId: string, message: string): Promise<boolean>;
    /** Answer a pending ask-user question. Returns true if the question was found and answered. */
    answerAskUserQuestion?(processId: string, questionId: string, answer: string | string[] | boolean): Promise<boolean>;
    /** Skip a pending ask-user question. Returns true if the question was found and skipped. */
    skipAskUserQuestion?(processId: string, questionId: string): Promise<boolean>;
    /** Resolve a pending ask-user question batch. Returns true only if every answer resolves. */
    answerAskUserQuestions?(processId: string, batchId: string, answers: Array<{ questionId: string; answer?: string | string[] | boolean; skipped?: boolean }>): Promise<boolean>;
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
    private readonly aiService: ISDKService;
    private queueManager?: TaskQueueManager;
    private queueExecutor?: QueueExecutor;
    private readonly executors: ExecutorRegistry;
    private readonly titleGenerationService: TitleGenerationService;
    private readonly getWsServer?: () => import('../streaming/websocket').ProcessWebSocketServer | undefined;
    private readonly getLoopInfra?: () => import('../executors/chat-base-executor').LoopInfraDeps | undefined;

    constructor(store: ProcessStore, options: CLITaskExecutorOptions = {}) {
        super(store, options.dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService ?? sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
        this.getWsServer = options.getWsServer;
        this.titleGenerationService = new TitleGenerationService({
            store,
            aiService: this.aiService,
            defaultWorkingDirectory: this.defaultWorkingDirectory,
        });
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
            memoryPromotion: options.memoryPromotion,
            toolCallCacheStore: cacheStore,
            resolveSkillConfig: skillCfg,
            resolveWorkspaceIdForPath: (p: string) => this.resolveWorkspaceIdForPath(p),
            onTitleNeeded: (pid: string, turns: ConversationTurn[]) => this.generateTitleIfNeeded(pid, turns),
            onBackgroundReview: (pid: string, wsId: string, turns: ConversationTurn[]) => this.enqueueBackgroundReview(pid, wsId, turns),
            getWsServer: options.getWsServer,
            getLoopInfra: options.getLoopInfra,
            getMcpOauthManager: options.getMcpOauthManager,
        });
        this.getLoopInfra = options.getLoopInfra;
    }

    setQueueManager(qm: TaskQueueManager): void {
        this.queueManager = qm;
        this.titleGenerationService.setQueueManager(qm);
    }
    setQueueExecutor(qe: QueueExecutor): void { this.queueExecutor = qe; }
    private generateTitleIfNeeded(processId: string, turns: ConversationTurn[]): void { this.titleGenerationService.generateIfNeeded(processId, turns); }
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

    private async resolveWorkspaceIdForPath(rootPath: string): Promise<string> {
        const ws = (await this.store.getWorkspaces())
            .find(w => pathsReferToSameWorkspace(w.rootPath, rootPath));
        return ws?.id ?? rootPath;
    }

    /**
     * Called by ProcessLifecycleRunner after a ralph-mode task completes.
     * Parses RALPH_NEXT/RALPH_COMPLETE signal, writes the iteration's
     * progress section to the per-session journal (`progress.md` +
     * `session.json`), and either enqueues the next iteration or emits a
     * ralph-session-complete WS event.
     */
    private enqueueRalphNextIteration(processId: string, completedTask: QueuedTask, responseText: string): void {
        if (!this.queueManager) return;
        const logger = getLogger();

        const { signal, progress } = parseRalphSignal(responseText);
        const payload = completedTask.payload as unknown as ChatPayload;
        const ralphCtx = payload.context?.ralph;
        const currentIteration = ralphCtx?.currentIteration ?? 1;
        const maxIterations = ralphCtx?.maxIterations ?? 20;
        const workspaceId = payload.workspaceId;
        const sessionId = ralphCtx?.sessionId;

        const shouldContinue = signal === 'RALPH_NEXT' && currentIteration < maxIterations;

        // Persist the iteration's progress section + update session.json.
        // Best-effort: any I/O failure is logged and does not block enqueue.
        recordRalphIteration({
            dataDir: this.dataDir,
            workspaceId,
            sessionId,
            iteration: currentIteration,
            maxIterations,
            signal,
            progressBody: progress,
            taskId: completedTask.id,
            processId,
            shouldContinue,
            originalGoal: ralphCtx?.originalGoal,
            iterationStartMs: completedTask.startedAt,
        }).catch(err => {
            logger.debug(LogCategory.AI, `[Ralph] journal persist failed for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
        });

        if (!shouldContinue) {
            // Session complete — emit WS event
            const reason = signal === 'RALPH_COMPLETE' ? 'signal' : 'cap';
            logger.debug(LogCategory.AI, `[Ralph] Session complete for ${processId} (reason: ${reason}, iterations: ${currentIteration})`);
            if (workspaceId) {
                try {
                    this.getWsServer?.()?.broadcastProcessEvent({
                        type: 'ralph-session-complete',
                        workspaceId,
                        sessionId,
                        processId,
                        totalIterations: currentIteration,
                        reason,
                    });
                } catch (err) {
                    logger.debug(LogCategory.AI, `[Ralph] Failed to broadcast ralph-session-complete: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            return;
        }

        // Enqueue next iteration
        const nextIteration = currentIteration + 1;

        logger.debug(LogCategory.AI, `[Ralph] Enqueuing iteration ${nextIteration}/${maxIterations} for session ${sessionId ?? processId}`);

        try {
            this.queueManager.enqueue({
                type: 'chat',
                repoId: completedTask.repoId,
                priority: 'normal',
                payload: {
                    kind: 'chat' as const,
                    mode: 'ralph' as const,
                    prompt: payload.prompt,
                    workspaceId: payload.workspaceId,
                    workingDirectory: payload.workingDirectory,
                    folderPath: (payload as any).folderPath,
                    context: {
                        ...payload.context,
                        ralph: {
                            ...ralphCtx,
                            originalGoal: ralphCtx?.originalGoal ?? '',
                            currentIteration: nextIteration,
                            maxIterations,
                            sessionId: sessionId ?? processId,
                            phase: 'executing' as const,
                        },
                    },
                } as any,
                config: completedTask.config ?? {},
                displayName: `Ralph iteration ${nextIteration}${sessionId ? ` (${sessionId})` : ''}`,
            });
        } catch (err) {
            logger.warn(LogCategory.AI, `[Ralph] Failed to enqueue next iteration for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Best-effort: append the parsed `RALPH_PROGRESS:` body to the
     * session journal and update `session.json`. Implementation lives in
     * `recordRalphIteration` so it can be unit-tested in isolation.
     */
    // (delegated to recordRalphIteration above)

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
        // Background-review and memory-promote tasks bypass the lifecycle
        // runner — they don't create visible processes or conversation turns.
        if (isBackgroundReviewPayload(task.payload) || isMemoryPromotePayload(task.payload)) {
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
                executeFollowUpFn: (pid, msg, att, mode, dm, imgs, skills, mdl, ts) => this.executeFollowUp(pid, msg, att, mode as ChatMode | undefined, dm, imgs, skills, mdl, ts),
                executeByTypeFn: (t, p) => this.executors.dispatch(t, p),
                getWorkingDirectoryFn: (t) => this.executors.getWorkingDirectory(t),
                onDrainPendingMessages: (processId, taskId) => this.drainPendingMessages(processId, taskId),
                onRalphNext: (processId, completedTask, responseText) => this.enqueueRalphNextIteration(processId, completedTask, responseText),
                onLoopTickComplete: (loopId, success) => {
                    const infra = this.getLoopInfra?.();
                    if (!infra) return;
                    return infra.executor.onTickComplete(loopId, success);
                },
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
            // SDK steering targets the already-running session; it cannot change
            // that live session's custom tool registry.
            return await this.aiService.steerSession(proc.sdkSessionId, message);
        } catch (err) {
            getLogger().debug(LogCategory.AI, `[Bridge] Failed to steer session for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    async answerAskUserQuestion(processId: string, questionId: string, answer: string | string[] | boolean): Promise<boolean> {
        const handles = this.executors.getAskUserHandles(processId);
        if (!handles) return false;
        const resolved = handles.answerQuestion(questionId, answer);
        if (resolved) {
            await this.store.updateProcess(processId, { pendingAskUser: undefined });
        }
        return resolved;
    }

    async skipAskUserQuestion(processId: string, questionId: string): Promise<boolean> {
        const handles = this.executors.getAskUserHandles(processId);
        if (!handles) return false;
        const resolved = handles.skipQuestion(questionId);
        if (resolved) {
            await this.store.updateProcess(processId, { pendingAskUser: undefined });
        }
        return resolved;
    }

    async answerAskUserQuestions(processId: string, batchId: string, answers: Array<{ questionId: string; answer?: string | string[] | boolean; skipped?: boolean }>): Promise<boolean> {
        const handles = this.executors.getAskUserHandles(processId);
        if (!handles) return false;
        const proc = await this.store.getProcess(processId);
        const pendingBatchId = proc?.pendingAskUser?.[0]?.batchId;
        if (pendingBatchId !== batchId) return false;
        const resolved = handles.answerQuestions(answers);
        if (resolved) {
            await this.store.updateProcess(processId, { pendingAskUser: undefined });
        }
        return resolved;
    }

    async executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: ChatMode, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource): Promise<void> {
        return this.executors.followUpExecutor.executeFollowUp(processId, message, attachments, mode, deliveryMode, images, selectedSkillNames, model, turnSource);
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
                ...(nextMsg.mode ? { mode: nextMsg.mode } : {}),
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
                ...(nextMsg.model ? { model: nextMsg.model } : {}),
                ...(nextMsg.attachments ? { attachments: nextMsg.attachments } : {}),
                ...(nextMsg.imageTempDir ? { imageTempDir: nextMsg.imageTempDir } : {}),
                ...(nextMsg.images ? { images: nextMsg.images } : {}),
                ...(nextMsg.fileAttachmentMeta ? { fileAttachmentMeta: nextMsg.fileAttachmentMeta } : {}),
                ...(nextMsg.skillNames && nextMsg.skillNames.length > 0 ? { context: { skills: nextMsg.skillNames } } : {}),
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
 *   are fully supported and process in parallel. Ralph grilling phase uses `mode='ask'`
 *   and stays in the shared lane.
 * - `chat` tasks with `autopilot` or `ralph` mode → **exclusive** — long-running autonomous
 *   agents that must not interleave with other exclusive tasks in the same repo queue.
 *   Ralph execution iterations carry `mode='ralph'`; serializing them prevents two ralph
 *   sessions (or a ralph session and an autopilot task) from concurrently mutating files
 *   in the same workspace.
 */
export function defaultIsExclusive(task: QueuedTask): boolean {
    // Chat has mode-dependent exclusivity
    if (isChatPayload(task.payload)) {
        const mode = (task.payload as any).mode;
        return mode === 'autopilot' || mode === 'ralph';
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
