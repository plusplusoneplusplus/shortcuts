import type { ChatPayload, ChatMode } from '../tasks/task-types';
import { isChatPayload, TaskDefs, getTaskDef, normalizeChatMode } from '../tasks/task-types';
import { applyFollowUpToTask } from '../shared/queue-utils';
import { processToQueuedTask } from '../shared/process-history-mapper';
import type { AIProcess, Attachment, ConversationTurn, ISDKService, ProcessStore, QueuedTask, QueueExecutor, TaskExecutionResult, TaskExecutor, TaskQueueManager, TurnSource } from '@plusplusoneplusplus/forge';
import { createQueueExecutor, DEFAULT_AI_TIMEOUT_MS, sdkServiceRegistry, SDK_PROVIDER_COPILOT, getLogger, LogCategory, normalizeExecutionPath, resolveModelForProvider, resolveWorkspaceExecutionContext, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { BaseExecutor } from '../executors/base-executor';
import { resolveSkillConfig } from '../executors/skill-config-resolver';
import { TitleGenerationService } from '../executors/title-generator';
import { ExecutorRegistry } from '../executors/executor-registry';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { orchestrateRalphIteration } from '../ralph/orchestrate-iteration';
import { orchestrateFinalCheck } from '../ralph/orchestrate-final-check';
import { loadConfigFile, DEFAULT_CONFIG } from '../../config';
import type { AutoProviderResolutionResult } from '../agent-providers/auto-provider-router';
import type { AskUserAnswerInput, AskUserAnswerValue } from '../llm-tools/ask-user-tool';
import { ASK_USER_RESUME_FAILED_MESSAGE, buildAskUserResumeMessage, buildPendingAskUserAnswerRecord } from '../llm-tools/ask-user-resume';
import { buildAskUserResumeTaskInput } from '../processes/resume-pending-ask-user-answers';
import type { DreamRunExecutor } from '../dreams/dream-runner';

export const DEFAULT_FOLLOW_UP_SUGGESTIONS = { enabled: true, count: 3 } as const;

export type ResolveDefaultProviderForExecution = (options?: { forceAuto?: boolean }) => Promise<AutoProviderResolutionResult>;

export interface CLITaskExecutorOptions {
    approvePermissions?: boolean; workingDirectory?: string; dataDir?: string;
    aiService?: ISDKService; defaultTimeoutMs?: number;
    followUpSuggestions?: { enabled: boolean; count: number };
    askUser?: { enabled: boolean };
    /** Default AI provider name recorded on new processes when the task has no provider override. */
    provider?: 'copilot' | 'codex' | 'claude';
    /** Enables the gated multi-agent Ralph grilling prompt contract. */
    ralphMultiAgentGrillEnabled?: boolean;
    /**
     * Resolve an ISDKService for a given provider, checking enablement.
     * Supplied by the server so executors can perform per-chat routing without
     * holding a direct reference to RuntimeConfigService.
     */
    resolveAiServiceForProvider?: (provider: import('../tasks/task-types').ChatProvider) => ISDKService;
    /**
     * Live read of the admin-configured global system prompt
     * (`chat.globalSystemPrompt`). Supplied by the server (backed by
     * RuntimeConfigService) so executors inject it without holding a config
     * reference. Threaded to user-facing chat executors only.
     */
    getGlobalSystemPrompt?: () => string | undefined;
    /** Resolve Auto provider routing when a queued chat task starts execution. */
    resolveDefaultProvider?: ResolveDefaultProviderForExecution;
    getWsServer?: () => import('../streaming/websocket').ProcessWebSocketServer | undefined;
    getLoopInfra?: () => import('../executors/chat-base-executor').LoopInfraDeps | undefined;
    getTriggerInfra?: () => { manager: import('../triggers/trigger-manager').TriggerManager } | undefined;
    /**
     * Late-bound in-process enqueue capability supplied by the server/route layer
     * (where the queue router + global state live). Powers the opt-in
     * `create_conversation` tool so an agent can spawn a brand-new chat.
     */
    getEnqueueChat?: () => import('../llm-tools/create-conversation-tool').EnqueueChatFn | undefined;
    getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined;
    onRalphSessionComplete?: (event: RalphSessionCompleteEvent) => void;
    dreamRunExecutor?: DreamRunExecutor;
}
export interface QueueExecutorBridgeOptions extends CLITaskExecutorOptions {
    maxConcurrency?: number; sharedConcurrency?: number; exclusiveConcurrency?: number;
    isExclusive?: (task: QueuedTask) => boolean; autoStart?: boolean;
    initialDelayMs?: number;
}
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', strictResumeSessionId?: string): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
    cancelProcess?(processId: string): Promise<void>;
    steerProcess?(processId: string, message: string): Promise<boolean>;
    /** Answer a pending ask-user question. Returns true if the question was found and answered. */
    answerAskUserQuestion?(processId: string, questionId: string, answer: AskUserAnswerValue): Promise<boolean>;
    /** Skip a pending ask-user question. Returns true if the question was found and skipped. */
    skipAskUserQuestion?(processId: string, questionId: string): Promise<boolean>;
    /** Resolve a pending ask-user question batch. Returns true only if every answer resolves. */
    answerAskUserQuestions?(processId: string, batchId: string, answers: AskUserAnswerInput[]): Promise<boolean>;
    /**
     * Resume a process whose durable `pendingAskUserAnswer` was persisted after
     * a restart tore down the live ask_user resolver. Rebuilds the synthesized
     * answer message and resumes the SDK session. Invoked by the lifecycle
     * runner for `context.askUserResume` follow-up tasks and by the startup
     * re-enqueue routine.
     */
    resumePendingAskUser?(processId: string): Promise<void>;
    /** Update the execution-time Auto provider resolver for existing bridges. */
    setResolveDefaultProvider?(resolveDefaultProvider: ResolveDefaultProviderForExecution): void;
    /** Late-bind the Dreams runner after route composition creates it. */
    setDreamRunExecutor?(dreamRunExecutor: DreamRunExecutor): void;
}

