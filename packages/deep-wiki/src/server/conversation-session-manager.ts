/**
 * Conversation Session Manager
 *
 * Manages server-side conversation sessions for the Ask AI feature.
 * Each session wraps an AskAIFunction and tracks turn history so
 * follow-up questions can reuse the same AI context.
 *
 * Features:
 *   - Session creation with auto-generated IDs
 *   - Session lookup and reuse for multi-turn conversations
 *   - Auto-cleanup of idle sessions (configurable timeout)
 *   - Max concurrent sessions limit
 *   - Per-session mutex to prevent concurrent sends
 */

import type { AskAIFunction } from './ask-handler';

// ============================================================================
// Types
// ============================================================================

/** A single conversation session. */
export interface ConversationSession {
    /** Unique session identifier */
    sessionId: string;
    /** Number of AI turns completed */
    turnCount: number;
    /** Timestamp of last activity */
    lastUsedAt: number;
    /** Timestamp of session creation */
    createdAt: number;
    /** Whether a send is currently in progress */
    busy: boolean;
}

/** Options for creating the ConversationSessionManager. */
export interface ConversationSessionManagerOptions {
    /** The AI send function to use for all sessions */
    sendMessage: AskAIFunction;
    /** Max idle time in ms before auto-cleanup (default: 600000 = 10 minutes) */
    idleTimeoutMs?: number;
    /** Max concurrent sessions (default: 5) */
    maxSessions?: number;
    /** Cleanup interval in ms (default: 60000 = 1 minute) */
    cleanupIntervalMs?: number;
}

/** Result of sending a message through a session. */
export interface SessionSendResult {
    /** The AI response */
    response: string;
    /** The session ID (same as input, or new if created) */
    sessionId: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_SESSIONS = 5;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// ============================================================================
// Manager
// ============================================================================

/**
 * Manages conversation sessions for multi-turn AI Q&A.
 *
 * Each session tracks its turn count and last-used time. Sessions are
 * automatically cleaned up when idle for too long. A per-session mutex
 * prevents concurrent AI calls on the same session.
 */
export class ConversationSessionManager {
    private readonly sessions = new Map<string, ConversationSession>();
    private readonly sendMessage: AskAIFunction;
    private readonly idleTimeoutMs: number;
    private readonly maxSessions: number;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor(options: ConversationSessionManagerOptions) {
        this.sendMessage = options.sendMessage;
        this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;

        const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
        this.cleanupTimer = setInterval(() => this.cleanupIdleSessions(), cleanupIntervalMs);
        // Don't prevent Node.js from exiting
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    /**
     * Create a new conversation session.
     * @returns The new session, or null if max sessions reached.
     */
    create(): ConversationSession | null {
        if (this.sessions.size >= this.maxSessions) {
            // Try to evict the oldest idle session
            const evicted = this.evictOldestIdle();
            if (!evicted) {
                return null;
            }
        }

        const sessionId = generateSessionId();
        const session: ConversationSession = {
            sessionId,
            turnCount: 0,
            lastUsedAt: Date.now(),
            createdAt: Date.now(),
            busy: false,
        };

        this.sessions.set(sessionId, session);
        return session;
    }

    /**
     * Get an existing session by ID.
     * @returns The session, or undefined if not found.
     */
    get(sessionId: string): ConversationSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Send a message using a session.
     * If the session is busy, rejects with an error.
     */
    async send(
        sessionId: string,
        prompt: string,
        options?: {
            model?: string;
            workingDirectory?: string;
            onStreamingChunk?: (chunk: string) => void;
        },
    ): Promise<SessionSendResult> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        if (session.busy) {
            throw new Error(`Session is busy: ${sessionId}`);
        }

        session.busy = true;
        try {
            const response = await this.sendMessage(prompt, {
                model: options?.model,
                workingDirectory: options?.workingDirectory,
                onStreamingChunk: options?.onStreamingChunk,
            });

            session.turnCount++;
            session.lastUsedAt = Date.now();

            return { response, sessionId };
        } finally {
            session.busy = false;
        }
    }

    /**
     * Destroy a specific session.
     */
    destroy(sessionId: string): boolean {
        return this.sessions.delete(sessionId);
    }

    /**
     * Destroy all sessions and stop the cleanup timer.
     */
    destroyAll(): void {
        this.sessions.clear();
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Get the number of active sessions.
     */
    get size(): number {
        return this.sessions.size;
    }

    /**
     * Get all session IDs.
     */
    get sessionIds(): string[] {
        return Array.from(this.sessions.keys());
    }

    /**
     * Remove sessions that have been idle for longer than idleTimeoutMs.
     */
    private cleanupIdleSessions(): void {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (!session.busy && (now - session.lastUsedAt) > this.idleTimeoutMs) {
                this.sessions.delete(id);
            }
        }
    }

    /**
     * Evict the oldest idle session to make room for a new one.
     * @returns true if a session was evicted.
     */
    private evictOldestIdle(): boolean {
        let oldestId: string | null = null;
        let oldestTime = Infinity;

        for (const [id, session] of this.sessions) {
            if (!session.busy && session.lastUsedAt < oldestTime) {
                oldestTime = session.lastUsedAt;
                oldestId = id;
            }
        }

        if (oldestId) {
            this.sessions.delete(oldestId);
            return true;
        }
        return false;
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a random session ID.
 */
function generateSessionId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}
