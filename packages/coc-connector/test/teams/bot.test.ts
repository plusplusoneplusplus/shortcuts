/**
 * Tests for TeamsBot — tests both Graph API and MCP modes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', (url: string, options?: RequestInit) => {
    if (typeof options?.body === 'string'
        && JSON.parse(options.body).method === 'notifications/initialized') {
        return Promise.resolve({ ok: true, headers: new Map(), body: { cancel: async () => {} } });
    }
    return mockFetch(url, options);
});

import { TeamsBot } from '../../src/teams/bot';
import { McpHttpError } from '../../src/teams/mcp-client';
import type { InboundTeamsMessage, TeamsTransport } from '../../src/teams/types';

describe('TeamsBot', () => {
    let onMessage: ReturnType<typeof vi.fn>;
    let onStatusChange: ReturnType<typeof vi.fn>;
    let onError: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        onMessage = vi.fn().mockResolvedValue(undefined);
        onStatusChange = vi.fn();
        onError = vi.fn();
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    // ── Graph mode tests ──────────────────────────────────

    describe('graph mode', () => {
        function createGraphBot(opts?: Partial<ConstructorParameters<typeof TeamsBot>[0]>) {
            return new TeamsBot({
                mode: 'graph',
                teamId: 'team-123',
                onMessage,
                onStatusChange,
                onError,
                pollIntervalMs: 1000,
                auth: { bearerToken: 'graph-token-123' },
                ...opts,
            });
        }

        function mockGraphTeamResponse() {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'team-123', displayName: 'Test Team' }),
            } as any);
        }

        describe('start', () => {
            it('should connect successfully via Graph API', async () => {
                mockGraphTeamResponse();

                const bot = createGraphBot();
                await bot.start();

                expect(bot.getStatus()).toBe('connected');
                expect(bot.isConnected()).toBe(true);
                expect(bot.getMode()).toBe('graph');
                expect(onStatusChange).toHaveBeenCalledWith('connecting');
                expect(onStatusChange).toHaveBeenCalledWith('connected');
                await bot.stop();
            });

            it('should use chat (DM) mode when teamId is missing', async () => {
                // Mock /me call (only verification needed in send-only mode)
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ id: 'user-aad-id', displayName: 'Test User' }),
                } as any);

                const bot = createGraphBot({ teamId: undefined });
                await bot.start();

                expect(bot.getStatus()).toBe('connected');
                // Graph send-only mode: no chatId discovery (requires Chat.ReadBasic)
                expect(bot.getChannelId()).toBeNull();
                await bot.stop();
            });

            it('should report error on Graph connection failure', async () => {
                mockFetch.mockRejectedValueOnce(new Error('Network error'));

                const bot = createGraphBot();
                await bot.start();

                expect(bot.getStatus()).toBe('error');
                expect(bot.getLastError()).toContain('Network error');
                expect(onError).toHaveBeenCalled();
            });

            it('should report error on Graph 401', async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: false,
                    status: 401,
                    text: async () => 'Unauthorized',
                } as any);

                const bot = createGraphBot();
                await bot.start();

                expect(bot.getStatus()).toBe('error');
                expect(bot.getLastError()).toContain('401');
            });
        });

        describe('send', () => {
            it('should post a channel message via Graph API', async () => {
                mockGraphTeamResponse();

                const bot = createGraphBot();
                await bot.start();

                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ id: 'msg-001', body: { content: 'Hello!' } }),
                } as any);

                const msgId = await bot.send('19:channel@thread.tacv2', 'Hello Teams!');
                expect(msgId).toBe('msg-001');

                // Verify the Graph API call
                const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
                expect(lastCall[0]).toContain('/teams/team-123/channels/');
                expect(lastCall[0]).toContain('/messages');
                const body = JSON.parse(lastCall[1].body);
                expect(body.body.content).toBe('Hello Teams!');

                await bot.stop();
            });

            it('should reply to a thread via Graph API', async () => {
                mockGraphTeamResponse();

                const bot = createGraphBot();
                await bot.start();

                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ id: 'msg-reply-001' }),
                } as any);

                const msgId = await bot.send('19:channel@thread.tacv2', 'Reply!', { replyToId: 'msg-parent' });
                expect(msgId).toBe('msg-reply-001');

                const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
                expect(lastCall[0]).toContain('/messages/msg-parent/replies');

                await bot.stop();
            });

            it('should throw when not connected', async () => {
                const bot = createGraphBot();
                await expect(bot.send('channel-1', 'Hello')).rejects.toThrow('TeamsBot is not connected');
            });

            it('forwards a channel Like to the transport but never reacts in DM mode', async () => {
                mockGraphTeamResponse();
                const bot = createGraphBot();
                await bot.start();
                const react = vi.spyOn((bot as unknown as { transport: TeamsTransport }).transport, 'reactToChannelMessage')
                    .mockResolvedValue(undefined);
                const msg = { channelId: 'channel-1', messageId: 'reply', replyToMessageId: 'root', text: 'ask' };
                await bot.reactToChannelMessage(msg);
                expect(react).toHaveBeenCalledExactlyOnceWith(msg);
                await bot.stop();

                mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'user-id' }) });
                const dm = createGraphBot({ teamId: undefined });
                await dm.start();
                await expect(dm.reactToChannelMessage(msg)).rejects.toThrow('unavailable');
                await dm.stop();
            });
        });

        describe('listChannels', () => {
            it('should list channels via Graph API', async () => {
                mockGraphTeamResponse();

                const bot = createGraphBot();
                await bot.start();

                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        value: [
                            { id: 'ch-1', displayName: 'General' },
                            { id: 'ch-2', displayName: 'Dev' },
                        ],
                    }),
                } as any);

                const channels = await bot.listChannels();
                expect(channels).toHaveLength(2);
                expect(channels[0].displayName).toBe('General');

                await bot.stop();
            });
        });

        describe('polling', () => {
            it('should NOT poll in graph mode (send-only)', async () => {
                mockGraphTeamResponse();

                const bot = createGraphBot();
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');

                await vi.advanceTimersByTimeAsync(1000);

                // Only verifyConnection call — no poll
                expect(mockFetch).toHaveBeenCalledTimes(1);
                expect(onMessage).not.toHaveBeenCalled();
                await bot.stop();
            });
        });
    });

    // ── MCP mode tests ──────────────────────────────────

    describe('mcp mode', () => {
        function createMcpBot(opts?: Partial<ConstructorParameters<typeof TeamsBot>[0]>) {
            return new TeamsBot({
                mode: 'mcp',
                teamId: 'team-123',
                mcpServerUrl: 'https://test.mcp.server/mcp',
                onMessage,
                onStatusChange,
                onError,
                pollIntervalMs: 1000,
                auth: { bearerToken: 'test-token-123' },
                ...opts,
            });
        }

        function mockMcpResponse(result: unknown) {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map([['Mcp-Session-Id', 'session-123']]),
                json: async () => ({ result }),
            } as any);
        }

        it('surfaces polling errors and clears them when polling recovers', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });
            const bot = createMcpBot();
            await bot.start();
            bot.setChannelId('channel-123');

            mockFetch.mockRejectedValueOnce(new Error('Polling unavailable'));
            await vi.advanceTimersByTimeAsync(1000);
            expect(onError).toHaveBeenCalledWith('Polling unavailable');
            expect(bot.getLastError()).toBe('Polling unavailable');

            mockMcpResponse({ content: [{ type: 'text', text: JSON.stringify({ messages: [] }) }] });
            await vi.advanceTimersByTimeAsync(1000);
            expect(bot.getLastError()).toBeNull();
            expect(onStatusChange).toHaveBeenCalledWith('connected');
            await bot.stop();
        });

        it('uses a 12-second active cadence and 30-second idle cadence even when old roots remain visible', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26' });
            const bot = createMcpBot({ pollIntervalMs: undefined });
            await bot.start();
            bot.setChannelId('channel-123');
            const poll = vi.spyOn((bot as unknown as { transport: TeamsTransport }).transport, 'poll')
                .mockResolvedValue({ messages: [{
                    channelId: 'channel-123', messageId: 'old-root', text: 'old',
                }], nextSince: 'old-root' });

            await vi.advanceTimersByTimeAsync(11_999);
            expect(poll).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(poll).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(48_000);
            expect(poll).toHaveBeenCalledTimes(5);
            await vi.advanceTimersByTimeAsync(29_999);
            expect(poll).toHaveBeenCalledTimes(5);
            await vi.advanceTimersByTimeAsync(1);
            expect(poll).toHaveBeenCalledTimes(6);
            await bot.stop();
        });

        it('backs off on 429 with bounded jitter, then returns to the active cadence after success', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26' });
            const bot = createMcpBot();
            await bot.start();
            bot.setChannelId('channel-123');
            vi.spyOn(Math, 'random').mockReturnValue(0);
            const poll = vi.spyOn((bot as unknown as { transport: TeamsTransport }).transport, 'poll')
                .mockRejectedValueOnce(new McpHttpError(429, 'Too Many Requests'))
                .mockRejectedValueOnce(new McpHttpError(429, 'Too Many Requests'))
                .mockResolvedValue({ messages: [], nextSince: '' });

            await vi.advanceTimersByTimeAsync(1_000);
            expect(onError).toHaveBeenCalledWith('MCP HTTP error: 429 Too Many Requests');
            await vi.advanceTimersByTimeAsync(999);
            expect(poll).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(poll).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1_999);
            expect(poll).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            expect(poll).toHaveBeenCalledTimes(3);
            expect(bot.getLastError()).toBeNull();
            await vi.advanceTimersByTimeAsync(1_000);
            expect(poll).toHaveBeenCalledTimes(4);
            await bot.stop();
        });

        it('caps consecutive 429 retries at five minutes', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26' });
            const bot = createMcpBot();
            await bot.start();
            bot.setChannelId('channel-123');
            vi.spyOn(Math, 'random').mockReturnValue(1);
            const times: number[] = [];
            vi.spyOn((bot as unknown as { transport: TeamsTransport }).transport, 'poll')
                .mockImplementation(async () => {
                    times.push(Date.now());
                    throw new McpHttpError(429, 'Too Many Requests');
                });
            for (let i = 0; i < 11; i++) await vi.advanceTimersToNextTimerAsync();
            expect(times).toHaveLength(11);
            expect(times[10] - times[9]).toBe(300_000);
            await bot.stop();
        });

        it('honors Retry-After across reply fan-out and does not let sending bypass the cooldown', async () => {
            let replyCalls = 0;
            const tools: string[] = [];
            mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
                const body = JSON.parse(String(options.body));
                const tool = body.params?.name;
                if (tool) tools.push(tool);
                if (tool === 'ListChannelMessageReplies' && ++replyCalls === 1) {
                    return new Response(null, {
                        status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '7' },
                    });
                }
                const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26' }
                    : body.method === 'tools/list' ? { tools: [{ name: 'ListChannelMessageReplies' }] }
                        : { content: [{ text: JSON.stringify(tool === 'ListChannelMessages'
                            ? [{ id: 'root', body: { content: 'initial' } }] : []) }] };
                return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
            });
            const bot = createMcpBot({ pollChannelReplies: () => true });
            await bot.start();
            bot.setChannelId('channel-123');
            await vi.advanceTimersByTimeAsync(1_000);
            expect(bot.getLastError()).toContain('429');
            expect(tools).toEqual(['ListChannelMessages', 'ListChannelMessageReplies']);
            // A send that succeeds during backoff must not bring forward the next poll.
            await bot.send('channel-123', 'outbound');
            await vi.advanceTimersByTimeAsync(6_999);
            expect(tools.filter(t => t === 'ListChannelMessages')).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(tools.filter(t => t === 'ListChannelMessages')).toHaveLength(2);
            expect(bot.getLastError()).toBeNull();
            await bot.stop();
        });

        it('recovers an expired MCP session during reply fan-out and still delivers the next thread reply', async () => {
            let sessions = 0;
            let replyCalls = 0;
            mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
                const body = JSON.parse(String(options.body));
                if (body.method === 'initialize') {
                    sessions++;
                    return new Response(JSON.stringify({ result: { protocolVersion: '2025-03-26' } }), {
                        headers: { 'Mcp-Session-Id': `session-${sessions}` },
                    });
                }
                if (body.params?.name === 'ListChannelMessageReplies' && ++replyCalls === 1) {
                    return new Response(null, { status: 404, statusText: 'Not Found' });
                }
                const result = body.method === 'tools/list'
                    ? { tools: [{ name: 'ListChannelMessageReplies' }] }
                    : { content: [{ text: JSON.stringify(body.params?.name === 'ListChannelMessages'
                        ? [{ id: 'root', body: { content: 'old' } }]
                        : replyCalls > 2 ? [{ id: 'new-reply', body: { content: '/list repos' } }] : []) }] };
                return new Response(JSON.stringify({ result }));
            });
            const bot = createMcpBot({ pollChannelReplies: () => true });
            await bot.start();
            bot.setChannelId('channel-123');
            await vi.advanceTimersByTimeAsync(1_000);
            expect(sessions).toBe(2);
            expect(onError).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1_000);
            expect(onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                messageId: 'new-reply', replyToMessageId: 'root', text: '/list repos',
            }));
            await bot.stop();
        });

        it('keeps reporting non-429 failures at normal cadence and survives an error observer throwing', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26' });
            const bot = createMcpBot({ onError: vi.fn(() => { throw new Error('observer failed'); }) });
            await bot.start();
            bot.setChannelId('channel-123');
            const poll = vi.spyOn((bot as unknown as { transport: TeamsTransport }).transport, 'poll')
                .mockRejectedValueOnce(new McpHttpError(404, 'Not Found'))
                .mockResolvedValue({ messages: [], nextSince: '' });
            await vi.advanceTimersByTimeAsync(1_000);
            expect(bot.getLastError()).toContain('404');
            await vi.advanceTimersByTimeAsync(1_000);
            expect(poll).toHaveBeenCalledTimes(2);
            expect(bot.getLastError()).toBeNull();
            await bot.stop();
        });

        describe('start', () => {
            it('should connect successfully via MCP initialize', async () => {
                mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

                const bot = createMcpBot();
                await bot.start();

                expect(bot.getStatus()).toBe('connected');
                expect(bot.isConnected()).toBe(true);
                expect(bot.getMode()).toBe('mcp');
                expect(onStatusChange).toHaveBeenCalledWith('connecting');
                expect(onStatusChange).toHaveBeenCalledWith('connected');
                await bot.stop();
            });

            it('should throw when mcpServerUrl is missing', () => {
                expect(() => createMcpBot({ mcpServerUrl: undefined })).toThrow('mcpServerUrl is required');
            });

            it('should report error on MCP initialize failure', async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({ error: { code: -1, message: 'Auth failed' } }),
                } as any);

                const bot = createMcpBot();
                await bot.start();

                expect(bot.getStatus()).toBe('error');
                expect(bot.getLastError()).toContain('Auth failed');
            });
        });

        describe('send', () => {
            it('should call SendMessageToChannel tool', async () => {
                mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

                const bot = createMcpBot();
                await bot.start();

                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: { content: [{ type: 'text', text: JSON.stringify({ messageId: 'msg-001' }) }] },
                    }),
                } as any);

                const msgId = await bot.send('19:channel@thread.tacv2', 'Hello Teams!');
                expect(msgId).toBe('msg-001');

                const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
                const body = JSON.parse(lastCall[1].body);
                expect(body.method).toBe('tools/call');
                expect(body.params.name).toBe('SendMessageToChannel');
                expect(body.params.arguments.teamId).toBe('team-123');
                expect(body.params.arguments.channelId).toBe('19:channel@thread.tacv2');
                expect(body.params.arguments.content).toBe('Hello Teams!');

                await bot.stop();
            });

            it('should call ReplyToChannelMessage for replies', async () => {
                mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

                const bot = createMcpBot();
                await bot.start();

                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: { content: [{ type: 'text', text: '{"messageId":"msg-002"}' }] },
                    }),
                } as any);

                await bot.send('19:channel@thread.tacv2', 'Reply!', { replyToId: 'msg-parent' });

                const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
                const body = JSON.parse(lastCall[1].body);
                expect(body.params.name).toBe('ReplyToChannelMessage');
                expect(body.params.arguments.messageId).toBe('msg-parent');
                expect(body.params.arguments.content).toBe('Reply!');

                await bot.stop();
            });
        });

        describe('polling', () => {
            it('delivers each new channel thread reply once, including two asks between polls', async () => {
                let poll = 0;
                const calls: string[] = [];
                mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
                    const body = JSON.parse(String(options.body));
                    const tool = body.params?.name;
                    if (tool) calls.push(tool);
                    const result = body.method === 'initialize'
                        ? { protocolVersion: '2025-03-26' }
                        : body.method === 'tools/list'
                            ? { tools: [{ name: 'ListChannelMessageReplies' }] }
                            : tool === 'ListChannelMessages'
                                ? { content: [{ text: JSON.stringify([{ id: 'root', body: { content: 'initial' } }]) }] }
                                : tool === 'ListChannelMessageReplies'
                                    ? { content: [{ text: JSON.stringify(poll++ === 0 ? [] : [
                                        { id: 'first', body: { content: 'first ask' } },
                                        { id: 'second', body: { content: 'second ask' } },
                                        ...(poll > 2 ? [{ id: 'bot-reply', body: { content: 'answer' } }] : []),
                                    ]) }] }
                                    : tool === 'ReplyToChannelMessage'
                                        ? { content: [{ text: '{"id":"bot-reply"}' }] }
                                    : {};
                    return {
                        ok: true, headers: new Map(),
                        json: async () => ({ jsonrpc: '2.0', id: body.id, result }),
                    };
                });
                const bot = createMcpBot({ pollChannelReplies: () => true });
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage).not.toHaveBeenCalled();
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage.mock.calls.map(([msg]) => [msg.messageId, msg.replyToMessageId]))
                    .toEqual([['first', 'root'], ['second', 'root']]);
                await bot.send('19:channel@thread.tacv2', 'answer', { replyToId: 'root' });
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage).toHaveBeenCalledTimes(2);
                expect(calls).toContain('ListChannelMessageReplies');
                await bot.stop();
            });

            it('restores tracked older replies on first poll without replaying admitted or outbound messages', async () => {
                const known = new Set(['accepted-before-restart']);
                mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
                    const body = JSON.parse(String(options.body));
                    const tool = body.params?.name;
                    const result = body.method === 'initialize'
                        ? { protocolVersion: '2025-03-26' }
                        : body.method === 'tools/list'
                            ? { tools: [{ name: 'ListChannelMessageReplies' }] }
                            : tool === 'ListChannelMessages'
                                ? { content: [{ text: JSON.stringify([{ id: 'recent-root', body: { content: 'old post' } }]) }] }
                                : { content: [{ text: JSON.stringify(body.params.arguments.messageId === 'older-root'
                                    ? [
                                        { id: 'accepted-before-restart', body: { content: 'old ask' } },
                                        { id: 'outbound', body: { content: 'answer' } },
                                        { id: 'new-ask', body: { content: 'new ask' } },
                                        { id: 'next-ask', body: { content: 'another ask' } },
                                    ] : []) }] };
                    return { ok: true, headers: new Map(),
                        json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
                });
                onMessage.mockImplementation(async (msg: InboundTeamsMessage) => { known.add(msg.messageId); });
                const options = {
                    pollChannelReplies: () => true,
                    channelThreadRoots: () => ['older-root'],
                    isOwnChannelReply: (msg: InboundTeamsMessage) => msg.messageId === 'outbound',
                    isKnownChannelReply: (msg: InboundTeamsMessage) => known.has(msg.messageId),
                };
                const first = createMcpBot(options);
                await first.start();
                first.setChannelId('channel-123');
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage.mock.calls.map(([msg]) => msg.messageId)).toEqual(['new-ask', 'next-ask']);
                await first.stop();

                const restarted = createMcpBot(options);
                await restarted.start();
                restarted.setChannelId('channel-123');
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage).toHaveBeenCalledTimes(2);
                await restarted.stop();
            });

            it('retries a failed channel admission rather than discarding the reply ID', async () => {
                mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
                    const body = JSON.parse(String(options.body));
                    const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26' }
                        : body.method === 'tools/list' ? { tools: [{ name: 'ListChannelMessageReplies' }] }
                            : { content: [{ text: JSON.stringify(body.params?.name === 'ListChannelMessages'
                                ? [{ id: 'recent', body: { content: 'old' } }]
                                : body.params.arguments.messageId === 'older-root'
                                    ? [{ id: 'new', body: { content: 'ask' } }] : []) }] };
                    return { ok: true, headers: new Map(),
                        json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
                });
                onMessage.mockRejectedValueOnce(new Error('queue unavailable'));
                const bot = createMcpBot({ pollChannelReplies: () => true, channelThreadRoots: () => ['older-root'] });
                await bot.start();
                bot.setChannelId('channel-123');
                await vi.advanceTimersByTimeAsync(1000);
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage).toHaveBeenCalledTimes(2);
                await bot.stop();
            });

            it('never infers a new channel root from a preceding bot reply in another thread', async () => {
                let poll = 0;
                mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
                    const body = JSON.parse(String(options.body));
                    const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26' }
                        : body.method === 'tools/list' ? { tools: [{ name: 'ListChannelMessageReplies' }] }
                            : body.params?.name === 'ListChannelMessages'
                                ? { content: [{ text: JSON.stringify([
                                    { id: 'bot-post', body: { content: 'CoC\nAgent: A\nRepo: A\nMessage:\nanswer' },
                                        createdDateTime: '2026-01-01T00:00:00Z' },
                                    ...(poll++ ? [{ id: 'new-root', body: { content: 'new request' },
                                        createdDateTime: '2026-01-01T00:00:01Z' }] : []),
                                ]) }] }
                                : { content: [{ text: '[]' }] };
                    return { ok: true, headers: new Map(),
                        json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
                });
                const bot = createMcpBot({ pollChannelReplies: () => true });
                await bot.start();
                bot.setChannelId('channel-123');
                await vi.advanceTimersByTimeAsync(1000);
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                    messageId: 'new-root', replyToMessageId: undefined,
                }));
                await bot.stop();
            });

            it('keeps default channel polling unchanged until thread polling is enabled', async () => {
                let enabled = false;
                let replyPolls = 0;
                mockFetch.mockImplementation(async (_url: string, options: RequestInit) => {
                    const body = JSON.parse(String(options.body));
                    const result = body.method === 'initialize'
                        ? { protocolVersion: '2025-03-26' }
                        : body.method === 'tools/list'
                            ? { tools: [{ name: 'ListChannelMessageReplies' }] }
                            : body.params?.name === 'ListChannelMessages'
                                ? { content: [{ text: JSON.stringify([{ id: 'root', body: { content: 'old' } }]) }] }
                                : body.params?.name === 'ListChannelMessageReplies'
                                    ? { content: [{ text: JSON.stringify(++replyPolls > 1
                                        ? [{ id: 'new-reply', body: { content: 'new ask' } }] : []) }] }
                                    : {};
                    return { ok: true, headers: new Map(),
                        json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
                });
                const bot = createMcpBot({ pollChannelReplies: () => enabled });
                await bot.start();
                bot.setChannelId('channel-123');
                await vi.advanceTimersByTimeAsync(1000);
                expect(replyPolls).toBe(0);
                enabled = true;
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage).not.toHaveBeenCalled();
                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                    messageId: 'new-reply', replyToMessageId: 'root',
                }));
                await bot.stop();
            });

            it('should skip first poll (set watermark) then process new messages', async () => {
                mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

                const bot = createMcpBot();
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');

                // First poll: sets watermark, does NOT call onMessage
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: {
                            content: [{
                                type: 'text',
                                text: JSON.stringify([{
                                    id: 'msg-old',
                                    body: { content: 'Old message' },
                                    from: { user: { displayName: 'Alice' } },
                                    createdDateTime: '2026-05-19T22:00:00Z',
                                }]),
                            }],
                        },
                    }),
                } as any);

                await vi.advanceTimersByTimeAsync(1000);
                expect(onMessage).not.toHaveBeenCalled();

                // Second poll: new message after watermark → delivered
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: {
                            content: [{
                                type: 'text',
                                text: JSON.stringify([{
                                    id: 'msg-200',
                                    body: { content: 'Hello from MCP' },
                                    from: { user: { displayName: 'Bob' } },
                                    createdDateTime: '2026-05-19T22:05:00Z',
                                }]),
                            }],
                        },
                    }),
                } as any);

                await vi.advanceTimersByTimeAsync(1000);

                expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
                    messageId: 'msg-200',
                    text: 'Hello from MCP',
                    senderName: 'Bob',
                }));

                // Verify the tool name used
                const pollCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
                const body = JSON.parse(pollCall[1].body);
                expect(body.params.name).toBe('ListChannelMessages');
                expect(body.params.arguments.teamId).toBe('team-123');
                expect(body.params.arguments.channelId).toBe('19:channel@thread.tacv2');

                await bot.stop();
            });

            it('should strip HTML tags from polled messages', async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({ result: { protocolVersion: '2025-03-26', serverInfo: { name: 'test' } } }),
                } as any);

                const bot = new TeamsBot({
                    mode: 'mcp',
                    teamId: 'team-123',
                    mcpServerUrl: 'https://mcp.test/server',
                    onMessage,
                    onStatusChange,
                    pollIntervalMs: 1000,
                    auth: { bearerToken: 'token' },
                });
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');

                // First poll — set watermark
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: { content: [{ type: 'text', text: JSON.stringify({ messages: [{ id: 'msg-300', body: { content: '<p>old</p>' }, from: { user: { displayName: 'Alice' } }, createdDateTime: '2026-05-19T22:00:00Z' }] }) }] },
                    }),
                } as any);
                await vi.advanceTimersByTimeAsync(1000);

                // Second poll — new message with HTML
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: { content: [{ type: 'text', text: JSON.stringify({ messages: [{ id: 'msg-301', body: { content: '<p>Hello <b>world</b></p>' }, from: { user: { displayName: 'Alice' } }, createdDateTime: '2026-05-19T22:01:00Z' }] }) }] },
                    }),
                } as any);
                await vi.advanceTimersByTimeAsync(1000);

                expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
                    messageId: 'msg-301',
                    text: 'Hello world',
                    senderName: 'Alice',
                }));

                await bot.stop();
            });

            it('should skip bot-formatted messages (Agent:/Repo:/Message: pattern)', async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({ result: { protocolVersion: '2025-03-26', serverInfo: { name: 'test' } } }),
                } as any);

                const bot = new TeamsBot({
                    mode: 'mcp',
                    teamId: 'team-123',
                    mcpServerUrl: 'https://mcp.test/server',
                    onMessage,
                    onStatusChange,
                    pollIntervalMs: 1000,
                    auth: { bearerToken: 'token' },
                });
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');

                // First poll — set watermark
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: { content: [{ type: 'text', text: JSON.stringify({ messages: [{ id: 'msg-400', body: { content: 'init' }, from: { user: { displayName: 'X' } }, createdDateTime: '2026-05-19T22:00:00Z' }] }) }] },
                    }),
                } as any);
                await vi.advanceTimersByTimeAsync(1000);

                // Second poll — bot-formatted message (HTML with <br> as sent by CoC)
                const botMsg = 'CoC Agent:<br>Agent: dev-agent<br>Repo: my-repo<br>Message:<br>Here is the result';
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: { content: [{ type: 'text', text: JSON.stringify({ messages: [{ id: 'msg-401', body: { content: botMsg }, from: { user: { displayName: 'Bot' } }, createdDateTime: '2026-05-19T22:01:00Z' }] }) }] },
                    }),
                } as any);
                await vi.advanceTimersByTimeAsync(1000);

                expect(onMessage).not.toHaveBeenCalled();

                await bot.stop();
            });

            it('should infer replyToMessageId from preceding bot message in DM mode', async () => {
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({ result: { protocolVersion: '2025-03-26', serverInfo: { name: 'test' } } }),
                } as any);

                const bot = new TeamsBot({
                    mode: 'mcp',
                    teamId: 'team-123',
                    mcpServerUrl: 'https://mcp.test/server',
                    onMessage,
                    onStatusChange,
                    pollIntervalMs: 1000,
                    auth: { bearerToken: 'token' },
                });
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');

                // First poll — set watermark
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: { content: [{ type: 'text', text: JSON.stringify({ messages: [{ id: 'msg-500', body: { content: 'init' }, from: { user: { displayName: 'X' } }, createdDateTime: '2026-05-19T22:00:00Z' }] }) }] },
                    }),
                } as any);
                await vi.advanceTimersByTimeAsync(1000);

                // Second poll — bot message followed by user reply (no replyToId)
                const botMsg = 'CoC Agent:<br>Agent: dev<br>Repo: my-repo<br>ChatId: queue_123<br>Message:<br>Here is the answer';
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({
                        result: { content: [{ type: 'text', text: JSON.stringify({ messages: [
                            { id: 'msg-bot-600', body: { content: botMsg }, from: { user: { displayName: 'Bot' } }, createdDateTime: '2026-05-19T22:01:00Z' },
                            { id: 'msg-user-601', body: { content: 'Can we resume?' }, from: { user: { displayName: 'Alice', id: 'alice-aad' } }, createdDateTime: '2026-05-19T22:02:00Z' },
                        ] }) }] },
                    }),
                } as any);
                await vi.advanceTimersByTimeAsync(1000);

                expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
                    messageId: 'msg-user-601',
                    text: 'Can we resume?',
                    replyToMessageId: 'msg-bot-600',
                }));

                await bot.stop();
            });
        });
    });

    // ── Common tests ──────────────────────────────────

    describe('stop', () => {
        it('should disconnect and stop polling', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'team-123', displayName: 'Test' }),
            } as any);

            const bot = new TeamsBot({
                mode: 'graph',
                teamId: 'team-123',
                onMessage,
                pollIntervalMs: 1000,
                auth: { bearerToken: 'token' },
            });
            await bot.start();
            await bot.stop();

            expect(bot.getStatus()).toBe('disconnected');
            expect(bot.isConnected()).toBe(false);
        });
    });

    describe('setChannelId / getChannelId', () => {
        it('should store and retrieve channel ID', () => {
            const bot = new TeamsBot({
                mode: 'graph',
                teamId: 'team-123',
                onMessage,
                auth: { bearerToken: 'token' },
            });
            expect(bot.getChannelId()).toBeNull();
            bot.setChannelId('ch-xyz');
            expect(bot.getChannelId()).toBe('ch-xyz');
        });
    });
});
