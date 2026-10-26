/**
 * MCP access for `run_tool_script`: CoC opens its own MCP client connections
 * to the servers a turn resolved and exposes them to scripts as two generic
 * tools, `mcp_list_tools` and `mcp_call`.
 *
 * One {@link McpScriptScope} owns the clients of one chat turn (or one
 * non-chat script run). Clients connect lazily on a server's first use, are
 * shared by every script in the scope, and are all closed by `close()` —
 * stdio children are killed there. Nothing is cached across scopes.
 *
 * Remote servers use their static headers, or a still-valid access token read
 * from the Copilot OAuth cache. The cache is never written or refreshed; a
 * server that answers 401 fails with `auth-required: <server>`.
 *
 * Gated by the `features.toolScriptingMcp` admin flag at the call sites.
 */

import { defineTool, type MCPServerConfig, type Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { readMcpServerAccessToken } from '../mcp-oauth/mcp-oauth-token-cache';

export const MCP_LIST_TOOLS_TOOL_NAME = 'mcp_list_tools';
export const MCP_CALL_TOOL_NAME = 'mcp_call';
export const MCP_CONNECT_TIMEOUT_MS = 15_000;

export interface McpScriptScopeOptions {
    /** The turn's resolved MCP servers (already allow-listed for its workspace). */
    servers: Record<string, MCPServerConfig> | undefined;
    /** Extra per-tool filter, e.g. the turn's `excludedTools` / provider allowlists. */
    isToolAllowed?: (server: string, tool: string) => boolean;
    connectTimeoutMs?: number;
    /** Home directory holding `.copilot/mcp-oauth-config/` (tests). */
    homeDir?: string;
}

export interface McpScriptToolInfo {
    name: string;
    description?: string;
    inputSchema?: unknown;
}

interface McpConnection {
    client: Client;
    tools?: McpScriptToolInfo[];
}

export class McpScriptScope {
    private readonly servers: Record<string, MCPServerConfig>;
    private readonly connections = new Map<string, Promise<McpConnection>>();
    private closed = false;

    constructor(private readonly options: McpScriptScopeOptions) {
        this.servers = Object.fromEntries(
            Object.entries(options.servers ?? {}).filter(([, config]) => config.enabled !== false),
        );
    }

    /** Server names scripts may use; read from config, nothing is started. */
    serverNames(): string[] {
        return Object.keys(this.servers);
    }

    async listTools(server: string, signal?: AbortSignal): Promise<McpScriptToolInfo[]> {
        this.requireServer(server);
        const connection = await this.connect(server, signal);
        return (await this.loadTools(server, connection, signal)).filter(t => this.isAllowed(server, t.name));
    }

    async callTool(server: string, tool: string, args: Record<string, unknown> | undefined, signal?: AbortSignal): Promise<string> {
        this.requireServer(server);
        if (typeof tool !== 'string' || !tool) throw new Error(`unknown-tool: ${server}/${String(tool)}`);
        if (!this.isAllowed(server, tool)) throw new Error(`tool-not-allowed: ${server}/${tool}`);
        const connection = await this.connect(server, signal);
        const tools = await this.loadTools(server, connection, signal);
        if (!tools.some(t => t.name === tool)) throw new Error(`unknown-tool: ${server}/${tool}`);
        const result = await this.request(server, () =>
            connection.client.callTool({ name: tool, arguments: args ?? {} }, undefined, { signal }));
        const text = formatCallResult(result as CallResultLike);
        if (result.isError) throw new Error(text || `${server}/${tool} failed`);
        return text;
    }

    /** Close every client of this scope; stdio children are killed. Idempotent. */
    async close(): Promise<void> {
        this.closed = true;
        const pending = [...this.connections.values()];
        this.connections.clear();
        await Promise.all(pending.map(p => p.then(c => c.client.close(), () => undefined).catch(() => undefined)));
    }

    private requireServer(server: string): void {
        if (this.closed) throw new Error('MCP scope is closed');
        if (typeof server !== 'string' || !Object.prototype.hasOwnProperty.call(this.servers, server)) {
            throw new Error(`unknown-server: ${String(server)}`);
        }
    }

    private isAllowed(server: string, tool: string): boolean {
        const allowList = this.servers[server].tools;
        if (allowList && !allowList.includes('*') && !allowList.includes(tool)) return false;
        return this.options.isToolAllowed?.(server, tool) ?? true;
    }

    private connect(server: string, signal?: AbortSignal): Promise<McpConnection> {
        let connection = this.connections.get(server);
        if (!connection) {
            connection = this.open(server, signal);
            this.connections.set(server, connection);
            // A failed connect is not kept, so a later call can retry.
            connection.catch(() => {
                if (this.connections.get(server) === connection) this.connections.delete(server);
            });
        }
        return connection;
    }

    private async open(server: string, signal?: AbortSignal): Promise<McpConnection> {
        const client = new Client({ name: 'coc-run-tool-script', version: '1.0.0' });
        const transport = this.createTransport(server);
        try {
            await this.request(server, () => client.connect(transport, {
                signal,
                timeout: this.options.connectTimeoutMs ?? MCP_CONNECT_TIMEOUT_MS,
            }));
        } catch (err) {
            await client.close().catch(() => undefined);
            throw err;
        }
        if (this.closed) {
            await client.close().catch(() => undefined);
            throw new Error('MCP scope is closed');
        }
        return { client };
    }

    private createTransport(server: string): Transport {
        const config = this.servers[server];
        if ('command' in config) {
            return new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: { ...stringEnv(process.env), ...config.env },
                cwd: config.cwd,
                stderr: 'ignore',
            });
        }
        const headers: Record<string, string> = { ...config.headers };
        const hasAuthHeader = Object.keys(headers).some(h => h.toLowerCase() === 'authorization');
        if (!hasAuthHeader) {
            const token = readMcpServerAccessToken(config.url, this.options.homeDir);
            if (token) headers.Authorization = `Bearer ${token}`;
        }
        const url = new URL(config.url);
        return config.type === 'sse'
            ? new SSEClientTransport(url, { requestInit: { headers }, eventSourceInit: { fetch: withHeaders(headers) } })
            : new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    }

    private async loadTools(server: string, connection: McpConnection, signal?: AbortSignal): Promise<McpScriptToolInfo[]> {
        if (connection.tools) return connection.tools;
        const tools: McpScriptToolInfo[] = [];
        let cursor: string | undefined;
        do {
            const page = await this.request(server, () =>
                connection.client.listTools(cursor ? { cursor } : undefined, { signal }));
            for (const t of page.tools) tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
            cursor = page.nextCursor;
        } while (cursor);
        connection.tools = tools;
        return tools;
    }

    /** Map transport auth failures to `auth-required: <server>`. */
    private async request<T>(server: string, fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (err) {
            if (isUnauthorized(err)) {
                throw new Error(`auth-required: ${server} (no valid token in the Copilot MCP OAuth cache; `
                    + 'scripts cannot sign in, refresh tokens, or use provider-native Entra/Teams auth)');
            }
            throw err;
        }
    }
}

