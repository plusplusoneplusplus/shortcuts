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
import { ProcessWebSocketServer, toProcessSummary } from './streaming/websocket';
import { generateDashboardHtml } from './spa';
import { getBundleETag } from './spa/html-template';
import { generateIconSvg } from './spa/icon-template';
import type { ExecutionServerOptions, ExecutionServer, ServerCloseOptions } from './types';
import type { Route } from './types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getCopilotSDKService, modelMetadataStore } from '@plusplusoneplusplus/forge';
import { cleanupAllStalePasteFiles } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueRouter } from './queue/multi-repo-queue-router';
import { createQueueInfrastructure } from './infrastructure/queue-infrastructure';
import { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID } from './workspaces/global-workspace';
import { ensureMyWorkWorkspace } from './workspaces/my-work-workspace';
import { ensureMyLifeWorkspace } from './workspaces/my-life-workspace';
import { createScheduleInfrastructure } from './infrastructure/schedule-infrastructure';
import { createCleanupInfrastructure } from './infrastructure/cleanup-infrastructure';
import { createWebSocketInfrastructure } from './infrastructure/websocket-infrastructure';
import { createWatcherInfrastructure } from './infrastructure/watcher-infrastructure';
import { createTerminalInfrastructure } from './infrastructure/terminal-infrastructure';
import { HeapMonitor } from './admin/heap-monitor';
import { resolveConfig } from '../config';
import { DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/forge';
import { autoUpdateBundledSkills, autoInstallDefaultSkills } from '@plusplusoneplusplus/forge';
import { createStubStore } from './processes/in-memory-process-store';
import { createCLIAIInvoker } from '../ai-invoker';
import { shortenHostname } from './core/hostname-utils';
import { gitInfoCache } from './git/git-info-cache';
import { NotesGitTimerManager } from './notes/git/notes-git-timer-manager';
import { migrateWorkspaceRegistryIfNeeded } from './storage/startup-workspace-migration';
import { migrateProcessHistoryIfNeeded } from './storage/startup-process-migration';

// ============================================================================
// Close Handler Builder
// ============================================================================

interface CloseHandlerDeps {
    staleDetector: { dispose(): void };
    outputPruner: { stopListening(): void };
    heapMonitor: { dispose(): void };
    taskWatcher: { closeAll(): void };
    pipelineWatcher: { closeAll(): void };
    templateWatcher: { closeAll(): void };
    notesWatcher: { closeAll(): void };
    wikiManager: { disposeAll(): void } | undefined;
    scheduleManager: { dispose(): void };
    scheduleInfraDispose: () => void;
    notesGitTimerManager: NotesGitTimerManager;
    bridge: MultiRepoQueueRouter;
    queuePersistence: { dispose(): void };
    wsServer: ProcessWebSocketServer;
    terminalWsServer?: { closeAll(): void };
    terminalSessionManager?: { destroyAll(): void };
    activeSockets: Set<import('net').Socket>;
    server: http.Server;
}

function buildCloseHandler(deps: CloseHandlerDeps): (opts?: ServerCloseOptions) => Promise<{ drainOutcome?: 'completed' | 'timeout' }> {
    return async (closeOptions) => {
        const { staleDetector, outputPruner, taskWatcher, pipelineWatcher, templateWatcher, notesWatcher,
                wikiManager, scheduleManager, bridge, queuePersistence, wsServer, activeSockets, server } = deps;

        staleDetector.dispose();
        outputPruner.stopListening();
        deps.heapMonitor.dispose();
        taskWatcher.closeAll();
        pipelineWatcher.closeAll();
        templateWatcher.closeAll();
        notesWatcher.closeAll();
        wikiManager?.disposeAll();
        scheduleManager.dispose();
        deps.scheduleInfraDispose();
        gitInfoCache.dispose();
        deps.notesGitTimerManager.dispose();

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
        resolvedConfig.chat.followUpSuggestions, resolvedConfig.chat.askUser, () => wsServer,
        resolvedConfig.memoryPromotion,
    );
    const { scheduleManager, dispose: scheduleInfraDispose } = createScheduleInfrastructure(dataDir, queueFacade, store);

    // Cleanup infra is created after the store is ready
    let cleanupInfra: ReturnType<typeof createCleanupInfrastructure>;

    const heapMonitor = new HeapMonitor(resolvedConfig.monitoring.heapCheck);
    heapMonitor.start();

    // Auto-migrate legacy workspace/wiki registries from JSON to SQLite
    await migrateWorkspaceRegistryIfNeeded(dataDir, store);

    // Auto-migrate legacy file-based process histories to SQLite
    await migrateProcessHistoryIfNeeded(dataDir, store);

    // Auto-update stale globally-installed bundled skills (non-blocking on errors)
    if (resolvedConfig.skills.autoUpdate) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        autoUpdateBundledSkills(globalSkillsDir).then(result => {
            if (result.updated.length > 0) {
                for (const u of result.updated) {
                    process.stderr.write(`[skills] Auto-updated "${u.name}" ${u.previousVersion} → ${u.newVersion}\n`);
                }
            }
            for (const e of result.errors) {
                process.stderr.write(`[skills] Failed to update "${e.name}": ${e.error}\n`);
            }
        }).catch(() => { /* best-effort — never block startup */ });
    }

    // Auto-install default bundled skills into the global skills dir (non-blocking on errors)
    if (resolvedConfig.skills.defaultSkills.length > 0) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        autoInstallDefaultSkills(globalSkillsDir, resolvedConfig.skills.defaultSkills).then(result => {
            for (const name of result.installed) {
                process.stderr.write(`[skills] Auto-installed default skill "${name}"\n`);
            }
            for (const e of result.errors) {
                process.stderr.write(`[skills] Failed to install default skill "${e.name}": ${e.error}\n`);
            }
        }).catch(() => { /* best-effort — never block startup */ });
    }

    const globalWorkspace = await ensureGlobalWorkspace(dataDir, store);
    bridge.registerRepoId(globalWorkspace.id, globalWorkspace.rootPath);

    const myWorkWorkspace = await ensureMyWorkWorkspace(dataDir, store);
    bridge.registerRepoId(myWorkWorkspace.id, myWorkWorkspace.rootPath);

    const myLifeWorkspace = await ensureMyLifeWorkspace(dataDir, store);
    bridge.registerRepoId(myLifeWorkspace.id, myLifeWorkspace.rootPath);

    // Eagerly register all known workspaces with the schedule manager so repo
    // schedules start timers immediately — not lazily on first HTTP request.
    const allWorkspaces = await store.getWorkspaces();
    for (const ws of allWorkspaces) {
        scheduleManager.registerWorkspacePath(ws.id, ws.rootPath);
    }

    const resolvedAiService= options.aiService ?? getCopilotSDKService();
    const aiInvoker = createCLIAIInvoker({ approvePermissions: true });
    cleanupInfra = createCleanupInfrastructure(store, dataDir, queueFacade);
    const { outputPruner, staleDetector } = cleanupInfra;
    const notesGitTimerManager = new NotesGitTimerManager();
    const routes: Route[] = [];
    const { wikiManager } = registerAllRoutes(routes, {
        store, bridge, queueFacade, scheduleManager,
        notesGitTimerManager,
        dataDir, configPath: options.configPath,
        tokenTtlMs: options.tokenTtlMs,
        globalWorkspaceRootPath: globalWorkspace.rootPath,
        resolvedAiService, getWsServer: () => wsServer,
        queuePersistence, wikiOptions: options.wiki,
        aiInvoker,
        getTerminalSessionManager: () => terminalInfra?.terminalSessionManager,
        resolvedConfig,
    });
    // Restore auto-commit timers for all workspaces that had it enabled
    notesGitTimerManager.startAll(store, dataDir).catch(() => { /* best-effort */ });

    const rawHostname = os.hostname();
    const displayHostname = resolvedConfig.serve?.serverName || shortenHostname(rawHostname);
    const handler = createRequestHandler({
        routes, spaHtml: () => generateDashboardHtml({ enableWiki: true, hostname: displayHostname, terminalEnabled: resolvedConfig.terminal?.enabled ?? true, notesEnabled: resolvedConfig.notes?.enabled ?? true, myWorkEnabled: resolvedConfig.myWork?.enabled ?? false, myLifeEnabled: resolvedConfig.myLife?.enabled ?? false, scratchpadEnabled: resolvedConfig.scratchpad?.enabled ?? false, scratchpadLayout: resolvedConfig.scratchpad?.layout ?? 'horizontal', workflowsEnabled: resolvedConfig.workflows?.enabled ?? false, pullRequestsEnabled: resolvedConfig.pullRequests?.enabled ?? false }),
        store, spaETag: getBundleETag,
        staticDir: path.join(__dirname, 'spa', 'client', 'dist'),
        getIconSvg: () => generateIconSvg(rawHostname),
    });
    const server = http.createServer(handler);

    // Terminal infrastructure (optional — gated by config + node-pty availability)
    terminalInfra = createTerminalInfrastructure(store, resolvedConfig);

    wsServer = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager, terminalInfra?.terminalWsServer);
    const { taskWatcher, pipelineWatcher, templateWatcher, notesWatcher } =
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
            staleDetector, outputPruner, heapMonitor, taskWatcher, pipelineWatcher, templateWatcher, notesWatcher,
            wikiManager, scheduleManager, scheduleInfraDispose, notesGitTimerManager, bridge, queuePersistence, wsServer,
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
export { sendJSON, parseBody, parseQueryParams, stripExcludedFields } from './core/api-handler';
export { detectRemoteUrl, normalizeRemoteUrl } from './core/api-handler';

