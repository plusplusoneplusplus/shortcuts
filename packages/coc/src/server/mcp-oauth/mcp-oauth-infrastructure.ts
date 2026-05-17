/**
 * MCP OAuth Infrastructure Builder
 *
 * Constructs the McpOauthManager and returns a dispose hook the server
 * can call on shutdown. Mirrors the loop-infrastructure pattern.
 */

import { McpOauthManager, type McpOauthManagerOptions } from './mcp-oauth-manager';

export interface McpOauthInfrastructure {
    manager: McpOauthManager;
    dispose: () => void;
}

export function createMcpOauthInfrastructure(options: McpOauthManagerOptions = {}): McpOauthInfrastructure {
    const manager = new McpOauthManager(options);
    return {
        manager,
        dispose: () => manager.clear(),
    };
}
