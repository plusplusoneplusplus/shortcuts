/**
 * Chat Mode Base Executor
 *
 * Abstract base class for the AI chat-mode executors.
 * Owns the shared AI SDK call lifecycle: image handling, availability check, skill
 * resolution, tool-call capture, streaming, session cleanup, and output persistence.
 *
 * Subclasses implement `buildModeOptions()` to supply mode-specific params:
 * - agentMode (interactive | autopilot)
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
    ModelInfo,
    ISDKService,
    ProcessStore,
    QueuedTask,
    SDKInvocationResult,
    SystemMessageConfig,
    TimelineItem,
    TokenUsage,
} from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import {
    approveAllPermissions,
    findClaudeCatalogModel,
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    modelMetadataStore,
    resolveModelForProvider,
    resolveReasoningSelection,
    rewriteLargePrompt,
    toForwardSlashes,
    toQueueProcessId,
} from '@plusplusoneplusplus/forge';
import type { ChatPayload, ChatProvider, PrClassificationPayload } from '../tasks/task-types';
import { getForEachContext, getMapReduceContext, isForEachGenerationContext, isMapReduceGenerationContext, normalizeChatModeOrDefault } from '../tasks/task-types';
import { saveImagesToTempFiles, cleanupTempDir, rehydrateImagesIfNeeded } from './image-store';
import type { BroadcastWorkItemFn } from '../llm-tools/create-update-work-item-tool';
import { BaseExecutor } from './base-executor';
import { resolveDefaultModel } from '../preferences-handler';
import { loadConfigFile } from '../../config';
import {
    assertNoAskUserConflict,
    buildForEachGenerationSystemMessage,
    buildMapReduceGenerationSystemMessage,
    buildModeSystemMessage,
    prependSelectedSkillsDirective,
    resolveSelectedSkillReferences,
} from './prompt-builder';
import { buildMemoryV2Addon } from './memory-v2-addon';
import type { MemoryV2Addon } from './memory-v2-addon';
import { resolveAutoFolderContext } from './auto-folder-utils';
import { systemMessageBuilder } from './system-message-builder';
import { buildChatTurnContext } from './chat-turn-context-builder';
// ============================================================================
// Ralph grilling-phase system message suffix
// ============================================================================

/** Default user-message suffix prepended when `payload.context.ralph.phase === 'grilling'`. */
export const RALPH_GRILL_SUFFIX = `\
Load and follow the \`ultra-ralph\` skill, \`grill\` section. The skill file is at ~/.coc/skills/ultra-ralph/SKILL.md.

Machine contract (parser-required): After gathering answers and before ending, emit exactly one plain-text goal spec block starting with \`## Goal\`.`;

export interface RalphGrillSuffixOptions {
    workItemGoal?: {
        workspaceId?: string;
        workItemId?: string;
        title?: string;
    };
}

/**
 * Build the Ralph grilling-phase directive that is prepended to the user
 * message (never the system message) on every grilling turn.
 *
 * When an {@link AutoFolderContext} is supplied (resolved to the repo's
 * `notes/Plans` root for ask mode), an explicit goal-file save-location
 * directive is appended so the model persists the final spec as a
 * `*.goal.md` file under `~/.coc/.../notes/Plans/`. This keeps the goal file
 * out of the repository working tree and lets the Notes/scratchpad UI open and
 * manually edit it. The directive lives here in CoC so the generic `grill-me`
 * skill stays host-agnostic.
 */
