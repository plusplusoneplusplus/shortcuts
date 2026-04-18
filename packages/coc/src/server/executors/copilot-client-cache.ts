/**
 * CopilotClientCache
 *
 * Caches one CopilotClient per active CoC process at the executor layer,
 * eliminating the N+1 child-process spawn overhead for conversations with
 * follow-up messages.
 *
 * Lifecycle:
 * - On first AI call for a process: `acquire()` spawns a client and caches it.
 *   The idle timer is **paused** while the client is acquired (active).
 * - When the AI call completes: `markIdle(processId)` starts the idle timer.
 *   If no follow-up arrives within the timeout, the client is auto-released.
 * - On follow-up: `acquire()` returns the cached client and pauses the timer.
 * - `release(processId)` stops the client immediately (e.g. on process end).
 * - `disposeAll()` stops every cached client on server shutdown.
 *
 * Clients are scoped per `processId` (not shared across repos) to preserve
 * multi-repo safety.
 *
 * **Pre-warmed idle pool:** On startup, `initialize()` pre-spawns a
 * configurable number of "blank" CopilotClient processes (no cwd). When
 * `acquire()` needs a new client, it pops one from the pool instead of
 * spawning — reducing first-message latency. Released clients are recycled
 * back into the pool when under capacity. Idle pool clients older than
 * `poolIdleMaxAgeMs` (default 5 min) are rotated out and replaced.
 */

import type { CopilotSDKService } from '@plusplusoneplusplus/forge';
import type { CopilotClient } from '@github/copilot-sdk';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';

export interface CachedClient {
    client: CopilotClient;
    idleTimer: ReturnType<typeof setTimeout> | null;
    workingDirectory: string | undefined;
    /** True while an AI call is in progress — idle timer must not run. */
    active: boolean;
}

/** A pre-warmed client sitting in the idle pool. */
export interface PoolEntry {
    client: CopilotClient;
    createdAt: number;
}

export interface CopilotClientCacheOptions {
    /** Idle timeout in milliseconds before a cached client is auto-disposed. Default: 10 minutes. */
    idleTimeoutMs?: number;
    /** Number of pre-warmed idle clients to maintain. Default: 3. Set to 0 to disable. */
    poolSize?: number;
    /** Maximum age (ms) for idle pool clients before rotation. Default: 5 minutes. */
    poolIdleMaxAgeMs?: number;
    /** Whether the pool feature is enabled. Default: true. */
    poolEnabled?: boolean;
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_POOL_SIZE = 3;
const DEFAULT_POOL_IDLE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const ROTATION_INTERVAL_MS = 60 * 1000; // check every minute

export class CopilotClientCache {
    private readonly cache = new Map<string, CachedClient>();
    private readonly idleTimeoutMs: number;
    private aiService: CopilotSDKService | undefined;

    // Pool state
    private readonly pool: PoolEntry[] = [];
    private readonly poolSize: number;
    private readonly poolIdleMaxAgeMs: number;
    private readonly poolEnabled: boolean;
    private rotationTimer: ReturnType<typeof setInterval> | null = null;
    private replenishing = false;

    constructor(options?: CopilotClientCacheOptions) {
        this.idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        this.poolSize = options?.poolSize ?? DEFAULT_POOL_SIZE;
        this.poolIdleMaxAgeMs = options?.poolIdleMaxAgeMs ?? DEFAULT_POOL_IDLE_MAX_AGE_MS;
        this.poolEnabled = options?.poolEnabled ?? true;
    }

    /** Bind the AI service used to create clients. Must be called before `acquire`. */
    setAIService(aiService: CopilotSDKService): void {
        this.aiService = aiService;
    }

    /**
     * Pre-warm the idle pool by spawning `poolSize` blank clients.
     * Call after `setAIService()` during server startup.
     * No-op if the pool is disabled or aiService is not set.
     */
    async initialize(): Promise<void> {
        if (!this.poolEnabled || this.poolSize <= 0 || !this.aiService) return;

        const logger = getLogger();
        logger.debug(LogCategory.AI, `[ClientCache] Pre-warming pool with ${this.poolSize} clients`);

        await this.replenish();
        this.startRotationTimer();
    }

