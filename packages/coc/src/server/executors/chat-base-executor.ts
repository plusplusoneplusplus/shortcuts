/**
 * Chat Mode Base Executor
 *
 * Abstract base class for the three AI chat-mode executors (chat/plan/autopilot).
 * Owns the shared AI SDK call lifecycle: image handling, availability check, skill
 * resolution, tool-call capture, streaming, session cleanup, and output persistence.
 *
 * Subclasses implement `buildModeOptions()` to supply mode-specific params:
 * - agentMode (interactive | plan | autopilot)
 * - systemMessage (mode-specific prompt restrictions)
 * - tools (follow-up suggestions or other injected tools)
 * - effectivePrompt (prompt with any mode-specific suffix appended)
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as os from 'os';
import * as path from 'path';
import type {
    AgentMode,
    Attachment,
    AutoFolderContext,
    MemoryToolCaptureContext,
    ModelInfo,
    ISDKService,
    ProcessStore,
    QueuedTask,
    SDKInvocationResult,
    SystemMessageConfig,
    TimelineItem,
    Tool,
    ToolEvent,
} from '@plusplusoneplusplus/forge';
import {
    approveAllPermissions,
    FileToolCallCacheStore,
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    modelMetadataStore,
    resolveReasoningSelection,
    TASK_FILTER,
    ToolCallCapture,
    rewriteLargePrompt,
    toQueueProcessId,
} from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import { saveImagesToTempFiles, cleanupTempDir, rehydrateImagesIfNeeded } from './image-store';
import type { BroadcastWorkItemFn } from '../llm-tools/create-work-item-tool';
import { BaseExecutor } from './base-executor';
import { resolveDefaultModel } from '../preferences-handler';
import { loadConfigFile } from '../../config';
import {
    assertNoAskUserConflict,
    buildBoundedMemoryAddon,
    buildModeSystemMessage,
    prependSelectedSkillsDirective,
} from './prompt-builder';
import type { BoundedMemoryAddon } from './bounded-memory-addon';
import { resolveAutoFolderContext } from './auto-folder-utils';
import { systemMessageBuilder } from './system-message-builder';
import { buildChatToolBundle } from './chat-tool-builder';
import { getPromptOverride } from '../admin/ralph-prompt-overrides';

// ============================================================================
// Ralph grilling-phase system message suffix
// ============================================================================

/** Default system-prompt suffix appended when `payload.context.ralph.phase === 'grilling'`. */
export const RALPH_GRILL_SUFFIX = [
    '## Ralph Grilling Phase — Clarification Protocol',
    '',
    'You are in the Ralph grilling phase. Your job right now is to interactively interview the user to nail down a precise goal spec before any coding begins.',
    '',
    'Rules for this phase (these OVERRIDE any earlier guidance about ask_user):',
    '- Use the `ask_user` tool for EVERY clarification, confirmation, or choice question. Do NOT write clarification questions as plain assistant text.',
    '- Batch related questions into a SINGLE `ask_user` call by passing multiple entries in `questions[]`. Do not call the tool repeatedly for one round of clarification.',
    '- Yes/no clarifications ARE in scope here — ignore the earlier "Do NOT use ask_user for simple yes/no" guidance during grilling. In this phase, simple yes/no clarifications MUST also go through `ask_user`.',
    '- Keep questions concrete and answerable. Prefer choice questions with explicit options when there are a few obvious paths.',
    '- Only after the user explicitly signals they are done (e.g. "enough", "go", "that\'s it") OR you have gathered enough answers to write a precise spec, emit the final goal-spec block as plain assistant text using the template below. Do not emit the goal spec while still asking questions.',
    '',
    'Final goal-spec template (emit ONLY at the end, as plain assistant text — not via ask_user):',
    '',
    '## Goal',
    '<one-sentence goal>',
    '',
    '## Acceptance Criteria',
    '<bullet list>',
    '',
    '## Constraints / Tech Context',
    '<bullet list>',
    '',
    '## Out of Scope',
    '<bullet list>',
    '',
    'This spec will be used to drive an automated coding loop. Be precise and concrete.',
].join('\n');

// ============================================================================
// Types
// ============================================================================

