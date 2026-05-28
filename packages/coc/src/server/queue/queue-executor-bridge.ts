import type { ChatPayload, ChatMode } from '../tasks/task-types';
import { isChatPayload, TaskDefs, getTaskDef } from '../tasks/task-types';
import { applyFollowUpToTask } from '../shared/queue-utils';
import { processToQueuedTask } from '../shared/process-history-mapper';
import type { Attachment, ConversationTurn, ISDKService, ProcessStore, QueuedTask, QueueExecutor, TaskExecutionResult, TaskExecutor, TaskQueueManager, TurnSource } from '@plusplusoneplusplus/forge';
import { createQueueExecutor, DEFAULT_AI_TIMEOUT_MS, FileToolCallCacheStore, sdkServiceRegistry, SDK_PROVIDER_COPILOT, getLogger, LogCategory, normalizeExecutionPath, resolveToolCallCacheOptions, resolveWorkspaceExecutionContext, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import * as path from 'path';
import { BaseExecutor } from '../executors/base-executor';
import { resolveSkillConfig } from '../executors/skill-config-resolver';
import { TitleGenerationService } from '../executors/title-generator';
import { ExecutorRegistry } from '../executors/executor-registry';
import { parseRalphSignal } from '../executors/ralph-signal-parser';
import { recordRalphIteration } from '../ralph/record-iteration';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import {
    buildFinalCheckTaskPayload,
    buildFinalCheckStartRecord,
    nextCheckIndex,
    sessionHasFinalCheckFor,
    wasFinalCheckEnqueued,
    markFinalCheckEnqueued,
} from '../ralph/enqueue-final-check';
import { orchestrateFinalCheck } from '../ralph/orchestrate-final-check';
import { loadConfigFile, DEFAULT_CONFIG } from '../../config';

export const DEFAULT_FOLLOW_UP_SUGGESTIONS = { enabled: true, count: 3 } as const;

export interface CLITaskExecutorOptions {
    approvePermissions?: boolean; workingDirectory?: string; dataDir?: string;
    aiService?: ISDKService; defaultTimeoutMs?: number;
    followUpSuggestions?: { enabled: boolean; count: number };
    askUser?: { enabled: boolean };
    /** Default AI provider name recorded on new processes when the task has no provider override. */
    provider?: 'copilot' | 'codex' | 'claude';
    /**
     * Resolve an ISDKService for a given provider, checking enablement.
     * Supplied by the server so executors can perform per-chat routing without
     * holding a direct reference to RuntimeConfigService.
     */
    resolveAiServiceForProvider?: (provider: import('../tasks/task-types').ChatProvider) => ISDKService;
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
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'): Promise<void>;
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
            provider: options.provider,
            resolveAiServiceForProvider: options.resolveAiServiceForProvider,
            toolCallCacheStore: cacheStore,
            resolveSkillConfig: skillCfg,
            resolveWorkspaceIdForPath: (p: string) => this.resolveWorkspaceIdForPath(p),
            onTitleNeeded: (pid: string, turns: ConversationTurn[]) => this.generateTitleIfNeeded(pid, turns),
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
     *
     * When the completed task is a final-check task (context.ralph.finalCheck
     * is set), routes to handleFinalCheckCompletion instead.
     */
    private enqueueRalphNextIteration(processId: string, completedTask: QueuedTask, responseText: string): void {
        if (!this.queueManager) return;
        const logger = getLogger();

        const payload = completedTask.payload as unknown as ChatPayload;
        const ralphCtx = payload.context?.ralph;
        const workspaceId = payload.workspaceId;
        const sessionId = ralphCtx?.sessionId;

        // ── Route final-check completions separately (AC-01) ────────────────
        if (ralphCtx?.finalCheck) {
            this.handleFinalCheckCompletion(processId, completedTask, responseText, ralphCtx, workspaceId, sessionId).catch(err => {
                logger.warn(LogCategory.AI, `[Ralph/FinalCheck] handleFinalCheckCompletion threw: ${err instanceof Error ? err.message : String(err)}`);
            });
            return;
        }

        const { signal, progress } = parseRalphSignal(responseText);
        const currentIteration = ralphCtx?.currentIteration ?? 1;
        const maxIterations = ralphCtx?.maxIterations ?? 20;

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
            if (signal === 'RALPH_COMPLETE') {
                // Enqueue a final-check task before broadcasting session-complete (AC-01).
                this.enqueueFinalCheckAfterComplete(
                    workspaceId, sessionId, currentIteration, ralphCtx, completedTask, payload,
                ).catch(err => {
                    logger.warn(LogCategory.AI, `[Ralph] enqueueFinalCheckAfterComplete failed: ${err instanceof Error ? err.message : String(err)}`);
                    // Broadcast session complete even if final-check enqueue fails
                    this.broadcastRalphSessionComplete(workspaceId, sessionId, processId, currentIteration, 'signal');
                });
            } else {
                // cap / no-signal / cancelled — broadcast immediately, no final check
                const reason = 'cap';
                logger.debug(LogCategory.AI, `[Ralph] Session complete for ${processId} (reason: ${reason}, iterations: ${currentIteration})`);
                this.broadcastRalphSessionComplete(workspaceId, sessionId, processId, currentIteration, reason);
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

    /** Broadcast a ralph-session-complete WS event. */
    private broadcastRalphSessionComplete(
        workspaceId: string | undefined,
        sessionId: string | undefined,
        processId: string,
        totalIterations: number,
        reason: string,
    ): void {
        if (!workspaceId) return;
        const logger = getLogger();
        try {
            this.getWsServer?.()?.broadcastProcessEvent({
                type: 'ralph-session-complete',
                workspaceId,
                sessionId,
                processId,
                totalIterations,
                reason,
            });
        } catch (err) {
            logger.debug(LogCategory.AI, `[Ralph] Failed to broadcast ralph-session-complete: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * After a normal Ralph loop ends with RALPH_COMPLETE, enqueue one
     * final-check task (AC-01). Idempotency-guarded against duplicate events.
     */
    private async enqueueFinalCheckAfterComplete(
        workspaceId: string | undefined,
        sessionId: string | undefined,
        sourceIteration: number,
        ralphCtx: any,
        completedTask: QueuedTask,
        payload: ChatPayload,
    ): Promise<void> {
        if (!workspaceId || !sessionId || !this.queueManager || !this.dataDir) return;
        const logger = getLogger();

        // ── In-memory idempotency guard ──────────────────────────────────────
        if (wasFinalCheckEnqueued(sessionId, sourceIteration)) {
            logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Duplicate completion event ignored for ${sessionId}:${sourceIteration}`);
            return;
        }

        // ── Persistent idempotency guard (survives server restart) ───────────
        const store = new RalphSessionStore({ dataDir: this.dataDir! });
        const session = await store.readSessionRecord(workspaceId, sessionId);
        if (!session) {
            logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Session record missing for ${sessionId}; skipping final-check enqueue.`);
            this.broadcastRalphSessionComplete(workspaceId, sessionId, completedTask.id, sourceIteration, 'signal');
            return;
        }

        if (sessionHasFinalCheckFor(session, sourceIteration)) {
            logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Persistent duplicate: check for ${sessionId}:${sourceIteration} already exists.`);
            return;
        }

        markFinalCheckEnqueued(sessionId, sourceIteration);

        const checkIndex = nextCheckIndex(session);
        const loopIndex = (ralphCtx?.loopIndex as number | undefined)
            ?? (session.loops?.[session.loops.length - 1]?.loopIndex ?? 1);

        const progressPath = store.getProgressPath(workspaceId, sessionId);

        const taskPayload = buildFinalCheckTaskPayload({
            workspaceId,
            sessionId,
            originalGoal: session.originalGoal,
            checkIndex,
            sourceIteration,
            loopIndex,
            progressPath,
            workingDirectory: payload.workingDirectory,
            folderPath: (payload as any).folderPath,
            repoId: completedTask.repoId,
            provider: (payload as any).provider,
        });

        let taskId: string;
        try {
            taskId = this.queueManager.enqueue(taskPayload as any);
        } catch (err) {
            logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Enqueue failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
            this.broadcastRalphSessionComplete(workspaceId, sessionId, completedTask.id, sourceIteration, 'signal');
            return;
        }

        // Persist the running-status record immediately so the session response
        // shows the check is in progress before the AI response arrives.
        const startRecord = buildFinalCheckStartRecord(checkIndex, loopIndex, sourceIteration, taskId, undefined, new Date().toISOString());
        await store.upsertFinalCheckRecord(workspaceId, sessionId, checkIndex, startRecord).catch(err => {
            logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Failed to persist start record: ${err instanceof Error ? err.message : String(err)}`);
        });

        logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Enqueued final-check task ${taskId} (check ${checkIndex}) for session ${sessionId}`);
    }

    /**
     * Handle completion of a final-check task.
     * Routes to orchestrateFinalCheck which decides gap-loop or session-complete.
     */
    private async handleFinalCheckCompletion(
        processId: string,
        completedTask: QueuedTask,
        responseText: string,
        ralphCtx: any,
        workspaceId: string | undefined,
        sessionId: string | undefined,
    ): Promise<void> {
        if (!workspaceId || !sessionId || !this.queueManager || !this.dataDir) return;
        const logger = getLogger();

        const finalCheckCtx = ralphCtx.finalCheck;
        const checkIndex: number = finalCheckCtx?.checkIndex ?? 1;
        const loopIndex: number = finalCheckCtx?.loopIndex ?? 1;
        const sourceIteration: number = finalCheckCtx?.sourceIteration ?? 0;

        // Update the record to reflect the process ID (now known from processId)
        const store = new RalphSessionStore({ dataDir: this.dataDir! });
        await store.upsertFinalCheckRecord(workspaceId, sessionId, checkIndex, {
            status: 'running',
            loopIndex,
            sourceIteration,
            processId,
        }).catch(err => {
            logger.debug(LogCategory.AI, `[Ralph/FinalCheck] Failed to update processId for check ${checkIndex}: ${err instanceof Error ? err.message : String(err)}`);
        });

        // Resolve config cap
        const fileConfig = loadConfigFile();
        const maxGapFixLoops = fileConfig?.ralph?.finalCheck?.maxGapFixLoops
            ?? DEFAULT_CONFIG.ralph.finalCheck.maxGapFixLoops;

        const qm = this.queueManager;
        await orchestrateFinalCheck({
            workspaceId,
            sessionId,
            checkIndex,
            loopIndex,
            sourceIteration,
            taskId: completedTask.id,
            processId,
            responseText,
            deps: {
                store,
                enqueueTask: (payload) => qm.enqueue(payload as any),
                broadcastSessionComplete: (params) => this.broadcastRalphSessionComplete(
                    params.workspaceId, params.sessionId, params.processId,
                    params.totalIterations, params.reason,
                ),
                maxGapFixLoops,
                dataDir: this.dataDir,
                workingDirectory: (completedTask.payload as any).workingDirectory,
                folderPath: (completedTask.payload as any).folderPath,
                provider: (completedTask.payload as any).provider,
                repoId: completedTask.repoId,
            },
        }).catch(err => {
            logger.warn(LogCategory.AI, `[Ralph/FinalCheck] orchestrateFinalCheck threw: ${err instanceof Error ? err.message : String(err)}`);
        });
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
        try {
            return await this.executors.runner.run(task, {
                cancelledTasks: this.cancelledTasks,
                executeFollowUpFn: (pid, msg, att, mode, dm, imgs, skills, mdl, ts, re) => this.executeFollowUp(pid, msg, att, mode as ChatMode | undefined, dm, imgs, skills, mdl, ts, re),
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

    async executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: ChatMode, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'): Promise<void> {
        return this.executors.followUpExecutor.executeFollowUp(processId, message, attachments, mode, deliveryMode, images, selectedSkillNames, model, turnSource, reasoningEffort);
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
        // to prevent data loss if enqueue fails. Per-turn reasoning-effort
        // (captured when the message was buffered) is carried through to the
        // replayed task so the follow-up executor honours it.
        const pendingEffort = (nextMsg as { reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }).reasoningEffort;
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
                ...(pendingEffort ? { reasoningEffort: pendingEffort } : {}),
                ...(nextMsg.attachments ? { attachments: nextMsg.attachments } : {}),
                ...(nextMsg.imageTempDir ? { imageTempDir: nextMsg.imageTempDir } : {}),
                ...(nextMsg.images ? { images: nextMsg.images } : {}),
                ...(nextMsg.fileAttachmentMeta ? { fileAttachmentMeta: nextMsg.fileAttachmentMeta } : {}),
                ...(nextMsg.skillNames && nextMsg.skillNames.length > 0 ? { context: { skills: nextMsg.skillNames } } : {}),
            },
            config: pendingEffort ? { reasoningEffort: pendingEffort } : {},
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
