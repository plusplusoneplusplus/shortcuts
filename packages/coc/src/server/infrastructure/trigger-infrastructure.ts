/**
 * Trigger Infrastructure Builder
 *
 * Creates and wires up the trigger-related objects (`TriggerStore`,
 * `TriggerManager`, the `ci-failure` `CiFailureEvaluator`, the queue-backed
 * `QueueActionExecutor`, and a dedicated `ScheduleTimerRegistry`) used by the
 * execution server.
 *
 * Mirrors `loop-infrastructure.ts`: reuses the shared SQLite DB handle from
 * `SqliteProcessStore`, re-arms active triggers from their persisted
 * `nextTickAt` on startup, and exposes a `dispose()` for shutdown.
 *
 * The CI-failure monitor's checks-fetch is injected (the production fetcher
 * reuses the server-side checks path — see `createCiChecksFetcher`) so this
 * builder stays free of provider/HTTP details and is unit-testable.
 *
 * Pure Node.js with built-ins only. Cross-platform.
 */

import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { TaskQueueManager, ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore, initializeDatabase, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { TriggerStore } from '../triggers/trigger-store';
import { TriggerManager } from '../triggers/trigger-manager';
import type { TriggerEventEmit } from '../triggers/trigger-manager';
import { CiFailureEvaluator } from '../triggers/ci-failure-evaluator';
import type { CiChecksFetcher, CiLogFetcher } from '../triggers/ci-failure-evaluator';
import { QueueActionExecutor } from '../triggers/queue-action-executor';
import { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import type { TriggerEvent } from '../triggers/trigger-types';

// ============================================================================
// Types
// ============================================================================

export interface TriggerInfrastructure {
    triggerStore: TriggerStore;
    triggerManager: TriggerManager;
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
    let db: Database.Database;
    let ownsDb = false;
    if (store instanceof SqliteProcessStore) {
        db = store.getDatabase();
    } else {
        const path = require('path');
        const fs = require('fs');
        fs.mkdirSync(dataDir, { recursive: true });
        db = new DatabaseConstructor(path.join(dataDir, 'processes.db'));
        initializeDatabase(db);
        ownsDb = true;
    }

    const triggerStore = new TriggerStore(db);
    const timerRegistry = new ScheduleTimerRegistry();

    // The single evaluator implemented this iteration: the CI-failure monitor.
    const ciFailureEvaluator = new CiFailureEvaluator(ciChecksFetcher, ciLogFetcher);

    // The single action executor: queue-backed send-message into a conversation.
    const actionExecutor = new QueueActionExecutor({
        processStore: store,
        queueManager: queueFacade,
        resolveWorkspaceId,
    });

    const triggerManager = new TriggerManager({
        store: triggerStore,
        timerRegistry,
        resolveEvaluator: (event: TriggerEvent) =>
            (event.type === 'condition-monitor' && event.monitor === 'ci-failure')
                ? ciFailureEvaluator
                : undefined,
        actionExecutor,
        emit,
        ...(now ? { now } : {}),
    });

    // Restore active trigger timers from the persisted nextTickAt values.
    triggerManager.armAll();

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
        timerRegistry.clear();
        if (ownsDb) {
            try { db.close(); } catch { /* already closed */ }
        }
    };

    return { triggerStore, triggerManager, timerRegistry, emit, dispose };
}
