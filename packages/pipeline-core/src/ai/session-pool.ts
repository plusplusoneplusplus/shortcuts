/**
 * Session Pool for Copilot SDK
 *
 * Manages a pool of reusable Copilot SDK sessions for efficient concurrent request handling.
 * This pool provides:
 * - Session reuse to avoid creation overhead
 * - Concurrency limiting to prevent resource exhaustion
 * - Idle timeout cleanup to free unused sessions
 * - Graceful shutdown with proper session cleanup
 *
 * @see https://github.com/github/copilot-sdk
 */

import { getLogger, LogCategory } from '../logger';

/**
 * Interface for a Copilot SDK session.
 * Defined here to avoid direct type dependency on the SDK.
 */
export interface IPoolableSession {
    /** Unique session identifier */
    sessionId: string;
    /** Send a message and wait for response */
    sendAndWait(options: { prompt: string }): Promise<{ data?: { content?: string } }>;
    /** Destroy the session and release resources */
    destroy(): Promise<void>;
}

/**
 * Factory function type for creating new sessions.
 * This allows the pool to be decoupled from the actual SDK client.
 */
export type SessionFactory = () => Promise<IPoolableSession>;

/**
 * Configuration options for the session pool.
 */
export interface SessionPoolOptions {
    /** Maximum number of sessions in the pool (default: 5) */
    maxSessions?: number;
    /** Idle timeout in milliseconds before a session is destroyed (default: 300000 = 5 minutes) */
    idleTimeoutMs?: number;
    /** Minimum number of sessions to keep in the pool even when idle (default: 0) */
    minSessions?: number;
    /** How often to check for idle sessions in milliseconds (default: 60000 = 1 minute) */
    cleanupIntervalMs?: number;
}

/**
 * Internal representation of a pooled session with metadata.
 */
interface PooledSession {
    /** The actual SDK session */
    session: IPoolableSession;
    /** Whether the session is currently in use */
    inUse: boolean;
    /** Timestamp when the session was last used (for idle timeout) */
    lastUsedAt: number;
    /** Timestamp when the session was created */
    createdAt: number;
}

/**
 * Statistics about the session pool.
 */
export interface SessionPoolStats {
    /** Total number of sessions in the pool */
    totalSessions: number;
    /** Number of sessions currently in use */
    inUseSessions: number;
    /** Number of idle sessions available */
    idleSessions: number;
    /** Number of requests waiting for a session */
    waitingRequests: number;
    /** Maximum sessions allowed */
    maxSessions: number;
    /** Idle timeout in milliseconds */
    idleTimeoutMs: number;
}

/**
 * A waiter for a session when the pool is exhausted.
 */
interface SessionWaiter {
    resolve: (session: IPoolableSession) => void;
    reject: (error: Error) => void;
    timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Session pool for managing reusable Copilot SDK sessions.
 *
 * Usage:
 * ```typescript
 * const pool = new SessionPool(createSession, { maxSessions: 5 });
 *
 * // Acquire a session
 * const session = await pool.acquire();
 * try {
 *     const result = await session.sendAndWait({ prompt: 'Hello' });
 * } finally {
 *     // Release the session back to the pool
 *     pool.release(session);
 * }
 *
 * // Clean up when done
 * await pool.dispose();
 * ```
 */
export class SessionPool {
    private readonly sessions: Map<string, PooledSession> = new Map();
    private readonly waiters: SessionWaiter[] = [];
    private readonly sessionFactory: SessionFactory;
    private readonly maxSessions: number;
    private readonly idleTimeoutMs: number;
    private readonly minSessions: number;
    private readonly cleanupIntervalMs: number;
    private cleanupTimer?: ReturnType<typeof setInterval>;
    private disposed = false;

    /** Default maximum sessions */
    public static readonly DEFAULT_MAX_SESSIONS = 5;
    /** Default idle timeout (5 minutes) */
    public static readonly DEFAULT_IDLE_TIMEOUT_MS = 300000;
    /** Default minimum sessions to keep */
    public static readonly DEFAULT_MIN_SESSIONS = 0;
    /** Default cleanup interval (1 minute) */
    public static readonly DEFAULT_CLEANUP_INTERVAL_MS = 60000;
    /** Default acquire timeout (30 seconds) */
    public static readonly DEFAULT_ACQUIRE_TIMEOUT_MS = 30000;

