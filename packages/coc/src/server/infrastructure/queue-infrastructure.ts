/**
 * Queue Infrastructure Builder
 *
 * Creates the three queue-related objects (RepoQueueRegistry,
 * MultiRepoQueueRouter, SqliteQueuePersistence) used by the
 * execution server and returns them as a plain object.
 *
 * Queue state is persisted via SqliteQueuePersistence — incremental,
 * synchronous writes to the shared processes.db.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../queue/sqlite-queue-persistence';
import { defaultIsExclusive } from '../queue/queue-executor-bridge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { ExecutionServerOptions } from '../types';
import type { MemoryPromoteConfig } from '../memory/memory-promote';

// ============================================================================
// Types
// ============================================================================

export interface QueueInfrastructure {
    registry: RepoQueueRegistry;
    bridge: MultiRepoQueueRouter;
    queuePersistence: SqliteQueuePersistence;
    queueFacade: ReturnType<MultiRepoQueueRouter['createAggregateQueueFacade']>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates and wires up the queue infrastructure required by the execution
 * server. Persisted queue state is restored before returning.
 *
 * Uses the shared DB handle from SqliteProcessStore when available.
 * Falls back to an in-memory SQLite database for non-SQLite stores (tests).
 *
 * @param store             - Process store for task tracking.
 * @param dataDir           - Root data directory (e.g. `~/.coc/`).
 * @param options           - Subset of ExecutionServerOptions relevant to the queue.
 * @param defaultTimeoutMs  - Default AI task timeout in milliseconds.
 * @param followUpSuggestions - Follow-up suggestions config (`{ enabled, count }`).
 * @param getWsServer       - Forward-reference accessor for the WebSocket server.
 */
export function createQueueInfrastructure(
    store: ProcessStore,
    dataDir: string,
    options: Pick<ExecutionServerOptions, 'queue' | 'aiService'>,
    defaultTimeoutMs: number,
    followUpSuggestions: { enabled: boolean; count: number } | undefined,
    askUser: { enabled: boolean } | undefined,
    getWsServer: () => ProcessWebSocketServer,
    memoryPromotion: MemoryPromoteConfig | undefined,
    getLoopInfra?: () => import('../executors/chat-base-executor').LoopInfraDeps | undefined,
    getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined,
): QueueInfrastructure {
    // Obtain SQLite DB handle: reuse from SqliteProcessStore, or create in-memory for tests.
    let db: Database.Database;
    if (store instanceof SqliteProcessStore) {
        db = store.getDatabase();
    } else {
        db = new Database(':memory:');
        initializeDatabase(db);
    }

    const registry = new RepoQueueRegistry({
        maxQueueSize: 0, // unlimited
        keepHistory: true,
        maxHistorySize: options.queue?.historyLimit ?? 100,
        isExclusive: defaultIsExclusive,
    });

    const bridge = new MultiRepoQueueRouter(registry, store, {
        autoStart: options.queue?.autoStart !== false,
        approvePermissions: true,
        dataDir,
        aiService: options.aiService,
        defaultTimeoutMs,
        followUpSuggestions,
        askUser,
        getWsServer,
        memoryPromotion,
        initialDelayMs: options.queue?.restartPickupDelayMs,
        getLoopInfra,
        getMcpOauthManager,
    });

    const queuePersistence = new SqliteQueuePersistence(bridge, db, {
        restartPolicy: options.queue?.restartPolicy,
    });
    queuePersistence.restore();

    // Clear the startup delay so lazily-created bridges after this point get no delay
    bridge.clearInitialDelay();

    const queueFacade = bridge.createAggregateQueueFacade();

    return { registry, bridge, queuePersistence, queueFacade };
}
