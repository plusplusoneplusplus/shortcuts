import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    WORK_ITEM_RESPONSE_CACHE_TTL_MS,
    clearWorkItemResponseCache,
    clearWorkItemResponseCacheForWorkspace,
    clearWorkItemResponseCacheForWorkspaces,
    getOrRefreshWorkItemResponseCacheEntry,
    getWorkItemResponseCacheEntry,
    makeWorkItemListResponseCacheKey,
    refreshWorkItemResponseCacheEntry,
} from '../../../src/server/work-items/work-item-response-cache';

// Regression coverage for the AC-02 migration of the work-item response cache
// onto the unified in-memory cache primitive. These tests pin the behavior the
// migration must preserve: 60min TTL via the injectable `now`, workspace-scoped
// invalidation isolation, and that a cached entry is reused without re-loading.

beforeEach(() => {
    clearWorkItemResponseCache();
});

afterEach(() => {
    clearWorkItemResponseCache();
});

describe('work-item response cache (unified-cache migration)', () => {
    it('returns the cached entry until its expiresAt, then drops it (injectable now)', async () => {
        const base = 1_000_000;
        const key = makeWorkItemListResponseCacheKey({ repoId: 'ws-a', limit: 20 });
        await refreshWorkItemResponseCacheEntry(
            key,
            'ws-a',
            'list',
            async () => ({ total: 7 }),
            () => base,
        );

        // Just before expiry: still cached.
        const fresh = getWorkItemResponseCacheEntry<{ total: number }>(
            key,
            base + WORK_ITEM_RESPONSE_CACHE_TTL_MS - 1,
        );
        expect(fresh?.data.total).toBe(7);

        // At/after expiry: gone (and removed from the store).
        expect(getWorkItemResponseCacheEntry(key, base + WORK_ITEM_RESPONSE_CACHE_TTL_MS)).toBeUndefined();
        expect(getWorkItemResponseCacheEntry(key)).toBeUndefined();
    });

    it('clears only the targeted workspace and leaves others intact', async () => {
        const keyA = makeWorkItemListResponseCacheKey({ repoId: 'ws-a', limit: 20 });
        const keyB = makeWorkItemListResponseCacheKey({ repoId: 'ws-b', limit: 20 });
        await refreshWorkItemResponseCacheEntry(keyA, 'ws-a', 'list', async () => ({ total: 1 }));
        await refreshWorkItemResponseCacheEntry(keyB, 'ws-b', 'list', async () => ({ total: 2 }));

        clearWorkItemResponseCacheForWorkspace('ws-a');

        expect(getWorkItemResponseCacheEntry(keyA)).toBeUndefined();
        expect(getWorkItemResponseCacheEntry<{ total: number }>(keyB)?.data.total).toBe(2);
    });

    it('clears every targeted workspace via clearForWorkspaces', async () => {
        const keyA = makeWorkItemListResponseCacheKey({ repoId: 'ws-a', limit: 20 });
        const keyB = makeWorkItemListResponseCacheKey({ repoId: 'ws-b', limit: 20 });
        const keyC = makeWorkItemListResponseCacheKey({ repoId: 'ws-c', limit: 20 });
        await refreshWorkItemResponseCacheEntry(keyA, 'ws-a', 'list', async () => ({ total: 1 }));
        await refreshWorkItemResponseCacheEntry(keyB, 'ws-b', 'list', async () => ({ total: 2 }));
        await refreshWorkItemResponseCacheEntry(keyC, 'ws-c', 'list', async () => ({ total: 3 }));

        clearWorkItemResponseCacheForWorkspaces(['ws-a', ' ws-c ']);

        expect(getWorkItemResponseCacheEntry(keyA)).toBeUndefined();
        expect(getWorkItemResponseCacheEntry<{ total: number }>(keyB)?.data.total).toBe(2);
        expect(getWorkItemResponseCacheEntry(keyC)).toBeUndefined();
    });

    it('reuses the cached value without re-loading unless forced', async () => {
        const key = makeWorkItemListResponseCacheKey({ repoId: 'ws-a', limit: 20 });
        let loads = 0;
        const load = async () => {
            loads += 1;
            return { total: loads };
        };

        const first = await getOrRefreshWorkItemResponseCacheEntry(key, 'ws-a', 'list', false, load);
        const second = await getOrRefreshWorkItemResponseCacheEntry(key, 'ws-a', 'list', false, load);
        expect(first).toEqual({ total: 1 });
        expect(second).toEqual({ total: 1 });
        expect(loads).toBe(1);

        // force=true bypasses the cache and re-loads.
        const forced = await getOrRefreshWorkItemResponseCacheEntry(key, 'ws-a', 'list', true, load);
        expect(forced).toEqual({ total: 2 });
        expect(loads).toBe(2);
    });
});