// WebSocket
export { ProcessWebSocketServer, toProcessSummary, toCommentSummary, attachWebSocketUpgradeHandler } from './streaming/websocket';
export type { WSClient, ProcessSummary, MarkdownCommentSummary, QueueTaskSummary, ServerMessage, ClientMessage, QueueSnapshot } from './streaming/websocket';

// Terminal
export { TerminalWebSocketServer } from './terminal/index';
export { TerminalSessionManager, toSessionInfo } from './terminal/index';
export type { TerminalSessionManagerOptions, IPty, TerminalSession, TerminalSessionInfo, TerminalClientMessage, TerminalServerMessage } from './terminal/index';
export { registerTerminalRoutes } from './terminal/terminal-routes';
export { createTerminalInfrastructure } from './infrastructure/terminal-infrastructure';
export type { TerminalInfrastructure } from './infrastructure/terminal-infrastructure';

// SSE
export { handleProcessStream } from './streaming/sse-handler';

// SPA
export { generateDashboardHtml } from './spa';
export type { DashboardOptions } from './spa';

// Global workspace
export { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID, GLOBAL_WORKSPACE_NAME } from './workspaces/global-workspace';

// Queue
export { CLITaskExecutor, createQueueExecutorBridge, defaultIsExclusive, DEFAULT_FOLLOW_UP_SUGGESTIONS } from './queue/queue-executor-bridge';
export type { QueueExecutorBridgeOptions, QueueExecutorBridge } from './queue/queue-executor-bridge';
export { ExecutorRegistry } from './executors/executor-registry';
export type { ExecutorRegistryOptions } from './executors/executor-registry';
export type { ITaskExecutor } from './executors/executor-types';
export { MultiRepoQueueRouter } from './queue/multi-repo-queue-router';
export { SqliteQueuePersistence } from './queue/sqlite-queue-persistence';
export type { RestartPolicy } from './queue/sqlite-queue-persistence';
export { ImageBlobStore } from './queue/image-blob-store';