    /**
     * Acquire a CopilotClient for the given process: return the cached one or
     * create a new one.  The idle timer is **cleared** — the client is
     * considered active until `markIdle()` or `release()` is called.
     *
     * @deprecated Use `acquire()` instead of `getOrCreate()` — same behavior.
     */
    async getOrCreate(processId: string, workingDirectory?: string): Promise<CopilotClient> {
        return this.acquire(processId, workingDirectory);
    }

    /**
     * Acquire a CopilotClient for the given process: return the cached one or
     * create a new one.  The idle timer is **cleared** while the client is
     * active — it will not be auto-released mid-call.
     *
     * When the idle pool has entries, pops one instead of spawning a new process.
     */
    async acquire(processId: string, workingDirectory?: string): Promise<CopilotClient> {
        const entry = this.cache.get(processId);
        if (entry) {
            // Client is now active — clear the idle timer so we don't kill it
            this.clearIdleTimer(entry);
            entry.active = true;
            return entry.client;
        }

        if (!this.aiService) {
            throw new Error('CopilotClientCache: aiService not set — call setAIService() first');
        }

        const logger = getLogger();
        let client: CopilotClient;

        // Try to pop from idle pool
        const poolEntry = this.pool.shift();
        if (poolEntry) {
            logger.debug(LogCategory.AI, `[ClientCache] Popped pooled client for process ${processId} (pool: ${this.pool.length})`);
            client = poolEntry.client;
            // Trigger async replenish to keep pool full
            this.replenish().catch(() => {});
        } else {
            logger.debug(LogCategory.AI, `[ClientCache] Creating client for process ${processId}`);
            client = await this.aiService.createClient(workingDirectory);
        }

        const cached: CachedClient = { client, idleTimer: null, workingDirectory, active: true };
        this.cache.set(processId, cached);

        return client;
    }

    /**
     * Mark a client as idle — starts (or restarts) the idle timer.
     * Called when an AI call completes and the client is returned to the pool.
     * If the process is not in the cache, this is a no-op.
     */
    markIdle(processId: string): void {
        const entry = this.cache.get(processId);
        if (!entry) return;
        entry.active = false;
        this.resetIdleTimer(processId, entry);
    }

    /** Check whether a client is cached for the given process. */
    has(processId: string): boolean {
        return this.cache.has(processId);
    }

    /** Number of cached (per-process) clients. */
    get size(): number {
        return this.cache.size;
    }

    /** Number of pre-warmed idle clients in the pool. */
    get poolCurrentSize(): number {
        return this.pool.length;
    }

    /**
     * Release (stop or recycle) the cached client for a process.
     * If the pool is enabled and under capacity, healthy clients are recycled
     * back into the idle pool instead of being stopped.
     * Safe to call even if no client is cached.
     */
    async release(processId: string): Promise<void> {
        const entry = this.cache.get(processId);
        if (!entry) return;

        const logger = getLogger();
        this.clearIdleTimer(entry);
        this.cache.delete(processId);

        // Recycle into pool if under capacity
        if (this.poolEnabled && this.pool.length < this.poolSize) {
            logger.debug(LogCategory.AI, `[ClientCache] Recycling client from process ${processId} into pool (pool: ${this.pool.length + 1})`);
            this.pool.push({ client: entry.client, createdAt: Date.now() });
            return;
        }

        logger.debug(LogCategory.AI, `[ClientCache] Releasing client for process ${processId}`);
        try {
            await entry.client.stop();
        } catch {
            // Non-fatal: client may already be stopped
        }
    }

