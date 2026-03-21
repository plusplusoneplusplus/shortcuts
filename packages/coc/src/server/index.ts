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
import { EventEmitter } from 'events';
import { createRequestHandler } from './router';
import { registerAllRoutes } from './routes/index';
import { ProcessWebSocketServer, toProcessSummary } from './websocket';
import { generateDashboardHtml } from './spa';
import { getBundleETag } from './spa/html-template';
import type { ExecutionServerOptions, ExecutionServer } from './types';
import type { Route } from './types';
import type { ProcessStore, AIProcess, ProcessChangeCallback, ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import { getCopilotSDKService, modelMetadataStore } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
import { createQueueInfrastructure } from './infrastructure/queue-infrastructure';
import { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID } from './global-workspace';
import { createScheduleInfrastructure } from './infrastructure/schedule-infrastructure';
import { createCleanupInfrastructure } from './infrastructure/cleanup-infrastructure';
import { createWebSocketInfrastructure } from './infrastructure/websocket-infrastructure';
import { createWatcherInfrastructure } from './infrastructure/watcher-infrastructure';
import { resolveConfig } from '../config';
import { DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/forge';

// ============================================================================
// Stub Process Store
// ============================================================================

/**
 * Minimal in-memory ProcessStore used when no store is injected.
 * Supports event emission for SSE streaming and process tracking.
 */
function createStubStore(): ProcessStore {
    const processes = new Map<string, AIProcess>();
    const emitters = new Map<string, EventEmitter>();
    let changeCallback: ProcessChangeCallback | undefined;

    function getOrCreateEmitter(id: string): EventEmitter {
        let emitter = emitters.get(id);
        if (!emitter) {
            emitter = new EventEmitter();
            emitters.set(id, emitter);
        }
        return emitter;
    }

    const store: ProcessStore = {
        addProcess: async (proc) => {
            processes.set(proc.id, proc);
            changeCallback?.({ type: 'process-added', process: proc });
        },
        updateProcess: async (id, updates) => {
            const existing = processes.get(id);
            if (!existing) return;
            const merged = { ...existing, ...updates };
            processes.set(id, merged as AIProcess);
            changeCallback?.({ type: 'process-updated', process: merged as AIProcess });
        },
        getProcess: async (id) => processes.get(id),
        getAllProcesses: async () => Array.from(processes.values()),
        removeProcess: async (id) => {
            const proc = processes.get(id);
            processes.delete(id);
            if (proc) changeCallback?.({ type: 'process-removed', process: proc });
        },
        clearProcesses: async () => { const count = processes.size; processes.clear(); changeCallback?.({ type: 'processes-cleared' }); return count; },
        getWorkspaces: async () => [],
        registerWorkspace: async () => {},
        removeWorkspace: async () => false,
        updateWorkspace: async () => undefined,
        getWikis: async () => [],
        registerWiki: async () => {},
        removeWiki: async () => false,
        updateWiki: async () => undefined,
        clearAllWorkspaces: async () => 0,
        clearAllWikis: async () => 0,
        getStorageStats: async () => ({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 }),
        onProcessOutput: (id, callback) => {
            const emitter = getOrCreateEmitter(id);
            const listener = (event: ProcessOutputEvent) => callback(event);
            emitter.on('output', listener);
            return () => { emitter.removeListener('output', listener); };
        },
        emitProcessOutput: (id, content) => {
            const emitter = getOrCreateEmitter(id);
            emitter.emit('output', { type: 'chunk', content });
        },
        emitProcessComplete: (id, status, duration) => {
            const emitter = emitters.get(id);
            if (!emitter) return;
            emitter.emit('output', { type: 'complete', status, duration });
            emitters.delete(id);
        },
        emitProcessEvent: (id, event) => {
            const emitter = getOrCreateEmitter(id);
            emitter.emit('output', event);
        },
    };

    // Expose onProcessChange setter via defineProperty
    Object.defineProperty(store, 'onProcessChange', {
        get: () => changeCallback,
        set: (cb: ProcessChangeCallback | undefined) => { changeCallback = cb; },
        enumerable: true,
        configurable: true,
    });

    return store;
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

    // Forward reference — assigned by createWebSocketInfrastructure below,
    // before any request is processed (server not yet listening).
    let wsServer: ProcessWebSocketServer;

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    // Resolve config to derive default timeout for AI tasks
    const resolvedConfig = resolveConfig(options.configPath);
    const defaultTimeoutMs = resolvedConfig.timeout
        ? resolvedConfig.timeout * 1000
        : DEFAULT_AI_TIMEOUT_MS;

    // Create per-repo queue infrastructure
    const { registry, bridge, queuePersistence, queueFacade } = createQueueInfrastructure(
        store,
        dataDir,
        options,
        defaultTimeoutMs,
        resolvedConfig.chat.followUpSuggestions,
        () => wsServer,
    );

    // Initialize schedule manager with persistent storage
    const { scheduleManager } = createScheduleInfrastructure(dataDir, queueFacade);

    // Wire up output pruner and stale task detector
    const { outputPruner, staleDetector } = createCleanupInfrastructure(store, dataDir, queueFacade);

    const spaHtmlFactory = () => generateDashboardHtml({ enableWiki: true });

    const resolvedAiService = options.aiService ?? getCopilotSDKService();

    // Build API routes
    const routes: Route[] = [];

    // Bootstrap global workspace before queue routes so its rootPath is available
    const globalWorkspace = await ensureGlobalWorkspace(dataDir, store);
    bridge.registerRepoId(globalWorkspace.id, globalWorkspace.rootPath);

    const { wikiManager } = registerAllRoutes(routes, {
        store, bridge, queueFacade, scheduleManager,
        dataDir, configPath: options.configPath,
        tokenTtlMs: options.tokenTtlMs,
        globalWorkspaceRootPath: globalWorkspace.rootPath,
        resolvedAiService,
        getWsServer: () => wsServer,
        queuePersistence,
        wikiOptions: options.wiki,
    });

    // Build request handler (health route is prepended automatically)
    const handler = createRequestHandler({
        routes,
        spaHtml: spaHtmlFactory,
        store,
        spaETag: getBundleETag,
        staticDir: path.join(__dirname, 'spa', 'client', 'dist'),
    });
    const server = http.createServer(handler);

    // Attach WebSocket server and bridge all event sources
    wsServer = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);

    // Set up file watchers (task/workflow/template) and wire workspace hooks
    const { taskWatcher, pipelineWatcher, templateWatcher } =
        await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

    // Start listening
    await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, host, () => resolve());
    });

    // Warm up model metadata cache; failure must never block startup.
    modelMetadataStore.initialize(resolvedAiService).catch((err: unknown) => {
        process.stderr.write(`[ModelMetadataStore] warm-up failed: ${(err as Error)?.message ?? err}\n`);
    });

    // Resolve actual port (important when port 0 is used for random port)
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
    const url = `http://${displayHost}:${actualPort}`;

    // Track active connections for force-close on shutdown
    const activeSockets = new Set<import('net').Socket>();
    server.on('connection', (socket) => {
        activeSockets.add(socket);
        socket.on('close', () => activeSockets.delete(socket));
    });

    return {
        server,
        store,
        wsServer,
        port: actualPort,
        host,
        url,
        close: async (closeOptions?: import('./types').ServerCloseOptions) => {
            // Stop stale task detection
            staleDetector.dispose();
            // Stop output pruner cleanup
            outputPruner.stopListening();
            // Close task file watchers
            taskWatcher.closeAll();
            // Close workflow file watchers
            pipelineWatcher.closeAll();
            // Close template file watchers
            templateWatcher.closeAll();
            // Dispose wiki manager (stop file watchers, destroy sessions)
            wikiManager?.disposeAll();
            // Dispose schedule manager (cancel timers)
            scheduleManager.dispose();

            // Drain queue if requested
            let drainOutcome: 'completed' | 'timeout' | undefined;
            if (closeOptions?.drain) {
                const result = await bridge.drainAll(closeOptions.drainTimeoutMs);
                drainOutcome = result.outcome;
            }

            // Flush persisted queue state and dispose bridge
            queuePersistence.dispose();
            if (!closeOptions?.drain) {
                bridge.dispose();
            }

            wsServer.closeAll();
            // Destroy remaining keep-alive connections
            for (const socket of activeSockets) {
                socket.destroy();
            }
            activeSockets.clear();
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) { reject(err); }
                    else { resolve(); }
                });
            });

            return { drainOutcome };
        },
    };
}

