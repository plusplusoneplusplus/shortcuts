/**
 * Memory scope resolver
 *
 * Resolves and caches the correct store handle for a given workspace,
 * depending on whether the workspace is in global (default) or isolated mode.
 *
 * Path conventions (documented assumptions from the goal spec):
 *   - Global:    <dataDir>/memory/global/
 *   - Isolated:  <dataDir>/repos/<workspaceId>/memory/
 *
 * The CoC server layer passes the `dataDir` root (e.g. ~/.coc) and calls
 * `getRepoDataPath` before constructing `WorkspaceMemoryConfig` — this
 * package does not depend on CoC server internals.
 */
import { join } from 'path';
import type { MemoryStoreHandle } from './store-interface';
import { type CloseableMemoryStoreHandle, createMemoryStores } from './store-impl/store-factory';
import { GLOBAL_MEMORY_SUBDIR, WORKSPACE_MEMORY_SUBDIR } from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Configuration that determines how a workspace maps to a memory store.
 */
export interface WorkspaceMemoryConfig {
    /** CoC data root directory (e.g. `~/.coc` or process.env.COC_DATA_DIR) */
    dataDir: string;
    /** Workspace identifier (used in isolated mode) */
    workspaceId: string;
    /**
     * When `true`, this workspace reads/writes only its own isolated store.
     * When `false` (default), it uses the shared global store.
     */
    isolated: boolean;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves and caches memory store handles by data directory path.
 *
 * One instance should live for the lifetime of the CoC server process.
 * Call `closeAll()` during graceful shutdown.
 */
export class MemoryScopeResolver {
    private readonly cache = new Map<string, CloseableMemoryStoreHandle>();

    /**
     * Return the store handle for the given workspace config.
     *
     * - `isolated: false` → global store at `<dataDir>/<GLOBAL_MEMORY_SUBDIR>/`
     * - `isolated: true`  → workspace store at
     *   `<dataDir>/repos/<workspaceId>/<WORKSPACE_MEMORY_SUBDIR>/`
     *
     * Store instances are cached by resolved path and reused on subsequent calls.
     */
    resolve(config: WorkspaceMemoryConfig): MemoryStoreHandle {
        const storeDir = this.resolveDir(config);
        if (!this.cache.has(storeDir)) {
            this.cache.set(storeDir, createMemoryStores(storeDir));
        }
        return this.cache.get(storeDir)!;
    }

    /**
     * Resolve the global store unconditionally (ignores workspace config).
     * Useful for admin operations that must always act on global memory.
     */
    resolveGlobal(dataDir: string): MemoryStoreHandle {
        return this.resolve({ dataDir, workspaceId: '', isolated: false });
    }

    /**
     * Return the resolved filesystem path for the store, without opening it.
     * Useful for CoC server code that needs to call `getRepoDataPath` first.
     */
    resolveDir(config: WorkspaceMemoryConfig): string {
        return config.isolated
            ? join(config.dataDir, 'repos', config.workspaceId, WORKSPACE_MEMORY_SUBDIR)
            : join(config.dataDir, GLOBAL_MEMORY_SUBDIR);
    }

    /**
     * Close all cached database connections.
     * Should be called once during CoC server graceful shutdown.
     */
    closeAll(): void {
        for (const handle of this.cache.values()) {
            handle.close();
        }
        this.cache.clear();
    }
}
