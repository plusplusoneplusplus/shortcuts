/**
 * Loop Infrastructure Builder
 *
 * Creates and wires up the loop-related objects (LoopStore, LoopExecutor,
 * ScheduleTimerRegistry) used by the execution server.
 *
 * Follows the same pattern as `schedule-infrastructure.ts`.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { TaskQueueManager, ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore, initializeDatabase, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { LoopStore } from '../loops/loop-store';
import { LoopExecutor } from '../loops/loop-executor';
import type { LoopEventEmit } from '../loops/loop-executor';
import { WakeupStore } from '../loops/wakeup-store';
import { WakeupExecutor } from '../loops/wakeup-executor';
import type { WakeupEventEmit, WakeupExecuteFollowUp } from '../loops/wakeup-executor';
import { WAKEUP_RETENTION_MS } from '../loops/wakeup-types';
import { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';

// ============================================================================
// Types
// ============================================================================

export interface LoopInfrastructure {
    loopStore: LoopStore;
    loopExecutor: LoopExecutor;
    /** Durable one-shot wakeup persistence. */
    wakeupStore: WakeupStore;
    /** Durable one-shot wakeup lifecycle (arm/fire/terminal). */
    wakeupExecutor: WakeupExecutor;
    /** Timer registry for scheduling loop ticks and wakeups. */
    timerRegistry: ScheduleTimerRegistry;
    /** Loop event emitter (used by REST handler and LLM tools to broadcast state). */
    emit: LoopEventEmit;
    /** Close owned resources. Call on server shutdown. */
    dispose: () => void;
}

export interface LoopInfrastructureOptions {
    /** Root data directory (e.g. `~/.coc/`). */
    dataDir: string;
    /** Aggregate queue facade for follow-up execution. */
    queueFacade: TaskQueueManager;
    /** Process store instance (SQLite DB is extracted from SqliteProcessStore). */
    store: ProcessStore;
    /** Emit loop change events (for WebSocket broadcasting). */
    emit: LoopEventEmit;
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
 * Creates and wires up the loop infrastructure required by the execution
 * server. Active loops are re-armed from persisted `nextTickAt` so they
 * continue across server restarts.
 *
 * @returns LoopInfrastructure with store, executor, and dispose function.
 */
export async function createLoopInfrastructure(options: LoopInfrastructureOptions): Promise<LoopInfrastructure> {
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

    const loopStore = new LoopStore(db);
    const timerRegistry = new ScheduleTimerRegistry();

    const loopExecutor = new LoopExecutor({
        store: loopStore,
        processStore: store,
        timerRegistry,
        queueManager: queueFacade,
        emit,
        resolveWorkspaceId,
    });

    // Restore active loop timers from the persisted nextTickAt values.
    loopExecutor.armAll();

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
    const allLoops = loopStore.getAll();
    let backfilled = 0;
    for (const loop of allLoops) {
        if (loop.workspaceId == null) {
            try {
                const wsId = await resolveWorkspaceId(loop.processId);
                if (wsId) {
                    loop.workspaceId = wsId;
                    loopStore.update(loop);
                    backfilled++;
                }
            } catch { /* best-effort backfill */ }
        }
    }

    // Log startup state after timers have been restored.
    const activeCount = loopStore.getActive().length;
    const pausedCount = allLoops.filter(l => l.status === 'paused').length;
    const pendingWakeups = wakeupStore.getPending().length;
    if (activeCount > 0 || pausedCount > 0 || backfilled > 0 || pendingWakeups > 0 || prunedWakeups > 0) {
        const logger = getLogger();
        logger.info(
            LogCategory.AI,
            `[LoopInfra] Loaded ${activeCount} active, ${pausedCount} paused loop(s), ${pendingWakeups} pending wakeup(s) from DB` +
            (backfilled > 0 ? `, backfilled workspaceId on ${backfilled} loop(s)` : '') +
            (prunedWakeups > 0 ? `, pruned ${prunedWakeups} stale wakeup(s)` : ''),
        );
    }

    const dispose = () => {
        timerRegistry.clear();
        if (ownsDb) {
            try { db.close(); } catch { /* already closed */ }
        }
    };

    return { loopStore, loopExecutor, wakeupStore, wakeupExecutor, timerRegistry, emit, dispose };
}