// Re-exports
export type { ExecutionServerOptions, ExecutionServer, Route, WikiServerOptions, ServerCloseOptions } from './types';
export type { ProcessStore } from '@plusplusoneplusplus/forge';
export { sendJson, send404, send400, send500, readJsonBody, createRequestHandler } from './router';
export { registerApiRoutes, sendJSON, sendError, parseBody, parseQueryParams } from './api-handler';
export { registerProcessResumeRoutes, registerFreshChatTerminalRoutes } from './process-resume-handler';
export { registerQueueRoutes } from './queue-handler';
export { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID, GLOBAL_WORKSPACE_NAME } from './global-workspace';
export { registerTaskRoutes, registerTaskWriteRoutes } from './tasks-handler';
export { registerTaskGenerationRoutes } from './task-generation-handler';
export { handleProcessStream } from './sse-handler';
export { ProcessWebSocketServer, toProcessSummary, toCommentSummary } from './websocket';
export type { WSClient, ProcessSummary, MarkdownCommentSummary, QueueTaskSummary, QueueHistoryTaskSummary, ServerMessage, ClientMessage } from './websocket';
export type { QueueSnapshot } from './websocket';
export type { RouterOptions } from './router';
export { generateDashboardHtml } from './spa';
export type { DashboardOptions } from './spa';
export { CLITaskExecutor, createQueueExecutorBridge, defaultIsExclusive } from './queue-executor-bridge';
export type { QueueExecutorBridgeOptions, QueueExecutorBridge } from './queue-executor-bridge';
export { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
export { MultiRepoQueuePersistence } from './multi-repo-queue-persistence';
export { QueuePersistence } from './queue/queue-persistence';
export { OutputPruner } from './output-pruner';
export { StaleTaskDetector } from './stale-task-detector';
export type { StaleTaskDetectorOptions } from './stale-task-detector';
export { TaskWatcher } from './task-watcher';
export type { TasksChangedCallback } from './task-watcher';
export { WorkflowWatcher } from './workflow-watcher';
export type { WorkflowsChangedCallback } from './workflow-watcher';
export { TemplateWatcher } from './template-watcher';
export type { TemplatesChangedCallback } from './template-watcher';
export { registerTemplateRoutes, registerTemplateWriteRoutes } from './templates-handler';
export { registerWorkflowRoutes, registerWorkflowWriteRoutes } from './workflows-handler';
export { registerWikiRoutes } from './wiki';
export type { WikiRouteOptions } from './wiki';
export { discoverPromptFiles, readPromptFileContent } from './prompt-utils';
export type { PromptFileInfo } from './prompt-utils';
export { registerPreferencesRoutes, readPreferences, writePreferences, validatePreferences } from './preferences-handler';
export type { UserPreferences } from './preferences-handler';
export { registerTaskCommentsRoutes, TaskCommentsManager } from './task-comments-handler';
export type { TaskComment, CommentAnchor, CommentsStorage } from './task-comments-handler';
export { registerDiffCommentsRoutes, DiffCommentsManager } from './diff-comments-handler';
export type { DiffCommentsStorage } from './diff-comments-handler';
export { registerAdminRoutes, resetWipeToken } from './admin-handler';
export type { AdminRouteOptions } from './admin-handler';
export { DataWiper } from './data-wiper';
export type { WipeOptions, WipeResult } from './data-wiper';
export { ScheduleYamlPersistence } from './schedule-yaml-persistence';
export { ScheduleRunPersistence } from './schedule-run-persistence';
export { ScheduleManager, parseCron, nextCronTime, describeCron } from './schedule-manager';
export type { ScheduleEntry, ScheduleRunRecord, ScheduleStatus, ScheduleOnFailure, ScheduleChangeEvent } from './schedule-manager';
export { registerScheduleRoutes } from './schedule-handler';
export { resolveTaskRoot, ensureTaskRoot } from './task-root-resolver';
export type { TaskRootInfo, TaskRootOptions } from './task-root-resolver';

// Additional exports needed by tests (previously from @plusplusoneplusplus/coc-server)
export type { ChatPayload } from './task-types';
export { isChatPayload, hasTaskGenerationContext } from './task-types';
export type { CoCExportPayload, ImportOptions } from './export-import-types';
export { EXPORT_SCHEMA_VERSION, validateExportPayload } from './export-import-types';
export { exportAllData } from './data-exporter';
export { importData } from './data-importer';
export { generateImportToken, generateWipeToken, importTokenManager, resetImportToken, wipeTokenManager, validateImportToken, validateWipeToken, TOKEN_EXPIRY_MS, TokenManager } from './admin-handler';
export { getRepoQueueFilePath, sanitizeTaskForPersistence } from './queue/queue-persistence';
export { ImageBlobStore } from './queue/image-blob-store';
export { stripExcludedFields } from './api-handler';
export type { ServeCommandOptions } from './types';
export { FileWatcher } from './wiki/file-watcher';
export { WikiData } from './wiki/wiki-data';
export type { ComponentAnalysis, ComponentGraph } from './wiki/types';
export { detectRemoteUrl, normalizeRemoteUrl } from './api-handler';
export { captureEntry, clearLogBuffer } from './server-log-capture';
export { getRepoDataPath } from './paths';
