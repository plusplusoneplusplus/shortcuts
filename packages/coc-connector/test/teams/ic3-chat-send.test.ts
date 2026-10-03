import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ic3Operations, type Ic3OperationsOptions } from '../../src/teams/ic3/operations-ic3';
import { Ic3DirectMessageClient } from '../../src/teams/ic3/ic3-direct-message';
import { TeamsBot, createTransport } from '../../src/teams/bot';
import { acquireTokenViaAzCli } from '../../src/teams/auth';
import type { TeamsDestination } from '../../src/teams/operations';

vi.mock('../../src/teams/auth', () => ({ acquireTokenViaAzCli: vi.fn() }));

const objectId = '00000000-0000-0000-0000-000000000001';
const tenantId = '00000000-0000-0000-0000-000000000002';
const recipientId = '00000000-0000-0000-0000-000000000003';
const chatId = '19:existing-direct@thread.v2';
const connectionId = 'connection-one';
const destination = { kind: 'chat' as const, chatId, recipientId, connectionId };
const body = { content: 'a < b & c\nC:\\fixture', contentType: 'text' as const };
const metadata = { chatId, chatType: 'oneOnOne', memberIds: [objectId, recipientId], connectionId };
const fetchMock = vi.fn<typeof fetch>();

function token(claims: Record<string, unknown> = {}): string {
    return `header.${Buffer.from(JSON.stringify({
        aud: 'https://ic3.teams.office.com', exp: Math.floor(Date.now() / 1000) + 3600,
        oid: objectId, tid: tenantId, name: 'Test Account', ...claims,
    })).toString('base64url')}.signature`;
}

function setup(options: Partial<Ic3OperationsOptions> = {}) {
    const acquireToken = vi.fn(async () => token());
    const verifyChat = vi.fn(async (_chatId: string, _signal: AbortSignal) => metadata);
    const operations = new Ic3Operations({
        region: 'emea', connectionId,
        expectedAccount: { tenantId, objectId }, acquireToken, verifyChat, ...options,
    });
    return { operations, acquireToken, verifyChat };
}

