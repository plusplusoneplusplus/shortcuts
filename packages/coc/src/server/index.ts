/**
 * CoC Execution Server
 *
 * Creates and manages an HTTP server for the `coc serve` command.
 * Uses only Node.js built-in modules (http, fs, path, os).
 *
 * Mirrors packages/deep-wiki/src/server/index.ts pattern.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createRequestHandler } from './router';
import { registerAllRoutes } from './routes/index';
import { ProcessWebSocketServer, toProcessSummary } from './websocket';
import { generateDashboardHtml } from './spa';
import { getBundleETag } from './spa/html-template';
import { generateIconSvg } from './spa/icon-template';
import type { ExecutionServerOptions, ExecutionServer, ServerCloseOptions } from './types';
import type { Route } from './types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getCopilotSDKService, modelMetadataStore } from '@plusplusoneplusplus/forge';
import { cleanupAllStalePasteFiles } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
import { createQueueInfrastructure } from './infrastructure/queue-infrastructure';
import { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID } from './global-workspace';
import { createScheduleInfrastructure } from './infrastructure/schedule-infrastructure';
import { createCleanupInfrastructure } from './infrastructure/cleanup-infrastructure';
import { createWebSocketInfrastructure } from './infrastructure/websocket-infrastructure';
import { createWatcherInfrastructure } from './infrastructure/watcher-infrastructure';
import { createTerminalInfrastructure } from './infrastructure/terminal-infrastructure';
import { resolveConfig } from '../config';
import { DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/forge';
import { createStubStore } from './in-memory-process-store';
import { createCLIAIInvoker } from '../ai-invoker';
import { shortenHostname } from './hostname-utils';
import { gitInfoCache } from './git-info-cache';

// ============================================================================
// Close Handler Builder
// ============================================================================

interface CloseHandlerDeps {
    staleDetector: { dispose(): void };
    outputPruner: { stopListening(): void };
    taskWatcher: { closeAll(): void };
    pipelineWatcher: { closeAll(): void };
    templateWatcher: { closeAll(): void };
    wikiManager: { disposeAll(): void } | undefined;
    scheduleManager: { dispose(): void };
    bridge: MultiRepoQueueExecutorBridge;
    queuePersistence: { dispose(): void };
    wsServer: ProcessWebSocketServer;
    terminalWsServer?: { closeAll(): void };
    terminalSessionManager?: { destroyAll(): void };
    activeSockets: Set<import('net').Socket>;
    server: http.Server;
}

function buildCloseHandler(deps: CloseHandlerDeps): (opts?: ServerCloseOptions) => Promise<{ drainOutcome?: 'completed' | 'timeout' }> {
    return async (closeOptions) => {
        const { staleDetector, outputPruner, taskWatcher, pipelineWatcher, templateWatcher,
                wikiManager, scheduleManager, bridge, queuePersistence, wsServer, activeSockets, server } = deps;

        staleDetector.dispose();
        outputPruner.stopListening();
        taskWatcher.closeAll();
        pipelineWatcher.closeAll();
        templateWatcher.closeAll();
        wikiManager?.disposeAll();
        scheduleManager.dispose();
        gitInfoCache.dispose();

        let drainOutcome: 'completed' | 'timeout' | undefined;
        if (closeOptions?.drain) {
            const result = await bridge.drainAll(closeOptions.drainTimeoutMs);
            drainOutcome = result.outcome;
        }

        queuePersistence.dispose();
        if (!closeOptions?.drain) {
            bridge.dispose();
        }

        deps.terminalSessionManager?.destroyAll();
        deps.terminalWsServer?.closeAll();
        wsServer.closeAll();
        for (const socket of activeSockets) {
            socket.destroy();
        }
        activeSockets.clear();
        await new Promise<void>((resolve, reject) => {
            server.close((err) => {
                if (err) { reject(err); } else { resolve(); }
            });
        });

        return { drainOutcome };
    };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create and start the CoC execution server.
 *
 * @param options - Server options
 * @returns A running ExecutionServer instance
 */
