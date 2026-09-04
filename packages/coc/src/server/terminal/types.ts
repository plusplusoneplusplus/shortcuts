// ============================================================================
// PTY interface (local mirror of node-pty's IPty)
// ============================================================================

/**
 * Minimal PTY interface mirroring essential methods from node-pty.
 * Defined locally so types.ts is importable even when node-pty is not installed,
 * and tests can provide lightweight mocks without the real module.
 */
export interface IPty {
    readonly pid: number;
    readonly cols: number;
    readonly rows: number;
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(signal?: string): void;
    onData: (callback: (data: string) => void) => { dispose(): void };
    onExit: (callback: (e: { exitCode: number; signal?: number }) => void) => { dispose(): void };
}

// ============================================================================
// Session types
// ============================================================================

/** A live terminal session managed by TerminalSessionManager. */
export interface TerminalSession {
    /** Unique session identifier (12-char random alphanum) */
    readonly id: string;
    readonly workspaceId: string;
    /**
     * The underlying PTY process (internal use only). `null` for an exited
     * session: the tombstone stays in the map so it can be listed and
     * restarted, but there is no live process behind it.
     */
    pty: IPty | null;
    cols: number;
    rows: number;
    /** Shell executable the PTY was spawned with */
    readonly shell: string;
    /** Working directory the PTY was spawned in */
    readonly cwd: string;
    /** Display title (defaults to the shell's basename) */
    title: string;
    /** Unix timestamp of creation */
    readonly createdAt: number;
    /** Unix timestamp of last input or output activity */
    lastActivity: number;
    /** Lifecycle state; flips to 'exited' when the PTY process ends */
    status: 'running' | 'exited';
    /** Unix timestamp of the PTY exit, set alongside `status: 'exited'` */
    exitedAt?: number;
    /** Exit code of the PTY process, set alongside `status: 'exited'` */
    exitCode?: number;
    /** Whether this session is pinned (exempt from the soft session limit) */
    pinned: boolean;
    /**
     * Server-side scrollback: raw PTY output chunks (ANSI escapes included),
     * trimmed from the front on whole-chunk boundaries once the byte cap is
     * exceeded. Replayed to a client when it attaches.
     */
    buffer: Buffer[];
    /** Sum of `buffer` chunk byte lengths, kept in step with `buffer`. */
    bufferBytes: number;
    /** True once any output has been dropped from the front of `buffer`. */
    truncated: boolean;
}

/**
 * Serializable terminal session info (sent to clients, no PTY handle).
 * Used in REST API responses and WebSocket messages.
 */
export interface TerminalSessionInfo {
    id: string;
    workspaceId: string;
    cols: number;
    rows: number;
    createdAt: number;
    lastActivity: number;
    /** PID of the live PTY, or `null` for an exited session. */
    pid: number | null;
    pinned: boolean;
    /** Lifecycle state; exited sessions are read-only and restartable */
    status: 'running' | 'exited';
    exitedAt?: number;
    exitCode?: number;
    /** Working directory the PTY was spawned in (reused by restart) */
    cwd: string;
    /** Display title (defaults to the shell's basename) */
    title: string;
}

// ============================================================================
// Client → Server messages (sent over WebSocket)
// ============================================================================

export type TerminalClientMessage =
    | { type: 'terminal-create'; workspaceId: string; cols?: number; rows?: number }
    | { type: 'terminal-attach'; sessionId: string }
    | { type: 'terminal-input'; sessionId: string; data: string }
    | { type: 'terminal-resize'; sessionId: string; cols: number; rows: number }
    | { type: 'terminal-close'; sessionId: string }
    | { type: 'terminal-pin'; sessionId: string }
    | { type: 'terminal-unpin'; sessionId: string };

// ============================================================================
// Server → Client messages (sent over WebSocket)
// ============================================================================

export type TerminalServerMessage =
    | { type: 'terminal-created'; session: TerminalSessionInfo }
    | { type: 'terminal-output'; sessionId: string; data: string }
    | { type: 'terminal-exit'; sessionId: string; exitCode: number; signal?: number }
    | { type: 'terminal-error'; sessionId: string | null; message: string }
    | { type: 'terminal-replay'; sessionId: string; data: string; truncated: boolean }
    | { type: 'terminal-pin-changed'; sessionId: string; pinned: boolean };
