import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from '../../src/teams/mcp-client';

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
});
