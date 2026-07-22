/**
 * Aggregated route registration for the CoC execution server.
 *
 * `registerAllRoutes` consolidates all registerXxxRoutes calls so that
 * `createExecutionServer` only deals with infrastructure setup.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Route } from '../types';
import type { ProcessStore, TaskQueueManager, ISDKService, AIInvoker, CreateTaskInput } from '@plusplusoneplusplus/forge';
import { modelMetadataStore, sdkServiceRegistry, CopilotSDKService, CodexSDKService, ClaudeSDKService, SDK_PROVIDER_CLAUDE, SDK_PROVIDER_CODEX, SDK_PROVIDER_OPENCODE, getLogger, LogCategory, isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { SqliteQueuePersistence } from '../queue/sqlite-queue-persistence';
import type { ScheduleManager } from '../schedule/schedule-manager';
import type { WikiServerOptions } from '../types';
import type { WikiManager } from '../wiki';
import { registerApiRoutes } from '../core/api-handler';
import { registerQueueRoutes } from '../queue/queue-handler';
import { prepareTaskForEnqueue } from './queue-enqueue';
import { serializeTask, enqueueViaBridge } from './queue-shared';
import type { QueueGlobalState } from './queue-shared';
import type { EnqueueChatFn, SendMessageFn, SendToConversationRuntimeOptions } from '../llm-tools/send-to-conversation-tool';
import { ProcessMessageDeliveryService, type FollowUpMessageInput } from '../processes/process-message-delivery-service';
import { registerTaskRoutes, registerTaskWriteRoutes } from '../tasks/tasks-handler';
import { registerTaskGenerationRoutes } from '../tasks/task-generation-handler';
import { registerPromptRoutes } from '../prompts/prompt-handler';
import { readRepoPreferences, registerPreferencesRoutes } from '../preferences-handler';
import { registerAdminRoutes } from '../admin/admin-handler';
import { registerTaskCommentsRoutes } from '../tasks/comments/task-comments-handler';
import { registerDiffCommentsRoutes } from '../tasks/comments/diff-comments-handler';
import { registerChatSidenotesRoutes } from '../processes/chat-sidenotes/chat-sidenotes-handler';
import { registerCanvasRoutes } from '../canvas/canvas-routes';
import { registerWikiRoutes } from '../wiki';
import { registerMemoryRoutes } from '../memory/memory-routes';
import { registerMemoryV2Routes } from '../memory/memory-v2-routes';
import { registerRepoRoutes } from '../repos/repo-routes';
import { registerInstructionRoutes } from '../skills/instruction-handler';
import { registerProviderRoutes } from '../providers/provider-routes';
import { registerPrRoutes, warmPullRequestWorkspaceCache } from '../repos/pr-routes';
import { registerGenericClassificationRoutes } from '../repos/generic-classification-handler';
import { registerLogsRoutes } from '../logging/logs-routes';
import { RepoTreeService } from '../repos/tree-service';
import { registerProcessResumeRoutes, registerFreshChatTerminalRoutes } from '../processes/process-resume-handler';
import { registerWorkflowRoutes, registerWorkflowWriteRoutes } from '../workflows/workflows-handler';
import { registerWorkspaceSummaryRoutes } from '../workspaces/workspace-summary-handler';
import { registerTemplateRoutes, registerTemplateWriteRoutes } from '../templates/templates-handler';
import { registerNotesRoutes, registerNotesWriteRoutes, registerNotesCommentsRoutes, registerNotesImageRoutes, registerNotesGitRoutes, registerNotesGitAutoCommitRoutes, registerNotesFilePreviewRoutes, registerNotesAICreateRoutes, registerNotesRootsRoutes } from '../notes/notes-handler';
import { registerNotesEditsRoutes } from '../notes/notes-edits-handler';
import { registerReplicateApplyRoutes } from '../templates/replicate-apply-handler';
import { registerScheduleRoutes } from '../schedule/schedule-handler';
import { registerStatsRoutes } from '../admin/stats-handler';
import { registerDbBrowserRoutes } from '../admin/db-browser-handler';
import { registerHeapRoutes } from '../admin/heap-monitor';
import { registerSeenStateRoutes } from '../processes/seen-state-handler';
import { registerPromptSuggestionRoutes } from '../processes/prompt-suggestion-handler';
import { registerPromptHistoryRoutes } from '../processes/prompt-history-handler';
import { registerGroupPinRoutes } from '../processes/group-pin-handler';
import { registerTaskGroupRoutes } from './task-group-routes';
import { TaskGroupService } from '../task-groups/task-group-service';
import { syncDreamRunToTaskGroup, syncForEachRunToTaskGroup, syncMapReduceRunToTaskGroup, syncRalphSessionToTaskGroup } from '../task-groups/feature-sync';
import { registerRalphSessionChangeListener } from '../ralph/ralph-session-store';
import { backfillTaskGroups } from '../task-groups/backfill';
import { registerPinArchiveRoutes } from '../processes/pin-archive-handler';
import { registerTurnActionRoutes } from '../processes/turn-actions-handler';
import { registerProcessHistoryRoutes } from '../processes/process-history-handler';
import type { NotesGitTimerManager } from '../notes/git/notes-git-timer-manager';
import { registerWorkspaceHistoryRoutes } from './api-workspace-history-routes';
import { registerTerminalRoutes } from '../terminal/terminal-routes';
import { registerMyWorkRoutes } from '../workspaces/my-work-handler';
import { registerMyLifeRoutes } from '../workspaces/my-life-handler';
import { registerWorkItemRoutes } from './work-item-routes';
import { registerWorkItemHierarchyRoutes } from './work-item-hierarchy-routes';
import { registerWorkItemSyncRoutes } from './work-item-sync-routes';
import { registerWorkItemPlanRoutes } from './work-item-plan-routes';
import { registerWorkItemExecutionRoutes } from './work-item-execution-routes';
import { registerWorkItemChangesRoutes } from './work-item-changes-routes';
import { registerWorkItemAiRoutes } from './work-item-ai-routes';
import { warmWorkItemWorkspaceCache } from './work-item-cache-warming';
import { createWorkItemAiGenerators } from '../work-items/work-item-ai-generator';
import { createWorkItemStore } from '../work-items/work-item-store';
import { createAzureBoardsWorkItemSyncProviderAdapter } from '../work-items/work-item-sync-azure-boards-provider';
import { createGitHubWorkItemSyncProviderAdapter } from '../work-items/work-item-sync-github-provider';
import { WorkItemAzureBoardsPullPoller } from '../work-items/work-item-azure-boards-pull-poller';
import { WorkItemGitHubPullPoller } from '../work-items/work-item-github-pull-poller';
import { handleWorkItemTaskComplete, autoVersionPlanFromResolvedComments, saveGoalGrillingSpecFromResponse } from '../work-items/work-item-executor';
import type { EnqueueFunction } from '../work-items/work-item-executor';
import { upsertWorkItemTaskFile, toTaskFileStatus } from '../work-items/work-item-task-file';
import { clearWorkItemResponseCacheForWorkspace } from '../work-items/work-item-response-cache';
import { execGit } from '@plusplusoneplusplus/forge';
import { TERMINAL_WORK_ITEM_STATUSES, WORK_ITEM_STATUSES, type WorkItemChangeCommit } from '../work-items/types';
import { getResolvedConfigWithSource, loadConfigFile, writeConfigFile, getConfigFilePath } from '../../config';
import type { ResolvedCLIConfig } from '../../config';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import { TaskDefs, type ChatProvider } from '../tasks/task-types';
import type { TerminalSessionManager } from '../terminal/index';
import { registerRemoteServerRoutes } from '../servers/remote-server-routes';
import { RemoteServerStore } from '../servers/remote-server-store';
import { DevTunnelConnector } from '../servers/devtunnel-connector';
import type { SshConnector } from '../servers/ssh-connector';
import { registerRalphRoutes } from './queue-ralph-routes';
import { registerRalphSessionRoutes } from './ralph-session-routes';
import { registerRalphContinueRoutes } from './ralph-continue-routes';
import { registerRalphNewLoopRoutes } from './ralph-new-loop-routes';
import { registerRalphPromoteRoutes } from './ralph-promote-routes';
import { registerRalphLaunchRoutes } from './ralph-launch-routes';
import { registerRalphResumeRoutes } from './ralph-resume-routes';
import { registerWorktreeRoutes } from './worktree-routes';
import { registerForEachRoutes } from './for-each-routes';
import { FileForEachRunStore } from '../for-each/for-each-run-store';
import { createForEachPlanGenerator } from '../for-each/for-each-plan-generator';
import { ForEachRunExecutor } from '../for-each/for-each-run-executor';
import { registerMapReduceRoutes } from './map-reduce-routes';
import { FileMapReduceRunStore } from '../map-reduce/map-reduce-run-store';
import { createMapReducePlanGenerator } from '../map-reduce/map-reduce-plan-generator';
import { MapReduceRunExecutor } from '../map-reduce/map-reduce-run-executor';
import { registerNativeCopilotSessionRoutes } from './native-copilot-session-routes';
import { NativeCopilotSessionService } from '../native-copilot-sessions/native-copilot-session-service';
import { ClaudeNativeSessionProvider, CodexNativeSessionProvider, CopilotNativeSessionProvider } from '../native-copilot-sessions/native-cli-session-service';
import { registerNativeCliSessionRoutes } from './native-cli-session-routes';
import type { NativeCliSessionProviderId, NativeSessionProvider } from '../native-copilot-sessions/types';
import { registerDreamRoutes } from '../dreams/dream-routes';
import { FileDreamStore } from '../dreams/dream-store';
import { DreamRunExecutor, type DreamRunRequestOptions } from '../dreams/dream-runner';
import { DreamIdleScheduler } from '../dreams/dream-idle-scheduler';
import { DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS } from '../dreams/dream-analyzer';
import { resolveDreamSystemPrompt } from '../dreams/dream-prompt-resolver';
import { DreamInternalProcessExecutor } from '../executors/dream-internal-process-executor';
import { registerLoopRoutes } from '../loops/loop-handler';
import type { LoopStore } from '../loops/loop-store';
import type { LoopExecutor, LoopEventEmit } from '../loops/loop-executor';
import { registerTriggerRoutes } from '../triggers/trigger-handler';
import type { TriggerStore } from '../triggers/trigger-store';
import type { TriggerManager, TriggerEventEmit } from '../triggers/trigger-manager';
import { registerMcpOauthRoutes } from '../mcp-oauth';
import type { McpOauthManager } from '../mcp-oauth';
import { registerAgentProvidersRoutes } from '../agent-providers/agent-providers-routes';
import { AgentProvidersQuotaCache } from '../agent-providers/quota-cache';
import { QuotaPauseWatcher } from '../agent-providers/quota-pause-watcher';
import { resolveAutoAgentProvider, type AutoProviderAvailabilityMap, type AutoProviderResolutionResult } from '../agent-providers/auto-provider-router';
import { registerProviderInstallRoutes } from '../providers/provider-install-routes';
import { registerRuntimeConfigRoutes } from '../config/runtime-config-handler';
import { registerSyncRoutes } from '../sync/sync-handler';
import type { SyncEngine } from '../sync/sync-engine';
import { registerTeamsMessagingRoutes } from '../messaging/teams-messaging-handler';
import { registerContainerSessionRoutes } from '../container-sessions/container-session-handler';
import { ContainerSessionStore } from '../container-sessions/container-session-store';
import type { ContainerAgentInfo } from '../container-sessions/container-session-types';
import type { ResolveDefaultProviderOptions } from './queue-shared';
import { ActiveWorkspaceTracker } from '../dashboard/active-workspace-tracker';
import { ActiveWorkspaceBackgroundRefresher } from '../dashboard/active-workspace-background-refresher';

/** Collect git commits made between headBefore and current HEAD. Non-fatal — returns [] on error. */
function collectWorkItemCommits(
    repoRoot: string,
    headBefore: string,
): WorkItemChangeCommit[] {
    try {
        const output = execGit(
            ['log', `${headBefore}..HEAD`, '--pretty=format:%H\x1f%s\x1f%an\x1f%aI'],
            repoRoot,
        );
        if (!output.trim()) return [];
        return output.split('\n').filter(Boolean).map(line => {
            const [sha, message, author, date] = line.split('\x1f');
            return { sha, message, author, date };
        });
    } catch {
        return [];
    }
}

