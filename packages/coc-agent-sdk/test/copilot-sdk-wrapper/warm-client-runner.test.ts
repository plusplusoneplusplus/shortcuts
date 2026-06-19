/**
 * Tests for runWithWarmClient and resolveWarmClientTtlMs.
 *
 * Covers the shared warm-turn lifecycle (acquire → run → release) and the
 * env-driven TTL resolution, focusing on paths the provider-level tests cannot
 * exercise directly — notably the cold-fallback on acquire failure.
 */

import { describe, it, expect, vi } from 'vitest';
import { WarmClientRegistry, makeWarmKey } from '../../src/warm-client-registry';
import { runWithWarmClient } from '../../src/warm-client-runner';
import {
    resolveWarmClientTtlMs,
    DEFAULT_WARM_CLIENT_TTL_MS,
    WARM_CLIENT_TTL_ENV,
} from '../../src/warm-client-config';

const KEY = makeWarmKey('copilot', '/repo');

function makeHandle() {
    const stop = vi.fn().mockResolvedValue(undefined);
    return { client: { id: Math.random() }, stop };
}

describe('runWithWarmClient', () => {
    it('parks the client on clean completion (keepWarm: true)', async () => {
        const registry = new WarmClientRegistry({ ttlMs: 5000 });
        const handle = makeHandle();
        const factory = vi.fn().mockResolvedValue(handle);

        const result = await runWithWarmClient({
            registry,
            key: KEY,
            factory,
            coldFallback: () => Promise.reject(new Error('should not fall back')),
            run: async (h, warmHit) => {
                expect(warmHit).toBe(false);
                expect(h).toBe(handle);
                return { result: 'ok', keepWarm: true };
            },
        });

        expect(result).toBe('ok');
        expect(registry.isWarm(KEY)).toBe(true);
        expect(handle.stop).not.toHaveBeenCalled();
    });

    it('tears the client down on an unclean outcome (keepWarm: false)', async () => {
        const registry = new WarmClientRegistry({ ttlMs: 5000 });
        const handle = makeHandle();

        const result = await runWithWarmClient({
            registry,
            key: KEY,
            factory: () => Promise.resolve(handle),
            coldFallback: () => Promise.reject(new Error('should not fall back')),
            run: async () => ({ result: 'failed', keepWarm: false }),
        });

        expect(result).toBe('failed');
        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(registry.has(KEY)).toBe(false);
    });

    it('tears the client down and propagates when run throws', async () => {
        const registry = new WarmClientRegistry({ ttlMs: 5000 });
        const handle = makeHandle();

        await expect(
            runWithWarmClient({
                registry,
                key: KEY,
                factory: () => Promise.resolve(handle),
                coldFallback: () => Promise.reject(new Error('should not fall back')),
                run: async () => { throw new Error('run blew up'); },
            }),
        ).rejects.toThrow('run blew up');

        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(registry.has(KEY)).toBe(false);
    });

    it('falls back to a cold run when acquisition fails, leaving no registry entry', async () => {
        const registry = new WarmClientRegistry({ ttlMs: 5000 });
        const factory = vi.fn().mockRejectedValue(new Error('spawn failed'));
        const coldFallback = vi.fn().mockResolvedValue('cold-result');
        const run = vi.fn();

        const result = await runWithWarmClient({
            registry,
            key: KEY,
            factory,
            coldFallback,
            run,
        });

        expect(result).toBe('cold-result');
        expect(coldFallback).toHaveBeenCalledTimes(1);
        expect(run).not.toHaveBeenCalled();
        // The registry rolled back its entry — no leak.
        expect(registry.has(KEY)).toBe(false);
    });
});

describe('resolveWarmClientTtlMs', () => {
    it('returns the default when the override is absent', () => {
        expect(resolveWarmClientTtlMs({})).toBe(DEFAULT_WARM_CLIENT_TTL_MS);
    });

    it('returns the default when the override is blank', () => {
        expect(resolveWarmClientTtlMs({ [WARM_CLIENT_TTL_ENV]: '   ' })).toBe(DEFAULT_WARM_CLIENT_TTL_MS);
    });

    it('parses a valid numeric override', () => {
        expect(resolveWarmClientTtlMs({ [WARM_CLIENT_TTL_ENV]: '60000' })).toBe(60000);
    });

    it('honors 0 (warming disabled)', () => {
        expect(resolveWarmClientTtlMs({ [WARM_CLIENT_TTL_ENV]: '0' })).toBe(0);
    });

    it('floors fractional values', () => {
        expect(resolveWarmClientTtlMs({ [WARM_CLIENT_TTL_ENV]: '1234.9' })).toBe(1234);
    });

    it('falls back to the default for non-numeric or negative values', () => {
        expect(resolveWarmClientTtlMs({ [WARM_CLIENT_TTL_ENV]: 'abc' })).toBe(DEFAULT_WARM_CLIENT_TTL_MS);
        expect(resolveWarmClientTtlMs({ [WARM_CLIENT_TTL_ENV]: '-1' })).toBe(DEFAULT_WARM_CLIENT_TTL_MS);
    });
});
