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

export interface CopilotClientCacheOptions {
    /** Idle timeout in milliseconds before a cached client is auto-disposed. Default: 10 minutes. */
    idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export class CopilotClientCache {
    private readonly cache = new Map<string, CachedClient>();
    private readonly idleTimeoutMs: number;
    private aiService: CopilotSDKService | undefined;

    constructor(options?: CopilotClientCacheOptions) {
        this.idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    }

    /** Bind the AI service used to create clients. Must be called before `acquire`. */
    setAIService(aiService: CopilotSDKService): void {
        this.aiService = aiService;
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
        logger.debug(LogCategory.AI, `[ClientCache] Creating client for process ${processId}`);
        const client = await this.aiService.createClient(workingDirectory);

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

    /** Number of cached clients. */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Release (stop) the cached client for a process and remove it from the cache.
     * Safe to call even if no client is cached.
     */
    async release(processId: string): Promise<void> {
        const entry = this.cache.get(processId);
        if (!entry) return;

        const logger = getLogger();
        logger.debug(LogCategory.AI, `[ClientCache] Releasing client for process ${processId}`);

        this.clearIdleTimer(entry);
        this.cache.delete(processId);

        try {
            await entry.client.stop();
        } catch {
            // Non-fatal: client may already be stopped
        }
    }

    /**
     * Stop and remove all cached clients. Called on server shutdown.
     */
    async disposeAll(): Promise<void> {
        const logger = getLogger();
        logger.debug(LogCategory.AI, `[ClientCache] Disposing all cached clients (${this.cache.size})`);

        const entries = [...this.cache.entries()];
        this.cache.clear();

        await Promise.allSettled(
            entries.map(async ([, entry]) => {
                this.clearIdleTimer(entry);
                try {
                    await entry.client.stop();
                } catch {
                    // Non-fatal
                }
            }),
        );
    }

    // ========================================================================
    // Internal
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