function getLatestAssistantResponse(process: Awaited<ReturnType<ProcessStore['getProcess']>> | undefined): string | undefined {
    const assistantTurn = [...(process?.conversationTurns ?? [])]
        .reverse()
        .find(turn => turn.role === 'assistant' && typeof turn.content === 'string' && turn.content.trim());
    if (assistantTurn) return assistantTurn.content;

    const result = process?.result;
    if (typeof result !== 'string' || !result.trim()) return undefined;
    try {
        const parsed = JSON.parse(result) as unknown;
        if (parsed && typeof parsed === 'object') {
            const response = (parsed as Record<string, unknown>).response;
            if (typeof response === 'string' && response.trim()) return response;
        }
    } catch {
        return result;
    }
    return undefined;
}

export interface RegisterRoutesOptions {
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    queueFacade: TaskQueueManager;
    scheduleManager: ScheduleManager;
    notesGitTimerManager: NotesGitTimerManager;
    dataDir: string;
    configPath: string | undefined;
    tokenTtlMs: number | undefined;
    globalWorkspaceRootPath: string;
    resolvedAiService: ISDKService;
    getWsServer: () => ProcessWebSocketServer;
    queuePersistence: SqliteQueuePersistence;
    wikiOptions?: WikiServerOptions;
    aiInvoker: AIInvoker;
    getTerminalSessionManager?: () => TerminalSessionManager | undefined;
    resolvedConfig?: ResolvedCLIConfig;
    runtimeConfigService?: RuntimeConfigService;
    remoteServerStore?: RemoteServerStore;
    remoteServerConnector?: DevTunnelConnector;
    remoteServerSshConnector?: SshConnector;
    getLocalBaseUrl?: () => string | undefined;
    loopStore?: LoopStore;
    loopExecutor?: LoopExecutor;
    triggerStore?: TriggerStore;
    triggerManager?: TriggerManager;
    triggerEmit?: TriggerEventEmit;
    mcpOauthManager?: McpOauthManager;
    resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
    loopEmit?: LoopEventEmit;
    hostname?: string;
    bindAddress?: string;
    syncEngines?: Map<string, SyncEngine>;
    /** Native Copilot CLI session store path override (for tests). */
    nativeCopilotSessionDbPath?: string;
    /** Native Copilot CLI `session-state` base directory override (for tests). */
    nativeCopilotSessionStateDir?: string;
    /**
     * Publish the bound in-process enqueue capability back to the server layer so
     * the late-bound getter passed to the queue infrastructure (created before
     * routes) can hand it to executors. Powers the `send_to_conversation`
     * tool. The callback runs the same machinery `POST /api/queue` uses
     * (`prepareTaskForEnqueue` + `enqueueViaBridge`) against the shared global
     * queue state.
     */
    setEnqueueChat?: (fn: EnqueueChatFn) => void;
    /**
     * Publish the bound in-process follow-up delivery capability back to the
     * server layer so the late-bound getter passed to the queue infrastructure
     * can hand it to executors. Powers the post mode of `send_to_conversation`
     * (posting `content` into an existing conversation). The callback wraps the
     * same `ProcessMessageDeliveryService.deliver` path `POST /api/processes/:id/message`
     * uses against the shared store + queue bridge.
     */
    setSendMessage?: (fn: SendMessageFn) => void;
    setSendToConversationRuntime?: (runtime: SendToConversationRuntimeOptions) => void;
}