/** Late-bound loop infrastructure deps (created after executor registry). */
export interface LoopInfraDeps {
    store: import('../loops/loop-store').LoopStore;
    executor: import('../loops/loop-executor').LoopExecutor;
    /** Loop event emitter (used by LLM tools to broadcast state changes). */
    emit?: import('../loops/loop-executor').LoopEventEmit;
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    enqueueWakeup: (opts: {
        processId: string;
        prompt: string;
        delayMs: number;
        wakeupId: string;
        model?: string;
        workspaceId?: string;
    }) => void;
}

export interface ChatModeExecutorOptions {
    /** Default working directory for AI sessions */
    workingDirectory?: string;
    /** Whether to auto-approve AI permission requests (default: true) */
    approvePermissions?: boolean;
    /** The AI service instance to use for sending messages */
    aiService: ISDKService;
    /** Default timeout in ms for tasks that do not specify their own timeoutMs */
    defaultTimeoutMs: number;
    /** Follow-up suggestions configuration */
    followUpSuggestions: { enabled: boolean; count: number };
    /** Ask-user interactive tool configuration */
    askUser?: { enabled: boolean };
    /** Shared store for tool-call Q&A capture (explore cache) */
    toolCallCacheStore: FileToolCallCacheStore;
    /** Resolve skill configuration for a workspace */
    resolveSkillConfig: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    /** Resolve workspace ID for a root path */
    resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
    /** Late-bound loop infrastructure (getter because loop infra is created after executor registry). */
    getLoopInfra?: () => LoopInfraDeps | undefined;
    /** Late-bound MCP OAuth manager (getter to allow optional/feature-flagged wiring). */
    getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined;
    /** Active AI provider. Used to detect provider mismatches on follow-up resume. */
    provider?: 'copilot' | 'codex';
}

/** Return type for the AI call result. */
export interface ChatModeExecutionResult {
    response: string;
    sessionId?: string;
    toolCalls?: unknown[];
    /** Merged timeline captured from the executor session before cleanup. */
    timeline: TimelineItem[];
    /** Follow-up suggestions emitted via suggest_follow_ups tool, if any. */
    pendingSuggestions?: string[];
}

/** Mode-specific AI call parameters supplied by each concrete executor. */
export interface ChatModeAIOptions {
    agentMode: AgentMode | undefined;
    systemMessage: SystemMessageConfig | undefined;
    tools: Tool<unknown>[];
    /** Prompt with any mode-specific suffix already appended. */
    effectivePrompt: string;
    /** Clean up resources (e.g. raw memory DB handles) after execution. */
    dispose?: () => void;
}

// ============================================================================
// ChatBaseExecutor
// ============================================================================

export abstract class ChatBaseExecutor extends BaseExecutor {
    protected readonly approvePermissions: boolean;
    protected readonly defaultWorkingDirectory?: string;
    protected readonly aiService: ISDKService;
    protected readonly defaultTimeoutMs: number;
    protected readonly followUpSuggestions: { enabled: boolean; count: number };
    protected readonly askUser: { enabled: boolean };
    protected readonly toolCallCacheStore: FileToolCallCacheStore;
    protected readonly resolveSkillConfigFn: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    protected readonly resolveWorkspaceIdForPathFn: (rootPath: string) => Promise<string>;
    protected readonly getLoopInfra?: () => LoopInfraDeps | undefined;
    protected readonly getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined;
    /** Active AI provider — used to guard against provider mismatches on follow-up resume. */
    protected readonly provider: 'copilot' | 'codex';

