/**
 * Memory Promotion — config for queued candidate promotion.
 *
 * Automatic full-list rewrites are disabled. Promotion is append-only:
 * selected candidates are added after existing bounded memory entries.
 */

// ── Configuration ──────────────────────────────────────────────────

export interface MemoryPromoteConfig {
    /** Maximum pending candidates to inspect per run (default: 50). */
    batchSize: number;
    /** Timeout budget reserved for future promotion policies (default: 90_000). */
    timeoutMs: number;
    /** Model to use (default: use server's default model). */
    model?: string;
    /** Optional AI pass that can normalize selected candidate text only. */
    aiNormalization: {
        /** Disabled by default until proven useful. */
        enabled: boolean;
        /** Timeout for the normalization-only AI request (default: 60_000). */
        timeoutMs: number;
        /** Optional model override for candidate normalization. */
        model?: string;
    };
    lock?: {
        waitTimeoutMs: number;
        staleMs: number;
        retryIntervalMs: number;
    };
}

export const DEFAULT_PROMOTE_CONFIG: MemoryPromoteConfig = {
    batchSize: 50,
    timeoutMs: 90_000,
    model: undefined,
    aiNormalization: {
        enabled: false,
        timeoutMs: 60_000,
        model: undefined,
    },
    lock: {
        waitTimeoutMs: 10_000,
        staleMs: 60_000,
        retryIntervalMs: 100,
    },
};
