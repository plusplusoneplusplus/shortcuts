/**
 * Follow-Up Executor
 *
 * Concrete executor that owns follow-up message dispatching: sending a follow-up
 * message to an in-progress or completed process, streaming the AI response back,
 * appending the assistant turn to conversationTurns, and updating process status.
 *
 * Extends BaseExecutor for shared streaming/cancellation/timeline plumbing.
 * Must NOT create new processes — it appends to an existing one.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    AgentMode,
    Attachment,
    AutoFolderContext,
    ConversationTurn,
    CopilotSDKService,
    DeliveryMode,
    ProcessStore,
    SystemMessageConfig,
} from '@plusplusoneplusplus/forge';
import type { ChatMode } from '../task-types';
import {
    approveAllPermissions,
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
} from '@plusplusoneplusplus/forge';
import {
    buildModeSystemMessage,
    appendAutoFolderBlock,
    appendMemoryContext,
    withRepoInstructions,
    buildConversationHistoryContext,
    buildFollowUpSuggestionsAddon,
    prependSelectedSkillsDirective,
} from './prompt-builder';
import { emitMessageSteering } from '../sse-handler';
import { resolveTaskRoot } from '../task-root-resolver';
import { BaseExecutor } from './base-executor';
import type { CopilotClientCache } from './copilot-client-cache';
// ============================================================================
// Types
// ============================================================================

/** Map CoC ChatMode to SDK AgentMode for protocol-level enforcement. */
const CHAT_MODE_TO_AGENT_MODE: Record<ChatMode, AgentMode> = {
    ask: 'interactive',
    plan: 'plan',
    autopilot: 'autopilot',
};

function toAgentMode(chatMode: ChatMode | undefined): AgentMode | undefined {
    return chatMode ? CHAT_MODE_TO_AGENT_MODE[chatMode] : undefined;
}

export interface SkillConfig {
    skillDirectories?: string[];
    disabledSkills?: string[];
}

export interface FollowUpExecutorOptions {
    /** Default working directory for AI sessions */
    workingDirectory?: string;
    /** Whether to auto-approve AI permission requests (default: true) */
    approvePermissions?: boolean;
    /** The AI service instance to use for sending messages */
    aiService: CopilotSDKService;
    /** Follow-up suggestions configuration */
    followUpSuggestions: { enabled: boolean; count: number };
    /** Resolve workspace ID for a root path */
    resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
    /** Resolve skill configuration for a workspace */
    resolveSkillConfig: (wsId: string | undefined, workDir?: string) => Promise<SkillConfig>;
    /** Fire-and-forget title generation callback (optional) */
    onTitleNeeded?: (processId: string, turns: ConversationTurn[]) => void;
}

// ============================================================================
// FollowUpExecutor
// ============================================================================

export class FollowUpExecutor extends BaseExecutor {
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;
    private readonly aiService: CopilotSDKService;
    private readonly followUpSuggestions: { enabled: boolean; count: number };
    private readonly _resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
    private readonly _resolveSkillConfig: (wsId: string | undefined, workDir?: string) => Promise<SkillConfig>;
    private readonly onTitleNeeded?: (processId: string, turns: ConversationTurn[]) => void;

