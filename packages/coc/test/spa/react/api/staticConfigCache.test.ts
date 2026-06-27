/**
 * Tests for staticConfigCache — the session-scoped, in-memory cache for static
 * provider/workspace config (models, reasoning-efforts, effort-tiers per
 * provider; llm-tools-config per workspace).
 *
 * Covers the foundational behaviour for:
 *  - AC-01: a second read of an already-cached key returns from cache with no
 *    network call; a read for a new key fetches once and populates the cache.
 *  - AC-05: after invalidating a key, the next read fetches fresh instead of
 *    returning the stale cached value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getOrFetchConfig,
    peekConfig,
    invalidateConfig,
    configCacheKey,
    DEFAULT_CONFIG_TTL_MS,
    _clearConfigCache,
    _getConfigCacheSize,
} from '../../../../src/server/spa/client/react/api/staticConfigCache';

/** Resolves the microtask queue so `.then` callbacks on already-settled promises run. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(() => {
    _clearConfigCache();
});

describe('configCacheKey', () => {
    it('keys provider-scoped config by provider and workspace config by workspace', () => {
        expect(configCacheKey.models('copilot')).toBe('models:copilot');
        expect(configCacheKey.reasoningEfforts('codex')).toBe('reasoning-efforts:codex');
        expect(configCacheKey.effortTiers('claude')).toBe('effort-tiers:claude');
        expect(configCacheKey.llmToolsConfig('ws-1')).toBe('llm-tools-config:ws-1');
    });

    it('produces distinct keys per provider so different providers never collide', () => {
        expect(configCacheKey.models('copilot')).not.toBe(configCacheKey.models('codex'));
    });
});

describe('getOrFetchConfig — AC-01 cache reads', () => {
    it('fetches once for a new key and populates the cache', async () => {
        const fetcher = vi.fn().mockResolvedValue({ models: ['a'] });

        const value = await getOrFetchConfig('models:copilot', fetcher);

        expect(value).toEqual({ models: ['a'] });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(_getConfigCacheSize()).toBe(1);
    });

    it('returns from cache with NO network call on the second read of the same key', async () => {
        const fetcher = vi.fn().mockResolvedValue({ models: ['a'] });

        const first = await getOrFetchConfig('models:copilot', fetcher);
        const second = await getOrFetchConfig('models:copilot', fetcher);

        expect(second).toBe(first); // identical cached reference
        expect(fetcher).toHaveBeenCalledTimes(1); // not called again
    });

    it('fetches separately for a different (not-yet-seen) key', async () => {
        const copilot = vi.fn().mockResolvedValue('copilot-models');
        const codex = vi.fn().mockResolvedValue('codex-models');

        await getOrFetchConfig(configCacheKey.models('copilot'), copilot);
        await getOrFetchConfig(configCacheKey.models('codex'), codex);

        expect(copilot).toHaveBeenCalledTimes(1);
        expect(codex).toHaveBeenCalledTimes(1);
        expect(_getConfigCacheSize()).toBe(2);

        // Re-reading copilot stays a cache hit; codex's fetch did not disturb it.
        await getOrFetchConfig(configCacheKey.models('copilot'), copilot);
        expect(copilot).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent in-flight reads of the same key into a single fetch', async () => {
        let resolveFetch: (value: unknown) => void = () => {};
        const fetcher = vi.fn().mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));

        const p1 = getOrFetchConfig('models:copilot', fetcher);
        const p2 = getOrFetchConfig('models:copilot', fetcher);

        expect(fetcher).toHaveBeenCalledTimes(1);

        resolveFetch({ models: ['x'] });
        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toEqual({ models: ['x'] });
        expect(r2).toEqual({ models: ['x'] });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('does not cache a rejected fetch — the next read retries', async () => {
        const fetcher = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('recovered');

        await expect(getOrFetchConfig('models:copilot', fetcher)).rejects.toThrow('boom');
        expect(_getConfigCacheSize()).toBe(0);

        const value = await getOrFetchConfig('models:copilot', fetcher);
        expect(value).toBe('recovered');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});

describe('getOrFetchConfig — TTL expiry', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('serves from cache within the TTL and refetches after it lapses', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce('first')
            .mockResolvedValueOnce('second');

        const a = await getOrFetchConfig('models:copilot', fetcher, 1000);
        expect(a).toBe('first');

        // Within TTL: cache hit, no refetch.
        vi.advanceTimersByTime(500);
        const b = await getOrFetchConfig('models:copilot', fetcher, 1000);
        expect(b).toBe('first');
        expect(fetcher).toHaveBeenCalledTimes(1);

        // Past TTL: refetch.
        vi.advanceTimersByTime(600);
        const c = await getOrFetchConfig('models:copilot', fetcher, 1000);
        expect(c).toBe('second');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('defaults to a 60-minute TTL matching the conversation cache', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce('first')
            .mockResolvedValueOnce('second');

        await getOrFetchConfig('models:copilot', fetcher);

        // Just before the default TTL — still cached.
        vi.advanceTimersByTime(DEFAULT_CONFIG_TTL_MS - 1);
        expect(await getOrFetchConfig('models:copilot', fetcher)).toBe('first');
        expect(fetcher).toHaveBeenCalledTimes(1);

        // Just past the default TTL — refetch.
        vi.advanceTimersByTime(2);
        expect(await getOrFetchConfig('models:copilot', fetcher)).toBe('second');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});

describe('invalidateConfig — AC-05 invalidate-on-mutate', () => {
    it('drops the key so the next read fetches fresh instead of the stale value', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce('stale')
            .mockResolvedValueOnce('fresh');

        expect(await getOrFetchConfig('effort-tiers:copilot', fetcher)).toBe('stale');

        invalidateConfig('effort-tiers:copilot');
        expect(_getConfigCacheSize()).toBe(0);

        expect(await getOrFetchConfig('effort-tiers:copilot', fetcher)).toBe('fresh');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('invalidating one key leaves other keys cached', async () => {
        const copilot = vi.fn().mockResolvedValue('copilot');
        const codex = vi.fn().mockResolvedValue('codex');

        await getOrFetchConfig(configCacheKey.effortTiers('copilot'), copilot);
        await getOrFetchConfig(configCacheKey.effortTiers('codex'), codex);

        invalidateConfig(configCacheKey.effortTiers('copilot'));

        // codex still cached — no refetch.
        await getOrFetchConfig(configCacheKey.effortTiers('codex'), codex);
        expect(codex).toHaveBeenCalledTimes(1);

        // copilot refetches.
        await getOrFetchConfig(configCacheKey.effortTiers('copilot'), copilot);
        expect(copilot).toHaveBeenCalledTimes(2);
    });

    it('is a no-op for an unknown key', () => {
        invalidateConfig('never-cached');
        expect(_getConfigCacheSize()).toBe(0);
    });
});

describe('peekConfig', () => {
    it('returns undefined when the key is not cached', () => {
        expect(peekConfig('models:copilot')).toBeUndefined();
    });

    it('returns the cached value synchronously after a fetch populates it', async () => {
        await getOrFetchConfig('models:copilot', vi.fn().mockResolvedValue('cached'));
        expect(peekConfig('models:copilot')).toBe('cached');
    });

    it('does not trigger a fetch', () => {
        const fetcher = vi.fn();
        peekConfig('models:copilot');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('returns undefined once the entry is past its TTL', async () => {
        vi.useFakeTimers();
        try {
            await getOrFetchConfig('models:copilot', vi.fn().mockResolvedValue('cached'), 1000);
            expect(peekConfig('models:copilot', 1000)).toBe('cached');
            vi.advanceTimersByTime(1500);
            expect(peekConfig('models:copilot', 1000)).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('_clearConfigCache', () => {
    it('empties all cached entries', async () => {
        await getOrFetchConfig('models:copilot', vi.fn().mockResolvedValue('a'));
        await getOrFetchConfig('models:codex', vi.fn().mockResolvedValue('b'));
        expect(_getConfigCacheSize()).toBe(2);

        _clearConfigCache();
        expect(_getConfigCacheSize()).toBe(0);
    });

    it('also clears in-flight promises so a fresh fetch starts after clear', async () => {
        const fetcher = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
        getOrFetchConfig('models:copilot', fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);

        _clearConfigCache();

        const fetcher2 = vi.fn().mockResolvedValue('done');
        const value = await getOrFetchConfig('models:copilot', fetcher2);
        expect(value).toBe('done');
        expect(fetcher2).toHaveBeenCalledTimes(1);
        await flush();
    });
});
