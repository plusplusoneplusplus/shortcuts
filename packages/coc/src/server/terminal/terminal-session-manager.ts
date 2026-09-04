/**
 * Manages server-side PTY terminal sessions. Each session wraps a
 * node-pty process and tracks dimensions, activity timestamps, and
 * workspace association.
 *
 * Features:
 *   - Platform-aware shell detection (PowerShell on Windows, $SHELL on Unix)
 *   - Graceful handling when node-pty is not installed (optional dep)
 *   - Sessions never expire on their own: there is no idle reaper. A PTY
 *     lives until the shell exits or someone explicitly destroys it.
 *   - Max concurrent sessions limit
 *   - Per-session event callbacks for output and exit
 *   - A per-session scrollback ring buffer, replayed when a client attaches
 */

import {
    buildWslCommandArgs,
    getWslExecutablePath,
    resolveWorkspaceExecutionContext,
} from '@plusplusoneplusplus/forge';
import type { IPty, TerminalSession, TerminalSessionInfo } from './types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_SESSIONS = 10;
/**
 * Approximate scrollback cap per session, ~1 MiB (~10,000 lines at ~100 B/line).
 * The cap is by bytes, not lines: chunks are dropped whole from the front once
 * the total exceeds it, so the retained size can dip slightly under the cap.
 */
export const SCROLLBACK_MAX_BYTES = 1_048_576;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// ============================================================================
// Types
// ============================================================================

export interface TerminalSessionManagerOptions {
    /** Max concurrent terminal sessions across all workspaces (default: 10) */
    maxSessions?: number;
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

/**
 * Append a PTY chunk to a session's scrollback, trimming the oldest chunks
 * whole once the byte cap is exceeded. A single chunk larger than the cap is
 * kept as its tail, which is the part the user would still be looking at.
 */
export function appendToScrollback(session: TerminalSession, data: string): void {
    let chunk = Buffer.from(data, 'utf-8');
    if (chunk.length === 0) return;

    if (chunk.length > SCROLLBACK_MAX_BYTES) {
        chunk = chunk.subarray(chunk.length - SCROLLBACK_MAX_BYTES);
        session.buffer.length = 0;
        session.bufferBytes = 0;
        session.truncated = true;
    }

    session.buffer.push(chunk);
    session.bufferBytes += chunk.length;

    while (session.bufferBytes > SCROLLBACK_MAX_BYTES && session.buffer.length > 1) {
        const dropped = session.buffer.shift()!;
        session.bufferBytes -= dropped.length;
        session.truncated = true;
    }
}

// ============================================================================
// Manager
// ============================================================================

export class TerminalSessionManager {
    private readonly sessions = new Map<string, TerminalSession>();
    private readonly options: Required<Pick<TerminalSessionManagerOptions,
        'maxSessions' | 'platform'>>;
    private readonly env: Record<string, string> | undefined;
    private readonly onData?: (sessionId: string, data: string) => void;
    private readonly onExit?: (sessionId: string, exitCode: number, signal?: number) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private nodePty: { spawn: (...args: any[]) => IPty } | null = null;
    private nodePtyError: string | null = null;

    constructor(options?: TerminalSessionManagerOptions) {
        this.options = {
            maxSessions: options?.maxSessions ?? DEFAULT_MAX_SESSIONS,
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

        const { shell, args } = this.detectShell(rootPath);
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
            buffer: [],
            bufferBytes: 0,
            truncated: false,
        };

        // Wire PTY events
        pty.onData((data: string) => {
            session.lastActivity = Date.now();
            appendToScrollback(session, data);
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

    /**
     * Snapshot a session's scrollback for replay. The chunks are concatenated
     * before decoding so a multi-byte UTF-8 sequence split across two PTY
     * chunks still decodes correctly.
     */
    getScrollback(id: string): { data: string; truncated: boolean } | undefined {
        const session = this.sessions.get(id);
        if (!session) return undefined;
        return {
            data: Buffer.concat(session.buffer).toString('utf-8'),
            truncated: session.truncated,
        };
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
        session.lastActivity = Date.now();
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

    isSessionPinned(id: string): boolean {
        return this.sessions.get(id)?.pinned === true;
    }

    destroyAll(): void {
        for (const [, session] of this.sessions) {
            try { session.pty.kill(); } catch { /* ignore */ }
        }
        this.sessions.clear();
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

    private detectShell(rootPath: string): { shell: string; args: string[] } {
        if (this.options.platform === 'win32') {
            const executionContext = resolveWorkspaceExecutionContext(rootPath);
            if (executionContext.kind === 'wsl') {
                return {
                    shell: getWslExecutablePath(),
                    args: buildWslCommandArgs(executionContext, ['bash', '--login']),
                };
            }
            return { shell: 'powershell.exe', args: [] };
        }
        // macOS/Linux: use $SHELL or fallback to /bin/bash
        const shell = process.env.SHELL || '/bin/bash';
        return { shell, args: ['--login'] };
    }
}
