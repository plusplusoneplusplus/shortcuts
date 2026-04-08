/**
 * In-memory cache for task scanning results.
 *
 * Keyed by `{workspaceId}:{taskRootPath}`. TTL-based expiry (default 5 min).
 * Workspace-scoped invalidation for write operations and file watcher events.
 * Follows the same pattern as GitCacheService.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T = unknown> {
    value: T;
    expiresAt: number;
}

export class TaskCacheService {
    private cache = new Map<string, CacheEntry>();
    private readonly ttlMs: number;

    constructor(ttlMs = DEFAULT_TTL_MS) {
        this.ttlMs = ttlMs;
    }

    /** Build a cache key from workspaceId and task root path. */
    static key(workspaceId: string, taskRootPath: string): string {
        return `${workspaceId}:${taskRootPath}`;
    }

    /** Get a cached value, returning undefined if missing or expired. */
    get<T>(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value as T;
    }

    /** Store a value with TTL-based expiry. */
    set(key: string, value: unknown): void {
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs,
        });
    }

    /** Delete all entries for a workspace (any task root). */
    invalidateWorkspace(workspaceId: string): void {
        const prefix = `${workspaceId}:`;
        for (const key of [...this.cache.keys()]) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
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

export const taskCache = new TaskCacheService();
