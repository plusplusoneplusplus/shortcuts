/**
 * Follow-Up Executor
 *
 * Concrete executor that owns follow-up message dispatching: sending a follow-up
 * message to an in-progress or completed process, streaming the AI response back,
 * appending the assistant turn to conversationTurns, and updating process status.
 *
 * Extends ChatBaseExecutor for shared chat-mode helpers and streaming plumbing.
 * Must NOT create new processes — it appends to an existing one.
 */

import * as os from 'os';
import * as path from 'path';
import type {
    AgentMode,
    Attachment,
    AIProcess,
    AutoFolderContext,
    ConversationTurn,
    DeliveryMode,
    ModelInfo,
    ProcessStore,
    QueuedTask,
    SDKInvocationResult,
    SystemMessageConfig,
    TurnSource,
} from '@plusplusoneplusplus/forge';
import type { ReasoningEffort } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ChatMode, ChatProvider } from '../tasks/task-types';
import {
    getForEachContext,
    getMapReduceContext,
    isForEachGenerationContext,
    isMapReduceGenerationContext,
    normalizeChatModeOrDefault,
    STOPPED_CHAT_STRICT_RESUME_FAILED_MESSAGE,
    STOPPED_CHAT_STRICT_RESUME_FAILED_REASON,
} from '../tasks/task-types';
import {
    approveAllPermissions,
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    resolveModelForProvider,
    resolveReasoningSelection,
} from '@plusplusoneplusplus/forge';
import {
    buildConversationHistoryContext,
    prependSelectedSkillsDirective,
    resolveSelectedSkillReferences,
} from './prompt-builder';
import { readNoteContent } from './note-chat-executor';
import { emitMessageSteering } from '../streaming/sse-handler';
import { buildChatTurnSystemMessage } from './chat-turn-system-message';
import { resolveChatTurnPolicy } from './chat-turn-policy-resolver';
import {
    buildCumulativeTokenUsage,
    buildSessionTokenUpdates,
    captureNoteEditSnapshot,
    emitTurnTokenUsage,
} from './chat-turn-settlement';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { computeAssistantResponseOrdinal } from './turn-performance-tracker';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { buildChatTurnContext } from './chat-turn-context-builder';
import type { ChatTurnContext } from './chat-turn-context-builder';
import { resolveChatMcpServersForWorkspace } from './mcp-tool-enforcement';
import { updateForEachGenerationMetadataFromAssistantTurn } from '../for-each/for-each-generation-metadata';
import { updateMapReduceGenerationMetadataFromAssistantTurn } from '../map-reduce/map-reduce-generation-metadata';
// ============================================================================
// Types
// ============================================================================

/** Log prefix for every line this executor writes. */
const FOLLOW_UP_LOG_LABEL = '[FollowUp]';

/** Map CoC ChatMode to SDK AgentMode for protocol-level enforcement. */
const CHAT_MODE_TO_AGENT_MODE: Record<ChatMode, AgentMode> = {
    ask: 'interactive',
    autopilot: 'autopilot',
    ralph: 'autopilot',
};

const KNOWN_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const satisfies readonly ReasoningEffort[];

function toAgentMode(chatMode: ChatMode | undefined): AgentMode | undefined {
    return chatMode ? CHAT_MODE_TO_AGENT_MODE[chatMode] : undefined;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
    return typeof value === 'string' && (KNOWN_REASONING_EFFORTS as readonly string[]).includes(value);
}

function normalizeReasoningEffortList(values: readonly unknown[] | undefined): ReasoningEffort[] | undefined {
    if (!values) {
        return undefined;
    }

    const normalized: ReasoningEffort[] = [];
    for (const value of values) {
        if (isReasoningEffort(value) && !normalized.includes(value)) {
            normalized.push(value);
        }
    }
    return normalized;
}

function getSupportedReasoningEfforts(model: ModelInfo | undefined): ReasoningEffort[] | undefined {
    if (!model) {
        return undefined;
    }

    const rawCapabilityEfforts = normalizeReasoningEffortList(model.capabilities?.supports?.reasoning_effort);
    if (rawCapabilityEfforts) {
        return rawCapabilityEfforts;
    }

    const contractEfforts = normalizeReasoningEffortList(model.supportedReasoningEfforts);
    if (contractEfforts) {
        return contractEfforts;
    }

    if (model.capabilities?.supports?.reasoningEffort === false) {
        return [];
    }

    return undefined;
}

