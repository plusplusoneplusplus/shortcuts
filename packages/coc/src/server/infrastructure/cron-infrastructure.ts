/**
 * Creates and wires up the cron-related objects (CronStore, CronExecutor,
 * ScheduleTimerRegistry) used by the execution server.
 *
 * Follows the same pattern as `schedule-infrastructure.ts`.
 */

import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { TaskQueueManager, ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore, initializeDatabase, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { CronStore } from '../cron/cron-store';
import { CronExecutor } from '../cron/cron-executor';
import type { CronEventEmit } from '../cron/cron-executor';
import { WakeupStore } from '../cron/wakeup-store';
import { WakeupExecutor } from '../cron/wakeup-executor';
import type { WakeupEventEmit, WakeupExecuteFollowUp } from '../cron/wakeup-executor';
import { WAKEUP_RETENTION_MS } from '../cron/wakeup-types';
import { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';

// ============================================================================
// Types
// ============================================================================

export interface CronInfrastructure {
    cronStore: CronStore;
    cronExecutor: CronExecutor;
    /** Durable one-shot wakeup persistence. */
    wakeupStore: WakeupStore;
    /** Durable one-shot wakeup lifecycle (arm/fire/terminal). */
    wakeupExecutor: WakeupExecutor;
    /** Timer registry for scheduling cron ticks and wakeups. */
    timerRegistry: ScheduleTimerRegistry;
    /** Cron event emitter (used by REST handler and LLM tools to broadcast state). */
    emit: CronEventEmit;
    /** Close owned resources. Call on server shutdown. */
    dispose: () => void;
}

export interface CronInfrastructureOptions {
    /** Root data directory (e.g. `~/.coc/`). */
    dataDir: string;
    /** Aggregate queue facade for follow-up execution. */
    queueFacade: TaskQueueManager;
    /** Process store instance (SQLite DB is extracted from SqliteProcessStore). */
    store: ProcessStore;
    /** Emit cron change events (for WebSocket broadcasting). */
    emit: CronEventEmit;
    /** Resolve processId → workspaceId for multi-repo routing. */
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    /**
     * Run a wakeup's follow-up turn when its timer fires. Wired to the queue
     * bridge's `executeFollowUp` by the server. Required for durable wakeups.
     */
    executeFollowUp: WakeupExecuteFollowUp;
    /** Emit wakeup change events (for WebSocket broadcasting). Optional. */
    emitWakeup?: WakeupEventEmit;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates and wires up the cron infrastructure required by the execution
 * server. Active crons are re-armed from persisted `nextTickAt` so they
 * continue across server restarts.
 */
export async function createCronInfrastructure(options: CronInfrastructureOptions): Promise<CronInfrastructure> {
    const { dataDir, queueFacade, store, emit, resolveWorkspaceId, executeFollowUp, emitWakeup } = options;

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

    const cronStore = new CronStore(db);
    const timerRegistry = new ScheduleTimerRegistry();

    const cronExecutor = new CronExecutor({
        store: cronStore,
        processStore: store,
        timerRegistry,
        queueManager: queueFacade,
        emit,
        resolveWorkspaceId,
    });

    // Restore active cron timers from the persisted nextTickAt values.
    cronExecutor.armAll();

    // Durable one-shot wakeups. Prune stale terminal rows, then re-arm all
    // pending wakeups from persisted `firesAt` (overdue ones fire immediately)
    // so a restart recovers them instead of dropping in-memory timers.
    const wakeupStore = new WakeupStore(db);
    const wakeupExecutor = new WakeupExecutor({
        store: wakeupStore,
        processStore: store,
        timerRegistry,
        executeFollowUp,
        ...(emitWakeup ? { emit: emitWakeup } : {}),
    });
    const prunedWakeups = wakeupStore.pruneTerminalBefore(
        new Date(Date.now() - WAKEUP_RETENTION_MS).toISOString(),
    );
    wakeupExecutor.armAll();

    // Backfill workspaceId for legacy rows that lack it.
    const allCrons = cronStore.getAll();
    let backfilled = 0;
    for (const cron of allCrons) {
        if (cron.workspaceId == null) {
            try {
                const wsId = await resolveWorkspaceId(cron.processId);
                if (wsId) {
                    cron.workspaceId = wsId;
                    cronStore.update(cron);
                    backfilled++;
                }
            } catch { /* best-effort backfill */ }
        }
    }

    // Log startup state after timers have been restored.
    const activeCount = cronStore.getActive().length;
    const pausedCount = allCrons.filter(l => l.status === 'paused').length;
    const pendingWakeups = wakeupStore.getPending().length;
    if (activeCount > 0 || pausedCount > 0 || backfilled > 0 || pendingWakeups > 0 || prunedWakeups > 0) {
        const logger = getLogger();
        logger.info(
            LogCategory.AI,
            `[CronInfra] Loaded ${activeCount} active, ${pausedCount} paused cron(s), ${pendingWakeups} pending wakeup(s) from DB` +
            (backfilled > 0 ? `, backfilled workspaceId on ${backfilled} cron(s)` : '') +
            (prunedWakeups > 0 ? `, pruned ${prunedWakeups} stale wakeup(s)` : ''),
        );
    }

    const dispose = () => {
        timerRegistry.clear();
        if (ownsDb) {
            try { db.close(); } catch { /* already closed */ }
        }
    };

    return { cronStore, cronExecutor, wakeupStore, wakeupExecutor, timerRegistry, emit, dispose };
}
