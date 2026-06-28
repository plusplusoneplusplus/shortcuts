/**
 * In-memory cache for task scanning results.
 *
 * Keyed by `{workspaceId}:{taskRootPath}`. TTL-based expiry (default 5 min).
 * Workspace-scoped invalidation for write operations and file watcher events.
 *
 * Backed by the unified in-memory cache primitive (namespace `task`). Entries
 * are tagged with their workspace id — parsed from the key prefix — so
 * `invalidateWorkspace` resolves through the unified per-workspace index
 * (O(matching entries)) instead of scanning the whole map.
 */

import { createCache, type CacheHandle } from '../cache';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class TaskCacheService {
    private readonly cache: CacheHandle<unknown>;

    constructor(ttlMs = DEFAULT_TTL_MS) {
        this.cache = createCache<unknown>({ namespace: 'task', ttlMs });
    }

    /** Build a cache key from workspaceId and task root path. */
    static key(workspaceId: string, taskRootPath: string): string {
        return `${workspaceId}:${taskRootPath}`;
    }

    /** Get a cached value, returning undefined if missing or expired. */
    get<T>(key: string): T | undefined {
        return this.cache.get(key) as T | undefined;
    }

    /** Store a value with TTL-based expiry. */
    set(key: string, value: unknown): void {
        this.cache.set(key, value, { workspaceId: workspaceIdFromKey(key) });
    }

    /** Delete all entries for a workspace (any task root). */
    invalidateWorkspace(workspaceId: string): void {
        this.cache.invalidateWorkspace(workspaceId);
    }

    /** Delete all entries across all workspaces. */
    invalidateAll(): void {
        this.cache.clear();
    }

    /** Number of cached entries (including potentially expired ones). */
    get size(): number {
        return this.cache.size;
    }

    /** Remove all entries. */
    clear(): void {
        this.cache.clear();
    }
}

/**
 * Extract the workspace id — the key segment before the first `:` — so the
 * entry can be workspace-tagged. Keys are built by {@link TaskCacheService.key}
 * as `{workspaceId}:{taskRootPath}`, and workspace ids never contain `:`.
 */
function workspaceIdFromKey(key: string): string | undefined {
    const idx = key.indexOf(':');
    return idx >= 0 ? key.slice(0, idx) : undefined;
}

export const taskCache = new TaskCacheService();