function formatSupportedReasoningEfforts(model: ModelInfo | undefined): string {
    const supportedEfforts = getSupportedReasoningEfforts(model);
    if (supportedEfforts === undefined) {
        return 'unknown';
    }
    return supportedEfforts.length > 0 ? supportedEfforts.join(', ') : 'none';
}

/**
 * Recover from an unsupported reasoning effort on a follow-up turn.
 *
 * A follow-up is the one path that can carry a per-turn effort override from
 * the EffortPillSelector. When the resolved model rejects exactly that
 * override, drop the effort and run the turn on the model anyway — the user
 * asked for a model *and* an effort, and the model is the load-bearing half.
 * Any other failure (e.g. a persisted preference the model rejects) is
 * re-thrown so it surfaces instead of being silently downgraded.
 */
function resolveFollowUpReasoningSelection(options: {
    err: unknown;
    processId: string;
    sessionProvider: ChatProvider;
    reasoningModel: string | undefined;
    requestedEffort: Parameters<typeof resolveReasoningSelection>[0]['requestedEffort'];
    perTurnReasoningEffort: ReasoningEffort | undefined;
    modelMetadata: ModelInfo | undefined;
    logger: ReturnType<typeof getLogger>;
}): ReturnType<typeof resolveReasoningSelection> {
    const { err, processId, sessionProvider, reasoningModel, requestedEffort, perTurnReasoningEffort, modelMetadata, logger } = options;
    if (!perTurnReasoningEffort || requestedEffort !== perTurnReasoningEffort || !isReasoningEffort(perTurnReasoningEffort)) {
        throw err;
    }

    logger.warn(
        LogCategory.AI,
        `[FollowUp] Omitting reasoning effort '${perTurnReasoningEffort}' for process ${processId} because provider '${sessionProvider}' model '${reasoningModel ?? 'provider-default'}' does not support it. Supported efforts: ${formatSupportedReasoningEfforts(modelMetadata)}.`,
    );
    return { modelId: reasoningModel };
}

export interface FollowUpExecutorOptions extends ChatModeExecutorOptions {
    /** Fire-and-forget title generation callback (optional) */
    onTitleNeeded?: (processId: string, turns: ConversationTurn[]) => void;
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

// ============================================================================
// FollowUpExecutor
// ============================================================================

export class FollowUpExecutor extends ChatBaseExecutor {
    private readonly onTitleNeeded?: (processId: string, turns: ConversationTurn[]) => void;
    private readonly getWsServerFn?: () => ProcessWebSocketServer | undefined;

    constructor(store: ProcessStore, options: FollowUpExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
        this.onTitleNeeded = options.onTitleNeeded;
        this.getWsServerFn = options.getWsServer;
    }

    /**
     * Follow-ups are the interactive continuation of any conversation (manual,
     * queued, autopilot, ralph, note/commit chat). They are the primary
     * beneficiary of warm reuse — the next turn after a follow-up reuses the live
     * client — so keep the client warm.
     */
    protected override keepClientWarm(): boolean {
        return true;
    }

    protected async buildModeOptions(
        _task: QueuedTask,
        _prompt: string,
        _workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        throw new Error('FollowUpExecutor executes existing processes via executeFollowUp');
    }

