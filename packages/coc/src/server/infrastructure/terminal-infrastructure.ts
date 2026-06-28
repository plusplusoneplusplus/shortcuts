/**
 * Terminal Infrastructure Builder
 *
 * Creates the TerminalWebSocketServer (which internally owns a
 * TerminalSessionManager) and returns both references. Returns `undefined`
 * when the feature is disabled via config or node-pty is unavailable.
 *
 * Follows the same factory pattern as queue-infrastructure, schedule-infrastructure, etc.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ResolvedCLIConfig } from '../../config';
import { getServerLogger } from '../logging/server-logger';
import type { TerminalSessionManager } from '../terminal/index';
import type { TerminalWebSocketServer } from '../terminal/index';

// ============================================================================
// Types
// ============================================================================

export interface TerminalInfrastructure {
    terminalSessionManager: TerminalSessionManager;
    terminalWsServer: TerminalWebSocketServer;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates terminal infrastructure when enabled and node-pty is available.
 *
 * Uses dynamic `require()` because node-pty is an optional dependency — on
 * machines without native build tools it won't be installed. The try/catch
 * detects this at runtime and gracefully falls back to `undefined`.
 *
 * @param store          - Process store for workspace lookups.
 * @param resolvedConfig - Resolved CLI config (checked for `terminal.enabled`).
 * @returns Terminal infrastructure, or `undefined` if disabled/unavailable.
 */
export function createTerminalInfrastructure(
    store: ProcessStore,
    resolvedConfig: ResolvedCLIConfig,
): TerminalInfrastructure | undefined {
    if (!resolvedConfig.terminal.enabled) {
        return undefined;
    }

    let TerminalWebSocketServerCtor: typeof TerminalWebSocketServer;
    try {
        // Dynamic import — this module depends on node-pty (optionalDependency).
        // If node-pty failed to install, the require() will throw and we
        // gracefully disable the terminal feature.
        const wsMod = require('../terminal/terminal-ws-server');
        TerminalWebSocketServerCtor = wsMod.TerminalWebSocketServer;
    } catch (err) {
        getServerLogger().warn(
            { err },
            '[Terminal] node-pty unavailable — terminal feature disabled',
        );
        return undefined;
    }

    const terminalWsServer = new TerminalWebSocketServerCtor(store);
    const terminalSessionManager = terminalWsServer.getSessionManager();

    getServerLogger().info('[Terminal] web terminal enabled');
    return { terminalSessionManager, terminalWsServer };
}
