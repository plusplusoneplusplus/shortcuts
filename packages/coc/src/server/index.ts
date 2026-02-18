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
import { registerPromptRoutes } from './prompt-handler';
import { registerPreferencesRoutes } from './preferences-handler';
import { registerAdminRoutes } from './admin-handler';
import { registerTaskCommentsRoutes } from './task-comments-handler';
import { registerWikiRoutes } from './wiki';
import { ProcessWebSocketServer, toProcessSummary } from '@plusplusoneplusplus/coc-server';
import { generateDashboardHtml } from './spa';
import type { ExecutionServerOptions, ExecutionServer } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import type { ProcessStore, AIProcess, ProcessChangeCallback, ProcessOutputEvent } from '@plusplusoneplusplus/pipeline-core';
import { TaskQueueManager, FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { createQueueExecutorBridge } from './queue-executor-bridge';
import { QueuePersistence, computeRepoId } from './queue-persistence';
import { OutputPruner } from './output-pruner';
import { StaleTaskDetector } from './stale-task-detector';
import { TaskWatcher } from './task-watcher';

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
    const host = options.host ?? 'localhost';
    const dataDir = options.dataDir ?? path.join(os.homedir(), '.coc');
    const store = options.store ?? createStubStore();

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    // Create queue manager with per-repo pause support
    const queueManager = new TaskQueueManager({
        maxQueueSize: 0,  // unlimited
        keepHistory: true,
        maxHistorySize: 100,
        getTaskRepoId: (task) => {
            const payload = task.payload as Record<string, unknown>;
            const rootPath = (typeof payload?.workingDirectory === 'string' && payload.workingDirectory)
                ? payload.workingDirectory
                : process.cwd();
            return computeRepoId(rootPath);
        },
    });

    // Restore persisted queue state before executor starts processing
    const queuePersistence = new QueuePersistence(queueManager, dataDir);
    queuePersistence.restore();

    // Wire up output file pruner for automatic cleanup
    const outputPruner = new OutputPruner(store, dataDir);

    // Wire prune hook so pruned entries trigger output file deletion
    if (store instanceof FileProcessStore) {
        store.onPrune = (entries) => outputPruner.handlePrunedEntries(entries);
    }

    // Create queue executor to actually process queued tasks
    const { executor: queueExecutor, bridge } = createQueueExecutorBridge(queueManager, store, {
        maxConcurrency: 1,
        autoStart: true,
        approvePermissions: true,
        dataDir,
        aiService: options.aiService,
    });

    // Start periodic stale task detection (checks every 60s, grace 5min after timeout)
    const staleDetector = new StaleTaskDetector(queueManager, store);
    staleDetector.start();

    // Start event-driven output cleanup and run initial orphan scan
    outputPruner.startListening();
    outputPruner.cleanupOrphans().catch(() => {});
    outputPruner.cleanupStaleQueueEntries().catch(() => {});

    // Generate SPA dashboard HTML (cached — it's static)
    const spaHtml = generateDashboardHtml({ enableWiki: true });

    // Build API routes
    const routes: Route[] = [];
    registerApiRoutes(routes, store, bridge);
    registerQueueRoutes(routes, queueManager, store);
    registerTaskRoutes(routes, store);
    registerTaskWriteRoutes(routes, store);
    registerTaskGenerationRoutes(routes, store);
    registerPromptRoutes(routes, store);
    registerPreferencesRoutes(routes, dataDir);
    registerTaskCommentsRoutes(routes, dataDir);
    registerAdminRoutes(routes, { store, dataDir, getWsServer: () => wsServer, configPath: options.configPath, getQueueManager: () => queueManager, getQueuePersistence: () => queuePersistence });

    // Always register wiki routes (they are safe even with no wikis registered)
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
        spaHtml,
        store,

    });
    const server = http.createServer(handler);

    // Attach WebSocket server and bridge ProcessStore events
    const wsServer = new ProcessWebSocketServer();
    wsServer.attach(server);

    // Wire drain events from executor to WebSocket
    queueExecutor.on('drain-start', (event: { queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-start', queued: event.queued, running: event.running });
    });
    queueExecutor.on('drain-progress', (event: { queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-progress', queued: event.queued, running: event.running });
    });
    queueExecutor.on('drain-complete', (event: { outcome: 'completed'; queued: number; running: number }) => {
        wsServer.broadcastProcessEvent({ type: 'drain-complete', outcome: event.outcome, queued: event.queued, running: event.running });
    });
    queueExecutor.on('drain-timeout', (event: { queued: number; running: number; timeoutMs?: number }) => {
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

    // Bridge queue manager events to WebSocket
    queueManager.on('change', (event: { type: string; taskId?: string }) => {
        const queued = queueManager.getQueued();
        const running = queueManager.getRunning();
        const history = queueManager.getHistory();
        const stats = queueManager.getStats();

        // Debug: log queue state changes
        const taskInfo = event.taskId ? ` task=${event.taskId}` : '';
        process.stderr.write(`[Queue] ${event.type}${taskInfo} — queued=${stats.queued} running=${stats.running} completed=${stats.completed} failed=${stats.failed} ws_clients=${wsServer.clientCount}\n`);

        wsServer.broadcastProcessEvent({
            type: 'queue-updated',
            queue: {
                queued: queued.map(t => ({
                    id: t.id,
                    repoId: t.repoId,
                    type: t.type,
                    priority: t.priority,
                    status: t.status,
                    displayName: t.displayName,
                    createdAt: t.createdAt,
                })),
                running: running.map(t => ({
                    id: t.id,
                    repoId: t.repoId,
                    type: t.type,
                    priority: t.priority,
                    status: t.status,
                    displayName: t.displayName,
                    createdAt: t.createdAt,
                    startedAt: t.startedAt,
                })),
                history: history.map(t => ({
                    id: t.id,
                    repoId: t.repoId,
                    type: t.type,
                    priority: t.priority,
                    status: t.status,
                    displayName: t.displayName,
                    createdAt: t.createdAt,
                    startedAt: t.startedAt,
                    completedAt: t.completedAt,
                    error: t.error,
                })),
                stats,
            },
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

    // Watch tasks directories for already-registered workspaces (handles server restart)
    const existingWorkspaces = await store.getWorkspaces();
    for (const ws of existingWorkspaces) {
        taskWatcher.watchWorkspace(ws.id, ws.rootPath);
    }

    // Intercept workspace registration/removal to manage task watchers
    const originalRegister = store.registerWorkspace!.bind(store);
    const originalRemove = store.removeWorkspace!.bind(store);

    store.registerWorkspace = async (workspace: any) => {
        await originalRegister(workspace);
        taskWatcher.watchWorkspace(workspace.id, workspace.rootPath);
    };

    store.removeWorkspace = async (id: string) => {
        taskWatcher.unwatchWorkspace(id);
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
    const url = `http://${host}:${actualPort}`;

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
            // Dispose wiki manager (stop file watchers, destroy sessions)
            wikiManager?.disposeAll();

            // Drain queue if requested
            let drainOutcome: 'completed' | 'timeout' | undefined;
            if (closeOptions?.drain) {
                const result = await queueExecutor.drainAndDispose(closeOptions.drainTimeoutMs);
                drainOutcome = result.outcome;
            } else {
                // Flush persisted queue state before stopping executor
                queuePersistence.dispose();
                // Stop the queue executor immediately
                queueExecutor.dispose();
            }

            // If drain was used, still flush persistence
            if (closeOptions?.drain) {
                queuePersistence.dispose();
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
export { CLITaskExecutor, createQueueExecutorBridge } from './queue-executor-bridge';
export type { QueueExecutorBridgeOptions, QueueExecutorBridge } from './queue-executor-bridge';
export { QueuePersistence } from './queue-persistence';
export { OutputPruner } from './output-pruner';
export { StaleTaskDetector } from './stale-task-detector';
export type { StaleTaskDetectorOptions } from './stale-task-detector';
export { TaskWatcher } from './task-watcher';
export type { TasksChangedCallback } from './task-watcher';
export { registerWikiRoutes } from './wiki';
export type { WikiRouteOptions } from './wiki';
export { discoverPromptFiles, readPromptFileContent } from './prompt-utils';
export type { PromptFileInfo } from './prompt-utils';
export { registerPreferencesRoutes, readPreferences, writePreferences, validatePreferences } from './preferences-handler';
export type { UserPreferences } from './preferences-handler';
export { registerTaskCommentsRoutes, TaskCommentsManager } from './task-comments-handler';
export type { TaskComment, CommentAnchor, CommentsStorage } from './task-comments-handler';
export { registerAdminRoutes, resetWipeToken } from './admin-handler';
export type { AdminRouteOptions } from './admin-handler';
export { DataWiper } from './data-wiper';
export type { WipeOptions, WipeResult } from './data-wiper';