    /**
     * Execute a follow-up message on an existing process's SDK session.
     *
     * Flow:
     * 1. Look up process → get sdkSessionId
     * 2. Send follow-up via aiService.sendMessage (optionally resuming session)
     * 3. Stream chunks via store.emitProcessOutput()
     * 4. On completion, append assistant turn to conversationTurns
     * 5. Update process status back to 'completed'
     */
    async executeFollowUp(
        processId: string,
        message: string,
        attachments?: Attachment[],
        mode?: ChatMode | string,
        deliveryMode?: string,
        images?: string[],
        selectedSkillNames?: string[],
        model?: string,
        turnSource?: TurnSource,
        /**
         * Per-turn reasoning-effort override. Takes priority over the
         * persisted per-model preference. If the final model does not support
         * this per-turn effort, the effort is omitted and the follow-up
         * continues with the resolved model.
         */
        reasoningEffort?: ReasoningEffort,
        /**
         * Strict stopped-chat continuation target. When provided, this exact
         * SDK session must be resumed and provider fallback to a new session is
         * treated as a failed follow-up.
         */
        strictResumeSessionId?: string,
    ): Promise<void> {
        const logger = getLogger();
        const startTime = Date.now();

        logger.debug(LogCategory.AI, `[FollowUp] Starting follow-up for process ${processId}`);

        const process = await this.store.getProcess(processId);
        if (!process) {
            throw new Error(`Process not found: ${processId}`);
        }

        // AC-04 — Use the original chat's provider for follow-ups.
        // Read provider from process metadata (set at creation time). Processes
        // created before this feature had no provider metadata; default to 'copilot'.
        const sessionProvider: ChatProvider = ((process.metadata?.provider as string | undefined) ?? 'copilot') as ChatProvider;

        // Resolve the AI service for this provider. This also checks that the
        // provider is still enabled — if not, it throws a clear error that blocks
        // the new follow-up turn without affecting already-running turns.
        const followUpAiService = this.getAiServiceForProvider(sessionProvider);

        const workingDirectory = process.workingDirectory || this.defaultWorkingDirectory;

        const previousMode = normalizeChatModeOrDefault(process.metadata?.mode);
        let currentMode: ChatMode;
        if (mode) {
            currentMode = normalizeChatModeOrDefault(mode);
        } else {
            // Fail-loud: every enqueue site should resolve mode via
            // resolveFollowUpMode() before reaching the executor. Falling
            // through here means an enqueuer forgot to populate payload.mode.
            logger.warn(
                LogCategory.AI,
                `[FollowUp] mode not provided for process ${processId}; defaulting to 'ask'. ` +
                `This indicates a bug in the enqueue site — every follow-up enqueuer must resolve mode via resolveFollowUpMode().`,
            );
            currentMode = 'ask';
        }

        const processModel = typeof process.metadata?.model === 'string' ? process.metadata.model : undefined;
        const providerModel = resolveModelForProvider(sessionProvider, model ?? processModel);
        if (providerModel.coerced) {
            logger.warn(
                LogCategory.AI,
                `[FollowUp] Dropping model '${providerModel.requestedModel}' for process ${processId} because provider '${sessionProvider}' does not support it; using provider default.`,
            );
        }

        const metadataUpdates: Record<string, unknown> = {};
        if (mode && mode !== previousMode) {
            metadataUpdates.previousMode = previousMode;
            metadataUpdates.mode = currentMode;
        }
        if ((model || processModel) && providerModel.model !== process.metadata?.model) {
            metadataUpdates.model = providerModel.model;
        }
        if (Object.keys(metadataUpdates).length > 0) {
            await this.store.updateProcess(processId, {
                metadata: {
                    type: process.metadata?.type ?? 'chat',
                    ...(process.metadata ?? {}),
                    ...metadataUpdates,
                },
            });
        }

        let autoFolderContextForFollowUp: AutoFolderContext | undefined;
        const wsId = (process.metadata?.workspaceId as string) ?? (workingDirectory ? await this.resolveWorkspaceIdForPathFn(workingDirectory) : undefined);
        if (workingDirectory) {
            autoFolderContextForFollowUp = await this.buildAutoFolderContext(
                workingDirectory,
                wsId,
                'ask',
            );
        }
        const notePath = process.metadata?.notePath as string | undefined;
        const forEachGeneration = (() => {
            const context = getForEachContext({ metadata: process.metadata });
            return isForEachGenerationContext(context) ? context : null;
        })();
        const mapReduceGeneration = (() => {
            const context = getMapReduceContext({ metadata: process.metadata });
            return isMapReduceGenerationContext(context) ? context : null;
        })();

        // Capture pre-edit note content for snapshot (note-chat follow-ups only)
        let preEditContent: string | undefined;
        if (notePath && wsId) {
            const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
            preEditContent = await readNoteContent(effectiveDataDir, wsId, notePath);
        }

        const { skillDirectories, disabledSkills } = await this.resolveSkillConfigFn(wsId, workingDirectory);

        const sessionIdForSend = strictResumeSessionId ?? process.sdkSessionId;
        const canResumeSession = !!sessionIdForSend;

        const historyContext = canResumeSession
            ? undefined
            : buildConversationHistoryContext(process.conversationTurns);

        this.resetSessionStreamingState(processId);
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        // Start TTFT/TPS timing before any streaming can begin; the first
        // output chunk is stamped by appendOutputChunk via the tracker.
        this.turnPerformance.begin(processId);

        // Metric turn index: 0-based assistant-response ordinal (never 0 on a
        // follow-up — the first response of a new session settles in
        // ChatBaseExecutor.execute). Counted from the pre-turn snapshot so the
        // success and error settles agree.
        const turnPerformanceOrdinal = computeAssistantResponseOrdinal(process.conversationTurns);

        let chatCtx: ChatTurnContext | undefined;

        const turnAbort = this.registerTurnAbortController(processId);
        try {
            if (strictResumeSessionId) {
                if (!process.sdkSessionId) {
                    throw new Error('Cannot continue this stopped chat because no SDK session was saved.');
                }
                if (process.sdkSessionId !== strictResumeSessionId) {
                    throw new Error('Cannot continue this stopped chat because the saved SDK session changed before execution.');
                }
            }

            // User turn is already persisted by the POST /message route handler
            // (atomically with the status: 'running' update) so the executor
            // only needs to handle the AI call and assistant turn.
            //
            // Exception: cron/wakeup-triggered follow-ups have no POST /message
            // route — the user turn must be created here.
            if (turnSource) {
                await this.store.appendConversationTurn(
                    processId,
                    (idx) => ({
                        role: 'user' as const,
                        content: message,
                        timestamp: new Date(),
                        turnIndex: idx,
                        timeline: [],
                        turnSource,
                    }),
                    { additionalUpdates: { status: 'running' } },
                );
            }

            const cronDeps = this.buildCronToolDeps(processId);
            chatCtx = await buildChatTurnContext({
                dataDir: this.dataDir,
                store: this.store,
                workspaceId: wsId,
                processId,
                query: message,
                followUpSuggestions: this.followUpSuggestions,
                enqueueChat: this.getEnqueueChat?.(),
                sendMessage: this.getSendMessage?.(),
                sendToConversationRuntime: this.getSendToConversationRuntime?.(),
                scheduleWakeup: cronDeps.scheduleWakeup,
                cronTools: cronDeps.cronTools,
                askUser: {
                    enabled: currentMode === 'ask' && this.askUser.enabled,
                    deps: {
                        emitQuestions: async (questionPayloads) => {
                            await this.store.updateProcess(processId, { pendingAskUser: questionPayloads });
                            for (const questionPayload of questionPayloads) {
                                this.store.emitProcessEvent(processId, {
                                    type: 'ask-user',
                                    askUser: questionPayload,
                                });
                            }
                        },
                        computeTurnIndex: () => process.conversationTurns?.length ?? 0,
                    },
                },
            });
            const filteredTools = chatCtx.tools;
            this.setAskUserHandles(processId, {
                answerQuestion: chatCtx.askUser!.answerQuestion,
                skipQuestion: chatCtx.askUser!.skipQuestion,
                answerQuestions: chatCtx.askUser!.answerQuestions,
                cancelAll: chatCtx.askUser!.cancelAll,
                hasPending: chatCtx.askUser!.hasPending,
            });

            // Build the system message AFTER the tool bundle so the
            // tool-guidance prose lives in `systemMessage` (sent once at
            // session creation) rather than being stapled to every user
            // turn.
            const systemMessage = await buildChatTurnSystemMessage({
                mode: currentMode,
                workingDirectory,
                provider: sessionProvider,
                globalSystemPrompt: this.resolveGlobalSystemPrompt(),
                forEachGeneration,
                mapReduceGeneration,
                memoryV2: chatCtx.memoryV2,
                toolGuidance: chatCtx.toolGuidance,
                autoFolderContext: currentMode === 'ask' ? autoFolderContextForFollowUp : undefined,
                notePath,
            });

            this.persistSystemPromptAsync(processId, 'chat', systemMessage?.content);

            const followUpMessage = prependSelectedSkillsDirective(
                message,
                selectedSkillNames,
                resolveSelectedSkillReferences(selectedSkillNames, skillDirectories, disabledSkills),
            );
            const agentMode = toAgentMode(currentMode);

            const historySystemMessage: SystemMessageConfig | undefined = historyContext
                ? { mode: 'append' as const, content: historyContext + (systemMessage ? '\n\n' + systemMessage.content : '') }
                : systemMessage;

            const resolvedDeliveryMode = (deliveryMode === 'immediate' ? 'immediate' : 'enqueue') as DeliveryMode;

            // Model, reasoning effort, and Copilot long-context tier all resolve
            // through the shared turn-policy resolver so follow-ups and first
            // turns cannot drift apart. `providerModel.model` is already coerced
            // above (its warning fires once, before the metadata write), so the
            // resolver only reports a coercion for the per-repo default.
            //
            // Follow-ups are the one path that can carry a per-turn effort
            // override from the EffortPillSelector; when the resolved model does
            // not support it, drop the effort and continue rather than failing
            // the turn.
            const policy = await resolveChatTurnPolicy({
                provider: sessionProvider,
                requestedModel: providerModel.model,
                dataDir: this.dataDir,
                workspaceId: wsId,
                defaultModelMode: 'followUp',
                onCoerced: ({ requestedModel }) => {
                    logger.warn(
                        LogCategory.AI,
                        `[FollowUp] Dropping default model '${requestedModel}' for provider '${sessionProvider}'; using provider default.`,
                    );
                },
                requestedEffort: reasoningEffort,
                getModelMetadata: (modelId) =>
                    this.getModelMetadataForReasoning(modelId, sessionProvider, followUpAiService),
                onReasoningSelectionError: (err, ctx) => resolveFollowUpReasoningSelection({
                    err,
                    processId,
                    sessionProvider,
                    reasoningModel: ctx.modelId,
                    requestedEffort: ctx.requestedEffort,
                    perTurnReasoningEffort: reasoningEffort,
                    modelMetadata: ctx.modelMetadata,
                    logger,
                }),
            });
            const contextTier = policy.contextTier;

            // AC-04 — Apply the per-repo MCP allow-lists (server-level
            // `enabledMcpServers` + per-tool `enabledMcpTools`) to the
            // dashboard chat/session follow-up path. When resolved, the explicit
            // map is sent with `loadDefaultMcpConfig: false` so disabled
            // tools/servers never reach the agent on a follow-up turn.
            const resolvedMcpServers = await resolveChatMcpServersForWorkspace({
                store: this.store,
                dataDir: this.dataDir,
                workspaceId: wsId,
                workingDirectory,
            });

            let strictResumeMismatch = false;
            const sendOptions = {
                prompt: followUpMessage,
                sessionId: sessionIdForSend,
                ...(strictResumeSessionId ? { strictSessionResume: true as const } : {}),
                ...(policy.modelId ? { model: policy.modelId } : {}),
                mode: agentMode,
                workingDirectory,
                signal: turnAbort.signal,
                ...(policy.reasoningEffort ? { reasoningEffort: policy.reasoningEffort } : {}),
                ...(contextTier ? { contextTier } : {}),
                infiniteSessions: { enabled: true } as const,
                ...(this.keepClientWarm() ? { keepWarm: true as const, warmKey: processId } : {}),
                systemMessage: historySystemMessage,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                attachments,
                deliveryMode: resolvedDeliveryMode,
                tools: filteredTools.length > 0 ? filteredTools : undefined,
                ...(chatCtx.excludedTools.length > 0
                    ? { excludedTools: chatCtx.excludedTools }
                    : {}),
                ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers, loadDefaultMcpConfig: false } : {}),
                skillDirectories,
                disabledSkills,
                onSessionCreated: (sessionId: string) => {
                    if (strictResumeSessionId && sessionId !== strictResumeSessionId) {
                        strictResumeMismatch = true;
                        logger.warn(LogCategory.AI, `[FollowUp] Provider returned a different SDK session while strict-resuming process ${processId}; preserving the stopped session id.`);
                        return;
                    }
                    this.store.updateProcess(processId, { sdkSessionId: sessionId }).catch((err: unknown) => {
                        logger.warn(LogCategory.AI, `[FollowUp] Failed to persist sdkSessionId for ${processId} — future resume may fail: ${err instanceof Error ? err.message : String(err)}`);
                    });
                },
                onStreamingChunk: this.buildStreamingChunkHandler(processId, FOLLOW_UP_LOG_LABEL),
                onToolEvent: this.buildToolEventHandler(
                    processId,
                    () => process.conversationTurns?.length ?? 0,
                ),
                onTokenUsage: this.buildMidTurnTokenUsageHandler(processId),
                onBackgroundTasksChanged: this.buildBackgroundTaskHandler(processId),
            };

