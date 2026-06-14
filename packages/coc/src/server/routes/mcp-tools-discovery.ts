/**
 * MCP Tools Discovery
 *
 * Eager, live discovery of the tools exposed by a workspace's *enabled* MCP
 * servers. Resolves the effective (global + workspace) MCP config, filters it
 * by the workspace `enabledMcpServers` allow-list, then connects to each server
 * concurrently — reusing the JSON-RPC handshake in `mcp-connection-tester.ts` —
 * and returns a per-server result.
 *
 * Failures are isolated per server: one slow or unreachable server yields a
 * `{ status: 'error' }` entry instead of failing the whole batch. Each
 * connection is bounded by a per-server timeout.
 */

import type { MCPServerConfig } from '@plusplusoneplusplus/forge';
import { loadDefaultMcpConfig, loadWorkspaceMcpConfig } from '@plusplusoneplusplus/forge';
import { listMcpTools, type McpTestRequest, type McpToolInfo } from './mcp-connection-tester';

/** Per-server discovery result returned to the client. */
export interface McpServerToolsResult {
    status: 'ok' | 'error';
    tools: McpToolInfo[];
    /** Error message when `status === 'error'`. */
    error?: string;
    /** Server's self-reported name, when known. */
    serverName?: string;
}

/** Default per-server connect/list timeout. */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000;
/** How many servers to probe at once. */
const DEFAULT_DISCOVERY_CONCURRENCY = 4;

export interface DiscoverOptions {
    /** Per-server timeout in ms. */
    timeoutMs?: number;
    /** Max concurrent server probes. */
    concurrency?: number;
    /** Bypass the MCP config file cache when resolving servers. */
    forceReload?: boolean;
}

/**
 * Convert a resolved `MCPServerConfig` into a connection request for the tester.
 * Returns `null` for configs missing the fields needed to connect.
 */
export function configToTestRequest(config: MCPServerConfig): McpTestRequest | null {
    const type = config.type === 'http' || config.type === 'sse' ? config.type : 'stdio';
    if (type === 'stdio') {
        const command = 'command' in config ? config.command : undefined;
        if (!command) return null;
        const req: McpTestRequest = { type: 'stdio', command };
        if ('args' in config && config.args) req.args = config.args;
        if ('env' in config && config.env) req.env = config.env;
        return req;
    }
    const url = 'url' in config ? config.url : undefined;
    if (!url) return null;
    const req: McpTestRequest = { type, url };
    if ('headers' in config && config.headers) req.headers = config.headers;
    return req;
}

/**
 * Resolve the workspace's *enabled* MCP servers to connection requests.
 * Mirrors the effective merge used elsewhere: workspace entries override global
 * entries with the same name. `enabledMcpServers === null/undefined` means all
 * servers are enabled.
 */
export function resolveEnabledMcpServers(
    rootPath: string,
    enabledMcpServers: string[] | null | undefined,
    forceReload = false,
): Record<string, McpTestRequest> {
    const globalConfig = loadDefaultMcpConfig(forceReload);
    const workspaceConfig = loadWorkspaceMcpConfig(rootPath, forceReload);
    const merged: Record<string, MCPServerConfig> = {
        ...globalConfig.mcpServers,
        ...workspaceConfig.mcpServers,
    };

    const result: Record<string, McpTestRequest> = {};
    for (const [name, config] of Object.entries(merged)) {
        const isEnabled =
            enabledMcpServers === null || enabledMcpServers === undefined || enabledMcpServers.includes(name);
        if (!isEnabled) continue;
        const req = configToTestRequest(config);
        if (req) result[name] = req;
    }
    return result;
}

/**
 * Probe a map of named MCP servers concurrently and return per-server results.
 * Each probe is isolated — a thrown/failed connection becomes a
 * `{ status: 'error' }` entry, never rejecting the batch.
 */
export async function discoverMcpToolsForServers(
    servers: Record<string, McpTestRequest>,
    opts: DiscoverOptions = {},
): Promise<Record<string, McpServerToolsResult>> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
    const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_DISCOVERY_CONCURRENCY);

    const names = Object.keys(servers);
    const results: Record<string, McpServerToolsResult> = {};

    for (let i = 0; i < names.length; i += concurrency) {
        const batch = names.slice(i, i + concurrency);
        await Promise.all(batch.map(async (name) => {
            try {
                const res = await listMcpTools(servers[name], timeoutMs);
                if (res.success) {
                    results[name] = {
                        status: 'ok',
                        tools: res.tools,
                        ...(res.serverName ? { serverName: res.serverName } : {}),
                    };
                } else {
                    results[name] = { status: 'error', tools: [], error: res.message };
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                results[name] = { status: 'error', tools: [], error: msg };
            }
        }));
    }

    return results;
}

/**
 * Resolve and probe all *enabled* MCP servers for a workspace.
 */
export async function discoverWorkspaceMcpTools(
    rootPath: string,
    enabledMcpServers: string[] | null | undefined,
    opts: DiscoverOptions = {},
): Promise<Record<string, McpServerToolsResult>> {
    const servers = resolveEnabledMcpServers(rootPath, enabledMcpServers, opts.forceReload);
    return discoverMcpToolsForServers(servers, opts);
}
