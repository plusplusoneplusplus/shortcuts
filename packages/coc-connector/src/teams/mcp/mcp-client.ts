/**
 * MCP Client — minimal HTTP-based MCP client for calling tools on the Teams MCP server.
 *
 * Implements the MCP protocol over HTTP (streamable transport).
 */

import type { McpToolCall, McpToolResult, McpToolsListResult } from '../types';

export interface McpClientOptions {
    /** Base URL of the MCP server. */
    serverUrl: string;
    /** Bearer token for authentication. */
    bearerToken?: string;
}

export class McpHttpError extends Error {
    constructor(
        readonly status: number,
        statusText: string,
        readonly retryAfterMs?: number,
    ) {
        super(`MCP HTTP error: ${status} ${statusText}`);
        this.name = 'McpHttpError';
    }
}

function parseRetryAfter(value: string | null): number | undefined {
    if (value === null) return undefined;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
        const ms = Number(trimmed) * 1000;
        return Number.isSafeInteger(ms) && ms <= Number.MAX_SAFE_INTEGER - Date.now() ? ms : undefined;
    }
    const date = Date.parse(trimmed);
    if (!trimmed || !Number.isFinite(date)) return undefined;
    const ms = Math.max(0, date - Date.now());
    return ms <= Number.MAX_SAFE_INTEGER - Date.now() ? ms : undefined;
}

export class McpClient {
    private readonly serverUrl: string;
    private sessionId: string | null = null;
    private protocolVersion: string | null = null;
    private bearerToken: string | null;

    constructor(opts: McpClientOptions) {
        this.serverUrl = opts.serverUrl;
        this.bearerToken = opts.bearerToken ?? null;
    }

    /** Update the bearer token (e.g., after device code flow completes). */
    setBearerToken(token: string): void {
        this.bearerToken = token;
    }

    /** Initialize the MCP session. */
    async initialize(signal?: AbortSignal): Promise<void> {
        const response = await this.sendRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'coc-teams-bot', version: '0.1.0' },
            },
        }, false, true, signal);
        if (response.error) {
            throw new Error(`MCP initialize failed: ${response.error.message}`);
        }
        const result = response.result as { protocolVersion?: unknown } | undefined;
        if (typeof result?.protocolVersion !== 'string') {
            throw new Error('MCP initialize did not return a protocol version');
        }
        this.protocolVersion = result.protocolVersion;
        await this.sendRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, true, true, signal);
    }

    /** List available tools on the MCP server. */
    async listTools(): Promise<McpToolsListResult> {
        const response = await this.sendRequest({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
        });
        if (response.error) {
            throw new Error(`MCP tools/list failed: ${response.error.message}`);
        }
        return response.result as McpToolsListResult;
    }

    /** Call a tool on the MCP server. */
    async callTool(name: string, args?: Record<string, unknown>, signal?: AbortSignal,
        options?: { retryExpiredSession?: boolean }): Promise<McpToolResult> {
        const request: { jsonrpc: string; id: number; method: string; params: McpToolCall['params'] } = {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name, arguments: args },
        };
        const response = await this.sendRequest(request, false, options?.retryExpiredSession ?? true, signal);
        if (response.error) {
            throw new Error(`MCP tool call "${name}" failed: ${response.error.message}`);
        }
        return response.result as McpToolResult;
    }

    /** Send a JSON-RPC request to the MCP server. */
    private async sendRequest(body: Record<string, unknown>, notification = false, retryExpiredSession = true, signal?: AbortSignal): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
        };
        if (this.bearerToken) {
            headers['Authorization'] = `Bearer ${this.bearerToken}`;
        }
        if (this.sessionId) {
            headers['Mcp-Session-Id'] = this.sessionId;
        }
        if (this.protocolVersion) {
            headers['MCP-Protocol-Version'] = this.protocolVersion;
        }

        const res = await fetch(this.serverUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            ...(signal ? { signal } : {}),
        });

        if (!res.ok) {
            await res.body?.cancel();
            if (res.status === 404 && this.sessionId && retryExpiredSession
                && body.method !== 'initialize' && body.method !== 'notifications/initialized') {
                this.sessionId = null;
                this.protocolVersion = null;
                await this.initialize(signal);
                return this.sendRequest(body, notification, false, signal);
            }
            throw new McpHttpError(res.status, res.statusText, parseRetryAfter(res.headers.get('Retry-After')));
        }

        const newSessionId = res.headers.get('Mcp-Session-Id');
        if (newSessionId) {
            this.sessionId = newSessionId;
        }
        if (notification) {
            await res.body?.cancel();
            return {};
        }

        const contentType = res.headers.get('Content-Type') ?? '';

        if (contentType.includes('text/event-stream')) {
            // Parse SSE response — extract the last JSON-RPC message from data lines
            const text = await res.text();
            let lastData: string | undefined;
            for (const line of text.split('\n')) {
                if (line.startsWith('data: ')) {
                    lastData = line.slice(6);
                }
            }
            if (!lastData) {
                throw new Error('MCP SSE response contained no data');
            }
            return JSON.parse(lastData) as { result?: unknown; error?: { code: number; message: string } };
        }

        return await res.json() as { result?: unknown; error?: { code: number; message: string } };
    }

    /** Get current session ID. */
    getSessionId(): string | null {
        return this.sessionId;
    }
}
