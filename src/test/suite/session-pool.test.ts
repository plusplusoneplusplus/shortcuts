/**
 * Tests for SessionPool
 *
 * Comprehensive tests for the session pool including:
 * - Pool creation and configuration
 * - Session acquire/release lifecycle
 * - Concurrency limiting
 * - Idle timeout cleanup
 * - Error handling
 * - Cross-platform compatibility
 *
 * These tests use mock sessions to avoid actual SDK dependencies.
 */

import * as assert from 'assert';
import {
    SessionPool,
    SessionPoolOptions,
    SessionPoolStats,
    IPoolableSession,
    SessionFactory
} from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Mock Types and Utilities
// ============================================================================

interface MockSessionOptions {
    sessionId?: string;
    response?: string;
    shouldFail?: boolean;
    failMessage?: string;
    destroyShouldFail?: boolean;
    sendDelay?: number;
}

/**
 * Create a mock session for testing
 */
function createMockSession(options?: MockSessionOptions): IPoolableSession {
    const sessionId = options?.sessionId ?? `mock-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const response = options?.response ?? 'Mock response';
    const shouldFail = options?.shouldFail ?? false;
    const failMessage = options?.failMessage ?? 'Mock error';
    const destroyShouldFail = options?.destroyShouldFail ?? false;
    const sendDelay = options?.sendDelay ?? 0;

    return {
        sessionId,
        sendAndWait: async ({ prompt }) => {
            if (sendDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, sendDelay));
            }
            if (shouldFail) {
                throw new Error(failMessage);
            }
            return { data: { content: response } };
        },
        destroy: async () => {
            if (destroyShouldFail) {
                throw new Error('Destroy failed');
            }
        }
    };
}

/**
 * Create a mock session factory
 */
function createMockFactory(options?: {
    sessions?: IPoolableSession[];
    shouldFail?: boolean;
    failMessage?: string;
    createDelay?: number;
}): { factory: SessionFactory; createdSessions: IPoolableSession[] } {
    const sessions = options?.sessions ?? [];
    const shouldFail = options?.shouldFail ?? false;
    const failMessage = options?.failMessage ?? 'Factory error';
    const createDelay = options?.createDelay ?? 0;
    const createdSessions: IPoolableSession[] = [];
    let sessionIndex = 0;

    const factory: SessionFactory = async () => {
        if (createDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, createDelay));
        }
        if (shouldFail) {
            throw new Error(failMessage);
        }
        const session = sessions[sessionIndex] ?? createMockSession();
        sessionIndex++;
        createdSessions.push(session);
        return session;
    };

    return { factory, createdSessions };
}

/**
 * Sleep helper for async tests
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Pool Creation Tests
// ============================================================================

suite('SessionPool - Creation', () => {
    test('should create pool with default options', () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory);

        const stats = pool.getStats();
        assert.strictEqual(stats.maxSessions, SessionPool.DEFAULT_MAX_SESSIONS);
        assert.strictEqual(stats.idleTimeoutMs, SessionPool.DEFAULT_IDLE_TIMEOUT_MS);
        assert.strictEqual(stats.totalSessions, 0);

        pool.dispose();
    });

    test('should create pool with custom options', () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, {
            maxSessions: 10,
            idleTimeoutMs: 60000,
            minSessions: 2
        });

        const stats = pool.getStats();
        assert.strictEqual(stats.maxSessions, 10);
        assert.strictEqual(stats.idleTimeoutMs, 60000);

        pool.dispose();
    });

    test('should throw error for invalid maxSessions', () => {
        const { factory } = createMockFactory();

        assert.throws(() => {
            new SessionPool(factory, { maxSessions: 0 });
        }, /maxSessions must be at least 1/);

        assert.throws(() => {
            new SessionPool(factory, { maxSessions: -1 });
        }, /maxSessions must be at least 1/);
    });

    test('should throw error when minSessions exceeds maxSessions', () => {
        const { factory } = createMockFactory();

        assert.throws(() => {
            new SessionPool(factory, { maxSessions: 3, minSessions: 5 });
        }, /minSessions cannot exceed maxSessions/);
    });

    test('should throw error for negative idleTimeoutMs', () => {
        const { factory } = createMockFactory();

        assert.throws(() => {
            new SessionPool(factory, { idleTimeoutMs: -1 });
        }, /idleTimeoutMs cannot be negative/);
    });
});

// ============================================================================
// Acquire/Release Lifecycle Tests
// ============================================================================

suite('SessionPool - Acquire/Release Lifecycle', () => {
    test('should acquire a new session when pool is empty', async () => {
        const { factory, createdSessions } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        const session = await pool.acquire();

        assert.ok(session, 'Should return a session');
        assert.strictEqual(createdSessions.length, 1, 'Should create one session');
        assert.strictEqual(session.sessionId, createdSessions[0].sessionId);

        const stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 1);
        assert.strictEqual(stats.inUseSessions, 1);
        assert.strictEqual(stats.idleSessions, 0);

        await pool.dispose();
    });

    test('should reuse idle session on acquire', async () => {
        const { factory, createdSessions } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        // Acquire and release a session
        const session1 = await pool.acquire();
        pool.release(session1);

        // Acquire again - should reuse the same session
        const session2 = await pool.acquire();

        assert.strictEqual(createdSessions.length, 1, 'Should not create new session');
        assert.strictEqual(session2.sessionId, session1.sessionId, 'Should reuse same session');

        await pool.dispose();
    });

    test('should release session back to pool', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        const session = await pool.acquire();
        
        let stats = pool.getStats();
        assert.strictEqual(stats.inUseSessions, 1);
        assert.strictEqual(stats.idleSessions, 0);

        pool.release(session);

        stats = pool.getStats();
        assert.strictEqual(stats.inUseSessions, 0);
        assert.strictEqual(stats.idleSessions, 1);

        await pool.dispose();
    });

    test('should handle release of unknown session', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        // Create a session outside the pool
        const unknownSession = createMockSession({ sessionId: 'unknown-session' });

        // Should not throw
        pool.release(unknownSession);

        const stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 0, 'Should not add unknown session to pool');

        await pool.dispose();
    });
});

// ============================================================================
// Concurrency Limiting Tests
// ============================================================================

suite('SessionPool - Concurrency Limiting', () => {
    test('should limit concurrent sessions to maxSessions', async () => {
        const { factory, createdSessions } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 3 });

        // Acquire 3 sessions
        const session1 = await pool.acquire();
        const session2 = await pool.acquire();
        const session3 = await pool.acquire();

        assert.strictEqual(createdSessions.length, 3);

        const stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 3);
        assert.strictEqual(stats.inUseSessions, 3);

        await pool.dispose();
    });

    test('should wait for session when pool is at capacity', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 1 });

        // Acquire the only session
        const session1 = await pool.acquire();

        // Start acquiring another session (should wait)
        let session2Acquired = false;
        const acquirePromise = pool.acquire(1000).then(s => {
            session2Acquired = true;
            return s;
        });

        // Wait a bit to ensure acquire is waiting
        await sleep(50);
        assert.strictEqual(session2Acquired, false, 'Should be waiting for session');

        // Release the first session
        pool.release(session1);

        // Now the second acquire should complete
        const session2 = await acquirePromise;
        assert.strictEqual(session2Acquired, true);
        assert.strictEqual(session2.sessionId, session1.sessionId, 'Should get the released session');

        await pool.dispose();
    });

    test('should timeout when waiting too long for session', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 1 });

        // Acquire the only session
        await pool.acquire();

        // Try to acquire another with short timeout
        try {
            await pool.acquire(100);
            assert.fail('Should have thrown timeout error');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok((error as Error).message.includes('Timeout'));
        }

        await pool.dispose();
    });

    test('should handle multiple waiters in order', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 1 });

        // Acquire the only session
        const session1 = await pool.acquire();

        const acquireOrder: number[] = [];

        // Start multiple waiters
        const waiter1 = pool.acquire(2000).then(s => {
            acquireOrder.push(1);
            return s;
        });
        const waiter2 = pool.acquire(2000).then(s => {
            acquireOrder.push(2);
            return s;
        });

        // Wait a bit for waiters to queue
        await sleep(50);

        // Release session - should go to first waiter
        pool.release(session1);
        const s1 = await waiter1;

        // Release again - should go to second waiter
        pool.release(s1);
        await waiter2;

        assert.deepStrictEqual(acquireOrder, [1, 2], 'Waiters should be served in order');

        await pool.dispose();
    });
});

// ============================================================================
// Idle Timeout Cleanup Tests
// ============================================================================

suite('SessionPool - Idle Timeout Cleanup', () => {
    test('should clean up idle sessions after timeout', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, {
            maxSessions: 5,
            idleTimeoutMs: 100,
            cleanupIntervalMs: 50
        });

        // Acquire and release a session
        const session = await pool.acquire();
        pool.release(session);

        let stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 1);

        // Wait for idle timeout + cleanup interval
        await sleep(200);

        // Manually trigger cleanup (in case timer hasn't fired)
        await pool.cleanupIdleSessions();

        stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 0, 'Idle session should be cleaned up');

        await pool.dispose();
    });

    test('should not clean up sessions in use', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, {
            maxSessions: 5,
            idleTimeoutMs: 50,
            cleanupIntervalMs: 25
        });

        // Acquire a session but don't release it
        const session = await pool.acquire();

        // Wait for potential cleanup
        await sleep(100);
        await pool.cleanupIdleSessions();

        const stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 1, 'In-use session should not be cleaned up');
        assert.strictEqual(stats.inUseSessions, 1);

        await pool.dispose();
    });

    test('should respect minSessions during cleanup', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, {
            maxSessions: 5,
            minSessions: 2,
            idleTimeoutMs: 50,
            cleanupIntervalMs: 25
        });

        // Acquire and release 3 sessions
        const s1 = await pool.acquire();
        const s2 = await pool.acquire();
        const s3 = await pool.acquire();
        pool.release(s1);
        pool.release(s2);
        pool.release(s3);

        let stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 3);

        // Wait for idle timeout
        await sleep(100);
        const cleaned = await pool.cleanupIdleSessions();

        stats = pool.getStats();
        // Should keep at least minSessions
        assert.ok(stats.totalSessions >= 2, 'Should keep at least minSessions');
        assert.ok(cleaned <= 1, 'Should only clean up sessions above minSessions');

        await pool.dispose();
    });

    test('manual cleanupIdleSessions should return count', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, {
            maxSessions: 5,
            idleTimeoutMs: 50,
            cleanupIntervalMs: 60000 // Long interval so we control cleanup
        });

        // Acquire and release sessions
        const s1 = await pool.acquire();
        const s2 = await pool.acquire();
        pool.release(s1);
        pool.release(s2);

        // Wait for idle timeout
        await sleep(100);

        const cleaned = await pool.cleanupIdleSessions();
        assert.strictEqual(cleaned, 2, 'Should report 2 sessions cleaned');

        await pool.dispose();
    });
});

// ============================================================================
// Destroy Session Tests
// ============================================================================

suite('SessionPool - Destroy Session', () => {
    test('should destroy session and remove from pool', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        const session = await pool.acquire();

        let stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 1);

        await pool.destroy(session);

        stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 0, 'Session should be removed from pool');

        await pool.dispose();
    });

    test('should handle destroy error gracefully', async () => {
        const errorSession = createMockSession({ destroyShouldFail: true });
        const { factory } = createMockFactory({ sessions: [errorSession] });
        const pool = new SessionPool(factory, { maxSessions: 5 });

        const session = await pool.acquire();

        // Should not throw
        await pool.destroy(session);

        const stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 0);

        await pool.dispose();
    });
});

// ============================================================================
// Pool Statistics Tests
// ============================================================================

suite('SessionPool - Statistics', () => {
    test('getStats should return accurate statistics', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, {
            maxSessions: 10,
            idleTimeoutMs: 60000
        });

        // Initial stats
        let stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 0);
        assert.strictEqual(stats.inUseSessions, 0);
        assert.strictEqual(stats.idleSessions, 0);
        assert.strictEqual(stats.waitingRequests, 0);
        assert.strictEqual(stats.maxSessions, 10);
        assert.strictEqual(stats.idleTimeoutMs, 60000);

        // After acquiring sessions
        const s1 = await pool.acquire();
        const s2 = await pool.acquire();

        stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 2);
        assert.strictEqual(stats.inUseSessions, 2);
        assert.strictEqual(stats.idleSessions, 0);

        // After releasing one
        pool.release(s1);

        stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 2);
        assert.strictEqual(stats.inUseSessions, 1);
        assert.strictEqual(stats.idleSessions, 1);

        await pool.dispose();
    });

    test('getStats should track waiting requests', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 1 });

        // Acquire the only session
        const session = await pool.acquire();

        // Start a waiter
        const waiterPromise = pool.acquire(1000);

        // Give time for waiter to queue
        await sleep(50);

        const stats = pool.getStats();
        assert.strictEqual(stats.waitingRequests, 1);

        // Release to satisfy waiter
        pool.release(session);
        await waiterPromise;

        await pool.dispose();
    });
});

// ============================================================================
// Dispose Tests
// ============================================================================

suite('SessionPool - Dispose', () => {
    test('should dispose all sessions', async () => {
        const { factory, createdSessions } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        // Acquire multiple sessions
        await pool.acquire();
        await pool.acquire();
        await pool.acquire();

        assert.strictEqual(createdSessions.length, 3);

        await pool.dispose();

        assert.strictEqual(pool.isDisposed(), true);
    });

    test('should reject waiters on dispose', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 1 });

        // Acquire the only session
        await pool.acquire();

        // Start a waiter
        const waiterPromise = pool.acquire(5000);

        // Give time for waiter to queue
        await sleep(50);

        // Dispose the pool
        await pool.dispose();

        // Waiter should be rejected
        try {
            await waiterPromise;
            assert.fail('Waiter should have been rejected');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok((error as Error).message.includes('disposed'));
        }
    });

    test('should throw on acquire after dispose', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        await pool.dispose();

        try {
            await pool.acquire();
            assert.fail('Should have thrown error');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok((error as Error).message.includes('disposed'));
        }
    });

    test('dispose should be idempotent', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        // Should not throw when called multiple times
        await pool.dispose();
        await pool.dispose();
        await pool.dispose();
    });

    test('release after dispose should destroy session', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        const session = await pool.acquire();

        await pool.dispose();

        // Release after dispose should not throw
        pool.release(session);
    });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

suite('SessionPool - Error Handling', () => {
    test('should handle factory errors', async () => {
        const { factory } = createMockFactory({
            shouldFail: true,
            failMessage: 'Factory failed'
        });
        const pool = new SessionPool(factory, { maxSessions: 5 });

        try {
            await pool.acquire();
            assert.fail('Should have thrown error');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok((error as Error).message.includes('Factory failed'));
        }

        await pool.dispose();
    });

    test('should handle session destroy errors during cleanup', async () => {
        const errorSession = createMockSession({ destroyShouldFail: true });
        const { factory } = createMockFactory({ sessions: [errorSession] });
        const pool = new SessionPool(factory, {
            maxSessions: 5,
            idleTimeoutMs: 50
        });

        const session = await pool.acquire();
        pool.release(session);

        // Wait for idle timeout
        await sleep(100);

        // Should not throw
        await pool.cleanupIdleSessions();

        await pool.dispose();
    });
});

// ============================================================================
// Cross-Platform Tests
// ============================================================================

suite('SessionPool - Cross-Platform', () => {
    test('should work with various session ID formats', async () => {
        const sessions = [
            createMockSession({ sessionId: 'simple-id' }),
            createMockSession({ sessionId: 'id-with-numbers-123' }),
            createMockSession({ sessionId: 'id_with_underscores' }),
            createMockSession({ sessionId: 'id.with.dots' }),
            createMockSession({ sessionId: 'ID-WITH-CAPS' })
        ];
        const { factory } = createMockFactory({ sessions });
        const pool = new SessionPool(factory, { maxSessions: 5 });

        for (let i = 0; i < sessions.length; i++) {
            const session = await pool.acquire();
            assert.ok(session.sessionId, 'Session should have ID');
            pool.release(session);
        }

        await pool.dispose();
    });

    test('should handle concurrent acquire/release', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 3 });

        // Run many concurrent operations
        const operations: Promise<void>[] = [];
        for (let i = 0; i < 10; i++) {
            operations.push((async () => {
                const session = await pool.acquire(5000);
                await sleep(Math.random() * 50);
                pool.release(session);
            })());
        }

        await Promise.all(operations);

        const stats = pool.getStats();
        assert.strictEqual(stats.inUseSessions, 0, 'All sessions should be released');

        await pool.dispose();
    });
});

// ============================================================================
// Integration Tests
// ============================================================================

suite('SessionPool - Integration', () => {
    test('should handle realistic usage pattern', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, {
            maxSessions: 3,
            idleTimeoutMs: 200,
            cleanupIntervalMs: 100
        });

        // Simulate burst of requests
        const sessions: IPoolableSession[] = [];
        for (let i = 0; i < 3; i++) {
            sessions.push(await pool.acquire());
        }

        let stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 3);
        assert.strictEqual(stats.inUseSessions, 3);

        // Release all sessions
        for (const session of sessions) {
            pool.release(session);
        }

        stats = pool.getStats();
        assert.strictEqual(stats.inUseSessions, 0);
        assert.strictEqual(stats.idleSessions, 3);

        // Wait for idle cleanup
        await sleep(350);
        await pool.cleanupIdleSessions();

        stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 0, 'All idle sessions should be cleaned up');

        await pool.dispose();
    });

    test('should handle mixed acquire/release/destroy operations', async () => {
        const { factory } = createMockFactory();
        const pool = new SessionPool(factory, { maxSessions: 5 });

        const s1 = await pool.acquire();
        const s2 = await pool.acquire();
        const s3 = await pool.acquire();

        pool.release(s1);
        await pool.destroy(s2);
        pool.release(s3);

        const stats = pool.getStats();
        assert.strictEqual(stats.totalSessions, 2);
        assert.strictEqual(stats.idleSessions, 2);

        await pool.dispose();
    });
});
