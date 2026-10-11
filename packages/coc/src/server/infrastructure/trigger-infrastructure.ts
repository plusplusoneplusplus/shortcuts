/**
 * Creates and wires up the trigger-related objects (`TriggerStore`,
 * `TriggerManager`, the `ci-failure` and `pr-merged` evaluators, the queue-backed
 * `QueueActionExecutor`, and a dedicated `ScheduleTimerRegistry`) used by the
 * execution server.
 *
 * Mirrors `cron-infrastructure.ts`: reuses the shared SQLite DB handle from
 * `SqliteProcessStore`, re-arms active triggers from their persisted
 * `nextTickAt` on startup, and exposes a `dispose()` for shutdown.
 *
 * The CI-failure monitor's checks-fetch is injected (the production fetcher
 * reuses the server-side checks path — see `createCiChecksFetcher`) so this
 * builder stays free of provider/HTTP details and is unit-testable.
 */

import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { TaskQueueManager, ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore, initializeDatabase, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { createTrigger, type CreateTriggerFn } from '../triggers/create-trigger-service';
import { TriggerStore } from '../triggers/trigger-store';
import { TriggerManager } from '../triggers/trigger-manager';
import type { TriggerEventEmit } from '../triggers/trigger-manager';
import { CiFailureEvaluator } from '../triggers/ci-failure-evaluator';
import type { CiChecksFetcher, CiLogFetcher } from '../triggers/ci-failure-evaluator';
import { PrMergedEvaluator } from '../triggers/pr-merged-evaluator';
import { createPrStatusFetcher, type PrStatusFetcher } from '../triggers/pr-status-fetcher';
import { QueueActionExecutor } from '../triggers/queue-action-executor';
import { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import type { TriggerEvent } from '../triggers/trigger-types';
import type { QueueExecutorBridge } from '../core/api-handler';
import { ProcessMessageDeliveryService } from '../processes/process-message-delivery-service';
import { SentinelTodoStore } from '../sentinel-todos/sentinel-todo-store';
import { SentinelTodoTriggerFirer } from '../triggers/sentinel-todo-trigger-firer';
import { SentinelTodoTriggerService } from '../triggers/sentinel-todo-trigger-service';
import { SentinelTodoService } from '../sentinel-todos/sentinel-todo-service';

// ============================================================================
// Types
// ============================================================================

export interface TriggerInfrastructure {
    triggerStore: TriggerStore;
    triggerManager: TriggerManager;
    sentinelTodoFirer: SentinelTodoTriggerFirer;
    sentinelTodoTriggers: SentinelTodoTriggerService;
    /** Shared creation path for server tools. */
    createTrigger: CreateTriggerFn;
    /** Timer registry for scheduling trigger ticks. */
    timerRegistry: ScheduleTimerRegistry;
    /** Trigger event emitter (used by REST handler/LLM tools to broadcast state). */
    emit: TriggerEventEmit;
    /** Close owned resources. Call on server shutdown. */
    dispose: () => void;
}

export interface TriggerInfrastructureOptions {
    /** Root data directory (e.g. `~/.coc/`). */
    dataDir: string;
    /** Aggregate queue facade for follow-up delivery (the action executor). */
    queueFacade: TaskQueueManager;
    /** Owner-routed queue admission; enqueueAdmitted is used under the shared process lock. */
    deliveryBridge: QueueExecutorBridge;
    recoverPendingMessages?: (workspaceId: string, processId: string) => Promise<void>;
    /** Process store instance (SQLite DB is extracted from SqliteProcessStore). */
    store: ProcessStore;
    /** Emit trigger change events (for WebSocket broadcasting). */
    emit: TriggerEventEmit;
    /** Resolve processId → workspaceId for multi-repo routing. */
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    /**
     * Fetch a PR's checks snapshot for the ci-failure monitor. Production wiring
     * passes the headless server-side checks fetcher (`createCiChecksFetcher`).
     */
    ciChecksFetcher: CiChecksFetcher;
    /**
     * Optional fetcher for a truncated failing-check log excerpt injected into
     * the fix prompt (AC-02). Production wiring passes `createCiLogFetcher`; when
     * omitted the prompt simply asks the agent to fetch the logs itself.
     */
    ciLogFetcher?: CiLogFetcher;
    /**
     * Read a PR's state by URL identity for `pr-merged` watches. Defaults to
     * the server-credential fetcher (`createPrStatusFetcher`).
     */
    prStatusFetcher?: PrStatusFetcher;
    /** Clock injection for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates and wires up the trigger infrastructure required by the execution
 * server. Active triggers are re-armed from persisted `nextTickAt` so they
 * keep monitoring across server restarts.
 */
export async function createTriggerInfrastructure(
    options: TriggerInfrastructureOptions,
): Promise<TriggerInfrastructure> {
    const { dataDir, queueFacade, store, emit, resolveWorkspaceId, ciChecksFetcher, ciLogFetcher, now } = options;

    // Obtain SQLite DB handle: reuse from SqliteProcessStore, or open processes.db in dataDir.
    let db: NativeDatabase;
    let ownsDb = false;
    if (store instanceof SqliteProcessStore) {
        db = store.getDatabase();
    } else {
        const path = require('path');
        const fs = require('fs');
        fs.mkdirSync(dataDir, { recursive: true });
        db = new NativeDatabase(path.join(dataDir, 'processes.db'));
        initializeDatabase(db);
        ownsDb = true;
    }

    const triggerStore = new TriggerStore(db);
    const timerRegistry = new ScheduleTimerRegistry();

    // Evaluators: the CI-failure monitor and the Sentinel To-do PR-merge watch.
    const ciFailureEvaluator = new CiFailureEvaluator(ciChecksFetcher, ciLogFetcher);
    const prMergedEvaluator = new PrMergedEvaluator(
        options.prStatusFetcher ?? createPrStatusFetcher({ dataDir }), now);

    // The single action executor: queue-backed send-message into a conversation.
    const actionExecutor = new QueueActionExecutor({
        processStore: store,
        queueManager: queueFacade,
        resolveWorkspaceId,
        messageDelivery: new ProcessMessageDeliveryService({
            store, bridge: options.deliveryBridge, listTasks: () => queueFacade.getAll(),
        }),
        recoverPendingMessages: options.recoverPendingMessages,
    });

    const todos = new SentinelTodoStore(db);
    const sentinelTodoFirer = new SentinelTodoTriggerFirer({
        triggers: triggerStore, todos, processes: store,
        executor: actionExecutor, emit, now,
        onPendingDelivery: trigger => triggerManager.schedulePendingDelivery(trigger),
    });
    const triggerManager = new TriggerManager({
        store: triggerStore,
        timerRegistry,
        resolveEvaluator: (event: TriggerEvent) => {
            if (event.type !== 'condition-monitor') return undefined;
            return event.monitor === 'ci-failure' ? ciFailureEvaluator : prMergedEvaluator;
        },
        actionExecutor,
        oneShotFirer: sentinelTodoFirer,
        emit,
        ...(now ? { now } : {}),
    });
    const sentinelTodoTriggers = new SentinelTodoTriggerService({
        triggers: triggerStore, todos,
        owners: new SentinelTodoService({ todos, store, getTask: id => queueFacade.getTask(id) }),
        manager: triggerManager, firer: sentinelTodoFirer, enabled: true,
        fetchPr: options.prStatusFetcher ?? createPrStatusFetcher({ dataDir }), emit, now,
    });

    // Restore active trigger timers from the persisted nextTickAt values.
    triggerManager.armAll();
    await triggerManager.reconcilePendingDeliveries();
    for (const trigger of triggerStore.getAll()) {
        if (!trigger.binding || trigger.delivery?.state !== 'delivered') continue;
        try {
            await options.recoverPendingMessages?.(trigger.workspaceId, trigger.processId);
        } catch (error) {
            getLogger().error(LogCategory.AI, `[TriggerInfra] Buffered wake recovery failed for ${trigger.id}: ${String(error)}`);
            const pending = triggerStore.transaction(() => {
                const current = triggerStore.getById(trigger.id);
                if (current?.delivery?.state !== 'delivered') return;
                const updated = {
                    ...current, revision: current.revision + 1,
                    outcomeReason: error instanceof Error ? error.message : String(error),
                    delivery: { ...current.delivery, state: 'pending' as const },
                };
                triggerStore.update(updated);
                return updated;
            });
            if (pending) {
                triggerManager.schedulePendingDelivery(pending);
                emit({ type: 'trigger-updated', trigger: pending });
            }
        }
    }

    // Log startup state after timers have been restored.
    const activeCount = triggerStore.getActive().length;
    const pausedCount = triggerStore.getAll().filter(t => t.status === 'paused').length;
    if (activeCount > 0 || pausedCount > 0) {
        getLogger().info(
            LogCategory.AI,
            `[TriggerInfra] Loaded ${activeCount} active, ${pausedCount} paused trigger(s) from DB`,
        );
    }

    const dispose = () => {
        triggerManager.shutdownAll();
        if (ownsDb) {
            try { db.close(); } catch { /* already closed */ }
        }
    };

    return {
        triggerStore, triggerManager, sentinelTodoFirer, sentinelTodoTriggers, timerRegistry, emit, dispose,
        createTrigger: (workspaceId, body, reuseCiMonitor) => createTrigger({
            store: triggerStore, manager: triggerManager, emit, enabled: true,
            resolveWorkspaceId: options.resolveWorkspaceId, now: options.now,
        }, workspaceId, body, reuseCiMonitor),
    };
}