            let result: SDKInvocationResult;
            result = await followUpAiService.sendMessage(sendOptions) as SDKInvocationResult;

            if (resolvedDeliveryMode === 'immediate') {
                const turnIndex = process.conversationTurns?.length ?? 0;
                emitMessageSteering(this.store, processId, { turnIndex: turnIndex - 1 });
            }

            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[FollowUp] Completed for ${processId} in ${duration}ms`);

            const followUpTimeline = mergeConsecutiveContentItems(this.getTimelineBuffer(processId) || []);

            if (!result.success) {
                throw new Error(result.error || 'Follow-up execution failed');
            }
            if (strictResumeSessionId && (strictResumeMismatch || (result.sessionId !== undefined && result.sessionId !== strictResumeSessionId))) {
                throw new Error('Provider did not resume the stopped SDK session.');
            }

            const pendingSuggestions = this.getPendingSuggestions(processId);
            let assistantTurn: ConversationTurn;
            let allTurns: ConversationTurn[];
            let assistantTurnIndex = process.conversationTurns?.length ?? 0;

            const appendResult = await this.appendFinalConversationTurn(
                processId,
                (turnIndex) => {
                    assistantTurnIndex = turnIndex;
                    return {
                        role: 'assistant' as const,
                        content: result.response || '(No text response)',
                        timestamp: new Date(),
                        turnIndex,
                        toolCalls: result.toolCalls || undefined,
                        timeline: followUpTimeline,
                        suggestions: pendingSuggestions,
                        tokenUsage: result.tokenUsage,
                        ...(result.effectiveModel ? { model: result.effectiveModel } : {}),
                        ...(turnSource ? { turnSource } : {}),
                    };
                },
                {
                    filterStreaming: true,
                    additionalUpdates: (current) => {
                        const sessionTokenUpdates = buildSessionTokenUpdates(current, result.tokenUsage);
                        const cumulativeTokenUsage = buildCumulativeTokenUsage(
                            current.cumulativeTokenUsage,
                            result.tokenUsage,
                        );
                        const assistantContent = result.response || '(No text response)';
                        const baseMetadata = {
                            ...(current.metadata ?? {}),
                            type: current.metadata?.type ?? 'chat',
                            model: result.effectiveModel,
                        };
                        const forEachMetadata = updateForEachGenerationMetadataFromAssistantTurn(
                            baseMetadata,
                            assistantContent,
                            assistantTurnIndex,
                        ) ?? baseMetadata;
                        const metadata = updateMapReduceGenerationMetadataFromAssistantTurn(
                            forEachMetadata,
                            assistantContent,
                            assistantTurnIndex,
                        ) ?? forEachMetadata;
                        return {
                            status: 'completed' as const,
                            endTime: new Date(),
                            result: result.response || undefined,
                            metadata,
                            ...sessionTokenUpdates,
                            ...(cumulativeTokenUsage ? { cumulativeTokenUsage } : {}),
                        };
                    },
                }
            );
            assistantTurn = appendResult!.turn;
            allTurns = appendResult!.allTurns;

            // Persist the copilot-sdk `user.message` event id captured during
            // streaming onto the user turn that produced this exchange (the turn
            // immediately preceding the assistant turn). This is the durable
            // anchor used later to rewind/truncate the conversation at this turn.
            // Only copilot streams surface an id; for other providers it is
            // undefined and we skip. The store guards on role:'user' so a stray
            // index is a safe no-op.
            if (result.userMessageEventId && assistantTurn.turnIndex > 0) {
                try {
                    await this.store.updateTurnSdkEventId(
                        processId,
                        assistantTurn.turnIndex - 1,
                        result.userMessageEventId,
                    );
                } catch (err) {
                    logger.warn(LogCategory.AI, `[FollowUp] Failed to persist sdkEventId for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            // Capture note edit snapshot for inline diff
            if (notePath && wsId && preEditContent !== undefined) {
                await captureNoteEditSnapshot({
                    store: this.store,
                    processId,
                    dataDir: this.dataDir ?? path.join(os.homedir(), '.coc'),
                    workspaceId: wsId,
                    notePath,
                    preEditContent,
                    turnIndex: assistantTurn.turnIndex,
                    logLabel: FOLLOW_UP_LOG_LABEL,
                });
            }

