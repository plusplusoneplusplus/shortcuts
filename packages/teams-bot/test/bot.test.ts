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

            it('should report error when teamId is missing', async () => {
                const bot = createGraphBot({ teamId: undefined });
                await bot.start();

                expect(bot.getStatus()).toBe('error');
                expect(bot.getLastError()).toContain('teamId is required');
                expect(onError).toHaveBeenCalled();
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
            it('should poll for messages via Graph API', async () => {
                mockGraphTeamResponse();

                const bot = createGraphBot();
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');

                // Mock poll response
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        value: [{
                            id: 'msg-100',
                            body: { content: 'Hello from Teams' },
                            from: { user: { displayName: 'Alice', id: 'user-aad-1' } },
                            createdDateTime: '2026-05-19T22:00:00Z',
                        }],
                    }),
                } as any);

                await vi.advanceTimersByTimeAsync(1000);

                expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
                    channelId: '19:channel@thread.tacv2',
                    messageId: 'msg-100',
                    text: 'Hello from Teams',
                    senderName: 'Alice',
                    senderAadId: 'user-aad-1',
                }));

                await bot.stop();
            });

            it('should skip messages sent by the bot itself', async () => {
                mockGraphTeamResponse();

                const bot = createGraphBot();
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');

                // Send a message first
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ id: 'msg-sent', body: { content: 'Bot msg' } }),
                } as any);
                await bot.send('19:channel@thread.tacv2', 'Bot msg');

                // Poll returns the bot's own message
                mockFetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        value: [{
                            id: 'msg-sent',
                            body: { content: 'Bot msg' },
                            from: { user: { displayName: 'CoC' } },
                            createdDateTime: '2026-05-19T22:01:00Z',
                        }],
                    }),
                } as any);

                await vi.advanceTimersByTimeAsync(1000);

                expect(onMessage).not.toHaveBeenCalled();
                await bot.stop();
            });

            it('should not poll when no channelId is set', async () => {
                mockGraphTeamResponse();

                const bot = createGraphBot();
                await bot.start();
                // No setChannelId

                await vi.advanceTimersByTimeAsync(1000);

                // verifyConnection call only (no poll)
                expect(mockFetch).toHaveBeenCalledTimes(1);
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
            it('should call mcp_graph_teams_postChannelMessage tool', async () => {
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
                expect(body.params.name).toBe('mcp_graph_teams_postChannelMessage');
                expect(body.params.arguments['team-id']).toBe('team-123');
                expect(body.params.arguments['channel-id']).toBe('19:channel@thread.tacv2');
                expect(body.params.arguments['body']).toEqual({ content: 'Hello Teams!' });

                await bot.stop();
            });

            it('should call mcp_graph_teams_replyToChannelMessage for replies', async () => {
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
                expect(body.params.name).toBe('mcp_graph_teams_replyToChannelMessage');
                expect(body.params.arguments['message-id']).toBe('msg-parent');

                await bot.stop();
            });
        });

        describe('polling', () => {
            it('should poll via mcp_graph_teams_listChannelMessages', async () => {
                mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

                const bot = createMcpBot();
                await bot.start();
                bot.setChannelId('19:channel@thread.tacv2');

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
                expect(body.params.name).toBe('mcp_graph_teams_listChannelMessages');
                expect(body.params.arguments['team-id']).toBe('team-123');
                expect(body.params.arguments['channel-id']).toBe('19:channel@thread.tacv2');

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

