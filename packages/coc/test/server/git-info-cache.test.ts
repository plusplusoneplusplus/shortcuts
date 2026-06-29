/**
 * Unit tests for GitInfoCacheService
 *
 * Covers:
 *  - getOrFetch: cold (no entry) → awaits fetch
 *  - getOrFetch: fresh entry → returns cached data immediately (no fetch)
 *  - getOrFetch: stale entry → awaits fetch
 *  - getOrFetch: stale entry with in-flight → reuses the in-flight promise
 *  - invalidate: marks entry stale + triggers a re-fetch
 *  - invalidate: on unknown workspace → still triggers a fetch
 *  - concurrent getOrFetch calls on same cold workspace → single fetch
 *  - fetchFn error → clears inflight so next call retries
 *  - background refresh → calls fetchFn only for the active workspaces
 *  - background refresh → empty active set triggers zero fetches
 *  - getOrFetch on an inactive workspace → still lazily fetches
 *  - dispose → clears timer and entries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitInfoCacheService, REFRESH_PERIOD_MS, STALE_THRESHOLD_MS } from '../../src/server/git/git-info-cache';
import type { GitInfoResult } from '../../src/server/git/git-info-cache';

// ── Helpers ──────────────────────────────────────────────────────────────────

const RESULT_A: GitInfoResult = { branch: 'main', dirty: false, isGitRepo: true, remoteUrl: null, ahead: 0, behind: 0 };
const RESULT_B: GitInfoResult = { branch: 'feat/x', dirty: true, isGitRepo: true, remoteUrl: 'https://github.com/x/y.git', ahead: 1, behind: 0 };

/** Build a `getActiveWorkspaceIds` callback that always reports the given active ids. */
function activeIds(ids: string[] = ['ws-a']) {
    return vi.fn(() => ids);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GitInfoCacheService constants', () => {
    it('uses a 5-minute proactive refresh period', () => {
        expect(REFRESH_PERIOD_MS).toBe(300_000);
    });

    it('keeps the stale threshold above the refresh period', () => {
        // Reads served between background cycles must hit cached data, not force a
        // synchronous git status. Requires STALE_THRESHOLD_MS > REFRESH_PERIOD_MS.
        expect(STALE_THRESHOLD_MS).toBeGreaterThan(REFRESH_PERIOD_MS);
    });
});

