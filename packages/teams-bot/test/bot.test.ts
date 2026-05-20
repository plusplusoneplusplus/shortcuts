/**
 * Tests for TeamsBot — mocks MCP client and verifies bot behavior.
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

    function createBot(opts?: Partial<ConstructorParameters<typeof TeamsBot>[0]>) {
        return new TeamsBot({
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

            const bot = createBot();
            await bot.start();

            expect(bot.getStatus()).toBe('connected');
            expect(bot.isConnected()).toBe(true);
            expect(onStatusChange).toHaveBeenCalledWith('connecting');
            expect(onStatusChange).toHaveBeenCalledWith('connected');
            await bot.stop();
        });

        it('should report error on connection failure', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const bot = createBot();
            await bot.start();

            expect(bot.getStatus()).toBe('error');
            expect(bot.getLastError()).toContain('Network error');
            expect(onError).toHaveBeenCalled();
        });

        it('should report error on MCP initialize failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({ error: { code: -1, message: 'Auth failed' } }),
            } as any);

            const bot = createBot();
            await bot.start();

            expect(bot.getStatus()).toBe('error');
            expect(bot.getLastError()).toContain('Auth failed');
        });
    });

    describe('stop', () => {
        it('should disconnect and stop polling', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

            const bot = createBot();
            await bot.start();
            await bot.stop();

            expect(bot.getStatus()).toBe('disconnected');
            expect(bot.isConnected()).toBe(false);
        });
    });

    describe('send', () => {
        it('should call send_message tool via MCP', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

            const bot = createBot();
            await bot.start();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    result: { content: [{ type: 'text', text: JSON.stringify({ messageId: 'msg-001' }) }] },
                }),
            } as any);

            const msgId = await bot.send('channel-1', 'Hello Teams!');
            expect(msgId).toBe('msg-001');

            // Verify the tool call
            const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
            const body = JSON.parse(lastCall[1].body);
            expect(body.method).toBe('tools/call');
            expect(body.params.name).toBe('send_message');
            expect(body.params.arguments.channelId).toBe('channel-1');
            expect(body.params.arguments.content).toBe('Hello Teams!');

            await bot.stop();
        });

        it('should include replyToId when provided', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

            const bot = createBot();
            await bot.start();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    result: { content: [{ type: 'text', text: '{"messageId":"msg-002"}' }] },
                }),
            } as any);

            await bot.send('channel-1', 'Reply!', { replyToId: 'msg-parent' });

            const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
            const body = JSON.parse(lastCall[1].body);
            expect(body.params.arguments.replyToMessageId).toBe('msg-parent');

            await bot.stop();
        });

        it('should throw when not connected', async () => {
            const bot = createBot();
            await expect(bot.send('channel-1', 'Hello')).rejects.toThrow('TeamsBot is not connected');
        });
    });

    describe('listChannels', () => {
        it('should call list_channels tool', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

            const bot = createBot();
            await bot.start();

            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify([
                                { id: 'ch-1', displayName: 'General' },
                                { id: 'ch-2', displayName: 'Dev' },
                            ]),
                        }],
                    },
                }),
            } as any);

            const channels = await bot.listChannels();
            expect(channels).toHaveLength(2);
            expect(channels[0].displayName).toBe('General');

            await bot.stop();
        });

        it('should throw when not connected', async () => {
            const bot = createBot();
            await expect(bot.listChannels()).rejects.toThrow('TeamsBot is not connected');
        });
    });

    describe('polling', () => {
        it('should poll for messages when channelId is set', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

            const bot = createBot();
            await bot.start();
            bot.setChannelId('channel-1');

            // Mock poll response with messages
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify([
                                { id: 'msg-100', text: 'Hello from Teams', senderName: 'Alice' },
                            ]),
                        }],
                    },
                }),
            } as any);

            // Advance timer to trigger poll
            await vi.advanceTimersByTimeAsync(1000);

            expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
                channelId: 'channel-1',
                messageId: 'msg-100',
                text: 'Hello from Teams',
                senderName: 'Alice',
            }));

            await bot.stop();
        });

        it('should skip messages sent by the bot itself', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

            const bot = createBot();
            await bot.start();
            bot.setChannelId('channel-1');

            // Send a message first (to register sent ID)
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    result: { content: [{ type: 'text', text: '{"messageId":"msg-sent"}' }] },
                }),
            } as any);
            await bot.send('channel-1', 'Bot message');

            // Poll returns the bot's own message
            mockFetch.mockResolvedValueOnce({
                ok: true,
                headers: new Map(),
                json: async () => ({
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify([{ id: 'msg-sent', text: 'Bot message' }]),
                        }],
                    },
                }),
            } as any);

            await vi.advanceTimersByTimeAsync(1000);

            // Should NOT call onMessage for bot's own message
            expect(onMessage).not.toHaveBeenCalled();

            await bot.stop();
        });

        it('should not poll when no channelId is set', async () => {
            mockMcpResponse({ protocolVersion: '2025-03-26', capabilities: {} });

            const bot = createBot();
            await bot.start();
            // No setChannelId call

            await vi.advanceTimersByTimeAsync(1000);

            // Only the initialize call, no poll call
            expect(mockFetch).toHaveBeenCalledTimes(1);

            await bot.stop();
        });
    });

    describe('setChannelId / getChannelId', () => {
        it('should store and retrieve channel ID', () => {
            const bot = createBot();
            expect(bot.getChannelId()).toBeNull();
            bot.setChannelId('ch-xyz');
            expect(bot.getChannelId()).toBe('ch-xyz');
        });
    });
});
