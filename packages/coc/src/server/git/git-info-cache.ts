/**
 * In-memory cache for per-workspace git-info results.
 *
 * Stale-then-wait policy:
 *   - Fresh entry (age ≤ STALE_THRESHOLD_MS): return cached data immediately.
 *   - Stale / missing entry: await the in-flight fetch (or trigger one) before returning.
 *
 * A background interval (REFRESH_PERIOD_MS) proactively re-fetches only the workspaces a
 * dashboard client currently has open (the "active" set), so that those views hit the
 * fresh branch.  Workspaces nobody is viewing are not refreshed in the background; they
 * are still served lazily on demand via the stale-then-wait path. When no client is
 * connected (empty active set), the background tick does zero git work.
 *
 * Invalidation:  `invalidate(workspaceId)` marks an entry stale and immediately triggers
 * a fresh fetch.  Call it after any git mutation (push, pull, commit, branch switch, …).
 */

// ============================================================================
// Types
// ============================================================================

export interface GitInfoResult {
    branch: string | null;
    dirty: boolean;
    isGitRepo: boolean;
    remoteUrl: string | null;
    ahead?: number;
    behind?: number;
}

export type GitInfoCacheOutcome = 'hit' | 'miss' | 'stale' | 'invalidated' | 'inflight' | 'error-retry';

export interface GitInfoFetchValue {
    data: GitInfoResult;
    gitProcessCount: number;
    gitDurationMs: number;
    /** A completed live read that should be served with retry backoff. */
    error?: boolean;
}

export interface GitInfoCacheRead {
    data: GitInfoResult;
    outcome: GitInfoCacheOutcome;
    gitProcessCount: number;
    gitDurationMs: number;
}

interface GitInfoEntry {
    data: GitInfoResult;
    /** Epoch ms of the last successful fetch */
    lastFetchedAt: number;
    /** In-flight fetch promise, or null if idle */
    inflight: Promise<GitInfoResult> | null;
    /** True between explicit invalidation and the next successful fetch. */
    invalidated: boolean;
    /** Consecutive fetch failures used to calculate bounded retry backoff. */
    failureCount: number;
    /** Epoch ms before which a failed fetch returns its cached fallback. */
    retryAfter: number;
    /** Metrics for the most recently completed live fetch. */
    lastGitProcessCount: number;
    lastGitDurationMs: number;
}

// ============================================================================
// Constants
// ============================================================================

export const REFRESH_PERIOD_MS = 300_000;
export const STALE_THRESHOLD_MS = 600_000;
export const ERROR_BACKOFF_BASE_MS = 30_000;
export const ERROR_BACKOFF_MAX_MS = 300_000;

const BACKGROUND_CONCURRENCY = 4;

// ============================================================================
// GitInfoCacheService
// ============================================================================

/**
 * Per-workspace git-info cache with background refresh and invalidation.
 *
 * Lifecycle:
 *   1. `start(fetchFn, getActiveWorkspaceIds)` — begin background refresh; call once after server start.
 *   2. `getOrFetch(workspaceId)` — serve requests (stale-then-wait).
 *   3. `invalidate(workspaceId)` — called on any git mutation (hooks into broadcastGitChanged).
 *   4. `dispose()` — stop background timer; call during server shutdown.
 */
export class GitInfoCacheService {
    private entries = new Map<string, GitInfoEntry>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private fetchFn: ((workspaceId: string) => Promise<GitInfoResult | GitInfoFetchValue>) | null = null;
    private getActiveWorkspaceIds: (() => string[]) | null = null;

    // ──────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Start the background refresh interval.
     *
     * @param fetchFn               Async function that fetches git-info for one workspace by ID.
     * @param getActiveWorkspaceIds Source of the workspace ids a dashboard client currently has
     *                              open. The background job refreshes only these; an empty result
     *                              means the tick performs no git work.
     */
    start(
        fetchFn: (workspaceId: string) => Promise<GitInfoResult | GitInfoFetchValue>,
        getActiveWorkspaceIds: () => string[],
    ): void {
        this.fetchFn = fetchFn;
        this.getActiveWorkspaceIds = getActiveWorkspaceIds;
        this.timer = setInterval(() => { this.refreshAll().catch(() => { /* best-effort */ }); }, REFRESH_PERIOD_MS);
        // Don't prevent Node.js from exiting cleanly
        if ((this.timer as any).unref) (this.timer as any).unref();
    }

    /** Stop background refresh and clear all cached entries. */
    dispose(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.entries.clear();
        this.fetchFn = null;
        this.getActiveWorkspaceIds = null;
    }