    constructor(store: ProcessStore, options: ChatModeExecutorOptions, dataDir?: string) {
        super(store, dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService;
        this.defaultTimeoutMs = options.defaultTimeoutMs;
        this.followUpSuggestions = options.followUpSuggestions;
        this.askUser = options.askUser ?? { enabled: false };
        this.toolCallCacheStore = options.toolCallCacheStore;
        this.resolveSkillConfigFn = options.resolveSkillConfig;
        this.resolveWorkspaceIdForPathFn = options.resolveWorkspaceIdForPath;
        this.getLoopInfra = options.getLoopInfra;
        this.getMcpOauthManager = options.getMcpOauthManager;
        this.provider = options.provider ?? 'copilot';
    }

    /**
     * Build per-request loop tool deps from the late-bound loop infrastructure.
     * Returns `scheduleWakeup` deps (always) and `loopTools` deps (always,
     * but gated by skill activation in buildChatToolBundle).
     */
    protected buildLoopToolDeps(processId: string): {
        scheduleWakeup?: import('../llm-tools/loop-tools').WakeupToolDeps;
        loopTools?: import('../llm-tools/loop-tools').LoopToolDeps;
    } {
        const infra = this.getLoopInfra?.();
        if (!infra) return {};
        return {
            scheduleWakeup: {
                executor: infra.executor,
                processId,
                resolveWorkspaceId: infra.resolveWorkspaceId,
                enqueueWakeup: infra.enqueueWakeup,
            },
            loopTools: {
                store: infra.store,
                executor: infra.executor,
                processId,
                resolveWorkspaceId: infra.resolveWorkspaceId,
                emit: infra.emit,
            },
        };
    }

    protected async getModelMetadataForReasoning(modelId: string | undefined): Promise<ModelInfo | undefined> {
        if (!modelId) {
            return undefined;
        }

        let model = modelMetadataStore.getModel(modelId);
        if (!model && !modelMetadataStore.isInitialized()) {
            await modelMetadataStore.initialize(this.aiService as unknown as { listModels(): Promise<ModelInfo[]> });
            model = modelMetadataStore.getModel(modelId);
        }
        return model;
    }

    // ========================================================================
    // Template method — subclasses provide mode-specific AI options
    // ========================================================================

    /**
     * Build mode-specific AI call options: agent mode, system message, tools,
     * and the final effective prompt (with any mode suffix appended).
     */
    protected abstract buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions>;

    // ========================================================================
    // Shared helper — capture context for bounded memory addon
    // ========================================================================

    /**
     * Build a MemoryToolCaptureContext from a queued task.
     * Used by all chat-mode executors to activate capture mode.
     */
    protected buildCaptureContext(task: QueuedTask): MemoryToolCaptureContext {
        return {
            processId: toQueueProcessId(task.id),
            turnIndex: 0,
        };
    }

    /** Build bounded-memory wiring for a workspace. */
    protected buildMemoryAddon(
        workspaceId: string | undefined,
        captureContext?: MemoryToolCaptureContext,
        recallQuery?: string,
    ): Promise<BoundedMemoryAddon> {
        return buildBoundedMemoryAddon(this.dataDir, workspaceId, captureContext, recallQuery);
    }

    // ========================================================================
    // Shared helper — auto-folder context (used by ask and plan modes)
    // ========================================================================

    /**
     * Resolve the target root directory and list existing sub-folders.
     *
     * When `isPlanMode` is true the target root is `notes/Plans/` (auto-created)
     * so that plan files land in the Notes tab rather than the Tasks tree.
     * All other modes continue to use the tasks root.
     */
    protected async buildAutoFolderContext(
        workingDirectory: string,
        workspaceId?: string,
        mode: 'ask' | 'plan' = 'ask',
    ): Promise<AutoFolderContext> {
        return resolveAutoFolderContext({
            dataDir: this.dataDir,
            workingDirectory,
            workspaceId,
            mode,
            resolveWorkspaceIdForPath: this.resolveWorkspaceIdForPathFn,
        });
    }

    protected async buildStandardModeOptions(
        task: QueuedTask,
        prompt: string,
        mode: 'ask' | 'plan',
        workingDirectory: string | undefined,
        broadcastWorkItem?: BroadcastWorkItemFn,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;

        const autoFolderContext = workingDirectory
            ? await this.buildAutoFolderContext(workingDirectory, payload.workspaceId, mode)
            : undefined;

        const boundedMemory = await this.buildMemoryAddon(payload.workspaceId, this.buildCaptureContext(task), prompt);
        const notePath = payload.context?.noteChat?.notePath;

        const processId = toQueueProcessId(task.id);
        const loopDeps = this.buildLoopToolDeps(processId);

        const toolBundle = buildChatToolBundle({
            dataDir: this.dataDir,
            store: this.store,
            workspaceId: payload.workspaceId,
            processId,
            followUpSuggestions: this.followUpSuggestions,
            broadcastWorkItem,
            boundedMemory,
            scheduleWakeup: loopDeps.scheduleWakeup,
            loopTools: loopDeps.loopTools,
            askUser: {
                enabled: (mode === 'plan' || mode === 'ask') && this.askUser.enabled,
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
                    computeTurnIndex: () => 1,
                },
            },
        });
        const session = this.getOrCreateSession(processId);
        session.pendingAskUser = {
            answerQuestion: toolBundle.askUser!.answerQuestion,
            skipQuestion: toolBundle.askUser!.skipQuestion,
            answerQuestions: toolBundle.askUser!.answerQuestions,
            cancelAll: toolBundle.askUser!.cancelAll,
            hasPending: toolBundle.askUser!.hasPending,
        };

        const systemMessage = await systemMessageBuilder()
            .append(buildModeSystemMessage(mode)?.content)
            .withRepoInstructions(workingDirectory, mode)
            .appendMemory(boundedMemory)
            .appendToolGuidance(toolBundle.toolGuidance)
            .appendAutoFolder(autoFolderContext)
            .appendNoteFile(notePath)
            .build();

        // When this is a Ralph grilling session, append the goal-spec instruction.
        if (payload.context?.ralph?.phase === 'grilling' && systemMessage) {
            const ralphGrillSuffix = (this.dataDir
                ? (getPromptOverride('ralph-grill-suffix', this.dataDir) ?? RALPH_GRILL_SUFFIX)
                : RALPH_GRILL_SUFFIX);
            systemMessage.content = systemMessage.content
                ? systemMessage.content + '\n\n' + ralphGrillSuffix
                : ralphGrillSuffix;
        }

        return {
            agentMode: mode === 'plan' ? 'plan' as AgentMode : 'interactive' as AgentMode,
            systemMessage,
            tools: toolBundle.tools,
            effectivePrompt: prompt,
            dispose: boundedMemory.dispose,
        };
    }

