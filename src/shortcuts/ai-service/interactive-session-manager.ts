/**
 * Interactive Session Manager
 *
 * Manages the lifecycle of interactive AI CLI sessions running in external terminals.
 * Provides session tracking, state management, and event notifications.
 */

import * as vscode from 'vscode';
import {
    InteractiveSession,
    InteractiveSessionStatus,
    InteractiveSessionEvent,
    InteractiveSessionEventType,
    InteractiveToolType,
    TerminalType,
    ExternalTerminalLaunchOptions
} from './types';
import { ExternalTerminalLauncher, getExternalTerminalLauncher } from './external-terminal-launcher';

/**
 * Options for starting an interactive session
 */
export interface StartSessionOptions {
    /** Working directory for the session */
    workingDirectory: string;
    /** CLI tool to use (defaults to 'copilot') */
    tool?: InteractiveToolType;
    /** Initial prompt to send to the CLI */
    initialPrompt?: string;
    /** Preferred terminal type (auto-detected if not specified) */
    preferredTerminal?: TerminalType;
}

/**
 * Interactive Session Manager
 *
 * Tracks and manages interactive AI CLI sessions running in external terminals.
 */
export class InteractiveSessionManager implements vscode.Disposable {
    private sessions: Map<string, InteractiveSession> = new Map();
    private launcher: ExternalTerminalLauncher;
    private sessionCounter: number = 0;

    private readonly _onDidChangeSessions = new vscode.EventEmitter<InteractiveSessionEvent>();
    readonly onDidChangeSessions: vscode.Event<InteractiveSessionEvent> = this._onDidChangeSessions.event;

    constructor(launcher?: ExternalTerminalLauncher) {
        this.launcher = launcher ?? getExternalTerminalLauncher();
    }

    /**
     * Generate a unique session ID
     */
    private generateSessionId(): string {
        this.sessionCounter++;
        return `session-${this.sessionCounter}-${Date.now()}`;
    }

    /**
     * Start a new interactive session
     *
     * @param options Session options
     * @returns The session ID if successful, undefined if failed
     */
    async startSession(options: StartSessionOptions): Promise<string | undefined> {
        const {
            workingDirectory,
            tool = 'copilot',
            initialPrompt,
            preferredTerminal
        } = options;

        const sessionId = this.generateSessionId();

        // Create the session in 'starting' state
        const session: InteractiveSession = {
            id: sessionId,
            startTime: new Date(),
            status: 'starting',
            workingDirectory,
            tool,
            initialPrompt,
            terminalType: 'unknown'
        };

        this.sessions.set(sessionId, session);
        this.fireEvent('session-started', session);

        // Launch the external terminal
        const launchOptions: ExternalTerminalLaunchOptions = {
            workingDirectory,
            tool,
            initialPrompt,
            preferredTerminal
        };

        const result = await this.launcher.launch(launchOptions);

        if (result.success) {
            // Update session to active
            session.status = 'active';
            session.terminalType = result.terminalType;
            session.pid = result.pid;
            this.fireEvent('session-updated', session);
            return sessionId;
        } else {
            // Update session to error
            session.status = 'error';
            session.terminalType = result.terminalType;
            session.error = result.error;
            session.endTime = new Date();
            this.fireEvent('session-error', session);
            return undefined;
        }
    }

    /**
     * End a session (mark as ended)
     *
     * @param sessionId The session ID to end
     * @returns True if the session was ended, false if not found
     */
    endSession(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }

        if (session.status === 'ended' || session.status === 'error') {
            return false; // Already ended
        }

        session.status = 'ended';
        session.endTime = new Date();
        this.fireEvent('session-ended', session);
        return true;
    }

    /**
     * Update a session's status
     *
     * @param sessionId The session ID to update
     * @param status The new status
     * @param error Optional error message (for 'error' status)
     * @returns True if updated, false if session not found
     */
    updateSessionStatus(sessionId: string, status: InteractiveSessionStatus, error?: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }

        session.status = status;
        if (error) {
            session.error = error;
        }
        if (status === 'ended' || status === 'error') {
            session.endTime = new Date();
        }

        const eventType: InteractiveSessionEventType =
            status === 'error' ? 'session-error' :
                status === 'ended' ? 'session-ended' : 'session-updated';

        this.fireEvent(eventType, session);
        return true;
    }

    /**
     * Remove a session from tracking
     *
     * @param sessionId The session ID to remove
     * @returns True if removed, false if not found
     */
    removeSession(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }

        // If still active, mark as ended first
        if (session.status === 'active' || session.status === 'starting') {
            session.status = 'ended';
            session.endTime = new Date();
        }

        this.sessions.delete(sessionId);
        this.fireEvent('session-ended', session);
        return true;
    }

    /**
     * Get a session by ID
     */
    getSession(sessionId: string): InteractiveSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Get all sessions
     */
    getSessions(): InteractiveSession[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Get active sessions only
     */
    getActiveSessions(): InteractiveSession[] {
        return this.getSessions().filter(
            s => s.status === 'active' || s.status === 'starting'
        );
    }

    /**
     * Get ended sessions only
     */
    getEndedSessions(): InteractiveSession[] {
        return this.getSessions().filter(
            s => s.status === 'ended' || s.status === 'error'
        );
    }

    /**
     * Check if there are any active sessions
     */
    hasActiveSessions(): boolean {
        return this.getActiveSessions().length > 0;
    }

    /**
     * Get the count of sessions by status
     */
    getSessionCounts(): Record<InteractiveSessionStatus, number> {
        const counts: Record<InteractiveSessionStatus, number> = {
            starting: 0,
            active: 0,
            ended: 0,
            error: 0
        };

        for (const session of this.sessions.values()) {
            counts[session.status]++;
        }

        return counts;
    }

    /**
     * Clear all ended sessions
     */
    clearEndedSessions(): void {
        const endedIds: string[] = [];
        for (const [id, session] of this.sessions.entries()) {
            if (session.status === 'ended' || session.status === 'error') {
                endedIds.push(id);
            }
        }

        for (const id of endedIds) {
            this.sessions.delete(id);
        }
    }

    /**
     * Clear all sessions
     */
    clearAllSessions(): void {
        // End active sessions first
        for (const session of this.sessions.values()) {
            if (session.status === 'active' || session.status === 'starting') {
                session.status = 'ended';
                session.endTime = new Date();
                this.fireEvent('session-ended', session);
            }
        }

        this.sessions.clear();
    }

    /**
     * Fire a session event
     */
    private fireEvent(type: InteractiveSessionEventType, session: InteractiveSession): void {
        this._onDidChangeSessions.fire({ type, session });
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.clearAllSessions();
        this._onDidChangeSessions.dispose();
    }
}

/**
 * Singleton instance for convenience
 */
let defaultManager: InteractiveSessionManager | undefined;

/**
 * Get the default InteractiveSessionManager instance
 */
export function getInteractiveSessionManager(): InteractiveSessionManager {
    if (!defaultManager) {
        defaultManager = new InteractiveSessionManager();
    }
    return defaultManager;
}

/**
 * Reset the default manager (useful for testing)
 */
export function resetInteractiveSessionManager(): void {
    if (defaultManager) {
        defaultManager.dispose();
        defaultManager = undefined;
    }
}
