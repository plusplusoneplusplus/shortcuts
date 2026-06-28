/**
 * Unified in-memory cache primitive.
 *
 * One hand-rolled, passive cache implementation shared across the server, so
 * every domain stops reinventing its own `Map`-based TTL cache. A domain calls
 * {@link createCache} once to obtain a typed, namespaced {@link CacheHandle},
 * then uses `get` / `set` / `getOrCompute` against it.
 *
 * Design notes:
 * - **Passive store.** It never owns background timers. Domains that do
 *   stale-while-revalidate (git-info, quota) keep their own refresh timers and
 *   call into a handle underneath.
 * - **Per-entry TTL.** Entries expire by wall-clock time. A namespace with no
 *   `ttlMs` (or `immutable: true`) stores entries that never expire by time;
 *   they are only removed by explicit invalidation or LRU eviction.
 * - **LRU eviction.** Each namespace is capped (default 500). The
 *   least-recently-used entry is evicted when the cap is exceeded. `get` and
 *   `set` count as use.
 * - **Single-flight `getOrCompute`.** Concurrent callers for the same key share
 *   one in-flight factory promise, so the factory runs once.
 * - **Workspace tagging.** Entries may carry an optional `workspaceId`; a
 *   per-workspace index makes {@link CacheHandle.invalidateWorkspace} cost
 *   O(matching entries). A module-level registry lets
 *   {@link invalidateWorkspaceForAll} clear one workspace across every namespace.
 */

/** Per-call write options for {@link CacheHandle.set} / {@link CacheHandle.getOrCompute}. */
export interface CacheWriteOptions {
    /** Tag the entry with a workspace so it can be invalidated by workspace. */
    workspaceId?: string;
    /**
     * Override the namespace default TTL for this single entry, in milliseconds.
     * Use `Infinity` to store an entry that never expires by time. Ignored for
     * immutable namespaces (which always store non-expiring entries).
     */
    ttlMs?: number;
}

/** Options for {@link createCache}. */
export interface CreateCacheOptions {
    /** Stable namespace label — identifies the cache for debugging. */
    namespace: string;
    /**
     * Default time-to-live in milliseconds. Omit (or set `immutable: true`) for
     * entries that never expire by time.
     */
    ttlMs?: number;
    /** Maximum number of entries before LRU eviction kicks in. Default 500. */
    maxSize?: number;
    /**
     * When true, entries never expire by time regardless of `ttlMs`. They are
     * still subject to LRU eviction and explicit invalidation.
     */
    immutable?: boolean;
}

/** Public, typed handle to one namespace of the unified cache. */
export interface CacheHandle<T> {
    /** The namespace label this handle was created with. */
    readonly namespace: string;
    /**
     * Return the cached value for `key`, or `undefined` if missing or expired.
     * Counts as a use for LRU purposes. Expired entries are removed on access.
     */
    get(key: string): T | undefined;
    /** Whether a fresh (non-expired) entry exists for `key`. Does not touch LRU order. */
    has(key: string): boolean;
    /** Store `value` under `key`. */
    set(key: string, value: T, options?: CacheWriteOptions): void;
    /**
     * Return the cached value for `key`, or run `factory` to produce it, store
     * it, and return it. Concurrent calls for the same key share a single
     * in-flight `factory` promise (single-flight). If `factory` rejects, nothing
     * is cached and the rejection propagates to all waiting callers.
     */
    getOrCompute(key: string, factory: () => Promise<T>, options?: CacheWriteOptions): Promise<T>;
    /** Remove `key`. Returns whether an entry existed. */
    delete(key: string): boolean;
    /** Remove every entry tagged with `workspaceId`. */
    invalidateWorkspace(workspaceId: string): void;
    /** Remove every entry in this namespace. In-flight computations are abandoned. */
    clear(): void;
    /** Number of entries currently held (including not-yet-evicted expired ones). */
    readonly size: number;
    /** Remove this handle from the global registry and clear it. */
    dispose(): void;
}

interface CacheEntry<T> {
    value: T;
    /** Wall-clock expiry; `Infinity` for entries that never expire by time. */
    expiresAt: number;
    workspaceId?: string;
}

const DEFAULT_MAX_SIZE = 500;

class InMemoryCache<T> implements CacheHandle<T> {
    readonly namespace: string;
    private readonly defaultTtlMs: number | undefined;
    private readonly immutable: boolean;
    private readonly maxSize: number;

    /** Insertion-ordered store; iteration order is the LRU order (oldest first). */
    private readonly store = new Map<string, CacheEntry<T>>();
    /** workspaceId -> set of keys tagged with it, for O(matching) invalidation. */
    private readonly workspaceIndex = new Map<string, Set<string>>();
    /** key -> in-flight factory promise, for single-flight getOrCompute. */
    private readonly inFlight = new Map<string, Promise<T>>();