export interface RalphSessionCompleteEvent {
    type: 'ralphSessionComplete';
    workspaceId: string;
    sessionId?: string;
    processId: string;
    totalIterations: number;
    reason: string;
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
    private readonly getTriggerInfra?: () => { manager: import('../triggers/trigger-manager').TriggerManager } | undefined;
    private readonly onRalphSessionComplete?: (event: RalphSessionCompleteEvent) => void;
    private resolveDefaultProvider?: ResolveDefaultProviderForExecution;
    private dreamRunExecutor?: DreamRunExecutor;

    constructor(store: ProcessStore, options: CLITaskExecutorOptions = {}) {
        super(store, options.dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService ?? sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
        this.getWsServer = options.getWsServer;
        this.onRalphSessionComplete = options.onRalphSessionComplete;
        this.resolveDefaultProvider = options.resolveDefaultProvider;
        this.dreamRunExecutor = options.dreamRunExecutor;
        this.titleGenerationService = new TitleGenerationService({
            store,
            aiService: this.aiService,
            defaultWorkingDirectory: this.defaultWorkingDirectory,
        });
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
            ralphMultiAgentGrillEnabled: options.ralphMultiAgentGrillEnabled,
            resolveAiServiceForProvider: options.resolveAiServiceForProvider,
            getGlobalSystemPrompt: options.getGlobalSystemPrompt,
            resolveSkillConfig: skillCfg,
            resolveWorkspaceIdForPath: (p: string) => this.resolveWorkspaceIdForPath(p),
            onTitleNeeded: (pid: string, turns: ConversationTurn[]) => this.generateTitleIfNeeded(pid, turns),
            getWsServer: options.getWsServer,
            getLoopInfra: options.getLoopInfra,
            getEnqueueChat: options.getEnqueueChat,
            getMcpOauthManager: options.getMcpOauthManager,
            getDreamRunExecutor: () => this.dreamRunExecutor,
            cancelledTasks: this.cancelledTasks,
        });
        this.getLoopInfra = options.getLoopInfra;
        this.getTriggerInfra = options.getTriggerInfra;
    }

    setQueueManager(qm: TaskQueueManager): void {
        this.queueManager = qm;
        this.titleGenerationService.setQueueManager(qm);
    }
    setQueueExecutor(qe: QueueExecutor): void { this.queueExecutor = qe; }
    setResolveDefaultProvider(resolveDefaultProvider: ResolveDefaultProviderForExecution): void {
        this.resolveDefaultProvider = resolveDefaultProvider;
    }
    setDreamRunExecutor(dreamRunExecutor: DreamRunExecutor): void {
        this.dreamRunExecutor = dreamRunExecutor;
    }
    private generateTitleIfNeeded(processId: string, turns: ConversationTurn[]): void { this.titleGenerationService.generateIfNeeded(processId, turns); }

    private async resolveWorkspaceIdForPath(rootPath: string): Promise<string> {
        const ws = (await this.store.getWorkspaces())
            .find(w => pathsReferToSameWorkspace(w.rootPath, rootPath));
        return ws?.id ?? rootPath;
    }

    /**
     * Called by ProcessLifecycleRunner after a ralph-mode task completes.
     * Delegates to orchestrateRalphIteration (ralph/orchestrate-iteration.ts)
     * which applies the portable action intents from decideRalphIterationActions.
     *
     * When the completed task is a final-check task (context.ralph.finalCheck
     * is set), routes to handleFinalCheckCompletion instead.
     */
    private async enqueueRalphNextIteration(processId: string, completedTask: QueuedTask, responseText: string): Promise<void> {
        if (!this.queueManager) return;

        const payload = completedTask.payload as unknown as ChatPayload;
        const ralphCtx = payload.context?.ralph;
        const workspaceId = payload.workspaceId;
        const sessionId = ralphCtx?.sessionId;

        // ── Route final-check completions separately ─────────────────────────
        if (ralphCtx?.finalCheck) {
            await this.handleFinalCheckCompletion(processId, completedTask, responseText, ralphCtx, workspaceId, sessionId);
            return;
        }

        const qm = this.queueManager;
        await orchestrateRalphIteration({
            responseText,
            completedTaskId: completedTask.id,
            processId,
            workspaceId,
            sessionId,
            originalGoal: ralphCtx?.originalGoal,
            currentIteration: ralphCtx?.currentIteration,
            maxIterations: ralphCtx?.maxIterations,
            iterationStartMs: completedTask.startedAt,
            adapterContext: getScheduleRunContext(payload.context),
            ralphCtx: ralphCtx as Record<string, unknown> | undefined,
            deps: {
                dataDir: this.dataDir,
                enqueueTask: (t) => qm.enqueue(t as any),
                broadcastSessionComplete: (params) => this.broadcastRalphSessionComplete(
                    params.workspaceId, params.sessionId, params.processId,
                    params.totalIterations, params.reason,
                ),
                workingDirectory: payload.workingDirectory,
                folderPath: (payload as any).folderPath,
                provider: isAutoProviderRoutingRequested(payload.context) ? undefined : (payload as any).provider,
                repoId: completedTask.repoId,
                existingPayloadContext: payload.context as Record<string, unknown>,
                existingTaskConfig: completedTask.config as Record<string, unknown>,
            },
        });
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
        const event: RalphSessionCompleteEvent = {
            type: 'ralphSessionComplete',
            workspaceId,
            sessionId,
            processId,
            totalIterations,
            reason,
        };
        try {
            this.onRalphSessionComplete?.(event);
        } catch (err) {
            logger.debug(LogCategory.AI, `[Ralph] Failed to publish internal ralphSessionComplete event: ${err instanceof Error ? err.message : String(err)}`);
        }
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
                provider: isAutoProviderRoutingRequested((completedTask.payload as any).context)
                    ? undefined
                    : (completedTask.payload as any).provider,
                repoId: completedTask.repoId,
                extraContext: getRalphCarryForwardContext((completedTask.payload as any).context),
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
            payload: { ...(reconstructed.payload as any), prompt, attachments, imageTempDir, ...(images ? { images } : {}), ...(normalizeChatMode(mode) ? { mode: normalizeChatMode(mode) } : {}), ...(deliveryMode ? { deliveryMode } : {}) },
            config: {},
            displayName: prompt.trim().substring(0, 57) + (prompt.trim().length > 57 ? '...' : ''),
        });
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        try {
            return await this.executors.runner.run(task, {
                cancelledTasks: this.cancelledTasks,
                executeFollowUpFn: (pid, msg, att, mode, dm, imgs, skills, mdl, ts, re, strictResumeSessionId) => this.executeFollowUp(pid, msg, att, mode as ChatMode | undefined, dm, imgs, skills, mdl, ts, re, strictResumeSessionId),
                resumePendingAskUserFn: (pid) => this.resumePendingAskUser(pid),
                executeByTypeFn: (t, p) => this.executors.dispatch(t, p),
                getWorkingDirectoryFn: (t) => this.executors.getWorkingDirectory(t),
                resolveDefaultProvider: this.resolveDefaultProvider,
                onDrainPendingMessages: (processId, taskId) => this.drainPendingMessages(processId, taskId),
                onRalphNext: (processId, completedTask, responseText) => this.enqueueRalphNextIteration(processId, completedTask, responseText),
                onLoopTickComplete: (loopId, success) => {
                    const infra = this.getLoopInfra?.();
                    if (!infra) return;
                    return infra.executor.onTickComplete(loopId, success);
                },
                onTriggerActionComplete: (triggerId, success) => {
                    const infra = this.getTriggerInfra?.();
                    if (!infra) return;
                    return infra.manager.onActionComplete(triggerId, success);
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

    async answerAskUserQuestion(processId: string, questionId: string, answer: AskUserAnswerValue): Promise<boolean> {
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

    async answerAskUserQuestions(processId: string, batchId: string, answers: AskUserAnswerInput[]): Promise<boolean> {
        const handles = this.executors.getAskUserHandles(processId);
        const proc = await this.store.getProcess(processId);
        const pendingBatchId = proc?.pendingAskUser?.[0]?.batchId;

        // Live fast path (AC-07): the in-memory resolver is still present (no
        // restart). Resolve the awaiting Promise directly; a batchId mismatch or
        // an already-answered batch still returns false (→ 404). No resume task.
        if (handles) {
            if (pendingBatchId !== batchId) return false;
            const resolved = handles.answerQuestions(answers);
            if (resolved) {
                await this.store.updateProcess(processId, { pendingAskUser: undefined });
            }
            return resolved;
        }

        // Post-restart path (AC-01/AC-02): the live handles are gone (executor
        // torn down by a restart) but the persisted batch matches. Persist the
        // answer durably, clear the pending question (so the UI stops showing it
        // and it can't be double-submitted), and enqueue a resume task.
        if (!proc || pendingBatchId !== batchId) return false;
        return this.persistAndEnqueueAskUserResume(proc, batchId, answers);
    }

    /**
     * Convert a post-restart ask_user submission into a durable
     * `pendingAskUserAnswer` record, clear the live `pendingAskUser`, and
     * enqueue an ask_user-resume follow-up task. Returns false (→ 404) when the
     * submission does not validly answer the persisted batch.
     */
    private async persistAndEnqueueAskUserResume(
        proc: AIProcess,
        batchId: string,
        answers: AskUserAnswerInput[],
    ): Promise<boolean> {
        const record = buildPendingAskUserAnswerRecord(
            proc.pendingAskUser ?? [],
            batchId,
            answers,
            new Date().toISOString(),
        );
        if (!record) return false;
        if (!this.queueManager) return false;

        // Persist the durable answer and clear the live question atomically so a
        // further restart resumes from the durable record and the question can't
        // be re-submitted.
        await this.store.updateProcess(proc.id, {
            pendingAskUserAnswer: record,
            pendingAskUser: undefined,
        });

        this.enqueueAskUserResumeTask(proc);
        return true;
    }

    /** Enqueue (or re-enqueue) an ask_user-resume follow-up task for a process. */
    private enqueueAskUserResumeTask(proc: AIProcess): void {
        if (!this.queueManager) return;
        // Same task shape the startup re-enqueue routine builds, so submit-enqueue
        // and startup-re-enqueue behave identically. The placeholder prompt is
        // rebuilt from the durable pendingAskUserAnswer at execution time and is
        // never sent to the model.
        this.queueManager.enqueue(buildAskUserResumeTaskInput(proc));
    }

    /**
     * Resume a process whose durable `pendingAskUserAnswer` was persisted after
     * a restart. Rebuilds the synthesized answer message, appends it as a user
     * turn, and runs the follow-up against the persisted `sdkSessionId`. The
     * durable answer is consumed regardless of outcome so a further restart
     * can't re-enqueue an endless resume loop (AC-04/AC-05).
     */
    async resumePendingAskUser(processId: string): Promise<void> {
        const proc = await this.store.getProcess(processId);
        const pending = proc?.pendingAskUserAnswer;
        if (!proc || !pending) {
            // Idempotent: the durable answer was already consumed by a prior
            // resume (e.g. a duplicate re-enqueue). Nothing to do.
            return;
        }

        const synthesized = buildAskUserResumeMessage(pending);

        // Append the synthesized answer as a user turn so the conversation shows
        // continuity, and flip the process back to running.
        await this.store.appendConversationTurn(
            processId,
            (turnIndex) => ({
                role: 'user' as const,
                content: synthesized,
                timestamp: new Date(),
                turnIndex,
                timeline: [],
            }),
            { additionalUpdates: { status: 'running' } },
        );

        try {
            // executeFollowUp resumes via the persisted sdkSessionId and, on a
            // non-strict failure, marks the process failed without throwing.
            await this.executeFollowUp(processId, synthesized, undefined, 'ask');
        } finally {
            const after = await this.store.getProcess(processId);
            // Consume the durable answer in all cases. On failure, replace the
            // raw provider error with a clear "couldn't resume" message (AC-05).
            await this.store.updateProcess(processId, {
                pendingAskUserAnswer: undefined,
                ...(after?.status === 'failed' ? { error: ASK_USER_RESUME_FAILED_MESSAGE } : {}),
            });
        }
    }

    async executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: ChatMode, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', strictResumeSessionId?: string): Promise<void> {
        return this.executors.followUpExecutor.executeFollowUp(processId, message, attachments, mode, deliveryMode, images, selectedSkillNames, model, turnSource, reasoningEffort, strictResumeSessionId);
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
        const sessionProvider = proc.metadata?.provider === 'codex' || proc.metadata?.provider === 'claude' || proc.metadata?.provider === 'copilot'
            ? proc.metadata.provider
            : 'copilot';
        const resolvedModel = resolveModelForProvider(sessionProvider, nextMsg.model);
        if (resolvedModel.coerced) {
            getLogger().warn(
                LogCategory.AI,
                `[QueueExecutor] Dropping buffered model '${resolvedModel.requestedModel}' for process ${processId} because provider '${sessionProvider}' does not support it; using provider default.`,
            );
        }

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
                ...(resolvedModel.model ? { model: resolvedModel.model } : {}),
                ...(normalizeChatMode(nextMsg.mode) ? { mode: normalizeChatMode(nextMsg.mode) } : {}),
            }),
        );

        // Enqueue follow-up first — only remove pending message after success
        // to prevent data loss if enqueue fails. Per-turn reasoning-effort
        // (captured when the message was buffered) is carried through to the
        // replayed task so the follow-up executor honours it.
        const pendingEffort = (nextMsg as { reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }).reasoningEffort;
        // Merge any carried follow-up context (e.g. trigger turnSource) with the
        // skills context so an automated buffered message keeps its source tag.
        const drainedContext: Record<string, unknown> = {
            ...(nextMsg.context ?? {}),
            ...(nextMsg.skillNames && nextMsg.skillNames.length > 0 ? { skills: nextMsg.skillNames } : {}),
        };
        this.queueManager.enqueue({
            processId,
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat' as const,
                processId,
                prompt: nextMsg.content,
                ...(normalizeChatMode(nextMsg.mode) ? { mode: normalizeChatMode(nextMsg.mode) } : {}),
                ...(resolvedModel.model ? { model: resolvedModel.model } : {}),
                ...(pendingEffort ? { reasoningEffort: pendingEffort } : {}),
                ...(nextMsg.attachments ? { attachments: nextMsg.attachments } : {}),
                ...(nextMsg.imageTempDir ? { imageTempDir: nextMsg.imageTempDir } : {}),
                ...(nextMsg.images ? { images: nextMsg.images } : {}),
                ...(nextMsg.fileAttachmentMeta ? { fileAttachmentMeta: nextMsg.fileAttachmentMeta } : {}),
                ...(Object.keys(drainedContext).length > 0 ? { context: drainedContext } : {}),
            },
            config: pendingEffort ? { reasoningEffort: pendingEffort } : {},
            displayName: nextMsg.content.trim().substring(0, 57) + (nextMsg.content.trim().length > 57 ? '...' : ''),
        });
        await this.store.updateProcess(processId, { pendingMessages: rest });
    }
}