describe('GitInfoCacheService', () => {
    let cache: GitInfoCacheService;
    let fetchFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        cache = new GitInfoCacheService();
        fetchFn = vi.fn().mockResolvedValue(RESULT_A);
    });

    afterEach(() => {
        cache.dispose();
        vi.useRealTimers();
    });

    // ── Cold miss ─────────────────────────────────────────────────────────────

    it('fetches when no entry exists (cold miss)', async () => {
        cache.start(fetchFn, activeIds(['ws-a']));
        const result = await cache.getOrFetch('ws-a');
        expect(result).toEqual(RESULT_A);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(fetchFn).toHaveBeenCalledWith('ws-a');
    });

    // ── Fresh hit ─────────────────────────────────────────────────────────────

    it('returns cached data immediately for fresh entry (no re-fetch)', async () => {
        cache.start(fetchFn, activeIds(['ws-a']));
        await cache.getOrFetch('ws-a');  // warm up
        fetchFn.mockClear();

        const result = await cache.getOrFetch('ws-a');
        expect(result).toEqual(RESULT_A);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    // ── Stale hit ─────────────────────────────────────────────────────────────

    it('re-fetches when entry is stale (age > STALE_THRESHOLD_MS)', async () => {
        // Empty active set: isolate getOrFetch staleness from any background tick.
        cache.start(fetchFn, activeIds([]));
        await cache.getOrFetch('ws-a');  // warm up
        fetchFn.mockResolvedValue(RESULT_B);
        fetchFn.mockClear();

        // Advance time past the stale threshold
        vi.advanceTimersByTime(STALE_THRESHOLD_MS + 1);

        const result = await cache.getOrFetch('ws-a');
        expect(result).toEqual(RESULT_B);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    // ── Entry just inside fresh window ────────────────────────────────────────

    it('does not re-fetch when entry age equals STALE_THRESHOLD_MS exactly', async () => {
        // Empty active set: isolate getOrFetch staleness from any background tick.
        cache.start(fetchFn, activeIds([]));
        await cache.getOrFetch('ws-a');  // warm up
        fetchFn.mockClear();

        // Advance to exactly the threshold (not past it)
        vi.advanceTimersByTime(STALE_THRESHOLD_MS);

        await cache.getOrFetch('ws-a');
        expect(fetchFn).not.toHaveBeenCalled();
    });

    // ── Concurrent calls on cold workspace ───────────────────────────────────

    it('concurrent getOrFetch calls on the same cold workspace share one in-flight fetch', async () => {
        let resolveA!: (v: GitInfoResult) => void;
        fetchFn.mockImplementation(() => new Promise<GitInfoResult>(r => { resolveA = r; }));
        cache.start(fetchFn, activeIds(['ws-a']));

        const p1 = cache.getOrFetch('ws-a');
        const p2 = cache.getOrFetch('ws-a');
        resolveA(RESULT_A);

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toEqual(RESULT_A);
        expect(r2).toEqual(RESULT_A);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    // ── Stale entry with in-flight ────────────────────────────────────────────

    it('reuses the in-flight promise when entry is stale but fetch already in flight', async () => {
        // Empty active set: isolate getOrFetch staleness from any background tick.
        cache.start(fetchFn, activeIds([]));
        await cache.getOrFetch('ws-a');  // warm up

        // Force stale
        vi.advanceTimersByTime(STALE_THRESHOLD_MS + 1);

        let resolve!: (v: GitInfoResult) => void;
        fetchFn.mockClear();
        fetchFn.mockImplementation(() => new Promise<GitInfoResult>(r => { resolve = r; }));

        const p1 = cache.getOrFetch('ws-a');  // triggers fetch
        const p2 = cache.getOrFetch('ws-a');  // should reuse inflight

        resolve(RESULT_B);
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toEqual(RESULT_B);
        expect(r2).toEqual(RESULT_B);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    // ── Invalidation ─────────────────────────────────────────────────────────

    it('invalidate marks entry stale and triggers a fresh fetch', async () => {
        cache.start(fetchFn, activeIds(['ws-a']));
        await cache.getOrFetch('ws-a');  // warm up

        fetchFn.mockResolvedValue(RESULT_B);
        fetchFn.mockClear();

        cache.invalidate('ws-a');

        // Drain the microtask queue so the fire-and-forget re-fetch completes
        await Promise.resolve();
        await Promise.resolve();

        fetchFn.mockClear();
        const result = await cache.getOrFetch('ws-a');
        // Entry was refreshed by invalidate — should return RESULT_B without another call
        expect(result).toEqual(RESULT_B);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('invalidate on unknown workspace triggers a fetch', async () => {
        cache.start(fetchFn, activeIds(['ws-a']));

        cache.invalidate('ws-a');  // no prior entry

        // Let the inflight settle
        await Promise.resolve();
        await Promise.resolve();

        expect(fetchFn).toHaveBeenCalledWith('ws-a');
    });

    // ── fetchFn error handling ────────────────────────────────────────────────

    it('clears inflight on fetchFn error so next call retries', async () => {
        fetchFn.mockRejectedValueOnce(new Error('git error'));
        fetchFn.mockResolvedValue(RESULT_A);
        cache.start(fetchFn, activeIds(['ws-a']));

        await expect(cache.getOrFetch('ws-a')).rejects.toThrow('git error');

        const result = await cache.getOrFetch('ws-a');
        expect(result).toEqual(RESULT_A);
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    // ── Background refresh ────────────────────────────────────────────────────

    it('background refresh re-fetches the active workspaces after REFRESH_PERIOD_MS', async () => {
        cache.start(fetchFn, activeIds(['ws-a', 'ws-b']));

        // Advance past the refresh interval
        await vi.advanceTimersByTimeAsync(REFRESH_PERIOD_MS + 100);

        expect(fetchFn).toHaveBeenCalledWith('ws-a');
        expect(fetchFn).toHaveBeenCalledWith('ws-b');
    });

    it('background refresh fetches only active workspaces, not every registered one', async () => {
        // Active set is just 'ws-a'; 'ws-b'/'ws-c' are registered but inactive.
        cache.start(fetchFn, activeIds(['ws-a']));

        await vi.advanceTimersByTimeAsync(REFRESH_PERIOD_MS + 100);

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(fetchFn).toHaveBeenCalledWith('ws-a');
        expect(fetchFn).not.toHaveBeenCalledWith('ws-b');
        expect(fetchFn).not.toHaveBeenCalledWith('ws-c');
    });

    it('background refresh does no git work when the active set is empty', async () => {
        cache.start(fetchFn, activeIds([]));

        await vi.advanceTimersByTimeAsync(REFRESH_PERIOD_MS + 100);

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('getOrFetch lazily fetches an inactive workspace and caches it', async () => {
        // Active set never includes 'ws-b', yet a direct read must still fetch it.
        cache.start(fetchFn, activeIds(['ws-a']));
        fetchFn.mockResolvedValue(RESULT_B);

        const result = await cache.getOrFetch('ws-b');
        expect(result).toEqual(RESULT_B);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(fetchFn).toHaveBeenCalledWith('ws-b');

        // Cached: a second read within the fresh window does not re-fetch.
        fetchFn.mockClear();
        const cached = await cache.getOrFetch('ws-b');
        expect(cached).toEqual(RESULT_B);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('background refresh respects CONCURRENCY (only 4 at a time)', async () => {
        const ids = Array.from({ length: 8 }, (_, i) => `ws-${i}`);

        const concurrentCalls: number[] = [];
        let running = 0;
        fetchFn.mockImplementation(async () => {
            running++;
            concurrentCalls.push(running);
            await Promise.resolve();
            running--;
            return RESULT_A;
        });

        cache.start(fetchFn, activeIds(ids));
        await vi.advanceTimersByTimeAsync(REFRESH_PERIOD_MS + 100);

        expect(Math.max(...concurrentCalls)).toBeLessThanOrEqual(4);
    });

    // ── Dispose ───────────────────────────────────────────────────────────────

    it('dispose stops background refresh and clears entries', async () => {
        cache.start(fetchFn, activeIds(['ws-a']));
        await cache.getOrFetch('ws-a');

        cache.dispose();
        fetchFn.mockClear();

        // Advance well past the refresh interval — should not trigger any fetch
        await vi.advanceTimersByTimeAsync(REFRESH_PERIOD_MS * 3);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    // ── Not started ───────────────────────────────────────────────────────────

    it('getOrFetch rejects if cache was never started', async () => {
        await expect(cache.getOrFetch('ws-a')).rejects.toThrow('not started');
    });
});