    constructor(options: CreateCacheOptions) {
        this.namespace = options.namespace;
        this.immutable = options.immutable === true;
        this.defaultTtlMs = options.ttlMs;
        this.maxSize = Math.max(1, options.maxSize ?? DEFAULT_MAX_SIZE);
    }

    get(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.removeEntry(key, entry);
            return undefined;
        }
        // Mark as most-recently-used by re-inserting at the end.
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.value;
    }

    has(key: string): boolean {
        const entry = this.store.get(key);
        if (!entry) return false;
        if (entry.expiresAt <= Date.now()) {
            this.removeEntry(key, entry);
            return false;
        }
        return true;
    }

    set(key: string, value: T, options?: CacheWriteOptions): void {
        // Drop any prior entry first so insertion order and the workspace index
        // stay consistent on overwrite.
        const prior = this.store.get(key);
        if (prior) this.removeEntry(key, prior);

        this.store.set(key, {
            value,
            expiresAt: this.computeExpiry(options?.ttlMs),
            workspaceId: options?.workspaceId,
        });
        if (options?.workspaceId) this.indexWorkspace(options.workspaceId, key);
        this.evictIfNeeded();
    }

    getOrCompute(key: string, factory: () => Promise<T>, options?: CacheWriteOptions): Promise<T> {
        const cached = this.get(key);
        if (cached !== undefined) return Promise.resolve(cached);

        const pending = this.inFlight.get(key);
        if (pending) return pending;

        const promise = (async () => {
            try {
                const value = await factory();
                this.set(key, value, options);
                return value;
            } finally {
                this.inFlight.delete(key);
            }
        })();
        this.inFlight.set(key, promise);
        return promise;
    }

    delete(key: string): boolean {
        const entry = this.store.get(key);
        if (!entry) return false;
        this.removeEntry(key, entry);
        return true;
    }

    invalidateWorkspace(workspaceId: string): void {
        const keys = this.workspaceIndex.get(workspaceId);
        if (!keys) return;
        for (const key of [...keys]) {
            const entry = this.store.get(key);
            if (entry) this.removeEntry(key, entry);
        }
        // removeEntry prunes the index; drop any empty residue defensively.
        this.workspaceIndex.delete(workspaceId);
    }

    clear(): void {
        this.store.clear();
        this.workspaceIndex.clear();
        this.inFlight.clear();
    }

    get size(): number {
        return this.store.size;
    }

    dispose(): void {
        this.clear();
        registry.delete(this as InMemoryCache<unknown>);
    }

    // ------------------------------------------------------------------
    // internals
    // ------------------------------------------------------------------

    private computeExpiry(perCallTtlMs: number | undefined): number {
        if (this.immutable) return Infinity;
        const ttl = perCallTtlMs ?? this.defaultTtlMs;
        if (ttl === undefined || ttl === Infinity) return Infinity;
        return Date.now() + ttl;
    }

    private indexWorkspace(workspaceId: string, key: string): void {
        let keys = this.workspaceIndex.get(workspaceId);
        if (!keys) {
            keys = new Set<string>();
            this.workspaceIndex.set(workspaceId, keys);
        }
        keys.add(key);
    }

    private removeEntry(key: string, entry: CacheEntry<T>): void {
        this.store.delete(key);
        if (entry.workspaceId) {
            const keys = this.workspaceIndex.get(entry.workspaceId);
            if (keys) {
                keys.delete(key);
                if (keys.size === 0) this.workspaceIndex.delete(entry.workspaceId);
            }
        }
    }

    private evictIfNeeded(): void {
        while (this.store.size > this.maxSize) {
            const oldestKey = this.store.keys().next().value;
            if (oldestKey === undefined) break;
            const entry = this.store.get(oldestKey);
            if (entry) this.removeEntry(oldestKey, entry);
            else this.store.delete(oldestKey);
        }
    }
}

/**
 * Module-level registry of every created handle, so a workspace can be cleared
 * across all namespaces at once via {@link invalidateWorkspaceForAll}.
 */
const registry = new Set<InMemoryCache<unknown>>();

/** Create a typed, namespaced cache handle and register it. */
export function createCache<T>(options: CreateCacheOptions): CacheHandle<T> {
    const handle = new InMemoryCache<T>(options);
    registry.add(handle as InMemoryCache<unknown>);
    return handle;
}

/** Clear every entry tagged with `workspaceId` across all registered namespaces. */
export function invalidateWorkspaceForAll(workspaceId: string): void {
    for (const handle of registry) {
        handle.invalidateWorkspace(workspaceId);
    }
}

/** Number of registered cache handles. Primarily for tests/diagnostics. */
export function registeredCacheCount(): number {
    return registry.size;
}