/** The script-facing tools of a scope. Approval and filtering wrap these at the call site. */
export function createMcpScriptTools(scope: McpScriptScope): Tool<any>[] {
    const listTools = defineTool<{ server?: string }>(MCP_LIST_TOOLS_TOOL_NAME, {
        description: 'List the tools of one connected MCP server.',
        parameters: {
            type: 'object',
            properties: { server: { type: 'string', description: 'MCP server name.' } },
            required: ['server'],
        },
        handler: async (args, invocation) => {
            const server = args?.server as string;
            return JSON.stringify({ server, tools: await scope.listTools(server, invocation?.signal) });
        },
    });
    const call = defineTool<{ server?: string; tool?: string; args?: Record<string, unknown> }>(MCP_CALL_TOOL_NAME, {
        description: 'Call one tool on a connected MCP server.',
        parameters: {
            type: 'object',
            properties: {
                server: { type: 'string', description: 'MCP server name.' },
                tool: { type: 'string', description: 'Tool name on that server.' },
                args: { type: 'object', description: 'Tool arguments.' },
            },
            required: ['server', 'tool'],
        },
        handler: async (args, invocation) =>
            scope.callTool(args?.server as string, args?.tool as string, args?.args, invocation?.signal),
    });
    return [listTools, call];
}

interface CallResultLike {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    toolResult?: unknown;
}

function formatCallResult(result: CallResultLike): string {
    if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
    if (Array.isArray(result.content)) {
        return result.content.map(part => part.type === 'text' ? part.text ?? '' : `[${part.type}]`).join('\n');
    }
    return result.toolResult === undefined ? '' : JSON.stringify(result.toolResult);
}

function isUnauthorized(err: unknown): boolean {
    if (err instanceof UnauthorizedError) return true;
    // StreamableHTTPError / SseError carry the status; SSE POSTs only say "(HTTP 401)".
    return (err as { code?: unknown } | null)?.code === 401 || /\(HTTP 401\)/.test(String((err as Error)?.message));
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

function withHeaders(headers: Record<string, string>): typeof fetch {
    return (input, init) => fetch(input, { ...init, headers: { ...headers, ...Object.fromEntries(new Headers(init?.headers).entries()) } });
}
