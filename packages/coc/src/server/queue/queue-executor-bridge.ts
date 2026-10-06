import type { ChatPayload, ChatMode, ChatProvider } from '../tasks/task-types';
import { isChatPayload, TaskDefs, getTaskDef, normalizeChatMode, resolveChatProviderOrDefault, VALID_CHAT_PROVIDERS } from '../tasks/task-types';
import { applyFollowUpToTask, truncateDisplayName } from '../shared/queue-utils';
import { processToQueuedTask } from '../shared/process-history-mapper';
import type { AIProcess, Attachment, ConversationTurn, ISDKService, ProcessStore, QueuedTask, QueueExecutor, StoredEffortTiersMap, TaskExecutionResult, TaskExecutor, TaskQueueManager, TurnSource } from '@plusplusoneplusplus/forge';
import { createQueueExecutor, DEFAULT_AI_TIMEOUT_MS, sdkServiceRegistry, SDK_PROVIDER_COPILOT, getLogger, LogCategory, normalizeExecutionPath, resolveModelForProvider, resolveWorkspaceExecutionContext, isQueueProcessId, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { processOperationAdmission } from '../processes/process-operation-admission';
import { compactProcess } from '../processes/compact-process';
import { pendingMessageTask } from '../processes/queued-pending-message';
import type { PendingMessage } from '@plusplusoneplusplus/forge';
import { BaseExecutor } from '../executors/base-executor';
import type { FollowUpTurnOptions } from '../executors/follow-up-executor';
import { resolveSkillConfig } from '../executors/skill-config-resolver';
import { TitleGenerationService } from '../executors/title-generator';
import { ExecutorRegistry } from '../executors/executor-registry';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { orchestrateRalphIteration } from '../ralph/orchestrate-iteration';
import { orchestrateFinalCheck } from '../ralph/orchestrate-final-check';
import { orchestrateSubmitCompletion } from '../ralph/orchestrate-submit';
import { getRalphTaskKind } from '../ralph/task-kind';
import { createFixedQueueRuntimeConfig } from './queue-runtime-config';
import type { QueueRuntimeConfig } from './queue-runtime-config';
import type { AutoProviderResolutionResult } from '../agent-providers/auto-provider-router';
import type { AskUserAnswerInput, AskUserAnswerValue } from '../llm-tools/ask-user-tool';
import { ASK_USER_RESUME_FAILED_MESSAGE, buildAskUserResumeMessage, buildPendingAskUserAnswerRecord } from '../llm-tools/ask-user-resume';
import { buildAskUserResumeTaskInput } from '../processes/resume-pending-ask-user-answers';
import type { DreamRunExecutor } from '../dreams/dream-runner';
import { EMPTY_EXECUTOR_RUNTIME } from '../executors/executor-runtime-contracts';
import type { ExecutorRuntimeCapabilities, InFlightTurn } from '../executors/executor-runtime-contracts';
import { readActiveProviderSession, resolveRecordedProvider, turnProviderAttribution } from '../processes/active-provider-session';
import { executeImplementPlanWithPrGate } from './implement-plan-pr-gate';

/**
 * Clone a final-check payload into a repair follow-up: same processId (so the
 * follow-up executor resumes the checker's conversation), same
 * `context.ralph.finalCheck` (so the result records under the same checkIndex),
 * plus the `repairTurn` marker the follow-up routing hook keys off.
 */
function withFinalCheckRepairFlag(
    payload: Record<string, unknown>,
    prompt: string,
    processId: string,
): Record<string, unknown> {
    const context = (payload.context ?? {}) as Record<string, unknown>;
    const ralph = (context.ralph ?? {}) as Record<string, unknown>;
    const finalCheck = (ralph.finalCheck ?? {}) as Record<string, unknown>;
    return {
        ...payload,
        prompt,
        processId,
        context: {
            ...context,
            ralph: { ...ralph, finalCheck: { ...finalCheck, repairTurn: true } },
        },
    };
}

export const DEFAULT_FOLLOW_UP_SUGGESTIONS = { enabled: true, count: 3 } as const;

export type ResolveDefaultProviderForExecution = (options?: { forceAuto?: boolean }) => Promise<AutoProviderResolutionResult>;

export type GetEffortTiersForProvider = (provider: import('../tasks/task-types').ChatProvider) => StoredEffortTiersMap | undefined;

export interface CLITaskExecutorOptions {
    approvePermissions?: boolean; workingDirectory?: string; dataDir?: string;
    aiService?: ISDKService;
    /**
     * Live configuration port for every queue-owned setting: execution
     * timeout, follow-up suggestions, Ask User, global skill folders, and the
     * Ralph final-check loop cap.
     *
     * The server composition layer backs this with the authoritative
     * `RuntimeConfigService`, so the queue reads the same config file the rest
     * of the server was started with. Callers that omit it get a fixed adapter
     * built from the three direct options below — never a disk read.
     */
    queueConfig?: QueueRuntimeConfig;
    /** Ignored when `queueConfig` is supplied. */
    defaultTimeoutMs?: number;
    /** Ignored when `queueConfig` is supplied. */
    followUpSuggestions?: { enabled: boolean; count: number };
    /** Ignored when `queueConfig` is supplied. */
    askUser?: { enabled: boolean };
    /** Default AI provider name recorded on new processes when the task has no provider override. */
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    /** Enables the gated multi-agent Ralph grilling prompt contract. */
    ralphMultiAgentGrillEnabled?: boolean;
    /** Resolve Auto provider routing when a queued chat task starts execution. */
    resolveDefaultProvider?: ResolveDefaultProviderForExecution;
    /** Live read of admin-configured effort tiers, for execution-time tier resolution. */
    getEffortTiersForProvider?: GetEffortTiersForProvider;
    onRalphSessionComplete?: (event: RalphSessionCompleteEvent) => void;
    dreamRunExecutor?: DreamRunExecutor;
    /**
     * Late-bound runtime capabilities assembled once by the server composition
     * layer (see `createQueueInfrastructure`).
     *
     * The bridge augments this object with the two capabilities it owns itself
     * — the shared abort registry and the Dreams runner accessor — and then
     * hands the result to {@link ExecutorRegistry} by identity. Nothing is
     * copied field by field, so a capability added to the contract cannot be
     * dropped at this hop.
     */
    runtime?: ExecutorRuntimeCapabilities;
}
export interface QueueExecutorBridgeOptions extends CLITaskExecutorOptions {
    maxConcurrency?: number; sharedConcurrency?: number; exclusiveConcurrency?: number;
    isExclusive?: (task: QueuedTask) => boolean; autoStart?: boolean;
    initialDelayMs?: number;
}
export interface QueueExecutorBridge {
    /** Recover the head of an idle conversation's durable buffer through its queue. */
    recoverPendingMessages?(workspaceId: string, processId: string): Promise<void>;
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', strictResumeSessionId?: string, options?: FollowUpTurnOptions): Promise<void>;
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
    /** Update the execution-time effort-tier resolver for existing bridges. */
    setEffortTiersForProvider?(getEffortTiersForProvider: GetEffortTiersForProvider): void;
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

/**
 * True when `candidate` sits inside `root`. Both sides go through
 * `normalizeExecutionPath`, which yields forward-slash (and WSL-aware) paths, so
 * a prefix test is safe here. Equal paths are not "under" — callers test
 * `pathsReferToSameWorkspace` first.
 */
function isUnder(root: string, candidate: string): boolean {
    const normalizedRoot = normalizeExecutionPath(root);
    const normalizedCandidate = normalizeExecutionPath(candidate);
    return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

export class CLITaskExecutor extends BaseExecutor implements TaskExecutor {
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;
    private readonly aiService: ISDKService;
    private queueManager?: TaskQueueManager;
    private queueExecutor?: QueueExecutor;
    private readonly executors: ExecutorRegistry;
    private readonly titleGenerationService: TitleGenerationService;
    /**
     * The capability object shared with the executor registry, held by
     * identity. Includes the bridge-owned `inFlightTurns` and
     * `getDreamRunExecutor`.
     */
    private readonly runtime: ExecutorRuntimeCapabilities;
    /**
     * The one configuration boundary for this executor. Every queue-owned
     * setting is read through it at the point the setting takes effect, so
     * nothing here reparses a config file on the execution hot path and
     * nothing resolves the default home-directory config behind the server's
     * back.
     */
    private readonly queueConfig: QueueRuntimeConfig;
    private readonly onRalphSessionComplete?: (event: RalphSessionCompleteEvent) => void;
    private resolveDefaultProvider?: ResolveDefaultProviderForExecution;
    private getEffortTiersForProvider?: GetEffortTiersForProvider;
    private dreamRunExecutor?: DreamRunExecutor;
    /**
     * In-flight turns registered by chat-mode executors when a turn starts.
     * Aborting one interrupts the in-flight `sendMessage` even when no
     * `sdkSessionId` has been persisted yet (early-turn cancel), and the
     * recorded provider names the provider actually running the turn.
     */
    private readonly inFlightTurns = new Map<string, InFlightTurn>();

    constructor(store: ProcessStore, options: CLITaskExecutorOptions = {}) {
        super(store, options.dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService ?? sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
        this.onRalphSessionComplete = options.onRalphSessionComplete;
        this.resolveDefaultProvider = options.resolveDefaultProvider;
        this.getEffortTiersForProvider = options.getEffortTiersForProvider;
        this.dreamRunExecutor = options.dreamRunExecutor;
        this.queueConfig = options.queueConfig ?? createFixedQueueRuntimeConfig({
            defaultTimeoutMs: options.defaultTimeoutMs,
            followUpSuggestions: options.followUpSuggestions ?? DEFAULT_FOLLOW_UP_SUGGESTIONS,
            askUser: options.askUser ?? { enabled: false },
        });
        // Extend the composed capability set with the two capabilities the
        // bridge itself owns. Spreading a typed object (rather than listing
        // members) keeps every capability from the composition layer intact.
        this.runtime = {
            ...(options.runtime ?? EMPTY_EXECUTOR_RUNTIME),
            getDreamRunExecutor: () => this.dreamRunExecutor,
            inFlightTurns: this.inFlightTurns,
        };
        this.titleGenerationService = new TitleGenerationService({
            store,
            aiService: this.aiService,
            defaultWorkingDirectory: this.defaultWorkingDirectory,
        });
        const skillCfg = (wsId: string | undefined, workDir?: string) => {
            // Live-read the configured global skill-folder settings so the
            // resolver honors `skills.globalExtraFolders` and
            // `skills.autoDetectDefaultFolders` at execution time.
            //
            // This reads the already-resolved snapshot rather than reparsing
            // YAML per task, so a malformed config surfaces once at load time
            // instead of silently degrading every execution to default folders.
            const skillFolders = this.queueConfig.getSkillFolders();
            return resolveSkillConfig(store, this.dataDir, wsId, workDir, {
                globalExtraFolders: skillFolders.globalExtraFolders,
                autoDetectDefaultFolders: skillFolders.autoDetectDefaultFolders,
            });
        };
        this.executors = new ExecutorRegistry(store, {
            // Static executor configuration…
            approvePermissions: this.approvePermissions,
            defaultWorkingDirectory: this.defaultWorkingDirectory,
            aiService: this.aiService,
            dataDir: this.dataDir,
            queueConfig: this.queueConfig,
            provider: options.provider,
            ralphMultiAgentGrillEnabled: options.ralphMultiAgentGrillEnabled,
            resolveSkillConfig: skillCfg,
            // …bridge-scoped dependencies…
            resolveWorkspaceIdForPath: (p: string) => this.resolveWorkspaceIdForPath(p),
            onTitleNeeded: (pid: string, turns: ConversationTurn[]) => this.generateTitleIfNeeded(pid, turns),
            cancelledTasks: this.cancelledTasks,
            // …and every late-bound capability, by identity.
            runtime: this.runtime,
        });
    }

    setQueueManager(qm: TaskQueueManager): void {
        this.queueManager = qm;
        this.titleGenerationService.setQueueManager(qm);
    }
    setQueueExecutor(qe: QueueExecutor): void { this.queueExecutor = qe; }
    setResolveDefaultProvider(resolveDefaultProvider: ResolveDefaultProviderForExecution): void {
        this.resolveDefaultProvider = resolveDefaultProvider;
    }
    setEffortTiersForProvider(getEffortTiersForProvider: GetEffortTiersForProvider): void {
        this.getEffortTiersForProvider = getEffortTiersForProvider;
    }
    setDreamRunExecutor(dreamRunExecutor: DreamRunExecutor): void {
        this.dreamRunExecutor = dreamRunExecutor;
    }
    private generateTitleIfNeeded(processId: string, turns: ConversationTurn[]): void { this.titleGenerationService.generateIfNeeded(processId, turns); }

    private getQueueExecutorForControl(method: string): QueueExecutor | undefined {
        if (this.queueManager && !this.queueExecutor) {
            throw new Error(`${method} cannot run before the queue executor is wired`);
        }
        return this.queueExecutor;
    }

    /**
     * True unless this bridge can prove the process belongs to a different repo.
     *
     * `getAskUserHandles(processId) === undefined` alone is ambiguous — it means
     * either "the server restarted and my resolvers were torn down" or "I am not
     * the bridge that owns this process" — and the ProcessStore is shared across
     * bridges, so a foreign bridge sees the same persisted `pendingAskUser`.
     * Ownership must therefore be confirmed separately.
     *
     * Deliberately permissive: a bridge with no configured root, or a process
     * with no recorded working directory, still claims (preserves the
     * single-bridge/CLI behavior). Only a positive mismatch disclaims.
     */
    private ownsProcess(proc: AIProcess): boolean {
        const procDir = (proc as { workingDirectory?: string }).workingDirectory;
        if (!this.defaultWorkingDirectory || !procDir) return true;
        if (pathsReferToSameWorkspace(this.defaultWorkingDirectory, procDir)) return true;
        // Nested-subdir tolerance: a process running in a subdirectory of this
        // bridge's root is still ours.
        return isUnder(this.defaultWorkingDirectory, procDir);
    }

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

        const kind = getRalphTaskKind(ralphCtx);

        // ── Route final-check completions separately ─────────────────────────
        if (kind === 'final-check') {
            await this.handleFinalCheckCompletion(processId, completedTask, responseText, ralphCtx, workspaceId, sessionId);
            return;
        }

        // ── PR-submit completions must never enqueue another iteration ───────
        if (kind === 'submit') {
            await this.handleSubmitCompletion(processId, completedTask, responseText, ralphCtx, workspaceId, sessionId);
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
                broadcastAwaitingInput: (params) => this.broadcastRalphAwaitingInput(params),
                processStore: this.store,
                workingDirectory: payload.workingDirectory,
                folderPath: (payload as any).folderPath,
                provider: isAutoProviderRoutingRequested(payload.context) ? undefined : (payload as any).provider,
                repoId: completedTask.repoId,
                existingPayloadContext: payload.context as Record<string, unknown>,
                existingTaskConfig: completedTask.config as Record<string, unknown>,
            },
        });
    }

    /** Broadcast a ralph-session-awaiting-input WS event. */
    private broadcastRalphAwaitingInput(params: {
        workspaceId: string;
        sessionId: string;
        processId: string;
        iteration: number;
    }): void {
        try {
            this.runtime.getWsServer?.()?.broadcastProcessEvent({
                type: 'ralph-session-awaiting-input',
                ...params,
            });
        } catch (err) {
            getLogger().debug(LogCategory.AI, `[Ralph] Failed to broadcast ralph-session-awaiting-input: ${err instanceof Error ? err.message : String(err)}`);
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
            this.runtime.getWsServer?.()?.broadcastProcessEvent({
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
     * Handle completion of a PR-submit task.
     * Parses the RALPH_SUBMIT_RESULT block and updates the persisted submit
     * record; never enqueues further work.
     */
    private async handleSubmitCompletion(
        processId: string,
        completedTask: QueuedTask,
        responseText: string,
        ralphCtx: any,
        workspaceId: string | undefined,
        sessionId: string | undefined,
    ): Promise<void> {
        if (!workspaceId || !sessionId || !this.dataDir) return;
        const logger = getLogger();
        const submitIndex: number = ralphCtx.submit?.submitIndex ?? 1;

        await orchestrateSubmitCompletion({
            workspaceId,
            sessionId,
            submitIndex,
            taskId: completedTask.id,
            processId,
            responseText,
            deps: { store: new RalphSessionStore({ dataDir: this.dataDir }) },
        }).catch(err => {
            logger.warn(LogCategory.AI, `[Ralph/Submit] orchestrateSubmitCompletion threw: ${err instanceof Error ? err.message : String(err)}`);
        });
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

        // Resolve the loop cap from the authoritative config port, snapshotted
        // once here so a mid-session admin edit cannot change the cap partway
        // through one final-check chain.
        const { maxGapFixLoops } = this.queueConfig.getRalphFinalCheckPolicy();

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
                existingTaskConfig: completedTask.config as Record<string, unknown>,
                repoId: completedTask.repoId,
                extraContext: getRalphCarryForwardContext((completedTask.payload as any).context),
                requestRepairTurn: (_taskId, prompt) => this.enqueueFinalCheckRepairTurn(completedTask, processId, prompt),
            },
        }).catch(err => {
            logger.warn(LogCategory.AI, `[Ralph/FinalCheck] orchestrateFinalCheck threw: ${err instanceof Error ? err.message : String(err)}`);
        });
    }

    /**
     * Queue one follow-up turn that re-asks the checker for its result block.
     *
     * `onRalphNext` fires from inside the executor, before the queue moves the
     * task to history, so `requeueFromHistory` cannot take here. Continuity does
     * not depend on task identity: the follow-up executor resumes a conversation
     * from `payload.processId`, so a fresh task carrying the same processId — and
     * the same `context.ralph.finalCheck` — lands in the same conversation with
     * the checker's findings still in context and routes back to
     * `handleFinalCheckCompletion` under the same `checkIndex`.
     */
    private enqueueFinalCheckRepairTurn(completedTask: QueuedTask, processId: string, prompt: string): boolean {
        if (!this.queueManager) return false;
        const logger = getLogger();
        try {
            this.queueManager.enqueue({
                processId,
                type: completedTask.type ?? 'chat',
                priority: 'normal',
                repoId: completedTask.repoId,
                folderPath: (completedTask as any).folderPath,
                config: (completedTask.config ?? {}) as any,
                // `mode: 'ralph'` and `context.ralph.finalCheck` must survive:
                // the first keeps the task ralph-routed, the second carries the
                // checkIndex the repaired result is recorded under.
                // `finalCheck.repairTurn` is what lets the follow-up path route
                // this completion back to handleFinalCheckCompletion.
                payload: withFinalCheckRepairFlag(completedTask.payload as Record<string, unknown>, prompt, processId),
                displayName: truncateDisplayName(`Ralph final check result repair (${processId})`),
            } as any);
            return true;
        } catch (err) {
            logger.warn(LogCategory.AI, `[Ralph/FinalCheck] Failed to enqueue repair turn for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
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
            if (task.payload.kind === 'compact') {
                const proc = await processOperationAdmission.runExclusive(task.processId!, async () => {
                    const current = await this.store.getProcess(task.processId!, task.payload.workspaceId as string | undefined);
                    if (!current) throw new Error('Conversation is unavailable');
                    if (current.metadata?.compaction?.taskId !== task.id || current.metadata.compaction.state !== 'queued') {
                        throw new Error('Compaction admission was not completed');
                    }
                    return current;
                });
                try {
                    // Later admitted messages are deferred queue tasks, not part of this operation's idle guard.
                    const outcome = await compactProcess(this.store, { ...proc, status: proc.status === 'queued' ? 'completed' : proc.status, pendingMessages: [] }, task.payload.customInstructions as string | undefined);
                    return { success: true, result: outcome.result, durationMs: 0 };
                } catch (error) {
                    const current = await this.store.getProcess(proc.id);
                    if (current?.metadata?.compaction?.state !== 'failed') {
                        await this.store.updateProcess(proc.id, { metadata: { ...current?.metadata!, compaction: {
                            ...proc.metadata!.compaction!, state: 'failed', completedAt: new Date().toISOString(),
                            error: error instanceof Error ? error.message : String(error),
                        } } });
                    }
                    return { success: false, error: error instanceof Error ? error : new Error(String(error)), durationMs: 0 };
                } finally {
                    await this.drainPendingMessages(proc.id, task.id);
                }
            }
            const deferred = task.payload.deferredMessage as PendingMessage | undefined;
            if (deferred && task.processId) {
                const shouldExecute = await processOperationAdmission.runExclusive(task.processId, async () => {
                    const proc = await this.store.getProcess(task.processId!);
                    if (!proc) throw new Error('Conversation is unavailable');
                    const requestId = deferred.relayRequestId ?? `pending:${deferred.id}`;
                    const existing = proc.conversationTurns?.find(turn => turn.role === 'user' && turn.relayRequestId === requestId);
                    if (!existing && !proc.pendingMessages?.some(message => message.id === deferred.id)) return false;
                    if (existing) {
                        task.payload.historyCutoffTurnIndex = existing.turnIndex;
                        await this.store.removePendingMessage(proc.id, deferred.id);
                    } else {
                        const binding = readActiveProviderSession(proc);
                        const model = resolveModelForProvider(resolveChatProviderOrDefault(deferred.provider ?? proc.metadata?.provider), deferred.model).model;
                        const source = deferred.context?.source;
                        const appended = await this.store.appendConversationTurn(proc.id, index => ({
                            role: 'user', content: deferred.displayContent ?? deferred.content,
                            timestamp: new Date(deferred.createdAt), turnIndex: index, timeline: [],
                            relayRequestId: requestId, images: deferred.images,
                            ...(deferred.pasteExternalized ? { pasteExternalized: true } : {}),
                            ...(model ? { model } : {}),
                            ...(deferred.mode ? { mode: normalizeChatMode(deferred.mode) } : {}),
                            ...(['cron', 'wakeup', 'trigger'].includes(String(source)) ? { turnSource: deferred.context as unknown as TurnSource } : {}),
                            ...turnProviderAttribution(deferred.provider, deferred.provider === binding.provider ? binding.segmentId : undefined),
                        }), { additionalUpdates: current => ({ pendingMessages: current.pendingMessages?.filter(message => message.id !== deferred.id) }) });
                        task.payload.historyCutoffTurnIndex = appended?.turn.turnIndex;
                    }
                    // Correlation also makes restart replay reuse the already persisted user turn.
                    task.payload.relayRequestId = requestId;
                    return true;
                });
                if (!shouldExecute) return { success: true, result: 'Pending message removed', durationMs: 0 };
            }
            const runTask = () => this.executors.runner.run(task, {
                cancelledTasks: this.cancelledTasks,
                executeFollowUpFn: (pid, msg, att, mode, dm, imgs, skills, mdl, ts, re, strictResumeSessionId, options) => this.executeFollowUp(pid, msg, att, mode as ChatMode | undefined, dm, imgs, skills, mdl, ts, re, strictResumeSessionId, options),
                resumePendingAskUserFn: (pid) => this.resumePendingAskUser(pid),
                executeByTypeFn: (t, p) => this.executors.dispatch(t, p),
                getWorkingDirectoryFn: (t) => this.executors.getWorkingDirectory(t),
                resolveDefaultProvider: this.resolveDefaultProvider,
                getEffortTiersForProvider: this.getEffortTiersForProvider,
                onDrainPendingMessages: (processId, taskId) => this.drainPendingMessages(processId, taskId),
                onRalphNext: (processId, completedTask, responseText) => this.enqueueRalphNextIteration(processId, completedTask, responseText),
                onCronTickComplete: (cronId, success) => {
                    const infra = this.runtime.getCronInfra?.();
                    if (!infra) return;
                    return infra.executor.onTickComplete(cronId, success);
                },
                onTriggerActionComplete: (triggerId, success) => {
                    const infra = this.runtime.getTriggerInfra?.();
                    if (!infra) return;
                    return infra.manager.onActionComplete(triggerId, success);
                },
            });
            const result = await executeImplementPlanWithPrGate({
                task,
                queueManager: this.queueManager,
                workingDirectory: this.executors.getWorkingDirectory(task),
                processStore: this.store,
                execute: runTask,
            });
            await this.settleInterruptedRalphIteration(task, result).catch(error => {
                getLogger().warn(LogCategory.AI, `[Ralph] Failed to persist interrupted iteration outcome: ${error instanceof Error ? error.message : String(error)}`);
            });
            return result;
        } finally {
            this.cancelledTasks.delete(task.id);
        }
    }

    /** Failed/cancelled execution does not pass through the successful iteration orchestrator. */
    private async settleInterruptedRalphIteration(task: QueuedTask, result: TaskExecutionResult): Promise<void> {
        const payload = task.payload as unknown as ChatPayload;
        const ctx = payload.context?.ralph;
        // Follow-ups, checks/repair, submit and grilling have their own lifecycle.
        if (task.type !== 'chat' || payload.mode !== 'ralph' || payload.processId
            || !ctx?.sessionId || getRalphTaskKind(ctx) !== 'iteration' || ctx.phase === 'grilling'
            || !payload.workspaceId || !this.dataDir) return;
        const processId = task.processId ?? toQueueProcessId(task.id);
        const process = await this.store.getProcess(processId, payload.workspaceId);
        const cancelled = this.cancelledTasks.has(task.id)
            || (process?.metadata?.workspaceId === payload.workspaceId && process.status === 'cancelled');
        if (result.success && !cancelled) return;
        const journal = new RalphSessionStore({ dataDir: this.dataDir });
        const session = await journal.readSessionRecord(payload.workspaceId, ctx.sessionId);
        // A late step result cannot end a paused or explicitly stopped session.
        if (session?.phase === 'awaiting-input' || session?.phase === 'grilling'
            || session?.terminalReason === 'USER_STOPPED'
            || (session && session.currentIteration > (ctx.currentIteration ?? 1))) return;
        const record = await journal.recordCompletion(payload.workspaceId, ctx.sessionId, {
            reason: cancelled ? 'user-stopped' : 'iteration-failed',
            processId, totalIterations: ctx.currentIteration ?? 1,
            completedAt: new Date().toISOString(),
        });
        const completion = record.completion!;
        this.broadcastRalphSessionComplete(payload.workspaceId, ctx.sessionId, completion.processId,
            completion.totalIterations, completion.reason);
    }

    cancel(taskId: string): void {
        this.cancelledTasks.add(taskId);
        // Abort the in-flight sendMessage turn (if any) so cancellation does
        // not depend on an sdkSessionId lookup. Follow-up tasks may carry an
        // auto-generated id that does not map back to a process id; that path
        // is covered by cancelProcess() aborting by process id directly.
        this.inFlightTurns.get(toQueueProcessId(taskId))?.controller.abort();
    }

    /**
     * Resolve the ISDKService for a provider so cancel/steer reach the same
     * service that ran the turn (codex/claude/opencode), not just the server
     * default. Falls back to the default aiService when the provider is
     * missing, the resolver is absent, or the resolver rejects the provider
     * (e.g. disabled mid-turn) — a best-effort abort against the default beats
     * doing nothing.
     */
    private getAiServiceForProvider(provider: string | undefined): ISDKService {
        if (provider && VALID_CHAT_PROVIDERS.has(provider as ChatProvider) && this.runtime.resolveAiServiceForProvider) {
            try {
                return this.runtime.resolveAiServiceForProvider(provider as ChatProvider);
            } catch (err) {
                getLogger().debug(LogCategory.AI, `[Bridge] Falling back to default aiService for provider '${provider}': ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return this.aiService;
    }

    async cancelProcess(processId: string): Promise<void> {
        const taskId = isQueueProcessId(processId) ? toTaskId(processId) : undefined;
        // Route through QueueExecutor so both cancelledTasks sets are updated
        // and the queue slot is freed once the SDK abort propagates
        const queueExecutor = this.getQueueExecutorForControl('cancelProcess');
        if (queueExecutor && taskId) {
            queueExecutor.cancelTask(taskId);
        } else if (taskId) {
            this.cancelledTasks.add(taskId);
        }
        // Abort by process id as well: covers turns whose queue task id is
        // auto-generated (follow-up requeues) and turns that have not yet
        // persisted an sdkSessionId.
        this.inFlightTurns.get(processId)?.controller.abort();
        try {
            const proc = await this.store.getProcess(processId);
            if (!proc) return;
            // The in-flight provider wins over the persisted binding: during a
            // cross-provider switch the binding still names the outgoing
            // provider until the target reports a session id. In that window
            // the persisted session id belongs to the *other* provider, so it
            // is not sent anywhere — the AbortController above is the stop.
            const binding = readActiveProviderSession(proc);
            const inFlight = this.inFlightTurns.get(processId);
            const provider = inFlight?.provider ?? resolveRecordedProvider(proc);
            const sessionId = !inFlight || inFlight.provider === binding.provider ? binding.sessionId : undefined;
            if (sessionId) { await this.getAiServiceForProvider(provider).softAbortSession(sessionId); }
        } catch (err) {
            getLogger().debug(LogCategory.AI, `[Bridge] Failed to abort SDK session for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
            throw err;
        }
    }

    async isSessionAlive(_processId: string): Promise<boolean> { return true; }

    async steerProcess(processId: string, message: string): Promise<boolean> {
        try {
            const proc = await this.store.getProcess(processId);
            if (!proc) return false;
            if (proc.metadata?.compaction?.state === 'queued' || proc.metadata?.compaction?.state === 'running') return false;
            if (this.queueManager?.getAll().some(task => task.processId === processId
                && task.payload.kind === 'compact' && ['queued', 'running'].includes(task.status))) return false;
            const binding = readActiveProviderSession(proc);
            if (!binding.sessionId) return false;
            // SDK steering targets the already-running session; it cannot change
            // that live session's custom tool registry. Steering stays
            // same-provider, so the binding is the right pair to use.
            return await this.getAiServiceForProvider(resolveRecordedProvider(proc)).steerSession(binding.sessionId, message);
        } catch (err) {
            getLogger().debug(LogCategory.AI, `[Bridge] Failed to steer session for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    async answerAskUserQuestion(processId: string, questionId: string, answer: AskUserAnswerValue): Promise<boolean> {
        const handles = this.executors.getAskUserHandles(processId);
        if (!handles) return false;
        const proc = await this.store.getProcess(processId);
        if (proc && !this.ownsProcess(proc)) return false;
        const resolved = handles.answerQuestion(questionId, answer);
        if (resolved) {
            await this.store.updateProcess(processId, { pendingAskUser: undefined });
        }
        return resolved;
    }

    async skipAskUserQuestion(processId: string, questionId: string): Promise<boolean> {
        const handles = this.executors.getAskUserHandles(processId);
        if (!handles) return false;
        const proc = await this.store.getProcess(processId);
        if (proc && !this.ownsProcess(proc)) return false;
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
        //
        // `pendingAskUser` is persisted in the shared ProcessStore, so a bridge
        // for a *different* repo sees a matching batch too. Without the
        // ownership test it would claim the answer and enqueue the resume onto
        // its own queue — the answer would surface under the wrong workspace
        // while the genuinely waiting turn hung forever.
        if (!proc || pendingBatchId !== batchId) return false;
        if (!this.ownsProcess(proc)) return false;
        return this.persistAndEnqueueAskUserResume(proc, batchId, answers);
    }

    /**
     * Convert a post-restart ask_user submission into a durable
     * `pendingAskUserAnswer` record, clear the live `pendingAskUser`, and
     * enqueue an ask_user-resume follow-up task. Returns false (→ 404) when the
     * submission does not validly answer the persisted batch.
     *
     * Precondition: the caller has confirmed this bridge owns `proc`
     * (see `ownsProcess`). The resume task is enqueued onto *this* bridge's
     * queue, so calling it from a foreign bridge runs the resumed turn under the
     * wrong repo.
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

    async executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: ChatMode, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', strictResumeSessionId?: string, options?: FollowUpTurnOptions): Promise<void> {
        return this.executors.followUpExecutor.executeFollowUp(processId, message, attachments, mode, deliveryMode, images, selectedSkillNames, model, turnSource, reasoningEffort, strictResumeSessionId, options);
    }

    /** Recover buffered work only when the recorded parent is idle and can continue. */
    async recoverPendingMessages(workspaceId: string, processId: string): Promise<void> {
        await processOperationAdmission.runExclusive(processId, async () => {
            const proc = await this.store.getProcess(processId);
            if (!proc || proc.metadata?.workspaceId !== workspaceId || !this.queueManager
                || !['completed', 'failed'].includes(proc.status)
                || proc.pendingAskUser?.length || proc.pendingAskUserAnswer) return;
            // Queue state wins over a stale terminal process snapshot. Recovery
            // admits only the head; subsequent turns use the normal lifecycle drain.
            if (this.queueManager.getAll().some(task => task.processId === processId
                && ['queued', 'running', 'cancelling'].includes(task.status))) return;
            // Terminal receipts may remain buffered after a failed removal.
            // Reconcile those first, stopping as soon as one live task exists.
            for (let remaining = proc.pendingMessages?.length ?? 0; remaining > 0; remaining--) {
                await this.drainPendingMessageAdmitted(processId);
                if (this.queueManager.getAll().some(task => task.processId === processId
                    && ['queued', 'running', 'cancelling'].includes(task.status))) break;
            }
        });
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
        await processOperationAdmission.runExclusive(processId, () => this.drainPendingMessageAdmitted(processId));
    }

    private async drainPendingMessageAdmitted(processId: string): Promise<void> {
        const proc = await this.store.getProcess(processId);
        if (!proc?.pendingMessages?.length) return;
        if (!this.queueManager) return;
        const nextMsg = proc.pendingMessages[0];
        // Server-owned reviews use the receipt as both pending-message and task
        // ID. Reconcile a crash after enqueue but before pending-message removal.
        const receiptId = nextMsg.id === nextMsg.relayRequestId ? nextMsg.id : undefined;
        const accepted = receiptId ? this.queueManager.getTask(receiptId) : undefined;
        if (accepted) {
            if (accepted.processId !== processId || accepted.payload.relayRequestId !== receiptId
                || accepted.payload.workspaceId !== proc.metadata?.workspaceId) {
                throw new Error('Pending review receipt conflicts with another queue task');
            }
            await this.store.removePendingMessage(processId, nextMsg.id);
            return;
        }
        const deferred = pendingMessageTask(proc, nextMsg);
        if (this.queueManager.getTask(deferred.id!)) return;
        if (proc.metadata?.compaction?.state === 'queued' || proc.metadata?.compaction?.state === 'running'
            || this.queueManager.getAll?.().some(task => task.processId === processId
                && task.payload.kind === 'compact' && ['queued', 'running'].includes(task.status))) {
            this.queueManager.enqueue(deferred);
            return;
        }
        // The provider captured on the message wins over the conversation's
        // current metadata: a message accepted for one provider must drain on
        // that provider even if the conversation moved on in the meantime.
        const sessionProvider = resolveChatProviderOrDefault(
            nextMsg.provider ?? proc.metadata?.provider,
        );
        const binding = readActiveProviderSession(proc);
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
        const existingUserTurn = receiptId ? proc.conversationTurns?.find(turn => turn.role === 'user'
            && turn.relayRequestId === receiptId) : undefined;
        const appendedUserTurn = existingUserTurn ? { turn: existingUserTurn } : await this.store.appendConversationTurn(
            processId,
            (turnIndex) => ({
                role: 'user' as const,
                content: turnContent,
                timestamp: new Date(nextMsg.createdAt),
                turnIndex,
                ...(nextMsg.relayRequestId !== undefined ? { relayRequestId: nextMsg.relayRequestId } : {}),
                timeline: [],
                ...(nextMsg.images ? { images: nextMsg.images } : {}),
                ...(nextMsg.pasteExternalized ? { pasteExternalized: true } : {}),
                ...(resolvedModel.model ? { model: resolvedModel.model } : {}),
                ...(normalizeChatMode(nextMsg.mode) ? { mode: normalizeChatMode(nextMsg.mode) } : {}),
                // Attribute the turn to the provider the message was accepted
                // for. A message buffered before provider routing existed has
                // none; leave it unattributed rather than guessing from the
                // conversation's current metadata. Buffering is same-provider
                // only, so a matching provider means the turn belongs to the
                // segment that is already active.
                ...turnProviderAttribution(
                    nextMsg.provider,
                    nextMsg.provider === binding.provider ? binding.segmentId : undefined,
                ),
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
        try {
            this.queueManager.enqueue({
                ...(receiptId ? { id: receiptId } : {}),
                processId,
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat' as const,
                    processId,
                    ...(proc.metadata?.workspaceId ? { workspaceId: proc.metadata.workspaceId } : {}),
                    prompt: nextMsg.content,
                    ...(nextMsg.relayRequestId ? { relayRequestId: nextMsg.relayRequestId } : {}),
                    ...(normalizeChatMode(nextMsg.mode) ? { mode: normalizeChatMode(nextMsg.mode) } : {}),
                    ...(resolvedModel.model ? { model: resolvedModel.model } : {}),
                    ...(nextMsg.provider ? { provider: nextMsg.provider } : {}),
                    // Cutoff for a reconstructed continuation: the index the
                    // deferred user turn just landed on, so history is quoted
                    // strictly before the message being drained.
                    ...(appendedUserTurn ? { historyCutoffTurnIndex: appendedUserTurn.turn.turnIndex } : {}),
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
        } catch (error) {
            const admitted = receiptId ? this.queueManager.getTask(receiptId) : undefined;
            if (!admitted || admitted.processId !== processId || admitted.payload.relayRequestId !== receiptId
                || admitted.payload.workspaceId !== proc.metadata?.workspaceId) throw error;
        }
        await this.store.removePendingMessage(processId, nextMsg.id);
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
    if (task.payload.kind === 'compact') return false;
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
    const shouldAutoStart = options.autoStart !== false;
    const executor = createQueueExecutor(queueManager, bridge, {
        sharedConcurrency: options.sharedConcurrency ?? 5,
        exclusiveConcurrency: options.exclusiveConcurrency ?? 1,
        isExclusive: options.isExclusive ?? defaultIsExclusive,
        autoStart: false,
        initialDelayMs: options.initialDelayMs,
    });
    bridge.setQueueExecutor(executor);
    if (shouldAutoStart) {
        executor.start();
    }
    return { executor, bridge };
}
