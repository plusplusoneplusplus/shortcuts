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
 */

import * as os from 'os';
import * as path from 'path';
import type {
    AgentMode,
    Attachment,
    AutoFolderContext,
    ModelInfo,
    ProcessOutputEvent,
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
    rewriteLargePrompt,
    toForwardSlashes,
    toQueueProcessId,
} from '@plusplusoneplusplus/forge';
import type { ChatPayload, ChatProvider, PrClassificationPayload } from '../tasks/task-types';
import { getForEachContext, getMapReduceContext, isForEachGenerationContext, isMapReduceGenerationContext, normalizeChatModeOrDefault } from '../tasks/task-types';
import { saveImagesToTempFiles, cleanupTempDir, rehydrateImagesIfNeeded } from './image-store';
import { BaseExecutor } from './base-executor';
import {
    assertNoAskUserConflict,
    prependSelectedSkillsDirective,
    resolveSelectedSkillReferences,
} from './prompt-builder';
import { computeAssistantResponseOrdinal } from './turn-performance-tracker';
import { EMPTY_EXECUTOR_RUNTIME } from './executor-runtime-contracts';
import type { ChatExecutorRuntime } from './executor-runtime-contracts';
import { createFixedQueueRuntimeConfig } from '../queue/queue-runtime-config';
import type { QueueRuntimeConfig } from '../queue/queue-runtime-config';
import { buildMemoryV2Addon } from './memory-v2-addon';
import type { MemoryV2Addon } from './memory-v2-addon';
import { resolveAutoFolderContext, suppressesAutoFolder } from './auto-folder-utils';
import { buildChatTurnContext } from './chat-turn-context-builder';
import type { AskUserToolDeps } from '../llm-tools/ask-user-tool';
import { buildChatTurnSystemMessage } from './chat-turn-system-message';
import { buildChatModeDirective, loadChatModeInstructions, persistChatModeContextOnUserTurn, prependChatModeDirective } from './chat-mode-directive';
import { resolveChatTurnPolicy } from './chat-turn-policy-resolver';
import { buildMcpOAuthHandler } from './chat-turn-runner';
import { resolveChatMcpServersForWorkspace } from './mcp-tool-enforcement';
import { resolveRepoGroupChatContext, appendRepoGroupContext, persistRepoGroupContextOnUserTurn } from '../workspaces/repo-group-chat-context';
import { attachRalphGrillMetadataToAskUserPayloads, buildRalphGrillPlanningCompletedProgress, buildRalphGrillPlanningStartedProgress, buildRalphGrillProcessStateFromPlan, buildRalphMultiAgentGrillDirective, formatRalphGrillQuestionPlanForPrompt, planRalphGrillCandidateQuestions } from '../ralph/grill-planning';
import type { RalphGrillPlanningProgress, RalphGrillQuestionPlanningResult, RalphGrillSetup } from '../ralph/grill-planning';
/** Log prefix for every line this executor writes. */
const CHAT_EXECUTOR_LOG_LABEL = '[ChatModeExecutor]';

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
    grill?: RalphGrillSetup;
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
    const multiAgentDirective = buildRalphMultiAgentGrillDirective(options.grill);
    const baseSuffix = multiAgentDirective
        ? `${RALPH_GRILL_SUFFIX}\n\n${multiAgentDirective}`
        : RALPH_GRILL_SUFFIX;

    if (options.workItemGoal) {
        const title = options.workItemGoal.title?.trim();
        const goalLabel = title ? ` "${title}"` : '';
        return `${baseSuffix}\n\nWork Item Goal${goalLabel}: this grilling session is bound to a local Goal item in the Work Items system. Do not create or require a Notes-backed \`.goal.md\` file for this workflow. When the user is done, emit the final \`## Goal\` spec in chat so the Work Item workflow can save it as an immutable Goal content version.`;
    }
    if (!autoFolderContext) return baseSuffix;

    const root = toForwardSlashes(autoFolderContext.tasksRoot);
    const filtered = autoFolderContext.existingFolders.filter(
        f => f !== 'archive' && !f.startsWith('archive/'),
    );
    const folderList = filtered.length > 0 ? filtered.join(', ') : '(none yet)';
    const fileBlock = `\
Goal file: persist the final goal spec as a file at \`${root}/<chosen-folder>/<descriptive-name>.goal.md\` so it appears in the Notes tab and can be opened and edited manually. Pick the most relevant existing folder or create a new kebab-case one (≤3 words). Existing folders: ${folderList}. Do not write the goal file into the repository working tree.`;

    return `${baseSuffix}\n\n${fileBlock}`;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Re-exported from the runtime contract module so existing importers keep
 * working. New code should import it from `./executor-runtime-contracts`.
 */
