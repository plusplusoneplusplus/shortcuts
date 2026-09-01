/**
 * Creates the three queue-related objects (RepoQueueRegistry,
 * MultiRepoQueueRouter, SqliteQueuePersistence) used by the
 * execution server and returns them as a plain object.
 *
 * Queue state is persisted via SqliteQueuePersistence — incremental,
 * synchronous writes to the shared processes.db.
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
import type { ExecutorRuntimeCapabilities } from '../executors/executor-runtime-contracts';
import type { QueueRuntimeConfig } from '../queue/queue-runtime-config';

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
 * @param dataDir           - Root data directory (e.g. `~/.coc/`).
 * @param options           - Subset of ExecutionServerOptions relevant to the queue.
 * @param queueConfig       - Live config port for queue-owned settings. Backed
 *                            by the server's authoritative RuntimeConfigService
 *                            so queue execution and the admin surface always
 *                            read the same config file. Passed down by
 *                            identity; no value is copied into a second
 *                            mutable snapshot here.
 * @param getWsServer       - Forward-reference accessor for the WebSocket server.
 */
export function createQueueInfrastructure(
    store: ProcessStore,
    dataDir: string,
    options: Pick<ExecutionServerOptions, 'queue' | 'aiService'>,
    queueConfig: QueueRuntimeConfig,
    getWsServer: () => ProcessWebSocketServer,
    getCronInfra?: () => import('../executors/executor-runtime-contracts').CronInfraDeps | undefined,
    getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined,
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode',
    resolveAiServiceForProvider?: (provider: import('../tasks/task-types').ChatProvider) => import('@plusplusoneplusplus/forge').ISDKService,
    ralphMultiAgentGrillEnabled?: boolean,
    getGlobalSystemPrompt?: () => string | undefined,
    getTriggerInfra?: () => { manager: import('../triggers/trigger-manager').TriggerManager } | undefined,
    getEnqueueChat?: () => import('../llm-tools/send-to-conversation-tool').EnqueueChatFn | undefined,
    getSendMessage?: () => import('../llm-tools/send-to-conversation-tool').SendMessageFn | undefined,
    getSendToConversationRuntime?: () => import('../llm-tools/send-to-conversation-tool').SendToConversationRuntimeOptions | undefined,
    getChatStyleSelectorEnabled?: () => boolean,
    getDefaultChatStyle?: () => import('@plusplusoneplusplus/coc-client').ChatStyle,
    getTurnPerformanceStore?: () => import('../executors/turn-performance-tracker').TurnPerformanceRecorder | undefined,
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

    // The one place the late-bound capability set is assembled. Every layer
    // below (router → CLITaskExecutor → ExecutorRegistry → chat executors)
    // forwards this object by identity, so adding a capability here is enough
    // to make it reach its consumer.
    const runtime: ExecutorRuntimeCapabilities = {
        getWsServer,
        getCronInfra,
        getTriggerInfra,
        getEnqueueChat,
        getSendMessage,
        getSendToConversationRuntime,
        getMcpOauthManager,
        getTurnPerformanceStore,
        getGlobalSystemPrompt,
        getChatStyleSelectorEnabled,
        getDefaultChatStyle,
        resolveAiServiceForProvider,
    };

    const bridge = new MultiRepoQueueRouter(registry, store, {
        autoStart: options.queue?.autoStart !== false,
        approvePermissions: true,
        dataDir,
        aiService: options.aiService,
        queueConfig,
        provider,
        ralphMultiAgentGrillEnabled,
        initialDelayMs: options.queue?.restartPickupDelayMs,
        runtime,
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