    /**
     * Create a new session pool.
     *
     * @param sessionFactory Factory function to create new sessions
     * @param options Pool configuration options
     */
    constructor(sessionFactory: SessionFactory, options: SessionPoolOptions = {}) {
        this.sessionFactory = sessionFactory;
        this.maxSessions = options.maxSessions ?? SessionPool.DEFAULT_MAX_SESSIONS;
        this.idleTimeoutMs = options.idleTimeoutMs ?? SessionPool.DEFAULT_IDLE_TIMEOUT_MS;
        this.minSessions = options.minSessions ?? SessionPool.DEFAULT_MIN_SESSIONS;
        this.cleanupIntervalMs = options.cleanupIntervalMs ?? SessionPool.DEFAULT_CLEANUP_INTERVAL_MS;

        // Validate options
        if (this.maxSessions < 1) {
            throw new Error('maxSessions must be at least 1');
        }
        if (this.minSessions > this.maxSessions) {
            throw new Error('minSessions cannot exceed maxSessions');
        }
        if (this.idleTimeoutMs < 0) {
            throw new Error('idleTimeoutMs cannot be negative');
        }

        // Start the cleanup timer
        this.startCleanupTimer();

        const logger = getLogger();
        logger.debug(LogCategory.AI, `SessionPool: Created with maxSessions=${this.maxSessions}, idleTimeoutMs=${this.idleTimeoutMs}`);
    }

    /**
     * Acquire a session from the pool.
     * If no idle session is available and the pool is not at capacity, a new session is created.
     * If the pool is at capacity, this will wait until a session becomes available.
     *
     * @param timeoutMs Maximum time to wait for a session (default: 30 seconds)
     * @returns A session from the pool
     * @throws Error if the pool is disposed or timeout is reached
     */
    public async acquire(timeoutMs: number = SessionPool.DEFAULT_ACQUIRE_TIMEOUT_MS): Promise<IPoolableSession> {
        if (this.disposed) {
            throw new Error('SessionPool has been disposed');
        }

        const logger = getLogger();
        logger.debug(LogCategory.AI, `SessionPool: Acquiring session (total=${this.sessions.size}, inUse=${this.getInUseCount()})`);

        // Try to find an idle session
        const idleSession = this.findIdleSession();
        if (idleSession) {
            idleSession.inUse = true;
            idleSession.lastUsedAt = Date.now();
            logger.debug(LogCategory.AI, `SessionPool: Reusing idle session ${idleSession.session.sessionId}`);
            return idleSession.session;
        }

        // If we can create a new session, do so
        if (this.sessions.size < this.maxSessions) {
            const session = await this.createAndAddSession();
            logger.debug(LogCategory.AI, `SessionPool: Created new session ${session.sessionId}`);
            return session;
        }

        // Otherwise, wait for a session to become available
        logger.debug(LogCategory.AI, `SessionPool: Pool at capacity, waiting for available session`);
        return this.waitForSession(timeoutMs);
    }

    /**
     * Release a session back to the pool.
     * The session becomes available for reuse by other requests.
     *
     * @param session The session to release
     */
    public release(session: IPoolableSession): void {
        if (this.disposed) {
            // If disposed, just destroy the session
            this.destroySession(session).catch(() => {
                // Ignore errors during dispose
            });
            return;
        }

        const pooledSession = this.sessions.get(session.sessionId);
        if (!pooledSession) {
            // Session not in pool, destroy it
            const logger = getLogger();
            logger.debug(LogCategory.AI, `SessionPool: Session ${session.sessionId} not in pool, destroying`);
            this.destroySession(session).catch(() => {
                // Ignore errors
            });
            return;
        }

        const logger = getLogger();

        // Check if there are waiters
        if (this.waiters.length > 0) {
            const waiter = this.waiters.shift()!;
            if (waiter.timeoutId) {
                clearTimeout(waiter.timeoutId);
            }
            pooledSession.lastUsedAt = Date.now();
            logger.debug(LogCategory.AI, `SessionPool: Passing session ${session.sessionId} to waiting request`);
            waiter.resolve(session);
            return;
        }

        // No waiters, mark as idle
        pooledSession.inUse = false;
        pooledSession.lastUsedAt = Date.now();
        logger.debug(LogCategory.AI, `SessionPool: Released session ${session.sessionId} back to pool`);
    }

    /**
     * Destroy a specific session and remove it from the pool.
     * Use this when a session is in an error state and should not be reused.
     *
     * @param session The session to destroy
     */
    public async destroy(session: IPoolableSession): Promise<void> {
        const logger = getLogger();
        logger.debug(LogCategory.AI, `SessionPool: Destroying session ${session.sessionId}`);

        this.sessions.delete(session.sessionId);
        await this.destroySession(session);
    }

    /**
     * Get statistics about the pool.
     *
     * @returns Current pool statistics
     */
    public getStats(): SessionPoolStats {
        const inUseSessions = this.getInUseCount();
        return {
            totalSessions: this.sessions.size,
            inUseSessions,
            idleSessions: this.sessions.size - inUseSessions,
            waitingRequests: this.waiters.length,
            maxSessions: this.maxSessions,
            idleTimeoutMs: this.idleTimeoutMs
        };
    }

