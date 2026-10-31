/**
 * `registerAllRoutes` consolidates all registerXxxRoutes calls so that
 * `createExecutionServer` only deals with infrastructure setup.
 */

import { getOrCreateServerIdentity } from '../servers/server-identity';
import * as fs from 'fs';
import * as path from 'path';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { CodaStore } from '../sentinel-coda/coda-store';
import { CodaEngine } from '../sentinel-coda/coda-engine';
import { CodaRunService } from '../sentinel-coda/coda-runs';
import { ScrubberScheduler } from '../sentinel-coda/scrubber-scheduler';
import { registerCodaRoutes } from '../sentinel-coda/coda-routes';
import { CodaCommands } from '../sentinel-coda/coda-commands';
import { SentinelRefrainStore } from '../sentinel-refrains/refrain-store';
import { SentinelRefrainService } from '../sentinel-refrains/refrain-service';
import { SentinelJobScheduler } from '../sentinel-refrains/job-scheduler';
import { registerSentinelRefrainRoutes } from '../sentinel-refrains/refrain-routes';
import { SentinelRefrainCommands } from '../sentinel-refrains/refrain-commands';
import type { Route } from '../types';
import type { ProcessStore, TaskQueueManager, ISDKService, AIInvoker, CreateTaskInput } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore, modelMetadataStore, sdkServiceRegistry, CopilotSDKService, CodexSDKService, ClaudeSDKService, SDK_PROVIDER_CLAUDE, SDK_PROVIDER_CODEX, SDK_PROVIDER_OPENCODE, getLogger, LogCategory, toQueueProcessId, isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { SqliteQueuePersistence } from '../queue/sqlite-queue-persistence';
import type { ScheduleManager } from '../schedule/schedule-manager';
import { registerApiRoutes } from '../core/api-handler';
import { registerQueueRoutes } from '../queue/queue-handler';
import { prepareTaskForEnqueue } from './queue-enqueue';
import { serializeTask, enqueueViaBridge } from './queue-shared';
import type { QueueGlobalState } from './queue-shared';
import type { EnqueueChatFn, SendMessageFn, SendToConversationRuntimeOptions } from '../llm-tools/send-to-conversation-tool';
import { cancelConversation } from '../processes/cancel-conversation';
import { coerceChatStyle } from '../executors/chat-style-prompt';
import { BrowserToolStateStore } from '../llm-tools/browser-tools';
import { createSendMessageCapability } from '../processes/send-message-capability';
import { DelegatedJobStore } from '../delegation/delegated-job-store';
import { RemoteDelegationRequestStore } from '../delegation/remote-delegation-request-store';
import { registerRemoteDelegationRoutes } from '../delegation/remote-delegation-routes';
import { RemoteDelegationAdmissionStore } from '../delegation/remote-delegation-admission-store';
import { RemoteDelegationResults } from '../delegation/remote-delegation-results';
import { RemoteDelegationReturn } from '../delegation/remote-delegation-return';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { DelegatedJobResults } from '../delegation/delegated-job-results';
import { DelegatedJobReviews } from '../delegation/delegated-job-reviews';
import { ProcessMessageDeliveryService } from '../processes/process-message-delivery-service';
import { createSentinelDelegationEnqueue } from '../delegation/sentinel-delegation-enqueue';
import { compactProcess } from '../processes/compact-process';
import { registerTaskRoutes, registerTaskWriteRoutes } from '../tasks/tasks-handler';
import { registerTaskGenerationRoutes } from '../tasks/task-generation-handler';
import { registerPromptRoutes } from '../prompts/prompt-handler';
import { registerLanguageServerRoutes } from '../language-servers';
import { readRepoPreferences, registerPreferencesRoutes } from '../preferences-handler';
import { registerAdminRoutes } from '../admin/admin-handler';
import { registerTaskCommentsRoutes } from '../tasks/comments/task-comments-handler';
import { registerDiffCommentsRoutes } from '../tasks/comments/diff-comments-handler';
import { registerChatSidenotesRoutes } from '../processes/chat-sidenotes/chat-sidenotes-handler';
import { SentinelTodoStore } from '../sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';
import type { SentinelPrOutcomeService } from '../triggers/sentinel-pr-outcome-service';
import { registerSentinelPrOutcomeRoutes } from '../triggers/sentinel-pr-outcome-routes';
import { SentinelDependencyStore } from '../sentinel-todos/sentinel-dependency-store';
import { SentinelDependencyActions } from '../sentinel-todos/sentinel-dependency-actions';
import { createSentinelDependencyTargetValidator } from '../sentinel-todos/sentinel-dependency-target';
import { createPrStatusFetcher } from '../triggers/pr-status-fetcher';
import { registerSentinelTodoRoutes } from '../sentinel-todos/sentinel-todo-routes';
import { createSentinelTodoDelegationHooks } from '../sentinel-todos/sentinel-todo-delegation';
import { registerQuickAskAnswerRoutes } from '../processes/chat-sidenotes/quick-ask-answer-handler';
import { registerCanvasRoutes } from '../canvas/canvas-routes';
import { registerCanvasExtensionRoutes } from '../canvas-extensions/routes';
import type { CanvasExtensionRuntime } from '../canvas-extensions/instance-service';
import { createCanvasRunScriptFactory } from '../canvas/canvas-script-bridge';
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
import { registerNotesRoutes, registerNotesWriteRoutes, registerNotesCommentsRoutes, registerNotesImageRoutes, registerNotesGitRoutes, registerNotesGitAutoCommitRoutes, registerNotesFilePreviewRoutes, registerNotesAICreateRoutes, registerNotesRootsRoutes, registerPaperAnnotationsRoutes, registerPaperIngestRoutes } from '../notes/notes-handler';
import { registerNotesEditsRoutes } from '../notes/notes-edits-handler';
import { registerReplicateApplyRoutes } from '../templates/replicate-apply-handler';
import { registerScheduleRoutes } from '../schedule/schedule-handler';
import { registerStatsRoutes } from '../admin/stats-handler';
import type { TurnPerformanceStore } from '../storage/turn-performance-store';
import { registerDbBrowserRoutes } from '../admin/db-browser-handler';
import { registerHeapRoutes } from '../admin/heap-monitor';
import { registerSeenStateRoutes } from '../processes/seen-state-handler';
import { registerWhatsNewRoutes } from '../whats-new/whats-new-handler';
import { WhatsNewService } from '../whats-new/whats-new-service';
import { registerPromptSuggestionRoutes } from '../processes/prompt-suggestion-handler';
import { registerPromptHistoryRoutes } from '../processes/prompt-history-handler';
import { registerGroupPinRoutes } from '../processes/group-pin-handler';
import { registerTaskGroupRoutes } from './task-group-routes';
import { TaskGroupService } from '../task-groups/task-group-service';
import { syncDreamRunToTaskGroup, syncForEachRunToTaskGroup, syncMapReduceRunToTaskGroup, syncRalphSessionToTaskGroup } from '../task-groups/feature-sync';
import { registerRalphSessionChangeListener } from '../ralph/ralph-session-store';
import { backfillTaskGroups } from '../task-groups/backfill';
import { registerPinArchiveRoutes } from '../processes/pin-archive-handler';
import { registerPinOrderRoutes } from '../processes/pin-order-handler';
import { registerChatFolderRoutes } from '../processes/chat-folder-handler';
import { GroupFolderStore } from '../processes/group-folder-store';
import { registerGroupFolderRoutes } from '../processes/group-folder-handler';
import { registerTurnActionRoutes } from '../processes/turn-actions-handler';
import { registerProcessHistoryRoutes } from '../processes/process-history-handler';
import type { AutoPullManager } from '../git/auto-pull-manager';
import { createAutoPullManager } from '../git/auto-pull-service';
import { registerGitAutoPullRoutes } from './api-git-auto-pull-routes';
import type { NotesGitTimerManager } from '../notes/git/notes-git-timer-manager';
import { registerWorkspaceHistoryRoutes } from './api-workspace-history-routes';
import { registerTerminalRoutes } from '../terminal/terminal-routes';
import { registerMyWorkRoutes } from '../workspaces/my-work-handler';
import { registerMyLifeRoutes } from '../workspaces/my-life-handler';
import { registerRepoGroupRoutes } from '../workspaces/repo-group-handler';
import { readRepoQueueSnapshot } from './queue-stats';
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
import { execGitAsync } from '@plusplusoneplusplus/forge';
import { TERMINAL_WORK_ITEM_STATUSES, WORK_ITEM_STATUSES, type WorkItemChangeCommit } from '../work-items/types';
import { DEFAULT_CONFIG, getResolvedConfigWithSource, loadConfigFile, writeConfigFile, getConfigFilePath } from '../../config';
import type { ResolvedCLIConfig } from '../../config';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import { TaskDefs, type ChatMode, type ChatProvider } from '../tasks/task-types';
import type { TerminalSessionManager } from '../terminal/index';
import { registerRemoteServerRoutes } from '../servers/remote-server-routes';
import { createWorkspaceDirectory } from '../servers/workspace-directory';
import { RemoteServerStore } from '../servers/remote-server-store';
import { DevTunnelConnector } from '../servers/devtunnel-connector';
import type { SshConnector } from '../servers/ssh-connector';
import { registerRalphRoutes } from './queue-ralph-routes';
import { registerRalphSessionRoutes } from './ralph-session-routes';
import { registerRalphContinueRoutes } from './ralph-continue-routes';
import { registerRalphMaxIterationsRoutes } from './ralph-max-iterations-routes';
import { registerRalphNewLoopRoutes } from './ralph-new-loop-routes';
import { registerRalphPromoteRoutes } from './ralph-promote-routes';
import { registerRalphLaunchRoutes } from './ralph-launch-routes';
import { registerRalphGrillingApprovalRoutes } from './ralph-grilling-approval-routes';
import { prepareRalphGrilling } from '../ralph/grilling-state';
import { launchRalphSession, type LaunchRalphFn, type RalphLaunchDeps } from '../ralph/ralph-launch-service';
import { createRemoteDelegationLaunch } from '../delegation/remote-delegation-launch';
import { registerRalphResumeRoutes } from './ralph-resume-routes';
import { registerRalphInputRoutes } from './ralph-input-routes';
import { registerRalphSubmitRoutes } from './ralph-submit-routes';
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
import { createNativeCliSessionProviders } from '../native-copilot-sessions/native-cli-provider-registry';
import { registerNativeCliSessionRoutes } from './native-cli-session-routes';
import { registerDreamRoutes } from '../dreams/dream-routes';
import { registerDecisionRoutes } from '../decisions/decision-routes';
import { createDecisionService, type DecisionService } from '../decisions/decision-service';
import { FileDreamStore } from '../dreams/dream-store';
import { DreamRunExecutor, type DreamRunRequestOptions } from '../dreams/dream-runner';
import { DreamIdleScheduler } from '../dreams/dream-idle-scheduler';
import { DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS } from '../dreams/dream-analyzer';
import { resolveDreamSystemPrompt } from '../dreams/dream-prompt-resolver';
import { DreamInternalProcessExecutor } from '../executors/dream-internal-process-executor';
import { registerCronRoutes } from '../cron/cron-handler';
import type { CronStore } from '../cron/cron-store';
import type { CronExecutor, CronEventEmit } from '../cron/cron-executor';
import { registerTriggerRoutes } from '../triggers/trigger-handler';
import { createPrRepairOwnerValidator } from '../triggers/pr-repair-owner';
import { createProcessWorkspaceResolver } from '../processes/process-workspace-resolver';
import { registerSentinelOvertureRoutes } from '../triggers/sentinel-overture-routes';
import type { SentinelOvertureService } from '../triggers/sentinel-overture-service';
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
import { TeamsMessagingManager } from '../messaging/teams-messaging-manager';
import { registerWhatsAppMessagingRoutes } from '../messaging/whatsapp-messaging-handler';
import type { WhatsAppMessagingManager } from '../messaging/whatsapp-messaging-manager';
import { WhatsAppBindings, WhatsAppBindingReleaseError } from '../messaging/whatsapp-bindings';
import { incomingImageTaskPayload, type PreparedIncomingImages } from '../messaging/incoming-images';
import { WhatsAppCommandRouter } from '../messaging/whatsapp-command-router';
import type { MessagingChatMode } from '@plusplusoneplusplus/coc-connector';
import { createMessagingChatModeResolver } from '../messaging/messaging-chat-mode';
import { WhatsAppAnswerRelay, createWhatsAppNoticeTransport, createWhatsAppQuestionTransport } from '../messaging/whatsapp-answer-relay';
import { hasSentinelMirrorProjections, SentinelMirrorService, type SentinelMirrorEcho } from '../messaging/sentinel-mirror-service';
import { createTeamsMirrorAdapter, createWhatsAppMirrorAdapter } from '../messaging/sentinel-mirror-adapters';
import { MessagingJobNotices } from '../messaging/job-notices';
import { createAutoCompactionOrigins } from '../messaging/auto-compaction-origins';
import { createMessagingHandOff } from '../messaging/job-handoff';
import { AskUserQuestionRelayHub, type AskUserQuestionRelay } from '../messaging/ask-user-relay';
import { createTeamsIc3OwnCommandLaunch } from '../messaging/teams-ic3-own-command-launch';
import { createTeamsIc3OwnCommandsRuntime } from '../messaging/teams-ic3-own-commands-runtime';
import { createTeamsReactionLaunch } from '../messaging/teams-reaction-launch';
import { createTeamsReactionExecution } from '../messaging/teams-reaction-execution';
import { createTeamsReactionRuntime } from '../messaging/teams-reaction-runtime';
import { sendTeamsReactionResult } from '../messaging/teams-reaction-reply';
import { resolveTeamsReactionOutcome } from '../messaging/teams-reaction-outcome';
import { registerContainerSessionRoutes } from '../container-sessions/container-session-handler';
import { ContainerSessionStore } from '../container-sessions/container-session-store';
import type { ContainerAgentInfo } from '../container-sessions/container-session-types';
import type { ResolveDefaultProviderOptions } from './queue-shared';
import { ActiveWorkspaceTracker } from '../dashboard/active-workspace-tracker';
import { ActiveWorkspaceBackgroundRefresher } from '../dashboard/active-workspace-background-refresher';
import type { NotesSearchService } from '../notes/notes-search-service';

