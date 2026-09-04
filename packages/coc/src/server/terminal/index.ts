// Types
export type {
    IPty,
    TerminalSession,
    TerminalSessionInfo,
    TerminalClientMessage,
    TerminalServerMessage,
} from './types';

// Manager
export { TerminalSessionManager, toSessionInfo, appendToScrollback, SCROLLBACK_MAX_BYTES, PERSIST_DEBOUNCE_MS } from './terminal-session-manager';
export type { TerminalSessionManagerOptions } from './terminal-session-manager';

// Persistence
export { TerminalPersistence, SERVER_SHUTDOWN_EXIT_CODE, TERMINALS_DIR_NAME } from './terminal-persistence';
export type { PersistedTerminalMeta, LoadedTerminalSession } from './terminal-persistence';

// WebSocket server
export { TerminalWebSocketServer } from './terminal-ws-server';
