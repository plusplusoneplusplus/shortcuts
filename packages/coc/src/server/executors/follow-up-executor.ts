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
    ProcessStore,
    QueuedTask,
    SDKInvocationResult,
    SystemMessageConfig,
    TurnSource,
} from '@plusplusoneplusplus/forge';
import type { ChatMode } from '../tasks/task-types';
import {
    approveAllPermissions,
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    resolveReasoningSelection,
} from '@plusplusoneplusplus/forge';
import {
    buildModeSystemMessage,
    buildConversationHistoryContext,
    prependSelectedSkillsDirective,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import { readNoteContent, appendNoteEditSnapshot, SNAPSHOT_SIZE_LIMIT } from './note-chat-executor';
import { emitMessageSteering } from '../streaming/sse-handler';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { flushMemories } from '../memory/pre-compression-flush';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { buildChatToolBundle } from './chat-tool-builder';
// ============================================================================
// Types
// ============================================================================

/** Map CoC ChatMode to SDK AgentMode for protocol-level enforcement. */
const CHAT_MODE_TO_AGENT_MODE: Record<ChatMode, AgentMode> = {
    ask: 'interactive',
    plan: 'plan',
    autopilot: 'autopilot',
    ralph: 'autopilot',
};

function toAgentMode(chatMode: ChatMode | undefined): AgentMode | undefined {
    return chatMode ? CHAT_MODE_TO_AGENT_MODE[chatMode] : undefined;
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
     * Resolve a BoundedMemoryStore for pre-compression flush.
     * Returns undefined if memory is not enabled for the workspace.
     */
    private async resolveMemoryStoreForFlush(wsId: string | undefined): Promise<import('@plusplusoneplusplus/forge').BoundedMemoryStore | undefined> {
        if (!this.dataDir || !wsId) return undefined;
        try {
            const { readRepoPreferences } = await import('../preferences-handler');
            const { getRepoDataPath } = await import('../paths');
            const { BoundedMemoryStore } = await import('@plusplusoneplusplus/forge');
            const prefs = readRepoPreferences(this.dataDir, wsId);
            if (!prefs.boundedMemory?.enabled) return undefined;
            const memoryPath = getRepoDataPath(this.dataDir, wsId, 'memory/MEMORY.md');
            const store = new BoundedMemoryStore({
                filePath: memoryPath,
                ...(prefs.boundedMemory.charLimit ? { charLimit: prefs.boundedMemory.charLimit } : {}),
            });
            await store.load();
            return store;
        } catch (err) {
            getLogger().debug(LogCategory.AI, `[FollowUp] resolveMemoryStoreForFlush failed for workspace ${wsId}: ${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
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
        mode?: ChatMode,
        deliveryMode?: string,
        images?: string[],
        selectedSkillNames?: string[],
        model?: string,
        turnSource?: TurnSource,
    ): Promise<void> {
        const logger = getLogger();
        const startTime = Date.now();

        logger.debug(LogCategory.AI, `[FollowUp] Starting follow-up for process ${processId}`);

        const process = await this.store.getProcess(processId);
        if (!process) {
            throw new Error(`Process not found: ${processId}`);
        }
        const workingDirectory = process.workingDirectory || this.defaultWorkingDirectory;

        const previousMode = process.metadata?.mode as ChatMode | undefined;
        let currentMode: ChatMode;
        if (mode) {
            currentMode = mode;
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

        const metadataUpdates: Record<string, unknown> = {};
        if (mode && mode !== previousMode) {
            metadataUpdates.previousMode = previousMode;
            metadataUpdates.mode = currentMode;
        }
        if (model && model !== process.metadata?.model) {
            metadataUpdates.model = model;
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
                currentMode === 'plan' ? 'plan' : 'ask',
            );
        }
        const boundedMemory = await this.buildMemoryAddon(wsId, {
            processId,
            turnIndex: process.conversationTurns?.length ?? 0,
        }, message);
        const notePath = process.metadata?.notePath as string | undefined;

        // Capture pre-edit note content for snapshot (note-chat follow-ups only)
        let preEditContent: string | undefined;
        if (notePath && wsId) {
            const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
            preEditContent = await readNoteContent(effectiveDataDir, wsId, notePath);
        }

        const { skillDirectories, disabledSkills } = await this.resolveSkillConfigFn(wsId, workingDirectory);

        const canResumeSession = !!process.sdkSessionId;

        // Pre-compression flush: if the previous session cannot be resumed
        // and it used most of its context, flush memories before the context
        // is discarded and rebuilt from history.
        if (!canResumeSession && boundedMemory.tools.length > 0) {
            const tokenLimit = process.tokenLimit;
            const currentTokens = process.currentTokens;
            if (tokenLimit && currentTokens && currentTokens / tokenLimit > 0.80) {
                try {
                    const memoryStore = boundedMemory.tools[0]
                        ? await this.resolveMemoryStoreForFlush(wsId)
                        : undefined;
                    if (memoryStore) {
                        await flushMemories({
                            turns: process.conversationTurns ?? [],
                            memoryStore,
                            aiService: this.aiService,
                            minTurns: 0,
                            timeoutMs: 30_000,
                        });
                    }
                } catch (err) {
                    logger.warn(LogCategory.AI, `[FollowUp] Pre-compression memory flush failed for ${processId} — context may be lost: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }

        const historyContext = canResumeSession
            ? undefined
            : buildConversationHistoryContext(process.conversationTurns);

        this.getOrCreateSession(processId).outputBuffer = '';
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

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
            const toolBundle = buildChatToolBundle({
                dataDir: this.dataDir,
                store: this.store,
                workspaceId: wsId,
                processId,
                followUpSuggestions: this.followUpSuggestions,
                broadcastWorkItem: this.getWsServerFn
                    ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event as any)
                    : undefined,
                boundedMemory,
                scheduleWakeup: loopDeps.scheduleWakeup,
                loopTools: loopDeps.loopTools,
                askUser: {
                    enabled: (currentMode === 'ask' || currentMode === 'plan') && this.askUser.enabled,
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
            const filteredTools = toolBundle.tools;
            const session = this.getOrCreateSession(processId);
            session.pendingAskUser = {
                answerQuestion: toolBundle.askUser!.answerQuestion,
                skipQuestion: toolBundle.askUser!.skipQuestion,
                answerQuestions: toolBundle.askUser!.answerQuestions,
                cancelAll: toolBundle.askUser!.cancelAll,
                hasPending: toolBundle.askUser!.hasPending,
            };

            // Build the system message AFTER the tool bundle so the
            // tool-guidance prose lives in `systemMessage` (sent once at
            // session creation) rather than being stapled to every user
            // turn.
            const systemMessage = await systemMessageBuilder()
                .append(buildModeSystemMessage(currentMode)?.content)
                .withRepoInstructions(workingDirectory, currentMode)
                .appendMemory(boundedMemory)
                .appendToolGuidance(toolBundle.toolGuidance)
                .appendAutoFolder(autoFolderContextForFollowUp)
                .appendNoteFile(notePath)
                .build();

            this.persistSystemPromptAsync(processId, 'chat', systemMessage?.content);

            const followUpMessage = prependSelectedSkillsDirective(message, selectedSkillNames);
            const agentMode = toAgentMode(currentMode);

            const historySystemMessage: SystemMessageConfig | undefined = historyContext
                ? { mode: 'append' as const, content: historyContext + (systemMessage ? '\n\n' + systemMessage.content : '') }
                : systemMessage;

            const resolvedDeliveryMode = (deliveryMode === 'immediate' ? 'immediate' : 'enqueue') as DeliveryMode;
            const processModel = typeof process.metadata?.model === 'string' ? process.metadata.model : undefined;
            let reasoningModel = model ?? processModel;
            // Resolve per-repo default model when no explicit or process model is set.
            if (!reasoningModel && this.dataDir && wsId) {
                const { resolveDefaultModel } = await import('../preferences-handler');
                reasoningModel = resolveDefaultModel(this.dataDir, wsId, 'followUp');
            }
            // Resolve reasoning effort: persisted per-model preference > SDK default
            let requestedEffort: Parameters<typeof resolveReasoningSelection>[0]['requestedEffort'];
            if (reasoningModel) {
                const { loadConfigFile } = await import('../../config');
                const cfg = loadConfigFile();
                const persisted = cfg?.models?.reasoningEfforts?.[reasoningModel];
                if (persisted) requestedEffort = persisted as typeof requestedEffort;
            }
            const reasoningSelection = resolveReasoningSelection({
                modelId: reasoningModel,
                requestedEffort,
                model: await this.getModelMetadataForReasoning(reasoningModel),
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
            result = await this.aiService.sendMessage(sendOptions) as SDKInvocationResult;

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

            const appendResult = await this.store.appendConversationTurn(
                processId,
                (turnIndex) => ({
                    role: 'assistant' as const,
                    content: result.response || '(No text response)',
                    timestamp: new Date(),
                    turnIndex,
                    toolCalls: result.toolCalls || undefined,
                    timeline: followUpTimeline,
                    suggestions: pendingSuggestions,
                    tokenUsage: result.tokenUsage,
                    ...(turnSource ? { turnSource } : {}),
                }),
                {
                    filterStreaming: true,
                    additionalUpdates: (current) => {
                        const tokenLimit = result.tokenUsage?.tokenLimit ?? current.tokenLimit;
                        const currentTokens = result.tokenUsage?.currentTokens ?? current.currentTokens;
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
                            duration: result.tokenUsage.duration !== undefined
                                ? (prevCumulative?.duration ?? 0) + result.tokenUsage.duration
                                : prevCumulative?.duration,
                        } : prevCumulative;
                        return {
                            status: 'completed' as const,
                            endTime: new Date(),
                            result: result.response || undefined,
                            ...(tokenLimit !== undefined ? { tokenLimit } : {}),
                            ...(currentTokens !== undefined ? { currentTokens } : {}),
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
                    this.store.emitProcessEvent(processId, {
                        type: 'token-usage',
                        turnIndex: assistantTurn.turnIndex,
                        tokenUsage: result.tokenUsage,
                        sessionTokenLimit: result.tokenUsage.tokenLimit,
                        sessionCurrentTokens: result.tokenUsage.currentTokens,
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

            await this.store.appendConversationTurn(
                processId,
                (turnIndex) => ({
                    role: 'assistant' as const,
                    content: `Error: ${errorMsg}`,
                    timestamp: new Date(),
                    turnIndex,
                    timeline: [],
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
            boundedMemory.dispose?.();
            const buffer = this.sessions.get(processId)?.outputBuffer ?? '';
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer);
        }
    }
}