/** Collect git commits made between headBefore and current HEAD. Non-fatal — returns [] on error. */
async function collectWorkItemCommits(
    repoRoot: string,
    headBefore: string,
): Promise<WorkItemChangeCommit[]> {
    try {
        const output = await execGitAsync(
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
    /** Shared decision service (decision API + `system_one` tool). Defaults to one with no Copilot service, which answers 503. */
    decisionService?: DecisionService;
    getWsServer: () => ProcessWebSocketServer;
    queuePersistence: SqliteQueuePersistence;
    aiInvoker: AIInvoker;
    getTerminalSessionManager?: () => TerminalSessionManager | undefined;
    resolvedConfig?: ResolvedCLIConfig;
    runtimeConfigService?: RuntimeConfigService;
    kustoClientFactory?: import('../kusto/kusto-exec').KustoClientFactory;
    canvasExtensionRuntime?: CanvasExtensionRuntime;
    remoteServerStore?: RemoteServerStore;
    remoteServerConnector?: DevTunnelConnector;
    remoteServerSshConnector?: SshConnector;
    getLocalBaseUrl?: () => string | undefined;
    cronStore?: CronStore;
    cronExecutor?: CronExecutor;
    triggerStore?: TriggerStore;
    triggerManager?: TriggerManager;
    triggerEmit?: TriggerEventEmit;
    sentinelOvertures?: SentinelOvertureService;
    mcpOauthManager?: McpOauthManager;
    resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
    cronEmit?: CronEventEmit;
    hostname?: string;
    bindAddress?: string;
    syncEngines?: Map<string, SyncEngine>;
    /** Late-bound accessor for the turn-performance metric store (TTFT/TPS stats route). */
    getTurnPerformanceStore?: () => TurnPerformanceStore | undefined;
    toolInventoryStore?: import('./api-shared').ApiRouteContext['toolInventoryStore'];
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
    setBrowserControl?: (getRuntime: () => import('@plusplusoneplusplus/coc-client').BrowserControlRuntime | undefined, state: BrowserToolStateStore) => void;
    setSendToConversationRuntime?: (runtime: SendToConversationRuntimeOptions) => void;
    /**
     * Publish the bound in-process Ralph launch (the `POST /api/ralph-launch`
     * path over the resolved-defaults bridge) for `send_to_conversation`
     * mode "ralph".
     */
    setLaunchRalph?: (fn: LaunchRalphFn) => void;
    /** Publish the Sentinel to-do service getter to the executor runtime. */
    setSentinelTodos?: (get: () => SentinelTodoService | undefined) => void;
    sentinelPrOutcomes?: SentinelPrOutcomeService;
    setSentinelDependencyAdmission?: (get: NonNullable<import('../executors/executor-runtime-contracts').ExecutorRuntimeCapabilities['getSentinelDependencyAdmission']>) => void;
    setSentinelCoda?: (get: () => CodaRunService | undefined) => void;
    setSentinelRefrains?: (get: () => SentinelRefrainService | undefined) => void;
    setSentinelRefrainCommands?: (get: NonNullable<import('../executors/executor-runtime-contracts').ExecutorRuntimeCapabilities['getSentinelRefrainCommands']>) => void;
    /** Publish the WhatsApp/Teams ask_user question relay to the executor runtime. */
    setAskUserQuestionRelay?: (relay: AskUserQuestionRelay) => void;
    /** Shared native Notes index lifecycle, validated by the composition root. */
    notesSearchService: NotesSearchService;
}

export function registerAllRoutes(routes: Route[], opts: RegisterRoutesOptions): { teamsMessagingManager: TeamsMessagingManager; whatsappMessagingManager: WhatsAppMessagingManager; workItemGitHubPullPoller: WorkItemGitHubPullPoller; workItemAzureBoardsPullPoller: WorkItemAzureBoardsPullPoller; autoPullManager: AutoPullManager; agentProvidersQuotaCache?: AgentProvidersQuotaCache; quotaPauseWatcher?: QuotaPauseWatcher; activeWorkspaceBackgroundRefresher: ActiveWorkspaceBackgroundRefresher; dreamIdleScheduler: DreamIdleScheduler; repoTreeService: RepoTreeService; codaReady: Promise<number>; sentinelRefrainsShutdown: () => Promise<void>; teamsIc3OwnCommands?: ReturnType<typeof createTeamsIc3OwnCommandsRuntime>; teamsReactions?: { dispose(): Promise<void> } } {
    const {
        store, bridge, queueFacade, scheduleManager,
        notesGitTimerManager,
        dataDir, configPath, tokenTtlMs, globalWorkspaceRootPath,
        resolvedAiService, getWsServer, queuePersistence,
        aiInvoker,
    } = opts;
    let workItemGitHubPullPoller: WorkItemGitHubPullPoller | undefined;
    let workItemAzureBoardsPullPoller: WorkItemAzureBoardsPullPoller | undefined;
    let agentProvidersQuotaCache: AgentProvidersQuotaCache | undefined;
    let quotaPauseWatcher: QuotaPauseWatcher | undefined;
    // Server-side per-repo git auto-pull. Constructed here (rather than in the
    // composition root) so the preferences routes below can re-arm a repo's
    // timer the moment its `autoPull` preference changes; the caller owns
    // `startAll()` and `dispose()`.
    const autoPullManager = createAutoPullManager({ dataDir, processStore: store, getWsServer });
    registerGitAutoPullRoutes({ routes, store, autoPullManager });
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
    const getRalphEnabled = () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.ralph?.enabled === true;
    const prepareEnqueueTask = async (input: CreateTaskInput): Promise<void> => {
        await prepareRalphGrilling(input, { dataDir, store, enabled: getRalphEnabled() });
        await prepareTaskForEnqueue(input, {
            dataDir,
            browserControlEnabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.browserControl?.enabled === true,
            getDefaultProvider: concreteDefaultProvider,
            resolveDefaultProvider,
            isAutoProviderRoutingActive,
            getEffortTiersForProvider,
        });
    };
    const enqueueWithResolvedDefaults = async (input: CreateTaskInput, admissionHeld = false): Promise<string> => {
        await prepareEnqueueTask(input);
        return admissionHeld ? bridge.enqueueAdmitted(input) : bridge.enqueue(input);
    };
    const bridgeWithResolvedDefaults = Object.create(bridge) as MultiRepoQueueRouter;
    Object.defineProperty(bridgeWithResolvedDefaults, 'enqueue', {
        value: enqueueWithResolvedDefaults,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(bridgeWithResolvedDefaults, 'enqueueAdmitted', {
        value: (input: CreateTaskInput) => enqueueWithResolvedDefaults(input, true),
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
    let sentinelMirror: SentinelMirrorService | undefined;
    const getSentinelMirror = () => sentinelMirror;

    // Publish the bound enqueue capability so executors (created before routes)
    // can offer the `send_to_conversation` tool. Reuses the exact machinery
    // `POST /api/queue` uses: provider/effort defaults resolution, then route +
    // enqueue via the per-repo queue manager.
    const delegatedJobs = new DelegatedJobStore(dataDir);
    const remoteDelegationRequests = new RemoteDelegationRequestStore(dataDir, delegatedJobs);
    // Sentinel to-do ledger: always available for Sentinel bookkeeping, never job control.
    // Production borrows the process-store connection; stub stores use native
    // in-memory SQLite, like the queue infrastructure.
    const todoDb = store instanceof SqliteProcessStore ? store.getDatabase() : new NativeDatabase(':memory:');
    let todoStore: SentinelTodoStore;
    try {
        todoStore = new SentinelTodoStore(todoDb);
    } catch (error) {
        if (!(store instanceof SqliteProcessStore)) todoDb.close();
        throw error;
    }
    const decisionService = opts.decisionService ?? createDecisionService(undefined);
    const sentinelTodos = new SentinelTodoService({
        todos: todoStore, store, jobs: delegatedJobs, dataDir,
        serverIdentity: getOrCreateServerIdentity(dataDir),
        getDashboardDiscovery: () => getWsServer()?.dashboardDiscovery,
        fetchPr: createPrStatusFetcher({ dataDir }),
        resolveWorkspaceRoot: async workspaceId => (await store.getWorkspaces()).find(workspace => workspace.id === workspaceId)?.rootPath,
        getDependenciesEnabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelTodoDependencies === true,
        getCategoriesEnabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelTodoCategories === true,
        getExternalReferencesEnabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelTodoExternalReferences === true,
        decisions: decisionService,
        onCategoriesChange: ({ workspaceId, revision, affectedLedgers }) => {
            getWsServer().broadcastProcessEvent({
                type: 'sentinel-todo-categories-changed', workspaceId, revision, timestamp: Date.now(),
            });
            for (const { processId, ledgerRevision } of affectedLedgers) {
                getWsServer().broadcastProcessEvent({
                    type: 'sentinel-todos-changed', workspaceId, processId, ledgerRevision, timestamp: Date.now(),
                });
            }
            if (affectedLedgers.length) opts.triggerManager?.refreshDependencyPolling();
        },
        getTask: taskId => bridge.getTask(taskId),
        onChange: ({ owner, ledgerRevision, item }) => {
            opts.triggerManager?.refreshDependencyPolling();
            getWsServer().broadcastProcessEvent({
                type: 'sentinel-todos-changed', workspaceId: owner.workspaceId, processId: owner.processId,
                ledgerRevision, itemId: item.id, timestamp: Date.now(),
            });
        },
    });
    const dependencyReceipts = new SentinelDependencyStore(todoDb, todoStore);
    const dependencyActions = new SentinelDependencyActions({
        receipts: dependencyReceipts, service: sentinelTodos,
        hasTask: taskId => !!bridge.getTask(taskId),
        coexistingTransport: (owner, itemId, evaluation, triggerId) => {
            const ledger = todoStore.get(owner);
            const item = ledger.items.find(item => item.id === itemId);
            const readyAfter = Math.max(Date.parse(item?.updatedAt ?? evaluation.evaluatedAt),
                ...evaluation.edges.map(edge => Date.parse(edge.mergedAt
                    ?? ledger.items.find(source => source.id === edge.dependency.itemId)?.updatedAt ?? evaluation.evaluatedAt)));
            const triggers = opts.triggerStore?.getAll().filter(trigger => trigger.workspaceId === owner.workspaceId
                && trigger.processId === owner.processId && trigger.binding?.itemId === itemId
                && trigger.event.monitor === 'pr-merged') ?? [];
            const rule = triggerId ? triggers.find(trigger => trigger.id === triggerId)
                : triggers.find(trigger => {
                    const event = trigger.event;
                    const ownsTransport = (!trigger.outcome && ['active', 'paused'].includes(trigger.status))
                        || trigger.delivery?.state === 'pending'
                        || (trigger.delivery?.state === 'delivered' && Date.parse(trigger.delivery.firedAt) >= readyAfter);
                    return ownsTransport && event.monitor === 'pr-merged' && evaluation.edges.some(edge => edge.pr
                            && edge.pr.provider === event.pr.provider && edge.pr.host === event.pr.host
                            && edge.pr.repoPath.toLowerCase() === event.pr.repoPath.toLowerCase() && edge.pr.number === event.pr.number);
                });
            if (!rule || (rule.outcome && !rule.delivery)) return undefined;
            const event = rule.event;
            if (event.monitor !== 'pr-merged' || !evaluation.edges.some(edge => edge.pr
                && edge.pr.provider === event.pr.provider && edge.pr.host === event.pr.host
                && edge.pr.repoPath.toLowerCase() === event.pr.repoPath.toLowerCase() && edge.pr.number === event.pr.number)) return undefined;
            return { triggerId: rule.id, state: rule.delivery?.state === 'delivered' ? 'delivered' : 'waiting' };
        },
        delivery: new ProcessMessageDeliveryService({ store, bridge: bridgeWithResolvedDefaults }),
        validateProvider: validateSendToConversationProvider,
        validateOwner: owner => {
            if (store instanceof SqliteProcessStore
                && !todoDb.prepare('SELECT id FROM workspaces WHERE id = ?').get(owner.workspaceId)) {
                throw new Error('Native dependency owner workspace is unavailable');
            }
        },
        validateTarget: createSentinelDependencyTargetValidator(store, bridge),
        validateCurrent: (provider, workspaceId, mode, owner) => {
            const config = opts.runtimeConfigService?.config ?? opts.resolvedConfig;
            if (!sentinelTodos.dependenciesEnabled()) throw new Error('Sentinel dependency admission is disabled');
            if (!opts.triggerManager) throw new Error('Existing trigger scheduler is unavailable for dependency wakes');
            if (provider && provider !== 'copilot' && config?.[provider]?.enabled !== true) throw new Error('Selected provider is disabled');
            if (provider && !sdkServiceRegistry.get(provider)) throw new Error('Selected provider is unavailable');
            if (!bridge.getManagerByRepoId(workspaceId)) throw new Error('Selected target workspace is unavailable');
            if (mode === 'ralph' && !getRalphEnabled()) throw new Error('Ralph mode is disabled');
            if (store instanceof SqliteProcessStore) {
                const parent = todoDb.prepare('SELECT metadata FROM processes WHERE id = ?').get<{ metadata: string }>(owner.processId);
                const metadata = parent?.metadata ? JSON.parse(parent.metadata) : undefined;
                const queued = !parent && isQueueProcessId(owner.processId) ? bridge.getTask(toTaskId(owner.processId)) : undefined;
                if (parent ? metadata?.mode !== 'sentinel' || metadata?.workspaceId !== owner.workspaceId
                    : queued?.payload.mode !== 'sentinel' || (queued?.payload.workspaceId ?? queued?.repoId) !== owner.workspaceId
                        || !['queued', 'running'].includes(queued?.status ?? '')) {
                    throw new Error('Sentinel owner is unavailable');
                }
                const workspace = todoDb.prepare('SELECT root_path, virtual FROM workspaces WHERE id = ?')
                    .get<{ root_path: string; virtual: number }>(workspaceId);
                if (!workspace || workspace.virtual || !todoDb.prepare('SELECT id FROM workspaces WHERE id = ?').get(owner.workspaceId)) {
                    throw new Error('Dependency admission requires registered local owner and concrete target workspaces');
                }
                return workspace.root_path;
            }
        },
        onChange: (owner, itemId) => {
            opts.triggerManager?.refreshDependencyPolling();
            getWsServer().broadcastProcessEvent({ type: 'sentinel-todos-changed', ...owner, itemId,
                ledgerRevision: todoStore.get(owner).revision, timestamp: Date.now() });
        },
    });
    sentinelTodos.dependencyActions = dependencyActions;
    const dependencyRalphFailure: NonNullable<RalphLaunchDeps['onTrackedLaunchFailure']> = (input, error) => {
        const token = input.sentinelTodoTracking;
        if (token) dependencyActions.block(token.owner, token.itemId, error, input.requestId);
    };
    opts.setSentinelDependencyAdmission?.(() => dependencyActions);
    const disposeDependencyPolling = opts.triggerManager?.setDependencyPolling({
        entries: () => sentinelTodos.dependenciesEnabled() ? dependencyReceipts.polls() : [],
        persist: entry => dependencyReceipts.persistPoll(entry),
        tick: entry => dependencyActions.poll(entry.owner),
    });
    registerSentinelTodoRoutes({ routes, service: sentinelTodos });
    registerSentinelPrOutcomeRoutes(routes, opts.sentinelPrOutcomes,
        () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelPrOutcomeWake === true);
    opts.setSentinelTodos?.(() => sentinelTodos);
    const getCodaEnabled = () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelTodoScrubber === true;
    const scrubber = new CodaStore(todoDb);
    const codaEngine = new CodaEngine({ todos: todoStore, scrubber, triggers: opts.sentinelOvertures });
    let codaScheduler: ScrubberScheduler | undefined;
    const codaChanged = (owner: import('../sentinel-todos/sentinel-todo-store').SentinelTodoOwner,
        change: { runId?: string; ledgerChanged?: boolean }) => {
        codaScheduler?.refresh(owner);
        getWsServer().broadcastProcessEvent({ type: 'sentinel-scrubber-changed', ...owner,
            runId: change.runId, timestamp: Date.now() });
        if (change.ledgerChanged) getWsServer().broadcastProcessEvent({ type: 'sentinel-todos-changed', ...owner,
            ledgerRevision: todoStore.get(owner).revision, timestamp: Date.now() });
    };
    const codaRuns = new CodaRunService({
        dataDir, todos: sentinelTodos, scrubber, engine: codaEngine,
        enqueue: input => enqueueWithResolvedDefaults(input),
        cancelTask: taskId => {
            const executor = bridge.findExecutorForTask(taskId);
            if (executor) { executor.cancelTask(taskId); return true; }
            return bridge.findManagerForTask(taskId)?.cancelTask(taskId) ?? false;
        },
        listTriggers: opts.sentinelOvertures ? owner => opts.sentinelOvertures!.list(owner) : undefined,
        canStartScheduled: owner => {
            const config = scrubber.getConfig(owner);
            return codaScheduler?.canStart(owner) === true
                && getCodaEnabled() && config.enabled && !config.paused;
        },
        onChange: codaChanged,
    });
    codaRuns.attach(bridge.registry);
    // Recovery completes before the composition root starts restored queues or accepts requests.
    codaScheduler = new ScrubberScheduler({ scrubber, runs: codaRuns, getEnabled: getCodaEnabled,
        assertOwner: async owner => {
            if (!(await store.getWorkspaces()).some(workspace => workspace.id === owner.workspaceId)) {
                throw new Error('Coda workspace not found');
            }
            await sentinelTodos.assertOwner(owner);
        } });
    const getJobsEnabled = () => {
        const config = opts.runtimeConfigService?.config ?? opts.resolvedConfig;
        return config?.sentinel?.enabled === true && config?.features?.sentinelTodoJobs === true;
    };
    const scheduledJobs = new SentinelRefrainStore(todoDb);
    const refrainService = new SentinelRefrainService({
        jobs: scheduledJobs, todos: sentinelTodos, dataDir, store, getEnabled: getJobsEnabled,
        getGateEnabled: () => ((opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.toolScripting
            ?? DEFAULT_CONFIG.features.toolScripting) === true,
        runGate: request => bridge.runRefrainGate(request),
        enqueue: input => enqueueWithResolvedDefaults(input),
        getTask: id => bridge.getTask(id),
        cancelTask: id => {
            const executor = bridge.findExecutorForTask(id);
            if (executor) { executor.cancelTask(id); return true; }
            return bridge.findManagerForTask(id)?.cancelTask(id) ?? false;
        },
    });
    refrainService.attach(bridge.registry);
    const jobScheduler = new SentinelJobScheduler({ jobs: scheduledJobs, service: refrainService, getEnabled: getJobsEnabled });
    const previousJobsRemoveWorkspace = store.removeWorkspace;
    const jobsRemoveWorkspace: ProcessStore['removeWorkspace'] = async id => {
        const removed = await previousJobsRemoveWorkspace.call(store, id);
        if (removed) {
            jobScheduler.refreshAll();
            await refrainService.invalidate();
        }
        return removed;
    };
    store.removeWorkspace = jobsRemoveWorkspace;
    opts.setSentinelRefrains?.(() => refrainService);
    const jobCommands = new SentinelRefrainCommands({ jobs: scheduledJobs, service: refrainService,
        onConfigChange: () => jobScheduler.refreshAll() });
    registerSentinelRefrainRoutes({ routes, jobs: scheduledJobs, service: refrainService, commands: jobCommands });
    const sentinelRefrainsShutdown = async () => {
        jobScheduler.dispose();
        await refrainService.shutdown();
    };
    const codaReady = Promise.all([codaRuns.interruptActive(), refrainService.recover()]).then(async ([count]) => {
        codaScheduler?.refreshAll();
        jobScheduler.refreshAll();
        if (sentinelTodos.dependenciesEnabled()) for (const entry of dependencyReceipts.polls()) {
            try { await dependencyActions.poll(entry.owner); }
            catch (error) { console.error('[sentinel-dependencies] Recovery unavailable:', error); }
        }
        return count;
    });
    const unsubscribeCodaConfig = opts.runtimeConfigService?.onChange(() => {
        codaScheduler?.refreshAll();
        jobScheduler.refreshAll();
        void refrainService.invalidate().catch(error => console.error('[sentinel-jobs] Config invalidation failed:', error));
        opts.triggerManager?.refreshDependencyPolling();
    });
    const previousCodaProcessChange = store.onProcessChange;
    const codaProcessChange: NonNullable<ProcessStore['onProcessChange']> = event => {
        previousCodaProcessChange?.(event);
        if (event.type === 'process-removed' || event.type === 'processes-cleared') {
            codaScheduler?.refreshAll();
            jobScheduler.refreshAll();
            void refrainService.invalidate().catch(error => console.error('[sentinel-jobs] Owner invalidation failed:', error));
        }
    };
    store.onProcessChange = codaProcessChange;
    opts.setSentinelCoda?.(() => getCodaEnabled() ? codaRuns : undefined);
    const codaCommands = new CodaCommands({ todos: sentinelTodos, scrubber,
        runs: codaRuns, getEnabled: getCodaEnabled, onChange: codaChanged });
    registerCodaRoutes({ routes, todos: sentinelTodos, scrubber, engine: codaEngine,
        runs: codaRuns, getEnabled: getCodaEnabled, onChange: codaChanged, commands: codaCommands });
    opts.setSentinelRefrainCommands?.(() => getJobsEnabled()
        ? { jobs: jobCommands, ...(getCodaEnabled() ? { scrubber: codaCommands } : {}) } : undefined);
    const sentinelTodoHooks = createSentinelTodoDelegationHooks(sentinelTodos);
    // Bound after the WhatsApp connector is wired below.
    let autoCompactionOrigins: ReturnType<typeof createAutoCompactionOrigins> | undefined;
    const jobNotices = new MessagingJobNotices({
        dataDir, store, queue: queueFacade, delegatedJobs,
        authorizeDesktopOrigin: (origin, parent) => sentinelMirror?.authorizeCapturedOrigin(origin, parent)
            ?? Promise.resolve('wait'),
        canSendDesktopOrigin: () => sentinelMirror?.canSendCapturedOrigin() === true,
        locateAutoCompactionOrigin: async (proc, turnIndex) => autoCompactionOrigins?.locate(proc, turnIndex),
        authorizeAutoCompactionOrigin: async (origin, owner) => autoCompactionOrigins?.authorize(origin, owner) ?? 'wait',
    });
    const delegatedJobReviews = new DelegatedJobReviews({
        jobs: delegatedJobs, store, queue: queueFacade,
        getRetainedTask: (workspaceId, taskId) => queuePersistence.getRetainedTerminalTask(workspaceId, taskId),
        queueMessagingResult: result => jobNotices.queueResult(result),
        reconcileMessagingNotices: () => jobNotices.reconcile(),
        delivery: new ProcessMessageDeliveryService({ store, bridge: bridgeWithResolvedDefaults }),
        recoverPendingMessages: (workspaceId, processId) => bridge.recoverPendingMessages(workspaceId, processId),
        findTodo: job => sentinelTodoHooks.findTodo(job),
        onDeliveryChange: job => sentinelTodoHooks.deliveryChanged(job),
    });
    const delegatedJobResults = new DelegatedJobResults({
        jobs: delegatedJobs, store, dataDir, queue: queueFacade, sessions: new RalphSessionStore({ dataDir }),
        onResult: job => {
            sentinelTodoHooks.recordResult(job);
            return delegatedJobReviews.schedule(job);
        },
    });
    // Quarantine interrupted outbound sends before recovered results can add new receipts.
    const delegatedResultsRestored = jobNotices.restore().catch(error =>
        console.error('[job-notices] Could not restore notices:', error))
        .then(() => delegatedJobResults.restore()).catch(error =>
        console.error('[delegated-job-results] Could not restore results:', error));
    const registerSentinelDelegation = createSentinelDelegationEnqueue({
        store, jobs: delegatedJobs, hasTask: taskId => !!bridge.getTask(taskId),
        getTask: taskId => bridge.getTask(taskId),
        guardTracked: async input => {
            const context = input.payload.context as Record<string, unknown> | undefined;
            if (context?.sentinelTodoTracking) return dependencyActions.guard(input, 'enqueue');
            if (!sentinelTodos.dependenciesEnabled() || context?.sentinelScrub || typeof context?.spawnedFromProcessId !== 'string') return;
            const parent = await store.getProcess(context.spawnedFromProcessId);
            const queued = !parent && isQueueProcessId(context.spawnedFromProcessId) ? bridge.getTask(toTaskId(context.spawnedFromProcessId)) : undefined;
            if (parent?.metadata?.mode === 'sentinel' || queued?.payload.mode === 'sentinel') throw new Error('Sentinel tracked launches require owner/item admission context');
        },
        onTrackedFailure: (input, error) => {
            const token = (input.payload.context as Record<string, unknown> | undefined)?.sentinelTodoTracking as
                import('@plusplusoneplusplus/coc-client').SentinelTodoTrackedAdmission | undefined;
            if (token && !bridge.getTask(input.id!)) dependencyActions.block(token.owner, token.itemId, error, input.id);
        },
    });
    const enqueueSentinelDelegation: ReturnType<typeof createSentinelDelegationEnqueue> = async (input, enqueue) => {
        // Recovery must finish before a new registration can look like an interrupted launch.
        await delegatedResultsRestored;
        return registerSentinelDelegation(input, enqueue);
    };
    const delegatedRalphBridge = Object.create(bridgeWithResolvedDefaults) as MultiRepoQueueRouter;
    Object.defineProperty(delegatedRalphBridge, 'enqueue', {
        value: (task: CreateTaskInput) => enqueueSentinelDelegation(task,
            prepared => bridgeWithResolvedDefaults.enqueue(prepared)),
    });
    opts.setEnqueueChat?.(async (input: CreateTaskInput): Promise<string> => {
        await prepareEnqueueTask(input);
        return enqueueSentinelDelegation(input, task =>
            enqueueViaBridge(task, bridge, queueGlobalState, globalWorkspaceRootPath, store));
    });
    opts.setLaunchRalph?.((input) => launchRalphSession(input, {
        guardTrackedLaunch: input => dependencyActions.preflightRalph(input),
        onTrackedLaunchFailure: dependencyRalphFailure,
        bridge: delegatedRalphBridge,
        getRalphEnabled,
        dataDir,
        store,
        getGitWorktreeExecutionEnabled,
    }));

    // Publish the bound follow-up delivery capability so executors can offer the
    // post mode of `send_to_conversation` (posting into an existing conversation).
    // Tracked Sentinel posts reserve per-request delegated jobs like create mode.
    opts.setSendMessage?.(createSendMessageCapability(store, bridge, {
        jobs: delegatedJobs, ready: delegatedResultsRestored,
        enabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelFollowUpResults === true,
    }));

    // excalidrawEnabled uses a live getter via runtimeConfigService so admin
    // changes take effect without restart. cronEnabled stays startup-captured
    // (restartRequired — cron executor infrastructure wires at startup).
    const getLiveFeatureFlags = opts.runtimeConfigService
        ? () => ({
            excalidrawEnabled: opts.runtimeConfigService!.config.excalidraw?.enabled ?? false,
            canvasEnabled: opts.runtimeConfigService!.config.canvas?.enabled ?? false,
            canvasExtensionsEnabled: opts.runtimeConfigService!.config.canvasExtensions?.enabled ?? false,
            kustoEnabled: opts.runtimeConfigService!.config.kusto?.enabled ?? false,
            browserControlEnabled: opts.runtimeConfigService!.config.browserControl?.enabled ?? false,
            llmToolSystemOneEnabled: (opts.runtimeConfigService!.config.LLMToolSystemOne?.enabled ?? DEFAULT_CONFIG.LLMToolSystemOne.enabled) === true,
            toolScriptingEnabled: (opts.runtimeConfigService!.config.features?.toolScripting ?? DEFAULT_CONFIG.features.toolScripting) === true,
            queryPullRequestToolEnabled: (opts.runtimeConfigService!.config.features?.queryPullRequestTool ?? DEFAULT_CONFIG.features.queryPullRequestTool) === true,
            chatStyleSelectorEnabled: opts.runtimeConfigService!.config.features?.chatStyleSelector === true,
            chatProviderSwitchingEnabled: opts.runtimeConfigService!.config.features?.chatProviderSwitching === true,
            chatHistoryPagingEnabled: opts.runtimeConfigService!.config.features?.chatHistoryPaging === true,
            botManagedConversationsEnabled: opts.runtimeConfigService!.config.features?.botManagedConversations === true,
            sentinelAdditionalInstructionsEnabled: (opts.runtimeConfigService!.config.features?.sentinelAdditionalInstructions ?? DEFAULT_CONFIG.features.sentinelAdditionalInstructions) === true,
            defaultChatStyle: coerceChatStyle(opts.runtimeConfigService!.config.features?.defaultChatStyle),
        })
        : () => ({
            excalidrawEnabled: opts.resolvedConfig?.excalidraw?.enabled ?? false,
            canvasEnabled: opts.resolvedConfig?.canvas?.enabled ?? false,
            canvasExtensionsEnabled: opts.resolvedConfig?.canvasExtensions?.enabled ?? false,
            kustoEnabled: opts.resolvedConfig?.kusto?.enabled ?? false,
            browserControlEnabled: opts.resolvedConfig?.browserControl?.enabled ?? false,
            llmToolSystemOneEnabled: (opts.resolvedConfig?.LLMToolSystemOne?.enabled ?? DEFAULT_CONFIG.LLMToolSystemOne.enabled) === true,
            toolScriptingEnabled: (opts.resolvedConfig?.features?.toolScripting ?? DEFAULT_CONFIG.features.toolScripting) === true,
            queryPullRequestToolEnabled: (opts.resolvedConfig?.features?.queryPullRequestTool ?? DEFAULT_CONFIG.features.queryPullRequestTool) === true,
            chatStyleSelectorEnabled: opts.resolvedConfig?.features?.chatStyleSelector === true,
            chatProviderSwitchingEnabled: opts.resolvedConfig?.features?.chatProviderSwitching === true,
            chatHistoryPagingEnabled: opts.resolvedConfig?.features?.chatHistoryPaging === true,
            botManagedConversationsEnabled: opts.resolvedConfig?.features?.botManagedConversations === true,
            sentinelAdditionalInstructionsEnabled: (opts.resolvedConfig?.features?.sentinelAdditionalInstructions ?? DEFAULT_CONFIG.features.sentinelAdditionalInstructions) === true,
            defaultChatStyle: coerceChatStyle(opts.resolvedConfig?.features?.defaultChatStyle),
        });
    const isKustoEnabled = (): boolean => getLiveFeatureFlags().kustoEnabled;
    const isBrowserControlEnabled = () => getLiveFeatureFlags().browserControlEnabled;
    opts.setBrowserControl?.(() => {
        const browserControl = getWsServer()?.browserControl;
        browserControl?.setEnabledGetter(isBrowserControlEnabled);
        browserControl?.setFramesEnabledGetter(() => ((
            opts.runtimeConfigService?.config ?? opts.resolvedConfig
        )?.browserControl?.framesEnabled ?? DEFAULT_CONFIG.browserControl.framesEnabled) === true);
        browserControl?.setHumanTakeoverEnabledGetter(() => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.browserControl?.humanTakeoverEnabled === true);
        browserControl?.setRichPasteEnabledGetter(() => ((
            opts.runtimeConfigService?.config ?? opts.resolvedConfig
        )?.browserControl?.richPasteEnabled ?? DEFAULT_CONFIG.browserControl.richPasteEnabled) === true);
        browserControl?.setBackgroundEnabledGetter(() => ((
            opts.runtimeConfigService?.config ?? opts.resolvedConfig
        )?.browserControl?.backgroundEnabled ?? DEFAULT_CONFIG.browserControl.backgroundEnabled) === true);
        browserControl?.setCursorOverlayEnabledGetter(() => (
            opts.runtimeConfigService?.config ?? opts.resolvedConfig
        )?.browserControl?.cursorOverlayEnabled !== false);
        browserControl?.setNavigationApprovalEnabledGetter(() => (
            opts.runtimeConfigService?.config ?? opts.resolvedConfig
        )?.browserControl?.navigationApprovalEnabled !== false);
        return browserControl;
    }, new BrowserToolStateStore(dataDir));
    // Async extension-canvas capabilities + host.complete. Live (admin toggle
    // takes effect without a restart) and off by default.
    const isCanvasHostApisEnabled = (): boolean => (
        opts.runtimeConfigService?.config ?? opts.resolvedConfig
    )?.features?.canvasHostApis === true;
    const activeWorkspaceTracker = new ActiveWorkspaceTracker();
    registerApiRoutes(routes, store, bridge, dataDir, getWsServer, undefined, opts.resolvedConfig?.cron?.enabled ?? false, getLiveFeatureFlags, activeWorkspaceTracker, getSentinelMirror, opts.toolInventoryStore);
    const repoTreeService = new RepoTreeService(dataDir, undefined, store);
    repoTreeService.trackWorkspaces(store);
    registerRepoRoutes(routes, dataDir, repoTreeService, undefined, () =>
        (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.explorerDelete !== false);
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
    const remoteServerRuntime = registerRemoteServerRoutes(routes, {
        store: opts.remoteServerStore ?? new RemoteServerStore(dataDir),
        connector: opts.remoteServerConnector ?? new DevTunnelConnector(),
        sshConnector: opts.remoteServerSshConnector,
        getLocalBaseUrl: opts.getLocalBaseUrl,
        onTopologyChanged: (serverId, action) => {
            getWsServer().broadcastProcessEvent({
                type: 'server-topology-changed',
                serverId,
                action,
                timestamp: Date.now(),
            });
        },
    });
    // Local + remote repo directory behind `list_workspaces`, `send_to_conversation`
    // name / remote clone-key targets, and messaging `list remotes`.
    const remoteReturn = new RemoteDelegationReturn({
        requests: remoteDelegationRequests, jobs: delegatedJobs, store, remotes: remoteServerRuntime,
        onRegistered: job => sentinelTodos.linkRemoteFollowUp(job),
        enabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelRemoteResults === true,
        onResult: async job => {
            sentinelTodoHooks.recordResult(job);
            await delegatedJobReviews.schedule(job);
        },
        onDeliveryChange: job => sentinelTodoHooks.deliveryChanged(job),
    });
    const remoteReturnReady = delegatedResultsRestored.then(() => remoteReturn.recover());
    remoteReturn.start();
    const workspaceDirectory = createWorkspaceDirectory({ store, dataDir, serverIdentity: getOrCreateServerIdentity(dataDir), remoteServers: remoteServerRuntime, remoteResults: remoteReturn });
    const remoteAdmissions = new RemoteDelegationAdmissionStore(dataDir);
    const remoteDelivery = new ProcessMessageDeliveryService({ store, bridge });
    const remoteLaunch = createRemoteDelegationLaunch({
        queue: { bridge, store, dataDir, state: queueGlobalState, globalWorkspaceRootPath,
            getDefaultProvider: concreteDefaultProvider, resolveDefaultProvider, isAutoProviderRoutingActive,
            getEffortTiersForProvider, validateProvider: validateSendToConversationProvider,
            browserControlEnabled: () => getLiveFeatureFlags().browserControlEnabled },
        getRalphEnabled,
        getRetainedTask: (workspaceId, taskId) => queuePersistence.getRetainedTerminalTask(workspaceId, taskId),
    });
    const remoteResults = new RemoteDelegationResults({
        admissions: remoteAdmissions, store, dataDir, queue: queueFacade,
        sessions: new RalphSessionStore({ dataDir }),
        getRetainedTask: (workspaceId, taskId) => queuePersistence.getRetainedTerminalTask(workspaceId, taskId),
        findChild: async row => {
            if (row.kind !== 'follow-up') return remoteLaunch.findChild(row);
            const retained = queuePersistence.getRetainedTerminalTask(row.destination.workspaceId, row.executionId)
                ?? queuePersistence.getRetainedTerminalTask(row.destination.workspaceId, `pending-${row.targetProcessId}-${row.executionId}`);
            if (retained?.type === 'chat' && retained.payload.workspaceId === row.destination.workspaceId
                && retained.processId === row.targetProcessId && retained.payload.processId === row.targetProcessId
                && retained.payload.relayRequestId === row.executionId) return { processId: row.targetProcessId! };
            return await remoteDelivery.findRemoteFollowUpReceipt(row.destination.workspaceId, row.targetProcessId!, row.executionId)
                ? { processId: row.targetProcessId! } : undefined;
        },
    });
    const remoteResultsReady = remoteResults.restore();
    registerRemoteDelegationRoutes(routes, {
        admissions: remoteAdmissions, store,
        delivery: remoteDelivery, launch: remoteLaunch,
        results: { ready: remoteResultsReady, capture: () => remoteResults.restore() },
    });
    // Connectors register their completion/result transports below.
    opts.setSendToConversationRuntime?.({
        serverIdentity: getOrCreateServerIdentity(dataDir),
        cancelConversation: (processId, workspaceId) => cancelConversation(store, bridge, processId, workspaceId),
        isAutoProviderRoutingAvailable: () => isAutoProviderRoutingActive() && !!agentProvidersQuotaCache,
        validateProvider: validateSendToConversationProvider,
        getEffortTiersForProvider,
        workspaceDirectory,
        getRemoteResultsEnabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelRemoteResults === true,
        getDashboardDiscovery: () => getWsServer()?.dashboardDiscovery,
        trackMessagingJob: job => jobNotices.track(job),
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
        enqueueDelegation: enqueueSentinelDelegation,
        getDefaultProvider: concreteDefaultProvider,
        resolveDefaultProvider,
        isAutoProviderRoutingActive,
        getEffortTiersForProvider,
        dataDir,
        validateProvider: validateSendToConversationProvider,
        state: queueGlobalState,
        browserControlEnabled: () => getLiveFeatureFlags().browserControlEnabled,
        botManagedConversationsEnabled: () => getLiveFeatureFlags().botManagedConversationsEnabled === true,
        getSentinelMirror,
    });
    registerTaskRoutes(routes, store, dataDir, (workspaceId) => {
        getWsServer().broadcastProcessEvent({
            type: 'tasks-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    });
    registerTaskWriteRoutes(routes, store, dataDir);
    registerNotesRoutes(routes, store, dataDir, opts.notesSearchService);
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
                autoPullManager.configureWorkspace(workspaceId),
            ]);
        },
    );
    registerLanguageServerRoutes(routes, dataDir);
    registerSeenStateRoutes(routes, store as any);
    registerWhatsNewRoutes(routes, new WhatsNewService({ dataDir }));
    registerPromptSuggestionRoutes(routes, store as any, dataDir, resolvedAiService);
    registerPromptHistoryRoutes(routes, store as any);
    registerGroupPinRoutes(routes, store, dataDir);
    const taskGroupService = TaskGroupService.fromProcessStore(store);
    registerTaskGroupRoutes({ routes, store, taskGroupService });
    registerRalphSessionChangeListener(dataDir, record => {
        try {
            syncRalphSessionToTaskGroup(taskGroupService, record);
        } finally {
            getWsServer().broadcastProcessEvent({
                type: 'ralph-session-changed',
                workspaceId: record.workspaceId,
                sessionId: record.sessionId,
            });
        }
    });
    registerPinArchiveRoutes(routes, store as any, () => getLiveFeatureFlags().botManagedConversationsEnabled === true);
    registerPinOrderRoutes(routes, store, dataDir);
    const chatFolderStore = taskGroupService.getChatFolderStore();
    const groupFolderStore = new GroupFolderStore(dataDir);
    registerChatFolderRoutes(routes, store, chatFolderStore, groupFolderStore);
    registerGroupFolderRoutes(routes, store, chatFolderStore, groupFolderStore);
    registerTurnActionRoutes(routes, store as any, getWsServer,
        () => getLiveFeatureFlags().chatHistoryPagingEnabled === true);
    registerProcessHistoryRoutes(routes, store as any, () => getLiveFeatureFlags().botManagedConversationsEnabled === true);
    registerWorkspaceHistoryRoutes(routes, store, bridge);
    registerTaskCommentsRoutes(routes, dataDir, bridge, store, getWsServer);
    registerDiffCommentsRoutes(routes, dataDir, bridge, store, getWsServer);
    registerCanvasRoutes(routes, dataDir, getWsServer, store, isKustoEnabled, opts.kustoClientFactory, isCanvasHostApisEnabled,
        undefined, createCanvasRunScriptFactory({
            getFeatures: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features,
            getOwnerScriptRunner: () => bridge.runOwnerScript,
        }));
    registerCanvasExtensionRoutes(routes, { dataDir, processStore: store, runtime: opts.canvasExtensionRuntime });
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
    // automation route workspace-boundary checks (legacy cron compatibility and
    // trigger create verification).
    const resolveProcessWorkspaceId = createProcessWorkspaceResolver(bridge, store);

    if (opts.cronStore && opts.cronExecutor) {
        registerCronRoutes(routes, {
            store: opts.cronStore,
            executor: opts.cronExecutor,
            emit: opts.cronEmit,
            resolveWorkspaceId: resolveProcessWorkspaceId,
        });
    }

    // Trigger routes (generic event → action framework).
    if (opts.triggerStore && opts.triggerManager) {
        registerTriggerRoutes(routes, {
            store: opts.triggerStore,
            manager: opts.triggerManager,
            emit: opts.triggerEmit,
            resolveWorkspaceId: resolveProcessWorkspaceId,
            validatePrOwner: createPrRepairOwnerValidator(store, resolveProcessWorkspaceId),
        });
    }
    if (opts.sentinelOvertures) {
        registerSentinelOvertureRoutes(routes, opts.sentinelOvertures);
    }

    // MCP OAuth routes (feature-flagged via mcpOauth.enabled)
    if (opts.mcpOauthManager) {
        registerMcpOauthRoutes(routes, {
            dataDir,
            startTeamsOAuth: (serverUrl, context) => teamsMessagingManager.startOAuth(serverUrl, context),
            cancelTeamsOAuth: requestId => teamsMessagingManager.cancelOAuth(requestId),
            isTeamsOAuthPending: requestId => teamsMessagingManager.isOAuthPending(requestId),
            manager: opts.mcpOauthManager,
            store,
            executeFollowUp: (processId, message) => bridge.executeFollowUp(processId, message),
            aiService: opts.resolvedConfig?.mcpOauth?.enabled === false ? undefined : resolvedAiService,
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
    registerStatsRoutes(routes, store, opts.getTurnPerformanceStore);
    registerDbBrowserRoutes(routes, store, dataDir);
    registerHeapRoutes(routes);
    registerMyWorkRoutes(routes, store, dataDir);
    registerMyLifeRoutes(routes, store, dataDir);
    registerRepoGroupRoutes(routes, store, dataDir, {
        getWsServer,
        repoTreeService,
        readQueue: (workspaceId) => readRepoQueueSnapshot({
            bridge,
            store,
            botManagedConversationsEnabled: () => getLiveFeatureFlags().botManagedConversationsEnabled === true,
        }, workspaceId),
        getBotControlEnabled: () => getLiveFeatureFlags().botManagedConversationsEnabled === true,
        getExclusiveWriterEnabled: () =>
            (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.repoGroupExclusiveWriter === true,
        onGroupRegistered: async (ws) => {
            // Match the startup workspace sweep so a freshly created group can
            // enqueue chats and host schedules without a server restart.
            bridge.registerRepoId(ws.id, ws.rootPath);
            await scheduleManager.registerWorkspacePath(ws.id, ws.rootPath);
        },
    });

    const resolveMessagingChatMode = createMessagingChatModeResolver(store, queueFacade);
    const messagingChatInput = (workspaceId: string, message: string, taskId?: string, mediumEffort = false, mode: ChatMode = 'ask'): CreateTaskInput => {
        const config: CreateTaskInput['config'] & { effortTier?: 'medium' } =
            mediumEffort ? { effortTier: 'medium' } : {};
        return {
            ...(taskId ? { id: taskId } : {}),
            ...(taskId ? { processId: toQueueProcessId(taskId) } : {}),
            type: 'chat',
            repoId: workspaceId,
            payload: { kind: 'chat', mode, prompt: message, workspaceId },
            config,
            priority: 'normal',
        };
    };
    const enqueueMessagingChat = (workspaceId: string, message: string, taskId?: string) =>
        bridge.enqueue(messagingChatInput(workspaceId, message, taskId));
    // Teams threads start new chats as the sentinel dispatcher unless a mode prefix says otherwise.
    const enqueueTeamsChat = async (workspaceId: string, message: string, taskId?: string, mode?: MessagingChatMode, botControl?: CreateTaskInput['botControl'], images?: PreparedIncomingImages) => {
        const input = messagingChatInput(workspaceId, message, taskId, true, await resolveMessagingChatMode(undefined, mode));
        return enqueueWithResolvedDefaults({
            ...input, botControl,
            payload: { ...input.payload, ...incomingImageTaskPayload(images) },
        });
    };
    // Mode-prefixed phone messages to a sentinel start a separate tracked job.
    const messagingHandOff = createMessagingHandOff({
        store, queue: queueFacade, jobNotices,
        // Ordinary command handoffs share durable Sentinel admission. Ralph
        // grilling needs session-aware registration, separate from this path.
        enqueue: input => input.payload.mode === 'ralph'
            ? enqueueWithResolvedDefaults(input)
            : enqueueSentinelDelegation(input, enqueueWithResolvedDefaults),
    });
    const getMessagingQuota = async () => agentProvidersQuotaCache?.get({ refreshIfStale: true });

    // Container default agent session routes (feature-flagged)
    if (opts.resolvedConfig?.containerDefaultAgent?.enabled) {
        fs.mkdirSync(path.join(dataDir, 'container-sessions'), { recursive: true });
        const containerDb = new NativeDatabase(path.join(dataDir, 'container-sessions', 'sessions.db'));
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
            forwardMessage: (_agentId, workspaceId, message, _existingProcessId) =>
                enqueueMessagingChat(workspaceId, message),
        });
    }

    const isOwnDesktopMessagingPost = async (message: SentinelMirrorEcho) =>
        await sentinelMirror?.isOwnMirrorMessage(message) || await jobNotices.isOwnDesktopResultMessage(message);
    const questionRelay = new AskUserQuestionRelayHub({
        store, capturedOrigin: request => sentinelMirror?.locateCapturedOrigin(request),
    });
    opts.setAskUserQuestionRelay?.(questionRelay);
    const teamsMessagingManager = registerTeamsMessagingRoutes(routes, {
        isOwnMirrorMessage: (message, teamId, accountKey, isSelf) => isOwnDesktopMessagingPost({
            connector: 'teams', chatKey: `${teamId}\0${message.channelId}`,
            threadId: message.replyToMessageId, text: message.text, accountKey, isSelf,
        }),
        dataDir,
        questionRelay,
        jobNotices,
        handOff: messagingHandOff,
        getObservabilityEnabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.teamsBridgeObservability === true,
        getAnswerRelayEnabled: () => ((opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.teamsAiAnswerRelay
            ?? DEFAULT_CONFIG.features.teamsAiAnswerRelay) === true,
        getBotManagedConversationsEnabled: () =>
            (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.botManagedConversations === true,
        getMessageReactionEnabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.teamsMessageReaction === true,
        onAnswerRelayConfigChanged: callback => opts.runtimeConfigService?.onChange(callback) ?? (() => {}),
        relayQueue: queueFacade,
        enqueueRelayChat: enqueueTeamsChat,
        admitRelayFollowUp: async (proc, message, requestId, mode, taskId, images, admissionHeld = false) => {
            const workspaceId = proc.metadata?.workspaceId;
            if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('Teams conversation workspace is unavailable');
            return {
                taskId: await (admissionHeld ? bridge.enqueueAdmitted : bridge.enqueue).call(bridge, {
                    id: taskId, type: 'chat', repoId: workspaceId, processId: proc.id, priority: 'normal',
                    payload: {
                        kind: 'chat', mode: await resolveMessagingChatMode(proc.id, mode), processId: proc.id, prompt: message,
                        workspaceId, relayRequestId: requestId, ...incomingImageTaskPayload(images),
                    },
                    config: {},
                }),
            };
        },
        enqueuePendingRelayFollowUp: async (workspaceId, processId, message, requestId, mode, taskId, images) => bridge.enqueue({
            id: taskId, type: 'chat', repoId: workspaceId, processId, priority: 'normal',
            payload: {
                kind: 'chat', mode: await resolveMessagingChatMode(processId, mode), processId, prompt: message,
                workspaceId, relayRequestId: requestId, ...incomingImageTaskPayload(images),
            },
            config: {},
        }),
        store,
        oauthAvailable: !!opts.mcpOauthManager && typeof (resolvedAiService as { createClient?: unknown }).createClient === 'function',
        oauthManager: opts.mcpOauthManager,
        enqueueChat: (workspaceId, message, mode, taskId, botControl, images) =>
            enqueueTeamsChat(workspaceId, message, taskId, mode, botControl, images),
        executeFollowUp: async (processId, message, mode) =>
            bridge.executeFollowUp(processId, message, undefined, await resolveMessagingChatMode(processId, mode)),
        getQuota: getMessagingQuota,
        getTodos: () => sentinelTodos,
        compact: (proc, instructions, origin) => compactProcess(store, proc, instructions, bridge,
            origin ? taskId => jobNotices.track({ processId: proc.id, workspaceId: proc.metadata!.workspaceId!, origin, taskId }) : undefined),
        remotes: workspaceDirectory,
    });
    const teamsIc3OwnCommands = opts.runtimeConfigService && createTeamsIc3OwnCommandsRuntime({
        config: opts.runtimeConfigService, teams: teamsMessagingManager, store, queue: queueFacade, routes, decisionService,
        launch: createTeamsIc3OwnCommandLaunch({
            bridge, store, dataDir, state: queueGlobalState, globalWorkspaceRootPath,
            getDefaultProvider: concreteDefaultProvider, resolveDefaultProvider, isAutoProviderRoutingActive,
            getEffortTiersForProvider, validateProvider: validateSendToConversationProvider,
        }),
    });
    const teamsReactions = opts.runtimeConfigService && (() => {
        const config = opts.runtimeConfigService!;
        const execution = createTeamsReactionExecution({
            queue: queueFacade,
            launch: createTeamsReactionLaunch({
                bridge, store, dataDir, state: queueGlobalState, globalWorkspaceRootPath,
                getDefaultProvider: concreteDefaultProvider, resolveDefaultProvider, isAutoProviderRoutingActive,
                getEffortTiersForProvider, validateProvider: validateSendToConversationProvider,
            }, dataDir, () => config.config),
        });
        const runtime = createTeamsReactionRuntime({
            config, teams: teamsMessagingManager, store, dataDir, execution, decisionService, routes,
            onResult: async (job, source, signal) => {
                signal.throwIfAborted();
                const result = await resolveTeamsReactionOutcome(store, job, signal);
                await sendTeamsReactionResult(source, {
                    sourceText: job.sourceText,
                    result,
                }, signal);
            },
        });
        let disposal: Promise<void> | undefined;
        return {
            dispose() {
                return disposal ??= runtime.dispose().finally(() => execution.dispose());
            },
        };
    })();
    const whatsappMessagingManager = registerWhatsAppMessagingRoutes(routes, { dataDir });
    const whatsappBindings = new WhatsAppBindings(dataDir, { store, queue: queueFacade });
    let whatsappBindingRestore: Promise<void> | undefined;
    const ensureWhatsAppBindingsReady = () => whatsappBindingRestore ??= whatsappBindings.restore(store).catch(error => {
        whatsappBindingRestore = undefined;
        throw error;
    });
    const restoreWhatsAppBindings = async () => {
        try {
            await whatsappBindings.restore(store);
        } catch (error) {
            if (!(error instanceof WhatsAppBindingReleaseError)) throw error;
            console.error('[whatsapp-messaging] Binding release reconciliation failed');
        }
    };
    void ensureWhatsAppBindingsReady().catch(() =>
        console.error('[whatsapp-messaging] Failed to restore binding lifecycle'));
    const mirrorStore = hasSentinelMirrorProjections(store) ? store : undefined;
    if (!mirrorStore) console.warn('[sentinel-mirror] Process store lacks relay projections; desktop mirroring is unavailable');
    sentinelMirror = mirrorStore && new SentinelMirrorService({
        dataDir, store: mirrorStore, queue: queueFacade,
        db: store instanceof SqliteProcessStore ? store.getDatabase() : undefined,
        onSourceSettled: () => jobNotices.reconcile(undefined, true),
        enabled: () => (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.sentinelDesktopMirror === true,
        adapters: [createTeamsMirrorAdapter(teamsMessagingManager),
            createWhatsAppMirrorAdapter(whatsappMessagingManager, whatsappBindings, ensureWhatsAppBindingsReady)],
    });
    const unsubscribeMirrorConfig = opts.runtimeConfigService?.onChange(() => sentinelMirror?.wake());
    const cancelMirrorConnector = async (connector: 'teams' | 'whatsapp'): Promise<void> => {
        try { await sentinelMirror?.cancelConnector(connector); }
        catch {
            console.error('[sentinel-mirror] Could not persist disconnect');
            throw new Error('Sentinel mirror cancellation could not be recorded; retry disconnect before reconnecting.');
        }
    };
    teamsMessagingManager.setMirrorDisconnectHandler(() => cancelMirrorConnector('teams'));
    teamsMessagingManager.setMirrorConnectedHandler(() => sentinelMirror?.connectorReady('teams'));
    whatsappMessagingManager.setMirrorDisconnectHandler(() => cancelMirrorConnector('whatsapp'));
    sentinelMirror?.start();
    const whatsappRelay = new WhatsAppAnswerRelay({
        bindings: whatsappBindings,
        store,
        queue: queueFacade,
        connected: () => {
            const status = whatsappMessagingManager.getStatus();
            return status.enabled && status.status === 'connected' && !!status.groupJid;
        },
        groupJid: () => whatsappMessagingManager.getStatus().groupJid,
        send: (text, quotedId) => whatsappMessagingManager.send(text, quotedId),
        onSettled: () => { void jobNotices.reconcile('whatsapp').catch(error =>
            console.error('[job-notices] Could not reconcile notices:', error)); },
    });
    autoCompactionOrigins = createAutoCompactionOrigins({
        bindings: whatsappBindings,
        ready: ensureWhatsAppBindingsReady,
        whatsappGroup: () => {
            const status = whatsappMessagingManager.getStatus();
            return status.enabled ? status.groupJid : undefined;
        },
        isDeliveringAnswer: inboundId => whatsappRelay.isDelivering(inboundId),
        mirror: {
            locate: request => sentinelMirror?.locateCapturedOrigin(request),
            authorize: (origin, owner) => sentinelMirror?.authorizeCapturedOrigin(origin, owner) ?? Promise.resolve('wait'),
        },
    });
    questionRelay.register(createWhatsAppQuestionTransport({
        bindings: whatsappBindings,
        connected: () => {
            const status = whatsappMessagingManager.getStatus();
            return status.enabled && status.status === 'connected' && !!status.groupJid;
        },
        groupJid: () => whatsappMessagingManager.getStatus().groupJid,
        send: (text, quotedId) => whatsappMessagingManager.send(text, quotedId),
    }));
    jobNotices.register(createWhatsAppNoticeTransport({
        bindings: whatsappBindings,
        connected: () => {
            const status = whatsappMessagingManager.getStatus();
            return status.enabled && status.status === 'connected' && !!status.groupJid;
        },
        groupJid: () => whatsappMessagingManager.getStatus().groupJid,
        send: (text, quotedId) => whatsappMessagingManager.send(text, quotedId),
    }));
    // Registered transports can now drain restored notices and recovered result receipts.
    void delegatedResultsRestored.then(() => jobNotices.reconcile()).catch(error =>
        console.error('[job-notices] Could not reconcile notices:', error));
    const whatsappRouter = new WhatsAppCommandRouter({
        getOvertures: () => opts.triggerStore,
        getOvertureTodos: () => todoStore,
        isOwnMirrorMessage: message => message.fromMe && isOwnDesktopMessagingPost({
            connector: 'whatsapp', chatKey: message.chatJid, threadId: message.quotedMessageId,
            text: message.text, accountKey: whatsappMessagingManager.getMirrorAccountKey(), isSelf: message.fromMe,
        }),
        store,
        dataDir,
        bindings: whatsappBindings,
        getBotManagedConversationsEnabled: () =>
            (opts.runtimeConfigService?.config ?? opts.resolvedConfig)?.features?.botManagedConversations === true,
        groupJid: () => whatsappMessagingManager.getStatus().groupJid ?? undefined,
        send: (text, quotedId) => whatsappMessagingManager.send(text, quotedId),
        react: messageId => whatsappMessagingManager.react(messageId),
        getQuota: getMessagingQuota,
        compact: (proc, instructions, origin) => compactProcess(store, proc, instructions, bridge,
            origin ? taskId => jobNotices.track({ processId: proc.id, workspaceId: proc.metadata!.workspaceId!, origin, taskId }) : undefined),
        remotes: workspaceDirectory,
        questions: questionRelay,
        handOff: messagingHandOff,
        getTodos: () => sentinelTodos,
        getTask: taskId => queueFacade.getTask(taskId),
        topicQueue: queueFacade,
        enqueue: async (workspaceId, message, mode, processId, taskId, botControl, images, admissionHeld = false) => {
            const followUp = processId !== toQueueProcessId(taskId);
            return enqueueWithResolvedDefaults({
                ...messagingChatInput(workspaceId, message, taskId, true),
                botControl,
                processId,
                payload: {
                    kind: 'chat',
                    mode: await resolveMessagingChatMode(followUp ? processId : undefined, mode),
                    prompt: message, workspaceId,
                    ...(followUp ? { processId } : {}),
                    relayRequestId: taskId,
                    ...incomingImageTaskPayload(images),
                },
            }, admissionHeld);
        },
        queued: binding => { void whatsappRelay.reconcileTask(binding.taskId).catch(() =>
            console.error('[whatsapp-answer-relay] Could not reconcile queued request')); },
    });
    whatsappMessagingManager.setConnectionResetHandler(() => whatsappRouter.resetPendingImages());
    whatsappMessagingManager.setMessageHandler(async (message, signal) => {
        await restoreWhatsAppBindings();
        if (signal) await whatsappRouter.handle(message, signal);
        else await whatsappRouter.handle(message);
    });
    whatsappMessagingManager.setConnectedHandler(async () => {
        await restoreWhatsAppBindings();
        await whatsappRelay.reconnected();
        await jobNotices.reconcile('whatsapp');
        sentinelMirror?.connectorReady('whatsapp');
    });
    // Server shutdown: drop both queue subscriptions.
    whatsappMessagingManager.setDisposeHandler(() => {
        whatsappRouter.dispose();
        whatsappRelay.dispose();
        sentinelMirror?.dispose();
        unsubscribeMirrorConfig?.();
        jobNotices.dispose();
        delegatedJobResults.dispose();
        remoteResults.dispose();
        remoteReturn.dispose();
        delegatedJobReviews.dispose();
        unsubscribeCodaConfig?.();
        codaScheduler?.dispose();
        jobScheduler.dispose();
        disposeDependencyPolling?.();
        if (store.onProcessChange === codaProcessChange) store.onProcessChange = previousCodaProcessChange;
        if (store.removeWorkspace === jobsRemoveWorkspace) store.removeWorkspace = previousJobsRemoveWorkspace;
        codaRuns.dispose();
        if (!(store instanceof SqliteProcessStore)) todoDb.close();
    });

    // Opt-in Git worktree execution feature flag getter (live when a runtime
    // config service is available, else from the resolved config snapshot).
    // Shared by Work Item execution and the Ralph launch/start routes.
    const getGitWorktreeExecutionEnabled = opts.runtimeConfigService
        ? () => opts.runtimeConfigService!.config.features?.gitWorktreeExecution ?? false
        : () => opts.resolvedConfig?.features?.gitWorktreeExecution ?? false;

    registerRalphGrillingApprovalRoutes(routes, { dataDir, store, getRalphEnabled, bridge,
        onExecutionAdmitted: async (workspaceId, processId) => {
            await delegatedJobResults.reconcileExecutionOwner(workspaceId, processId);
            await remoteResults.restore();
        },
    });
    registerRalphRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir, getGitWorktreeExecutionEnabled, getRalphEnabled });
    registerRalphSessionRoutes(routes, { dataDir, store, bridge: bridgeWithResolvedDefaults });
    registerRalphContinueRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });
    registerRalphMaxIterationsRoutes(routes, { dataDir });
    registerRalphNewLoopRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });
    registerRalphPromoteRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });
    registerRalphLaunchRoutes(routes, { bridge: delegatedRalphBridge, dataDir, store, getGitWorktreeExecutionEnabled, getRalphEnabled,
        guardTrackedLaunch: input => dependencyActions.preflightRalph(input), onTrackedLaunchFailure: dependencyRalphFailure });
    registerRalphResumeRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });
    registerRalphInputRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir, getWsServer });
    registerRalphSubmitRoutes(routes, { bridge: bridgeWithResolvedDefaults, store, dataDir });

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
    // Built from the shared provider descriptor contract, so the dashboard tab
    // list and this registry can never disagree about which providers exist.
    const nativeCliSessionProviders = createNativeCliSessionProviders({
        copilotService: nativeCopilotSessionService,
    });
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
    // Stateless ask→answer half of the Quick Ask loop for note/paper selections
    // (Goal 1): same one-shot grounded lookup, no persistence, no process/turn.
    registerQuickAskAnswerRoutes({
        routes,
        dataDir,
        store,
        getEnabled: getQuickAskSidenotesEnabled,
    });
    // Persistent dual-anchor paper annotations sidecar (Goal 2): every Quick Ask
    // Q&A over a paper can be pinned to its passage and survives note reload /
    // app restart. Same flag gate as the rest of the Quick Ask loop.
    registerPaperAnnotationsRoutes({
        routes,
        store,
        dataDir,
        getEnabled: getQuickAskSidenotesEnabled,
    });
    // arXiv URL ingest: fetch + cache the PDF locally and extract its text once
    // as a sidecar for whole-paper grounding. The route stays available to API
    // callers; the dedicated live flag gates only Notes paste interception.
    registerPaperIngestRoutes({
        routes,
        store,
        dataDir,
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

    // Decision API — explicitly Copilot-backed, never the workspace's default chat provider.
    registerDecisionRoutes({
        routes,
        store,
        service: decisionService,
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
                        const commits = await collectWorkItemCommits(workspace.rootPath, justClosed.headBefore);
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

    return { teamsMessagingManager, whatsappMessagingManager, workItemGitHubPullPoller, workItemAzureBoardsPullPoller, autoPullManager, agentProvidersQuotaCache, quotaPauseWatcher, activeWorkspaceBackgroundRefresher, dreamIdleScheduler, repoTreeService,
        codaReady: Promise.all([codaReady, remoteResultsReady, remoteReturnReady]).then(([count]) => count), sentinelRefrainsShutdown,
        teamsIc3OwnCommands, teamsReactions };
}
