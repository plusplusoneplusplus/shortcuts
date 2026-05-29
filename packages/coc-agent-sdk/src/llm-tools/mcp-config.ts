/**
 * Provider-neutral MCP config generation for the CoC LLM-tool bridge.
 *
 * Produces the `{ command, args, env }` stdio MCP server spec that points a
 * provider's MCP client (Codex CLI `mcp_servers`, Claude Code `mcpServers`) at
 * the bundled bridge process, wiring the bridge back to a {@link CocToolBridgeServer}
 * registration via env vars.
 */

import * as path from 'path';

/** MCP server name CoC tools are exposed under. Kept identifier-safe for Codex/Claude. */
export const COC_LLM_TOOLS_MCP_SERVER_NAME = 'coc_llm_tools';

/** Env var carrying the parent loopback endpoint to the bridge process. */
export const COC_LLM_TOOLS_ENDPOINT_ENV = 'COC_LLM_TOOLS_ENDPOINT';
/** Env var carrying the per-invocation bearer token to the bridge process. */
export const COC_LLM_TOOLS_TOKEN_ENV = 'COC_LLM_TOOLS_TOKEN';
/** Optional env var overriding the resolved bridge script path. */
export const COC_LLM_TOOLS_BRIDGE_PATH_ENV = 'COC_LLM_TOOLS_BRIDGE_PATH';

/** Provider-neutral stdio MCP server spec for the bridge. */
export interface CocLlmToolsMcpServerConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
}

let bridgePathOverride: string | undefined;

/**
 * Override the resolved bridge script path. Useful when the host bundles the SDK
 * (e.g. webpack) so the compiled `bridge.js` is not adjacent to this module.
 */
export function setCocLlmToolsBridgePath(scriptPath: string | undefined): void {
    bridgePathOverride = scriptPath;
}

/**
 * Resolve the absolute path to the compiled bridge script.
 *
 * Resolution order: explicit override → `COC_LLM_TOOLS_BRIDGE_PATH` env →
 * `bridge.js` adjacent to this module (the tsc-compiled `dist/llm-tools/bridge.js`).
 */
export function resolveCocLlmToolsBridgePath(): string {
    if (bridgePathOverride) return bridgePathOverride;
    const fromEnv = process.env[COC_LLM_TOOLS_BRIDGE_PATH_ENV];
    if (fromEnv) return fromEnv;
    return path.join(__dirname, 'bridge.js');
}

/**
 * Build the stdio MCP server config that launches the bridge for a given
 * {@link CocToolBridgeServer} registration.
 */
export function buildCocLlmToolsMcpConfig(options: {
    endpoint: string;
    token: string;
    /** Node executable to launch the bridge with. Defaults to `process.execPath`. */
    command?: string;
    /** Explicit bridge script path. Defaults to {@link resolveCocLlmToolsBridgePath}. */
    bridgePath?: string;
}): CocLlmToolsMcpServerConfig {
    return {
        command: options.command ?? process.execPath,
        args: [options.bridgePath ?? resolveCocLlmToolsBridgePath()],
        env: {
            [COC_LLM_TOOLS_ENDPOINT_ENV]: options.endpoint,
            [COC_LLM_TOOLS_TOKEN_ENV]: options.token,
        },
    };
}
