/**
 * Aggregated route registration for the CoC execution server.
 *
 * `registerAllRoutes` consolidates all registerXxxRoutes calls so that
 * `createExecutionServer` only deals with infrastructure setup.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Route } from '../types';
import type { ProcessStore, TaskQueueManager, ISDKService, AIInvoker } from '@plusplusoneplusplus/forge';
import { modelMetadataStore, sdkServiceRegistry, CopilotSDKService, CodexSDKService, ClaudeSDKService, SDK_PROVIDER_CLAUDE, SDK_PROVIDER_CODEX } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { SqliteQueuePersistence } from '../queue/sqlite-queue-persistence';
import type { ScheduleManager } from '../schedule/schedule-manager';
import type { WikiServerOptions } from '../types';
import type { WikiManager } from '../wiki';
import { registerApiRoutes } from '../core/api-handler';
import { registerQueueRoutes } from '../queue/queue-handler';
import { registerTaskRoutes, registerTaskWriteRoutes } from '../tasks/tasks-handler';
import { registerTaskGenerationRoutes } from '../tasks/task-generation-handler';
import { registerPromptRoutes } from '../prompts/prompt-handler';
import { registerPreferencesRoutes } from '../preferences-handler';
import { registerAdminRoutes } from '../admin/admin-handler';
import { registerTaskCommentsRoutes } from '../tasks/comments/task-comments-handler';
import { registerDiffCommentsRoutes } from '../tasks/comments/diff-comments-handler';
import { registerWikiRoutes } from '../wiki';
import { registerMemoryRoutes } from '../memory/memory-routes';
import { registerMemoryV2Routes } from '../memory/memory-v2-routes';
import { registerRepoRoutes } from '../repos/repo-routes';
import { registerInstructionRoutes } from '../skills/instruction-handler';
import { registerProviderRoutes } from '../providers/provider-routes';
import { registerPrRoutes } from '../repos/pr-routes';
import { registerPrClassificationRoutes } from '../repos/pr-classification-handler';
import { registerGenericClassificationRoutes } from '../repos/generic-classification-handler';
import { registerLogsRoutes } from '../logging/logs-routes';
import { registerModelRoutes } from '../models/model-routes';
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
import { registerPinArchiveRoutes } from '../processes/pin-archive-handler';
import { registerTurnActionRoutes } from '../processes/turn-actions-handler';
import { registerProcessHistoryRoutes } from '../processes/process-history-handler';
import type { NotesGitTimerManager } from '../notes/git/notes-git-timer-manager';
import { registerWorkspaceHistoryRoutes } from './api-workspace-history-routes';
import { registerTerminalRoutes } from '../terminal/terminal-routes';
import { registerMyWorkRoutes } from '../workspaces/my-work-handler';
import { registerMyLifeRoutes } from '../workspaces/my-life-handler';
import { registerWorkItemRoutes } from './work-item-routes';
import { registerWorkItemPlanRoutes } from './work-item-plan-routes';
import { registerWorkItemExecutionRoutes } from './work-item-execution-routes';
import { registerWorkItemChangesRoutes } from './work-item-changes-routes';
import { FileWorkItemStore } from '../work-items/work-item-store';
import { handleWorkItemTaskComplete, autoVersionPlanFromResolvedComments } from '../work-items/work-item-executor';
import type { EnqueueFunction } from '../work-items/work-item-executor';
import { upsertWorkItemTaskFile, toTaskFileStatus } from '../work-items/work-item-task-file';
import { execGit } from '@plusplusoneplusplus/forge';
import type { WorkItemChangeCommit } from '../work-items/types';
import { getResolvedConfigWithSource, loadConfigFile, writeConfigFile, getConfigFilePath } from '../../config';
import type { ResolvedCLIConfig } from '../../config';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import type { TerminalSessionManager } from '../terminal/index';
import { registerRemoteServerRoutes } from '../servers/remote-server-routes';
import { RemoteServerStore } from '../servers/remote-server-store';
import { DevTunnelConnector } from '../servers/devtunnel-connector';
import { registerRalphRoutes } from './queue-ralph-routes';
import { registerRalphSessionRoutes } from './ralph-session-routes';
import { registerRalphContinueRoutes } from './ralph-continue-routes';
import { registerRalphNewLoopRoutes } from './ralph-new-loop-routes';
import { registerRalphPromoteRoutes } from './ralph-promote-routes';
import { registerRalphLaunchRoutes } from './ralph-launch-routes';
import { registerLoopRoutes } from '../loops/loop-handler';
import type { LoopStore } from '../loops/loop-store';
import type { LoopExecutor, LoopEventEmit } from '../loops/loop-executor';
import { registerMcpOauthRoutes } from '../mcp-oauth';
import type { McpOauthManager } from '../mcp-oauth';
import { registerAgentProvidersRoutes } from '../agent-providers/agent-providers-routes';
import { registerProviderInstallRoutes } from '../providers/provider-install-routes';
import { registerDiagramRoutes } from '../diagrams/diagrams-handler';
import { registerRuntimeConfigRoutes } from '../config/runtime-config-handler';
import { registerSyncRoutes } from '../sync/sync-handler';
import type { SyncEngine } from '../sync/sync-engine';
import { registerTeamsMessagingRoutes } from '../messaging/teams-messaging-handler';
import { registerContainerSessionRoutes } from '../container-sessions/container-session-handler';
import { ContainerSessionStore } from '../container-sessions/container-session-store';
import type { ContainerAgentInfo } from '../container-sessions/container-session-types';

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
    loopStore?: LoopStore;
    loopExecutor?: LoopExecutor;
    mcpOauthManager?: McpOauthManager;
    loopEmit?: LoopEventEmit;
    hostname?: string;
    bindAddress?: string;
    syncEngines?: Map<string, SyncEngine>;
}

export function registerAllRoutes(routes: Route[], opts: RegisterRoutesOptions): { wikiManager: WikiManager | undefined } {
    const {
        store, bridge, queueFacade, scheduleManager,
        notesGitTimerManager,
        dataDir, configPath, tokenTtlMs, globalWorkspaceRootPath,
        resolvedAiService, getWsServer, queuePersistence, wikiOptions,
        aiInvoker,
    } = opts;

    // excalidrawEnabled uses a live getter via runtimeConfigService so admin
    // changes take effect without restart. loopsEnabled stays startup-captured
    // (restartRequired — loop executor infrastructure wires at startup).
    const getLiveFeatureFlags = opts.runtimeConfigService
        ? () => ({ excalidrawEnabled: opts.runtimeConfigService!.config.excalidraw?.enabled ?? false })
        : () => ({ excalidrawEnabled: opts.resolvedConfig?.excalidraw?.enabled ?? false });
    registerApiRoutes(routes, store, bridge, dataDir, getWsServer, undefined, opts.resolvedConfig?.loops?.enabled ?? false, getLiveFeatureFlags);
    const repoTreeService = new RepoTreeService(dataDir, undefined, store);
    registerRepoRoutes(routes, dataDir, repoTreeService);
    registerPrRoutes(routes, dataDir, repoTreeService, undefined, resolvedAiService);
    // Focused-diff classification routes — always registered so the feature
    // can be toggled live via admin config. The SPA gates the UI based on
    // runtime config; having the routes present when disabled is harmless.
    registerPrClassificationRoutes(routes, {
        dataDir,
        store,
        bridge,
        repoTreeService,
    });
    registerGenericClassificationRoutes(routes, {
        dataDir,
        store,
        bridge,
        repoTreeService,
    });
    registerRemoteServerRoutes(routes, {
        store: opts.remoteServerStore ?? new RemoteServerStore(dataDir),
        connector: opts.remoteServerConnector ?? new DevTunnelConnector(),
    });
    registerProviderRoutes(routes, dataDir);
    // Provider SDK install routes (on-demand install of @openai/codex-sdk and @anthropic-ai/claude-agent-sdk).
    // cocInstallDir is the package root so npm installs land in the same node_modules as coc.
    registerProviderInstallRoutes(routes, {
        // __dirname at runtime = dist/server/routes/; package root is 3 levels up.
        cocInstallDir: path.join(__dirname, '../../..'),
    });
    registerProcessResumeRoutes(routes, store);
    registerFreshChatTerminalRoutes(routes, undefined, {
        getProvider: () => {
            const activeProvider = opts.runtimeConfigService?.config.activeProvider
                ?? opts.resolvedConfig?.activeProvider;
            if (activeProvider === 'codex') return 'codex';
            if (activeProvider === 'claude') return 'claude';
            return 'copilot';
        },
    });
    registerTerminalRoutes(routes, store, opts.getTerminalSessionManager ?? (() => undefined), opts.resolvedConfig, opts.runtimeConfigService);

    // Queue routes receive the bridge directly for per-repo routing
    registerQueueRoutes(routes, bridge, store, globalWorkspaceRootPath);
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

    // Diagram routes — always registered so excalidraw.enabled (classified
    // as live) can be toggled via admin config without restart. The SPA
    // gates the UI via runtime config.
    registerDiagramRoutes(routes, store, dataDir);
    registerWorkflowRoutes(routes, store);
    registerWorkspaceSummaryRoutes(routes, store, dataDir);
    registerWorkflowWriteRoutes(routes, store, (workspaceId) => {
        getWsServer().broadcastProcessEvent({
            type: 'workflows-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    }, bridge, resolvedAiService);
    registerTaskGenerationRoutes(routes, store, bridge, resolvedAiService, dataDir);
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
    registerPreferencesRoutes(routes, dataDir, (workspaceId) => opts.syncEngines?.get(workspaceId));
    registerSeenStateRoutes(routes, store as any);
    registerPromptSuggestionRoutes(routes, store as any, dataDir, resolvedAiService);
    registerPromptHistoryRoutes(routes, store as any);
    registerPinArchiveRoutes(routes, store as any);
    registerTurnActionRoutes(routes, store as any, getWsServer);
    registerProcessHistoryRoutes(routes, store as any);
    registerWorkspaceHistoryRoutes(routes, store, bridge);
    registerTaskCommentsRoutes(routes, dataDir, bridge, store, getWsServer);
    registerDiffCommentsRoutes(routes, dataDir, bridge, store, getWsServer);
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
    });

    // Loop routes
    if (opts.loopStore && opts.loopExecutor) {
        registerLoopRoutes(routes, {
            store: opts.loopStore,
            executor: opts.loopExecutor,
            emit: opts.loopEmit,
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
        registerAgentProvidersRoutes(routes, {
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
            getCopilotSdkService: () => CopilotSDKService.getInstance(),
            getCodexSdkService: () => {
                const svc = sdkServiceRegistry.get(SDK_PROVIDER_CODEX);
                return svc instanceof CodexSDKService ? svc : undefined;
            },
            getClaudeSdkService: () => {
                const svc = sdkServiceRegistry.get(SDK_PROVIDER_CLAUDE);
                return svc instanceof ClaudeSDKService ? svc : undefined;
            },
        });
    }

    registerMemoryRoutes(routes, dataDir);

    registerMemoryV2Routes(routes, dataDir, store);

    registerModelRoutes(routes, modelMetadataStore, {
        configPath,
        loadConfigFile,
        writeConfigFile,
        getConfigFilePath,
        aiService: resolvedAiService,
    });
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
    registerTeamsMessagingRoutes(routes, { dataDir });

    // Ralph routes
    registerRalphRoutes(routes, { bridge, store, dataDir });
    registerRalphSessionRoutes(routes, { dataDir });
    registerRalphContinueRoutes(routes, { bridge, store, dataDir });
    registerRalphNewLoopRoutes(routes, { bridge, store, dataDir });
    registerRalphPromoteRoutes(routes, { bridge, store, dataDir });
    registerRalphLaunchRoutes(routes, { bridge, dataDir });

    // Work item routes
    const workItemStore = new FileWorkItemStore({ dataDir });
    const enqueueForWorkItems = bridge.enqueue.bind(bridge) as EnqueueFunction;
    registerWorkItemRoutes({ routes, workItemStore, processStore: store, enqueue: enqueueForWorkItems, getWsServer });
    registerWorkItemPlanRoutes({ routes, workItemStore, getWsServer });
    registerWorkItemExecutionRoutes({ routes, workItemStore, processStore: store, enqueue: enqueueForWorkItems, getWsServer, dataDir });
    registerWorkItemChangesRoutes({ routes, workItemStore, getWsServer });

    // Wire queue task completion → work item status update + commit collection
    bridge.on('queueChange', (event: { type: string; task?: any }) => {
        if (event.type !== 'updated' || !event.task) return;
        const task = event.task;
        const workItemId = task.payload?.workItemId as string | undefined;
        if (!workItemId) return;
        const taskStatus: string = task.status;
        if (taskStatus !== 'completed' && taskStatus !== 'failed' && taskStatus !== 'cancelled') return;

        handleWorkItemTaskComplete(
            workItemId,
            task.id,
            {
                status: taskStatus as 'completed' | 'failed' | 'cancelled',
                error: task.error,
                processId: task.processId,
            },
            workItemStore,
        ).then(async () => {
            try {
                let updatedItem = await workItemStore.getWorkItem(workItemId).catch(() => undefined);
                if (!updatedItem) return;

                // Auto-create plan version from resolved plan comments
                if (taskStatus === 'completed') {
                    const matchedExec = updatedItem.executionHistory?.find(e => e.taskId === task.id);
                    if (matchedExec?.sessionCategory === 'resolve-plan-comments' && task.processId) {
                        try {
                            const process = await store.getProcess(task.processId).catch(() => undefined);
                            const afterPlan = await autoVersionPlanFromResolvedComments(
                                workItemId,
                                process?.result,
                                workItemStore,
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
                    const workspace = workspaces.find(w => w.id === updatedItem.repoId);
                    if (workspace?.rootPath) {
                        const commits = collectWorkItemCommits(workspace.rootPath, justClosed.headBefore);
                        if (commits.length > 0) {
                            await workItemStore.updateChange(workItemId, justClosed.id, { commits }).catch(() => {});
                            commitsAttached = true;
                        }
                    }
                }

                // Update the placeholder task file to reflect the final execution status.
                try {
                    const fileStatus = toTaskFileStatus(taskStatus as 'completed' | 'failed' | 'cancelled');
                    await upsertWorkItemTaskFile(dataDir, updatedItem.repoId, workItemId, updatedItem.title, fileStatus);
                    getWsServer?.()?.broadcastProcessEvent({
                        type: 'tasks-changed',
                        workspaceId: updatedItem.repoId,
                        timestamp: Date.now(),
                    });
                } catch { /* non-fatal — placeholder file update is best-effort */ }

                // Re-fetch after commit attachment so the broadcast includes commits
                const itemToSend = commitsAttached
                    ? (await workItemStore.getWorkItem(workItemId).catch(() => updatedItem)) ?? updatedItem
                    : updatedItem;

                getWsServer?.()?.broadcastProcessEvent({
                    type: 'work-item-updated',
                    workspaceId: itemToSend.repoId,
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

    return { wikiManager };
}
