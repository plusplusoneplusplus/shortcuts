/**
 * Terminal Session Manager
 *
 * Manages server-side PTY terminal sessions. Each session wraps a
 * node-pty process and tracks dimensions, activity timestamps, and
 * workspace association.
 *
 * Features:
 *   - Platform-aware shell detection (PowerShell on Windows, $SHELL on Unix)
 *   - Graceful handling when node-pty is not installed (optional dep)
 *   - Auto-cleanup of idle sessions (configurable timeout)
 *   - Max concurrent sessions limit
 *   - Per-session event callbacks for output and exit
 */

import type { IPty, TerminalSession, TerminalSessionInfo } from './types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;      // 30 minutes
const DEFAULT_MAX_SESSIONS = 10;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;        // 1 minute
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// ============================================================================
// Types
// ============================================================================

export interface TerminalSessionManagerOptions {
    /** Max idle time in ms before auto-destroy (default: 1_800_000 = 30 minutes) */
    idleTimeoutMs?: number;
    /** Max concurrent terminal sessions across all workspaces (default: 10) */
    maxSessions?: number;
    /** How often to check for idle sessions in ms (default: 60_000 = 1 minute) */
    cleanupIntervalMs?: number;
    /** Override platform for testing (default: process.platform) */
    platform?: NodeJS.Platform;
    /** Override environment for spawned shells (default: process.env) */
    env?: Record<string, string>;
    /** Callback: fired when a session produces output */
    onData?: (sessionId: string, data: string) => void;
    /** Callback: fired when a session's PTY process exits */
    onExit?: (sessionId: string, exitCode: number, signal?: number) => void;
    /** Override node-pty module for testing (default: require('node-pty')) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodePtyModule?: { spawn: (...args: any[]) => IPty } | null;
}

// ============================================================================
// Helpers
// ============================================================================

function generateSessionId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

export function toSessionInfo(session: TerminalSession): TerminalSessionInfo {
    return {
        id: session.id,
        workspaceId: session.workspaceId,
        cols: session.cols,
        rows: session.rows,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        pid: session.pty.pid,
        pinned: session.pinned,
    };
}

// ============================================================================
// Manager
// ============================================================================

export class TerminalSessionManager {
    private readonly sessions = new Map<string, TerminalSession>();
    private readonly options: Required<Pick<TerminalSessionManagerOptions,
        'idleTimeoutMs' | 'maxSessions' | 'cleanupIntervalMs' | 'platform'>>;
    private readonly env: Record<string, string> | undefined;
    private readonly onData?: (sessionId: string, data: string) => void;
    private readonly onExit?: (sessionId: string, exitCode: number, signal?: number) => void;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private nodePty: { spawn: (...args: any[]) => IPty } | null = null;
    private nodePtyError: string | null = null;

    constructor(options?: TerminalSessionManagerOptions) {
        this.options = {
            idleTimeoutMs: options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
            maxSessions: options?.maxSessions ?? DEFAULT_MAX_SESSIONS,
            cleanupIntervalMs: options?.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
            platform: options?.platform ?? process.platform,
        };
        this.env = options?.env;
        this.onData = options?.onData;
        this.onExit = options?.onExit;

        if (options?.nodePtyModule !== undefined) {
            this.nodePty = options.nodePtyModule;
        } else {
            this.loadNodePty();
        }

        this.cleanupTimer = setInterval(
            () => this.cleanupIdleSessions(),
            this.options.cleanupIntervalMs,
        );
        // Don't prevent Node.js from exiting
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    // --------------------------------------------------------------------
    // Availability
    // --------------------------------------------------------------------

    private loadNodePty(): void {
        try {
            // Dynamic require — node-pty is an optional dependency
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this.nodePty = require('node-pty');
        } catch (err: unknown) {
            this.nodePty = null;
            this.nodePtyError = err instanceof Error ? err.message : String(err);
        }
    }

    isAvailable(): boolean {
        return this.nodePty !== null;
    }

    getUnavailableReason(): string | null {
        return this.nodePtyError;
    }

    // --------------------------------------------------------------------
    // Session lifecycle
    // --------------------------------------------------------------------

    createSession(workspaceId: string, rootPath: string, cols = DEFAULT_COLS, rows = DEFAULT_ROWS): TerminalSession {
        if (!this.nodePty) {
            throw new Error(`Terminal is not available: ${this.nodePtyError ?? 'node-pty not installed'}`);
        }
        const unpinnedCount = [...this.sessions.values()].filter(s => !s.pinned).length;
        if (unpinnedCount >= this.options.maxSessions) {
            throw new Error(`Maximum terminal sessions (${this.options.maxSessions}) reached`);
        }

        const { shell, args } = this.detectShell();
        const pty: IPty = this.nodePty.spawn(shell, args, {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: rootPath,
            env: this.env as any ?? process.env as any,
        });

        const id = generateSessionId();
        const session: TerminalSession = {
            id,
            workspaceId,
            pty,
            cols,
            rows,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            pinned: false,
        };

        // Wire PTY events
        pty.onData((data: string) => {
            session.lastActivity = Date.now();
            this.onData?.(id, data);
        });
        pty.onExit(({ exitCode, signal }) => {
            this.sessions.delete(id);
            this.onExit?.(id, exitCode, signal);
        });

        this.sessions.set(id, session);
        return session;
    }

    getSession(id: string): TerminalSession | undefined {
        return this.sessions.get(id);
    }

    getSessionsByWorkspace(workspaceId: string): TerminalSession[] {
        return [...this.sessions.values()].filter(s => s.workspaceId === workspaceId);
    }

    // --------------------------------------------------------------------
    // Session operations
    // --------------------------------------------------------------------

    writeToSession(id: string, data: string): void {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Terminal session not found: ${id}`);
        session.lastActivity = Date.now();
        session.pty.write(data);
    }

    resizeSession(id: string, cols: number, rows: number): void {
        const session = this.sessions.get(id);
        if (!session) throw new Error(`Terminal session not found: ${id}`);
        session.pty.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
    }

    destroySession(id: string): boolean {
        const session = this.sessions.get(id);
        if (!session) return false;
        try { session.pty.kill(); } catch { /* already dead */ }
        this.sessions.delete(id);
        return true;
    }

    // --------------------------------------------------------------------
    // Pin / Unpin
    // --------------------------------------------------------------------

    pinSession(id: string): boolean {
        const session = this.sessions.get(id);
        if (!session) return false;
        session.pinned = true;
        return true;
    }

    unpinSession(id: string): boolean {
        const session = this.sessions.get(id);
        if (!session) return false;
        session.pinned = false;
        session.lastActivity = Date.now();
        return true;
    }

    destroyAll(): void {
        for (const [, session] of this.sessions) {
            try { session.pty.kill(); } catch { /* ignore */ }
        }
        this.sessions.clear();
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    // --------------------------------------------------------------------
    // Accessors
    // --------------------------------------------------------------------

    get size(): number {
        return this.sessions.size;
    }

    get sessionIds(): string[] {
        return [...this.sessions.keys()];
    }

    // --------------------------------------------------------------------
    // Private
    // --------------------------------------------------------------------

    private detectShell(): { shell: string; args: string[] } {
        if (this.options.platform === 'win32') {
            return { shell: 'powershell.exe', args: [] };
        }
        // macOS/Linux: use $SHELL or fallback to /bin/bash
        const shell = process.env.SHELL || '/bin/bash';
        return { shell, args: ['--login'] };
    }

    private cleanupIdleSessions(): void {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            if (session.pinned) continue;
            if ((now - session.lastActivity) > this.options.idleTimeoutMs) {
                try { session.pty.kill(); } catch { /* ignore */ }
                this.sessions.delete(id);
                this.onExit?.(id, -1); // signal idle-kill to listeners
            }
        }
    }
}