    constructor(store: ProcessStore, options: FollowUpExecutorOptions, dataDir?: string, clientCache?: CopilotClientCache) {
        super(store, dataDir, clientCache);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService;
        this.followUpSuggestions = options.followUpSuggestions;
        this._resolveWorkspaceIdForPath = options.resolveWorkspaceIdForPath;
        this._resolveSkillConfig = options.resolveSkillConfig;
        this.onTitleNeeded = options.onTitleNeeded;
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
        const currentMode = mode ?? previousMode;

        if (mode && mode !== previousMode) {
            await this.store.updateProcess(processId, {
                metadata: {
                    type: process.metadata?.type ?? 'chat',
                    ...(process.metadata ?? {}),
                    previousMode,
                    mode: currentMode,
                },
            });
        }

        let autoFolderContextForFollowUp: AutoFolderContext | undefined;
        const wsId = (process.metadata?.workspaceId as string) ?? (workingDirectory ? await this._resolveWorkspaceIdForPath(workingDirectory) : undefined);
        if (workingDirectory) {
            const tasksRoot = resolveTaskRoot({ dataDir: this.dataDir ?? path.join(os.homedir(), '.coc'), rootPath: workingDirectory, workspaceId: wsId }).absolutePath;
            const entries = await fs.promises.readdir(tasksRoot, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
            const existingFolders = entries.filter(e => e.isDirectory()).map(e => e.name);
            autoFolderContextForFollowUp = { tasksRoot, existingFolders };
        }
        const systemMessage = appendAutoFolderBlock(
            appendMemoryContext(
                await withRepoInstructions(
                    buildModeSystemMessage(currentMode),
                    workingDirectory,
                    currentMode,
                ),
                this.dataDir,
                wsId,
            ),
            autoFolderContextForFollowUp,
        );

        const { skillDirectories, disabledSkills } = await this._resolveSkillConfig(wsId, workingDirectory);

        const canResumeSession = !!process.sdkSessionId;

        const historyContext = canResumeSession
            ? undefined
            : buildConversationHistoryContext(process.conversationTurns);

        this.getOrCreateSession(processId).outputBuffer = '';
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        try {
            // User turn is already persisted by the POST /message route handler
            // (atomically with the status: 'running' update) so the executor
            // only needs to handle the AI call and assistant turn.

            const { tools: suggestTools, suffix: followUpSuffix } = buildFollowUpSuggestionsAddon(this.followUpSuggestions.enabled, this.followUpSuggestions.count);
            const followUpMessage = prependSelectedSkillsDirective(
                followUpSuffix ? `${message}${followUpSuffix}` : message,
                selectedSkillNames,
            );
            const agentMode = toAgentMode(currentMode);

            const historySystemMessage: SystemMessageConfig | undefined = historyContext
                ? { mode: 'append' as const, content: historyContext + (systemMessage ? '\n\n' + systemMessage.content : '') }
                : systemMessage;

            const resolvedDeliveryMode = (deliveryMode === 'immediate' ? 'immediate' : 'enqueue') as DeliveryMode;

            // Reuse a cached CopilotClient for this process when available.
            let cachedClient: import('@github/copilot-sdk').CopilotClient | undefined;
            if (this.clientCache) {
                try {
                    cachedClient = await this.clientCache.getOrCreate(processId, workingDirectory);
                } catch {
                    // Non-fatal: fall back to session-per-request (no cached client)
                }
            }

            const result = await this.aiService.sendMessage({
                prompt: followUpMessage,
                client: cachedClient,
                sessionId: process.sdkSessionId,
                mode: agentMode,
                workingDirectory,
                reasoningEffort: 'high',
                systemMessage: historySystemMessage,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                attachments,
                deliveryMode: resolvedDeliveryMode,
                tools: suggestTools.length > 0 ? suggestTools : undefined,
                skillDirectories,
                disabledSkills,
                onSessionCreated: (sessionId: string) => {
                    this.store.updateProcess(processId, { sdkSessionId: sessionId }).catch(() => {});
                },
                onStreamingChunk: (chunk: string) => {
                    this.getOrCreateSession(processId).outputBuffer += chunk;
                    this.appendTimelineItem(processId, { type: 'content', timestamp: new Date(), content: chunk });
                    try {
                        this.store.emitProcessOutput(processId, chunk);
                    } catch {
                        // Non-fatal
                    }
                    this.checkThrottleAndFlush(processId);
                },
                onToolEvent: this.buildToolEventHandler(
                    processId,
                    () => process.conversationTurns?.length ?? 0,
                ),
                onBackgroundTasksChanged: this.buildBackgroundTaskHandler(processId),
            });

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

            if (result.tokenUsage) {
                try {
                    this.store.emitProcessEvent(processId, {
                        type: 'token-usage',
                        turnIndex: assistantTurn.turnIndex,
                        tokenUsage: result.tokenUsage,
                        sessionTokenLimit: result.tokenUsage.tokenLimit,
                        sessionCurrentTokens: result.tokenUsage.currentTokens,
                    });
                } catch {
                    // Non-fatal
                }
            }

            this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);

            this.onTitleNeeded?.(processId, allTurns);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[FollowUp] Failed for ${processId} in ${duration}ms: ${errorMsg}`);

            await this.store.appendConversationTurn(
                processId,
                (turnIndex) => ({
                    role: 'assistant' as const,
                    content: `Error: ${errorMsg}`,
                    timestamp: new Date(),
                    turnIndex,
                    timeline: [],
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
            const buffer = this.sessions.get(processId)?.outputBuffer ?? '';
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer);
        }
    }
}
