/**
 * CopilotClientCache
 *
 * Caches one CopilotClient per active CoC process at the executor layer,
 * eliminating the N+1 child-process spawn overhead for conversations with
 * follow-up messages.
 *
 * Lifecycle:
 * - On first AI call for a process: `getOrCreate()` spawns a client and caches it.
 * - On follow-up: `getOrCreate()` returns the cached client (same child process).
 * - An idle timer (default 10 min) auto-disposes unused clients.
 * - `release(processId)` stops the client when a process ends.
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

    /** Bind the AI service used to create clients. Must be called before `getOrCreate`. */
    setAIService(aiService: CopilotSDKService): void {
        this.aiService = aiService;
    }

    /**
     * Return a cached CopilotClient for the given process, or create and cache
     * a new one. Resets the idle timer on every call.
     */
    async getOrCreate(processId: string, workingDirectory?: string): Promise<CopilotClient> {
        const entry = this.cache.get(processId);
        if (entry) {
            this.resetIdleTimer(processId, entry);
            return entry.client;
        }

        if (!this.aiService) {
            throw new Error('CopilotClientCache: aiService not set — call setAIService() first');
        }

        const logger = getLogger();
        logger.debug(LogCategory.AI, `[ClientCache] Creating client for process ${processId}`);
        const client = await this.aiService.createClient(workingDirectory);

        const cached: CachedClient = { client, idleTimer: null, workingDirectory };
        this.cache.set(processId, cached);
        this.resetIdleTimer(processId, cached);

        return client;
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

        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
        }
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
                if (entry.idleTimer) clearTimeout(entry.idleTimer);
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

    private resetIdleTimer(processId: string, entry: CachedClient): void {
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
        }
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