// Data management
export { DataWiper } from './storage/data-wiper';
export type { WipeOptions, WipeResult } from './storage/data-wiper';
export { exportAllData } from './storage/data-exporter';
export { importData } from './storage/data-importer';
export type { CoCExportPayload, ImportOptions } from './storage/export-import-types';
export { EXPORT_SCHEMA_VERSION, validateExportPayload } from './storage/export-import-types';

// Admin & tokens
export { registerAdminRoutes, resetWipeToken, resetMigrateToken, resetDirectoryImportToken, getBuiltInPrompts } from './admin/admin-handler';
export type { AdminRouteOptions, BuiltInPrompt } from './admin/admin-handler';
export { generateImportToken, generateWipeToken, generateMigrateToken, importTokenManager, resetImportToken, wipeTokenManager, migrateTokenManager, directoryImportTokenManager, validateImportToken, validateMigrateToken, validateWipeToken, TOKEN_EXPIRY_MS, TokenManager } from './admin/admin-handler';

// Scheduling
export { ScheduleYamlPersistence } from './schedule/schedule-yaml-persistence';
export { SqliteScheduleRunPersistence } from './schedule/sqlite-schedule-run-persistence';
export { ScheduleManager, parseCron, nextCronTime, describeCron } from './schedule/schedule-manager';
export type { ScheduleEntry, ScheduleRunRecord, ScheduleStatus, ScheduleOnFailure, ScheduleChangeEvent } from './schedule/schedule-manager';

