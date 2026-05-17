/**
 * Loop Infrastructure Builder
 *
 * Creates and wires up the loop-related objects (LoopStore, LoopExecutor,
 * ScheduleTimerRegistry) used by the execution server.
 *
 * Follows the same pattern as `schedule-infrastructure.ts`.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { TaskQueueManager, ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore, initializeDatabase, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { LoopStore } from '../loops/loop-store';
import { LoopExecutor } from '../loops/loop-executor';
import type { LoopEventEmit } from '../loops/loop-executor';
import { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';

// ============================================================================
// Types
// ============================================================================

export interface LoopInfrastructure {
    loopStore: LoopStore;
    loopExecutor: LoopExecutor;
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
    const { dataDir, queueFacade, store, emit, resolveWorkspaceId } = options;

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
    if (activeCount > 0 || pausedCount > 0 || backfilled > 0) {
        const logger = getLogger();
        logger.info(
            LogCategory.AI,
            `[LoopInfra] Loaded ${activeCount} active, ${pausedCount} paused loop(s) from DB` +
            (backfilled > 0 ? `, backfilled workspaceId on ${backfilled} loop(s)` : ''),
        );
    }

    const dispose = () => {
        timerRegistry.clear();
        if (ownsDb) {
            try { db.close(); } catch { /* already closed */ }
        }
    };

    return { loopStore, loopExecutor, timerRegistry, emit, dispose };
}
