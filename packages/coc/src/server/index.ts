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
import { sweepOrphanedRunningProcesses } from './processes/finalize-orphaned-turn';
import { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID } from './workspaces/global-workspace';
import { ensureMyWorkWorkspace } from './workspaces/my-work-workspace';
import { ensureMyLifeWorkspace } from './workspaces/my-life-workspace';
import { createScheduleInfrastructure } from './infrastructure/schedule-infrastructure';
import { createLoopInfrastructure } from './infrastructure/loop-infrastructure';
import { createMcpOauthInfrastructure } from './mcp-oauth';
import type { LoopInfrastructure } from './infrastructure/loop-infrastructure';
import { createCleanupInfrastructure } from './infrastructure/cleanup-infrastructure';
import { createWebSocketInfrastructure } from './infrastructure/websocket-infrastructure';
import { createWatcherInfrastructure } from './infrastructure/watcher-infrastructure';
import { createTerminalInfrastructure } from './infrastructure/terminal-infrastructure';
import { HeapMonitor } from './admin/heap-monitor';
import { RuntimeConfigService } from '../config/runtime-config-service';
import { DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/forge';
import { autoUpdateBundledSkills, autoInstallDefaultSkills, autoInstallMyWorkSkills, DEFAULT_SKILLS_SETTINGS } from '@plusplusoneplusplus/forge';
import { createStubStore } from './processes/in-memory-process-store';
import { createCLIAIInvoker } from '../ai-invoker';
import { shortenHostname } from './core/hostname-utils';
import { gitInfoCache } from './git/git-info-cache';
import { NotesGitTimerManager } from './notes/git/notes-git-timer-manager';
import { migrateWorkspaceRegistryIfNeeded } from './storage/startup-workspace-migration';
import { migrateProcessHistoryIfNeeded } from './storage/startup-process-migration';
import { DevTunnelConnector } from './servers/devtunnel-connector';
import { RemoteServerStore } from './servers/remote-server-store';
import { AutoPromoteScheduler } from './memory/auto-promote';
import { setMemoryCandidateCapturedCallback } from './executors/bounded-memory-addon';
import { pruneAllStaleClassifications } from './repos/classification-store';

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
    remoteServerConnector: { dispose(): void };
    autoPromoteScheduler?: { dispose(): void };
    loopExecutor?: { shutdownAll(): void };
    loopInfraDispose?: () => void;
    mcpOauthDispose?: () => void;
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
        deps.loopExecutor?.shutdownAll();
        deps.loopInfraDispose?.();
        deps.mcpOauthDispose?.();
        gitInfoCache.dispose();
        deps.notesGitTimerManager.dispose();
        deps.autoPromoteScheduler?.dispose();
        setMemoryCandidateCapturedCallback(undefined);

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
        deps.remoteServerConnector.dispose();
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
    const host = options.host ?? '127.0.0.1';
    const dataDir = options.dataDir ?? path.join(os.homedir(), '.coc');
    const store = options.store ?? createStubStore();
    fs.mkdirSync(dataDir, { recursive: true });

    const runtimeConfigService = new RuntimeConfigService({ configPath: options.configPath, fileConfig: options.fileConfig });

    // Startup-captured config snapshot. Consumers below that use this directly
    // are infrastructure that wires once at startup. Admin-editable fields among
    // them are classified as follows:
    //
    //   restartRequired (infrastructure wired at startup):
    //     - terminal.enabled   → terminal pty/session manager
    //     - loops.enabled      → loop executor, timer registry
    //
    //   Live but still startup-captured in queue infrastructure (future migration):
    //     - timeout            → defaultTimeoutMs passed to queue infra
    //     - chat.followUpSuggestions, chat.askUser → queue executor behavior
    //
    //   Non-admin-editable (no migration needed):
    //     - mcpOauth.enabled   → MCP OAuth infra
    //     - monitoring.heapCheck → heap monitor
    //     - skills.autoUpdate, skills.defaultSkills → startup skill install
    //     - features.autoMemoryPromotion → auto-promote scheduler
    //
    // Route handlers and SPA feature flags use runtimeConfigService for live
    // reads (see registerAllRoutes and spaHtml closure below).
    const resolvedConfig = runtimeConfigService.config;
    const defaultTimeoutMs = resolvedConfig.timeout ? resolvedConfig.timeout * 1000 : DEFAULT_AI_TIMEOUT_MS;

    // Forward declaration — bridge captures this via closure before wsServer is assigned
    let wsServer!: ProcessWebSocketServer;

    // Forward declaration — terminal infra is created after the HTTP server
    let terminalInfra: import('./infrastructure/terminal-infrastructure').TerminalInfrastructure | undefined;

    // Forward declaration — loop infra is created after queue infra
    let loopInfra: LoopInfrastructure | undefined;

    // MCP OAuth infra — enabled by default when any MCP server may be configured.
    const mcpOauthEnabled = resolvedConfig.mcpOauth?.enabled ?? true;
    const mcpOauthInfra = mcpOauthEnabled ? createMcpOauthInfrastructure() : undefined;

    const { registry, bridge, queuePersistence, queueFacade } = createQueueInfrastructure(
        store, dataDir, options, defaultTimeoutMs,
        resolvedConfig.chat.followUpSuggestions, resolvedConfig.chat.askUser, () => wsServer,
        resolvedConfig.memoryPromotion,
        () => {
            if (!loopInfra) return undefined;
            return {
                store: loopInfra.loopStore,
                executor: loopInfra.loopExecutor,
                emit: loopInfra.emit,
                resolveWorkspaceId: async (processId: string) => {
                    try {
                        const taskId = processId.startsWith('queue_') ? processId.slice(6) : processId;
                        const task = bridge.getTask(taskId);
                        return task?.repoId;
                    } catch { return undefined; }
                },
                enqueueWakeup: (opts) => {
                    loopInfra!.timerRegistry.set(
                        `wakeup:${opts.wakeupId}`,
                        () => {
                            const turnSource = { source: 'wakeup' as const, wakeupId: opts.wakeupId };
                            void (async () => {
                                try {
                                    const { resolveFollowUpMode } = await import('./executors/follow-up-mode');
                                    const mode = await resolveFollowUpMode(store, opts.processId);
                                    await bridge.executeFollowUp(
                                        opts.processId,
                                        opts.prompt,
                                        undefined,
                                        mode,
                                        undefined,
                                        undefined,
                                        undefined,
                                        opts.model,
                                        turnSource,
                                    );
                                } catch (err) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    process.stderr.write(`[Wakeup] Failed to execute wakeup ${opts.wakeupId}: ${msg}\n`);
                                }
                            })();
                        },
                        opts.delayMs,
                    );
                },
            };
        },
        () => mcpOauthInfra?.manager,
    );

    // Finalize any orphaned 'running' / 'cancelling' processes left behind by
    // an unclean shutdown. The queue restart policy assigns NEW process IDs
    // to any re-enqueued work, so every pre-existing in-flight process row
    // is definitionally orphaned and must be marked failed/cancelled before
    // we accept any client requests.
    try {
        const orphanCount = await sweepOrphanedRunningProcesses(store, {
            error: 'Process orphaned by server restart',
        });
        if (orphanCount > 0) {
            process.stderr.write(
                `[ExecutionServer] Finalized ${orphanCount} orphaned in-flight process(es) on startup\n`,
            );
        }
    } catch {
        // Non-fatal — startup must not be blocked by sweep failures.
    }

    const { scheduleManager, dispose: scheduleInfraDispose } = createScheduleInfrastructure(dataDir, queueFacade, store);

    const loopsEnabled = resolvedConfig.loops?.enabled ?? false;

    // Loop infrastructure — separate from schedules. Gated by loops.enabled feature flag (default false).
    if (loopsEnabled) {
        loopInfra = await createLoopInfrastructure({
            dataDir,
            queueFacade,
            store,
            emit: (event) => {
                try {
                    wsServer?.broadcastProcessEvent({
                        type: event.type,
                        loopId: event.loop.id,
                        processId: event.loop.processId,
                        status: event.loop.status,
                        workspaceId: event.loop.workspaceId,
                        timestamp: Date.now(),
                    });
                } catch { /* best-effort broadcast */ }
            },
            resolveWorkspaceId: async (processId: string) => {
                try {
                    const taskId = processId.startsWith('queue_') ? processId.slice(6) : processId;
                    const task = bridge.getTask(taskId);
                    return task?.repoId;
                } catch {
                    return undefined;
                }
            },
        });
    }

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

    // Auto-install default bundled skills into the global skills dir (non-blocking on errors).
    // When loops feature is disabled, strip the `loop` skill so its prompt suffix doesn't
    // leak into sessions where the underlying tools aren't wired.
    const defaultSkillsToInstall = loopsEnabled
        ? resolvedConfig.skills.defaultSkills
        : resolvedConfig.skills.defaultSkills.filter(name => name !== 'loop');
    if (defaultSkillsToInstall.length > 0) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        autoInstallDefaultSkills(globalSkillsDir, defaultSkillsToInstall).then(result => {
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
    const myWorkSkillsDir = path.join(myWorkWorkspace.rootPath, DEFAULT_SKILLS_SETTINGS.installPath);
    autoInstallMyWorkSkills(myWorkSkillsDir).then(result => {
        for (const name of result.installed) {
            process.stderr.write(`[skills] Auto-installed My Work skill "${name}"\n`);
        }
        for (const e of result.errors) {
            process.stderr.write(`[skills] Failed to install My Work skill "${e.name}": ${e.error}\n`);
        }
    }).catch(() => { /* best-effort — never block startup */ });
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
    const remoteServerStore = new RemoteServerStore(dataDir);
    const remoteServerConnector = new DevTunnelConnector();
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
        runtimeConfigService,
        remoteServerStore,
        remoteServerConnector,
        loopStore: loopInfra?.loopStore,
        loopExecutor: loopInfra?.loopExecutor,
        mcpOauthManager: mcpOauthInfra?.manager,
        loopEmit: loopInfra?.emit,
        hostname: os.hostname(),
        bindAddress: host,
    });
    // Restore auto-commit timers for all workspaces that had it enabled
    notesGitTimerManager.startAll(store, dataDir).catch(() => { /* best-effort */ });

    const rawHostname = os.hostname();
    const handler = createRequestHandler({
        routes, spaHtml: () => {
            // Use RuntimeConfigService snapshot for feature flags so admin
            // config updates are reflected without re-reading disk on every
            // page load. The SPA also fetches /api/config/runtime for fresh
            // feature flags, making the embedded values bootstrap-only.
            const liveConfig = runtimeConfigService.config;
            return generateDashboardHtml({
                enableWiki: true,
                hostname: liveConfig.serve?.serverName || shortenHostname(rawHostname),
                terminalEnabled: liveConfig.terminal?.enabled ?? true,
                notesEnabled: liveConfig.notes?.enabled ?? true,
                myWorkEnabled: liveConfig.myWork?.enabled ?? false,
                myLifeEnabled: liveConfig.myLife?.enabled ?? false,
                scratchpadEnabled: liveConfig.scratchpad?.enabled ?? false,
                scratchpadLayout: liveConfig.scratchpad?.layout ?? 'horizontal',
                workflowsEnabled: liveConfig.workflows?.enabled ?? false,
                pullRequestsEnabled: liveConfig.pullRequests?.enabled ?? false,
                serversEnabled: liveConfig.servers?.enabled ?? false,
                ralphEnabled: liveConfig.ralph?.enabled ?? false,
                vimNavigationEnabled: liveConfig.vimNavigation?.enabled ?? false,
                loopsEnabled: liveConfig.loops?.enabled ?? false,
                excalidrawEnabled: liveConfig.excalidraw?.enabled ?? false,
                mcpOauthEnabled: liveConfig.mcpOauth?.enabled ?? false,
                focusedDiffEnabled: liveConfig.features?.focusedDiff ?? false,
                bindAddress: host,
            });
        },
        store, spaETag: () => getBundleETag(runtimeConfigService.revision),
        staticDir: path.join(__dirname, 'spa', 'client', 'dist'),
        getIconSvg: () => generateIconSvg(rawHostname),
    });
    const server = http.createServer(handler);

    // Terminal infrastructure (optional — gated by config + node-pty availability)
    terminalInfra = createTerminalInfrastructure(store, resolvedConfig);

    wsServer = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager, terminalInfra?.terminalWsServer);
    const autoPromoteScheduler = new AutoPromoteScheduler({
        dataDir,
        queueManager: queueFacade,
        scheduleManager,
        enabled: resolvedConfig.features.autoMemoryPromotion,
        wsServer,
    });
    autoPromoteScheduler.start(allWorkspaces.map(workspace => workspace.id));
    setMemoryCandidateCapturedCallback(event => autoPromoteScheduler.handleCandidateCaptured(event));
    const { taskWatcher, pipelineWatcher, templateWatcher, notesWatcher } =
        await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

    try {
        await modelMetadataStore.initialize(resolvedAiService);
    } catch (err) {
        process.stderr.write(`[ModelMetadataStore] warm-up failed: ${(err as Error)?.message ?? err}\n`);
    }

    await new Promise<void>((resolve, reject) => { server.on('error', reject); server.listen(port, host, resolve); });
    try {
        void remoteServerConnector.connectConfigured(remoteServerStore.list());
    } catch (error) {
        process.stderr.write(`[servers] Failed to start DevTunnel connectors: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    cleanupAllStalePasteFiles(dataDir).catch(() => { /* best-effort */ });
    try {
        pruneAllStaleClassifications(dataDir);
    } catch {
        /* best-effort */
    }

    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const displayHost = host === '0.0.0.0' || host === '::' || host === '127.0.0.1' ? 'localhost' : host;
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
            remoteServerConnector,
            autoPromoteScheduler,
            loopExecutor: loopInfra?.loopExecutor,
            loopInfraDispose: loopInfra?.dispose,
            mcpOauthDispose: mcpOauthInfra?.dispose,
            activeSockets, server,
        }),
    };
}

// ============================================================================
// Public API
// ============================================================================

export type { ExecutionServerOptions, ExecutionServer, Route, WikiServerOptions, ServerCloseOptions, ServeCommandOptions } from './types';
export type { ProcessStore } from '@plusplusoneplusplus/forge';

// Runtime Config Service
export { RuntimeConfigService } from '../config/runtime-config-service';
export type { RuntimeConfigSnapshot, RuntimeConfigUpdateResult, ConfigChangeEffect, ConfigFieldRuntime, ConfigChangeListener } from '../config/runtime-config-service';

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

// Loops
export { LoopStore, LoopExecutor, registerLoopRoutes } from './loops';
export type { LoopEntry, LoopStatus, LoopChangeEvent, LoopEventEmit, LoopExecutorDeps, LoopRouteContext } from './loops';
export { createLoopInfrastructure } from './infrastructure/loop-infrastructure';
export type { LoopInfrastructure, LoopInfrastructureOptions } from './infrastructure/loop-infrastructure';

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
