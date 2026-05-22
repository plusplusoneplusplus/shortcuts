/**
 * Tests for TeamsTransport implementations and createTransport factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createTransport } from '../src/bot';
import { GraphTransport } from '../src/transport-graph';
import { McpTransport } from '../src/transport-mcp';
import type { TeamsTransport } from '../src/types';

describe('createTransport', () => {
    it('should create GraphTransport for graph mode', () => {
        const transport = createTransport('graph', {});
        expect(transport).toBeInstanceOf(GraphTransport);
    });

    it('should create McpTransport for mcp mode', () => {
        const transport = createTransport('mcp', { mcpServerUrl: 'https://mcp.example.com' });
        expect(transport).toBeInstanceOf(McpTransport);
    });

    it('should throw if mcpServerUrl missing for mcp mode', () => {
        expect(() => createTransport('mcp', {})).toThrow('mcpServerUrl is required');
    });
});

describe('GraphTransport', () => {
    let transport: TeamsTransport;

    beforeEach(() => {
        transport = new GraphTransport();
        mockFetch.mockReset();
    });

    it('should initialize and verify connection', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'team-1', displayName: 'Test' }),
        } as any);

        await transport.initialize('token-1', { teamId: 'team-1' });
    });

    it('should throw on initialization failure', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: async () => 'Unauthorized',
        } as any);

        await expect(transport.initialize('bad-token', { teamId: 'team-1' }))
            .rejects.toThrow('401');
    });

    it('should send a message', async () => {
        // Initialize
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'team-1' }),
        } as any);
        await transport.initialize('token', { teamId: 'team-1', channelId: 'ch-1' });

        // Send
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'msg-001' }),
        } as any);

        const id = await transport.send('ch-1', 'Hello!');
        expect(id).toBe('msg-001');
    });

    it('should poll for messages', async () => {
        // Initialize
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'team-1' }),
        } as any);
        await transport.initialize('token', { teamId: 'team-1', channelId: 'ch-1' });

        // Poll
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                value: [
                    { id: 'msg-1', body: { content: 'Hello' }, createdDateTime: '2026-01-01T00:00:00Z', from: { user: { displayName: 'Alice', id: 'aad-1' } } },
                    { id: 'msg-2', body: { content: 'World' }, createdDateTime: '2026-01-01T00:01:00Z', from: { user: { displayName: 'Bob', id: 'aad-2' } } },
                ],
            }),
        } as any);

        const result = await transport.poll('ch-1');
        expect(result.messages).toHaveLength(2);
        expect(result.messages[0].text).toBe('Hello');
        expect(result.messages[1].senderName).toBe('Bob');
        expect(result.nextSince).toBe('2026-01-01T00:01:00Z');
    });

    it('should list channels', async () => {
        // Initialize
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'team-1' }),
        } as any);
        await transport.initialize('token', { teamId: 'team-1' });

        // List channels
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ value: [{ id: 'ch-1', displayName: 'General' }, { id: 'ch-2', displayName: 'Random' }] }),
        } as any);

        const channels = await transport.listChannels('team-1');
        expect(channels).toHaveLength(2);
        expect(channels[0].displayName).toBe('General');
    });

    it('should update token via setToken', async () => {
        // Initialize
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'team-1' }),
        } as any);
        await transport.initialize('token', { teamId: 'team-1', channelId: 'ch-1' });

        // Update token and send
        transport.setToken('new-token');
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'msg-002' }),
        } as any);

        await transport.send('ch-1', 'After refresh');
        const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
        expect(lastCall[1].headers.Authorization).toBe('Bearer new-token');
    });
});

describe('McpTransport', () => {
    let transport: TeamsTransport;

    beforeEach(() => {
        transport = new McpTransport('https://mcp.test.com/server');
        mockFetch.mockReset();
    });

    it('should initialize MCP session', async () => {
        // MCP initialize request
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map([['mcp-session-id', 'session-1']]),
            json: async () => ({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }),
        } as any);

        await transport.initialize('mcp-token', { teamId: 'team-1' });
    });

    it('should send via MCP tool call', async () => {
        // Initialize
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map([['mcp-session-id', 'session-1']]),
            json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
        } as any);
        await transport.initialize('token', { teamId: 'team-1' });

        // Send
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            json: async () => ({
                jsonrpc: '2.0',
                id: 3,
                result: { content: [{ type: 'text', text: JSON.stringify({ messageId: 'mcp-msg-1' }) }] },
            }),
        } as any);

        const id = await transport.send('ch-1', 'Hello MCP!');
        expect(id).toBe('mcp-msg-1');
    });

    it('should stop and nullify client', async () => {
        transport.stop();
        // After stop, operations should throw
        await expect(transport.send('ch-1', 'test')).rejects.toThrow('not initialized');
    });
});
