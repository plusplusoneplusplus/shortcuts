/**
 * Creates the language-server session manager and the browser-facing
 * WebSocket bridge, and publishes the manager for the rest of the server.
 *
 * Construction is cheap: no process starts until a browser attaches a document
 * to a workspace whose language-server configuration is enabled, and that
 * configuration ships disabled. Composing the infrastructure unconditionally
 * therefore costs one object and one config subscription.
 *
 * Follows the same factory pattern as terminal-infrastructure.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { LanguageServerManager } from '../language-servers/manager';
import { LanguageServerWebSocketServer } from '../language-servers/ws-bridge';
import { setActiveLanguageServerManager } from '../language-servers/active';
import { getServerLogger } from '../logging/server-logger';

// ============================================================================
// Types
// ============================================================================

export interface LanguageServerInfrastructure {
    manager: LanguageServerManager;
    languageServerWsServer: LanguageServerWebSocketServer;
    /** Drops every socket, then every process, timer, and listener. */
    dispose(): Promise<void>;
}

export interface LanguageServerInfrastructureOptions {
    /** Bound on live sessions across all workspaces. */
    maxSessions?: number;
    /** How long a session survives after its last document detaches. */
    idleTimeoutMs?: number;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * @param store   - Supplies the workspace list the bridge validates against.
 * @param dataDir - Resolved CoC data dir; per-workspace language-server
 *                  configuration lives under `<dataDir>/repos/<workspaceId>/`.
 */
export function createLanguageServerInfrastructure(
    store: ProcessStore,
    dataDir: string,
    options: LanguageServerInfrastructureOptions = {},
): LanguageServerInfrastructure {
    const manager = new LanguageServerManager({
        dataDir,
        maxSessions: options.maxSessions,
        idleTimeoutMs: options.idleTimeoutMs,
        onError: (err) => {
            getServerLogger().warn({ err }, '[LanguageServer] session error');
        },
    });
    const languageServerWsServer = new LanguageServerWebSocketServer(store, manager);
    const unregister = setActiveLanguageServerManager(manager);

    let disposed = false;
    return {
        manager,
        languageServerWsServer,
        dispose: async () => {
            if (disposed) {
                return;
            }
            disposed = true;
            // Sockets first: a client that loses its transport stops issuing
            // requests into sessions that are about to go away.
            languageServerWsServer.closeAll();
            unregister();
            await manager.dispose();
        },
    };
}