beforeEach(() => {
    fetchMock.mockReset().mockImplementation(async () => Response.json({ OriginalArrivalTime: '123' }, { status: 201 }));
    vi.mocked(acquireTokenViaAzCli).mockReset().mockResolvedValue(token());
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('IC3 existing ordinary 1:1 writes', () => {
    it('sends verified ordinary DMs without a flag while preserving self sends', async () => {
        const { operations, verifyChat } = setup();
        await operations.send(destination, body);
        expect(verifyChat).toHaveBeenCalledOnce();
        verifyChat.mockClear();
        await operations.send({ kind: 'self' }, body);
        expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).conversationid).toBe('48:notes');
        expect(verifyChat).not.toHaveBeenCalled();
    });

    it('allows self sends independently of ordinary chat verification', async () => {
        const { operations } = setup();
        await expect(operations.send({ kind: 'self' }, body)).resolves.toMatchObject({ outcome: 'accepted' });
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).conversationid).toBe('48:notes');
    });

    it.each(['text', 'html'] as const)('verifies before one exact POST and preserves %s semantics', async contentType => {
        const { operations, verifyChat, acquireToken } = setup();
        const receipt = await operations.send(destination, { ...body, contentType });
        expect(receipt).toEqual({ outcome: 'accepted', message: {
            backend: 'ic3', connectionId, destination, messageId: '123',
        } });
        expect(verifyChat).toHaveBeenCalledExactlyOnceWith(chatId, expect.any(AbortSignal));
        expect(acquireToken).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations/${encodeURIComponent(chatId)}/messages`);
        expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal: verifyChat.mock.calls[0][1] });
        expect(JSON.parse(String(init?.body))).toMatchObject({
            conversationid: chatId, conversationLink: `blah/${chatId}`, from: `8:orgid:${objectId}`,
            fromUserId: `8:orgid:${objectId}`, messagetype: 'RichText/Html', contenttype: 'Text',
            content: contentType === 'html' ? body.content : 'a &lt; b &amp; c<br>C:\\fixture',
            properties: { mentions: '[]', formatVariant: 'TEAMS' },
        });
    });

    it.each([
        { chatId: '' }, { chatId: ' ' }, { chatId: '48:notes' }, { chatId: '19:channel@thread.tacv2' },
        { chatId: '19:bad/path@thread.v2' }, { connectionId: 'connection-two' },
        { connectionId: undefined }, { recipientId: undefined }, { recipientId: 'invalid' },
    ])('rejects invalid explicit destination %j without dispatch', async patch => {
        const { operations, verifyChat, acquireToken } = setup();
        await expect(operations.send({ ...destination, ...patch }, body)).rejects.toMatchObject({ outcome: 'not-attempted' });
        expect(verifyChat).not.toHaveBeenCalled();
        expect(acquireToken).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        { chatType: 'group' }, { chatType: 'meeting' }, { chatId: '19:other@thread.v2' },
        { connectionId: 'stale-connection' }, { memberIds: [objectId] },
        { memberIds: [objectId, objectId] }, { memberIds: [recipientId, tenantId] },
        { memberIds: [objectId, tenantId] }, { memberIds: [objectId, recipientId, tenantId] },
    ])('rejects unproven type, recipient, ownership or connection %j', async patch => {
        const { operations } = setup({ verifyChat: async () => ({ ...metadata, ...patch }) });
        await expect(operations.send(destination, body)).rejects.toMatchObject({ code: 'invalid-target', outcome: 'not-attempted' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a self recipient and a spoofed self destination', async () => {
        const { operations } = setup();
        await expect(operations.send({ ...destination, recipientId: objectId }, body))
            .rejects.toMatchObject({ code: 'invalid-target', outcome: 'not-attempted' });
        const spoof: TeamsDestination & { chatId: string } = { kind: 'self', chatId };
        await expect(operations.send(spoof, body)).rejects.toMatchObject({ code: 'invalid-target', outcome: 'not-attempted' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([undefined, []])('requires verification/account and rejects unsupported options', async mentions => {
        const { operations } = setup(mentions === undefined ? { expectedAccount: undefined } : {});
        const pending = operations.send(destination, { ...body, mentions });
        await expect(pending).rejects.toMatchObject({ outcome: 'not-attempted' });
        expect(fetchMock).not.toHaveBeenCalled();
        await expect(operations.reply({
            destination, messageId: 'parent', backend: 'ic3', connectionId,
        }, body)).rejects.toMatchObject({ code: 'unsupported', outcome: 'not-attempted' });
    });

    it('requires a verifier, rejects raw IDs and low-level reply options', async () => {
        const { operations } = setup({ verifyChat: undefined });
        await expect(operations.send(destination, body)).rejects.toMatchObject({ outcome: 'not-attempted' });
        const client = new Ic3DirectMessageClient({
            region: 'amer', connectionId, expectedAccount: { tenantId, objectId },
            verifyChat: async () => metadata,
        });
        await expect(client.send(chatId, 'message')).rejects.toMatchObject({ outcome: 'not-attempted' });
        await expect(client.send(destination, 'message', { replyToId: 'parent' }))
            .rejects.toMatchObject({ outcome: 'not-attempted' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        { aud: 'https://graph.microsoft.com' }, { exp: 0 }, { oid: recipientId },
        { tid: recipientId }, { name: undefined }, { oid: undefined }, { tid: undefined },
    ])('preserves credential checks %j', async claims => {
        const { operations, verifyChat } = setup({ acquireToken: async () => token(claims) });
        await expect(operations.send(destination, body)).rejects.toMatchObject({ code: 'authentication', outcome: 'not-attempted' });
        expect(verifyChat).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires region before verification or credentials', async () => {
        const { operations, verifyChat, acquireToken } = setup({ region: undefined });
        await expect(operations.send(destination, body)).rejects.toMatchObject({ code: 'configuration', outcome: 'not-attempted' });
        expect(verifyChat).not.toHaveBeenCalled();
        expect(acquireToken).not.toHaveBeenCalled();
    });

    it.each([401, 403, 429, 408, 500, 'network', 'receipt'])('never replays definitive or ambiguous failure %s', async failure => {
        const { operations, verifyChat } = setup();
        if (failure === 'network') fetchMock.mockRejectedValue(new Error('private diagnostic'));
        else if (failure === 'receipt') fetchMock.mockResolvedValue(Response.json({ OriginalArrivalTime: 'bad' }));
        else fetchMock.mockResolvedValue(new Response('private diagnostic', { status: failure }));
        const pending = operations.send(destination, body);
        await expect(pending).rejects.toMatchObject({
            backend: 'ic3', outcome: typeof failure === 'number' && [401, 403, 429].includes(failure) ? 'rejected' : 'unknown',
        });
        await expect(pending).rejects.not.toThrow('private diagnostic');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(verifyChat).toHaveBeenCalledOnce();
    });

    it.each(['cancel', 'dispose', 'deadline'] as const)('bounds verification and prevents late writes on %s', async event => {
        const caller = new AbortController();
        const deadline = new AbortController();
        if (event === 'deadline') vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
        let resolve!: (result: typeof metadata) => void;
        const verifyChat = vi.fn(() => new Promise<typeof metadata>(done => { resolve = done; }));
        const { operations } = setup({ verifyChat });
        const pending = operations.send(destination, body, { signal: caller.signal });
        await vi.waitFor(() => expect(verifyChat).toHaveBeenCalledOnce());
        if (event === 'cancel') caller.abort();
        else if (event === 'dispose') await operations.dispose();
        else deadline.abort();
        await expect(pending).rejects.toMatchObject({ outcome: 'not-attempted', code: event === 'deadline' ? 'timeout' : 'unavailable' });
        resolve(metadata);
        await Promise.resolve();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cancels after dispatch as unknown without retry', async () => {
        const { operations } = setup();
        fetchMock.mockImplementation(() => new Promise(() => {}));
        const pending = operations.send(destination, body);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        await operations.dispose();
        await expect(pending).rejects.toMatchObject({ outcome: 'unknown' });
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});

function mockMcp(chat: unknown = { id: chatId, chatType: 'oneOnOne' },
    members: unknown = { members: [{ userId: objectId }, { userId: recipientId }] },
    tools = ['GetChat', 'ListChatMembers', 'SendMessageToSelf', 'SendMessageToChannel', 'ReplyToChannelMessage']) {
    fetchMock.mockImplementation(async (url, init) => {
        if (String(url).includes('/chatsvc/')) return Response.json({ OriginalArrivalTime: '123' }, { status: 201 });
        const request = JSON.parse(String(init?.body));
        if (request.method === 'initialize') return Response.json({ result: { protocolVersion: '2025-03-26' } });
        if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
        if (request.method === 'tools/list') return Response.json({ result: { tools: tools.map(name => ({ name })) } });
        const result = request.params.name === 'GetChat' ? chat
            : request.params.name === 'ListChatMembers' ? members : { id: 'sent', chatId: '19:self@thread.v2' };
        return Response.json({ result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    });
}

describe('MCP verification and CoC connector routing', () => {
    it('wires TeamsBot typed sends without changing channel posts, replies, Likes or self routing', async () => {
        mockMcp();
        const bot = new TeamsBot({
            mode: 'mcp', mcpServerUrl: 'https://mcp.example.test', teamId: 'team',
            operationRoutes: { chatSend: 'ic3' }, ic3DirectMessageOptions: { region: 'apac' },
            auth: { bearerToken: token({ aud: 'mcp-resource' }) }, onMessage: async () => {},
        });
        await bot.start();
        try {
            fetchMock.mockClear();
            const target = { ...destination, connectionId: bot.getConnectionId() };
            await expect(bot.sendMessage(target, body)).resolves.toMatchObject({ message: { backend: 'ic3' } });
            const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
            expect(requests.slice(0, 2).map(request => request.params)).toEqual([
                { name: 'GetChat', arguments: { chatId } }, { name: 'ListChatMembers', arguments: { chatId } },
            ]);
            expect(requests[2].conversationid).toBe(chatId);
            expect(fetchMock.mock.calls[2][0]).toContain('/chatsvc/apac/');
            await bot.send('channel', 'post');
            await bot.send('channel', 'reply', { replyToId: 'root' });
            await bot.sendMessage({ kind: 'self' }, body);
            expect(fetchMock.mock.calls.slice(3).map(([, init]) => JSON.parse(String(init?.body)).params.name))
                .toEqual(['SendMessageToChannel', 'ReplyToChannelMessage', 'SendMessageToSelf']);
        } finally { await bot.stop(); }
    });

    it.each([
        [{ id: chatId, chatType: 'group' }, { members: [{ userId: objectId }, { userId: recipientId }] }],
        [{ id: chatId, chatType: 'oneOnOne' }, { members: [{ userId: objectId }, { userId: recipientId }], hasMoreResults: true }],
        [{ id: chatId, chatType: 'oneOnOne' }, { members: [{ userId: objectId }, { id: recipientId }] }],
        [{ id: chatId }, []],
    ])('does not infer type or membership from plausible IDs %#', async (chat, members) => {
        mockMcp(chat, members);
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { chatSend: 'ic3' }, ic3DirectMessageOptions: { region: 'amer' },
        });
        await transport.initialize(token({ aud: 'mcp-resource' }), { teamId: 'team' });
        fetchMock.mockClear();
        await expect(transport.operations.send({ ...destination, connectionId: transport.connectionId }, body))
            .rejects.toMatchObject({ outcome: 'not-attempted' });
        expect(fetchMock.mock.calls.every(([url]) => String(url) === 'https://mcp.example.test')).toBe(true);
        transport.stop();
    });

    it('surfaces missing MCP access without requesting Graph scopes or falling back', async () => {
        mockMcp(undefined, undefined, []);
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { chatSend: 'ic3' }, ic3DirectMessageOptions: { region: 'amer' },
        });
        await transport.initialize(token({ aud: 'mcp-resource' }), { teamId: 'team' });
        fetchMock.mockClear();
        await expect(transport.operations.send({ ...destination, connectionId: transport.connectionId }, body))
            .rejects.toMatchObject({ outcome: 'not-attempted', message: expect.stringContaining('GetChat and ListChatMembers access') });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(acquireTokenViaAzCli).toHaveBeenCalledExactlyOnceWith('https://ic3.teams.office.com', expect.any(AbortSignal));
        transport.stop();
    });

    it.each([401, 403, 404])('does not recover/replay denied verification reads (HTTP %s)', async status => {
        mockMcp();
        const refresh = vi.fn(async () => token({ aud: 'mcp-resource' }));
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { chatSend: 'ic3' }, onTokenRefresh: refresh,
            ic3DirectMessageOptions: { region: 'amer' },
        });
        await transport.initialize(token({ aud: 'mcp-resource' }), { teamId: 'team' });
        fetchMock.mockClear().mockResolvedValue(new Response('private diagnostic', { status }));
        const pending = transport.operations.send({ ...destination, connectionId: transport.connectionId }, body);
        await expect(pending).rejects.toMatchObject({ code: 'unavailable', outcome: 'not-attempted' });
        await expect(pending).rejects.not.toThrow('private diagnostic');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(refresh).not.toHaveBeenCalled();
        transport.stop();
    });

    it('never falls back to MCP after an ambiguous IC3 POST', async () => {
        mockMcp();
        const handler = fetchMock.getMockImplementation()!;
        fetchMock.mockImplementation((url, init) => String(url).includes('/chatsvc/')
            ? Promise.reject(new Error('private diagnostic')) : handler(url, init));
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { chatSend: 'ic3' },
            ic3DirectMessageOptions: { region: 'amer' },
        });
        await transport.initialize(token({ aud: 'mcp-resource' }), { teamId: 'team' });
        fetchMock.mockClear();
        await expect(transport.operations.send({ ...destination, connectionId: transport.connectionId }, body))
            .rejects.toMatchObject({ code: 'network', outcome: 'unknown' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/chatsvc/'))).toHaveLength(1);
        expect(fetchMock.mock.calls.slice(0, 2).map(([, init]) => JSON.parse(String(init?.body)).params.name))
            .toEqual(['GetChat', 'ListChatMembers']);
        transport.stop();
    });

    it('cancels verification on reinitialize even when the replacement account is rejected', async () => {
        mockMcp();
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { chatSend: 'ic3' },
            ic3DirectMessageOptions: { region: 'amer' },
        });
        await transport.initialize(token({ aud: 'mcp-resource' }), { teamId: 'team' });
        const old = transport.operations;
        fetchMock.mockClear().mockImplementation(() => new Promise(() => {}));
        const pending = old.send({ ...destination, connectionId: transport.connectionId }, body);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        await expect(transport.initialize(token({ oid: recipientId, aud: 'mcp-resource' }), { teamId: 'team' }))
            .rejects.toThrow('account changed');
        await expect(pending).rejects.toMatchObject({ outcome: 'not-attempted' });
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(() => transport.operations).toThrow('not initialized');
        transport.stop();
    });

    it('rejects stale destinations on reconnect and disposed operations on stop', async () => {
        mockMcp();
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { chatSend: 'ic3' }, ic3DirectMessageOptions: { region: 'amer' },
        });
        await transport.initialize(token({ aud: 'mcp-resource' }), { teamId: 'team' });
        const old = transport.operations;
        const stale = { ...destination, connectionId: transport.connectionId };
        transport.stop();
        await transport.initialize(token({ aud: 'mcp-resource' }), { teamId: 'team' });
        fetchMock.mockClear();
        await expect(old.send(stale, body)).rejects.toMatchObject({ outcome: 'not-attempted' });
        await expect(transport.operations.send(stale, body)).rejects.toMatchObject({ code: 'invalid-target', outcome: 'not-attempted' });
        expect(fetchMock).not.toHaveBeenCalled();
        await transport.operations.send({ ...destination, connectionId: transport.connectionId }, body);
        transport.stop();
    });

    it('rejects an IC3 ordinary send route in standalone Graph mode', () => {
        expect(() => createTransport('graph', { operationRoutes: { chatSend: 'ic3' } })).toThrow('require MCP mode');
    });
});
