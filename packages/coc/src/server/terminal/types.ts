/**
 * Terminal session and message types for WebSocket-based terminal communication.
 */

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
    /** Workspace this terminal belongs to */
    readonly workspaceId: string;
    /** The underlying PTY process (internal use only) */
    readonly pty: IPty;
    /** Current column count */
    cols: number;
    /** Current row count */
    rows: number;
    /** Unix timestamp of creation */
    readonly createdAt: number;
    /** Unix timestamp of last input or output activity */
    lastActivity: number;
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
    pid: number;
}

// ============================================================================
// Client → Server messages (sent over WebSocket)
// ============================================================================

export type TerminalClientMessage =
    | { type: 'terminal-create'; workspaceId: string; cols?: number; rows?: number }
    | { type: 'terminal-input'; sessionId: string; data: string }
    | { type: 'terminal-resize'; sessionId: string; cols: number; rows: number }
    | { type: 'terminal-close'; sessionId: string };

// ============================================================================
// Server → Client messages (sent over WebSocket)
// ============================================================================

export type TerminalServerMessage =
    | { type: 'terminal-created'; session: TerminalSessionInfo }
    | { type: 'terminal-output'; sessionId: string; data: string }
    | { type: 'terminal-exit'; sessionId: string; exitCode: number; signal?: number }
    | { type: 'terminal-error'; sessionId: string | null; message: string };
