/**
 * In-memory cache for per-workspace git-info results.
 *
 * Stale-then-wait policy:
 *   - Fresh entry (age ≤ STALE_THRESHOLD_MS): return cached data immediately.
 *   - Stale / missing entry: await the in-flight fetch (or trigger one) before returning.
 *
 * A background interval (REFRESH_PERIOD_MS) proactively re-fetches all known workspaces
 * so that most batch requests hit the fresh branch.
 *
 * Invalidation:  `invalidate(workspaceId)` marks an entry stale and immediately triggers
 * a fresh fetch.  Call it after any git mutation (push, pull, commit, branch switch, …).
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';

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

interface GitInfoEntry {
    data: GitInfoResult;
    /** Epoch ms of the last successful fetch */
    lastFetchedAt: number;
    /** In-flight fetch promise, or null if idle */
    inflight: Promise<GitInfoResult> | null;
}

// ============================================================================
// Constants
// ============================================================================

export const REFRESH_PERIOD_MS = 30_000;
export const STALE_THRESHOLD_MS = 90_000;

const BACKGROUND_CONCURRENCY = 4;

// ============================================================================
// GitInfoCacheService
// ============================================================================

/**
 * Per-workspace git-info cache with background refresh and invalidation.
 *
 * Lifecycle:
 *   1. `start(store, fetchFn)` — begin background refresh; call once after server start.
 *   2. `getOrFetch(workspaceId)` — serve requests (stale-then-wait).
 *   3. `invalidate(workspaceId)` — called on any git mutation (hooks into broadcastGitChanged).
 *   4. `dispose()` — stop background timer; call during server shutdown.
 */
export class GitInfoCacheService {
    private entries = new Map<string, GitInfoEntry>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private fetchFn: ((workspaceId: string) => Promise<GitInfoResult>) | null = null;
    private store: ProcessStore | null = null;

    // ──────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Start the background refresh interval.
     *
     * @param store    Used by the background job to enumerate known workspaces.
     * @param fetchFn  Async function that fetches git-info for one workspace by ID.
     */
    start(store: ProcessStore, fetchFn: (workspaceId: string) => Promise<GitInfoResult>): void {
        this.fetchFn = fetchFn;
        this.store = store;
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
        this.store = null;
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
        if (entry && entry.lastFetchedAt > 0) {
            this.entries.set(workspaceId, { ...entry, lastFetchedAt: 0 });
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
        const entry = this.entries.get(workspaceId);

        if (!entry) {
            return this.triggerFetch(workspaceId);
        }

        const age = Date.now() - entry.lastFetchedAt;
        if (age <= STALE_THRESHOLD_MS) {
            return entry.data;
        }

        // Stale: await the existing in-flight fetch, or trigger a new one
        return entry.inflight ?? this.triggerFetch(workspaceId);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Background job: re-fetch all known workspaces at most CONCURRENCY at a time.
     */
    private async refreshAll(): Promise<void> {
        if (!this.store) return;
        const workspaces = await this.store.getWorkspaces();
        const ids = workspaces.map((w: { id: string }) => w.id);
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
        const inflight = this.fetchFn(workspaceId)
            .then(data => {
                this.entries.set(workspaceId, { data, lastFetchedAt: Date.now(), inflight: null });
                return data;
            })
            .catch(err => {
                // Clear inflight so the next call retries instead of hanging
                const e = this.entries.get(workspaceId);
                if (e) this.entries.set(workspaceId, { ...e, inflight: null });
                throw err;
            });

        this.entries.set(workspaceId, {
            data: existing?.data ?? stub,
            lastFetchedAt: existing?.lastFetchedAt ?? 0,
            inflight,
        });

        return inflight;
    }
}

// ============================================================================
// Singleton
// ============================================================================

export const gitInfoCache = new GitInfoCacheService();