// Tasks
export type { ChatPayload } from './tasks/task-types';
export { isChatPayload, hasTaskGenerationContext } from './tasks/task-types';
export { resolveTaskRoot, ensureTaskRoot, resolveAllTaskRoots } from './tasks/task-root-resolver';
export type { TaskRootInfo, TaskRootOptions } from './tasks/task-root-resolver';
export { registerTaskCommentsRoutes, TaskCommentsManager } from './tasks/comments/task-comments-handler';
export type { TaskComment, CommentAnchor, CommentsStorage } from './tasks/comments/task-comments-handler';
export { registerDiffCommentsRoutes, DiffCommentsManager } from './tasks/comments/diff-comments-handler';
export type { DiffCommentsStorage } from './tasks/comments/diff-comments-handler';

// Preferences
export { registerPreferencesRoutes, readPreferences, writePreferences, validatePreferences } from './preferences-handler';
export type { UserPreferences } from './preferences-handler';

// Prompts
export { discoverPromptFiles, readPromptFileContent } from './prompts/prompt-utils';
export type { PromptFileInfo } from './prompts/prompt-utils';

// Wiki
export { registerWikiRoutes } from './wiki';
export type { WikiRouteOptions } from './wiki';
export { FileWatcher } from './wiki/file-watcher';
export { WikiData } from './wiki/wiki-data';
export type { ComponentAnalysis, ComponentGraph } from './wiki/types';

// Logging
export { captureEntry, clearLogBuffer } from './logging/server-log-capture';

// Paths
export { getRepoDataPath } from './paths';

// Heap monitoring
export { HeapMonitor, getHeapSnapshot, registerHeapRoutes } from './admin/heap-monitor';
export type { HeapSnapshot, HeapMonitorConfig } from './admin/heap-monitor';

// ============================================================================
// @internal — Infrastructure used by createExecutionServer; avoid in new code
// ============================================================================

/** @internal */ export { OutputPruner } from './processes/output-pruner';
/** @internal */ export { StaleTaskDetector } from './processes/stale-task-detector';
/** @internal */ export type { StaleTaskDetectorOptions } from './processes/stale-task-detector';
/** @internal */ export { TaskWatcher } from './tasks/task-watcher';
/** @internal */ export type { TasksChangedCallback } from './tasks/task-watcher';
/** @internal */ export { WorkflowWatcher } from './workflows/workflow-watcher';
/** @internal */ export type { WorkflowsChangedCallback } from './workflows/workflow-watcher';
/** @internal */ export { TemplateWatcher } from './templates/template-watcher';
/** @internal */ export type { TemplatesChangedCallback } from './templates/template-watcher';

// ============================================================================
// @internal — Route registration (called by registerAllRoutes only)
// ============================================================================

/** @internal */ export { registerApiRoutes } from './core/api-handler';
/** @internal */ export { registerProcessResumeRoutes, registerFreshChatTerminalRoutes } from './processes/process-resume-handler';
/** @internal */ export { registerQueueRoutes } from './queue/queue-handler';
/** @internal */ export { registerTaskRoutes, registerTaskWriteRoutes } from './tasks/tasks-handler';
/** @internal */ export { registerTaskGenerationRoutes } from './tasks/task-generation-handler';
/** @internal */ export { registerTemplateRoutes, registerTemplateWriteRoutes } from './templates/templates-handler';
/** @internal */ export { registerWorkflowRoutes, registerWorkflowWriteRoutes } from './workflows/workflows-handler';
/** @internal */ export { registerScheduleRoutes } from './schedule/schedule-handler';
/** @internal */ export { registerNotesGitAutoCommitRoutes } from './notes/git/notes-git-autocommit-handler';
/** @internal */ export { registerNotesEditsRoutes } from './notes/notes-edits-handler';
