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
/** Env var that makes an Electron binary boot as plain Node instead of the GUI runtime. */
export const ELECTRON_RUN_AS_NODE_ENV = 'ELECTRON_RUN_AS_NODE';

/** Provider-neutral stdio MCP server spec for the bridge. */
export interface CocLlmToolsMcpServerConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
    /** Codex MCP allow-list for tools exposed by this server. */
    enabled_tools?: string[];
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
 * Whether this process is running on an Electron binary (including when it was
 * launched as plain Node via `ELECTRON_RUN_AS_NODE=1`). In that case
 * `process.execPath` is the Electron executable, so a child spawned with it must
 * carry `ELECTRON_RUN_AS_NODE=1` to boot as Node rather than the GUI runtime.
 */
function isRunningUnderElectron(): boolean {
    return Boolean((process.versions as { electron?: string }).electron);
}

/**
 * Build the stdio MCP server config that launches the bridge for a given
 * {@link CocToolBridgeServer} registration.
 *
 * When the bridge is launched with the Electron binary — which is what
 * `process.execPath` points at inside the CoC desktop server (forked as
 * Electron's Node via `ELECTRON_RUN_AS_NODE=1`) — the child's env must set
 * `ELECTRON_RUN_AS_NODE=1` too, or Electron boots its GUI runtime and never
 * answers the MCP stdio handshake, so the provider silently drops CoC tools.
 * Codex strips inherited env from MCP server children, so this cannot be left to
 * inheritance; it is injected here as an explicit env entry (Claude happens to
 * inherit it, but relying on that is fragile). Real-Node hosts are unaffected —
 * the flag is only added when running on an Electron binary and launching with it.
 */
export function buildCocLlmToolsMcpConfig(options: {
    endpoint: string;
    token: string;
    /** Node executable to launch the bridge with. Defaults to `process.execPath`. */
    command?: string;
    /** Explicit bridge script path. Defaults to {@link resolveCocLlmToolsBridgePath}. */
    bridgePath?: string;
    /** Optional Codex MCP allow-list for tools exposed by the bridge. */
    enabledTools?: string[];
}): CocLlmToolsMcpServerConfig {
    const command = options.command ?? process.execPath;
    const env: Record<string, string> = {
        [COC_LLM_TOOLS_ENDPOINT_ENV]: options.endpoint,
        [COC_LLM_TOOLS_TOKEN_ENV]: options.token,
    };
    if (command === process.execPath && isRunningUnderElectron()) {
        env[ELECTRON_RUN_AS_NODE_ENV] = '1';
    }
    return {
        command,
        args: [options.bridgePath ?? resolveCocLlmToolsBridgePath()],
        env,
        ...(options.enabledTools?.length ? { enabled_tools: options.enabledTools } : {}),
    };
}
