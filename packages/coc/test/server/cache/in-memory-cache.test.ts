/**
 * Unit tests for the unified in-memory cache primitive.
 *
 * Covers the AC-01 Definition of Done: TTL expiry, immutable entries never
 * expiring, LRU eviction at cap, single-flight `getOrCompute` dedup,
 * per-workspace invalidation, and cross-namespace workspace invalidation —
 * plus the basic get/set/delete surface and per-entry TTL overrides used by
 * the autocomplete migration.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    createCache,
    invalidateWorkspaceForAll,
    registeredCacheCount,
    type CacheHandle,
    type CreateCacheOptions,
} from '../../../src/server/cache/in-memory-cache';

// Track every handle a test creates so we can dispose them afterwards and keep
// the module-level registry clean between tests.
const created: CacheHandle<unknown>[] = [];

function make<T>(options: CreateCacheOptions): CacheHandle<T> {
    const handle = createCache<T>(options);
    created.push(handle as CacheHandle<unknown>);
    return handle;
}

afterEach(() => {
    for (const handle of created.splice(0)) handle.dispose();
    vi.restoreAllMocks();
});

describe('in-memory cache: get / set / has / delete', () => {
    it('returns undefined for an unknown key', () => {
        const cache = make<number>({ namespace: 'basic' });
        expect(cache.get('nope')).toBeUndefined();
        expect(cache.has('nope')).toBe(false);
    });

    it('stores and retrieves a value', () => {
        const cache = make<{ hello: string }>({ namespace: 'basic' });
        cache.set('k', { hello: 'world' });
        expect(cache.get('k')).toEqual({ hello: 'world' });
        expect(cache.has('k')).toBe(true);
        expect(cache.size).toBe(1);
    });

    it('overwrites an existing value without growing size', () => {
        const cache = make<string>({ namespace: 'basic' });
        cache.set('k', 'old');
        cache.set('k', 'new');
        expect(cache.get('k')).toBe('new');
        expect(cache.size).toBe(1);
    });

    it('deletes a key and reports whether it existed', () => {
        const cache = make<number>({ namespace: 'basic' });
        cache.set('k', 1);
        expect(cache.delete('k')).toBe(true);
        expect(cache.get('k')).toBeUndefined();
        expect(cache.delete('k')).toBe(false);
    });

    it('clear removes every entry', () => {
        const cache = make<number>({ namespace: 'basic' });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.clear();
        expect(cache.size).toBe(0);
    });
});

describe('in-memory cache: TTL expiry', () => {
    it('expires entries after the namespace default TTL', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const cache = make<string>({ namespace: 'ttl', ttlMs: 1000 });

        cache.set('k', 'v');
        expect(cache.get('k')).toBe('v');

        vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
        expect(cache.get('k')).toBeUndefined();
    });

    it('removes the expired entry on access (has + get)', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const cache = make<string>({ namespace: 'ttl', ttlMs: 1000 });

        cache.set('k', 'v');
        expect(cache.size).toBe(1);

        vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
        expect(cache.has('k')).toBe(false);
        expect(cache.size).toBe(0);
    });

    it('never expires entries when no TTL is configured', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const cache = make<string>({ namespace: 'no-ttl' });

        cache.set('k', 'v');
        vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 365 * 24 * 60 * 60 * 1000);
        expect(cache.get('k')).toBe('v');
    });

    it('honors a per-entry TTL override (positive vs negative TTL)', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        // Mirrors prompt-autocomplete: 30s positive / 8s negative on one handle.
        const cache = make<string>({ namespace: 'autocomplete', ttlMs: 30_000 });

        cache.set('hit', 'result', { ttlMs: 30_000 });
        cache.set('miss', 'empty', { ttlMs: 8_000 });

        vi.spyOn(Date, 'now').mockReturnValue(now + 9_000);
        expect(cache.get('miss')).toBeUndefined();
        expect(cache.get('hit')).toBe('result');

        vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
        expect(cache.get('hit')).toBeUndefined();
    });
});

describe('in-memory cache: immutable entries', () => {
    it('never expires immutable entries regardless of time', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const cache = make<string>({ namespace: 'imm', immutable: true });

        cache.set('hash', 'diff');
        vi.spyOn(Date, 'now').mockReturnValue(now + 100 * 365 * 24 * 60 * 60 * 1000);
        expect(cache.get('hash')).toBe('diff');
    });

    it('immutable wins over a per-entry TTL override', () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const cache = make<string>({ namespace: 'imm', immutable: true });

        cache.set('hash', 'diff', { ttlMs: 1000 });
        vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
        expect(cache.get('hash')).toBe('diff');
    });

    it('still evicts immutable entries by LRU cap', () => {
        const cache = make<number>({ namespace: 'imm', immutable: true, maxSize: 2 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3); // exceeds cap -> evicts oldest (a)
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBe(2);
        expect(cache.get('c')).toBe(3);
        expect(cache.size).toBe(2);
    });
});

describe('in-memory cache: LRU eviction', () => {
    it('evicts the least-recently-used entry at the cap', () => {
        const cache = make<number>({ namespace: 'lru', maxSize: 3 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4); // evicts 'a'

        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBe(2);
        expect(cache.get('c')).toBe(3);
        expect(cache.get('d')).toBe(4);
        expect(cache.size).toBe(3);
    });

    it('a get marks an entry as recently used so it survives eviction', () => {
        const cache = make<number>({ namespace: 'lru', maxSize: 3 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        cache.get('a'); // touch 'a' -> 'b' is now least-recently-used
        cache.set('d', 4); // evicts 'b'

        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBe(1);
        expect(cache.get('c')).toBe(3);
        expect(cache.get('d')).toBe(4);
    });

    it('defaults the cap to 500 entries', () => {
        const cache = make<number>({ namespace: 'lru-default' });
        for (let i = 0; i < 600; i++) cache.set(`k${i}`, i);
        expect(cache.size).toBe(500);
        expect(cache.get('k0')).toBeUndefined();
        expect(cache.get('k599')).toBe(599);
    });
});

describe('in-memory cache: single-flight getOrCompute', () => {
    it('invokes the factory once for concurrent callers of the same key', async () => {
        const cache = make<number>({ namespace: 'sf' });
        let calls = 0;
        let resolveFactory: (value: number) => void = () => {};
        const factory = () => {
            calls++;
            return new Promise<number>((resolve) => {
                resolveFactory = resolve;
            });
        };

        const p1 = cache.getOrCompute('k', factory);
        const p2 = cache.getOrCompute('k', factory);
        expect(calls).toBe(1);

        resolveFactory(42);
        await expect(p1).resolves.toBe(42);
        await expect(p2).resolves.toBe(42);
        expect(calls).toBe(1);
        // Value is cached after the single flight resolves.
        expect(cache.get('k')).toBe(42);
    });

    it('returns the cached value without calling the factory', async () => {
        const cache = make<number>({ namespace: 'sf' });
        cache.set('k', 7);
        const factory = vi.fn(async () => 99);
        await expect(cache.getOrCompute('k', factory)).resolves.toBe(7);
        expect(factory).not.toHaveBeenCalled();
    });

    it('does not cache on factory rejection and allows a retry', async () => {
        const cache = make<number>({ namespace: 'sf' });
        await expect(
            cache.getOrCompute('k', async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
        expect(cache.get('k')).toBeUndefined();

        await expect(cache.getOrCompute('k', async () => 5)).resolves.toBe(5);
        expect(cache.get('k')).toBe(5);
    });

    it('tags the computed entry with the workspace id', async () => {
        const cache = make<number>({ namespace: 'sf' });
        await cache.getOrCompute('k', async () => 11, { workspaceId: 'ws1' });
        cache.invalidateWorkspace('ws1');
        expect(cache.get('k')).toBeUndefined();
    });
});

describe('in-memory cache: per-workspace invalidation', () => {
    it('removes only entries tagged with the workspace', () => {
        const cache = make<number>({ namespace: 'ws' });
        cache.set('a', 1, { workspaceId: 'ws1' });
        cache.set('b', 2, { workspaceId: 'ws1' });
        cache.set('c', 3, { workspaceId: 'ws2' });
        cache.set('d', 4); // untagged

        cache.invalidateWorkspace('ws1');

        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('c')).toBe(3);
        expect(cache.get('d')).toBe(4);
    });

    it('is a no-op for an unknown workspace', () => {
        const cache = make<number>({ namespace: 'ws' });
        cache.set('a', 1, { workspaceId: 'ws1' });
        cache.invalidateWorkspace('ws-unknown');
        expect(cache.get('a')).toBe(1);
    });

    it('re-tags the workspace index when an entry is overwritten', () => {
        const cache = make<number>({ namespace: 'ws' });
        cache.set('a', 1, { workspaceId: 'ws1' });
        cache.set('a', 2, { workspaceId: 'ws2' }); // move 'a' to ws2

        cache.invalidateWorkspace('ws1');
        expect(cache.get('a')).toBe(2); // untouched by ws1 invalidation

        cache.invalidateWorkspace('ws2');
        expect(cache.get('a')).toBeUndefined();
    });
});

describe('in-memory cache: cross-namespace workspace invalidation', () => {
    it('clears the workspace across every registered namespace', () => {
        const a = make<number>({ namespace: 'cross-a' });
        const b = make<number>({ namespace: 'cross-b' });

        a.set('k', 1, { workspaceId: 'wsX' });
        b.set('k', 2, { workspaceId: 'wsX' });
        a.set('keep', 9, { workspaceId: 'wsY' });
        b.set('keep', 8); // untagged

        invalidateWorkspaceForAll('wsX');

        expect(a.get('k')).toBeUndefined();
        expect(b.get('k')).toBeUndefined();
        expect(a.get('keep')).toBe(9);
        expect(b.get('keep')).toBe(8);
    });
});

describe('in-memory cache: registry lifecycle', () => {
    it('registers and unregisters handles via dispose', () => {
        const before = registeredCacheCount();
        const cache = createCache<number>({ namespace: 'disp' });
        expect(registeredCacheCount()).toBe(before + 1);

        cache.set('k', 1);
        cache.dispose();
        expect(registeredCacheCount()).toBe(before);
        expect(cache.size).toBe(0);
    });

    it('exposes the namespace on the handle', () => {
        const cache = make<number>({ namespace: 'named-thing' });
        expect(cache.namespace).toBe('named-thing');
    });
});
