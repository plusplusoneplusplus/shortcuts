/**
 * MCP Client — minimal HTTP-based MCP client for calling tools on the Teams MCP server.
 *
 * Implements the MCP protocol over HTTP (streamable transport).
 */

import type { McpToolCall, McpToolResult, McpToolsListResult } from './types';

export interface McpClientOptions {
    /** Base URL of the MCP server. */
    serverUrl: string;
}

export class McpClient {
    private readonly serverUrl: string;
    private sessionId: string | null = null;

    constructor(opts: McpClientOptions) {
        this.serverUrl = opts.serverUrl;
    }

    /** Initialize the MCP session. */
    async initialize(): Promise<void> {
        const response = await this.sendRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'coc-teams-bot', version: '0.1.0' },
            },
        });
        if (response.error) {
            throw new Error(`MCP initialize failed: ${response.error.message}`);
        }
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
    async callTool(name: string, args?: Record<string, unknown>): Promise<McpToolResult> {
        const request: { jsonrpc: string; id: number; method: string; params: McpToolCall['params'] } = {
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name, arguments: args },
        };
        const response = await this.sendRequest(request);
        if (response.error) {
            throw new Error(`MCP tool call "${name}" failed: ${response.error.message}`);
        }
        return response.result as McpToolResult;
    }

    /** Send a JSON-RPC request to the MCP server. */
    private async sendRequest(body: Record<string, unknown>): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        if (this.sessionId) {
            headers['Mcp-Session-Id'] = this.sessionId;
        }

        const res = await fetch(this.serverUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        // Capture session ID from response header
        const newSessionId = res.headers.get('Mcp-Session-Id');
        if (newSessionId) {
            this.sessionId = newSessionId;
        }

        if (!res.ok) {
            throw new Error(`MCP HTTP error: ${res.status} ${res.statusText}`);
        }

        return await res.json() as { result?: unknown; error?: { code: number; message: string } };
    }

    /** Get current session ID. */
    getSessionId(): string | null {
        return this.sessionId;
    }
}
