/**
 * Creates the {@link TurnPerformanceStore} against the shared `processes.db`
 * SQLite database, following the same handle-resolution pattern as the
 * schedule infrastructure: reuse the handle from `SqliteProcessStore`, or
 * open `processes.db` in the data directory for non-SQLite stores.
 */

import * as fs from 'fs';
import * as path from 'path';
import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { SqliteProcessStore, initializeDatabase } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { TurnPerformanceStore } from '../storage/turn-performance-store';

// ============================================================================
// Types
// ============================================================================

export interface TurnPerformanceInfrastructure {
    turnPerformanceStore: TurnPerformanceStore;
    /** Close owned resources. Call on server shutdown. */
    dispose: () => void;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * @param dataDir - Root data directory (e.g. `~/.coc/`).
 * @param store   - Process store instance (SQLite DB handle is reused from
 *                  SqliteProcessStore when available).
 */
export function createTurnPerformanceInfrastructure(
    dataDir: string,
    store: ProcessStore,
): TurnPerformanceInfrastructure {
    let db: Database.Database;
    let ownsDb = false;
    if (store instanceof SqliteProcessStore) {
        db = store.getDatabase();
    } else {
        fs.mkdirSync(dataDir, { recursive: true });
        db = new DatabaseConstructor(path.join(dataDir, 'processes.db'));
        initializeDatabase(db);
        ownsDb = true;
    }

    const turnPerformanceStore = new TurnPerformanceStore(db);

    const dispose = () => {
        if (ownsDb) {
            try { db.close(); } catch { /* already closed */ }
        }
    };

    return { turnPerformanceStore, dispose };
}
