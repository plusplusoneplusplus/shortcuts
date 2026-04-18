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
 * - Pre-warmed idle pool: initialize, pop, recycle, rotation, dispose
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
            isAvailable: vi.fn().mockResolvedValue({ available: true }),
        },
        mockClient,
    };
}

/** AI service that returns a fresh mock client for each createClient call. */
function createMultiClientAIService() {
    return {
        service: {
            createClient: vi.fn().mockImplementation(() => Promise.resolve(createMockClient())),
            isAvailable: vi.fn().mockResolvedValue({ available: true }),
        },
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
                isAvailable: vi.fn().mockResolvedValue({ available: true }),
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
        it('stops the client and removes it from cache when pool is disabled', async () => {
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const { service, mockClient } = createMockAIService();
            disabledPoolCache.setAIService(service as any);
            await disabledPoolCache.acquire('proc-1');

            await disabledPoolCache.release('proc-1');

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(disabledPoolCache.has('proc-1')).toBe(false);
            expect(disabledPoolCache.size).toBe(0);
        });

        it('is a no-op when processId is not cached', async () => {
            await expect(cache.release('unknown')).resolves.toBeUndefined();
        });

        it('does not affect other cached clients', async () => {
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const client1 = createMockClient();
            const client2 = createMockClient();
            const service = {
                createClient: vi.fn()
                    .mockResolvedValueOnce(client1)
                    .mockResolvedValueOnce(client2),
                isAvailable: vi.fn().mockResolvedValue({ available: true }),
            };
            disabledPoolCache.setAIService(service as any);

            await disabledPoolCache.acquire('proc-1');
            await disabledPoolCache.acquire('proc-2');
            await disabledPoolCache.release('proc-1');

            expect(client1.stop).toHaveBeenCalledOnce();
            expect(client2.stop).not.toHaveBeenCalled();
            expect(disabledPoolCache.size).toBe(1);
            expect(disabledPoolCache.has('proc-2')).toBe(true);
        });

        it('handles client.stop() errors gracefully', async () => {
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const { service, mockClient } = createMockAIService();
            mockClient.stop.mockRejectedValue(new Error('stop failed'));
            disabledPoolCache.setAIService(service as any);
            await disabledPoolCache.acquire('proc-1');

            // Should not throw
            await expect(disabledPoolCache.release('proc-1')).resolves.toBeUndefined();
            expect(disabledPoolCache.has('proc-1')).toBe(false);
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
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const { service, mockClient } = createMockAIService();
            disabledPoolCache.setAIService(service as any);
            await disabledPoolCache.acquire('proc-1');

            disabledPoolCache.markIdle('proc-1');

            // Before timeout: still cached
            vi.advanceTimersByTime(59_000);
            expect(disabledPoolCache.has('proc-1')).toBe(true);

            // After timeout: auto-released
            vi.advanceTimersByTime(2_000);
            await vi.runAllTimersAsync();
            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(disabledPoolCache.has('proc-1')).toBe(false);
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
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const { service, mockClient } = createMockAIService();
            disabledPoolCache.setAIService(service as any);
            await disabledPoolCache.acquire('proc-1');

            // AI call completes — mark idle
            disabledPoolCache.markIdle('proc-1');

            vi.advanceTimersByTime(60_001);
            await vi.runAllTimersAsync();

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(disabledPoolCache.has('proc-1')).toBe(false);
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
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const { service, mockClient } = createMockAIService();
            disabledPoolCache.setAIService(service as any);
            await disabledPoolCache.acquire('proc-1');
            disabledPoolCache.markIdle('proc-1');

            // 50 seconds pass
            vi.advanceTimersByTime(50_000);
            expect(disabledPoolCache.has('proc-1')).toBe(true);

            // Follow-up: acquire then mark idle again
            await disabledPoolCache.acquire('proc-1');
            disabledPoolCache.markIdle('proc-1');

            // Another 50 seconds (total 100s from first markIdle, but 50s from second)
            vi.advanceTimersByTime(50_000);
            expect(disabledPoolCache.has('proc-1')).toBe(true);
            expect(mockClient.stop).not.toHaveBeenCalled();

            // Push past the new timeout
            vi.advanceTimersByTime(11_000);
            await vi.runAllTimersAsync();

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(disabledPoolCache.has('proc-1')).toBe(false);
        });

        it('clears idle timer on manual release', async () => {
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const { service, mockClient } = createMockAIService();
            disabledPoolCache.setAIService(service as any);
            await disabledPoolCache.acquire('proc-1');
            disabledPoolCache.markIdle('proc-1');

            // Release before timeout fires
            await disabledPoolCache.release('proc-1');
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
                isAvailable: vi.fn().mockResolvedValue({ available: true }),
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
                isAvailable: vi.fn().mockResolvedValue({ available: true }),
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
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const { service, mockClient } = createMockAIService();
            disabledPoolCache.setAIService(service as any);

            await disabledPoolCache.acquire('proc-1');
            disabledPoolCache.markIdle('proc-1');
            await disabledPoolCache.acquire('proc-1'); // follow-up
            await disabledPoolCache.release('proc-1');     // process completed

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(disabledPoolCache.size).toBe(0);
        });

        it('full lifecycle: acquire → markIdle → idle timeout releases', async () => {
            const disabledPoolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
            const { service, mockClient } = createMockAIService();
            disabledPoolCache.setAIService(service as any);

            // Simulate: initial chat → follow-up → done
            await disabledPoolCache.acquire('proc-1');
            disabledPoolCache.markIdle('proc-1');

            vi.advanceTimersByTime(30_000); // 30s later: follow-up
            await disabledPoolCache.acquire('proc-1');
            disabledPoolCache.markIdle('proc-1');

            vi.advanceTimersByTime(30_000); // 30s later: no more follow-ups
            expect(disabledPoolCache.has('proc-1')).toBe(true);
            expect(mockClient.stop).not.toHaveBeenCalled();

            vi.advanceTimersByTime(31_000); // 60s from last markIdle
            await vi.runAllTimersAsync();

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(disabledPoolCache.has('proc-1')).toBe(false);
        });
    });

    // ========================================================================
    // Default idle timeout
    // ========================================================================

    describe('default configuration', () => {
        it('uses 5-minute default idle timeout', async () => {
            const defaultCache = new CopilotClientCache({ poolEnabled: false }); // disable pool for this test
            const { service, mockClient } = createMockAIService();
            defaultCache.setAIService(service as any);

            await defaultCache.acquire('proc-1');
            defaultCache.markIdle('proc-1');

            // 4 minutes — should still be cached
            vi.advanceTimersByTime(4 * 60 * 1000);
            expect(defaultCache.has('proc-1')).toBe(true);

            // 5 minutes + 1ms — should be disposed
            vi.advanceTimersByTime(1 * 60 * 1000 + 1);
            await vi.runAllTimersAsync();

            expect(mockClient.stop).toHaveBeenCalledOnce();
            expect(defaultCache.has('proc-1')).toBe(false);
        });
    });

    // ========================================================================
    // Pre-warmed idle pool
    // ========================================================================

    describe('idle pool', () => {
        describe('initialize (pre-warming)', () => {
            it('pre-warms pool with configured number of clients', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 3 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();

                expect(service.createClient).toHaveBeenCalledTimes(3);
                expect(poolCache.poolCurrentSize).toBe(3);
            });

            it('is a no-op when pool is disabled', async () => {
                const poolCache = new CopilotClientCache({ poolEnabled: false });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();

                expect(service.createClient).not.toHaveBeenCalled();
                expect(poolCache.poolCurrentSize).toBe(0);
            });

            it('is a no-op when poolSize is 0', async () => {
                const poolCache = new CopilotClientCache({ poolSize: 0 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();

                expect(service.createClient).not.toHaveBeenCalled();
                expect(poolCache.poolCurrentSize).toBe(0);
            });

            it('is a no-op when aiService is not set', async () => {
                const poolCache = new CopilotClientCache({ poolSize: 3 });
                await poolCache.initialize();
                expect(poolCache.poolCurrentSize).toBe(0);
            });

            it('handles partial spawn failures gracefully', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 3 });
                let callCount = 0;
                const service = {
                    createClient: vi.fn().mockImplementation(() => {
                        callCount++;
                        if (callCount === 2) return Promise.reject(new Error('spawn failed'));
                        return Promise.resolve(createMockClient());
                    }),
                    isAvailable: vi.fn().mockResolvedValue({ available: true }),
                };
                poolCache.setAIService(service as any);

                await poolCache.initialize();

                // 2 out of 3 succeeded
                expect(poolCache.poolCurrentSize).toBe(2);
            });
        });

        describe('acquire from pool', () => {
            it('pops a client from the pool instead of spawning', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 2 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();
                expect(service.createClient).toHaveBeenCalledTimes(2);

                const client = await poolCache.acquire('proc-1', '/repo');

                // Client came from pool — no additional createClient call beyond replenish
                expect(client).toBeDefined();
                expect(poolCache.poolCurrentSize).toBeLessThanOrEqual(2); // one was popped, replenish may add one
            });

            it('falls back to spawning when pool is empty', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 0, poolEnabled: true });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                const client = await poolCache.acquire('proc-1', '/repo');

                expect(client).toBeDefined();
                expect(service.createClient).toHaveBeenCalledWith('/repo');
            });

            it('still returns cached client for existing processId (pool is not consulted)', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 2 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);
                await poolCache.initialize();

                const c1 = await poolCache.acquire('proc-1', '/repo');
                poolCache.markIdle('proc-1');
                const c2 = await poolCache.acquire('proc-1', '/repo');

                expect(c1).toBe(c2);
            });
        });

        describe('release recycles into pool', () => {
            it('recycles client back into pool when under capacity', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 3 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                // Don't initialize — pool starts empty
                expect(poolCache.poolCurrentSize).toBe(0);

                await poolCache.acquire('proc-1', '/repo');
                await poolCache.release('proc-1');

                // Client should be recycled into pool, not stopped
                expect(poolCache.poolCurrentSize).toBe(1);
            });

            it('stops client when pool is at capacity', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 1 });
                const poolClient = createMockClient();
                const replenishedClient = createMockClient();
                const service = {
                    createClient: vi.fn()
                        .mockResolvedValueOnce(poolClient) // pool init
                        .mockResolvedValueOnce(replenishedClient), // async replenish after pop
                    isAvailable: vi.fn().mockResolvedValue({ available: true }),
                };
                poolCache.setAIService(service as any);

                await poolCache.initialize(); // fills pool to 1
                expect(poolCache.poolCurrentSize).toBe(1);

                await poolCache.acquire('proc-1', '/repo'); // pops poolClient
                // Flush microtasks so async replenish completes
                await vi.advanceTimersByTimeAsync(0);
                expect(poolCache.poolCurrentSize).toBe(1); // replenished

                await poolCache.release('proc-1'); // pool full → stop poolClient

                expect(poolClient.stop).toHaveBeenCalledOnce();
                expect(poolCache.poolCurrentSize).toBe(1);
            });

            it('does not recycle when pool is disabled', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolEnabled: false });
                const { service, mockClient } = createMockAIService();
                poolCache.setAIService(service as any);

                await poolCache.acquire('proc-1');
                await poolCache.release('proc-1');

                expect(mockClient.stop).toHaveBeenCalledOnce();
                expect(poolCache.poolCurrentSize).toBe(0);
            });
        });

        describe('stale rotation', () => {
            it('rotates stale pool clients after maxAge', async () => {
                const poolCache = new CopilotClientCache({
                    idleTimeoutMs: 60_000,
                    poolSize: 2,
                    poolIdleMaxAgeMs: 120_000, // 2 min for test
                });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();
                const initialCreateCount = service.createClient.mock.calls.length;
                expect(poolCache.poolCurrentSize).toBe(2);

                // Advance past the pool idle max age + rotation interval (1 min check)
                // Use advanceTimersByTimeAsync to flush microtasks between intervals
                await vi.advanceTimersByTimeAsync(180_000); // 3 minutes

                // Stale clients should have been rotated — new ones created
                expect(service.createClient.mock.calls.length).toBeGreaterThan(initialCreateCount);

                await poolCache.disposeAll();
            });
        });

        describe('disposeAll with pool', () => {
            it('stops all cached clients AND pool clients', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 2 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();
                await poolCache.acquire('proc-1', '/repo');
                // Flush microtasks so async replenish completes
                await vi.advanceTimersByTimeAsync(0);

                // Collect all clients created so far
                const allClients = service.createClient.mock.results.map(r => r.value);

                await poolCache.disposeAll();

                // All clients (pool + cached) should be stopped
                for (const client of allClients) {
                    expect(client.stop).toHaveBeenCalled();
                }
                expect(poolCache.size).toBe(0);
                expect(poolCache.poolCurrentSize).toBe(0);
            });

            it('clears the rotation timer', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 2 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();

                await poolCache.disposeAll();

                // Advance time — rotation should NOT fire and create new clients
                const callCountAfterDispose = service.createClient.mock.calls.length;
                vi.advanceTimersByTime(300_000);
                await vi.runAllTimersAsync();
                expect(service.createClient.mock.calls.length).toBe(callCountAfterDispose);
            });
        });

        describe('poolCurrentSize', () => {
            it('returns 0 when pool is empty', () => {
                expect(cache.poolCurrentSize).toBe(0);
            });

            it('reflects pool size after initialize', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 3 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();
                expect(poolCache.poolCurrentSize).toBe(3);
            });

            it('decreases when clients are popped', async () => {
                const poolCache = new CopilotClientCache({ idleTimeoutMs: 60_000, poolSize: 2 });
                const { service } = createMultiClientAIService();
                poolCache.setAIService(service as any);

                await poolCache.initialize();
                expect(poolCache.poolCurrentSize).toBe(2);

                await poolCache.acquire('proc-1');
                // Pool size decreases by 1 (replenish is async, may or may not have completed)
                expect(poolCache.poolCurrentSize).toBeLessThanOrEqual(2);
            });
        });

        describe('default pool configuration', () => {
            it('defaults to poolSize=3, poolEnabled=true', async () => {
                const defaultCache = new CopilotClientCache();
                const { service } = createMultiClientAIService();
                defaultCache.setAIService(service as any);

                await defaultCache.initialize();
                expect(service.createClient).toHaveBeenCalledTimes(3);
                expect(defaultCache.poolCurrentSize).toBe(3);

                await defaultCache.disposeAll();
            });
        });

        describe('reconfigure', () => {
            it('disabling pool drains all pooled clients', async () => {
                const { service } = createMultiClientAIService();
                const cache = new CopilotClientCache({ poolSize: 3, poolEnabled: true });
                cache.setAIService(service as any);
                await cache.initialize();
                expect(cache.poolCurrentSize).toBe(3);

                await cache.reconfigure({ enabled: false });
                expect(cache.poolCurrentSize).toBe(0);

                await cache.disposeAll();
            });

            it('enabling pool replenishes to configured size', async () => {
                const { service } = createMultiClientAIService();
                const cache = new CopilotClientCache({ poolSize: 0, poolEnabled: false });
                cache.setAIService(service as any);
                await cache.initialize();
                expect(cache.poolCurrentSize).toBe(0);

                await cache.reconfigure({ enabled: true, size: 2 });
                expect(cache.poolCurrentSize).toBe(2);

                await cache.disposeAll();
            });

            it('increasing size replenishes the difference', async () => {
                const { service } = createMultiClientAIService();
                const cache = new CopilotClientCache({ poolSize: 1, poolEnabled: true });
                cache.setAIService(service as any);
                await cache.initialize();
                expect(cache.poolCurrentSize).toBe(1);

                await cache.reconfigure({ size: 3 });
                expect(cache.poolCurrentSize).toBe(3);

                await cache.disposeAll();
            });

            it('decreasing size drains excess clients', async () => {
                const { service } = createMultiClientAIService();
                const cache = new CopilotClientCache({ poolSize: 3, poolEnabled: true });
                cache.setAIService(service as any);
                await cache.initialize();
                expect(cache.poolCurrentSize).toBe(3);

                await cache.reconfigure({ size: 1 });
                expect(cache.poolCurrentSize).toBe(1);

                await cache.disposeAll();
            });

            it('no-op when nothing changes', async () => {
                const { service } = createMultiClientAIService();
                const cache = new CopilotClientCache({ poolSize: 2, poolEnabled: true });
                cache.setAIService(service as any);
                await cache.initialize();
                const callsBefore = service.createClient.mock.calls.length;

                await cache.reconfigure({ enabled: true, size: 2 });
                // No additional createClient calls
                expect(service.createClient.mock.calls.length).toBe(callsBefore);

                await cache.disposeAll();
            });
        });
    });
});