function getScheduleRunContext(context: ChatPayload['context'] | undefined): Record<string, unknown> | undefined {
    const scheduleContext: Record<string, unknown> = {};
    if (context?.scheduleId) scheduleContext.scheduleId = context.scheduleId;
    if (context?.scheduleRunId) scheduleContext.scheduleRunId = context.scheduleRunId;
    if (context?.scheduleParams) scheduleContext.scheduleParams = context.scheduleParams;
    return Object.keys(scheduleContext).length > 0 ? scheduleContext : undefined;
}

function getRalphCarryForwardContext(context: ChatPayload['context'] | undefined): Record<string, unknown> | undefined {
    const carryForward: Record<string, unknown> = {
        ...(getScheduleRunContext(context) ?? {}),
    };
    if (isAutoProviderRoutingRequested(context)) {
        carryForward.autoProviderRouting = context?.autoProviderRouting;
    }
    return Object.keys(carryForward).length > 0 ? carryForward : undefined;
}

function isAutoProviderRoutingRequested(context: ChatPayload['context'] | undefined): boolean {
    return context?.autoProviderRouting?.requested === true;
}

/**
 * Determines whether a task should use the exclusive (serial) limiter or the shared (concurrent) limiter.
 *
 * Concurrency model:
 * - `run-workflow` tasks (including work items) → **exclusive** — serialized 1-at-a-time per repo queue.
 *   Work items must never run concurrently within the same workspace.
 * - `chat` tasks with `ask` mode (e.g. coc-chat sessions) → **shared** — up to
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