    /**
     * Stop and remove all cached clients and pool clients. Called on server shutdown.
     */
    async disposeAll(): Promise<void> {
        const logger = getLogger();
        logger.debug(LogCategory.AI, `[ClientCache] Disposing all clients (cached: ${this.cache.size}, pool: ${this.pool.length})`);

        this.stopRotationTimer();

        // Collect all clients to stop
        const entries = [...this.cache.entries()];
        this.cache.clear();

        const poolEntries = this.pool.splice(0);

        await Promise.allSettled([
            ...entries.map(async ([, entry]) => {
                this.clearIdleTimer(entry);
                try {
                    await entry.client.stop();
                } catch {
                    // Non-fatal
                }
            }),
            ...poolEntries.map(async (pe) => {
                try {
                    await pe.client.stop();
                } catch {
                    // Non-fatal
                }
            }),
        ]);
    }

    // ========================================================================
    // Pool internals
    // ========================================================================

    /**
     * Spawn clients to fill the pool up to `poolSize`.
     * Serialized via `replenishing` flag to avoid concurrent spawn storms.
     */
    private async replenish(): Promise<void> {
        if (!this.poolEnabled || !this.aiService || this.replenishing) return;
        this.replenishing = true;
        try {
            const logger = getLogger();
            const needed = this.poolSize - this.pool.length;
            if (needed <= 0) return;

            const results = await Promise.allSettled(
                Array.from({ length: needed }, () => this.aiService!.createClient()),
            );
            const now = Date.now();
            for (const r of results) {
                if (r.status === 'fulfilled') {
                    this.pool.push({ client: r.value, createdAt: now });
                } else {
                    logger.debug(LogCategory.AI, `[ClientCache] Pool replenish failed: ${r.reason}`);
                }
            }
            logger.debug(LogCategory.AI, `[ClientCache] Pool replenished (size: ${this.pool.length})`);
        } finally {
            this.replenishing = false;
        }
    }

    /**
     * Remove pool entries older than `poolIdleMaxAgeMs` and replenish.
     */
    private async rotateStale(): Promise<void> {
        if (!this.poolEnabled || this.pool.length === 0) return;

        const now = Date.now();
        const stale: PoolEntry[] = [];
        const fresh: PoolEntry[] = [];

        for (const entry of this.pool) {
            if (now - entry.createdAt > this.poolIdleMaxAgeMs) {
                stale.push(entry);
            } else {
                fresh.push(entry);
            }
        }

        if (stale.length === 0) return;

        const logger = getLogger();
        logger.debug(LogCategory.AI, `[ClientCache] Rotating ${stale.length} stale pool clients`);

        // Replace pool contents with fresh entries only
        this.pool.length = 0;
        this.pool.push(...fresh);

        // Stop stale clients in parallel
        await Promise.allSettled(
            stale.map(async (pe) => {
                try { await pe.client.stop(); } catch { /* non-fatal */ }
            }),
        );

        // Replenish to fill back up
        await this.replenish();
    }

    private startRotationTimer(): void {
        if (this.rotationTimer) return;
        this.rotationTimer = setInterval(() => {
            this.rotateStale().catch(() => {});
        }, ROTATION_INTERVAL_MS);
        // Unref so it doesn't keep Node alive
        if (this.rotationTimer && typeof this.rotationTimer === 'object' && 'unref' in this.rotationTimer) {
            this.rotationTimer.unref();
        }
    }

    private stopRotationTimer(): void {
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
        }
    }

    // ========================================================================
    // Per-process timer internals
    // ========================================================================

    private clearIdleTimer(entry: CachedClient): void {
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
            entry.idleTimer = null;
        }
    }

    private resetIdleTimer(processId: string, entry: CachedClient): void {
        this.clearIdleTimer(entry);
        entry.idleTimer = setTimeout(() => {
            const logger = getLogger();
            logger.debug(LogCategory.AI, `[ClientCache] Idle timeout for process ${processId}`);
            this.release(processId).catch(() => {});
        }, this.idleTimeoutMs);

        // Unref the timer so it doesn't keep Node alive during shutdown
        if (entry.idleTimer && typeof entry.idleTimer === 'object' && 'unref' in entry.idleTimer) {
            entry.idleTimer.unref();
        }
    }
}
