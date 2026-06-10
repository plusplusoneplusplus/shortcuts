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
import { getForEachContext, getMapReduceContext, isForEachGenerationContext, isMapReduceGenerationContext, normalizeChatModeOrDefault } from '../tasks/task-types';
import {
    approveAllPermissions,
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    resolveModelForProvider,
    resolveReasoningSelection,
} from '@plusplusoneplusplus/forge';
import {
    buildForEachGenerationSystemMessage,
    buildMapReduceGenerationSystemMessage,
    buildModeSystemMessage,
    buildConversationHistoryContext,
    prependSelectedSkillsDirective,
    resolveSelectedSkillReferences,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import { readNoteContent, appendNoteEditSnapshot, SNAPSHOT_SIZE_LIMIT } from './note-chat-executor';
import { emitMessageSteering } from '../streaming/sse-handler';
import { buildLiveConversationCostEstimate } from '../processes/process-metadata-read-model';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { buildChatTurnContext } from './chat-turn-context-builder';
import type { ChatTurnContext } from './chat-turn-context-builder';
import { updateForEachGenerationMetadataFromAssistantTurn } from '../for-each/for-each-generation-metadata';
import { updateMapReduceGenerationMetadataFromAssistantTurn } from '../map-reduce/map-reduce-generation-metadata';
// ============================================================================
// Types
// ============================================================================

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

function resolveFollowUpReasoningSelection(options: {
    processId: string;
    sessionProvider: ChatProvider;
    reasoningModel: string | undefined;
    requestedEffort: Parameters<typeof resolveReasoningSelection>[0]['requestedEffort'];
    perTurnReasoningEffort: ReasoningEffort | undefined;
    modelMetadata: ModelInfo | undefined;
    logger: ReturnType<typeof getLogger>;
}): ReturnType<typeof resolveReasoningSelection> {
    const { processId, sessionProvider, reasoningModel, requestedEffort, perTurnReasoningEffort, modelMetadata, logger } = options;
    try {
        return resolveReasoningSelection({
            modelId: reasoningModel,
            requestedEffort,
            model: modelMetadata,
        });
    } catch (err) {
        if (!perTurnReasoningEffort || requestedEffort !== perTurnReasoningEffort || !isReasoningEffort(perTurnReasoningEffort)) {
            throw err;
        }

        logger.warn(
            LogCategory.AI,
            `[FollowUp] Omitting reasoning effort '${perTurnReasoningEffort}' for process ${processId} because provider '${sessionProvider}' model '${reasoningModel ?? 'provider-default'}' does not support it. Supported efforts: ${formatSupportedReasoningEfforts(modelMetadata)}.`,
        );
        return { modelId: reasoningModel };
    }
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

        const canResumeSession = !!process.sdkSessionId;

        const historyContext = canResumeSession
            ? undefined
            : buildConversationHistoryContext(process.conversationTurns);

        this.getOrCreateSession(processId).outputBuffer = '';
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        let chatCtx: ChatTurnContext | undefined;

        try {
            // User turn is already persisted by the POST /message route handler
            // (atomically with the status: 'running' update) so the executor
            // only needs to handle the AI call and assistant turn.
            //
            // Exception: loop/wakeup-triggered follow-ups have no POST /message
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

            const loopDeps = this.buildLoopToolDeps(processId);
            chatCtx = await buildChatTurnContext({
                dataDir: this.dataDir,
                store: this.store,
                workspaceId: wsId,
                processId,
                query: message,
                followUpSuggestions: this.followUpSuggestions,
                broadcastWorkItem: this.getWsServerFn
                    ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event as any)
                    : undefined,
                scheduleWakeup: loopDeps.scheduleWakeup,
                loopTools: loopDeps.loopTools,
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
            const session = this.getOrCreateSession(processId);
            session.pendingAskUser = {
                answerQuestion: chatCtx.askUser!.answerQuestion,
                skipQuestion: chatCtx.askUser!.skipQuestion,
                answerQuestions: chatCtx.askUser!.answerQuestions,
                cancelAll: chatCtx.askUser!.cancelAll,
                hasPending: chatCtx.askUser!.hasPending,
            };

            // Build the system message AFTER the tool bundle so the
            // tool-guidance prose lives in `systemMessage` (sent once at
            // session creation) rather than being stapled to every user
            // turn.
            const systemMessage = await systemMessageBuilder()
                .append(buildModeSystemMessage(currentMode)?.content)
                .append(buildForEachGenerationSystemMessage(forEachGeneration)?.content)
                .append(buildMapReduceGenerationSystemMessage(mapReduceGeneration)?.content)
                .withRepoInstructions(workingDirectory, currentMode)
                .appendMemoryV2(chatCtx.memoryV2)
                .appendToolGuidance(chatCtx.toolGuidance)
                .appendAutoFolder(autoFolderContextForFollowUp)
                .appendNoteFile(notePath)
                .build();

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
            let reasoningModel = providerModel.model;
            // Resolve per-repo default model when no explicit or process model is set.
            if (!reasoningModel && this.dataDir && wsId) {
                const { resolveDefaultModel } = await import('../preferences-handler');
                const defaultModel = resolveDefaultModel(this.dataDir, wsId, 'followUp');
                const resolvedDefaultModel = resolveModelForProvider(sessionProvider, defaultModel);
                if (resolvedDefaultModel.coerced) {
                    logger.warn(
                        LogCategory.AI,
                        `[FollowUp] Dropping default model '${resolvedDefaultModel.requestedModel}' for provider '${sessionProvider}'; using provider default.`,
                    );
                }
                reasoningModel = resolvedDefaultModel.model;
            }
            // Resolve reasoning effort:
            //   per-turn override (from EffortPillSelector)
            //   > provider-scoped persisted default (cfg.models.providers[provider].reasoningEfforts)
            //   > global persisted default — Copilot legacy only (cfg.models.reasoningEfforts)
            //   > SDK default (model catalog default, then FALLBACK_REASONING_EFFORT_ORDER)
            type _RequestedEffort = Parameters<typeof resolveReasoningSelection>[0]['requestedEffort'];
            let requestedEffort: _RequestedEffort = reasoningEffort;
            if (!requestedEffort && reasoningModel) {
                const { loadConfigFile } = await import('../../config');
                const cfg = loadConfigFile();
                const providerSettings = cfg?.models?.providers?.[sessionProvider];
                const effortMap: Record<string, string> = providerSettings
                    ? (providerSettings.reasoningEfforts ?? {})
                    : (sessionProvider === 'copilot' ? (cfg?.models?.reasoningEfforts ?? {}) : {});
                const persisted = effortMap[reasoningModel];
                if (persisted) requestedEffort = persisted as _RequestedEffort;
            }
            const reasoningModelMetadata = await this.getModelMetadataForReasoning(reasoningModel, sessionProvider, followUpAiService);
            const reasoningSelection = resolveFollowUpReasoningSelection({
                processId,
                sessionProvider,
                reasoningModel,
                requestedEffort,
                perTurnReasoningEffort: reasoningEffort,
                modelMetadata: reasoningModelMetadata,
                logger,
            });

            const sendOptions = {
                prompt: followUpMessage,
                sessionId: process.sdkSessionId,
                ...(reasoningSelection.modelId ? { model: reasoningSelection.modelId } : {}),
                mode: agentMode,
                workingDirectory,
                ...(reasoningSelection.reasoningEffort ? { reasoningEffort: reasoningSelection.reasoningEffort } : {}),
                infiniteSessions: { enabled: true } as const,
                systemMessage: historySystemMessage,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                attachments,
                deliveryMode: resolvedDeliveryMode,
                tools: filteredTools.length > 0 ? filteredTools : undefined,
                ...(chatCtx.excludedTools.length > 0
                    ? { excludedTools: chatCtx.excludedTools }
                    : {}),
                skillDirectories,
                disabledSkills,
                onSessionCreated: (sessionId: string) => {
                    this.store.updateProcess(processId, { sdkSessionId: sessionId }).catch((err: unknown) => {
                        logger.warn(LogCategory.AI, `[FollowUp] Failed to persist sdkSessionId for ${processId} — future resume may fail: ${err instanceof Error ? err.message : String(err)}`);
                    });
                },
                onStreamingChunk: (chunk: string) => {
                    this.getOrCreateSession(processId).outputBuffer += chunk;
                    this.appendTimelineItem(processId, { type: 'content', timestamp: new Date(), content: chunk });
                    try {
                        this.store.emitProcessOutput(processId, chunk);
                    } catch (err) {
                        logger.debug(LogCategory.AI, `[FollowUp] emitProcessOutput failed for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
                    }
                    this.checkThrottleAndFlush(processId);
                },
                onToolEvent: this.buildToolEventHandler(
                    processId,
                    () => process.conversationTurns?.length ?? 0,
                ),
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

            const followUpTimeline = mergeConsecutiveContentItems(this.sessions.get(processId)?.timelineBuffer || []);

            if (!result.success) {
                throw new Error(result.error || 'Follow-up execution failed');
            }

            const pendingSuggestions = this.sessions.get(processId)?.pendingSuggestions;
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
                        const tokenLimit = result.tokenUsage?.tokenLimit ?? current.tokenLimit;
                        const currentTokens = result.tokenUsage?.currentTokens ?? current.currentTokens;
                        const systemTokens = result.tokenUsage?.systemTokens ?? current.systemTokens;
                        const toolDefinitionsTokens = result.tokenUsage?.toolDefinitionsTokens ?? current.toolDefinitionsTokens;
                        const conversationTokens = result.tokenUsage?.conversationTokens ?? current.conversationTokens;
                        const prevCumulative = current.cumulativeTokenUsage;
                        const cumulativeTokenUsage = result.tokenUsage ? {
                            inputTokens: (prevCumulative?.inputTokens ?? 0) + result.tokenUsage.inputTokens,
                            outputTokens: (prevCumulative?.outputTokens ?? 0) + result.tokenUsage.outputTokens,
                            cacheReadTokens: (prevCumulative?.cacheReadTokens ?? 0) + result.tokenUsage.cacheReadTokens,
                            cacheWriteTokens: (prevCumulative?.cacheWriteTokens ?? 0) + result.tokenUsage.cacheWriteTokens,
                            totalTokens: (prevCumulative?.totalTokens ?? 0) + result.tokenUsage.totalTokens,
                            turnCount: (prevCumulative?.turnCount ?? 0) + result.tokenUsage.turnCount,
                            cost: result.tokenUsage.cost !== undefined
                                ? (prevCumulative?.cost ?? 0) + result.tokenUsage.cost
                                : prevCumulative?.cost,
                            actualUsdCost: result.tokenUsage.actualUsdCost !== undefined
                                ? (prevCumulative?.actualUsdCost ?? 0) + result.tokenUsage.actualUsdCost
                                : prevCumulative?.actualUsdCost,
                            duration: result.tokenUsage.duration !== undefined
                                ? (prevCumulative?.duration ?? 0) + result.tokenUsage.duration
                                : prevCumulative?.duration,
                            tokenLimit: result.tokenUsage.tokenLimit ?? prevCumulative?.tokenLimit,
                            currentTokens: result.tokenUsage.currentTokens ?? prevCumulative?.currentTokens,
                            systemTokens: result.tokenUsage.systemTokens ?? prevCumulative?.systemTokens,
                            toolDefinitionsTokens: result.tokenUsage.toolDefinitionsTokens ?? prevCumulative?.toolDefinitionsTokens,
                            conversationTokens: result.tokenUsage.conversationTokens ?? prevCumulative?.conversationTokens,
                        } : prevCumulative;
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
                            ...(tokenLimit !== undefined ? { tokenLimit } : {}),
                            ...(currentTokens !== undefined ? { currentTokens } : {}),
                            ...(systemTokens !== undefined ? { systemTokens } : {}),
                            ...(toolDefinitionsTokens !== undefined ? { toolDefinitionsTokens } : {}),
                            ...(conversationTokens !== undefined ? { conversationTokens } : {}),
                            ...(cumulativeTokenUsage ? { cumulativeTokenUsage } : {}),
                        };
                    },
                }
            );
            assistantTurn = appendResult!.turn;
            allTurns = appendResult!.allTurns;

            // Capture note edit snapshot for inline diff
            if (notePath && wsId && preEditContent !== undefined) {
                try {
                    const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
                    const postEditContent = await readNoteContent(effectiveDataDir, wsId, notePath);
                    if (postEditContent !== undefined && postEditContent !== preEditContent) {
                        const turnIndex = assistantTurn.turnIndex;
                        const tooLarge = preEditContent.length > SNAPSHOT_SIZE_LIMIT
                            || postEditContent.length > SNAPSHOT_SIZE_LIMIT;
                        await appendNoteEditSnapshot(this.store, processId, {
                            editId: `${processId}-${turnIndex}`,
                            notePath,
                            preEditContent: tooLarge ? '' : preEditContent,
                            postEditContent: tooLarge ? '' : postEditContent,
                            timestamp: new Date().toISOString(),
                            turnIndex,
                            ...(tooLarge ? { tooLarge: true } : {}),
                        });
                    }
                } catch (err) {
                    logger.debug(LogCategory.AI, `[FollowUp] Failed to capture note edit snapshot for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            if (result.tokenUsage) {
                try {
                    const currentProc = await this.store.getProcess(processId, wsId);
                    const cumulativeTokenUsage = currentProc?.cumulativeTokenUsage;
                    this.store.emitProcessEvent(processId, {
                        type: 'token-usage',
                        turnIndex: assistantTurn.turnIndex,
                        tokenUsage: result.tokenUsage,
                        ...(cumulativeTokenUsage ? { cumulativeTokenUsage } : {}),
                        ...(currentProc ? { conversationCostEstimate: buildLiveConversationCostEstimate(currentProc, allTurns) } : {}),
                        sessionTokenLimit: result.tokenUsage.tokenLimit,
                        sessionCurrentTokens: result.tokenUsage.currentTokens,
                        ...(result.tokenUsage.systemTokens          != null ? { sessionSystemTokens:       result.tokenUsage.systemTokens }          : {}),
                        ...(result.tokenUsage.toolDefinitionsTokens != null ? { sessionToolTokens:         result.tokenUsage.toolDefinitionsTokens } : {}),
                        ...(result.tokenUsage.conversationTokens    != null ? { sessionConversationTokens: result.tokenUsage.conversationTokens }    : {}),
                    });
                } catch (err) {
                    logger.debug(LogCategory.AI, `[FollowUp] Failed to emit token usage event for ${processId}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);

            this.onTitleNeeded?.(processId, allTurns);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.error(LogCategory.AI, `[FollowUp] Failed for ${processId} in ${duration}ms: ${errorMsg}`);

            const session = this.sessions.get(processId);
            const partialContent = session?.outputBuffer ?? '';
            const partialTimeline = session?.timelineBuffer
                ? mergeConsecutiveContentItems([...session.timelineBuffer])
                : [];
            const partialSuggestions = session?.pendingSuggestions;
            const hasPartial = partialContent.length > 0 || partialTimeline.length > 0;

            await this.appendFinalConversationTurn(
                processId,
                (turnIndex) => ({
                    role: 'assistant' as const,
                    content: hasPartial ? partialContent : `Error: ${errorMsg}`,
                    timestamp: new Date(),
                    turnIndex,
                    timeline: hasPartial ? partialTimeline : [],
                    ...(hasPartial ? { interrupted: true, interruptionReason: errorMsg } : {}),
                    ...(hasPartial && partialSuggestions ? { suggestions: partialSuggestions } : {}),
                    ...(turnSource ? { turnSource } : {}),
                }),
                {
                    filterStreaming: true,
                    additionalUpdates: {
                        status: 'failed',
                        endTime: new Date(),
                        error: errorMsg,
                    },
                }
            );
            this.store.emitProcessComplete(processId, 'failed', `${duration}ms`);
        } finally {
            chatCtx?.dispose();
            const buffer = this.sessions.get(processId)?.outputBuffer ?? '';
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer);
        }
    }
}