export async function createExecutionServer(options: ExecutionServerOptions = {}): Promise<ExecutionServer> {
    const port = options.port ?? 4000;
    const host = options.host ?? '0.0.0.0';
    const dataDir = options.dataDir ?? path.join(os.homedir(), '.coc');
    const store = options.store ?? createStubStore();
    fs.mkdirSync(dataDir, { recursive: true });

    const resolvedConfig = resolveConfig(options.configPath, options.fileConfig);
    const defaultTimeoutMs = resolvedConfig.timeout ? resolvedConfig.timeout * 1000 : DEFAULT_AI_TIMEOUT_MS;

    // Forward declaration — bridge captures this via closure before wsServer is assigned
    let wsServer!: ProcessWebSocketServer;

    // Forward declaration — terminal infra is created after the HTTP server
    let terminalInfra: import('./infrastructure/terminal-infrastructure').TerminalInfrastructure | undefined;

    const { registry, bridge, queuePersistence, queueFacade } = createQueueInfrastructure(
        store, dataDir, options, defaultTimeoutMs,
        resolvedConfig.chat.followUpSuggestions, () => wsServer,
    );
    const { scheduleManager } = createScheduleInfrastructure(dataDir, queueFacade);
    const { outputPruner, staleDetector } = createCleanupInfrastructure(store, dataDir, queueFacade);

    const globalWorkspace = await ensureGlobalWorkspace(dataDir, store);
    bridge.registerRepoId(globalWorkspace.id, globalWorkspace.rootPath);

    const resolvedAiService = options.aiService ?? getCopilotSDKService();
    const aiInvoker = createCLIAIInvoker({ approvePermissions: true });
    const routes: Route[] = [];
    const { wikiManager } = registerAllRoutes(routes, {
        store, bridge, queueFacade, scheduleManager,
        dataDir, configPath: options.configPath,
        tokenTtlMs: options.tokenTtlMs,
        globalWorkspaceRootPath: globalWorkspace.rootPath,
        resolvedAiService, getWsServer: () => wsServer,
        queuePersistence, wikiOptions: options.wiki,
        aiInvoker,
        getTerminalSessionManager: () => terminalInfra?.terminalSessionManager,
        resolvedConfig,
    });

    const rawHostname = os.hostname();
    const displayHostname = resolvedConfig.serve?.serverName || shortenHostname(rawHostname);
    const handler = createRequestHandler({
        routes, spaHtml: () => generateDashboardHtml({ enableWiki: true, hostname: displayHostname, terminalEnabled: resolvedConfig.terminal?.enabled ?? false, notesEnabled: resolvedConfig.notes?.enabled ?? false }),
        store, spaETag: getBundleETag,
        staticDir: path.join(__dirname, 'spa', 'client', 'dist'),
        getIconSvg: () => generateIconSvg(rawHostname),
    });
    const server = http.createServer(handler);

    // Terminal infrastructure (optional — gated by config + node-pty availability)
    terminalInfra = createTerminalInfrastructure(store, resolvedConfig);

    wsServer = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager, terminalInfra?.terminalWsServer);
    const { taskWatcher, pipelineWatcher, templateWatcher } =
        await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

    await new Promise<void>((resolve, reject) => { server.on('error', reject); server.listen(port, host, resolve); });
    modelMetadataStore.initialize(resolvedAiService).catch((err: unknown) => {
        process.stderr.write(`[ModelMetadataStore] warm-up failed: ${(err as Error)?.message ?? err}\n`);
    });
    cleanupAllStalePasteFiles(dataDir).catch(() => { /* best-effort */ });

    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
    const url = `http://${displayHost}:${actualPort}`;

    const activeSockets = new Set<import('net').Socket>();
    server.on('connection', (socket) => { activeSockets.add(socket); socket.on('close', () => activeSockets.delete(socket)); });

    return {
        server, store, wsServer, port: actualPort, host, url,
        close: buildCloseHandler({
            staleDetector, outputPruner, taskWatcher, pipelineWatcher, templateWatcher,
            wikiManager, scheduleManager, bridge, queuePersistence, wsServer,
            terminalWsServer: terminalInfra?.terminalWsServer,
            terminalSessionManager: terminalInfra?.terminalSessionManager,
            activeSockets, server,
        }),
    };
}

// ============================================================================
// Public API
// ============================================================================

export type { ExecutionServerOptions, ExecutionServer, Route, WikiServerOptions, ServerCloseOptions, ServeCommandOptions } from './types';
export type { ProcessStore } from '@plusplusoneplusplus/forge';

// HTTP helpers (canonical source: shared/router.ts)
export { sendJson, send404, send400, send500, sendError, readJsonBody } from './shared/router';
export { createRequestHandler } from './router';
export type { RouterOptions } from './router';

// Deprecated compat wrapper — use sendJson(res, data, statusCode) instead
export { sendJSON, parseBody, parseQueryParams, stripExcludedFields } from './api-handler';
export { detectRemoteUrl, normalizeRemoteUrl } from './api-handler';

// WebSocket
export { ProcessWebSocketServer, toProcessSummary, toCommentSummary, attachWebSocketUpgradeHandler } from './websocket';
export type { WSClient, ProcessSummary, MarkdownCommentSummary, QueueTaskSummary, QueueHistoryTaskSummary, ServerMessage, ClientMessage, QueueSnapshot } from './websocket';

// Terminal
export { TerminalWebSocketServer } from './terminal/index';
export { TerminalSessionManager, toSessionInfo } from './terminal/index';
export type { TerminalSessionManagerOptions, IPty, TerminalSession, TerminalSessionInfo, TerminalClientMessage, TerminalServerMessage } from './terminal/index';
export { registerTerminalRoutes } from './terminal/terminal-routes';
export { createTerminalInfrastructure } from './infrastructure/terminal-infrastructure';
export type { TerminalInfrastructure } from './infrastructure/terminal-infrastructure';

// SSE
export { handleProcessStream } from './sse-handler';

// SPA
export { generateDashboardHtml } from './spa';
export type { DashboardOptions } from './spa';