export function buildRalphGrillSuffix(autoFolderContext?: AutoFolderContext, options: RalphGrillSuffixOptions = {}): string {
    if (options.workItemGoal) {
        const title = options.workItemGoal.title?.trim();
        const goalLabel = title ? ` "${title}"` : '';
        return `${RALPH_GRILL_SUFFIX}\n\nWork Item Goal${goalLabel}: this grilling session is bound to a local Goal item in the Work Items system. Do not create or require a Notes-backed \`.goal.md\` file for this workflow. When the user is done, emit the final \`## Goal\` spec in chat so the Work Item workflow can save it as an immutable Goal content version.`;
    }
    if (!autoFolderContext) return RALPH_GRILL_SUFFIX;

    const root = toForwardSlashes(autoFolderContext.tasksRoot);
    const filtered = autoFolderContext.existingFolders.filter(
        f => f !== 'archive' && !f.startsWith('archive/'),
    );
    const folderList = filtered.length > 0 ? filtered.join(', ') : '(none yet)';
    const fileBlock = `\
Goal file: persist the final goal spec as a file at \`${root}/<chosen-folder>/<descriptive-name>.goal.md\` so it appears in the Notes tab and can be opened and edited manually. Pick the most relevant existing folder or create a new kebab-case one (≤3 words). Existing folders: ${folderList}. Do not write the goal file into the repository working tree.`;

    return `${RALPH_GRILL_SUFFIX}\n\n${fileBlock}`;
}

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
    /** Resolve skill configuration for a workspace */
    resolveSkillConfig: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    /** Resolve workspace ID for a root path */
    resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
    /** Late-bound loop infrastructure (getter because loop infra is created after executor registry). */
    getLoopInfra?: () => LoopInfraDeps | undefined;
    /** Late-bound MCP OAuth manager (getter to allow optional/feature-flagged wiring). */
    getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined;
    /** Active AI provider. Used to detect provider mismatches on follow-up resume. */
    provider?: 'copilot' | 'codex' | 'claude';
    /**
     * Resolve an ISDKService for a given provider name, checking enablement and
     * availability. Throws with a user-facing message if the provider is disabled
     * or unavailable. Falls back to sdkServiceRegistry lookup when omitted.
     */
    resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
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
    /** Token consumption data returned by the SDK, if available. */
    tokenUsage?: TokenUsage;
    /** Model that the provider actually used. Omitted means provider default. */
    effectiveModel?: string;
}

/** Mode-specific AI call parameters supplied by each concrete executor. */
export interface ChatModeAIOptions {
    agentMode: AgentMode | undefined;
    systemMessage: SystemMessageConfig | undefined;
    tools: Tool<unknown>[];
    /** Prompt with any mode-specific suffix already appended. */
    effectivePrompt: string;
    /** Built-in tool names to suppress for this session. */
    excludedTools?: string[];
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
    protected readonly resolveSkillConfigFn: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    protected readonly resolveWorkspaceIdForPathFn: (rootPath: string) => Promise<string>;
    protected readonly getLoopInfra?: () => LoopInfraDeps | undefined;
    protected readonly getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined;
    /** Active AI provider — used to guard against provider mismatches on follow-up resume. */
    protected readonly provider: 'copilot' | 'codex' | 'claude';
    /** Resolves per-task SDK service by provider, checking enablement. Optional — falls back to sdkServiceRegistry. */
    protected readonly resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
    /**
     * Per-provider model-metadata cache for reasoning-effort resolution. The
     * shared `modelMetadataStore` is warmed from the default provider only, so
     * non-default providers (Codex/Claude) resolve from their own `listModels()`
     * result, cached here to avoid re-spawning a CLI on every turn.
     */
    private readonly providerReasoningModelCache = new Map<ChatProvider, ModelInfo[]>();

