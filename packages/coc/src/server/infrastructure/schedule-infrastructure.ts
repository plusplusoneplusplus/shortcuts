/**
 * Schedule Infrastructure Builder
 *
 * Creates the schedule-related objects (ScheduleYamlPersistence,
 * SqliteScheduleRunPersistence, RepoScheduleOverrideStore, ScheduleManager)
 * used by the execution server and returns them as a plain object.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore, initializeDatabase } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { ScheduleYamlPersistence } from '../schedule/schedule-yaml-persistence';
import { SqliteScheduleRunPersistence } from '../schedule/sqlite-schedule-run-persistence';
import { ScheduleManager } from '../schedule/schedule-manager';
import { RepoScheduleOverrideStore } from '../schedule/repo-schedule-overrides';

// ============================================================================
// Types
// ============================================================================

export interface ScheduleInfrastructure {
    scheduleManager: ScheduleManager;
    scheduleRunPersistence: SqliteScheduleRunPersistence;
    /** Close owned resources. Call on server shutdown. */
    dispose: () => void;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates and wires up the schedule infrastructure required by the execution
 * server. Persisted schedule state is restored before returning.
 *
 * @param dataDir     - Root data directory (e.g. `~/.coc/`).
 * @param queueFacade - Aggregate queue facade used by the schedule manager to
 *                      enqueue triggered jobs.
 * @param store       - Process store instance (SQLite DB is extracted from SqliteProcessStore).
 */
export async function createScheduleInfrastructure(
    dataDir: string,
    queueFacade: TaskQueueManager,
    store: ProcessStore,
): Promise<ScheduleInfrastructure> {
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

    const schedulePersistence = new ScheduleYamlPersistence(dataDir);
    await schedulePersistence.migrateAllFromJson(); // non-destructive, idempotent
    const scheduleRunPersistence = new SqliteScheduleRunPersistence(db);
    const scheduleOverrideStore = new RepoScheduleOverrideStore(dataDir);
    const scheduleManager = new ScheduleManager(
        schedulePersistence,
        queueFacade,
        scheduleOverrideStore,
        dataDir,
    );
    await scheduleManager.restore();
    scheduleManager.restoreRunHistory(scheduleRunPersistence);

    const dispose = () => {
        if (ownsDb) {
            try { db.close(); } catch { /* already closed */ }
        }
    };

    return { scheduleManager, scheduleRunPersistence, dispose };
}