    /**
     * Check if the pool has been disposed.
     */
    public isDisposed(): boolean {
        return this.disposed;
    }

    /**
     * Dispose of the pool and all sessions.
     * After disposal, the pool cannot be used.
     */
    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }

        const logger = getLogger();
        logger.debug(LogCategory.AI, 'SessionPool: Disposing pool');

        this.disposed = true;

        // Stop the cleanup timer
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        // Reject all waiters
        for (const waiter of this.waiters) {
            if (waiter.timeoutId) {
                clearTimeout(waiter.timeoutId);
            }
            waiter.reject(new Error('SessionPool has been disposed'));
        }
        this.waiters.length = 0;

        // Destroy all sessions
        const destroyPromises: Promise<void>[] = [];
        for (const [, pooledSession] of this.sessions) {
            destroyPromises.push(this.destroySession(pooledSession.session));
        }
        this.sessions.clear();

        await Promise.allSettled(destroyPromises);
        logger.debug(LogCategory.AI, 'SessionPool: Disposed');
    }

    /**
     * Manually trigger cleanup of idle sessions.
     * This is automatically called on a timer, but can be called manually for testing.
     */
    public async cleanupIdleSessions(): Promise<number> {
        if (this.disposed) {
            return 0;
        }

        const logger = getLogger();
        const now = Date.now();
        const sessionsToRemove: string[] = [];

        // Find sessions that have been idle too long
        for (const [sessionId, pooledSession] of this.sessions) {
            if (!pooledSession.inUse) {
                const idleTime = now - pooledSession.lastUsedAt;
                if (idleTime > this.idleTimeoutMs) {
                    // Keep minimum sessions
                    const idleCount = this.sessions.size - this.getInUseCount();
                    const currentIdleAfterRemoval = idleCount - sessionsToRemove.length - 1;
                    if (currentIdleAfterRemoval >= this.minSessions) {
                        sessionsToRemove.push(sessionId);
                    }
                }
            }
        }

        // Remove and destroy idle sessions
        for (const sessionId of sessionsToRemove) {
            const pooledSession = this.sessions.get(sessionId);
            if (pooledSession) {
                this.sessions.delete(sessionId);
                await this.destroySession(pooledSession.session);
                logger.debug(LogCategory.AI, `SessionPool: Cleaned up idle session ${sessionId}`);
            }
        }

        if (sessionsToRemove.length > 0) {
            logger.debug(LogCategory.AI, `SessionPool: Cleaned up ${sessionsToRemove.length} idle sessions`);
        }

        return sessionsToRemove.length;
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Find an idle session in the pool.
     */
    private findIdleSession(): PooledSession | undefined {
        for (const [, pooledSession] of this.sessions) {
            if (!pooledSession.inUse) {
                return pooledSession;
            }
        }
        return undefined;
    }

    /**
     * Get the count of sessions currently in use.
     */
    private getInUseCount(): number {
        let count = 0;
        for (const [, pooledSession] of this.sessions) {
            if (pooledSession.inUse) {
                count++;
            }
        }
        return count;
    }

    /**
     * Create a new session and add it to the pool.
     */
    private async createAndAddSession(): Promise<IPoolableSession> {
        const session = await this.sessionFactory();
        const now = Date.now();

        this.sessions.set(session.sessionId, {
            session,
            inUse: true,
            lastUsedAt: now,
            createdAt: now
        });

        return session;
    }

    /**
     * Wait for a session to become available.
     */
    private waitForSession(timeoutMs: number): Promise<IPoolableSession> {
        return new Promise((resolve, reject) => {
            const waiter: SessionWaiter = { resolve, reject };

            // Set up timeout
            waiter.timeoutId = setTimeout(() => {
                const index = this.waiters.indexOf(waiter);
                if (index !== -1) {
                    this.waiters.splice(index, 1);
                }
                reject(new Error(`Timeout waiting for session after ${timeoutMs}ms`));
            }, timeoutMs);

            this.waiters.push(waiter);
        });
    }

    /**
     * Destroy a session (internal helper).
     */
    private async destroySession(session: IPoolableSession): Promise<void> {
        try {
            await session.destroy();
        } catch (error) {
            const logger = getLogger();
            logger.debug(LogCategory.AI, `SessionPool: Error destroying session ${session.sessionId}: ${error}`);
        }
    }

    /**
     * Start the cleanup timer.
     */
    private startCleanupTimer(): void {
        if (this.cleanupIntervalMs > 0) {
            this.cleanupTimer = setInterval(() => {
                this.cleanupIdleSessions().catch(() => {
                    // Ignore cleanup errors
                });
            }, this.cleanupIntervalMs);

            // Don't let the timer prevent Node from exiting
            if (this.cleanupTimer.unref) {
                this.cleanupTimer.unref();
            }
        }
    }
}