    constructor(store: ProcessStore, options: ChatModeExecutorOptions, dataDir?: string) {
        super(store, dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService;
        this.defaultTimeoutMs = options.defaultTimeoutMs;
        this.followUpSuggestions = options.followUpSuggestions;
        this.askUser = options.askUser ?? { enabled: false };
        this.resolveSkillConfigFn = options.resolveSkillConfig;
        this.resolveWorkspaceIdForPathFn = options.resolveWorkspaceIdForPath;
        this.getLoopInfra = options.getLoopInfra;
        this.getMcpOauthManager = options.getMcpOauthManager;
        this.provider = options.provider ?? 'copilot';
        this.resolveAiServiceForProvider = options.resolveAiServiceForProvider;
    }

    /**
     * Resolve the ISDKService to use for a given provider.
     * Uses the injected resolveAiServiceForProvider callback when present;
     * otherwise falls back to this.aiService (backward-compatible test path).
     * In production, resolveAiServiceForProvider is always provided by the server
     * and performs live enablement + registry lookup.
     */
    protected getAiServiceForProvider(provider: ChatProvider): ISDKService {
        if (this.resolveAiServiceForProvider) {
            return this.resolveAiServiceForProvider(provider);
        }
        // Fallback: use the default aiService injected at construction time.
        // This preserves backward compatibility for tests that inject aiService
        // directly without the resolveAiServiceForProvider callback.
        // In production, resolveAiServiceForProvider is always injected.
        return this.aiService;
    }

    /**
     * Build per-request loop tool deps from the late-bound loop infrastructure.
     * Returns `scheduleWakeup` deps (always) and `loopTools` deps (always,
     * but gated by skill activation in buildChatTurnContext).
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

    protected async getModelMetadataForReasoning(
        modelId: string | undefined,
        provider?: ChatProvider,
        service?: ISDKService,
    ): Promise<ModelInfo | undefined> {
        if (modelId) {
            let model = modelMetadataStore.getModel(modelId);
            if (!model && !modelMetadataStore.isInitialized()) {
                await modelMetadataStore.initialize(this.aiService as unknown as { listModels(): Promise<ModelInfo[]> });
                model = modelMetadataStore.getModel(modelId);
            }
            if (model) {
                return model;
            }
        }

        // The shared store only holds the default provider's catalog (typically
        // Copilot). For other providers, resolve from that provider's own model
        // list so reasoning-effort validation sees the model's supported efforts
        // instead of failing with "Supported efforts: unknown". An undefined
        // modelId (provider default) resolves to the provider's own default
        // catalog entry when it advertises one.
        if (provider && provider !== 'copilot' && service) {
            return this.getProviderReasoningModel(provider, service, modelId);
        }
        return undefined;
    }

    private async getProviderReasoningModel(
        provider: ChatProvider,
        service: ISDKService,
        modelId: string | undefined,
    ): Promise<ModelInfo | undefined> {
        let models = this.providerReasoningModelCache.get(provider);
        if (!models) {
            if (typeof service.listModels !== 'function') {
                return undefined;
            }
            try {
                models = await service.listModels() as unknown as ModelInfo[];
                this.providerReasoningModelCache.set(provider, models);
            } catch {
                // Leave the cache unset so a later turn can retry discovery.
                return undefined;
            }
        }
        // Claude catalogs use CLI alias ids ('default'/'opus'/'haiku') while
        // configs and effort tiers may carry family aliases ('sonnet') or
        // legacy dashed/dotted ids — bridge those shapes. Other providers
        // match by exact id only.
        if (provider === 'claude') {
            return findClaudeCatalogModel(models, modelId);
        }
        return modelId ? models.find(m => m.id === modelId) : undefined;
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

    /** Build Memory V2 addon (redesigned coc-memory system). */
    protected buildMemoryV2Addon(
        workspaceId: string | undefined,
        query?: string,
        processId?: string,
    ): Promise<MemoryV2Addon> {
        return buildMemoryV2Addon(this.dataDir, workspaceId, query, processId);
    }

    // ========================================================================
    // Shared helper — auto-folder context (used by ask mode)
    // ========================================================================

    /**
     * Resolve the target root directory and list existing sub-folders.
     *
     * Ask mode uses `notes/Plans/` (auto-created) so generated plans land in
     * the Notes tab rather than the Tasks tree. All other modes use tasks root.
     */
    protected async buildAutoFolderContext(
        workingDirectory: string,
        workspaceId?: string,
        mode: 'ask' = 'ask',
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
        mode: 'ask',
        workingDirectory: string | undefined,
        broadcastWorkItem?: BroadcastWorkItemFn,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;

        const autoFolderContext = workingDirectory
            ? await this.buildAutoFolderContext(workingDirectory, payload.workspaceId, mode)
            : undefined;

        const processId = toQueueProcessId(task.id);
        const notePath = payload.context?.noteChat?.notePath;

        const loopDeps = this.buildLoopToolDeps(processId);

        const ctx = await buildChatTurnContext({
            dataDir: this.dataDir,
            store: this.store,
            workspaceId: payload.workspaceId,
            processId,
            query: prompt,
            followUpSuggestions: this.followUpSuggestions,
            broadcastWorkItem,
            scheduleWakeup: loopDeps.scheduleWakeup,
            loopTools: loopDeps.loopTools,
            askUser: {
                enabled: mode === 'ask' && this.askUser.enabled,
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
            answerQuestion: ctx.askUser!.answerQuestion,
            skipQuestion: ctx.askUser!.skipQuestion,
            answerQuestions: ctx.askUser!.answerQuestions,
            cancelAll: ctx.askUser!.cancelAll,
            hasPending: ctx.askUser!.hasPending,
        };

        const isGrilling = payload.context?.ralph?.phase === 'grilling';
        const workItemGoalGrilling = payload.context?.workItemGoalGrilling;
        const forEachGeneration = (() => {
            const context = getForEachContext({ payload });
            return isForEachGenerationContext(context) ? context : null;
        })();
        const mapReduceGeneration = (() => {
            const context = getMapReduceContext({ payload });
            return isMapReduceGenerationContext(context) ? context : null;
        })();

        // During grilling, the user-message directive owns the output contract
        // (Notes goal file for general Ralph, Work Item versioning for Goal items).
        // Suppress the generic auto-folder system block so the model does not
        // receive a contradictory `.plan.md` save target.
        const systemMessage = await systemMessageBuilder()
            .append(buildModeSystemMessage(mode)?.content)
            .append(buildForEachGenerationSystemMessage(forEachGeneration)?.content)
            .append(buildMapReduceGenerationSystemMessage(mapReduceGeneration)?.content)
            .withRepoInstructions(workingDirectory, mode)
            .appendMemoryV2(ctx.memoryV2)
            .appendToolGuidance(ctx.toolGuidance)
            .appendAutoFolder(isGrilling ? undefined : autoFolderContext)
            .appendNoteFile(notePath)
            .build();

        // When this is a Ralph grilling session, prepend the grilling directive
        // (skill pointer, machine contract, and output destination) to the user
        // prompt so the model receives it on every grilling turn.
        const effectivePrompt = isGrilling
            ? `${buildRalphGrillSuffix(autoFolderContext, { workItemGoal: workItemGoalGrilling })}\n\n${prompt}`
            : prompt;

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools: ctx.tools,
            effectivePrompt,
            excludedTools: ctx.excludedTools,
            dispose: ctx.dispose,
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

        let { agentMode, systemMessage, tools, effectivePrompt, excludedTools, dispose: modeDispose } = await this.buildModeOptions(task, prompt, workingDirectory);

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

            // Resolve the AI service for this chat task's selected provider, or
            // the server-level default provider when the task does not override it.
            const taskProvider: ChatProvider = payload.provider ?? this.provider;
            const effectiveAiService: ISDKService = this.getAiServiceForProvider(taskProvider);
            const providerModel = resolveModelForProvider(taskProvider, task.config.model);
            if (providerModel.coerced) {
                getLogger().warn(
                    LogCategory.AI,
                    `[ChatModeExecutor] Dropping model '${providerModel.requestedModel}' for provider '${taskProvider}'; using provider default.`,
                );
            }

            const availability = await effectiveAiService.isAvailable();
            if (!availability.available) {
                const label = taskProvider === 'codex' ? 'Codex' : taskProvider === 'claude' ? 'Claude' : 'Copilot';
                throw new Error(`${label} SDK not available: ${availability.error || 'unknown reason'}`);
            }

            const timeoutMs = task.config.timeoutMs || this.defaultTimeoutMs;
            const taskWorkspaceId = payload.workspaceId;
            const { skillDirectories, disabledSkills } = await this.resolveSkillConfigFn(taskWorkspaceId, workingDirectory);
            const selectedSkillNames = resolvePayloadSkillNames(payload as unknown as ChatPayload | PrClassificationPayload);
            effectivePrompt = prependSelectedSkillsDirective(
                effectivePrompt,
                selectedSkillNames,
                resolveSelectedSkillReferences(selectedSkillNames, skillDirectories, disabledSkills),
            );

            const toolEventHandler = this.buildToolEventHandler(
                processId,
                () => 1,
            );

            const sendTools = tools.length > 0 ? tools : undefined;
            // Guard: CoC uses its custom ask_user tool (SSE/widget flow).
            // The SDK's native onUserInputRequest must NOT be set at the same time.
            assertNoAskUserConflict({ tools: sendTools });

            // Resolve per-repo default model when no explicit model is set on the task.
            let effectiveModel = providerModel.model;
            if (!effectiveModel && this.dataDir && payload.workspaceId) {
                const chatMode = normalizeChatModeOrDefault(payload.mode);
                const defaultModelMode = chatMode === 'autopilot' || chatMode === 'ralph'
                    ? 'task' as const
                    : 'ask' as const;
                const defaultModel = resolveDefaultModel(this.dataDir, payload.workspaceId, defaultModelMode);
                const resolvedDefaultModel = resolveModelForProvider(taskProvider, defaultModel);
                if (resolvedDefaultModel.coerced) {
                    getLogger().warn(
                        LogCategory.AI,
                        `[ChatModeExecutor] Dropping default model '${resolvedDefaultModel.requestedModel}' for provider '${taskProvider}'; using provider default.`,
                    );
                }
                effectiveModel = resolvedDefaultModel.model;
            }

            // Resolve reasoning effort:
            //   explicit task config
            //   > provider-scoped persisted default (cfg.models.providers[provider].reasoningEfforts)
            //   > global persisted default — Copilot legacy only (cfg.models.reasoningEfforts)
            //   > SDK default (model catalog default, then FALLBACK_REASONING_EFFORT_ORDER)
            let requestedEffort: Parameters<typeof resolveReasoningSelection>[0]['requestedEffort'] = task.config.reasoningEffort;
            if (!requestedEffort && effectiveModel) {
                const cfg = loadConfigFile();
                const providerSettings = cfg?.models?.providers?.[taskProvider];
                const effortMap: Record<string, string> = providerSettings
                    ? (providerSettings.reasoningEfforts ?? {})
                    : (taskProvider === 'copilot' ? (cfg?.models?.reasoningEfforts ?? {}) : {});
                const persisted = effortMap[effectiveModel];
                if (persisted) requestedEffort = persisted as NonNullable<typeof requestedEffort>;
            }
            const reasoningSelection = resolveReasoningSelection({
                modelId: effectiveModel,
                requestedEffort,
                model: await this.getModelMetadataForReasoning(effectiveModel, taskProvider, effectiveAiService),
            });

            const sendOptions = {
                prompt: effectivePrompt,
                mode: agentMode,
                ...(reasoningSelection.modelId ? { model: reasoningSelection.modelId } : {}),
                ...(reasoningSelection.reasoningEffort ? { reasoningEffort: reasoningSelection.reasoningEffort } : {}),
                infiniteSessions: { enabled: true } as const,
                workingDirectory,
                timeoutMs,
                attachments,
                tools: sendTools,
                systemMessage,
                skillDirectories,
                disabledSkills,
                ...(excludedTools && excludedTools.length > 0 ? { excludedTools } : {}),
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
                onToolEvent: toolEventHandler,
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
            result = await effectiveAiService.sendMessage(sendOptions) as SDKInvocationResult;

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
                tokenUsage: result.tokenUsage,
                effectiveModel: result.effectiveModel ?? reasoningSelection.modelId,
            };
        } catch (err) {
            const session = this.sessions.get(processId);
            const partialContent = session?.outputBuffer ?? '';
            const partialTimeline = session?.timelineBuffer
                ? mergeConsecutiveContentItems([...session.timelineBuffer])
                : [];
            const partialSuggestions = session?.pendingSuggestions;
            const hasPartial = partialContent.length > 0 || partialTimeline.length > 0;

            if (hasPartial) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                try {
                    await this.appendFinalConversationTurn(
                        processId,
                        (turnIndex) => ({
                            role: 'assistant' as const,
                            content: partialContent || `Error: ${errorMsg}`,
                            timestamp: new Date(),
                            turnIndex,
                            timeline: partialTimeline,
                            interrupted: true,
                            interruptionReason: errorMsg,
                            ...(partialSuggestions ? { suggestions: partialSuggestions } : {}),
                        }),
                        { filterStreaming: true },
                    );
                } catch (appendErr) {
                    getLogger().warn(
                        LogCategory.AI,
                        `[ChatModeExecutor] Failed to persist interrupted turn for ${processId}: ${appendErr instanceof Error ? appendErr.message : String(appendErr)}`,
                    );
                }
            }
            throw err;
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

function resolvePayloadSkillNames(payload: ChatPayload | PrClassificationPayload): string[] | undefined {
    const topLevelSkills = (payload as unknown as { skills?: unknown }).skills;
    if (Array.isArray(topLevelSkills)) {
        return topLevelSkills.filter((skill): skill is string => typeof skill === 'string');
    }
    return (payload as ChatPayload).context?.skills;
}
