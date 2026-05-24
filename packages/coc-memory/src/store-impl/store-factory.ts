/**
 * Memory store factory
 *
 * Creates a pair of SQLite-backed stores (facts + episodes) for a given
 * data directory. The calling layer (CoC server or tests) is responsible for
 * providing the resolved path; this module does not import CoC server code.
 */
import { mkdirSync } from 'fs';
import { join } from 'path';
import type { MemoryStoreHandle } from '../store-interface';
import { SqliteEpisodeStore } from './sqlite-episode-store';
import { SqliteFactStore } from './sqlite-fact-store';

/** Store handle with an additional `close()` method for lifecycle management */
export interface CloseableMemoryStoreHandle extends MemoryStoreHandle {
    readonly facts: SqliteFactStore;
    readonly episodes: SqliteEpisodeStore;
    close(): void;
}

/**
 * Open (or create) memory stores at `dataDir`.
 *
 * Two files are created inside the directory:
 *   - `facts.db`    — facts table + FTS5 index
 *   - `episodes.db` — episodes table
 *
 * The directory is created recursively if it does not exist.
 */
export function createMemoryStores(dataDir: string): CloseableMemoryStoreHandle {
    mkdirSync(dataDir, { recursive: true });

    const facts = new SqliteFactStore(join(dataDir, 'facts.db'));
    const episodes = new SqliteEpisodeStore(join(dataDir, 'episodes.db'));

    return {
        facts,
        episodes,
        close() {
            facts.close();
            episodes.close();
        },
    };
}
