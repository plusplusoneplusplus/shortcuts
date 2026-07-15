/**
 * Tests for GraphClient — Microsoft Graph API transport.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GraphClient } from '../../src/teams/graph-client';

describe('GraphClient', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    function createClient(opts?: Partial<ConstructorParameters<typeof GraphClient>[0]>) {
        return new GraphClient({
            bearerToken: 'test-token',
            teamId: 'team-abc',
            channelId: '19:channel@thread.tacv2',
            ...opts,
        });
    }

    describe('postChannelMessage', () => {
        it('should POST to the correct Graph endpoint', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'msg-001', body: { content: 'Hello!' } }),
            } as any);

            const client = createClient();
            const msgId = await client.postChannelMessage('Hello!');

            expect(msgId).toBe('msg-001');
            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [url, opts] = mockFetch.mock.calls[0];
            expect(url).toContain('/teams/team-abc/channels/');
            expect(url).toContain('/messages');
            expect(opts.method).toBe('POST');
            expect(opts.headers['Authorization']).toBe('Bearer test-token');
            const body = JSON.parse(opts.body);
            expect(body.body.content).toBe('Hello!');
        });

        it('should throw when no channelId configured', async () => {
            const client = createClient({ channelId: undefined });
            await expect(client.postChannelMessage('Hi')).rejects.toThrow('No channelId configured');
        });

        it('should throw on non-ok response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                text: async () => 'Forbidden',
            } as any);

            const client = createClient();
            await expect(client.postChannelMessage('Hi')).rejects.toThrow('Graph API POST 403');
        });
    });

    describe('replyToChannelMessage', () => {
        it('should POST to the replies endpoint', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'reply-001' }),
            } as any);

            const client = createClient();
            const msgId = await client.replyToChannelMessage('parent-msg', 'Reply text');

            expect(msgId).toBe('reply-001');
            const [url] = mockFetch.mock.calls[0];
            expect(url).toContain('/messages/parent-msg/replies');
        });
    });

    describe('postChatMessage', () => {
        it('should POST to the chat messages endpoint', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'chat-msg-001' }),
            } as any);

            const client = createClient({ chatId: 'chat-xyz' });
            const msgId = await client.postChatMessage('Chat message');

            expect(msgId).toBe('chat-msg-001');
            const [url] = mockFetch.mock.calls[0];
            expect(url).toContain('/chats/chat-xyz/messages');
        });

        it('should throw when no chatId configured', async () => {
            const client = createClient();
            await expect(client.postChatMessage('Hi')).rejects.toThrow('No chatId configured');
        });
    });

    describe('listChannelMessages', () => {
        it('should GET channel messages with filter', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    value: [
                        { id: 'msg-1', body: { content: 'Hello' }, createdDateTime: '2026-05-19T00:00:00Z' },
                        { id: 'msg-2', body: { content: 'World' }, createdDateTime: '2026-05-19T00:01:00Z' },
                    ],
                }),
            } as any);

            const client = createClient();
            const messages = await client.listChannelMessages({ top: 10, filter: 'createdDateTime gt 2026-05-18T00:00:00Z' });

            expect(messages).toHaveLength(2);
            expect(messages[0].id).toBe('msg-1');

            const [url] = mockFetch.mock.calls[0];
            expect(url).toContain('top=10');
            expect(url).toContain('filter=');
        });
    });

    describe('listChannels', () => {
        it('should GET team channels', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    value: [
                        { id: 'ch-1', displayName: 'General' },
                        { id: 'ch-2', displayName: 'Dev' },
                    ],
                }),
            } as any);

            const client = createClient();
            const channels = await client.listChannels();

            expect(channels).toHaveLength(2);
            expect(channels[0].displayName).toBe('General');
            const [url] = mockFetch.mock.calls[0];
            expect(url).toContain('/teams/team-abc/channels');
        });
    });

    describe('verifyConnection', () => {
        it('should GET team info', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'team-abc', displayName: 'My Team' }),
            } as any);

            const client = createClient();
            await expect(client.verifyConnection()).resolves.toBeUndefined();
            const [url] = mockFetch.mock.calls[0];
            expect(url).toBe('https://graph.microsoft.com/v1.0/teams/team-abc');
        });

        it('should throw on failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => 'Unauthorized',
            } as any);

            const client = createClient();
            await expect(client.verifyConnection()).rejects.toThrow('Graph API GET 401');
        });
    });

    describe('setBearerToken', () => {
        it('should update the token used in requests', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'team-abc' }),
            } as any);

            const client = createClient();
            client.setBearerToken('new-token');
            await client.verifyConnection();

            const [, opts] = mockFetch.mock.calls[0];
            expect(opts.headers['Authorization']).toBe('Bearer new-token');
        });
    });
});
