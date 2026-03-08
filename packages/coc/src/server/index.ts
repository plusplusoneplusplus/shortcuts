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
import { createRequestHandler } from '@plusplusoneplusplus/coc-server';
import { registerApiRoutes } from '@plusplusoneplusplus/coc-server';
import { registerQueueRoutes } from './queue-handler';
import { registerTaskRoutes, registerTaskWriteRoutes } from './tasks-handler';
import { registerTaskGenerationRoutes } from './task-generation-handler';
import { resolveTaskRoot } from './task-root-resolver';
import { registerPromptRoutes } from './prompt-handler';
import { registerPreferencesRoutes } from './preferences-handler';
import { registerAdminRoutes } from './admin-handler';
import { registerTaskCommentsRoutes } from './task-comments-handler';
import { registerDiffCommentsRoutes } from './diff-comments-handler';
import { registerWikiRoutes } from './wiki';
import { registerMemoryRoutes, registerRepoRoutes } from '@plusplusoneplusplus/coc-server';
import { registerProcessResumeRoutes, registerFreshChatTerminalRoutes } from './process-resume-handler';
import { registerWorkflowRoutes, registerWorkflowWriteRoutes } from './workflows-handler';
import { registerTemplateRoutes, registerTemplateWriteRoutes } from './templates-handler';
import { registerReplicateApplyRoutes } from './replicate-apply-handler';
import { TemplateWatcher } from './template-watcher';
import { WorkflowWatcher } from './workflow-watcher';
import { ProcessWebSocketServer, toProcessSummary } from '@plusplusoneplusplus/coc-server';
import { generateDashboardHtml } from './spa';
import { getBundleETag } from './spa/html-template';
import type { ExecutionServerOptions, ExecutionServer } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import type { ProcessStore, AIProcess, ProcessChangeCallback, ProcessOutputEvent } from '@plusplusoneplusplus/pipeline-core';
import { RepoQueueRegistry, FileProcessStore, getCopilotSDKService } from '@plusplusoneplusplus/pipeline-core';
import { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
import { MultiRepoQueuePersistence } from './multi-repo-queue-persistence';
import { computeRepoId } from './queue-persistence';
import { isMigrationNeeded, migrateTasksToRepoScoped } from './task-migration';
import { defaultIsExclusive } from './queue-executor-bridge';
import { SchedulePersistence } from './schedule-persistence';
import { ScheduleManager } from './schedule-manager';
import { registerScheduleRoutes } from './schedule-handler';
import { OutputPruner } from './output-pruner';
import { StaleTaskDetector } from './stale-task-detector';
import { TaskWatcher } from './task-watcher';
import { resolveConfig } from '../config';
import { DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/pipeline-core';
import { createCLIAIInvoker } from '../ai-invoker';

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

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    // Create per-repo queue infrastructure
    const registry = new RepoQueueRegistry({
        maxQueueSize: 0,  // unlimited
        keepHistory: true,
        maxHistorySize: options.queue?.historyLimit ?? 100,
        isExclusive: defaultIsExclusive,
    });

    // Resolve config to derive default timeout for AI tasks
    const resolvedConfig = resolveConfig(options.configPath);
    const defaultTimeoutMs = resolvedConfig.timeout
        ? resolvedConfig.timeout * 1000
        : DEFAULT_AI_TIMEOUT_MS;

    const bridge = new MultiRepoQueueExecutorBridge(registry, store, {
        autoStart: true,
        approvePermissions: true,
        dataDir,
        aiService: options.aiService,
        defaultTimeoutMs,
        followUpSuggestions: resolvedConfig.chat.followUpSuggestions,
        getWsServer: () => wsServer,
    });

    // Restore persisted queue state before executor starts processing
    const queuePersistence = new MultiRepoQueuePersistence(bridge, dataDir, {
        restartPolicy: options.queue?.restartPolicy,
        maxPersistedHistory: options.queue?.historyLimit,
    });
    queuePersistence.restore();

    // Create aggregate facade for queue routes
    const queueFacade = bridge.createAggregateFacade();

    // Initialize schedule manager with persistent storage
    const schedulePersistence = new SchedulePersistence(dataDir);
    const scheduleManager = new ScheduleManager(schedulePersistence, queueFacade);
    scheduleManager.restore();

    // Wire up output file pruner for automatic cleanup
    const outputPruner = new OutputPruner(store, dataDir);

    // Wire prune hook so pruned entries trigger output file deletion
    if (store instanceof FileProcessStore) {
        store.onPrune = (entries) => outputPruner.handlePrunedEntries(entries);
    }

    // StaleTaskDetector: use aggregate facade to scan all per-repo managers
    const staleDetector = new StaleTaskDetector(queueFacade, store);
    staleDetector.start();

    // Start event-driven output cleanup and run initial orphan scan
    outputPruner.startListening();
    outputPruner.cleanupOrphans().catch(() => {});
    outputPruner.cleanupStaleQueueEntries().catch(() => {});

    const spaHtmlFactory = () => generateDashboardHtml({ enableWiki: true });

    const resolvedAiService = options.aiService ?? getCopilotSDKService();

    // Build API routes
    const routes: Route[] = [];
    registerApiRoutes(routes, store, bridge, dataDir, () => wsServer);
    registerRepoRoutes(routes, dataDir);
    registerProcessResumeRoutes(routes, store);
    registerFreshChatTerminalRoutes(routes);
    // Queue routes now receive the bridge directly for per-repo routing
    registerQueueRoutes(routes, bridge, store);
    registerTaskRoutes(routes, store, dataDir);
    registerTaskWriteRoutes(routes, store, dataDir);
    registerWorkflowRoutes(routes, store);
    registerWorkflowWriteRoutes(routes, store, (workspaceId) => {
        wsServer.broadcastProcessEvent({
            type: 'workflows-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    }, bridge, resolvedAiService);
    registerTaskGenerationRoutes(routes, store, bridge, resolvedAiService, dataDir);
    // Template read routes
    registerTemplateRoutes(routes, store);
    // Template write routes with WebSocket broadcast
    registerTemplateWriteRoutes(routes, store, (workspaceId) => {
        wsServer.broadcastProcessEvent({
            type: 'templates-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    });
    registerReplicateApplyRoutes(routes, store);
    registerPromptRoutes(routes, store);
    registerPreferencesRoutes(routes, dataDir);
    registerTaskCommentsRoutes(routes, dataDir, bridge, store, () => wsServer);
    registerDiffCommentsRoutes(routes, dataDir, bridge, store, () => wsServer);
    registerAdminRoutes(routes, { store, dataDir, getWsServer: () => wsServer, configPath: options.configPath, getQueueManager: () => queueFacade, getQueuePersistence: () => queuePersistence });
    registerScheduleRoutes(routes, scheduleManager);

    // Register memory routes
    registerMemoryRoutes(routes, dataDir, {
        aggregateToolCallsAIInvoker: createCLIAIInvoker({ approvePermissions: true }),
    });

    // Always register wiki routes(they are safe even with no wikis registered)
    const wikiManager = registerWikiRoutes(routes, {
        wikis: options.wiki?.wikis,
        aiEnabled: options.wiki?.aiEnabled,
        dataDir,
        store,
        onWikiRebuilding: (wikiId, affectedComponentIds) => {
            wsServer.broadcastWikiEvent({
                type: 'wiki-rebuilding',
                wikiId,
                components: affectedComponentIds,
            });
        },
        onWikiReloaded: (wikiId, affectedComponentIds) => {
            wsServer.broadcastWikiEvent({
                type: 'wiki-reload',
                wikiId,
                components: affectedComponentIds,
            });
        },
        onWikiError: (wikiId, error) => {
            wsServer.broadcastWikiEvent({
                type: 'wiki-error',
                wikiId,
                message: error.message,
            });
        },
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

    // Attach WebSocket server and bridge ProcessStore events
    const wsServer = new ProcessWebSocketServer();
    wsServer.attach(server);

    // Wire drain events from multi-repo bridge to WebSocket
    bridge.on('drain-start', (event: { queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-start', queued: event.queued, running: event.running });
    });
    bridge.on('drain-progress', (event: { queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-progress', queued: event.queued, running: event.running });
    });
    bridge.on('drain-complete', (event: { outcome: 'completed'; queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-complete', outcome: event.outcome, queued: event.queued, running: event.running });
    });
    bridge.on('drain-timeout', (event: { queued: number; running: number; timeoutMs?: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-timeout', queued: event.queued, running: event.running, timeoutMs: event.timeoutMs });
    });

    store.onProcessChange = (event) => {
        switch (event.type) {
            case 'process-added':
                if (event.process) {
                    wsServer.broadcastProcessEvent({
                        type: 'process-added',
                        process: toProcessSummary(event.process),
                    });
                }
                break;
            case 'process-updated':
                if (event.process) {
                    wsServer.broadcastProcessEvent({
                        type: 'process-updated',
                        process: toProcessSummary(event.process),
                    });
                }
                break;
            case 'process-removed':
                if (event.process) {
                    wsServer.broadcastProcessEvent({
                        type: 'process-removed',
                        processId: event.process.id,
                    });
                }
                break;
            case 'processes-cleared':
                wsServer.broadcastProcessEvent({
                    type: 'processes-cleared',
                    count: 0,
                });
                break;
        }
    };

    // Helper to map task arrays to WS-friendly summaries
    const mapQueued = (t: any) => ({
        id: t.id, repoId: t.repoId, type: t.type, priority: t.priority,
        status: t.status, displayName: t.displayName, createdAt: t.createdAt,
        workingDirectory: (t.payload as any)?.workingDirectory,
        payload: {
            planFilePath: (t.payload as any)?.planFilePath,
            filePath: (t.payload as any)?.filePath,
            workingDirectory: (t.payload as any)?.workingDirectory,
            data: (t.payload as any)?.data ? {
                originalTaskPath: (t.payload as any)?.data?.originalTaskPath,
            } : undefined,
        },
    });
    const mapRunning = (t: any) => ({
        ...mapQueued(t), startedAt: t.startedAt,
    });
    const mapHistory = (t: any) => ({
        ...mapRunning(t), completedAt: t.completedAt, error: t.error,
    });

    // Bridge queue change events from all repos to WebSocket
    bridge.on('queueChange', (event: { repoPath: string; repoId: string; type: string; taskId?: string }) => {
        // 1) Per-repo scoped broadcast
        const repoManager = registry.getQueueForRepo(event.repoPath);
        const repoStats = repoManager.getStats();
        wsServer.broadcastProcessEvent({
            type: 'queue-updated',
            queue: {
                repoId: event.repoId,
                queued: repoManager.getQueued().map(mapQueued),
                running: repoManager.getRunning().map(mapRunning),
                history: repoManager.getHistory().map(mapHistory),
                stats: repoStats,
            },
        } as any);

        // 2) Global aggregate broadcast (no repoId) for top-level stats badge
        const allQueued: any[] = [];
        const allRunning: any[] = [];
        const allHistory: any[] = [];
        const combinedStats = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0, isPaused: false, isDraining: false };
        let allPaused = true;
        let anyManager = false;
        let anyDraining = false;

        for (const [, manager] of registry.getAllQueues()) {
            allQueued.push(...manager.getQueued());
            allRunning.push(...manager.getRunning());
            allHistory.push(...manager.getHistory());
            const s = manager.getStats();
            combinedStats.queued += s.queued;
            combinedStats.running += s.running;
            combinedStats.completed += s.completed;
            combinedStats.failed += s.failed;
            combinedStats.cancelled += s.cancelled;
            combinedStats.total += s.total;
            if (!s.isPaused) { allPaused = false; }
            if (s.isDraining) { anyDraining = true; }
            anyManager = true;
        }
        combinedStats.isPaused = anyManager && allPaused;
        combinedStats.isDraining = anyDraining;

        // Debug: log queue state changes
        const taskInfo = event.taskId ? ` task=${event.taskId}` : '';
        process.stderr.write(`[Queue] ${event.type}${taskInfo} — queued=${combinedStats.queued} running=${combinedStats.running} completed=${combinedStats.completed} failed=${combinedStats.failed} ws_clients=${wsServer.clientCount}\n`);

        wsServer.broadcastProcessEvent({
            type: 'queue-updated',
            queue: {
                queued: allQueued.map(mapQueued),
                running: allRunning.map(mapRunning),
                history: allHistory.map(mapHistory),
                stats: combinedStats,
            },
        } as any);
    });

    // Bridge schedule change events to WebSocket
    scheduleManager.on('change', (event: any) => {
        wsServer.broadcastProcessEvent({
            type: event.type,
            repoId: event.repoId,
            scheduleId: event.scheduleId,
            schedule: event.schedule,
            run: event.run,
        } as any);
    });

    // Bridge task file changes to WebSocket
    const taskWatcher = new TaskWatcher((workspaceId) => {
        wsServer.broadcastProcessEvent({
            type: 'tasks-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    });

    // Bridge workflow file changes to WebSocket
    const pipelineWatcher = new WorkflowWatcher((workspaceId) => {
        wsServer.broadcastProcessEvent({
            type: 'workflows-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    });

    // Bridge template file changes to WebSocket
    const templateWatcher = new TemplateWatcher((workspaceId) => {
        wsServer.broadcastProcessEvent({
            type: 'templates-changed',
            workspaceId,
            timestamp: Date.now(),
        });
    });

    // Watch tasks and workflows directories for already-registered workspaces (handles server restart)
    const existingWorkspaces = await store.getWorkspaces();

    // Migrate hash-based storage paths to workspace-ID-based paths
    for (const ws of existingWorkspaces) {
        const oldRepoId = computeRepoId(ws.rootPath);
        const newRepoId = ws.id;
        if (oldRepoId === newRepoId) continue;

        // Migrate repos/ folder
        const oldRepoDir = path.join(dataDir, 'repos', oldRepoId);
        const newRepoDir = path.join(dataDir, 'repos', newRepoId);
        if (fs.existsSync(oldRepoDir) && !fs.existsSync(newRepoDir)) {
            try {
                fs.renameSync(oldRepoDir, newRepoDir);
                process.stderr.write(`[Migration] repos/${oldRepoId} → repos/${newRepoId}\n`);
            } catch (err) {
                process.stderr.write(`[Migration] Failed to rename repos dir: ${err}\n`);
            }
        }

        // Migrate queue file
        const oldQueueFile = path.join(dataDir, 'queues', `repo-${oldRepoId}.json`);
        const newQueueFile = path.join(dataDir, 'queues', `repo-${newRepoId}.json`);
        if (fs.existsSync(oldQueueFile) && !fs.existsSync(newQueueFile)) {
            try {
                fs.renameSync(oldQueueFile, newQueueFile);
                process.stderr.write(`[Migration] queues/repo-${oldRepoId}.json → repo-${newRepoId}.json\n`);
            } catch (err) {
                process.stderr.write(`[Migration] Failed to rename queue file: ${err}\n`);
            }
        }

        // Migrate schedule file
        const oldSchedFile = path.join(dataDir, 'schedules', `repo-${oldRepoId}.json`);
        const newSchedFile = path.join(dataDir, 'schedules', `repo-${newRepoId}.json`);
        if (fs.existsSync(oldSchedFile) && !fs.existsSync(newSchedFile)) {
            try {
                fs.renameSync(oldSchedFile, newSchedFile);
                process.stderr.write(`[Migration] schedules/repo-${oldRepoId}.json → repo-${newRepoId}.json\n`);
            } catch (err) {
                process.stderr.write(`[Migration] Failed to rename schedule file: ${err}\n`);
            }
        }
    }

    for (const ws of existingWorkspaces) {
        if (isMigrationNeeded(ws.rootPath, ws.id, dataDir)) {
            const migResult = await migrateTasksToRepoScoped({
                workspaceRoot: ws.rootPath, workspaceId: ws.id, dataDir,
            });
            if (migResult.migrated) {
                process.stderr.write(`[TaskMigration] ${migResult.fileCount} files: ${ws.rootPath}\n`);
            }
        }
        taskWatcher.watchWorkspace(ws.id, resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath);
        pipelineWatcher.watchWorkspace(ws.id, ws.rootPath);
        templateWatcher.watchWorkspace(ws.id, ws.rootPath);
        // Register workspace ID so bridge.getBridgeByRepoId() works for pre-existing workspaces
        bridge.registerRepoId(ws.id, ws.rootPath);
    }

    // Intercept workspace registration/removal to manage task watchers
    const originalRegister = store.registerWorkspace!.bind(store);
    const originalRemove = store.removeWorkspace!.bind(store);

    store.registerWorkspace = async (workspace: any) => {
        await originalRegister(workspace);
        if (isMigrationNeeded(workspace.rootPath, workspace.id, dataDir)) {
            const migResult = await migrateTasksToRepoScoped({
                workspaceRoot: workspace.rootPath, workspaceId: workspace.id, dataDir,
            });
            if (migResult.migrated) {
                process.stderr.write(`[TaskMigration] ${migResult.fileCount} files: ${workspace.rootPath}\n`);
            }
        }
        taskWatcher.watchWorkspace(workspace.id, resolveTaskRoot({ dataDir, rootPath: workspace.rootPath, workspaceId: workspace.id }).absolutePath);
        pipelineWatcher.watchWorkspace(workspace.id, workspace.rootPath);
        templateWatcher.watchWorkspace(workspace.id, workspace.rootPath);
        bridge.registerRepoId(workspace.id, workspace.rootPath);
    };

    store.removeWorkspace = async (id: string) => {
        taskWatcher.unwatchWorkspace(id);
        pipelineWatcher.unwatchWorkspace(id);
        templateWatcher.unwatchWorkspace(id);
        return originalRemove(id);
    };

    // Start listening
    await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, host, () => resolve());
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
        close: async (closeOptions?: import('@plusplusoneplusplus/coc-server').ServerCloseOptions) => {
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
export type { ExecutionServerOptions, ExecutionServer, Route, WikiServerOptions, ServerCloseOptions } from '@plusplusoneplusplus/coc-server';
export type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
export { sendJson, send404, send400, send500, readJsonBody, createRequestHandler } from '@plusplusoneplusplus/coc-server';
export { registerApiRoutes, sendJSON, sendError, parseBody, parseQueryParams } from '@plusplusoneplusplus/coc-server';
export { registerProcessResumeRoutes, registerFreshChatTerminalRoutes } from './process-resume-handler';
export { registerQueueRoutes } from './queue-handler';
export { registerTaskRoutes, registerTaskWriteRoutes } from './tasks-handler';
export { registerTaskGenerationRoutes } from './task-generation-handler';
export { handleProcessStream } from '@plusplusoneplusplus/coc-server';
export { ProcessWebSocketServer, toProcessSummary, toCommentSummary } from '@plusplusoneplusplus/coc-server';
export type { WSClient, ProcessSummary, MarkdownCommentSummary, QueueTaskSummary, QueueHistoryTaskSummary, ServerMessage, ClientMessage } from '@plusplusoneplusplus/coc-server';
export type { WSQueueSnapshot as QueueSnapshot } from '@plusplusoneplusplus/coc-server';
export type { RouterOptions } from '@plusplusoneplusplus/coc-server';
export { generateDashboardHtml } from './spa';
export type { DashboardOptions } from './spa';
export { CLITaskExecutor, createQueueExecutorBridge, defaultIsExclusive } from './queue-executor-bridge';
export type { QueueExecutorBridgeOptions, QueueExecutorBridge } from './queue-executor-bridge';
export { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';
export { MultiRepoQueuePersistence } from './multi-repo-queue-persistence';
export { QueuePersistence } from './queue-persistence';
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
export { SchedulePersistence, getRepoScheduleFilePath } from './schedule-persistence';
export type { PersistedScheduleState } from './schedule-persistence';
export { ScheduleManager, parseCron, nextCronTime, describeCron } from './schedule-manager';
export type { ScheduleEntry, ScheduleRunRecord, ScheduleStatus, ScheduleOnFailure, ScheduleChangeEvent } from './schedule-manager';
export { registerScheduleRoutes } from './schedule-handler';
export { resolveTaskRoot, ensureTaskRoot } from './task-root-resolver';
export type { TaskRootInfo, TaskRootOptions } from './task-root-resolver';