export type { CronInfraDeps } from './executor-runtime-contracts';

export interface ChatModeExecutorOptions {
    /** Default working directory for AI sessions */
    workingDirectory?: string;
    /** Whether to auto-approve AI permission requests (default: true) */
    approvePermissions?: boolean;
    /** The AI service instance to use for sending messages */
    aiService: ISDKService;
    /**
     * Live configuration port for queue-owned settings (timeout, follow-up
     * suggestions, Ask User). Supplied by the server composition layer, where
     * it is backed by the authoritative `RuntimeConfigService`.
     *
     * When omitted, the three direct options below are folded into a fixed
     * adapter instead. That fallback never touches disk, so a caller without a
     * config service gets exactly the values it passed — never an unrelated
     * `~/.coc/config.yaml`.
     */
    queueConfig?: QueueRuntimeConfig;
    /** Default timeout in ms for tasks that do not specify their own timeoutMs. Ignored when `queueConfig` is supplied. */
    defaultTimeoutMs?: number;
    /** Default idle timeout in ms for AI turns. Ignored when `queueConfig` is supplied. */
    defaultIdleTimeoutMs?: number;
    /** Follow-up suggestions configuration. Ignored when `queueConfig` is supplied. */
    followUpSuggestions?: { enabled: boolean; count: number };
    /** Ask-user interactive tool configuration. Ignored when `queueConfig` is supplied. */
    askUser?: { enabled: boolean };
    /** Resolve skill configuration for a workspace */
    resolveSkillConfig: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    /** Resolve workspace ID for a root path */
    resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
    /** Active AI provider. Used to detect provider mismatches on follow-up resume. */
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    /** Enables the gated multi-agent Ralph grilling prompt contract. */
    ralphMultiAgentGrillEnabled?: boolean;
    /**
     * Late-bound runtime capabilities (cron, `send_to_conversation`, MCP OAuth,
     * the WebSocket server, the global system prompt, provider routing, the
     * turn-performance store and the shared abort registry).
     *
     * Passed by identity from the queue bridge through the executor registry,
     * so a capability added to the contract reaches every chat executor without
     * a per-field forwarding edit. Omitted entirely → every capability is
     * absent and the dependent tools are simply not offered.
     */
    runtime?: ChatExecutorRuntime;
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
    /** Optional gated Ralph grilling preflight plan generated by actual separate agents. */
    ralphGrillPlanning?: {
        setup: RalphGrillSetup;
        sourcePrompt: string;
        state: {
            plan?: RalphGrillQuestionPlanningResult;
        };
    };
}

// ============================================================================
// ChatBaseExecutor
// ============================================================================