    /** Drop all cached entries without stopping the background refresh. Used by tests. */
    clear(): void {
        this.entries.clear();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Mark a workspace's entry as stale and immediately kick off a fresh fetch.
     * Called after any git mutation event for the given workspace.
     */
    invalidate(workspaceId: string): void {
        const entry = this.entries.get(workspaceId);
        if (entry) {
            this.entries.set(workspaceId, {
                ...entry,
                lastFetchedAt: 0,
                invalidated: true,
                retryAfter: 0,
                failureCount: 0,
            });
        }
        // Fire-and-forget — best effort re-warm; errors are swallowed
        this.triggerFetch(workspaceId).catch(() => { /* best-effort */ });
    }

    /**
     * Return git-info for a workspace, applying the stale-then-wait policy.
     *
     * - Fresh (age ≤ STALE_THRESHOLD_MS): return cached data immediately.
     * - Stale / missing: await in-flight fetch (or start one) before returning.
     */
    async getOrFetch(workspaceId: string): Promise<GitInfoResult> {
        return (await this.getOrFetchWithOutcome(workspaceId)).data;
    }

    /** Return git-info together with cache and subprocess observability metadata. */
    async getOrFetchWithOutcome(workspaceId: string): Promise<GitInfoCacheRead> {
        const entry = this.entries.get(workspaceId);

        if (!entry) {
            const data = await this.triggerFetch(workspaceId);
            const completed = this.entries.get(workspaceId);
            return this.buildRead(data, completed?.failureCount ? 'error-retry' : 'miss', completed, true);
        }

        if (entry.inflight) {
            const data = await entry.inflight;
            return this.buildRead(data, entry.invalidated ? 'invalidated' : 'inflight', this.entries.get(workspaceId), false);
        }

        if (entry.retryAfter > Date.now()) {
            return this.buildRead(entry.data, 'error-retry', entry, false);
        }

        const age = Date.now() - entry.lastFetchedAt;
        if (age <= STALE_THRESHOLD_MS) {
            return this.buildRead(entry.data, 'hit', entry, false);
        }

        const outcome: GitInfoCacheOutcome = entry.invalidated ? 'invalidated' : entry.failureCount > 0 ? 'error-retry' : 'stale';
        const data = await this.triggerFetch(workspaceId);
        return this.buildRead(data, outcome, this.entries.get(workspaceId), true);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Background job: re-fetch only the currently-active workspaces, at most CONCURRENCY
     * at a time. When the active set is empty (no connected client), this is a no-op.
     */
    private async refreshAll(): Promise<void> {
        if (!this.getActiveWorkspaceIds) return;
        const ids = this.getActiveWorkspaceIds();
        for (let i = 0; i < ids.length; i += BACKGROUND_CONCURRENCY) {
            const batch = ids.slice(i, i + BACKGROUND_CONCURRENCY);
            await Promise.all(batch.map((id: string) => this.triggerFetch(id).catch(() => { /* per-workspace errors are non-fatal */ })));
        }
    }

    /**
     * Start (or return the existing) in-flight fetch for a workspace.
     * Resolves/rejects when the fetch completes; updates the entry on success.
     */
    private triggerFetch(workspaceId: string): Promise<GitInfoResult> {
        if (!this.fetchFn) {
            return Promise.reject(new Error('GitInfoCacheService not started'));
        }

        const existing = this.entries.get(workspaceId);

        // Reuse existing in-flight promise to avoid duplicate fetches
        if (existing?.inflight) return existing.inflight;

        const stub: GitInfoResult = { branch: null, dirty: false, isGitRepo: false, remoteUrl: null };
        const startedAt = Date.now();
        const inflight = this.fetchFn(workspaceId)
            .then(value => {
                const measuredDurationMs = Math.max(0, Date.now() - startedAt);
                const wrapped = 'data' in value && 'gitProcessCount' in value;
                const data = wrapped ? value.data : value;
                if (wrapped && value.error) {
                    const current = this.entries.get(workspaceId);
                    const failureCount = (current?.failureCount ?? 0) + 1;
                    const backoffMs = Math.min(ERROR_BACKOFF_MAX_MS, ERROR_BACKOFF_BASE_MS * (2 ** (failureCount - 1)));
                    this.entries.set(workspaceId, {
                        data,
                        lastFetchedAt: 0,
                        inflight: null,
                        invalidated: false,
                        failureCount,
                        retryAfter: Date.now() + backoffMs,
                        lastGitProcessCount: value.gitProcessCount,
                        lastGitDurationMs: value.gitDurationMs,
                    });
                    return data;
                }
                this.entries.set(workspaceId, {
                    data,
                    lastFetchedAt: Date.now(),
                    inflight: null,
                    invalidated: false,
                    failureCount: 0,
                    retryAfter: 0,
                    lastGitProcessCount: wrapped ? value.gitProcessCount : 0,
                    lastGitDurationMs: wrapped ? value.gitDurationMs : measuredDurationMs,
                });
                return data;
            })
            .catch(() => {
                const current = this.entries.get(workspaceId);
                const failureCount = (current?.failureCount ?? 0) + 1;
                const backoffMs = Math.min(ERROR_BACKOFF_MAX_MS, ERROR_BACKOFF_BASE_MS * (2 ** (failureCount - 1)));
                const data = current?.data ?? stub;
                this.entries.set(workspaceId, {
                    data,
                    lastFetchedAt: 0,
                    inflight: null,
                    invalidated: false,
                    failureCount,
                    retryAfter: Date.now() + backoffMs,
                    lastGitProcessCount: 0,
                    lastGitDurationMs: Math.max(0, Date.now() - startedAt),
                });
                return data;
            });

        this.entries.set(workspaceId, {
            data: existing?.data ?? stub,
            lastFetchedAt: existing?.lastFetchedAt ?? 0,
            inflight,
            invalidated: existing?.invalidated ?? false,
            failureCount: existing?.failureCount ?? 0,
            retryAfter: existing?.retryAfter ?? 0,
            lastGitProcessCount: 0,
            lastGitDurationMs: 0,
        });

        return inflight;
    }

    private buildRead(
        data: GitInfoResult,
        outcome: GitInfoCacheOutcome,
        entry: GitInfoEntry | undefined,
        includeLiveMetrics: boolean,
    ): GitInfoCacheRead {
        return {
            data,
            outcome,
            gitProcessCount: includeLiveMetrics ? entry?.lastGitProcessCount ?? 0 : 0,
            gitDurationMs: includeLiveMetrics ? entry?.lastGitDurationMs ?? 0 : 0,
        };
    }
}

// ============================================================================
// Singleton
// ============================================================================

export const gitInfoCache = new GitInfoCacheService();
