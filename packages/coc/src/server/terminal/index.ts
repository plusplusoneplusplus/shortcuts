/**
 * Terminal module — PTY session management and WebSocket server for terminals.
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

// WebSocket server
export { TerminalWebSocketServer } from './terminal-ws-server';
