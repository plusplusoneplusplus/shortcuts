/**
 * Tests for WarmClientRegistry
 *
 * Verifies the provider-agnostic warm-client lifecycle that underpins the
 * session-prewarming feature:
 *   - cold-miss → park → warm-hit reuse (one factory call across two turns)
 *   - idle TTL teardown (stop + entry removal)
 *   - immediate teardown on abort/error release
 *   - prewarm idempotency, no-op during active turns, mid-warm attach
 *   - factory-rejection rollback (no registry leak)
 *   - evictAll stops every warm client
 *   - TTL <= 0 disables warming entirely
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    WarmClientRegistry,
    WarmClientHandle,
    makeWarmKey,
} from '../../src/warm-client-registry';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeHandle(): WarmClientHandle & { stop: ReturnType<typeof vi.fn> } {
    const stop = vi.fn().mockResolvedValue(undefined);
    return { client: { id: Math.random() }, stop };
}

const TTL = 5000;
const KEY = makeWarmKey('copilot', '/repo');

describe('makeWarmKey', () => {
    it('namespaces by provider and working directory', () => {
        expect(makeWarmKey('copilot', '/a')).not.toBe(makeWarmKey('codex', '/a'));
        expect(makeWarmKey('copilot', '/a')).not.toBe(makeWarmKey('copilot', '/b'));
        expect(makeWarmKey('copilot', '/a')).toBe(makeWarmKey('copilot', '/a'));
    });

    it('treats a missing working directory as the empty string', () => {
        expect(makeWarmKey('copilot')).toBe(makeWarmKey('copilot', ''));
    });
});

describe('WarmClientRegistry', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    function makeRegistry(ttlMs = TTL) {
        return new WarmClientRegistry({ ttlMs });
    }

    // ── Cold miss → park → warm hit ──────────────────────────────────────

    it('cold-starts on first acquire (cold miss) and parks on clean release', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const factory = vi.fn().mockResolvedValue(handle);

        const first = await registry.acquire(KEY, factory);
        expect(first.warmHit).toBe(false);
        expect(first.handle).toBe(handle);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(registry.isActive(KEY)).toBe(true);

        await registry.release(KEY, { keep: true });
        expect(registry.isWarm(KEY)).toBe(true);
        expect(registry.isActive(KEY)).toBe(false);
        expect(handle.stop).not.toHaveBeenCalled();
    });

    it('reuses the warm client on the second acquire — one createClient across two sends', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const factory = vi.fn().mockResolvedValue(handle);

        await registry.acquire(KEY, factory);
        await registry.release(KEY, { keep: true });

        const second = await registry.acquire(KEY, factory);
        expect(second.warmHit).toBe(true);
        expect(second.handle).toBe(handle);
        expect(factory).toHaveBeenCalledTimes(1); // not called again
    });

    // ── Idle TTL teardown ────────────────────────────────────────────────

    it('tears down the client and removes the entry when the idle TTL expires', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();

        await registry.acquire(KEY, () => Promise.resolve(handle));
        await registry.release(KEY, { keep: true });
        expect(registry.has(KEY)).toBe(true);

        await vi.advanceTimersByTimeAsync(TTL - 1);
        expect(handle.stop).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2);
        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(registry.has(KEY)).toBe(false);
        expect(registry.isWarm(KEY)).toBe(false);
    });

    it('restarts the idle TTL on reuse so a reused client is not torn down early', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const factory = () => Promise.resolve(handle);

        await registry.acquire(KEY, factory);
        await registry.release(KEY, { keep: true });

        // Wait most of the TTL, then reuse — this must cancel the pending timer.
        await vi.advanceTimersByTimeAsync(TTL - 100);
        const second = await registry.acquire(KEY, factory);
        expect(second.warmHit).toBe(true);

        // The old timer must not fire while the turn is active.
        await vi.advanceTimersByTimeAsync(TTL);
        expect(handle.stop).not.toHaveBeenCalled();

        await registry.release(KEY, { keep: true });
        await vi.advanceTimersByTimeAsync(TTL - 1);
        expect(handle.stop).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2);
        expect(handle.stop).toHaveBeenCalledTimes(1);
    });

    // ── Abort / error teardown ───────────────────────────────────────────

    it('tears down immediately (no parking) when released with keep=false', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();

        await registry.acquire(KEY, () => Promise.resolve(handle));
        await registry.release(KEY, { keep: false });

        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(registry.has(KEY)).toBe(false);
    });

    // ── Refcounting for concurrent turns ─────────────────────────────────

    it('only tears down once the last concurrent turn releases', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const factory = vi.fn().mockResolvedValue(handle);

        const a = await registry.acquire(KEY, factory);
        const b = await registry.acquire(KEY, factory);
        expect(a.handle).toBe(handle);
        expect(b.handle).toBe(handle);
        expect(factory).toHaveBeenCalledTimes(1); // shared client

        await registry.release(KEY, { keep: false });
        expect(handle.stop).not.toHaveBeenCalled(); // one turn still active
        expect(registry.isActive(KEY)).toBe(true);

        await registry.release(KEY, { keep: false });
        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(registry.has(KEY)).toBe(false);
    });

    // ── Prewarm ──────────────────────────────────────────────────────────

    it('prewarm warms the client once and parks it with an idle TTL', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const factory = vi.fn().mockResolvedValue(handle);

        await registry.prewarm(KEY, factory);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(registry.isWarm(KEY)).toBe(true);

        // Idle TTL ticks on a prewarmed-but-unused client.
        await vi.advanceTimersByTimeAsync(TTL + 1);
        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(registry.has(KEY)).toBe(false);
    });

    it('prewarm is idempotent — repeated calls do not create a second client', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const factory = vi.fn().mockResolvedValue(handle);

        await registry.prewarm(KEY, factory);
        await registry.prewarm(KEY, factory);
        await registry.prewarm(KEY, factory);

        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('prewarm is a no-op during an active turn', async () => {
        const registry = makeRegistry();
        const turnHandle = makeHandle();
        const turnFactory = vi.fn().mockResolvedValue(turnHandle);
        const prewarmFactory = vi.fn().mockResolvedValue(makeHandle());

        await registry.acquire(KEY, turnFactory);
        await registry.prewarm(KEY, prewarmFactory);

        expect(prewarmFactory).not.toHaveBeenCalled();
        expect(registry.isActive(KEY)).toBe(true);
    });

    it('a real send arriving mid-warm attaches to the in-flight warming', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const deferred = makeDeferred<WarmClientHandle>();
        const factory = vi.fn(() => deferred.promise);

        const prewarmP = registry.prewarm(KEY, factory);
        // Send arrives before warming resolves — must reuse, not cold-start.
        const acquireP = registry.acquire(KEY, factory);

        deferred.resolve(handle);
        const result = await acquireP;
        await prewarmP;

        expect(factory).toHaveBeenCalledTimes(1);
        expect(result.warmHit).toBe(true);
        expect(result.handle).toBe(handle);
        expect(registry.isActive(KEY)).toBe(true);
    });

    it('does not start an idle TTL when a send attached mid-warm is still active', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const deferred = makeDeferred<WarmClientHandle>();

        const prewarmP = registry.prewarm(KEY, () => deferred.promise);
        const acquireP = registry.acquire(KEY, () => deferred.promise);
        deferred.resolve(handle);
        await acquireP;
        await prewarmP;

        // The attached send is active — the prewarm TTL must not tear it down.
        await vi.advanceTimersByTimeAsync(TTL + 1);
        expect(handle.stop).not.toHaveBeenCalled();
        expect(registry.isActive(KEY)).toBe(true);
    });

    // ── Factory rejection rollback ───────────────────────────────────────

    it('rolls back and leaves no entry when a cold-start factory rejects', async () => {
        const registry = makeRegistry();
        const factory = vi.fn().mockRejectedValue(new Error('spawn failed'));

        await expect(registry.acquire(KEY, factory)).rejects.toThrow('spawn failed');
        expect(registry.has(KEY)).toBe(false);
        expect(registry.size()).toBe(0);
    });

    it('leaves no entry when a prewarm factory rejects', async () => {
        const registry = makeRegistry();
        const factory = vi.fn().mockRejectedValue(new Error('spawn failed'));

        await registry.prewarm(KEY, factory);
        expect(registry.has(KEY)).toBe(false);
        expect(registry.size()).toBe(0);
    });

    // ── Eviction ─────────────────────────────────────────────────────────

    it('evict stops a parked client and removes the entry', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        await registry.acquire(KEY, () => Promise.resolve(handle));
        await registry.release(KEY, { keep: true });

        await registry.evict(KEY);
        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(registry.has(KEY)).toBe(false);
    });

    it('evict stops a client that is still warming (no leak)', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        const deferred = makeDeferred<WarmClientHandle>();

        registry.prewarm(KEY, () => deferred.promise);
        const evictP = registry.evict(KEY);
        deferred.resolve(handle);
        await evictP;

        expect(handle.stop).toHaveBeenCalled();
        expect(registry.has(KEY)).toBe(false);
    });

    it('evictAll stops every warm client', async () => {
        const registry = makeRegistry();
        const h1 = makeHandle();
        const h2 = makeHandle();
        const k1 = makeWarmKey('copilot', '/one');
        const k2 = makeWarmKey('codex', '/two');

        await registry.acquire(k1, () => Promise.resolve(h1));
        await registry.release(k1, { keep: true });
        await registry.acquire(k2, () => Promise.resolve(h2));
        await registry.release(k2, { keep: true });
        expect(registry.size()).toBe(2);

        await registry.evictAll();
        expect(h1.stop).toHaveBeenCalledTimes(1);
        expect(h2.stop).toHaveBeenCalledTimes(1);
        expect(registry.size()).toBe(0);
    });

    // ── TTL <= 0 disables warming ────────────────────────────────────────

    it('with TTL=0, prewarm is a no-op and creates no entry', async () => {
        const registry = makeRegistry(0);
        const factory = vi.fn().mockResolvedValue(makeHandle());

        await registry.prewarm(KEY, factory);
        expect(factory).not.toHaveBeenCalled();
        expect(registry.has(KEY)).toBe(false);
        expect(registry.warmingEnabled).toBe(false);
    });

    it('with TTL=0, a clean release stops the client immediately and keeps nothing', async () => {
        const registry = makeRegistry(0);
        const handle = makeHandle();

        const acquired = await registry.acquire(KEY, () => Promise.resolve(handle));
        expect(acquired.warmHit).toBe(false);

        await registry.release(KEY, { keep: true }); // keep requested, but disabled
        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(registry.has(KEY)).toBe(false);
    });

    it('with TTL=0, each send cold-starts its own client (no reuse)', async () => {
        const registry = makeRegistry(0);
        const factory = vi.fn(() => Promise.resolve(makeHandle()));

        await registry.acquire(KEY, factory);
        await registry.release(KEY, { keep: true });
        await registry.acquire(KEY, factory);
        await registry.release(KEY, { keep: true });

        expect(factory).toHaveBeenCalledTimes(2);
    });

    // ── Accessors ────────────────────────────────────────────────────────

    it('reports has/isWarm/isActive/size accurately across the lifecycle', async () => {
        const registry = makeRegistry();
        const handle = makeHandle();
        expect(registry.size()).toBe(0);

        const acq = registry.acquire(KEY, () => Promise.resolve(handle));
        await acq;
        expect(registry.has(KEY)).toBe(true);
        expect(registry.isActive(KEY)).toBe(true);
        expect(registry.isWarm(KEY)).toBe(true); // resolved synchronously enough
        expect(registry.size()).toBe(1);

        await registry.release(KEY, { keep: true });
        expect(registry.isActive(KEY)).toBe(false);
        expect(registry.isWarm(KEY)).toBe(true);
    });
});
