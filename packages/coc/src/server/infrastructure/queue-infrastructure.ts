/**
 * Creates the three queue-related objects (RepoQueueRegistry,
 * MultiRepoQueueRouter, SqliteQueuePersistence) used by the
 * execution server and returns them as a plain object.
 *
 * Queue state is persisted via SqliteQueuePersistence — incremental,
 * synchronous writes to the shared processes.db.
 */

import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { DelegatedJobStore } from '../delegation/delegated-job-store';
import { delegatedReviewReceipt } from '../delegation/delegated-job-reviews';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../queue/sqlite-queue-persistence';
import { defaultIsExclusive } from '../queue/queue-executor-bridge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { ExecutionServerOptions } from '../types';
import type { ExecutorRuntimeCapabilities } from '../executors/executor-runtime-contracts';
import type { QueueRuntimeConfig } from '../queue/queue-runtime-config';
import { RemoteDelegationAdmissionStore } from '../delegation/remote-delegation-admission-store';

// ============================================================================
// Types
// ============================================================================

export interface QueueInfrastructure {
    registry: RepoQueueRegistry;
    bridge: MultiRepoQueueRouter;
    queuePersistence: SqliteQueuePersistence;
    queueFacade: ReturnType<MultiRepoQueueRouter['createAggregateQueueFacade']>;
    /** Start restored queues after the server finishes wiring late-bound dependencies. */
    activateQueueProcessing: () => void;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates and wires up the queue infrastructure required by the execution
 * server. Persisted queue state is restored before returning.
 *
 * Uses the shared DB handle from SqliteProcessStore when available.
 * Uses an in-memory native SQLite database for non-SQLite test stores.
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
    getTriggerInfra?: () => import('../executors/executor-runtime-contracts').TriggerInfraDeps | undefined,
    getEnqueueChat?: () => import('../llm-tools/send-to-conversation-tool').EnqueueChatFn | undefined,
    getSendMessage?: () => import('../llm-tools/send-to-conversation-tool').SendMessageFn | undefined,
    getSendToConversationRuntime?: () => import('../llm-tools/send-to-conversation-tool').SendToConversationRuntimeOptions | undefined,
    getChatStyleSelectorEnabled?: () => boolean,
    getDefaultChatStyle?: () => import('@plusplusoneplusplus/coc-client').ChatStyle,
    getTurnPerformanceStore?: () => import('../executors/turn-performance-tracker').TurnPerformanceRecorder | undefined,
    getDecisionService?: () => import('../decisions/decision-service').DecisionService | undefined,
    getAskUserQuestionRelay?: () => import('../messaging/ask-user-relay').AskUserQuestionRelay | undefined,
    getLaunchRalph?: () => import('../ralph/ralph-launch-service').LaunchRalphFn | undefined,
    getSentinelTodos?: () => import('../sentinel-todos/sentinel-todo-service').SentinelTodoService | undefined,
    getKustoRuntime?: import('../executors/executor-runtime-contracts').ExecutorRuntimeCapabilities['getKustoRuntime'],
    getSentinelCoda?: ExecutorRuntimeCapabilities['getSentinelCoda'],
    getSentinelDependencyAdmission?: ExecutorRuntimeCapabilities['getSentinelDependencyAdmission'],
    getBrowserControlRuntime?: ExecutorRuntimeCapabilities['getBrowserControlRuntime'],
    getBrowserToolState?: ExecutorRuntimeCapabilities['getBrowserToolState'],
    getToolInventoryStore?: ExecutorRuntimeCapabilities['getToolInventoryStore'],
    getRegisterPrOutcome?: ExecutorRuntimeCapabilities['getRegisterPrOutcome'],
    getSentinelRefrains?: ExecutorRuntimeCapabilities['getSentinelRefrains'],
    getSentinelRefrainCommands?: ExecutorRuntimeCapabilities['getSentinelRefrainCommands'],
    getCanvasExtensionRuntime?: ExecutorRuntimeCapabilities['getCanvasExtensionRuntime'],
): QueueInfrastructure {
    // Obtain SQLite DB handle: reuse from SqliteProcessStore, or create in-memory for tests.
    let db: NativeDatabase;
    if (store instanceof SqliteProcessStore) {
        db = store.getDatabase();
    } else {
        db = new NativeDatabase(':memory:');
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
        getBrowserControlRuntime,
        getBrowserToolState,
        getKustoRuntime,
        getCanvasExtensionRuntime,
        // Late-bound to the router below: canvas scripts run on the owner chat's repo bridge.
        getOwnerScriptRunner: () => bridge.runOwnerScript,
        getWsServer,
        getCronInfra,
        getTriggerInfra,
        getRegisterPrOutcome,
        getEnqueueChat,
        getSendMessage,
        getLaunchRalph,
        getSendToConversationRuntime,
        getSentinelTodos,
        getSentinelDependencyAdmission,
        getSentinelCoda,
        getSentinelRefrains,
        getSentinelRefrainCommands,
        getMcpOauthManager,
        getTurnPerformanceStore,
        getToolInventoryStore,
        getDecisionService,
        getAskUserQuestionRelay,
        getGlobalSystemPrompt,
        getChatStyleSelectorEnabled,
        getDefaultChatStyle,
        resolveAiServiceForProvider,
    };

    const shouldAutoStart = options.queue?.autoStart !== false;
    const bridge = new MultiRepoQueueRouter(registry, store, {
        // Queue restoration creates repo executors before routes and other
        // late-bound dependencies exist. The composition root activates them
        // only after the server is fully wired and listening.
        autoStart: false,
        approvePermissions: true,
        dataDir,
        aiService: options.aiService,
        queueConfig,
        provider,
        ralphMultiAgentGrillEnabled,
        initialDelayMs: options.queue?.restartPickupDelayMs,
        runtime,
    });

    let remoteAdmissions: RemoteDelegationAdmissionStore | undefined;
    const queuePersistence = new SqliteQueuePersistence(bridge, db, {
        restartPolicy: options.queue?.restartPolicy,
        getRetainedTerminalTaskIds: workspaceId => {
            remoteAdmissions ??= new RemoteDelegationAdmissionStore(dataDir);
            return new Set([...remoteAdmissions.list(workspaceId)
                .filter(row => row.admission.state !== 'rejected' && !row.terminal)
                .flatMap(row => [
                    row.executionId,
                    ...(row.kind === 'follow-up' ? [`pending-${row.targetProcessId}-${row.executionId}`] : []),
                ]), ...new DelegatedJobStore(dataDir).list(workspaceId).flatMap(job => {
                    if (!job.remote || !job.terminal || !['pending', 'queued'].includes(job.terminal.delivery.state)) return [];
                    return [delegatedReviewReceipt(job)];
                })]);
        },
    });
    queuePersistence.restore();
    bridge.restorePrMergeWatchers();

    const queueFacade = bridge.createAggregateQueueFacade();
    let activated = false;
    const activateQueueProcessing = (): void => {
        if (activated || !shouldAutoStart) {
            return;
        }
        activated = true;
        bridge.activateQueueProcessing();
    };

    return { registry, bridge, queuePersistence, queueFacade, activateQueueProcessing };
}
