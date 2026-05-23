/**
 * Tests for TeamsBot — tests both Graph API and MCP modes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { TeamsBot } from '../src/bot';
import type { InboundTeamsMessage } from '../src/types';

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
                // Mock initialize
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({ result: { serverInfo: { name: 'test' } } }),
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
                // Mock initialize
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    headers: new Map(),
                    json: async () => ({ result: { serverInfo: { name: 'test' } } }),
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

