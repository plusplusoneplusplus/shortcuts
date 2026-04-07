/**
 * Terminal module — PTY session management for WebSocket-based terminals.
 */

// Types
export type {
    IPty,
    TerminalSession,
    TerminalSessionInfo,
    TerminalClientMessage,
    TerminalServerMessage,
} from './types';

// Manager
export { TerminalSessionManager, toSessionInfo } from './terminal-session-manager';
export type { TerminalSessionManagerOptions } from './terminal-session-manager';
