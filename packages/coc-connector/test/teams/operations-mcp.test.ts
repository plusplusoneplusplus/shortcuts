import { describe, expect, it, vi } from 'vitest';
import { McpClient, McpHttpError } from '../../src/teams/mcp/mcp-client';
import { McpOperations } from '../../src/teams/mcp/operations-mcp';
import { RoutedTeamsOperations, TeamsOperationError, type TeamsOperationRoutes } from '../../src/teams/operations';

const body = { content: 'C:\\workspace\\repo', contentType: 'text' as const };
const channel = { kind: 'channel' as const, teamId: 'team', channelId: 'channel' };
const ref = { destination: channel, messageId: 'reply', rootMessageId: 'root',
    backend: 'mcp' as const, connectionId: 'connection' };
const routes: TeamsOperationRoutes = {
    selfSend: 'mcp', chatSend: 'mcp', channelSend: 'mcp', channelReply: 'mcp', channelLike: 'ic3',
};

function setup(options: Partial<ConstructorParameters<typeof McpOperations>[0]> = {}) {
    const client = {
        callTool: vi.fn<McpClient['callTool']>().mockResolvedValue({
            content: [{ type: 'text', text: '{"id":"sent","chatId":"self-chat"}' }],
        }),
        setBearerToken: vi.fn(),
    };
    return { client, operations: new McpOperations({ connectionId: 'connection', client, ...options }) };
}

