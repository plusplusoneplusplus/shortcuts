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

    describe('chat (DM) mode — send-only', () => {
        it('should initialize in chat mode when no teamId (only calls /me)', async () => {
            // Only /me is called — no chat discovery (requires Chat.ReadBasic)
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'user-id-1', displayName: 'Test User' }),
            } as any);

            const t = new GraphTransport();
            await t.initialize('token', {});

            // No chatId discovered — Graph send-only mode
            expect(t.getChatId()).toBeNull();
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should send to provided chatId target in DM mode', async () => {
            // Initialize — only /me
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'u1', displayName: 'Me' }) } as any);

            const t = new GraphTransport();
            await t.initialize('token', {});

            // Send to explicit target chatId
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'msg-chat-1' }) } as any);
            const msgId = await t.send('chat-1', 'Hello DM!');
            expect(msgId).toBe('msg-chat-1');

            // Verify it called /chats/chat-1/messages
            const sendCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
            expect(sendCall[0]).toContain('/chats/chat-1/messages');
        });

        it('should use pre-configured chatId if provided in opts', async () => {
            // Initialize with chatId — only /me needed
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'u1', displayName: 'Me' }) } as any);

            const t = new GraphTransport();
            await t.initialize('token', { chatId: 'pre-configured-chat' });

            expect(t.getChatId()).toBe('pre-configured-chat');
        });
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

    it('should resolve team and channel (existing)', async () => {
        // Initialize
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map([['mcp-session-id', 'session-1']]),
            json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
        } as any);
        await transport.initialize('token', { teamId: 'team-1' });

        // ListTeams tool call
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            json: async () => ({
                jsonrpc: '2.0', id: 3,
                result: { content: [{ type: 'text', text: JSON.stringify({ value: [{ id: 'tid-1', displayName: 'MyTeam' }] }) }] },
            }),
        } as any);
        // ListChannels tool call
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            json: async () => ({
                jsonrpc: '2.0', id: 4,
                result: { content: [{ type: 'text', text: JSON.stringify({ value: [{ id: 'cid-1', displayName: 'General' }] }) }] },
            }),
        } as any);

        const result = await transport.resolveTeamAndChannel('MyTeam', 'General');
        expect(result.teamId).toBe('tid-1');
        expect(result.channelId).toBe('cid-1');
    });

    it('should create team and channel when not found', async () => {
        // Initialize
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map([['mcp-session-id', 'session-1']]),
            json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
        } as any);
        await transport.initialize('token', { teamId: 'team-1' });

        // ListTeams — empty
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            json: async () => ({
                jsonrpc: '2.0', id: 3,
                result: { content: [{ type: 'text', text: JSON.stringify({ value: [] }) }] },
            }),
        } as any);
        // CreateTeam
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            json: async () => ({
                jsonrpc: '2.0', id: 4,
                result: { content: [{ type: 'text', text: JSON.stringify({ id: 'new-team-id' }) }] },
            }),
        } as any);
        // ListChannels — empty
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            json: async () => ({
                jsonrpc: '2.0', id: 5,
                result: { content: [{ type: 'text', text: JSON.stringify({ value: [] }) }] },
            }),
        } as any);
        // CreateChannel
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map(),
            json: async () => ({
                jsonrpc: '2.0', id: 6,
                result: { content: [{ type: 'text', text: JSON.stringify({ id: 'new-ch-id' }) }] },
            }),
        } as any);

        const result = await transport.resolveTeamAndChannel('NewTeam', 'NewChannel');
        expect(result.teamId).toBe('new-team-id');
        expect(result.channelId).toBe('new-ch-id');
    });

    describe('DM (self) mode', () => {
        it('should initialize in DM mode when no teamId and discover chatId via SendMessageToSelf', async () => {
            const t = new McpTransport('https://mcp.test.com/server');

            // MCP initialize
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map([['mcp-session-id', 'session-dm']]),
                json: async () => ({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }),
            } as any);
            // listTools
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 2,
                    result: { tools: [{ name: 'SendMessageToSelf' }, { name: 'ListChatMessages' }, { name: 'ListChats' }] },
                }),
            } as any);
            // SendMessageToSelf (init message to discover chatId)
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 3,
                    result: { content: [{ type: 'text', text: JSON.stringify({ id: 'init-msg-1', chatId: '19:self-chat@unq.gbl.spaces' }) }] },
                }),
            } as any);

            await t.initialize('mcp-token', {}); // no teamId → DM mode

            expect(t.getChatId()).toBe('19:self-chat@unq.gbl.spaces');
        });

        it('should send via SendMessageToSelf in DM mode', async () => {
            const t = new McpTransport('https://mcp.test.com/server');

            // Initialize (with tools including SendMessageToSelf)
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map([['mcp-session-id', 'session-dm']]),
                json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
            } as any);
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 2,
                    result: { tools: [{ name: 'SendMessageToSelf' }, { name: 'ListChatMessages' }] },
                }),
            } as any);
            // SendMessageToSelf init
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 3,
                    result: { content: [{ type: 'text', text: JSON.stringify({ id: 'init-1', chatId: '19:chat@spaces' }) }] },
                }),
            } as any);

            await t.initialize('token', {}); // DM mode

            // Now send a real message
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 4,
                    result: { content: [{ type: 'text', text: JSON.stringify({ id: 'dm-msg-1', chatId: '19:chat@spaces' }) }] },
                }),
            } as any);

            const msgId = await t.send('19:chat@spaces', 'Hello self!');
            expect(msgId).toBe('dm-msg-1');

            // Verify the tool called was SendMessageToSelf
            const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
            const body = JSON.parse(lastCall[1].body);
            expect(body.params.name).toBe('SendMessageToSelf');
            expect(body.params.arguments.content).toBe('Hello self!');
        });

        it('should fall back to ListChats when SendMessageToSelf init fails', async () => {
            const t = new McpTransport('https://mcp.test.com/server');

            // Initialize
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map([['mcp-session-id', 'session-dm']]),
                json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
            } as any);
            // listTools — has both SendMessageToSelf and ListChats
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 2,
                    result: { tools: [{ name: 'SendMessageToSelf' }, { name: 'ListChats' }] },
                }),
            } as any);
            // SendMessageToSelf init — returns error
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 3,
                    result: { content: [{ type: 'text', text: 'Error: something went wrong' }] },
                }),
            } as any);
            // ListChats fallback
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 4,
                    result: { content: [{ type: 'text', text: JSON.stringify({ chats: [{ id: '19:fallback-chat@spaces', chatType: 'oneOnOne' }] }) }] },
                }),
            } as any);

            await t.initialize('token', {});

            expect(t.getChatId()).toBe('19:fallback-chat@spaces');
        });

        it('should throw error response from SendMessageToSelf during send', async () => {
            const t = new McpTransport('https://mcp.test.com/server');

            // Initialize in DM mode
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map([['mcp-session-id', 'session-dm']]),
                json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
            } as any);
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 2,
                    result: { tools: [{ name: 'SendMessageToSelf' }] },
                }),
            } as any);
            // SendMessageToSelf init — works
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 3,
                    result: { content: [{ type: 'text', text: JSON.stringify({ id: 'init-1', chatId: '19:c@s' }) }] },
                }),
            } as any);

            await t.initialize('token', {});

            // Send — returns error
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    jsonrpc: '2.0', id: 4,
                    result: { content: [{ type: 'text', text: 'Error: Failed to send message: NotFound' }] },
                }),
            } as any);

            await expect(t.send('19:c@s', 'test')).rejects.toThrow('Error: Failed to send message: NotFound');
        });
    });
});
