/**
 * Aggregated route registration for the CoC execution server.
 *
 * `registerAllRoutes` consolidates all registerXxxRoutes calls so that
 * `createExecutionServer` only deals with infrastructure setup.
 */

import type { Route } from '../types';
import type { ProcessStore, TaskQueueManager, CopilotSDKService } from '@plusplusoneplusplus/forge';
import { modelMetadataStore } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../websocket';
import type { MultiRepoQueueExecutorBridge } from '../multi-repo-executor-bridge';
import type { MultiRepoQueuePersistence } from '../multi-repo-queue-persistence';
import type { ScheduleManager } from '../schedule-manager';
import type { WikiServerOptions } from '../types';
import type { WikiManager } from '../wiki';
import { registerApiRoutes } from '../api-handler';
import { registerQueueRoutes } from '../queue-handler';
import { registerTaskRoutes, registerTaskWriteRoutes } from '../tasks-handler';
import { registerTaskGenerationRoutes } from '../task-generation-handler';
import { registerPromptRoutes } from '../prompt-handler';
import { registerPreferencesRoutes } from '../preferences-handler';
import { registerAdminRoutes } from '../admin-handler';
import { registerTaskCommentsRoutes } from '../task-comments-handler';
import { registerDiffCommentsRoutes } from '../diff-comments-handler';
import { registerWikiRoutes } from '../wiki';
import { registerMemoryRoutes } from '../memory/memory-routes';
import { registerRepoRoutes } from '../repos/repo-routes';
import { registerInstructionRoutes } from '../instruction-handler';
import { registerProviderRoutes } from '../providers/provider-routes';
import { registerPrRoutes } from '../repos/pr-routes';
import { registerLogsRoutes } from '../logs-routes';
import { registerModelRoutes } from '../models/model-routes';
import { RepoTreeService } from '../repos/tree-service';
import { registerProcessResumeRoutes, registerFreshChatTerminalRoutes } from '../process-resume-handler';
import { registerWorkflowRoutes, registerWorkflowWriteRoutes } from '../workflows-handler';
import { registerTemplateRoutes, registerTemplateWriteRoutes } from '../templates-handler';
import { registerReplicateApplyRoutes } from '../replicate-apply-handler';
import { registerScheduleRoutes } from '../schedule-handler';
import { registerStatsRoutes } from '../stats-handler';
import { getResolvedConfigWithSource, loadConfigFile, writeConfigFile, getConfigFilePath } from '../../config';
import { createCLIAIInvoker } from '../../ai-invoker';

export interface RegisterRoutesOptions {
    store: ProcessStore;
    bridge: MultiRepoQueueExecutorBridge;
    queueFacade: TaskQueueManager;
    scheduleManager: ScheduleManager;
    dataDir: string;
    configPath: string | undefined;
    tokenTtlMs: number | undefined;
    globalWorkspaceRootPath: string;
    resolvedAiService: CopilotSDKService;
    getWsServer: () => ProcessWebSocketServer;
    queuePersistence: MultiRepoQueuePersistence;
    wikiOptions?: WikiServerOptions;
}

export function registerAllRoutes(routes: Route[], opts: RegisterRoutesOptions): { wikiManager: WikiManager | undefined } {
    const {
        store, bridge, queueFacade, scheduleManager,
        dataDir, configPath, tokenTtlMs, globalWorkspaceRootPath,
        resolvedAiService, getWsServer, queuePersistence, wikiOptions,
    } = opts;

    registerApiRoutes(routes, store, bridge, dataDir, getWsServer);
    const repoTreeService = new RepoTreeService(dataDir);
    registerRepoRoutes(routes, dataDir, repoTreeService);
    registerPrRoutes(routes, dataDir, repoTreeService);
    registerProviderRoutes(routes, dataDir);
    registerProcessResumeRoutes(routes, store);
    registerFreshChatTerminalRoutes(routes);

    // Queue routes receive the bridge directly for per-repo routing
    registerQueueRoutes(routes, bridge, store, globalWorkspaceRootPath);
    registerTaskRoutes(routes, store, dataDir);
    registerTaskWriteRoutes(routes, store, dataDir);
    registerWorkflowRoutes(routes, store);
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
    registerPreferencesRoutes(routes, dataDir);
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
        tokenTtlMs,
    });
    registerScheduleRoutes(routes, scheduleManager, async (repoId) => {
        const workspaces = await store.getWorkspaces();
        return workspaces.find(w => w.id === repoId)?.rootPath;
    });

    registerMemoryRoutes(routes, dataDir, {
        aggregateToolCallsAIInvoker: createCLIAIInvoker({ approvePermissions: true }),
    });

    registerModelRoutes(routes, modelMetadataStore);
    registerLogsRoutes(routes);
    registerInstructionRoutes(routes, store);
    registerStatsRoutes(routes, store);

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

    return { wikiManager };
}