describe('MCP outbound operations', () => {
    it('uses exact targets and encodes paths once without assuming every chat is self', async () => {
        const { client, operations } = setup();
        const self = await operations.send({ kind: 'self' }, body);
        const chat = await operations.send({ kind: 'chat', chatId: 'other-chat' }, body);
        await operations.send(channel, body);
        await operations.reply(ref, { ...body, contentType: 'html', mentions: [{ id: 'user', displayName: 'User' }] });
        expect(self).toEqual({ outcome: 'accepted', message: {
            destination: { kind: 'self' }, messageId: 'sent', connectionId: 'connection', backend: 'mcp',
        } });
        expect(chat.message.destination).toEqual({ kind: 'chat', chatId: 'other-chat' });
        expect(client.callTool.mock.calls.map(call => call[0])).toEqual([
            'SendMessageToSelf', 'SendMessageToChat', 'SendMessageToChannel', 'ReplyToChannelMessage',
        ]);
        expect(client.callTool.mock.calls[1][1]).toEqual({
            content: 'C:\\\\workspace\\\\repo', contentType: 'text', chatId: 'other-chat',
        });
        expect(client.callTool.mock.calls[3][1]).toMatchObject({
            teamId: 'team', channelId: 'channel', messageId: 'root', contentType: 'html',
            mentions: [{ id: 0, mentionText: 'User', mentioned: { user: { id: 'user', displayName: 'User' } } }],
        });
        expect(client.callTool.mock.calls.every(call => call[3]?.retryExpiredSession === false)).toBe(true);
    });

    it('rejects missing capabilities and foreign references before dispatch', async () => {
        const { client, operations } = setup({ availableTools: ['SendMessageToSelf'] });
        expect(operations.support({ kind: 'send', destination: channel, body }).supported).toBe(false);
        await expect(operations.send(channel, body)).rejects.toMatchObject({ code: 'unsupported', outcome: 'not-attempted' });
        await expect(operations.reply({ ...ref, connectionId: 'another' }, body))
            .rejects.toMatchObject({ code: 'invalid-target', outcome: 'not-attempted' });
        await expect(operations.reply({ ...ref, backend: 'ic3' }, body)).rejects.toMatchObject({ code: 'unsupported' });
        await expect(operations.send({ kind: 'chat', chatId: '48:notes' }, body)).rejects.toMatchObject({ code: 'invalid-target' });
        expect(client.callTool).not.toHaveBeenCalled();
    });

    it.each(['', 'not json', '{}', '{"id":""}', '{"id":42}'])('treats malformed success %j as unknown', async text => {
        const { client, operations } = setup();
        client.callTool.mockResolvedValue({ content: [{ type: 'text', text }] });
        await expect(operations.send(channel, body)).rejects.toMatchObject({ code: 'protocol', outcome: 'unknown' });
        expect(client.callTool).toHaveBeenCalledOnce();
    });

    it('normalizes tool refusal without leaking the response content', async () => {
        const { client, operations } = setup();
        client.callTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'private response' }] });
        await expect(operations.send(channel, body)).rejects.toMatchObject({
            name: 'TeamsMcpSendRejectedError', message: 'Teams MCP send rejected', outcome: 'rejected',
        });
    });

    it('refreshes and replays once only for a definite transport 401', async () => {
        const refresh = vi.fn(async () => 'new-token');
        const { client, operations } = setup({ onTokenRefresh: refresh });
        client.callTool.mockRejectedValueOnce(new McpHttpError(401, 'Unauthorized'));
        await operations.send(channel, body);
        expect(client.callTool).toHaveBeenCalledTimes(2);
        expect(client.setBearerToken).toHaveBeenCalledWith('new-token');
        expect(refresh).toHaveBeenCalledOnce();
        client.callTool.mockRejectedValue(new McpHttpError(401, 'Unauthorized'));
        await expect(operations.send(channel, body)).rejects.toMatchObject({ code: 'authentication', outcome: 'rejected' });
        expect(client.callTool).toHaveBeenCalledTimes(4);
    });

    it.each([new Error('network 401'), new McpHttpError(500, 'Server error'), new McpHttpError(404, 'Expired')])(
        'never retries ambiguous failure %s', async error => {
            const refresh = vi.fn();
            const { client, operations } = setup({ onTokenRefresh: refresh });
            client.callTool.mockRejectedValue(error);
            await expect(operations.send(channel, body)).rejects.toMatchObject({ outcome: 'unknown' });
            expect(refresh).not.toHaveBeenCalled();
            expect(client.callTool).toHaveBeenCalledOnce();
        },
    );

    it('retains a throttling delay without automatically retrying', async () => {
        const { client, operations } = setup();
        client.callTool.mockRejectedValue(new McpHttpError(429, 'Throttled', 5000));
        await expect(operations.send(channel, body)).rejects.toMatchObject({
            code: 'rate-limited', outcome: 'rejected', retryAfterMs: 5000,
        });
        expect(client.callTool).toHaveBeenCalledOnce();
    });

    it('cancels hung calls and rejects subsequent calls after disposal', async () => {
        const { client, operations } = setup();
        const controller = new AbortController();
        controller.abort();
        await expect(operations.send(channel, body, { signal: controller.signal }))
            .rejects.toMatchObject({ code: 'timeout', outcome: 'not-attempted' });
        expect(client.callTool).not.toHaveBeenCalled();
        client.callTool.mockImplementation(() => new Promise(() => {}));
        const pending = operations.send(channel, body);
        await operations.dispose();
        await expect(pending).rejects.toMatchObject({ code: 'timeout', outcome: 'unknown' });
        await expect(operations.send(channel, body)).rejects.toMatchObject({ code: 'unavailable' });
        expect(client.callTool).toHaveBeenCalledOnce();
    });

    it('never writes if a token refresh resolves after cancellation', async () => {
        let resolve!: (value: string) => void;
        const refresh = vi.fn(() => new Promise<string>(done => { resolve = done; }));
        const { client, operations } = setup({ onTokenRefresh: refresh });
        client.callTool.mockRejectedValueOnce(new McpHttpError(401, 'Unauthorized'));
        const pending = operations.send(channel, body);
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        await operations.dispose();
        await expect(pending).rejects.toMatchObject({ outcome: 'not-attempted' });
        resolve('new-token');
        await Promise.resolve();
        expect(client.callTool).toHaveBeenCalledOnce();
        expect(client.setBearerToken).not.toHaveBeenCalled();
    });
});

describe('operation routing isolation', () => {
    it('snapshots per-owner routes, fails closed on absent backends, and never fails over', async () => {
        const first = setup();
        const second = setup();
        const selected = { ...routes };
        const workspaceOne = new RoutedTeamsOperations(selected, [first.operations]);
        const workspaceTwo = new RoutedTeamsOperations({ ...routes, selfSend: 'ic3' }, [second.operations]);
        selected.selfSend = 'ic3';
        await workspaceOne.send({ kind: 'self' }, body);
        await expect(workspaceTwo.send({ kind: 'self' }, body)).rejects.toMatchObject({ code: 'unavailable' });
        expect(second.client.callTool).not.toHaveBeenCalled();
        first.client.callTool.mockRejectedValue(new Error('lost response'));
        await expect(workspaceOne.send(channel, body)).rejects.toBeInstanceOf(TeamsOperationError);
        expect(first.client.callTool).toHaveBeenCalledTimes(2);
    });

    it('rejects duplicate backends at construction', () => {
        expect(() => new RoutedTeamsOperations(routes, [
            setup().operations, setup().operations,
        ])).toThrow();
    });
});