export abstract class ChatBaseExecutor extends BaseExecutor {
    protected readonly approvePermissions: boolean;
    protected readonly defaultWorkingDirectory?: string;
    protected readonly aiService: ISDKService;
    /**
     * Configuration port for the queue-owned settings below. Held by identity,
     * never snapshotted, so an admin edit reaches the next turn without a
     * restart.
     */
    protected readonly queueConfig: QueueRuntimeConfig;
    /**
     * Live reads of the queue-owned settings. These are accessors rather than
     * fields so every call site — here and in the ten subclasses — resolves the
     * value at the point it takes effect (turn build / execution start) instead
     * of at construction. All three are classified `live` in
     * `admin-setting-definitions.ts`.
     */
    protected get defaultTimeoutMs(): number { return this.queueConfig.getDefaultTimeoutMs(); }
    protected get defaultIdleTimeoutMs(): number { return this.queueConfig.getDefaultIdleTimeoutMs(); }
    protected get followUpSuggestions(): { enabled: boolean; count: number } { return this.queueConfig.getFollowUpSuggestions(); }
    protected get askUser(): { enabled: boolean } { return this.queueConfig.getAskUser(); }
    protected readonly resolveSkillConfigFn: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    protected readonly resolveWorkspaceIdForPathFn: (rootPath: string) => Promise<string>;
    /**
     * Late-bound runtime capabilities, held by identity. Always defined —
     * {@link EMPTY_EXECUTOR_RUNTIME} when the caller supplied none — so call
     * sites read `this.runtime.getX?.()` without a second optional hop.
     */
    protected readonly runtime: ChatExecutorRuntime;
    /** Active AI provider — used to guard against provider mismatches on follow-up resume. */
    protected readonly provider: 'copilot' | 'codex' | 'claude' | 'opencode';
    protected readonly ralphMultiAgentGrillEnabled: boolean;
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
        // A caller that supplies no port keeps exactly the values it passed.
        // `askUser` stays opt-in here (rather than following DEFAULT_CONFIG)
        // because a caller with no config service has not enabled the feature.
        this.queueConfig = options.queueConfig ?? createFixedQueueRuntimeConfig({
            defaultTimeoutMs: options.defaultTimeoutMs,
            defaultIdleTimeoutMs: options.defaultIdleTimeoutMs,
            followUpSuggestions: options.followUpSuggestions,
            askUser: options.askUser ?? { enabled: false },
        });
        this.resolveSkillConfigFn = options.resolveSkillConfig;
        this.resolveWorkspaceIdForPathFn = options.resolveWorkspaceIdForPath;
        this.runtime = options.runtime ?? EMPTY_EXECUTOR_RUNTIME;
        this.provider = options.provider ?? 'copilot';
        this.ralphMultiAgentGrillEnabled = options.ralphMultiAgentGrillEnabled === true;
        this.getTurnPerformanceRecorder = this.runtime.getTurnPerformanceStore;
    }

    /**
     * Register a fresh AbortController for this turn in the shared bridge
     * registry (when wired) so a cancel can abort the in-flight `sendMessage`
     * before any `sdkSessionId` exists. Always returns a controller so the
     * signal can be passed to the SDK unconditionally.
     */
    protected registerTurnAbortController(processId: string): AbortController {
        const controller = new AbortController();
        this.runtime.processAbortControllers?.set(processId, controller);
        return controller;
    }

    /** Remove this turn's controller unless a newer turn has already replaced it. */
    protected releaseTurnAbortController(processId: string, controller: AbortController): void {
        if (this.runtime.processAbortControllers?.get(processId) === controller) {
            this.runtime.processAbortControllers.delete(processId);
        }
    }

    /**
     * Resolve the admin-configured global system prompt for injection into a
     * user-facing agent session. Reads live from RuntimeConfigService via the
     * injected callback so admin edits apply without a restart. Returns
     * `undefined` when unset so the default path is inert.
     */
    protected resolveGlobalSystemPrompt(): string | undefined {
        return this.runtime.getGlobalSystemPrompt?.();
    }

    /**
     * Whether this executor's turns should keep the provider client process warm
     * after a clean completion (warm-client keep-alive). Interactive chat-process
     * turns (manual ask, queued follow-up, autopilot, ralph) opt in so the next
     * turn reuses a live process; one-shot background executors (classification,
     * task-generation, note-create, resolve-comments) inherit the cold default so
     * they never hold a child process past their single run. The SDK service only
     * acts on this for providers that can stay warm (Copilot/Codex); Claude
     * ignores it and stays cold. Default: cold.
     */
    protected keepClientWarm(): boolean {
        return false;
    }

    /**
     * Resolve the ISDKService to use for a given provider.
     * Uses the injected resolveAiServiceForProvider callback when present;
     * otherwise falls back to this.aiService (backward-compatible test path).
     * In production, resolveAiServiceForProvider is always provided by the server
     * and performs live enablement + registry lookup.
     */
    protected getAiServiceForProvider(provider: ChatProvider): ISDKService {
        if (this.runtime.resolveAiServiceForProvider) {
            return this.runtime.resolveAiServiceForProvider(provider);
        }
        // Fallback: use the default aiService injected at construction time.
        // This preserves backward compatibility for tests that inject aiService
        // directly without the resolveAiServiceForProvider callback.
        // In production, resolveAiServiceForProvider is always injected.
        return this.aiService;
    }

    /**
     * Build per-request cron tool deps from the late-bound cron infrastructure.
     * Returns `scheduleWakeup` deps (always) and `cronTools` deps (always,
     * but gated by skill activation in buildChatTurnContext).
     */
    protected buildCronToolDeps(processId: string): {
        scheduleWakeup?: import('../llm-tools/cron-tools').WakeupToolDeps;
        cronTools?: import('../llm-tools/cron-tools').CronToolDeps;
    } {
        const infra = this.runtime.getCronInfra?.();
        if (!infra) return {};
        return {
            scheduleWakeup: {
                executor: infra.executor,
                processId,
                resolveWorkspaceId: infra.resolveWorkspaceId,
                enqueueWakeup: infra.enqueueWakeup,
            },
            cronTools: {
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

    /**
     * Build the `askUser` block passed to `buildChatTurnContext`.
     *
     * Shared by the ask, autopilot, and follow-up paths so the `ask_user` tool
     * is registered identically in every chat mode. That constancy is the
     * point: the tool block is serialized before `system` and `messages`, so a
     * one-tool difference between modes invalidates the whole conversation's
     * prefix cache when a user toggles the mode pill mid-chat.
     *
     * Mode never gates registration. Only `isInteractive` varies, and it is
     * evaluated at call time, so the schema stays byte-identical.
     */
    protected buildAskUserWiring(
        processId: string,
        opts: {
            computeTurnIndex: () => number;
            isInteractive?: () => boolean;
            ralphGrillPlanningState?: { plan?: RalphGrillQuestionPlanningResult };
        },
    ): { enabled: boolean; deps: AskUserToolDeps } {
        return {
            enabled: this.askUser.enabled,
            deps: {
                emitQuestions: async (questionPayloads) => {
                    const enrichedQuestionPayloads = attachRalphGrillMetadataToAskUserPayloads(
                        questionPayloads,
                        opts.ralphGrillPlanningState?.plan,
                    );
                    await this.store.updateProcess(processId, { pendingAskUser: enrichedQuestionPayloads });
                    for (const questionPayload of enrichedQuestionPayloads) {
                        this.store.emitProcessEvent(processId, {
                            type: 'ask-user',
                            askUser: questionPayload,
                        });
                    }
                },
                computeTurnIndex: opts.computeTurnIndex,
                ...(opts.isInteractive ? { isInteractive: opts.isInteractive } : {}),
                onUnavailable: (questionCount) => {
                    getLogger().debug(
                        LogCategory.AI,
                        `[ChatModeExecutor] ask_user called on a non-interactive turn for ${processId}; ` +
                        `resolved ${questionCount} question(s) as unavailable.`,
                    );
                },
            },
        };
    }

    /**
     * Whether CoC's custom `ask_user` tool is actually in the turn's final tool
     * bundle. Read from the filtered array, not from `this.askUser.enabled`, so
     * a workspace that disabled the tool (or a context that excluded it) never
     * receives prompt text claiming it is available.
     *
     * One documented exception, shared with the mode-invariant tool block: the
     * Ralph grill terminal round strips `ask_user` *after* the system message is
     * assembled. Rewriting the prompt there would churn the cached prefix for a
     * single round, so the block stays; with the tool genuinely gone, a Codex
     * lookup simply finds nothing.
     */
    protected askUserSurvivedFiltering(tools: { name: string }[]): boolean {
        return tools.some(tool => tool.name === 'ask_user');
    }

    /**
     * Assemble the first-turn system message for a chat task.
     *
     * Shared by every first-turn path (ask and autopilot) so a chat's session
     * prefix is the same whichever executor opened it. Whichever executor runs
     * turn 1 defines the prefix the follow-up path must reproduce; if the two
     * builders disagree, the first follow-up rewrites the prefix and the
     * conversation's cache is lost.
     *
     * The message carries no mode input by design — see
     * `chat-turn-system-message.ts`.
     */
    protected async buildFirstTurnSystemMessage(input: {
        task: QueuedTask;
        workingDirectory: string | undefined;
        autoFolderContext: AutoFolderContext | undefined;
        memoryV2: MemoryV2Addon;
        toolGuidance: string;
        /** Whether `ask_user` survived the turn's tool filtering — see `askUserSurvivedFiltering`. */
        askUserAvailable: boolean;
    }): Promise<SystemMessageConfig | undefined> {
        const payload = input.task.payload as unknown as ChatPayload;
        // During grilling, the user-message directive owns the output contract
        // (Notes goal file for general Ralph, Work Item versioning for Goal items).
        // Suppress the generic auto-folder system block so the model does not
        // receive a contradictory `.plan.md` save target. Artifact-bound chats
        // (PR chats route through here) drop the block outright - see
        // `suppressesAutoFolder`.
        const autoFolderSuppressed =
            payload.context?.ralph?.phase === 'grilling'
            || suppressesAutoFolder({ payload: input.task.payload });
        return buildChatTurnSystemMessage({
            workingDirectory: input.workingDirectory,
            provider: payload.provider ?? this.provider,
            globalSystemPrompt: this.resolveGlobalSystemPrompt(),
            forEachGeneration: (() => {
                const context = getForEachContext({ payload });
                return isForEachGenerationContext(context) ? context : null;
            })(),
            mapReduceGeneration: (() => {
                const context = getMapReduceContext({ payload });
                return isMapReduceGenerationContext(context) ? context : null;
            })(),
            memoryV2: input.memoryV2,
            toolGuidance: input.toolGuidance,
            askUserAvailable: input.askUserAvailable,
            autoFolderContext: autoFolderSuppressed ? undefined : input.autoFolderContext,
            notePath: payload.context?.noteChat?.notePath,
        });
    }

    protected async buildStandardModeOptions(
        task: QueuedTask,
        prompt: string,
        mode: 'ask',
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;

        const autoFolderContext = workingDirectory
            ? await this.buildAutoFolderContext(workingDirectory, payload.workspaceId, mode)
            : undefined;

        const processId = toQueueProcessId(task.id);

        const cronDeps = this.buildCronToolDeps(processId);

        const ralphGrillPlanningState: { plan?: RalphGrillQuestionPlanningResult } = {};
        const ctx = await buildChatTurnContext({
            dataDir: this.dataDir,
            store: this.store,
            workspaceId: payload.workspaceId,
            processId,
            query: prompt,
            followUpSuggestions: this.followUpSuggestions,
            enqueueChat: this.runtime.getEnqueueChat?.(),
            sendMessage: this.runtime.getSendMessage?.(),
            sendToConversationRuntime: this.runtime.getSendToConversationRuntime?.(),
            scheduleWakeup: cronDeps.scheduleWakeup,
            cronTools: cronDeps.cronTools,
            askUser: this.buildAskUserWiring(processId, {
                computeTurnIndex: () => 1,
                ralphGrillPlanningState,
            }),
        });
        this.setAskUserHandles(processId, {
            answerQuestion: ctx.askUser!.answerQuestion,
            skipQuestion: ctx.askUser!.skipQuestion,
            answerQuestions: ctx.askUser!.answerQuestions,
            cancelAll: ctx.askUser!.cancelAll,
            hasPending: ctx.askUser!.hasPending,
        });

        const isGrilling = payload.context?.ralph?.phase === 'grilling';
        const workItemGoalGrilling = payload.context?.workItemGoalGrilling;
        const ralphGrillSetup = this.ralphMultiAgentGrillEnabled
            ? payload.context?.ralph?.grill
            : undefined;

        const systemMessage = await this.buildFirstTurnSystemMessage({
            task,
            workingDirectory,
            autoFolderContext,
            memoryV2: ctx.memoryV2,
            toolGuidance: ctx.toolGuidance,
            askUserAvailable: this.askUserSurvivedFiltering(ctx.tools),
        });

        // When this is a Ralph grilling session, prepend the grilling directive
        // (skill pointer, machine contract, and output destination) to the user
        // prompt so the model receives it on every grilling turn.
        const grilledPrompt = isGrilling
            ? `${buildRalphGrillSuffix(autoFolderContext, { workItemGoal: workItemGoalGrilling, grill: ralphGrillSetup })}\n\n${prompt}`
            : prompt;

        // The read-only constraint and the mode-specific repo instructions ride
        // the user turn, not the system prompt, so a mid-chat mode switch does
        // not invalidate the conversation's prefix cache. A first turn always
        // injects — there is no session that could already hold the block — and
        // records it, so the first follow-up can tell the model already has it
        // (see `shouldInjectChatModeDirective`).
        const modeDirective = buildChatModeDirective({
            mode,
            modeInstructions: await loadChatModeInstructions(workingDirectory, mode),
        });
        await persistChatModeContextOnUserTurn(this.store, processId, modeDirective);
        const effectivePrompt = prependChatModeDirective(grilledPrompt, modeDirective);

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools: ctx.tools,
            effectivePrompt,
            excludedTools: ctx.excludedTools,
            dispose: ctx.dispose,
            ...(isGrilling && ralphGrillSetup?.enabled === true
                ? { ralphGrillPlanning: { setup: ralphGrillSetup, sourcePrompt: prompt, state: ralphGrillPlanningState } }
                : {}),
        };
    }

    /**
     * Metric `turnIndex` for the response this turn is about to append: the
     * count of assistant turns already persisted for the process (see
     * computeAssistantResponseOrdinal). 0 for a brand-new chat; historical
     * turns on a cold resume keep that resume out of the new-session bucket.
     * Never throws — an ordinal lookup failure must not fail the turn.
     */
    private async computeTurnPerformanceOrdinal(processId: string, workspaceId?: string): Promise<number> {
        try {
            const proc = await this.store.getProcess(processId, workspaceId);
            return computeAssistantResponseOrdinal(proc?.conversationTurns);
        } catch {
            return 0;
        }
    }

    private emitRalphGrillPlanningProgress(processId: string, progress: RalphGrillPlanningProgress): void {
        try {
            this.store.emitProcessEvent(processId, {
                type: 'ralph-grill-planning',
                ralphGrillPlanning: progress,
            } as unknown as ProcessOutputEvent);
        } catch (err) {
            getLogger().debug(
                LogCategory.AI,
                `[ChatModeExecutor] Failed to emit Ralph grill planning progress for ${processId}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
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

        let { agentMode, systemMessage, tools, effectivePrompt, excludedTools, dispose: modeDispose, ralphGrillPlanning } = await this.buildModeOptions(task, prompt, workingDirectory);

        this.persistSystemPromptAsync(processId, task.type, systemMessage?.content);

        this.resetSessionStreamingState(processId);
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        // Start TTFT/TPS timing before any streaming can begin; the first
        // output chunk is stamped by appendOutputChunk via the tracker.
        // task.createdAt is the enqueue timestamp, so queue wait stays
        // reconstructable from the raw row.
        this.turnPerformance.begin(processId, { enqueuedAt: task.createdAt });

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

        // Resolve the AI provider for this chat task's selected provider, or
        // the server-level default provider when the task does not override it.
        // Hoisted (with the mode and the policy fields below) so the error
        // path can settle the turn-performance event with real attribution.
        const taskProvider: ChatProvider = payload.provider ?? this.provider;
        const chatMode = normalizeChatModeOrDefault(payload.mode);
        let policyModelId: string | undefined;
        let policyReasoningEffort: string | undefined;

        const turnAbort = this.registerTurnAbortController(processId);
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

            const effectiveAiService: ISDKService = this.getAiServiceForProvider(taskProvider);

            const availability = await effectiveAiService.isAvailable();
            if (!availability.available) {
                const label = taskProvider === 'codex' ? 'Codex' : taskProvider === 'claude' ? 'Claude' : taskProvider === 'opencode' ? 'OpenCode' : 'Copilot';
                throw new Error(`${label} SDK not available: ${availability.error || 'unknown reason'}`);
            }

            const timeoutMs = task.config.timeoutMs || this.defaultTimeoutMs;
            const idleTimeoutMs = this.defaultIdleTimeoutMs;
            const taskWorkspaceId = payload.workspaceId;
            const { skillDirectories, disabledSkills } = await this.resolveSkillConfigFn(taskWorkspaceId, workingDirectory);
            const selectedSkillNames = resolvePayloadSkillNames(payload as unknown as ChatPayload | PrClassificationPayload);
            effectivePrompt = prependSelectedSkillsDirective(
                effectivePrompt,
                selectedSkillNames,
                resolveSelectedSkillReferences(selectedSkillNames, skillDirectories, disabledSkills),
            );

            // Repo-group workspaces: append the live-member listing to the
            // prompt and grant member roots as additional working directories.
            // Unconditional here — this path only ever opens a brand-new SDK
            // session, which is exactly the first-turn case the follow-up path
            // re-injects for. Follow-ups then skip it while the session stays
            // alive and uncompacted (see `shouldInjectRepoGroupContext`).
            const repoGroupContext = await resolveRepoGroupChatContext(this.store, this.dataDir, payload.workspaceId);
            effectivePrompt = appendRepoGroupContext(effectivePrompt, repoGroupContext);
            await persistRepoGroupContextOnUserTurn(this.store, processId, repoGroupContext);

            const toolEventHandler = this.buildToolEventHandler(
                processId,
                () => 1,
            );

            // Model, reasoning effort, and Copilot long-context tier all resolve
            // through the shared turn-policy resolver so first turns and
            // follow-ups cannot drift apart. A first turn fails loudly on an
            // unsupported effort (no per-turn override to drop).
            const policy = await resolveChatTurnPolicy({
                provider: taskProvider,
                requestedModel: task.config.model,
                dataDir: this.dataDir,
                workspaceId: payload.workspaceId,
                defaultModelMode: chatMode === 'autopilot' || chatMode === 'ralph' ? 'task' : 'ask',
                onCoerced: ({ requestedModel, source }) => {
                    getLogger().warn(
                        LogCategory.AI,
                        source === 'default'
                            ? `[ChatModeExecutor] Dropping default model '${requestedModel}' for provider '${taskProvider}'; using provider default.`
                            : `[ChatModeExecutor] Dropping model '${requestedModel}' for provider '${taskProvider}'; using provider default.`,
                    );
                },
                requestedEffort: task.config.reasoningEffort,
                getModelMetadata: (modelId) =>
                    this.getModelMetadataForReasoning(modelId, taskProvider, effectiveAiService),
            });
            const effectiveModel = policy.resolvedModel;
            const contextTier = policy.contextTier;
            policyModelId = policy.modelId;
            policyReasoningEffort = policy.reasoningEffort;

            if (ralphGrillPlanning?.setup.enabled === true) {
                this.emitRalphGrillPlanningProgress(
                    processId,
                    buildRalphGrillPlanningStartedProgress(
                        ralphGrillPlanning.setup,
                        this.getRalphGrillState(processId),
                    ),
                );
                const questionPlan = await planRalphGrillCandidateQuestions(
                    {
                        aiService: effectiveAiService,
                        resolveAiServiceForProvider: this.runtime.resolveAiServiceForProvider,
                        resolveModelForProvider,
                    },
                    {
                        setup: ralphGrillPlanning.setup,
                        prompt: ralphGrillPlanning.sourcePrompt,
                        defaultProvider: taskProvider,
                        ...(effectiveModel ? { defaultModel: effectiveModel } : {}),
                        ...(policy.reasoningEffort ? { reasoningEffort: policy.reasoningEffort } : {}),
                        workingDirectory,
                        timeoutMs,
                        skillDirectories,
                        disabledSkills,
                        previousState: this.getRalphGrillState(processId),
                    },
                );
                ralphGrillPlanning.state.plan = questionPlan;
                this.setRalphGrillState(processId, buildRalphGrillProcessStateFromPlan(
                    questionPlan,
                    this.getRalphGrillState(processId),
                ));
                this.emitRalphGrillPlanningProgress(
                    processId,
                    buildRalphGrillPlanningCompletedProgress(questionPlan),
                );
                const questionPlanBlock = formatRalphGrillQuestionPlanForPrompt(questionPlan);
                if (questionPlanBlock) {
                    effectivePrompt = `${effectivePrompt}\n\n${questionPlanBlock}`;
                }
                if (questionPlan.terminal) {
                    tools = tools.filter(tool => tool.name !== 'ask_user');
                    this.clearAskUserHandles(processId);
                }
            }

            const sendTools = tools.length > 0 ? tools : undefined;
            // Guard: CoC uses its custom ask_user tool (SSE/widget flow).
            // The SDK's native onUserInputRequest must NOT be set at the same time.
            assertNoAskUserConflict({ tools: sendTools });

            // AC-04 — Apply the per-repo MCP allow-lists (server-level
            // `enabledMcpServers` + per-tool `enabledMcpTools`) to the
            // dashboard chat/session path. When resolved, the explicit map is
            // sent with `loadDefaultMcpConfig: false` so disabled tools/servers
            // never reach the agent. `undefined` preserves the SDK default load.
            const resolvedMcpServers = await resolveChatMcpServersForWorkspace({
                store: this.store,
                dataDir: this.dataDir,
                workspaceId: payload.workspaceId,
                workingDirectory,
            });

            const sendOptions = {
                prompt: effectivePrompt,
                mode: agentMode,
                ...(policy.modelId ? { model: policy.modelId } : {}),
                ...(policy.reasoningEffort ? { reasoningEffort: policy.reasoningEffort } : {}),
                ...(contextTier ? { contextTier } : {}),
                infiniteSessions: { enabled: true } as const,
                ...(this.keepClientWarm() ? { keepWarm: true as const, warmKey: processId } : {}),
                workingDirectory,
                ...(repoGroupContext ? { additionalDirectories: repoGroupContext.additionalDirectories } : {}),
                signal: turnAbort.signal,
                timeoutMs,
                idleTimeoutMs,
                attachments,
                tools: sendTools,
                systemMessage,
                skillDirectories,
                disabledSkills,
                ...(excludedTools && excludedTools.length > 0 ? { excludedTools } : {}),
                ...(resolvedMcpServers ? { mcpServers: resolvedMcpServers, loadDefaultMcpConfig: false } : {}),
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                onSessionCreated: (sessionId: string) => {
                    this.store.updateProcess(processId, { sdkSessionId: sessionId }).catch(() => {
                        // Non-fatal: store may be a stub
                    });
                },
                onStreamingChunk: this.buildStreamingChunkHandler(processId, CHAT_EXECUTOR_LOG_LABEL),
                onToolEvent: toolEventHandler,
                onTokenUsage: this.buildMidTurnTokenUsageHandler(processId),
                onBackgroundTasksChanged: this.buildBackgroundTaskHandler(processId),
                onMcpOAuthRequired: buildMcpOAuthHandler({
                    store: this.store,
                    processId,
                    workspaceId: payload.workspaceId,
                    originalMessage: prompt,
                    manager: this.runtime.getMcpOauthManager?.(),
                    logLabel: CHAT_EXECUTOR_LOG_LABEL,
                }),
            };

            let result: SDKInvocationResult;
            result = await effectiveAiService.sendMessage(sendOptions) as SDKInvocationResult;

            if (!result.success) {
                throw new Error(result.error || 'AI execution failed');
            }

            // Capture session state BEFORE the finally block runs cleanup.
            // (return value expressions are evaluated before finally executes)
            const finalTimeline = mergeConsecutiveContentItems(
                this.getTimelineBuffer(processId) ?? [],
            );
            const pendingSuggestions = this.getPendingSuggestions(processId);

            this.settleTurnPerformance(processId, {
                turnIndex: await this.computeTurnPerformanceOrdinal(processId, payload.workspaceId),
                workspaceId: payload.workspaceId,
                provider: taskProvider,
                model: result.effectiveModel ?? policy.modelId,
                effortTier: policy.reasoningEffort,
                mode: chatMode,
                kind: task.type,
                tokenUsage: result.tokenUsage,
                status: 'completed',
            });

            return {
                response: result.response || '(Task completed via tool execution — no text response produced)',
                sessionId: result.sessionId,
                toolCalls: result.toolCalls,
                timeline: finalTimeline,
                pendingSuggestions,
                tokenUsage: result.tokenUsage,
                effectiveModel: result.effectiveModel ?? policy.modelId,
            };
        } catch (err) {
            // Settle before the interrupted-turn append below so the ordinal
            // counts only the assistant turns that preceded this response.
            this.settleTurnPerformance(processId, {
                turnIndex: await this.computeTurnPerformanceOrdinal(processId, payload.workspaceId),
                workspaceId: payload.workspaceId,
                provider: taskProvider,
                model: policyModelId,
                effortTier: policyReasoningEffort,
                mode: chatMode,
                kind: task.type,
                status: turnAbort.signal.aborted ? 'cancelled' : 'errored',
            });

            const partial = this.capturePartialTurn(processId);

            if (partial.hasPartial) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                try {
                    await this.appendFinalConversationTurn(
                        processId,
                        (turnIndex) => ({
                            role: 'assistant' as const,
                            content: partial.content || `Error: ${errorMsg}`,
                            timestamp: new Date(),
                            turnIndex,
                            timeline: partial.timeline,
                            interrupted: true,
                            interruptionReason: errorMsg,
                            ...(partial.suggestions ? { suggestions: partial.suggestions } : {}),
                        }),
                        { filterStreaming: true },
                    );
                } catch (appendErr) {
                    getLogger().warn(
                        LogCategory.AI,
                        `${CHAT_EXECUTOR_LOG_LABEL} Failed to persist interrupted turn for ${processId}: ${appendErr instanceof Error ? appendErr.message : String(appendErr)}`,
                    );
                }
            }
            throw err;
        } finally {
            this.releaseTurnAbortController(processId, turnAbort);
            // Timing state is settled on both success and error paths; this is
            // a leak guard for throws that bypass both settles.
            this.turnPerformance.abandon(processId);
            // Background tasks cannot outlive the turn; drop the replay snapshot
            // on every exit path, including a drain-cap abort that never settles.
            this.backgroundTasks.clear(processId);
            if (imageTempDir) { cleanupTempDir(imageTempDir); }
            if (pasteCleanup) { pasteCleanup(); }
            modeDispose?.();
            // Cancel any pending ask-user questions before cleanup
            this.cancelAskUserHandles(processId);
            try {
                await this.clearPendingAskUser(processId);
            } catch (err) {
                getLogger().debug(
                    LogCategory.AI,
                    `[ChatModeExecutor] Failed to clear pending ask-user for ${processId}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
            const buffer = this.getOutputBuffer(processId);
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
