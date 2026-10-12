import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient, McpHttpError } from '../../src/teams/mcp/mcp-client';
import { createTransport, TeamsBot } from '../../src/teams/bot';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('McpClient streamable HTTP', () => {
    it('pins hybrid Graph credentials to a verified native account when the MCP token is opaque', async () => {
        const account = { tenantId: '11111111-1111-4111-8111-111111111111',
            objectId: '22222222-2222-4222-8222-222222222222' };
        const graph = `header.${Buffer.from(JSON.stringify({
            tid: account.tenantId, oid: account.objectId, aud: 'https://graph.microsoft.com',
            exp: Date.now() / 1000 + 3600, scp: 'ChannelMessage.Send',
        })).toString('base64url')}.signature`;
        const fetch = vi.fn(async (_url, options) => {
            const method = JSON.parse(options.body).method;
            return method === 'notifications/initialized' ? new Response(null, { status: 202 })
                : new Response(JSON.stringify({ result: method === 'initialize'
                    ? { protocolVersion: '2025-03-26' } : method === 'tools/list'
                        ? { tools: [{ name: 'SendMessageToChannel' }] }
                        : { content: [{ type: 'text', text: '{"id":"receipt"}' }] } }));
        });
        vi.stubGlobal('fetch', fetch);
        const acquireToken = vi.fn().mockResolvedValue('opaque-native-token');
        const graphAcquire = vi.fn().mockResolvedValue(graph);
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://example.test/mcp', account, acquireToken,
            graphOutboundOptions: { acquireToken: graphAcquire },
        });
        try {
            await transport.initialize('opaque-native-token', { teamId: 'team' });
            expect(graphAcquire).toHaveBeenCalledOnce();
            await transport.operations.send({ kind: 'channel', teamId: 'team', channelId: 'channel' },
                { content: 'fixture', contentType: 'text' });
            expect(acquireToken).toHaveBeenCalledTimes(4);
        } finally { transport.stop(); }
    });

    it('MCP startup without explicit authentication never falls back to Azure CLI', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const bot = new TeamsBot({ mode: 'mcp', mcpServerUrl: 'https://example.test/mcp', onMessage: () => {} });
        await bot.start();
        expect(bot.getStatus()).toBe('error');
        expect(bot.getLastError()).toContain('explicit OAuth');
        expect(fetch).not.toHaveBeenCalled();
        await bot.stop();
    });
    it('acquires a fresh demand token on initialize, notification, tools and each outbound request', async () => {
        const fetch = vi.fn(async (_url, options) => {
            const method = JSON.parse(options.body).method;
            return method === 'notifications/initialized' ? new Response(null, { status: 202 })
                : new Response(JSON.stringify({ result: method === 'initialize'
                    ? { protocolVersion: '2025-03-26' } : method === 'tools/list'
                        ? { tools: [] } : { content: [] } }));
        });
        vi.stubGlobal('fetch', fetch);
        const acquireToken = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
            .mockResolvedValueOnce('third').mockResolvedValueOnce('fourth');
        const client = new McpClient({ serverUrl: 'https://example.test/mcp', acquireToken });
        await client.initialize();
        await client.listTools();
        await client.callTool('SendMessageToSelf', {}, undefined, { retryExpiredSession: false });
        expect(acquireToken).toHaveBeenCalledTimes(4);
        expect(fetch.mock.calls.map(call => call[1].headers.Authorization)).toEqual([
            'Bearer first', 'Bearer second', 'Bearer third', 'Bearer fourth',
        ]);
    });

    it('fails closed before dispatch when native demand acquisition fails', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const acquireToken = vi.fn().mockRejectedValue(new Error('Native credentials require sign-in'));
        const client = new McpClient({ serverUrl: 'https://example.test/mcp', acquireToken, bearerToken: 'stale' });
        await expect(client.callTool('SendMessageToSelf')).rejects.toThrow('credentials unavailable');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('acknowledges initialization and forwards the negotiated version and session id to tools/list', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
                headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-1' },
            }))
            .mockResolvedValueOnce(new Response(null, { status: 202 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'ListTeams' }] } }), {
                headers: { 'Content-Type': 'application/json' },
            }));
        vi.stubGlobal('fetch', fetch);
        const client = new McpClient({ serverUrl: 'https://example.test/mcp', bearerToken: 'test-token' });
        await client.initialize();
        expect(client.getSessionId()).toBe('session-1');
        expect(await client.listTools()).toMatchObject({ tools: [{ name: 'ListTeams' }] });
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(fetch.mock.calls[1][1].headers).toMatchObject({
            'Mcp-Session-Id': 'session-1', 'MCP-Protocol-Version': '2025-03-26',
        });
        expect(fetch.mock.calls[2][1].headers).toMatchObject({
            'Mcp-Session-Id': 'session-1', 'MCP-Protocol-Version': '2025-03-26',
        });
    });

    it('does not report initialization success without a negotiated protocol version', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetch);
        await expect(new McpClient({ serverUrl: 'https://example.test/mcp' }).initialize())
            .rejects.toThrow('did not return a protocol version');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('surfaces an HTTP failure when the server rejects the initialized notification', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ result: { protocolVersion: '2025-03-26' } }), {
                headers: { 'Content-Type': 'application/json' },
            }))
            .mockResolvedValueOnce(new Response(null, { status: 401, statusText: 'Unauthorized' }));
        vi.stubGlobal('fetch', fetch);
        await expect(new McpClient({ serverUrl: 'https://example.test/mcp' }).initialize())
            .rejects.toThrow('MCP HTTP error: 401');
    });

    it.each([
        ['seconds', '8', 8_000],
        ['HTTP date', 'Thu, 01 Jan 2026 00:01:00 GMT', 60_000],
        ['invalid value', 'not-a-delay', undefined],
    ])('surfaces Retry-After %s on an HTTP 429 without exposing request headers', async (_label, header, expected) => {
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00Z'));
        const fetch = vi.fn().mockResolvedValue(new Response(null, {
            status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': header },
        }));
        vi.stubGlobal('fetch', fetch);
        const client = new McpClient({ serverUrl: 'https://example.test/mcp', bearerToken: 'test-token' });
        try {
            await client.callTool('ListChannelMessages');
            throw new Error('Expected HTTP 429');
        } catch (error) {
            expect(error).toBeInstanceOf(McpHttpError);
            expect(error).toMatchObject({ status: 429 });
            expect((error as McpHttpError).retryAfterMs).toBe(expected);
            expect(String(error)).not.toContain('test-token');
        }
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('reinitializes an expired MCP session once, then replays the failed tool call', async () => {
        let toolCalls = 0;
        const fetch = vi.fn(async (_url: string, options: RequestInit) => {
            const body = JSON.parse(String(options.body));
            const headers = options.headers as Record<string, string>;
            if (body.method === 'initialize') {
                const session = headers['Mcp-Session-Id'] ? 'unexpected-old-session' : toolCalls ? 'new-session' : 'old-session';
                return new Response(JSON.stringify({ result: { protocolVersion: '2025-03-26' } }), {
                    headers: { 'Mcp-Session-Id': session },
                });
            }
            if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
            toolCalls++;
            if (toolCalls === 1) return new Response(null, { status: 404, statusText: 'Not Found' });
            return new Response(JSON.stringify({ result: { content: [{ type: 'text', text: '[]' }] } }));
        });
        vi.stubGlobal('fetch', fetch);
        const client = new McpClient({ serverUrl: 'https://example.test/mcp', bearerToken: 'test-token' });
        await client.initialize();
        await expect(client.callTool('ListChannelMessages')).resolves.toMatchObject({ content: [{ text: '[]' }] });
        expect(toolCalls).toBe(2);
        expect(client.getSessionId()).toBe('new-session');
        expect((fetch.mock.calls.at(-1)![1].headers as Record<string, string>)['Mcp-Session-Id']).toBe('new-session');
    });

    it('surfaces a 404 without a session, or after a single failed session recovery', async () => {
        const noSessionFetch = vi.fn().mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }));
        vi.stubGlobal('fetch', noSessionFetch);
        await expect(new McpClient({ serverUrl: 'https://example.test/wrong' }).callTool('ListChannelMessages'))
            .rejects.toMatchObject({ status: 404 });
        expect(noSessionFetch).toHaveBeenCalledTimes(1);

        let initializeCalls = 0;
        const fetch = vi.fn(async (_url: string, options: RequestInit) => {
            const body = JSON.parse(String(options.body));
            if (body.method === 'initialize') {
                initializeCalls++;
                return new Response(JSON.stringify({ result: { protocolVersion: '2025-03-26' } }), {
                    headers: { 'Mcp-Session-Id': `session-${initializeCalls}` },
                });
            }
            if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
            return new Response(null, { status: 404, statusText: 'Not Found' });
        });
        vi.stubGlobal('fetch', fetch);
        const client = new McpClient({ serverUrl: 'https://example.test/mcp' });
        await client.initialize();
        await expect(client.callTool('ListChannelMessages')).rejects.toMatchObject({ status: 404 });
        expect(initializeCalls).toBe(2);
        expect(fetch).toHaveBeenCalledTimes(6);
    });

    it('does not loop if the initialized notification fails with 404', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ result: { protocolVersion: '2025-03-26' } }), {
                headers: { 'Mcp-Session-Id': 'session-1' },
            }))
            .mockResolvedValueOnce(new Response(null, { status: 404, statusText: 'Not Found' }));
        vi.stubGlobal('fetch', fetch);
        await expect(new McpClient({ serverUrl: 'https://example.test/mcp' }).initialize())
            .rejects.toMatchObject({ status: 404 });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not reinitialize or replay a write when session recovery is disabled', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(Response.json({ result: { protocolVersion: '2025-03-26' } }, {
                headers: { 'Mcp-Session-Id': 'session' },
            }))
            .mockResolvedValueOnce(new Response(null, { status: 202 }))
            .mockResolvedValueOnce(new Response(null, { status: 404 }));
        vi.stubGlobal('fetch', fetch);
        const client = new McpClient({ serverUrl: 'https://example.test/mcp' });
        await client.initialize();
        await expect(client.callTool('SendMessageToSelf', { content: 'message' }, undefined,
            { retryExpiredSession: false })).rejects.toMatchObject({ status: 404 });
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('releases an unread HTTP error body before surfacing status and retry metadata', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(1024)); },
            cancel,
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
            status: 429, headers: { 'Retry-After': '3' },
        })));
        const client = new McpClient({ serverUrl: 'https://example.test/mcp' });
        await expect(client.callTool('SendMessageToSelf', { content: 'message' }))
            .rejects.toMatchObject({ status: 429, retryAfterMs: 3000 });
        expect(cancel).toHaveBeenCalledOnce();
    });
});
