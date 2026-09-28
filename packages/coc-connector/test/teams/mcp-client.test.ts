import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient, McpHttpError } from '../../src/teams/mcp-client';

afterEach(() => vi.unstubAllGlobals());

describe('McpClient streamable HTTP', () => {
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
        ['HTTP date', new Date(Date.now() + 60_000).toUTCString(), 60_000],
        ['invalid value', 'not-a-delay', undefined],
    ])('surfaces Retry-After %s on an HTTP 429 without exposing request headers', async (_label, header, expected) => {
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
            if (_label === 'HTTP date') {
                expect((error as McpHttpError).retryAfterMs).toBeGreaterThanOrEqual(59_000);
                expect((error as McpHttpError).retryAfterMs).toBeLessThanOrEqual(60_000);
            } else {
                expect((error as McpHttpError).retryAfterMs).toBe(expected);
            }
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
});