    // ========================================================================
    // Shared execute — AI call lifecycle
    // ========================================================================

    /**
     * Execute a chat-mode AI task.
     *
     * Flow:
     * 1. Resolve working directory from task payload
     * 2. Call buildModeOptions() to get mode-specific params
     * 3. Initialize session, register flush handler
     * 4. Rehydrate and save images to temp files
     * 5. Check AI availability
     * 6. Resolve skill configuration
     * 7. Set up tool-call capture
     * 8. Send message via AI SDK with streaming callbacks
     * 9. Return { response, sessionId, toolCalls }
     * 10. In finally: cleanup images, session, flush handler, persist output
     */
    async execute(task: QueuedTask, prompt: string): Promise<ChatModeExecutionResult> {
        const processId = toQueueProcessId(task.id);
        const payload = task.payload as unknown as ChatPayload;
        const workingDirectory = payload.workingDirectory || payload.folderPath || this.defaultWorkingDirectory;

        let { agentMode, systemMessage, tools, effectivePrompt, dispose: modeDispose } = await this.buildModeOptions(task, prompt, workingDirectory);

        this.persistSystemPromptAsync(processId, task.type, systemMessage?.content);

        this.getOrCreateSession(processId).outputBuffer = '';
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        // Rehydrate externalized images from blob store before image decoding
        await rehydrateImagesIfNeeded(payload as unknown as Record<string, unknown>);

        let attachments: Attachment[] | undefined;
        let imageTempDir: string | undefined;
        let pasteCleanup: (() => void) | undefined;
        const payloadRecord = payload as unknown as Record<string, unknown>;
        const payloadImages = payloadRecord?.images;

        // Honor pre-decoded SDK attachments + temp dir set by the API layer
        // (e.g. /api/queue for new chats, or drainPendingMessages for buffered
        // follow-ups). When present we skip the legacy data-URL decode path
        // entirely so we don't double-write or leak the existing temp dir.
        const preBuiltAttachments = Array.isArray(payloadRecord?.attachments)
            ? (payloadRecord.attachments as unknown[]).filter(
                (a): a is Attachment =>
                    !!a
                    && typeof a === 'object'
                    && (a as Record<string, unknown>).type === 'file'
                    && typeof (a as Record<string, unknown>).path === 'string',
            )
            : undefined;
        const preBuiltTempDir = typeof payloadRecord?.imageTempDir === 'string'
            ? payloadRecord.imageTempDir as string
            : undefined;

        if (preBuiltAttachments && preBuiltAttachments.length > 0) {
            attachments = preBuiltAttachments;
            imageTempDir = preBuiltTempDir;
        } else if (Array.isArray(payloadImages) && payloadImages.length > 0) {
            const validImages = payloadImages
                .filter((img: unknown) => typeof img === 'string')
                .slice(0, 10) as string[];
            if (validImages.length > 0) {
                const saved = saveImagesToTempFiles(validImages);
                imageTempDir = saved.tempDir;
                attachments = saved.attachments.length > 0 ? saved.attachments : undefined;
            }
        }

        try {
            // Rewrite large prompts to file-path references
            const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
            const wsId = payload.workspaceId;
            if (wsId) {
                const rewritten = await rewriteLargePrompt(effectivePrompt, effectiveDataDir, wsId);
                if (rewritten) {
                    effectivePrompt = rewritten.rewrittenPrompt;
                    pasteCleanup = rewritten.cleanup;
                }
            }

            const availability = await this.aiService.isAvailable();
            if (!availability.available) {
                throw new Error(`Copilot SDK not available: ${availability.error || 'unknown reason'}`);
            }

            const timeoutMs = task.config.timeoutMs || this.defaultTimeoutMs;
            const taskWorkspaceId = payload.workspaceId;
            const { skillDirectories, disabledSkills } = await this.resolveSkillConfigFn(taskWorkspaceId, workingDirectory);
            effectivePrompt = prependSelectedSkillsDirective(
                effectivePrompt,
                (payload as ChatPayload).context?.skills,
            );

            let captureHandler: ((event: ToolEvent) => void) | undefined;
            try {
                const capture = new ToolCallCapture(this.toolCallCacheStore, TASK_FILTER);
                captureHandler = capture.createToolEventHandler();
            } catch (err) {
                getLogger().warn(LogCategory.AI, `[ChatModeExecutor] ToolCallCapture setup failed: ${err}`);
            }

            const toolEventHandler = this.buildToolEventHandler(
                processId,
                () => 1,
            );

            const sendTools = tools.length > 0 ? tools : undefined;
            // Guard: CoC uses its custom ask_user tool (SSE/widget flow).
            // The SDK's native onUserInputRequest must NOT be set at the same time.
            assertNoAskUserConflict({ tools: sendTools });

            // Resolve per-repo default model when no explicit model is set on the task.
            let effectiveModel = task.config.model;
            if (!effectiveModel && this.dataDir && payload.workspaceId) {
                const chatMode = payload.mode;
                const defaultModelMode = chatMode === 'autopilot' || chatMode === 'ralph'
                    ? 'task' as const
                    : chatMode as 'ask' | 'plan';
                effectiveModel = resolveDefaultModel(this.dataDir, payload.workspaceId, defaultModelMode);
            }

            // Resolve reasoning effort: explicit task config > persisted per-model preference > SDK default
            let requestedEffort: Parameters<typeof resolveReasoningSelection>[0]['requestedEffort'] = task.config.reasoningEffort;
            if (!requestedEffort && effectiveModel) {
                const cfg = loadConfigFile();
                const persisted = cfg?.models?.reasoningEfforts?.[effectiveModel];
                if (persisted) requestedEffort = persisted as NonNullable<typeof requestedEffort>;
            }
            const reasoningSelection = resolveReasoningSelection({
                modelId: effectiveModel,
                requestedEffort,
                model: await this.getModelMetadataForReasoning(effectiveModel),
            });

            const sendOptions = {
                prompt: effectivePrompt,
                mode: agentMode,
                model: reasoningSelection.modelId,
                ...(reasoningSelection.reasoningEffort ? { reasoningEffort: reasoningSelection.reasoningEffort } : {}),
                infiniteSessions: { enabled: true } as const,
                workingDirectory,
                timeoutMs,
                attachments,
                tools: sendTools,
                systemMessage,
                skillDirectories,
                disabledSkills,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                onSessionCreated: (sessionId: string) => {
                    this.store.updateProcess(processId, { sdkSessionId: sessionId }).catch(() => {
                        // Non-fatal: store may be a stub
                    });
                },
                onStreamingChunk: (chunk: string) => {
                    this.getOrCreateSession(processId).outputBuffer += chunk;
                    this.appendTimelineItem(processId, { type: 'content', timestamp: new Date(), content: chunk });
                    try {
                        this.store.emitProcessOutput(processId, chunk);
                    } catch {
                        // Non-fatal: store may be a stub
                    }
                    this.checkThrottleAndFlush(processId);
                },
                onToolEvent: captureHandler
                    ? (event: ToolEvent) => {
                        try { toolEventHandler(event); } catch { /* non-fatal */ }
                        try { captureHandler!(event); } catch { /* non-fatal */ }
                    }
                    : toolEventHandler,
                onBackgroundTasksChanged: this.buildBackgroundTaskHandler(processId),
                onMcpOAuthRequired: (() => {
                    const manager = this.getMcpOauthManager?.();
                    if (!manager) {
                        getLogger().debug(LogCategory.AI, `[ChatModeExecutor] No McpOauthManager wired — MCP OAuth events will not be tracked for process ${processId}`);
                        return undefined;
                    }
                    return (event: { serverName: string; serverUrl: string; authorizationUrl?: string; requestId: string }) => {
                        getLogger().info(
                            LogCategory.MCP,
                            `[ChatModeExecutor] MCP OAuth event received: server=${event.serverName} url=${event.serverUrl} requestId=${event.requestId} hasAuthUrl=${!!event.authorizationUrl} processId=${processId} workspaceId=${payload.workspaceId ?? '(none)'}`,
                        );
                        try {
                            const entry = manager.addPending({
                                requestId: event.requestId,
                                serverName: event.serverName,
                                serverUrl: event.serverUrl,
                                authorizationUrl: event.authorizationUrl,
                                processId,
                                workspaceId: payload.workspaceId,
                                originalMessage: prompt,
                            });
                            getLogger().debug(
                                LogCategory.MCP,
                                `[ChatModeExecutor] MCP OAuth entry registered: id=${entry.id} server=${event.serverName} status=${entry.status}`,
                            );
                            // Emit SSE event so the dashboard can prompt the user
                            try {
                                this.store.emitProcessEvent(processId, {
                                    type: 'mcp-oauth-required',
                                    mcpOAuth: {
                                        requestId: entry.id,
                                        serverName: event.serverName,
                                        serverUrl: event.serverUrl,
                                        authorizationUrl: event.authorizationUrl,
                                    },
                                });
                            } catch {
                                // Non-fatal: SSE emission must not interrupt the session
                            }
                        } catch (oauthErr) {
                            // Non-fatal: OAuth dispatch must not interrupt the session.
                            getLogger().warn(
                                LogCategory.MCP,
                                `[ChatModeExecutor] Failed to register MCP OAuth entry for server=${event.serverName} requestId=${event.requestId}: ${oauthErr instanceof Error ? oauthErr.message : String(oauthErr)}`,
                            );
                        }
                    };
                })(),
            };

            let result: SDKInvocationResult;
            result = await this.aiService.sendMessage(sendOptions) as SDKInvocationResult;

            if (!result.success) {
                throw new Error(result.error || 'AI execution failed');
            }

            // Capture session state BEFORE the finally block runs cleanup.
            // (return value expressions are evaluated before finally executes)
            const finalTimeline = mergeConsecutiveContentItems(
                this.sessions.get(processId)?.timelineBuffer ?? [],
            );
            const pendingSuggestions = this.sessions.get(processId)?.pendingSuggestions;

            return {
                response: result.response || '(Task completed via tool execution — no text response produced)',
                sessionId: result.sessionId,
                toolCalls: result.toolCalls,
                timeline: finalTimeline,
                pendingSuggestions,
            };
        } finally {
            if (imageTempDir) { cleanupTempDir(imageTempDir); }
            if (pasteCleanup) { pasteCleanup(); }
            modeDispose?.();
            // Cancel any pending ask-user questions before cleanup
            this.sessions.get(processId)?.pendingAskUser?.cancelAll();
            try {
                await this.clearPendingAskUser(processId);
            } catch (err) {
                getLogger().debug(
                    LogCategory.AI,
                    `[ChatModeExecutor] Failed to clear pending ask-user for ${processId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
            const buffer = this.sessions.get(processId)?.outputBuffer ?? '';
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer, payload.workspaceId);
        }
    }
}