export function registerAllRoutes(routes: Route[], opts: RegisterRoutesOptions): { wikiManager: WikiManager | undefined; workItemGitHubPullPoller: WorkItemGitHubPullPoller; workItemAzureBoardsPullPoller: WorkItemAzureBoardsPullPoller; agentProvidersQuotaCache?: AgentProvidersQuotaCache; quotaPauseWatcher?: QuotaPauseWatcher; activeWorkspaceBackgroundRefresher: ActiveWorkspaceBackgroundRefresher; dreamIdleScheduler: DreamIdleScheduler } {
    const {
        store, bridge, queueFacade, scheduleManager,
        notesGitTimerManager,
        dataDir, configPath, tokenTtlMs, globalWorkspaceRootPath,
        resolvedAiService, getWsServer, queuePersistence, wikiOptions,
        aiInvoker,
    } = opts;
    let workItemGitHubPullPoller: WorkItemGitHubPullPoller | undefined;
    let workItemAzureBoardsPullPoller: WorkItemAzureBoardsPullPoller | undefined;
    let agentProvidersQuotaCache: AgentProvidersQuotaCache | undefined;
    let quotaPauseWatcher: QuotaPauseWatcher | undefined;
    const concreteDefaultProvider = (): ChatProvider => {
        const defaultProvider = opts.runtimeConfigService?.config.defaultProvider
            ?? opts.resolvedConfig?.defaultProvider;
        if (defaultProvider === 'codex') return 'codex';
        if (defaultProvider === 'claude') return 'claude';
        if (defaultProvider === 'opencode') return 'opencode';
        return 'copilot';
    };
    const concreteDefaultProviderResolution = (provider: ChatProvider = concreteDefaultProvider()): AutoProviderResolutionResult => ({
        provider,
        selectedByAuto: false,
        fallbackUsed: false,
        decisions: [],
        warnings: [],
    });
    const getAutoProviderAvailability = async (): Promise<AutoProviderAvailabilityMap> => {
        const config = opts.runtimeConfigService?.config ?? opts.resolvedConfig;
        const codexEnabled = config?.codex?.enabled ?? false;
        const claudeEnabled = config?.claude?.enabled ?? false;
        const availability: AutoProviderAvailabilityMap = {
            copilot: { enabled: true, available: true },
        };

        if (!codexEnabled) {
            availability.codex = { enabled: false, available: false, reason: 'Codex provider is disabled.' };
        } else {
            const svc = sdkServiceRegistry.get(SDK_PROVIDER_CODEX);
            availability.codex = svc
                ? { enabled: true, ...(await svc.isAvailable()) }
                : { enabled: true, available: false, reason: 'Codex SDK service is not registered.' };
        }

        if (!claudeEnabled) {
            availability.claude = { enabled: false, available: false, reason: 'Claude provider is disabled.' };
        } else {
            const svc = sdkServiceRegistry.get(SDK_PROVIDER_CLAUDE);
            availability.claude = svc
                ? { enabled: true, ...(await svc.isAvailable()) }
                : { enabled: true, available: false, reason: 'Claude SDK service is not registered.' };
        }

        const opencodeEnabled = config?.opencode?.enabled ?? false;
        if (!opencodeEnabled) {
            availability.opencode = { enabled: false, available: false, reason: 'OpenCode provider is disabled.' };
        } else {
            const svc = sdkServiceRegistry.get(SDK_PROVIDER_OPENCODE);
            availability.opencode = svc
                ? { enabled: true, ...(await svc.isAvailable()) }
                : { enabled: true, available: false, reason: 'OpenCode SDK service is not registered.' };
        }

        return availability;
    };
    const resolveDefaultProvider = async (options?: ResolveDefaultProviderOptions): Promise<AutoProviderResolutionResult> => {
        const config = opts.runtimeConfigService?.config ?? opts.resolvedConfig;
        const forceAuto = options?.forceAuto === true;
        if (!config) {
            return concreteDefaultProviderResolution();
        }
        const autoRoutingEnabled = config.features.autoAgentProviderRouting === true;
        if (!forceAuto && !autoRoutingEnabled) {
            return concreteDefaultProviderResolution(config.defaultProvider);
        }
        if (config.features.autoAgentProviderRouting !== true) {
            return {
                selectedByAuto: true,
                fallbackUsed: false,
                decisions: [],
                warnings: [],
                error: 'Auto provider routing requires features.autoAgentProviderRouting: true',
            };
        }
        if (!agentProvidersQuotaCache) {
            return {
                selectedByAuto: true,
                fallbackUsed: false,
                decisions: [],
                warnings: [],
                error: 'Auto provider routing requires the provider quota cache.',
            };
        }
        const quotaData = await agentProvidersQuotaCache.get({ refreshIfStale: true });
        return resolveAutoAgentProvider(config.agentProviderRouting.auto, {
            providerAvailability: await getAutoProviderAvailability(),
            quotaData,
            quotaStale: agentProvidersQuotaCache.isStale(),
        });
    };
    const isAutoProviderRoutingActive = (): boolean => {
        const config = opts.runtimeConfigService?.config ?? opts.resolvedConfig;
        return config?.features.autoAgentProviderRouting === true;
    };
    const resolveConcreteDefaultProvider = async (): Promise<ChatProvider> => {
        const resolution = await resolveDefaultProvider();
        if (!resolution.provider) {
            throw new Error(resolution.error ?? 'Default provider resolution did not select a concrete provider.');
        }
        return resolution.provider;
    };
    const getEffortTiersForProvider = (provider: ChatProvider) => {
        const configPath = opts.runtimeConfigService?.configPath ?? opts.configPath;
        const fileConfig = configPath ? loadConfigFile(configPath) : undefined;
        return (
            fileConfig?.models?.providers?.[provider]?.effortTiers
            ?? opts.runtimeConfigService?.config.models?.providers?.[provider]?.effortTiers
            ?? opts.resolvedConfig?.models?.providers?.[provider]?.effortTiers
        );
    };
    const validateSendToConversationProvider = async (provider: ChatProvider): Promise<void> => {
        const availability = await getAutoProviderAvailability();
        const status = availability[provider];
        if (!status) {
            throw new Error(`Provider '${provider}' is not recognized by the server.`);
        }
        if (!status.enabled) {
            throw new Error(status.reason ?? `Provider '${provider}' is disabled.`);
        }
        if (!status.available) {
            throw new Error(status.reason ?? `Provider '${provider}' is unavailable.`);
        }
    };
    const prepareEnqueueTask = async (input: CreateTaskInput): Promise<void> => {
        await prepareTaskForEnqueue(input, {
            getDefaultProvider: concreteDefaultProvider,
            resolveDefaultProvider,
            isAutoProviderRoutingActive,
            getEffortTiersForProvider,
        });
    };
    const enqueueWithResolvedDefaults = async (input: CreateTaskInput): Promise<string> => {
        await prepareEnqueueTask(input);
        return bridge.enqueue(input);
    };
    const bridgeWithResolvedDefaults = Object.create(bridge) as MultiRepoQueueRouter;
    Object.defineProperty(bridgeWithResolvedDefaults, 'enqueue', {
        value: enqueueWithResolvedDefaults,
        configurable: true,
        writable: true,
    });
    bridge.setResolveDefaultProvider(resolveDefaultProvider);

    // Shared global queue state — passed to both the HTTP queue routes and the
    // in-process `send_to_conversation` enqueue capability so they observe the
    // same global pause flags. Created here (rather than inside
    // `registerQueueRoutes`) so the tool path can reuse it.
    const queueGlobalState: QueueGlobalState = {
        globalPaused: false,
        globalPausedUntil: undefined,
        globalAutopilotPaused: false,
        globalAutopilotPausedUntil: undefined,
        resumeInProgress: new Set(),
    };

    // Publish the bound enqueue capability so executors (created before routes)
    // can offer the `send_to_conversation` tool. Reuses the exact machinery
    // `POST /api/queue` uses: provider/effort defaults resolution, then route +
    // enqueue via the per-repo queue manager.
    opts.setEnqueueChat?.(async (input: CreateTaskInput): Promise<string> => {
        await prepareEnqueueTask(input);
        return enqueueViaBridge(input, bridge, queueGlobalState, globalWorkspaceRootPath, store);
    });
    opts.setSendToConversationRuntime?.({
        validateProvider: validateSendToConversationProvider,
        getEffortTiersForProvider,
    });

    // Publish the bound follow-up delivery capability so executors can offer the
    // post mode of `send_to_conversation` (posting into an existing
    // conversation). Wraps the exact `ProcessMessageDeliveryService.deliver`
    // path `POST /api/processes/:id/message` uses, resolving the target process
    // (with the same queue_-prefix fallback) and returning the appended
    // user-turn index. The tool's `'steer'` delivery mode maps onto the
    // service's `'immediate'` mode — the service auto-steers a running process.
    opts.setSendMessage?.(async (input): Promise<{ turnIndex: number }> => {
        const { processId, content, mode, model, effort, deliveryMode } = input;
        let proc = await store.getProcess(processId);
        if (!proc && isQueueProcessId(processId)) {
            proc = await store.getProcess(toTaskId(processId));
        }
        if (!proc) {
            throw new Error(`Process '${processId}' not found.`);
        }
        const resolvedDeliveryMode: 'immediate' | 'enqueue' =
            deliveryMode === 'immediate' || deliveryMode === 'steer' ? 'immediate' : 'enqueue';
        const deliveryInput: FollowUpMessageInput = {
            content,
            displayContent: content,
            deliveryMode: resolvedDeliveryMode,
            pasteExternalized: false,
            ...(mode ? { mode } : {}),
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
        };
        const result = await new ProcessMessageDeliveryService({ store, bridge }).deliver(proc, deliveryInput);
        return { turnIndex: result.turnIndex };
    });

    // excalidrawEnabled uses a live getter via runtimeConfigService so admin
    // changes take effect without restart. loopsEnabled stays startup-captured
    // (restartRequired — loop executor infrastructure wires at startup).
    const getLiveFeatureFlags = opts.runtimeConfigService
        ? () => ({
            excalidrawEnabled: opts.runtimeConfigService!.config.excalidraw?.enabled ?? false,
            canvasEnabled: opts.runtimeConfigService!.config.canvas?.enabled ?? false,
            kustoEnabled: opts.runtimeConfigService!.config.kusto?.enabled ?? false,
        })
        : () => ({
            excalidrawEnabled: opts.resolvedConfig?.excalidraw?.enabled ?? false,
            canvasEnabled: opts.resolvedConfig?.canvas?.enabled ?? false,
            kustoEnabled: opts.resolvedConfig?.kusto?.enabled ?? false,
        });
    const isKustoEnabled = (): boolean => getLiveFeatureFlags().kustoEnabled;
    const activeWorkspaceTracker = new ActiveWorkspaceTracker();
    registerApiRoutes(routes, store, bridge, dataDir, getWsServer, undefined, opts.resolvedConfig?.loops?.enabled ?? false, getLiveFeatureFlags, activeWorkspaceTracker);
    const repoTreeService = new RepoTreeService(dataDir, undefined, store);
    registerRepoRoutes(routes, dataDir, repoTreeService);
    const isPullRequestTeamAutoClassificationEnabled = (): boolean => {
        const config = opts.runtimeConfigService?.config ?? opts.resolvedConfig;
        return config?.pullRequests?.enabled === true
            && config.pullRequests?.autoClassifyTeam === true
            && config.features?.focusedDiff === true;
    };
    registerPrRoutes(routes, dataDir, repoTreeService, store, resolvedAiService, {
        store,
        bridge,
        prepareTaskForEnqueue: prepareEnqueueTask,
        getEnabled: isPullRequestTeamAutoClassificationEnabled,
    });
    // Focused-diff classification routes — always registered so the feature
    // can be toggled live via admin config. The SPA gates the UI based on
    // runtime config; having the routes present when disabled is harmless.
    registerGenericClassificationRoutes(routes, {
        dataDir,
        store,
        bridge,
        repoTreeService,
        prepareTaskForEnqueue: prepareEnqueueTask,
    });
    registerRemoteServerRoutes(routes, {
        store: opts.remoteServerStore ?? new RemoteServerStore(dataDir),
        connector: opts.remoteServerConnector ?? new DevTunnelConnector(),
        sshConnector: opts.remoteServerSshConnector,
        getLocalBaseUrl: opts.getLocalBaseUrl,
    });
    registerProviderRoutes(routes, dataDir);
    // Provider SDK install routes (on-demand install of @openai/codex-sdk and @anthropic-ai/claude-agent-sdk).
    // cocInstallDir is the package root so npm installs land in the same node_modules as coc.
    registerProviderInstallRoutes(routes, {
        // __dirname at runtime = dist/server/routes/; package root is 3 levels up.
        cocInstallDir: path.join(__dirname, '../../..'),
    });
    registerProcessResumeRoutes(routes, store, undefined, {
        getDefaultProvider: resolveConcreteDefaultProvider,
    });
    registerFreshChatTerminalRoutes(routes, undefined, {
        getProvider: resolveConcreteDefaultProvider,
    });
    registerTerminalRoutes(routes, store, opts.getTerminalSessionManager ?? (() => undefined), opts.resolvedConfig, opts.runtimeConfigService);

    // Queue routes receive the bridge directly for per-repo routing
    registerQueueRoutes(routes, bridge, store, globalWorkspaceRootPath, {
        getDefaultProvider: concreteDefaultProvider,
        resolveDefaultProvider,
        isAutoProviderRoutingActive,
        getEffortTiersForProvider,
        state: queueGlobalState,
    });
    registerTaskRoutes(routes, store, dataDir, (workspaceId) => {
        getWsServer().broadcastProcessEvent({
            type: 'tasks-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    });
    registerTaskWriteRoutes(routes, store, dataDir);
    registerNotesRoutes(routes, store, dataDir, opts.resolvedConfig);
    registerNotesWriteRoutes(routes, store, dataDir);
    registerNotesCommentsRoutes(routes, store, dataDir, bridge);
    registerNotesImageRoutes(routes, store, dataDir);
    registerNotesGitRoutes(routes, store, dataDir, notesGitTimerManager);
    registerNotesGitAutoCommitRoutes(routes, store, dataDir, notesGitTimerManager, scheduleManager);
    registerNotesFilePreviewRoutes(routes, store, dataDir);
    registerNotesAICreateRoutes(routes, store, dataDir, bridge);
    registerNotesEditsRoutes(routes, store, dataDir);
    registerNotesRootsRoutes(routes, store, dataDir);

    registerWorkflowRoutes(routes, store);
    registerWorkspaceSummaryRoutes(routes, store, dataDir);
    registerWorkflowWriteRoutes(routes, store, (workspaceId) => {
        getWsServer().broadcastProcessEvent({
            type: 'workflows-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    }, bridge, resolvedAiService);
    registerTaskGenerationRoutes(routes, store, bridge, resolvedAiService, dataDir, prepareEnqueueTask);
    registerTemplateRoutes(routes, store);
    registerTemplateWriteRoutes(routes, store, (workspaceId) => {
        getWsServer().broadcastProcessEvent({
            type: 'templates-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    });
    registerReplicateApplyRoutes(routes, store);
    registerPromptRoutes(routes, store);
    registerPreferencesRoutes(
        routes,
        dataDir,
        (workspaceId) => opts.syncEngines?.get(workspaceId),
        async (workspaceId) => {
            await Promise.all([
                workItemGitHubPullPoller?.configureWorkspace(workspaceId),
                workItemAzureBoardsPullPoller?.configureWorkspace(workspaceId),
            ]);
        },
    );
    registerSeenStateRoutes(routes, store as any);
    registerPromptSuggestionRoutes(routes, store as any, dataDir, resolvedAiService);
    registerPromptHistoryRoutes(routes, store as any);
    registerGroupPinRoutes(routes, store, dataDir);
    const taskGroupService = TaskGroupService.fromProcessStore(store);
    registerTaskGroupRoutes({ routes, store, taskGroupService });
    registerRalphSessionChangeListener(dataDir, record => syncRalphSessionToTaskGroup(taskGroupService, record));
    registerPinArchiveRoutes(routes, store as any);
    registerTurnActionRoutes(routes, store as any, getWsServer);
    registerProcessHistoryRoutes(routes, store as any);
    registerWorkspaceHistoryRoutes(routes, store, bridge);
    registerTaskCommentsRoutes(routes, dataDir, bridge, store, getWsServer);
    registerDiffCommentsRoutes(routes, dataDir, bridge, store, getWsServer);
    registerCanvasRoutes(routes, dataDir, getWsServer, store, isKustoEnabled);
    registerAdminRoutes(routes, {
        store,
        dataDir,
        getWsServer,
        configPath,
        getQueueManager: () => queueFacade,
        getQueuePersistence: () => queuePersistence,
        restartExitCode: 75,
        configFunctions: { getConfigFilePath, getResolvedConfigWithSource, loadConfigFile, writeConfigFile },
        runtimeConfigService: opts.runtimeConfigService,
        tokenTtlMs,
        sdkServiceRegistry: sdkServiceRegistry,
    });

    // Runtime config endpoint for SPA feature flag freshness
    if (opts.runtimeConfigService) {
        registerRuntimeConfigRoutes(routes, {
            runtimeConfigService: opts.runtimeConfigService,
            hostname: opts.hostname ?? '',
            bindAddress: opts.bindAddress ?? '127.0.0.1',
        });
    }

    registerScheduleRoutes(routes, scheduleManager, async (repoId) => {
        const workspaces = await store.getWorkspaces();
        return workspaces.find(w => w.id === repoId)?.rootPath;
    }, resolvedAiService);

    // Resolve a process (conversation) ID to its owning workspace. Backs the
    // automation route workspace-boundary checks (legacy loop compatibility and
    // trigger create verification). Prefers the live queue task's repoId and
    // falls back to the persisted process metadata.
    const resolveProcessWorkspaceId = async (processId: string): Promise<string | undefined> => {
        try {
            const taskId = processId.startsWith('queue_') ? processId.slice('queue_'.length) : processId;
            const fromTask = bridge.getTask(taskId)?.repoId;
            if (fromTask) return fromTask;
            const proc = await store.getProcess(processId) ?? await store.getProcess(taskId);
            return proc?.metadata?.workspaceId;
        } catch {
            return undefined;
        }
    };

    // Loop routes
    if (opts.loopStore && opts.loopExecutor) {
        registerLoopRoutes(routes, {
            store: opts.loopStore,
            executor: opts.loopExecutor,
            emit: opts.loopEmit,
            resolveWorkspaceId: resolveProcessWorkspaceId,
        });
    }

    // Trigger routes (generic event → action framework). Gated on the
    // triggers.enabled feature flag — the create endpoint is also rejected
    // server-side when the flag is off.
    if (opts.triggerStore && opts.triggerManager) {
        registerTriggerRoutes(routes, {
            store: opts.triggerStore,
            manager: opts.triggerManager,
            emit: opts.triggerEmit,
            enabled: opts.resolvedConfig?.triggers?.enabled ?? false,
            resolveWorkspaceId: resolveProcessWorkspaceId,
        });
    }

    // MCP OAuth routes (feature-flagged via mcpOauth.enabled)
    if (opts.mcpOauthManager) {
        registerMcpOauthRoutes(routes, {
            manager: opts.mcpOauthManager,
            store,
            executeFollowUp: (processId, message) => bridge.executeFollowUp(processId, message),
            aiService: resolvedAiService,
            resolveWorkspaceRoot: async (workspaceId) => {
                const workspaces = await store.getWorkspaces();
                return workspaces.find(w => w.id === workspaceId)?.rootPath;
            },
        });
    }

    // Agent providers route — always registered, reads live config + SDK state.
    if (opts.runtimeConfigService) {
        const agentProvidersCtx: Parameters<typeof registerAgentProvidersRoutes>[1] = {
            runtimeConfigService: opts.runtimeConfigService,
            getCodexAvailability: async () => {
                const svc = sdkServiceRegistry.get(SDK_PROVIDER_CODEX);
                if (!svc) return { available: false, error: 'Codex SDK service not registered. Restart the server to enable Codex.' };
                return svc.isAvailable();
            },
            getClaudeAvailability: async () => {
                const svc = sdkServiceRegistry.get(SDK_PROVIDER_CLAUDE);
                if (!svc) return { available: false, error: 'Claude SDK service not registered. Restart the server to enable Claude.' };
                return svc.isAvailable();
            },
            getOpenCodeAvailability: async () => {
                const svc = sdkServiceRegistry.get(SDK_PROVIDER_OPENCODE);
                if (!svc) return { available: false, error: 'OpenCode SDK service not registered. Restart the server to enable OpenCode.' };
                return svc.isAvailable();
            },
            getCopilotSdkService: () => CopilotSDKService.getInstance(),
            getCodexSdkService: () => {
                const svc = sdkServiceRegistry.get(SDK_PROVIDER_CODEX);
                return svc instanceof CodexSDKService ? svc : undefined;
            },
            getClaudeSdkService: () => {
                const svc = sdkServiceRegistry.get(SDK_PROVIDER_CLAUDE);
                return svc instanceof ClaudeSDKService ? svc : undefined;
            },
            getOpenCodeSdkService: () => sdkServiceRegistry.get(SDK_PROVIDER_OPENCODE) ?? undefined,
            configPath,
            loadConfigFile,
            writeConfigFile,
            getConfigFilePath,
        };
        agentProvidersQuotaCache = new AgentProvidersQuotaCache(agentProvidersCtx);
        agentProvidersQuotaCache.start();
        quotaPauseWatcher = new QuotaPauseWatcher({
            quotaCache: agentProvidersQuotaCache,
            bridge,
            state: queueGlobalState,
            getRule: () => {
                const cfg = opts.runtimeConfigService?.config ?? opts.resolvedConfig;
                const raw = cfg?.queue?.quotaAutoPause;
                return {
                    enabled: raw?.enabled ?? false,
                    threshold: raw?.threshold ?? 0.15,
                    action: raw?.action ?? 'autopilot',
                    respectOverage: raw?.respectOverage ?? true,
                };
            },
        });
        quotaPauseWatcher.start();
        registerAgentProvidersRoutes(routes, {
            ...agentProvidersCtx,
            quotaCache: agentProvidersQuotaCache,
        });
    }

    registerMemoryRoutes(routes, dataDir);

    registerMemoryV2Routes(routes, dataDir, store);

    registerLogsRoutes(routes);
    registerInstructionRoutes(routes, store);
    registerStatsRoutes(routes, store);
    registerDbBrowserRoutes(routes, store, dataDir);
    registerHeapRoutes(routes);
    registerMyWorkRoutes(routes, store, dataDir);
    registerMyLifeRoutes(routes, store, dataDir);

    // Container default agent session routes (feature-flagged)
    if (opts.resolvedConfig?.containerDefaultAgent?.enabled) {
        const Database = require('better-sqlite3');
        fs.mkdirSync(path.join(dataDir, 'container-sessions'), { recursive: true });
        const containerDb = new Database(path.join(dataDir, 'container-sessions', 'sessions.db'));
        const containerSessionStore = new ContainerSessionStore(containerDb);
        registerContainerSessionRoutes(routes, {
            store: containerSessionStore,
            classifierDeps: {
                invokeClassifier: async (systemPrompt: string, userPrompt: string) => {
                    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
                    const result = await aiInvoker(combinedPrompt);
                    return result.response ?? '';
                },
            },
            getAgents: async (): Promise<ContainerAgentInfo[]> => {
                const workspaces = await store.getWorkspaces();
                // Group workspaces by name or treat each as its own "agent"
                return workspaces.map(w => ({
                    id: w.id,
                    name: w.name ?? w.id,
                    workspaces: [{
                        id: w.id,
                        name: w.name ?? w.id,
                        rootPath: w.rootPath ?? '',
                        description: w.rootPath ?? '',
                    }],
                }));
            },
            forwardMessage: async (_agentId, workspaceId, message, _existingProcessId) => {
                const taskId = await bridge.enqueue({
                    type: 'chat',
                    repoId: workspaceId,
                    payload: { message, workspaceId },
                    config: {},
                    priority: 'normal' as const,
                });
                return taskId;
            },
        });
    }

    // Teams messaging routes (container-mode)
    registerTeamsMessagingRoutes(routes, {
        dataDir,
        store,
        enqueueChat: async (workspaceId, message) => {
            const taskId = await bridge.enqueue({
                type: 'chat',
                repoId: workspaceId,
                payload: { message, workspaceId },
                config: {},
                priority: 'normal' as const,
            });
            return taskId;
        },
        executeFollowUp: (processId, message) => bridge.executeFollowUp(processId, message),
    });

    // Opt-in Git worktree execution feature flag getter (live when a runtime
    // config service is available, else from the resolved config snapshot).
    // Shared by Work Item execution and the Ralph launch/start routes.
    const getGitWorktreeExecutionEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.features?.gitWorktreeExecution ?? false
        : () => opts.resolvedConfig?.features?.gitWorktreeExecution ?? false;

    // Ralph routes
    registerRalphRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir, getGitWorktreeExecutionEnabled });
    registerRalphSessionRoutes(routes, { dataDir, store, bridge: bridgeWithResolvedDefaults });
    registerRalphContinueRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });
    registerRalphNewLoopRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });
    registerRalphPromoteRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });
    registerRalphLaunchRoutes(routes, { bridge: bridgeWithResolvedDefaults, dataDir, store, getGitWorktreeExecutionEnabled });
    registerRalphResumeRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });

    // Git worktree management routes (AC-06 cleanup): list + non-destructive
    // cleanup of CoC-created worktrees, scoped per workspace.
    registerWorktreeRoutes(routes, { store, dataDir, getGitWorktreeExecutionEnabled });

    // For Each routes: dedicated reviewed item-plan mode. Routes are registered
    // with a live feature guard so admin toggles take effect without restart.
    const forEachRunStore = new FileForEachRunStore({
        dataDir,
        onRunChanged: run => syncForEachRunToTaskGroup(taskGroupService, run),
    });
    const forEachRunExecutor = new ForEachRunExecutor({
        store: forEachRunStore,
        enqueueChildTask: (task) => enqueueWithResolvedDefaults(task),
        cancelChildTask: (taskId) => {
            const executor = bridge.findExecutorForTask(taskId);
            if (executor) {
                executor.cancelTask(taskId);
                return true;
            }
            return bridge.findManagerForTask(taskId)?.cancelTask(taskId) ?? false;
        },
    });
    forEachRunExecutor.attachToQueueRegistry(bridge.registry);
    const forEachPlanGenerator = createForEachPlanGenerator({
        aiService: resolvedAiService,
        resolveAiServiceForProvider: opts.resolveAiServiceForProvider,
    });
    const getForEachEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.forEach?.enabled ?? false
        : () => opts.resolvedConfig?.forEach?.enabled ?? false;
    registerForEachRoutes({
        routes,
        store: forEachRunStore,
        getForEachEnabled,
        generateItemPlan: forEachPlanGenerator.generateItemPlan,
        executor: forEachRunExecutor,
        resolveDefaultProvider,
    });

    // Map Reduce routes: dedicated reviewed map-plan mode with parallel map
    // dispatch followed by a single reduce child chat. Live feature guard mirrors
    // For Each so admin toggles take effect without restart.
    const mapReduceRunStore = new FileMapReduceRunStore({
        dataDir,
        onRunChanged: run => syncMapReduceRunToTaskGroup(taskGroupService, run),
    });
    const mapReduceRunExecutor = new MapReduceRunExecutor({
        store: mapReduceRunStore,
        enqueueChildTask: (task) => enqueueWithResolvedDefaults(task),
        cancelChildTask: (taskId) => {
            const executor = bridge.findExecutorForTask(taskId);
            if (executor) {
                executor.cancelTask(taskId);
                return true;
            }
            return bridge.findManagerForTask(taskId)?.cancelTask(taskId) ?? false;
        },
    });
    mapReduceRunExecutor.attachToQueueRegistry(bridge.registry);
    const mapReducePlanGenerator = createMapReducePlanGenerator({
        aiService: resolvedAiService,
        resolveAiServiceForProvider: opts.resolveAiServiceForProvider,
    });
    const getMapReduceEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.mapReduce?.enabled ?? false
        : () => opts.resolvedConfig?.mapReduce?.enabled ?? false;
    registerMapReduceRoutes({
        routes,
        store: mapReduceRunStore,
        getMapReduceEnabled,
        generatePlan: mapReducePlanGenerator.generatePlan,
        executor: mapReduceRunExecutor,
        resolveDefaultProvider,
    });

    // Legacy Native Copilot CLI session routes: read-only compatibility aliases
    // over the server user's native Copilot store. They share the unified
    // `features.nativeCliSessions` live guard so there is one operational switch
    // for the CLI Sessions surface.
    const getNativeCopilotSessionsEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.features?.nativeCliSessions ?? false
        : () => opts.resolvedConfig?.features?.nativeCliSessions ?? false;
    const nativeCopilotSessionService = new NativeCopilotSessionService({
        dbPath: opts.nativeCopilotSessionDbPath,
        sessionStateDir: opts.nativeCopilotSessionStateDir,
    });
    registerNativeCopilotSessionRoutes({
        routes,
        store,
        getEnabled: getNativeCopilotSessionsEnabled,
        service: nativeCopilotSessionService,
    });

    const getNativeCliSessionsEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.features?.nativeCliSessions ?? false
        : () => opts.resolvedConfig?.features?.nativeCliSessions ?? false;
    const nativeCliSessionProviders = new Map<NativeCliSessionProviderId, NativeSessionProvider>([
        ['copilot', new CopilotNativeSessionProvider(nativeCopilotSessionService)],
        ['codex', new CodexNativeSessionProvider()],
        ['claude', new ClaudeNativeSessionProvider()],
    ]);
    registerNativeCliSessionRoutes({
        routes,
        store,
        getEnabled: getNativeCliSessionsEnabled,
        providers: nativeCliSessionProviders,
    });

    // Quick Ask side-notes: per-process AI lookups on assistant chat turns.
    // Guarded by the live `features.quickAskSidenotes` admin flag (default off).
    const getQuickAskSidenotesEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.features?.quickAskSidenotes ?? false
        : () => opts.resolvedConfig?.features?.quickAskSidenotes ?? false;
    registerChatSidenotesRoutes({
        routes,
        store,
        dataDir,
        getEnabled: getQuickAskSidenotesEnabled,
    });

    const workItemStore = createWorkItemStore({ dataDir, processStore: store });

    // Dreams routes: reviewable, workspace-scoped cards plus manual run trigger.
    // Route registration is always present; the live config guard controls availability.
    const dreamStore = new FileDreamStore({
        dataDir,
        onRunChanged: run => syncDreamRunToTaskGroup(taskGroupService, run),
    });

    // Project pre-framework runs/sessions into the task-group registry.
    // Idempotent and best-effort: failures only log.
    void backfillTaskGroups({
        processStore: store,
        taskGroupService,
        forEachRunStore,
        mapReduceRunStore,
        dreamStore,
        dataDir,
    }).catch(() => {});
    const getDreamsEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.dreams?.enabled ?? false
        : () => opts.resolvedConfig?.dreams?.enabled ?? false;
    const activeWorkItemStatuses = WORK_ITEM_STATUSES.filter(status => !TERMINAL_WORK_ITEM_STATUSES.has(status));
    const dreamInternalProcessExecutor = new DreamInternalProcessExecutor({
        store,
        aiService: resolvedAiService,
        dataDir,
        provider: concreteDefaultProvider(),
        ...(opts.resolveAiServiceForProvider ? { resolveAiServiceForProvider: opts.resolveAiServiceForProvider } : {}),
    });
    const dreamRunExecutor = new DreamRunExecutor({
        store: dreamStore,
        processStore: store,
        runInternalStep: request => dreamInternalProcessExecutor.runStep(request),
        resolveSystemPrompt: section => resolveDreamSystemPrompt(section, { dataDir }),
        getDreamsEnabled,
        getWorkspaceDreamsEnabled: (workspaceId) => readRepoPreferences(dataDir, workspaceId).dreams?.enabled === true,
        listWorkspaceTasks: () => queueFacade.getAll(),
        getRelatedRecords: async (workspaceId) => {
            const result = await workItemStore.listWorkItems({
                repoId: workspaceId,
                status: activeWorkItemStatuses,
            });
            return result.items
                .filter(item => !item.archivedAt)
                .map(item => ({
                    kind: 'work-item' as const,
                    id: item.id,
                    status: item.status,
                    title: item.title,
                    summary: item.description?.trim() || item.title,
                    recommendation: item.title,
                }));
        },
    });
    bridge.setDreamRunExecutor(dreamRunExecutor);
    const getDefaultDreamRunOptions = (): DreamRunRequestOptions => {
        const dreams = (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.dreams;
        return {
            provider: dreams?.provider,
            model: dreams?.model,
            minIdleMs: dreams?.minIdleMs,
            confidenceThreshold: dreams?.confidenceThreshold,
            maxCandidates: dreams?.maxCandidates,
            conversationLimit: dreams?.conversationLimit,
            timeoutMs: dreams?.timeoutMs ?? DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS,
        };
    };
    const buildDreamRunTask = (
        workspaceId: string,
        trigger: 'manual' | 'idle',
        options: DreamRunRequestOptions,
    ): CreateTaskInput => {
        const mergedOptions: DreamRunRequestOptions = {
            ...getDefaultDreamRunOptions(),
            ...options,
        };
        const payload: Record<string, unknown> = {
            kind: TaskDefs.dreamRun.kind,
            workspaceId,
            trigger,
            ...(mergedOptions.provider ? { provider: mergedOptions.provider } : {}),
            ...(mergedOptions.model ? { model: mergedOptions.model } : {}),
            ...(mergedOptions.reasoningEffort ? { reasoningEffort: mergedOptions.reasoningEffort } : {}),
            ...(mergedOptions.confidenceThreshold !== undefined ? { confidenceThreshold: mergedOptions.confidenceThreshold } : {}),
            ...(mergedOptions.maxCandidates !== undefined ? { maxCandidates: mergedOptions.maxCandidates } : {}),
            ...(mergedOptions.conversationLimit !== undefined ? { conversationLimit: mergedOptions.conversationLimit } : {}),
            ...(mergedOptions.minIdleMs !== undefined ? { minIdleMs: mergedOptions.minIdleMs } : {}),
            ...(mergedOptions.timeoutMs !== undefined ? { timeoutMs: mergedOptions.timeoutMs } : {}),
        };
        return {
            type: TaskDefs.dreamRun.kind,
            priority: trigger === 'idle' ? 'low' : 'normal',
            repoId: workspaceId,
            payload,
            config: {
                ...(mergedOptions.model ? { model: mergedOptions.model } : {}),
                ...(mergedOptions.reasoningEffort ? { reasoningEffort: mergedOptions.reasoningEffort } : {}),
                ...(mergedOptions.timeoutMs !== undefined ? { timeoutMs: mergedOptions.timeoutMs } : {}),
            },
            displayName: `Dream Run: ${trigger === 'idle' ? 'Idle' : 'Manual'}`,
        };
    };
    const enqueueDreamRun = async (
        workspaceId: string,
        trigger: 'manual' | 'idle',
        options: DreamRunRequestOptions,
    ): Promise<Record<string, unknown>> => {
        if (readRepoPreferences(dataDir, workspaceId).dreams?.enabled !== true) {
            throw new Error(`Dreaming is not enabled for workspace '${workspaceId}'`);
        }
        const input = buildDreamRunTask(workspaceId, trigger, options);
        await prepareEnqueueTask(input);
        const taskId = await bridge.enqueue(input);
        const task = bridge.findManagerForTask(taskId)?.getTask(taskId);
        return task ? serializeTask(task) : { id: taskId };
    };
    const dreamIdleScheduler = new DreamIdleScheduler({
        getWorkspaceIds: async () => (await store.getWorkspaces()).map(workspace => workspace.id),
        getDreamsEnabled,
        getWorkspaceDreamsEnabled: (workspaceId) => readRepoPreferences(dataDir, workspaceId).dreams?.enabled === true,
        checkIdleReadiness: (workspaceId, options) => dreamRunExecutor.checkIdleReadiness(workspaceId, options),
        enqueueIdleRun: (workspaceId, options) => enqueueDreamRun(workspaceId, 'idle', options),
        getRunOptions: getDefaultDreamRunOptions,
        intervalMs: (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.dreams?.idleCheckIntervalMs,
    });
    registerDreamRoutes({
        routes,
        store: dreamStore,
        enqueueRun: (workspaceId, options) => enqueueDreamRun(workspaceId, 'manual', options),
        getDreamsEnabled,
    });

    // Work item routes
    const enqueueForWorkItems = (async (input: Parameters<EnqueueFunction>[0]) => {
        await prepareEnqueueTask(input as CreateTaskInput);
        return bridge.enqueue(input as CreateTaskInput);
    }) as EnqueueFunction;
    const getWorkItemsHierarchyEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.workItems?.hierarchy?.enabled ?? false
        : () => opts.resolvedConfig?.workItems?.hierarchy?.enabled ?? false;
    const getWorkItemsSyncEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.workItems?.sync?.enabled ?? false
        : () => opts.resolvedConfig?.workItems?.sync?.enabled ?? false;
    workItemGitHubPullPoller = new WorkItemGitHubPullPoller({
        dataDir,
        processStore: store,
        workItemStore,
        getSyncEnabled: getWorkItemsSyncEnabled,
    });
    workItemAzureBoardsPullPoller = new WorkItemAzureBoardsPullPoller({
        dataDir,
        processStore: store,
        workItemStore,
        getSyncEnabled: getWorkItemsSyncEnabled,
    });
    opts.runtimeConfigService?.onChange?.(() => {
        void Promise.all([
            workItemGitHubPullPoller?.refreshWorkspaceTimers(),
            workItemAzureBoardsPullPoller?.refreshWorkspaceTimers(),
        ]).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[work-items/provider-poll] Failed to refresh polling after config change: ${message}\n`);
        });
    });
    const getWorkItemsAiAuthoringEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.workItems?.aiAuthoring?.enabled ?? false
        : () => opts.resolvedConfig?.workItems?.aiAuthoring?.enabled ?? false;
    const getWorkItemsWorkflowEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.workItems?.workflow?.enabled ?? false
        : () => opts.resolvedConfig?.workItems?.workflow?.enabled ?? false;
    // getGitWorktreeExecutionEnabled is defined earlier (near the Ralph routes)
    // and shared with the Ralph launch/start routes.
    // AI-draft route must be registered before generic /:workItemId routes to prevent "ai-draft" from matching as an ID
    const workItemAiGenerators = createWorkItemAiGenerators({ aiService: resolvedAiService });
    registerWorkItemAiRoutes({
        routes,
        workItemStore,
        processStore: store,
        getAiAuthoringEnabled: getWorkItemsAiAuthoringEnabled,
        getWorkflowEnabled: getWorkItemsWorkflowEnabled,
        getHierarchyEnabled: getWorkItemsHierarchyEnabled,
        getWsServer,
        generateNewItemDraft: workItemAiGenerators.generateNewItemDraft,
        generateImproveItemDraft: workItemAiGenerators.generateImproveItemDraft,
    });
    // Hierarchy tree route must be registered before generic /:workItemId to win the match
    registerWorkItemHierarchyRoutes({
        routes,
        workItemStore,
        processStore: store,
        getHierarchyEnabled: getWorkItemsHierarchyEnabled,
    });
    const workItemSyncProviders = [
        createGitHubWorkItemSyncProviderAdapter(),
        createAzureBoardsWorkItemSyncProviderAdapter({ dataDir }),
    ];
    registerWorkItemSyncRoutes({
        routes,
        workItemStore,
        processStore: store,
        dataDir,
        getHierarchyEnabled: getWorkItemsHierarchyEnabled,
        getSyncEnabled: getWorkItemsSyncEnabled,
        providers: workItemSyncProviders,
        onGitHubBackedEpicTreeChanged: (workspaceId) => workItemGitHubPullPoller?.configureWorkspace(workspaceId),
        onAzureBoardsBackedEpicTreeChanged: (workspaceId) => workItemAzureBoardsPullPoller?.configureWorkspace(workspaceId),
    });
    registerWorkItemRoutes({
        routes,
        workItemStore,
        processStore: store,
        enqueue: enqueueForWorkItems,
        getWsServer,
        getHierarchyEnabled: getWorkItemsHierarchyEnabled,
        getSyncEnabled: getWorkItemsSyncEnabled,
        dataDir,
    });
    registerWorkItemPlanRoutes({ routes, workItemStore, processStore: store, getWsServer, getWorkflowEnabled: getWorkItemsWorkflowEnabled });
    registerWorkItemExecutionRoutes({ routes, workItemStore, processStore: store, enqueue: enqueueForWorkItems, getWsServer, dataDir, getWorkflowEnabled: getWorkItemsWorkflowEnabled, getGitWorktreeExecutionEnabled });
    registerWorkItemChangesRoutes({ routes, workItemStore, processStore: store, getWsServer });

    const activeWorkspaceBackgroundRefresher = new ActiveWorkspaceBackgroundRefresher({
        tracker: activeWorkspaceTracker,
        refreshWorkspace: async (workspaceId) => {
            const config = opts.runtimeConfigService?.config ?? opts.resolvedConfig;
            await Promise.all([
                config?.pullRequests?.enabled === true
                    ? warmPullRequestWorkspaceCache({
                        dataDir,
                        workspaceId,
                        repoId: workspaceId,
                        store,
                        bridge,
                        service: repoTreeService,
                        suggestionsEnabled: config.pullRequests?.suggestions === true,
                        autoClassifyTeamEnabled: isPullRequestTeamAutoClassificationEnabled(),
                        prepareTaskForEnqueue: prepareEnqueueTask,
                    })
                    : Promise.resolve(),
                warmWorkItemWorkspaceCache({
                    workspaceId,
                    workItemStore,
                    processStore: store,
                    dataDir,
                    getHierarchyEnabled: getWorkItemsHierarchyEnabled,
                    getSyncEnabled: getWorkItemsSyncEnabled,
                    providers: workItemSyncProviders,
                }),
            ]);
        },
    });

    // Wire queue task completion → work item status update + commit collection
    bridge.on('queueChange', (event: { type: string; task?: any }) => {
        if (event.type !== 'updated' || !event.task) return;
        const task = event.task;
        const taskStatus: string = task.status;

        if (taskStatus === 'completed' && getWorkItemsWorkflowEnabled()) {
            const goalGrilling = task.payload?.context?.workItemGoalGrilling;
            if (goalGrilling?.workspaceId && goalGrilling?.workItemId) {
                void (async () => {
                    try {
                        const process = task.processId
                            ? await store.getProcess(task.processId, goalGrilling.workspaceId).catch(() => undefined)
                            : undefined;
                        const updatedGoal = await saveGoalGrillingSpecFromResponse({
                            workspaceId: goalGrilling.workspaceId,
                            workItemId: goalGrilling.workItemId,
                            responseText: getLatestAssistantResponse(process),
                            processId: task.processId,
                            store: workItemStore,
                        });
                        if (!updatedGoal) return;
                        clearWorkItemResponseCacheForWorkspace(updatedGoal.repoId);
                        getWsServer?.()?.broadcastProcessEvent({
                            type: 'work-item-updated',
                            workspaceId: updatedGoal.repoId,
                            item: updatedGoal,
                        });
                    } catch (error) {
                        getLogger().warn(
                            LogCategory.AI,
                            `[WorkItems] Failed to persist Goal grilling spec for ${goalGrilling.workItemId}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                })();
            }
        }

        const workItemId = task.payload?.workItemId as string | undefined;
        if (!workItemId) return;
        if (taskStatus !== 'completed' && taskStatus !== 'failed' && taskStatus !== 'cancelled') return;
        const workItemStorageRepoId = typeof task.payload?.workItemStorageRepoId === 'string'
            ? task.payload.workItemStorageRepoId
            : typeof task.payload?.context?.workItemExecution?.originId === 'string'
                ? task.payload.context.workItemExecution.originId
                : undefined;
        const executionWorkspaceId = typeof task.payload?.workspaceId === 'string'
            ? task.payload.workspaceId
            : undefined;

        handleWorkItemTaskComplete(
            workItemId,
            task.id,
            {
                status: taskStatus as 'completed' | 'failed' | 'cancelled',
                error: task.error,
                processId: task.processId,
            },
            workItemStore,
            workItemStorageRepoId,
        ).then(async () => {
            try {
                let updatedItem = await workItemStore.getWorkItem(workItemId, workItemStorageRepoId).catch(() => undefined);
                if (!updatedItem) return;
                const broadcastRepoId = workItemStorageRepoId ?? updatedItem.repoId;

                // Auto-create plan version from resolved plan comments
                if (taskStatus === 'completed') {
                    const matchedExec = updatedItem.executionHistory?.find(e => e.taskId === task.id);
                    if (matchedExec?.sessionCategory === 'resolve-plan-comments' && task.processId) {
                        try {
                            const process = await store.getProcess(task.processId, executionWorkspaceId).catch(() => undefined);
                            const afterPlan = await autoVersionPlanFromResolvedComments(
                                workItemId,
                                process?.result,
                                workItemStore,
                                workItemStorageRepoId,
                            );
                            if (afterPlan) updatedItem = afterPlan;
                        } catch { /* non-fatal: plan auto-versioning is best-effort */ }
                    }
                }

                // Collect git commits for the just-closed change
                let commitsAttached = false;
                const changes = updatedItem.changes ?? [];
                const justClosed = changes.find(
                    c => c.taskId === task.id && c.status === 'closed' && c.headBefore,
                );
                if (justClosed?.headBefore) {
                    const workspaces = await store.getWorkspaces().catch(() => []);
                    const workspace = workspaces.find(w => w.id === (executionWorkspaceId ?? updatedItem.repoId));
                    if (workspace?.rootPath) {
                        const commits = collectWorkItemCommits(workspace.rootPath, justClosed.headBefore);
                        if (commits.length > 0) {
                            await workItemStore.updateChange(workItemId, justClosed.id, { commits }, workItemStorageRepoId).catch(() => {});
                            commitsAttached = true;
                        }
                    }
                }

                // Update the placeholder task file to reflect the final execution status.
                try {
                    const fileStatus = toTaskFileStatus(taskStatus as 'completed' | 'failed' | 'cancelled');
                    const taskFileWorkspaceId = executionWorkspaceId ?? updatedItem.repoId;
                    await upsertWorkItemTaskFile(dataDir, taskFileWorkspaceId, workItemId, updatedItem.title, fileStatus);
                    getWsServer?.()?.broadcastProcessEvent({
                        type: 'tasks-changed',
                        workspaceId: taskFileWorkspaceId,
                        timestamp: Date.now(),
                    });
                } catch { /* non-fatal — placeholder file update is best-effort */ }

                // Re-fetch after commit attachment so the broadcast includes commits
                const itemToSend = commitsAttached
                    ? (await workItemStore.getWorkItem(workItemId, workItemStorageRepoId).catch(() => updatedItem)) ?? updatedItem
                    : updatedItem;

                clearWorkItemResponseCacheForWorkspace(broadcastRepoId);
                getWsServer?.()?.broadcastProcessEvent({
                    type: 'work-item-updated',
                    workspaceId: broadcastRepoId,
                    item: itemToSend,
                });
            } catch {
                // Non-fatal
            }
        }).catch(() => {
            // Non-fatal: don't crash the server on work item update failure
        });
    });

    const wikiManager = registerWikiRoutes(routes, {
        wikis: wikiOptions?.wikis,
        aiEnabled: wikiOptions?.aiEnabled,
        dataDir,
        store,
        onWikiRebuilding: (wikiId, affectedComponentIds) => {
            getWsServer().broadcastWikiEvent({
                type: 'wiki-rebuilding',
                wikiId,
                components: affectedComponentIds,
            });
        },
        onWikiReloaded: (wikiId, affectedComponentIds) => {
            getWsServer().broadcastWikiEvent({
                type: 'wiki-reload',
                wikiId,
                components: affectedComponentIds,
            });
        },
        onWikiError: (wikiId, error) => {
            getWsServer().broadcastWikiEvent({
                type: 'wiki-error',
                wikiId,
                message: error.message,
            });
        },
    });

    // Sync routes (notes git sync — per-workspace)
    registerSyncRoutes(
        routes,
        (workspaceId) => opts.syncEngines?.get(workspaceId),
        (workspaceId) => {
            try {
                const prefsPath = path.join(opts.dataDir, 'repos', workspaceId, 'preferences.json');
                if (fs.existsSync(prefsPath)) {
                    return JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                }
            } catch { /* return undefined */ }
            return undefined;
        },
    );

    return { wikiManager, workItemGitHubPullPoller, workItemAzureBoardsPullPoller, agentProvidersQuotaCache, quotaPauseWatcher, activeWorkspaceBackgroundRefresher, dreamIdleScheduler };
}
