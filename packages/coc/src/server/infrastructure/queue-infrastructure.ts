/**
 * Queue Infrastructure Builder
 *
 * Creates the three queue-related objects (RepoQueueRegistry,
 * MultiRepoQueueExecutorBridge, QueuePersistence) used by the
 * execution server and returns them as a plain object.
 *
 * Uses SqliteQueuePersistence when the process store is SqliteProcessStore
 * (incremental, synchronous writes), falling back to MultiRepoQueuePersistence
 * (debounced JSON file rewrites) for file-backend configs.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueExecutorBridge } from '../multi-repo-executor-bridge';
import { MultiRepoQueuePersistence } from '../multi-repo-queue-persistence';
import { SqliteQueuePersistence } from '../queue/sqlite-queue-persistence';
import { defaultIsExclusive } from '../queue-executor-bridge';
import type { ProcessWebSocketServer } from '../websocket';
import type { ExecutionServerOptions } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface QueueInfrastructure {
    registry: RepoQueueRegistry;
    bridge: MultiRepoQueueExecutorBridge;
    queuePersistence: MultiRepoQueuePersistence | SqliteQueuePersistence;
    queueFacade: ReturnType<MultiRepoQueueExecutorBridge['createAggregateFacade']>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates and wires up the queue infrastructure required by the execution
 * server. Persisted queue state is restored before returning.
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
    getWsServer: () => ProcessWebSocketServer,
): QueueInfrastructure {
    const registry = new RepoQueueRegistry({
        maxQueueSize: 0, // unlimited
        keepHistory: true,
        maxHistorySize: options.queue?.historyLimit ?? 100,
        isExclusive: defaultIsExclusive,
    });

    const bridge = new MultiRepoQueueExecutorBridge(registry, store, {
        autoStart: options.queue?.autoStart !== false,
        approvePermissions: true,
        dataDir,
        aiService: options.aiService,
        defaultTimeoutMs,
        followUpSuggestions,
        getWsServer,
        initialDelayMs: options.queue?.restartPickupDelayMs,
    });

    // Restore persisted queue state before executor starts processing.
    // Use SQLite persistence when the store is SQLite-backed (incremental writes),
    // otherwise fall back to JSON file persistence (debounced full-file rewrites).
    let queuePersistence: MultiRepoQueuePersistence | SqliteQueuePersistence;

    if (store instanceof SqliteProcessStore) {
        queuePersistence = new SqliteQueuePersistence(bridge, store.getDatabase(), {
            restartPolicy: options.queue?.restartPolicy,
        });
    } else {
        queuePersistence = new MultiRepoQueuePersistence(bridge, dataDir, {
            restartPolicy: options.queue?.restartPolicy,
            maxPersistedHistory: options.queue?.historyLimit,
        });
    }
    queuePersistence.restore();

    // Clear the startup delay so lazily-created bridges after this point get no delay
    bridge.clearInitialDelay();

    const queueFacade = bridge.createAggregateFacade();

    return { registry, bridge, queuePersistence, queueFacade };
}
