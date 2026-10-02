import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from '../../src/teams/mcp/mcp-client';
import { McpTransport } from '../../src/teams/mcp/transport-mcp';
import { GraphCredentialStore } from '../../src/teams/graph/graph-credential';
import { GraphClient } from '../../src/teams/graph/graph-client';
import { GraphOperations } from '../../src/teams/graph/operations-graph';
import { TeamsOperationError } from '../../src/teams/operations';

const account = { tenantId: '11111111-1111-4111-8111-111111111111', objectId: '22222222-2222-4222-8222-222222222222' };
const claims = {
    tid: account.tenantId, oid: account.objectId, aud: 'https://graph.microsoft.com',
    scp: 'ChannelMessage.Send', exp: Math.floor(Date.now() / 1000) + 3600,
};
const token = (patch: Record<string, unknown> = {}) =>
    `header.${Buffer.from(JSON.stringify({ ...claims, ...patch })).toString('base64url')}.signature`;
const routes = { channelSend: 'graph', channelReply: 'graph' } as const;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function setup(acquireToken = vi.fn(async () => token())) {
    vi.spyOn(McpClient.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(McpClient.prototype, 'listTools').mockResolvedValue({ tools: [] });
    const callTool = vi.spyOn(McpClient.prototype, 'callTool').mockResolvedValue({
        content: [{ type: 'text', text: '[]' }],
    });
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
        new Response(JSON.stringify({ id: 'graph-message' }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const transport = new McpTransport('https://example.test/mcp', undefined, undefined, undefined, false, undefined, {
        routes, graphOutboundOptions: { acquireToken },
    });
    return { transport, acquireToken, fetch, callTool };
}

describe('MCP reader with explicit Graph outbound', () => {
    it.each(['ChannelMessage.Send', 'User.Read Group.ReadWrite.All'])(
        'keeps MCP reads and Graph send/reply IDs with supported delegated scopes %s', async scp => {
        const { transport, fetch, callTool } = setup(vi.fn(async () => token({ scp })));
        await transport.initialize(token({ aud: 'mcp' }), { teamId: 'team-id' });
        expect(await transport.send('channel-id', '<b>AI: answer</b>')).toBe('graph-message');
        expect(await transport.send('channel-id', '<b>AI: reply</b>', { replyToId: 'root-id' })).toBe('graph-message');
        expect(fetch.mock.calls.map(call => call[0])).toEqual([
            'https://graph.microsoft.com/v1.0/teams/team-id/channels/channel-id/messages',
            'https://graph.microsoft.com/v1.0/teams/team-id/channels/channel-id/messages/root-id/replies',
        ]);
        await transport.poll('channel-id');
        expect(callTool).toHaveBeenCalledWith('ListChannelMessages', expect.objectContaining({ teamId: 'team-id', channelId: 'channel-id' }), undefined);
        expect(callTool.mock.calls.every(call => !/Send|Reply/.test(call[0]))).toBe(true);
        transport.stop();
    });

    it.each([403, 404, 429, 500])('never falls back to MCP after Graph HTTP %s', async status => {
        const { transport, fetch, callTool } = setup();
        await transport.initialize(token(), { teamId: 'team-id' });
        fetch.mockImplementation(async () => new Response(null, { status }));
        await expect(transport.send('channel-id', 'AI: answer')).rejects.toMatchObject({
            backend: 'graph', outcome: status === 500 ? 'unknown' : 'rejected',
        });
        await expect(transport.send('channel-id', 'AI: answer', { replyToId: 'root-id' })).rejects.toMatchObject({ backend: 'graph' });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(callTool).not.toHaveBeenCalled();
        transport.stop();
    });

    it('rejects a mismatched account before any write', async () => {
        const { transport, fetch, callTool } = setup(vi.fn(async () => token({ oid: account.tenantId })));
        await expect(transport.initialize(token(), { teamId: 'team-id' })).rejects.toMatchObject({
            backend: 'graph', code: 'authentication', outcome: 'not-attempted',
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(callTool).not.toHaveBeenCalled();
        transport.stop();
    });

    it('quarantines a network failure without replay or fallback', async () => {
        const { transport, fetch, callTool } = setup();
        await transport.initialize(token(), { teamId: 'team-id' });
        fetch.mockRejectedValueOnce(new Error('connection lost'));
        await expect(transport.send('channel-id', 'AI: answer', { replyToId: 'root-id' }))
            .rejects.toMatchObject({ backend: 'graph', outcome: 'unknown' });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(callTool).not.toHaveBeenCalled();
        transport.stop();
    });

    it('refreshes only a definitive 401 and rejects a changed identity without another write', async () => {
        const acquireToken = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(token({ oid: 'other-object' }));
        const { transport, fetch, callTool } = setup(acquireToken);
        await transport.initialize(token(), { teamId: 'team-id' });
        fetch.mockImplementationOnce(async () => new Response(null, { status: 401 }));
        await expect(transport.send('channel-id', 'AI: answer')).rejects.toMatchObject({
            code: 'authentication', outcome: 'not-attempted', backend: 'graph',
        });
        expect(acquireToken).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(callTool).not.toHaveBeenCalled();
        transport.stop();
    });

    it('cancels credential acquisition on stop without late dispatch', async () => {
        let release!: (value: string) => void;
        const pending = new Promise<string>(resolve => { release = resolve; });
        const { transport, acquireToken, fetch } = setup(vi.fn(() => pending));
        const start = transport.initialize(token(), { teamId: 'team-id' });
        const rejection = expect(start).rejects.toMatchObject({ outcome: 'not-attempted' });
        await vi.waitFor(() => expect(acquireToken).toHaveBeenCalled());
        transport.stop();
        await rejection;
        release(token());
        await Promise.resolve();
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['initialize', 'listTools'] as const)('rejects stale MCP %s completion without replacing restarted Graph operations', async stage => {
        const s = setup();
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        if (stage === 'initialize') {
            vi.mocked(McpClient.prototype.initialize).mockImplementationOnce(() => pending);
        } else {
            vi.mocked(McpClient.prototype.listTools).mockImplementationOnce(async () => {
                await pending;
                return { tools: [] };
            });
        }
        const starting = s.transport.initialize(token(), { teamId: 'old-team' });
        const rejection = expect(starting).rejects.toThrow();
        if (stage === 'listTools') {
            await vi.waitFor(() => expect(McpClient.prototype.listTools).toHaveBeenCalledOnce());
        }
        s.transport.stop();
        await s.transport.initialize(token(), { teamId: 'new-team' });
        const operations = s.transport.operations;
        release();
        await rejection;
        expect(s.transport.operations).toBe(operations);
        expect(s.acquireToken).toHaveBeenCalledOnce();
        expect(await s.transport.send('channel-id', 'answer')).toBe('graph-message');
        expect(s.fetch.mock.calls[0][0]).toContain('/teams/new-team/');
        s.transport.stop();
    });
});

describe('Graph channel credentials', () => {
    it.each(['read', 'write'] as const)('cancels an uncooperative %s provider without caching late credentials', async purpose => {
        let release!: (value: string) => void;
        const acquireToken = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
        const credentials = new GraphCredentialStore(account, { acquireToken }, purpose);
        const controller = new AbortController();
        const getting = credentials.get(controller.signal);
        const rejection = expect(getting).rejects.toMatchObject({
            backend: 'graph', code: 'authentication', outcome: 'not-attempted',
            message: expect.stringContaining('cancelled'),
        });
        controller.abort();
        // Cancellation must settle even if the provider never settles.
        await rejection;
        const value = token({ scp: 'ChannelMessage.Read.All ChannelMessage.Send' });
        release(value);
        await Promise.resolve();
        acquireToken.mockImplementation(async () => value);
        await expect(credentials.get(new AbortController().signal)).resolves.toBe(value);
        expect(acquireToken).toHaveBeenCalledTimes(2);
    });

    it('gives actionable Azure CLI sign-in guidance without exposing provider errors', async () => {
        const credentials = new GraphCredentialStore(account, { acquireToken: async () => {
            throw new Error('sensitive provider response');
        } });
        const error = await credentials.get(new AbortController().signal).catch(error => error);
        expect(error).toMatchObject({ backend: 'graph', code: 'authentication', outcome: 'not-attempted' });
        expect(error.message).toContain('run az login on the server host with the MCP reader account, then reconnect');
        expect(error.message).not.toContain('sensitive provider response');
        expect(error.message).not.toContain('ChannelMessage.Read.All');
    });

    it.each([
        [{ aud: 'mcp' }, 'audience'],
        [{ exp: 0 }, 'expiry'],
        [{ scp: 'User.Read' }, 'Request least-privilege ChannelMessage.Send consent for new Entra public clients'],
        [{ scp: undefined, roles: ['ChannelMessage.Send'] }, 'delegated'],
        [{ scp: undefined, roles: ['Group.ReadWrite.All'] }, 'delegated'],
        [{ scp: 'Group.Read.All' }, 'delegated'],
        [{ tid: 'other-tenant' }, 'mismatch'],
        [{ oid: 'other-object' }, 'mismatch'],
    ])('rejects invalid claims %j', async (patch, message) => {
        const credentials = new GraphCredentialStore(account, { acquireToken: async () => token(patch) });
        await expect(credentials.get(new AbortController().signal)).rejects.toThrow(message);
    });

    it('requires a readable MCP identity before acquiring Graph credentials', async () => {
        const acquireToken = vi.fn(async () => token());
        await expect(new GraphCredentialStore(undefined, { acquireToken }).get(new AbortController().signal))
            .rejects.toThrow('MCP reader tenant/object identity');
        expect(acquireToken).not.toHaveBeenCalled();
    });

    it('validates refreshed credentials against the original account and caches only valid credentials', async () => {
        const acquireToken = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(token({ oid: 'other-object' }));
        const credentials = new GraphCredentialStore(account, { acquireToken });
        const signal = new AbortController().signal;
        await credentials.get(signal);
        await credentials.get(signal);
        expect(acquireToken).toHaveBeenCalledTimes(1);
        await expect(credentials.get(signal, true)).rejects.toThrow('mismatch');
    });

    it('does not dispatch after disposal during per-write credential refresh', async () => {
        let release!: (value: string) => void;
        const pending = new Promise<string>(resolve => { release = resolve; });
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const acquireToken = vi.fn(() => pending);
        const operations = new GraphOperations({
            connectionId: 'connection-id', client: new GraphClient({ bearerToken: 'unused' }), acquireToken,
        });
        const sending = operations.send({ kind: 'channel', teamId: 'team-id', channelId: 'channel-id' },
            { content: 'AI: answer', contentType: 'text' });
        const rejection = expect(sending).rejects.toMatchObject({ outcome: 'not-attempted' });
        await vi.waitFor(() => expect(acquireToken).toHaveBeenCalled());
        await operations.dispose();
        await rejection;
        release(token());
        await Promise.resolve();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('bounds credential acquisition before dispatch and rejects late credentials', async () => {
        vi.useFakeTimers();
        let release!: (value: string) => void;
        const pending = new Promise<string>(resolve => { release = resolve; });
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const operations = new GraphOperations({
            connectionId: 'connection-id', client: new GraphClient({ bearerToken: 'unused' }),
            acquireToken: () => pending, timeoutMs: 100,
        });
        const sending = operations.send({ kind: 'channel', teamId: 'team-id', channelId: 'channel-id' },
            { content: 'AI: answer', contentType: 'text' });
        const rejection = expect(sending).rejects.toMatchObject({ code: 'timeout', outcome: 'not-attempted' });
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
        release(token());
        await Promise.resolve();
        expect(fetch).not.toHaveBeenCalled();
        await operations.dispose();
    });

    it('keeps credential failures typed and definitely unsent', async () => {
        const error = new TeamsOperationError('Graph credential unavailable', 'graph', 'authentication', 'not-attempted');
        const operations = new GraphOperations({ connectionId: 'connection-id',
            client: new GraphClient({ bearerToken: 'unused' }), acquireToken: async () => { throw error; } });
        await expect(operations.send({ kind: 'channel', teamId: 'team-id', channelId: 'channel-id' },
            { content: 'AI: answer', contentType: 'text' })).rejects.toBe(error);
        await operations.dispose();
    });
});