            await emitTurnTokenUsage({
                store: this.store,
                processId,
                workspaceId: wsId,
                turnIndex: assistantTurn.turnIndex,
                tokenUsage: result.tokenUsage,
                allTurns,
                logLabel: FOLLOW_UP_LOG_LABEL,
            });

            this.settleTurnPerformance(processId, {
                turnIndex: turnPerformanceOrdinal,
                workspaceId: wsId,
                provider: sessionProvider,
                model: result.effectiveModel ?? policy.modelId,
                effortTier: policy.reasoningEffort,
                mode: currentMode,
                kind: (process.metadata?.type as string | undefined) ?? process.type,
                tokenUsage: result.tokenUsage,
                status: 'completed',
            });

            this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);

            this.onTitleNeeded?.(processId, allTurns);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            const failedAt = new Date();
            logger.error(LogCategory.AI, `[FollowUp] Failed for ${processId} in ${duration}ms: ${errorMsg}`);

            const partial = this.capturePartialTurn(processId);

            await this.appendFinalConversationTurn(
                processId,
                (turnIndex) => {
                    return {
                        role: 'assistant' as const,
                        content: partial.hasPartial ? partial.content : `Error: ${errorMsg}`,
                        timestamp: new Date(),
                        turnIndex,
                        timeline: partial.hasPartial ? partial.timeline : [],
                        ...(partial.hasPartial ? { interrupted: true, interruptionReason: errorMsg } : {}),
                        ...(partial.hasPartial && partial.suggestions ? { suggestions: partial.suggestions } : {}),
                        ...(turnSource ? { turnSource } : {}),
                    };
                },
                {
                    filterStreaming: true,
                    additionalUpdates: (current: AIProcess) => ({
                        status: 'failed',
                        endTime: failedAt,
                        error: errorMsg,
                        ...(strictResumeSessionId
                            ? {
                                metadata: {
                                    ...(current.metadata ?? {}),
                                    type: current.metadata?.type ?? 'chat',
                                    stoppedChatResume: {
                                        resumable: false,
                                        reason: STOPPED_CHAT_STRICT_RESUME_FAILED_REASON,
                                        message: STOPPED_CHAT_STRICT_RESUME_FAILED_MESSAGE,
                                        failedAt: failedAt.toISOString(),
                                        sdkSessionId: strictResumeSessionId,
                                    },
                                },
                            }
                            : {}),
                    }),
                }
            );
            this.settleTurnPerformance(processId, {
                turnIndex: turnPerformanceOrdinal,
                workspaceId: wsId,
                provider: sessionProvider,
                model: providerModel.model,
                mode: currentMode,
                kind: (process.metadata?.type as string | undefined) ?? process.type,
                status: turnAbort.signal.aborted ? 'cancelled' : 'errored',
            });
            this.store.emitProcessComplete(processId, 'failed', `${duration}ms`);
            if (strictResumeSessionId) {
                throw error instanceof Error ? error : new Error(errorMsg);
            }
        } finally {
            this.releaseTurnAbortController(processId, turnAbort);
            // Timing state is settled on both success and error paths; this is
            // a leak guard for throws that bypass both settles.
            this.turnPerformance.abandon(processId);
            chatCtx?.dispose();
            this.cancelAskUserHandles(processId);
            try {
                await this.clearPendingAskUser(processId);
            } catch (err) {
                logger.debug(
                    LogCategory.AI,
                    `[FollowUp] Failed to clear pending ask-user for ${processId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
            const buffer = this.getOutputBuffer(processId);
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer);
        }
    }
}
