/**
 * Tests for CopilotClientCache
 *
 * Verifies:
 * - Client is created on first acquire and reused on subsequent calls
 * - Cache hit/miss behavior
 * - Acquire pauses idle timer, markIdle restarts it
 * - Cleanup on release (process end)
 * - Idle timeout auto-disposal only after markIdle
 * - disposeAll on server shutdown
 * - Graceful handling of missing aiService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CopilotClientCache } from '../../../src/server/executors/copilot-client-cache';

// ============================================================================
// Helpers
// ============================================================================

function createMockClient() {
    return {
        stop: vi.fn().mockResolvedValue([]),
        createSession: vi.fn(),
        resumeSession: vi.fn(),
        start: vi.fn(),
    };
}

function createMockAIService() {
    const mockClient = createMockClient();
    return {
        service: {
            createClient: vi.fn().mockResolvedValue(mockClient),
        },
        mockClient,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('CopilotClientCache', () => {
    let cache: CopilotClientCache;

    beforeEach(() => {
        vi.useFakeTimers();
        cache = new CopilotClientCache({ idleTimeoutMs: 60_000 }); // 1 min for tests
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ========================================================================
    // acquire (formerly getOrCreate)
    // ========================================================================

    describe('acquire', () => {
        it('creates a new client on first call', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);

            const client = await cache.acquire('proc-1', '/repo');

            expect(service.createClient).toHaveBeenCalledOnce();
            expect(service.createClient).toHaveBeenCalledWith('/repo');
            expect(client).toBe(mockClient);
            expect(cache.size).toBe(1);
        });

        it('returns cached client on subsequent calls (same processId)', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);

            const first = await cache.acquire('proc-1', '/repo');
            cache.markIdle('proc-1');
            const second = await cache.acquire('proc-1', '/repo');

            expect(service.createClient).toHaveBeenCalledOnce();
            expect(first).toBe(second);
            expect(first).toBe(mockClient);
            expect(cache.size).toBe(1);
        });

        it('creates separate clients for different processIds', async () => {
            const client1 = createMockClient();
            const client2 = createMockClient();
            const service = {
                createClient: vi.fn()
                    .mockResolvedValueOnce(client1)
                    .mockResolvedValueOnce(client2),
            };
            cache.setAIService(service as any);

            const first = await cache.acquire('proc-1', '/repo-a');
            const second = await cache.acquire('proc-2', '/repo-b');

            expect(service.createClient).toHaveBeenCalledTimes(2);
            expect(first).toBe(client1);
            expect(second).toBe(client2);
            expect(cache.size).toBe(2);
        });

        it('throws when aiService is not set', async () => {
            await expect(cache.acquire('proc-1')).rejects.toThrow(
                'aiService not set',
            );
        });

        it('getOrCreate is an alias for acquire', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);

            const client = await cache.getOrCreate('proc-1', '/repo');
            expect(client).toBe(mockClient);
        });
    });

    // ========================================================================
    // has
    // ========================================================================

    describe('has', () => {
        it('returns false when no client is cached', () => {
            expect(cache.has('proc-1')).toBe(false);
        });

        it('returns true after acquire', async () => {
            const { service } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');

            expect(cache.has('proc-1')).toBe(true);
        });

        it('returns false after release', async () => {
            const { service } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');
            await cache.release('proc-1');

            expect(cache.has('proc-1')).toBe(false);
        });
    });

    // ========================================================================
    // release (process end cleanup)
    // ========================================================================

    describe('release', () => {
        it('stops the client and removes it from cache', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');

            await cache.release('proc-1');

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(cache.has('proc-1')).toBe(false);
            expect(cache.size).toBe(0);
        });

        it('is a no-op when processId is not cached', async () => {
            await expect(cache.release('unknown')).resolves.toBeUndefined();
        });

        it('does not affect other cached clients', async () => {
            const client1 = createMockClient();
            const client2 = createMockClient();
            const service = {
                createClient: vi.fn()
                    .mockResolvedValueOnce(client1)
                    .mockResolvedValueOnce(client2),
            };
            cache.setAIService(service as any);

            await cache.acquire('proc-1');
            await cache.acquire('proc-2');
            await cache.release('proc-1');

            expect(client1.stop).toHaveBeenCalledOnce();
            expect(client2.stop).not.toHaveBeenCalled();
            expect(cache.size).toBe(1);
            expect(cache.has('proc-2')).toBe(true);
        });

        it('handles client.stop() errors gracefully', async () => {
            const { service, mockClient } = createMockAIService();
            mockClient.stop.mockRejectedValue(new Error('stop failed'));
            cache.setAIService(service as any);
            await cache.acquire('proc-1');

            // Should not throw
            await expect(cache.release('proc-1')).resolves.toBeUndefined();
            expect(cache.has('proc-1')).toBe(false);
        });
    });

    // ========================================================================
    // markIdle
    // ========================================================================

    describe('markIdle', () => {
        it('is a no-op for unknown processId', () => {
            // Should not throw
            cache.markIdle('unknown');
        });

        it('starts the idle timer', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');

            cache.markIdle('proc-1');

            // Before timeout: still cached
            vi.advanceTimersByTime(59_000);
            expect(cache.has('proc-1')).toBe(true);

            // After timeout: auto-released
            vi.advanceTimersByTime(2_000);
            await vi.runAllTimersAsync();
            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(cache.has('proc-1')).toBe(false);
        });
    });

    // ========================================================================
    // Idle timeout
    // ========================================================================

    describe('idle timeout', () => {
        it('does NOT auto-dispose while client is active (acquired)', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');

            // No markIdle — client is active, no idle timer running
            vi.advanceTimersByTime(120_000); // 2x the timeout
            await vi.runAllTimersAsync();

            // Client must still be alive
            expect(mockClient.stop).not.toHaveBeenCalled();
            expect(cache.has('proc-1')).toBe(true);
        });

        it('auto-disposes after markIdle + idle timeout', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');

            // AI call completes — mark idle
            cache.markIdle('proc-1');

            vi.advanceTimersByTime(60_001);
            await vi.runAllTimersAsync();

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(cache.has('proc-1')).toBe(false);
        });

        it('acquire cancels idle timer (follow-up arrives before timeout)', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');

            // AI call completes — mark idle
            cache.markIdle('proc-1');

            // 50 seconds pass — follow-up arrives
            vi.advanceTimersByTime(50_000);
            expect(cache.has('proc-1')).toBe(true);

            // Acquire for follow-up — cancels idle timer
            await cache.acquire('proc-1');

            // Another 50 seconds — old timer would have fired, but was cancelled
            vi.advanceTimersByTime(50_000);
            await vi.runAllTimersAsync();
            expect(cache.has('proc-1')).toBe(true);
            expect(mockClient.stop).not.toHaveBeenCalled();
        });

        it('markIdle resets idle timer on each call', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');
            cache.markIdle('proc-1');

            // 50 seconds pass
            vi.advanceTimersByTime(50_000);
            expect(cache.has('proc-1')).toBe(true);

            // Follow-up: acquire then mark idle again
            await cache.acquire('proc-1');
            cache.markIdle('proc-1');

            // Another 50 seconds (total 100s from first markIdle, but 50s from second)
            vi.advanceTimersByTime(50_000);
            expect(cache.has('proc-1')).toBe(true);
            expect(mockClient.stop).not.toHaveBeenCalled();

            // Push past the new timeout
            vi.advanceTimersByTime(11_000);
            await vi.runAllTimersAsync();

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(cache.has('proc-1')).toBe(false);
        });

        it('clears idle timer on manual release', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);
            await cache.acquire('proc-1');
            cache.markIdle('proc-1');

            // Release before timeout fires
            await cache.release('proc-1');
            expect(mockClient.stop).toHaveBeenCalledOnce();

            // Advance past timeout — should NOT call stop again
            vi.advanceTimersByTime(120_000);
            await vi.runAllTimersAsync();
            expect(mockClient.stop).toHaveBeenCalledOnce(); // still 1
        });
    });

    // ========================================================================
    // disposeAll (server shutdown)
    // ========================================================================

    describe('disposeAll', () => {
        it('stops all cached clients', async () => {
            const client1 = createMockClient();
            const client2 = createMockClient();
            const client3 = createMockClient();
            const service = {
                createClient: vi.fn()
                    .mockResolvedValueOnce(client1)
                    .mockResolvedValueOnce(client2)
                    .mockResolvedValueOnce(client3),
            };
            cache.setAIService(service as any);

            await cache.acquire('proc-1');
            await cache.acquire('proc-2');
            await cache.acquire('proc-3');
            expect(cache.size).toBe(3);

            await cache.disposeAll();

            expect(client1.stop).toHaveBeenCalledOnce();
            expect(client2.stop).toHaveBeenCalledOnce();
            expect(client3.stop).toHaveBeenCalledOnce();
            expect(cache.size).toBe(0);
        });

        it('handles individual client.stop() failures gracefully', async () => {
            const client1 = createMockClient();
            const client2 = createMockClient();
            client1.stop.mockRejectedValue(new Error('stop failed'));
            const service = {
                createClient: vi.fn()
                    .mockResolvedValueOnce(client1)
                    .mockResolvedValueOnce(client2),
            };
            cache.setAIService(service as any);

            await cache.acquire('proc-1');
            await cache.acquire('proc-2');

            // Should not throw despite client1 failure
            await expect(cache.disposeAll()).resolves.toBeUndefined();
            expect(client2.stop).toHaveBeenCalledOnce();
            expect(cache.size).toBe(0);
        });

        it('is a no-op when cache is empty', async () => {
            await expect(cache.disposeAll()).resolves.toBeUndefined();
        });
    });

    // ========================================================================
    // Client reuse across initial + follow-up (integration-style)
    // ========================================================================

    describe('client reuse across follow-ups', () => {
        it('a chat with N follow-ups uses exactly 1 client', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);

            // Initial message
            const c1 = await cache.acquire('proc-1', '/repo');
            cache.markIdle('proc-1');
            // Follow-up 1
            const c2 = await cache.acquire('proc-1', '/repo');
            cache.markIdle('proc-1');
            // Follow-up 2
            const c3 = await cache.acquire('proc-1', '/repo');
            cache.markIdle('proc-1');
            // Follow-up 3
            const c4 = await cache.acquire('proc-1', '/repo');
            cache.markIdle('proc-1');

            expect(service.createClient).toHaveBeenCalledOnce();
            expect(c1).toBe(c2);
            expect(c2).toBe(c3);
            expect(c3).toBe(c4);
            expect(c1).toBe(mockClient);
        });

        it('cleanup after process end frees the client', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);

            await cache.acquire('proc-1');
            cache.markIdle('proc-1');
            await cache.acquire('proc-1'); // follow-up
            await cache.release('proc-1');     // process completed

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(cache.size).toBe(0);
        });

        it('full lifecycle: acquire → markIdle → idle timeout releases', async () => {
            const { service, mockClient } = createMockAIService();
            cache.setAIService(service as any);

            // Simulate: initial chat → follow-up → done
            await cache.acquire('proc-1');
            cache.markIdle('proc-1');

            vi.advanceTimersByTime(30_000); // 30s later: follow-up
            await cache.acquire('proc-1');
            cache.markIdle('proc-1');

            vi.advanceTimersByTime(30_000); // 30s later: no more follow-ups
            expect(cache.has('proc-1')).toBe(true);
            expect(mockClient.stop).not.toHaveBeenCalled();

            vi.advanceTimersByTime(31_000); // 60s from last markIdle
            await vi.runAllTimersAsync();

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(cache.has('proc-1')).toBe(false);
        });
    });

    // ========================================================================
    // Default idle timeout
    // ========================================================================

    describe('default configuration', () => {
        it('uses 10-minute default idle timeout', async () => {
            const defaultCache = new CopilotClientCache(); // no options
            const { service, mockClient } = createMockAIService();
            defaultCache.setAIService(service as any);

            await defaultCache.acquire('proc-1');
            defaultCache.markIdle('proc-1');

            // 9 minutes — should still be cached
            vi.advanceTimersByTime(9 * 60 * 1000);
            expect(defaultCache.has('proc-1')).toBe(true);

            // 10 minutes + 1ms — should be disposed
            vi.advanceTimersByTime(1 * 60 * 1000 + 1);
            await vi.runAllTimersAsync();

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(defaultCache.has('proc-1')).toBe(false);
        });
    });
});
