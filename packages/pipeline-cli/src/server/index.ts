/**
 * Pipeline Execution Server
 *
 * Creates and manages an HTTP server for the `pipeline serve` command.
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
import { registerApiRoutes } from './api-handler';
import { registerQueueRoutes } from './queue-handler';
import { ProcessWebSocketServer, toProcessSummary } from './websocket';
import { generateDashboardHtml } from './spa';
import type { ExecutionServerOptions, ExecutionServer } from './types';
import type { Route } from './types';
import type { ProcessStore, AIProcess, ProcessChangeCallback, ProcessOutputEvent } from '@plusplusoneplusplus/pipeline-core';
import { TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import { createQueueExecutorBridge } from './queue-executor-bridge';

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
 * Create and start the pipeline execution server.
 *
 * @param options - Server options
 * @returns A running ExecutionServer instance
 */
export async function createExecutionServer(options: ExecutionServerOptions = {}): Promise<ExecutionServer> {
    const port = options.port ?? 4000;
    const host = options.host ?? 'localhost';
    const dataDir = options.dataDir ?? path.join(os.homedir(), '.pipeline-server');
    const store = options.store ?? createStubStore();

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    // Create queue manager
    const queueManager = new TaskQueueManager({
        maxQueueSize: 0,  // unlimited
        keepHistory: true,
        maxHistorySize: 100,
    });

    // Create queue executor to actually process queued tasks
    const queueExecutor = createQueueExecutorBridge(queueManager, store, {
        maxConcurrency: 1,
        autoStart: true,
        approvePermissions: true,
    });

    // Generate SPA dashboard HTML (cached — it's static)
    const spaHtml = generateDashboardHtml();

    // Build API routes
    const routes: Route[] = [];
    registerApiRoutes(routes, store);
    registerQueueRoutes(routes, queueManager);

    // Build request handler (health route is prepended automatically)
    const handler = createRequestHandler({ routes, spaHtml, store });
    const server = http.createServer(handler);

    // Attach WebSocket server and bridge ProcessStore events
    const wsServer = new ProcessWebSocketServer();
    wsServer.attach(server);

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
                    type: t.type,
                    priority: t.priority,
                    status: t.status,
                    displayName: t.displayName,
                    createdAt: t.createdAt,
                })),
                running: running.map(t => ({
                    id: t.id,
                    type: t.type,
                    priority: t.priority,
                    status: t.status,
                    displayName: t.displayName,
                    createdAt: t.createdAt,
                    startedAt: t.startedAt,
                })),
                history: history.map(t => ({
                    id: t.id,
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
        port: actualPort,
        host,
        url,
        close: async () => {
            // Stop the queue executor first
            queueExecutor.dispose();
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
        },
    };
}

// Re-exports
export type { ExecutionServerOptions, ExecutionServer, Route } from './types';
export type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
export { sendJson, send404, send400, send500, readJsonBody, createRequestHandler } from './router';
export { registerApiRoutes, sendJSON, sendError, parseBody, parseQueryParams } from './api-handler';
export { registerQueueRoutes } from './queue-handler';
export { handleProcessStream } from './sse-handler';
export { ProcessWebSocketServer, toProcessSummary, sendFrame, decodeFrame } from './websocket';
export type { WSClient, ProcessSummary, QueueTaskSummary, QueueHistoryTaskSummary, QueueSnapshot, ServerMessage, ClientMessage } from './websocket';
export type { RouterOptions } from './router';
export { generateDashboardHtml } from './spa';
export type { DashboardOptions } from './spa';
export { CLITaskExecutor, createQueueExecutorBridge } from './queue-executor-bridge';
export type { QueueExecutorBridgeOptions } from './queue-executor-bridge';
