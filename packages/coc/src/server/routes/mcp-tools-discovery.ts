/**
 * Eager, live discovery of the tools exposed by a workspace's *enabled* MCP
 * servers. Takes the shared effective resolution (`resolveWorkspaceMcp`, which
 * includes repo-group member servers), filters it by the workspace
 * `enabledMcpServers` allow-list, then connects to each server
 * concurrently — reusing the JSON-RPC handshake in `mcp-connection-tester.ts` —
 * and returns a per-server result.
 *
 * Failures are isolated per server: one slow or unreachable server yields a
 * `{ status: 'error' }` entry instead of failing the whole batch. Each
 * connection is bounded by a per-server timeout.
 */

import * as path from 'path';
import type { MCPServerConfig } from '@plusplusoneplusplus/forge';
import type { EffectiveMcpServer } from '../workspaces/workspace-mcp-resolver';
import { listMcpTools, type McpTestRequest, type McpToolInfo } from './mcp-connection-tester';
import { getTeamsOAuthCredential, TEAMS_NATIVE_MCP_NAME } from '../messaging/teams-native-auth';

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
    dataDir?: string;
    /** Per-server timeout in ms. */
    timeoutMs?: number;
    /** Max concurrent server probes. */
    concurrency?: number;
}

/**
 * Convert a resolved `MCPServerConfig` into a connection request for the tester.
 * Returns `null` for configs missing the fields needed to connect. A stdio
 * probe runs where the chat runtime would: `executionRoot` (the session cwd, or
 * the member root for a group member's server), or the server's own `cwd`
 * resolved against it.
 */
export function configToTestRequest(config: MCPServerConfig, executionRoot?: string): McpTestRequest | null {
    const type = config.type === 'http' || config.type === 'sse' ? config.type : 'stdio';
    if (type === 'stdio') {
        const command = 'command' in config ? config.command : undefined;
        if (!command) return null;
        const req: McpTestRequest = { type: 'stdio', command };
        if ('args' in config && config.args) req.args = config.args;
        if ('env' in config && config.env) req.env = config.env;
        const cwd = 'cwd' in config ? config.cwd : undefined;
        if (executionRoot) req.cwd = path.resolve(executionRoot, cwd ?? '.');
        else if (cwd) req.cwd = cwd;
        return req;
    }
    const url = 'url' in config ? config.url : undefined;
    if (!url) return null;
    const req: McpTestRequest = { type, url };
    if ('headers' in config && config.headers) req.headers = config.headers;
    return req;
}

/**
 * Turn the workspace's *enabled* effective servers into connection requests.
 * `enabledMcpServers === null/undefined` means all servers are enabled.
 */
export function resolveEnabledMcpServers(
    servers: Record<string, EffectiveMcpServer>,
    enabledMcpServers: string[] | null | undefined,
): Record<string, McpTestRequest> {
    const result: Record<string, McpTestRequest> = {};
    for (const [name, server] of Object.entries(servers)) {
        const isEnabled =
            enabledMcpServers === null || enabledMcpServers === undefined || enabledMcpServers.includes(name);
        if (!isEnabled) continue;
        const req = configToTestRequest(server.config, server.executionRoot);
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
                let request = servers[name];
                if (opts.dataDir && name === TEAMS_NATIVE_MCP_NAME
                    && (request.type === 'http' || request.type === 'sse') && request.url) {
                    const token = await getTeamsOAuthCredential(opts.dataDir, request.url)
                        .getToken(AbortSignal.timeout(timeoutMs));
                    const headers = Object.fromEntries(Object.entries(request.headers ?? {})
                        .filter(([key]) => key.toLowerCase() !== 'authorization'));
                    request = { ...request, headers: { ...headers, Authorization: `Bearer ${token}` } };
                }
                const res = await listMcpTools(request, timeoutMs);
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
 * Probe all *enabled* servers of a workspace's effective resolution.
 */
export async function discoverWorkspaceMcpTools(
    servers: Record<string, EffectiveMcpServer>,
    enabledMcpServers: string[] | null | undefined,
    opts: DiscoverOptions = {},
): Promise<Record<string, McpServerToolsResult>> {
    return discoverMcpToolsForServers(resolveEnabledMcpServers(servers, enabledMcpServers), opts);
}