// Global workspace
export { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID, GLOBAL_WORKSPACE_NAME } from './global-workspace';

// Queue
export { CLITaskExecutor, createQueueExecutorBridge, defaultIsExclusive, DEFAULT_FOLLOW_UP_SUGGESTIONS } from './queue-executor-bridge';
export type { QueueExecutorBridgeOptions, QueueExecutorBridge } from './queue-executor-bridge';
export { ExecutorRegistry } from './executors/executor-registry';
export type { ExecutorRegistryOptions } from './executors/executor-registry';
export type { ITaskExecutor } from './executors/executor-types';
export { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
export { MultiRepoQueuePersistence } from './multi-repo-queue-persistence';
export { QueuePersistence, getRepoQueueFilePath, sanitizeTaskForPersistence } from './queue/queue-persistence';
export { ImageBlobStore } from './queue/image-blob-store';

// Data management
export { DataWiper } from './data-wiper';
export type { WipeOptions, WipeResult } from './data-wiper';
export { exportAllData } from './data-exporter';
export { importData } from './data-importer';
export type { CoCExportPayload, ImportOptions } from './export-import-types';
export { EXPORT_SCHEMA_VERSION, validateExportPayload } from './export-import-types';

// Admin & tokens
export { registerAdminRoutes, resetWipeToken, getBuiltInPrompts } from './admin-handler';
export type { AdminRouteOptions, BuiltInPrompt } from './admin-handler';
export { generateImportToken, generateWipeToken, importTokenManager, resetImportToken, wipeTokenManager, validateImportToken, validateWipeToken, TOKEN_EXPIRY_MS, TokenManager } from './admin-handler';

// Scheduling
export { ScheduleYamlPersistence } from './schedule-yaml-persistence';
export { ScheduleRunPersistence } from './schedule-run-persistence';
export { ScheduleManager, parseCron, nextCronTime, describeCron } from './schedule-manager';
export type { ScheduleEntry, ScheduleRunRecord, ScheduleStatus, ScheduleOnFailure, ScheduleChangeEvent } from './schedule-manager';

// Tasks
export type { ChatPayload } from './task-types';
export { isChatPayload, hasTaskGenerationContext } from './task-types';
export { resolveTaskRoot, ensureTaskRoot, resolveAllTaskRoots } from './task-root-resolver';
export type { TaskRootInfo, TaskRootOptions } from './task-root-resolver';
export { registerTaskCommentsRoutes, TaskCommentsManager } from './task-comments-handler';
export type { TaskComment, CommentAnchor, CommentsStorage } from './task-comments-handler';
export { registerDiffCommentsRoutes, DiffCommentsManager } from './diff-comments-handler';
export type { DiffCommentsStorage } from './diff-comments-handler';

// Preferences
export { registerPreferencesRoutes, readPreferences, writePreferences, validatePreferences } from './preferences-handler';
export type { UserPreferences } from './preferences-handler';

// Prompts
export { discoverPromptFiles, readPromptFileContent } from './prompt-utils';
export type { PromptFileInfo } from './prompt-utils';

// Wiki
export { registerWikiRoutes } from './wiki';
export type { WikiRouteOptions } from './wiki';
export { FileWatcher } from './wiki/file-watcher';
export { WikiData } from './wiki/wiki-data';
export type { ComponentAnalysis, ComponentGraph } from './wiki/types';

// Logging
export { captureEntry, clearLogBuffer } from './server-log-capture';

// Paths
export { getRepoDataPath } from './paths';

// ============================================================================
// @internal — Infrastructure used by createExecutionServer; avoid in new code
// ============================================================================

/** @internal */ export { OutputPruner } from './output-pruner';
/** @internal */ export { StaleTaskDetector } from './stale-task-detector';
/** @internal */ export type { StaleTaskDetectorOptions } from './stale-task-detector';
/** @internal */ export { TaskWatcher } from './task-watcher';
/** @internal */ export type { TasksChangedCallback } from './task-watcher';
/** @internal */ export { WorkflowWatcher } from './workflow-watcher';
/** @internal */ export type { WorkflowsChangedCallback } from './workflow-watcher';
/** @internal */ export { TemplateWatcher } from './template-watcher';
/** @internal */ export type { TemplatesChangedCallback } from './template-watcher';

// ============================================================================
// @internal — Route registration (called by registerAllRoutes only)
// ============================================================================

/** @internal */ export { registerApiRoutes } from './api-handler';
/** @internal */ export { registerProcessResumeRoutes, registerFreshChatTerminalRoutes } from './process-resume-handler';
/** @internal */ export { registerQueueRoutes } from './queue-handler';
/** @internal */ export { registerTaskRoutes, registerTaskWriteRoutes } from './tasks-handler';
/** @internal */ export { registerTaskGenerationRoutes } from './task-generation-handler';
/** @internal */ export { registerTemplateRoutes, registerTemplateWriteRoutes } from './templates-handler';
/** @internal */ export { registerWorkflowRoutes, registerWorkflowWriteRoutes } from './workflows-handler';
/** @internal */ export { registerScheduleRoutes } from './schedule-handler';
