/**
 * Codex Auth Infrastructure Builder
 *
 * Constructs the CodexAuthStore and CodexAuthManager and returns a dispose
 * hook the server can call on shutdown.  Mirrors the mcp-oauth-infrastructure
 * pattern.
 */

import { CodexAuthStore } from './codex-auth-store';
import { CodexAuthManager, type CodexAuthManagerOptions } from './codex-auth-manager';

export { CodexAuthStore } from './codex-auth-store';
export type { CodexAuthTokens, CodexAuthInfo, CodexAuthStatus } from './codex-auth-store';
export { CodexAuthManager } from './codex-auth-manager';
export type { CodexAuthFlowResult, CodexAuthFlowStatus, TokenExchanger } from './codex-auth-manager';
export { registerCodexAuthRoutes } from './codex-auth-routes';
export type { CodexAuthRouteContext } from './codex-auth-routes';

export interface CodexAuthInfrastructure {
    store: CodexAuthStore;
    manager: CodexAuthManager;
    dispose: () => void;
}

export type CodexAuthInfrastructureOptions = Omit<CodexAuthManagerOptions, 'store'> & {
    /** Top-level CoC data directory (`~/.coc` by default). */
    dataDir: string;
};

export function createCodexAuthInfrastructure(options: CodexAuthInfrastructureOptions): CodexAuthInfrastructure {
    const store = new CodexAuthStore(options.dataDir);
    const manager = new CodexAuthManager({ ...options, store });
    return {
        store,
        manager,
        dispose: () => manager.dispose(),
    };
}
