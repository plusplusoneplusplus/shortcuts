/**
 * SessionManager — tracks and aborts active Copilot SDK sessions.
 *
 * Extracted from CopilotSDKService so session lifecycle logic is independently
 * testable without pulling in the full service. Has no dependency on
 * CopilotSDKService.
 */

import { createSessionLogger } from './logger';
import type { IStreamableSession } from './streaming-session';

/**
 * Minimal interface for a session that can be tracked and aborted.
 * ICopilotSession in copilot-sdk-service.ts is a strict superset and is
 * structurally compatible via TypeScript's structural typing.
 */
export interface IAbortableSession {
    sessionId: string;
    destroy(): Promise<void>;
}

/**
 * Tracks in-flight sessions and provides abort / inspection helpers.
 */
export class SessionManager {
    private readonly activeSessions = new Map<string, IAbortableSession>();

    /**
     * Register an active session for potential cancellation.
     */
    track(session: IAbortableSession): void {
        this.activeSessions.set(session.sessionId, session);
    }

    /**
     * Remove a session from tracking (called when the session ends normally).
     */
    untrack(sessionId: string): void {
        this.activeSessions.delete(sessionId);
    }

    /**
     * Retrieve a tracked session by ID, narrowed to IStreamableSession
     * (which is a superset of IAbortableSession). Returns undefined if
     * the session is not tracked or does not have a `send` method.
     */
    getSession(sessionId: string): IStreamableSession | undefined {
        const session = this.activeSessions.get(sessionId);
        if (!session) return undefined;
        // Only return if it looks like a streamable session (has send)
        if ('send' in session && typeof (session as any).send === 'function') {
            return session as unknown as IStreamableSession;
        }
        return undefined;
    }

    /**
     * Soft-abort an active session by calling the SDK's abort() method.
     * This signals the CLI to stop in-flight work without destroying the session.
     * The streaming promise settles with a partial result; the request-runner
     * finally block handles destroy() and untrack().
     *
     * Falls back to hard destroy if abort() is unavailable or fails.
     *
     * @returns `true` if the session was found and soft-aborted, `false` otherwise.
     */
    async softAbort(sessionId: string): Promise<boolean> {
        const sessionLog = createSessionLogger(sessionId);

        const session = this.activeSessions.get(sessionId);
        if (!session) {
            sessionLog.debug('Session not found for soft abort');
            return false;
        }

        sessionLog.debug('Soft-aborting session');

        try {
            if ('abort' in session && typeof (session as any).abort === 'function') {
                await (session as any).abort();
                sessionLog.debug('Session soft-aborted successfully');
                return true;
            }
            // No abort method — fall back to hard destroy
            sessionLog.debug('Session has no abort() — falling back to hard destroy');
            await session.destroy();
            this.activeSessions.delete(sessionId);
            return true;
        } catch (error) {
            sessionLog.error(
                { err: error instanceof Error ? error : undefined },
                'Error soft-aborting session — falling back to hard destroy',
            );
            try { await session.destroy(); } catch { /* best effort */ }
            this.activeSessions.delete(sessionId);
            return false;
        }
    }

    /**
     * Abort an active session by its ID.
     * Destroys the session and removes it from tracking.
     *
     * @returns `true` if the session was found and aborted, `false` otherwise.
     */
    async abort(sessionId: string): Promise<boolean> {
        const sessionLog = createSessionLogger(sessionId);

        const session = this.activeSessions.get(sessionId);
        if (!session) {
            sessionLog.debug('Session not found for abort');
            return false;
        }

        sessionLog.debug('Aborting session');

        try {
            await session.destroy();
            this.activeSessions.delete(sessionId);
            sessionLog.debug('Session aborted successfully');
            return true;
        } catch (error) {
            sessionLog.error(
                { err: error instanceof Error ? error : undefined },
                'Error aborting session',
            );
            // Still remove from tracking even if destroy failed
            this.activeSessions.delete(sessionId);
            return false;
        }
    }

    /**
     * Abort all active sessions, then clear the tracking map.
     * Uses `Promise.allSettled` so individual failures do not block others.
     */
    async abortAll(): Promise<void> {
        const abortPromises: Promise<void>[] = [];
        for (const [sessionId] of this.activeSessions) {
            abortPromises.push(this.abort(sessionId).then(() => {}));
        }
        await Promise.allSettled(abortPromises);
        this.activeSessions.clear();
    }

    /**
     * Returns `true` if the session is currently tracked as active.
     */
    has(sessionId: string): boolean {
        return this.activeSessions.has(sessionId);
    }

    /**
     * Returns the number of currently active (tracked) sessions.
     */
    count(): number {
        return this.activeSessions.size;
    }
}
