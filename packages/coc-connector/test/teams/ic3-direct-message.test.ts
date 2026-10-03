import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ic3DirectMessageClient, TeamsIc3SendError, type Ic3DirectMessageOptions } from '../../src/teams/ic3/ic3-direct-message';
import { acquireTokenViaAzCli } from '../../src/teams/auth';
import { TeamsBot, createTransport } from '../../src/teams/bot';
import { McpTransport } from '../../src/teams/mcp/transport-mcp';

vi.mock('../../src/teams/auth', () => ({ acquireTokenViaAzCli: vi.fn() }));

const resource = 'https://ic3.teams.office.com';
const senderId = '00000000-0000-0000-0000-000000000001';
const tenantId = '00000000-0000-0000-0000-000000000010';
const fetchMock = vi.fn<typeof fetch>();

function token(overrides: Record<string, unknown> = {}): string {
    return `header.${Buffer.from(JSON.stringify({
        aud: resource, exp: Math.floor(Date.now() / 1000) + 3600, oid: senderId, tid: tenantId, name: 'Test User',
        ...overrides,
    })).toString('base64url')}.signature`;
}

function mcpToken(oid = senderId): string {
    return token({ aud: 'mcp-resource', oid });
}

function success(id: string | number = '1790000000123'): Response {
    return Response.json({ OriginalArrivalTime: id }, { status: 201 });
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(acquireTokenViaAzCli).mockReset().mockResolvedValue(token());
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('IC3 verified self-DM send', () => {
    it('rejects an unset region before even the default Azure CLI provider runs', async () => {
        const client = new Ic3DirectMessageClient();
        const pending = client.send('48:notes', 'message');
        await expect(pending).rejects.toBeInstanceOf(TeamsIc3SendError);
        await expect(pending).rejects.toMatchObject({ code: 'configuration', outcome: 'not-attempted' });
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['1790000000123', 1790000000123])('sends the exact envelope and returns exact ID %s', async id => {
        const value = token();
        const acquire = vi.fn(async () => value);
        const client = new Ic3DirectMessageClient({ region: 'amer', acquireToken: acquire });
        fetchMock.mockResolvedValue(success(id));
        const text = '<b>test</b> C:\\workspace\\repo';
        const before = Date.now();
        expect(await client.send('48:notes', text)).toBe(String(id));
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/48%3Anotes/messages');
        expect(init).toMatchObject({
            method: 'POST', redirect: 'error',
            headers: {
                Authorization: `Bearer ${value}`, Accept: 'application/json',
                'Content-Type': 'application/json', behavioroverride: 'redirectAs404',
            },
        });
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
            id: '-1', type: 'Message', conversationid: '48:notes', conversationLink: 'blah/48:notes',
            from: `8:orgid:${senderId}`, fromUserId: `8:orgid:${senderId}`,
            composetime: expect.any(String), originalarrivaltime: body.composetime,
            content: text, messagetype: 'RichText/Html', contenttype: 'Text',
            imdisplayname: 'Test User', clientmessageid: expect.stringMatching(/^\d+$/),
            callId: '', state: 0, version: '0', amsreferences: [],
            properties: {
                importance: '', subject: '', title: '', cards: '[]', links: '[]', mentions: '[]',
                onbehalfof: null, files: '[]', policyViolation: null, formatVariant: 'TEAMS',
            },
        });
        expect(Date.parse(body.composetime)).toBeGreaterThanOrEqual(before);
        expect(Date.parse(body.composetime)).toBeLessThanOrEqual(Date.now());
        expect(BigInt(body.clientmessageid)).toBeLessThanOrEqual(0x7fffffffffffffffn);
        expect(acquire).toHaveBeenCalledWith(init?.signal);
    });

    it('uses a separate Azure CLI IC3 token, caches it, and clears it explicitly', async () => {
        const client = new Ic3DirectMessageClient({ region: 'amer' });
        fetchMock.mockImplementation(async () => success());
        await client.send('48:notes', 'test');
        await client.send('48:notes', 'test');
        expect(acquireTokenViaAzCli).toHaveBeenCalledExactlyOnceWith(resource, expect.any(AbortSignal));
        const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
        expect(bodies[0].clientmessageid).not.toBe(bodies[1].clientmessageid);
        client.clearCredential();
        await client.send('48:notes', 'test');
        expect(acquireTokenViaAzCli).toHaveBeenCalledTimes(2);
    });

    it('derives self sender identity from each current credential after invalidation', async () => {
        const accounts = [
            { oid: senderId, name: 'Test Account One' },
            { oid: '00000000-0000-0000-0000-000000000002', name: 'Test Account Two' },
        ];
        const values = accounts.map(account => token(account));
        const acquire = vi.fn()
            .mockResolvedValueOnce(values[0])
            .mockResolvedValueOnce(values[1]);
        const client = new Ic3DirectMessageClient({ region: 'amer', acquireToken: acquire });
        fetchMock.mockImplementation(async () => success());
        await client.send('48:notes', 'first account');
        client.clearCredential();
        await client.send('48:notes', 'second account');
        for (const [index, [, init]] of fetchMock.mock.calls.entries()) {
            expect(JSON.parse(String(init?.body))).toMatchObject({
                conversationid: '48:notes',
                from: `8:orgid:${accounts[index].oid}`,
                fromUserId: `8:orgid:${accounts[index].oid}`,
                imdisplayname: accounts[index].name,
            });
            expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${values[index]}`);
        }
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
    });

    it('snapshots routing and authentication options at construction', async () => {
        const acquire = vi.fn(async () => token());
        const replacement = vi.fn(async () => token());
        const options = { region: 'emea' as const, acquireToken: acquire };
        const client = new Ic3DirectMessageClient(options);
        Object.assign(options, { region: 'apac', acquireToken: replacement });
        fetchMock.mockResolvedValue(success());
        await client.send('48:notes', 'test');
        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations/48%3Anotes/messages',
        );
        expect(acquire).toHaveBeenCalledOnce();
        expect(replacement).not.toHaveBeenCalled();
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
    });

    it.each(['', 'AMER', 'unknown', '../amer', 'emea?x=1', 'https://example.test', 'amer/../../', null, 1])(
        'rejects invalid region %j before credentials or network, including through TeamsBot', region => {
            const acquire = vi.fn(async () => token());
            const options = { region, acquireToken: acquire } as unknown as Ic3DirectMessageOptions;
            expect(() => new Ic3DirectMessageClient(options)).toThrow('region must be');
            expect(() => new TeamsBot({
                mode: 'mcp', mcpServerUrl: 'https://mcp.example.test',
                operationRoutes: { selfSend: 'ic3' }, ic3DirectMessageOptions: options,
                onMessage: async () => {},
            })).toThrow('region must be');
            expect(acquire).not.toHaveBeenCalled();
            expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
        },
    );

    it('reacquires credentials as they approach expiry', async () => {
        const now = Date.now();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        const acquire = vi.fn(async () => token());
        const client = new Ic3DirectMessageClient({ region: 'amer', acquireToken: acquire });
        fetchMock.mockImplementation(async () => success());
        await client.send('48:notes', 'test');
        clock.mockReturnValue(now + 3_550_000);
        await client.send('48:notes', 'test');
        expect(acquire).toHaveBeenCalledTimes(2);
    });

    it.each([
        '', '19:channel@thread.tacv2', '19:group@thread.v2', '19:direct@thread.v2',
        '48:notes/messages/root', '48:notes;messageid=root', '48:notes ', '48:another',
    ])('rejects unverified, channel, group, or reply target %s before credentials/network', async target => {
        const acquire = vi.fn(async () => token());
        await expect(new Ic3DirectMessageClient({ region: 'amer', acquireToken: acquire }).send(target, 'test')).rejects.toThrow('only self-chat');
        expect(acquire).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([{ replyToId: 'root' }, { replyToId: '' }, { mentions: [] },
        { mentions: [{ aadId: senderId, displayName: 'Test User' }] }])('rejects send options %j', async options => {
        const acquire = vi.fn(async () => token());
        await expect(new Ic3DirectMessageClient({ region: 'amer', acquireToken: acquire }).send('48:notes', 'test', options))
            .rejects.toThrow('without replies or mentions');
        expect(acquire).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['', ' \n'])('rejects empty text before authentication', async text => {
        await expect(new Ic3DirectMessageClient().send('48:notes', text)).rejects.toThrow('nonempty text');
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        { aud: 'https://graph.microsoft.com' }, { aud: 'https://mcp.example.test' },
        { exp: 0 }, { exp: '9999999999' }, { oid: undefined }, { oid: 'invalid' },
        { name: undefined }, { name: ' ' },
    ])('rejects invalid claims %j without making a write', async claims => {
        const client = new Ic3DirectMessageClient({ region: 'amer', acquireToken: async () => token(claims) });
        await expect(client.send('48:notes', 'test')).rejects.toThrow('invalid IC3 credential');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['not-a-token', `header.${Buffer.from('null').toString('base64url')}.signature`])(
        'rejects malformed credentials', async value => {
            await expect(new Ic3DirectMessageClient({ region: 'amer', acquireToken: async () => value }).send('48:notes', 'test'))
                .rejects.toThrow('invalid IC3 credential');
            expect(fetchMock).not.toHaveBeenCalled();
        },
    );

    it('sanitizes credential acquisition failures', async () => {
        const client = new Ic3DirectMessageClient({
            region: 'amer',
            acquireToken: async () => { throw new Error('private credential details 401'); },
        });
        await expect(client.send('48:notes', 'test')).rejects.toThrow('IC3 credential could not be acquired');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
    });

    it.each([401, 403, 429, 500, 503])('does not retry HTTP %s or reveal response bodies', async status => {
        const acquire = vi.fn(async () => token());
        const client = new Ic3DirectMessageClient({ region: 'amer', acquireToken: acquire });
        fetchMock.mockResolvedValueOnce(new Response('private response details', { status }));
        const pending = client.send('48:notes', 'test');
        await expect(pending).rejects.toThrow(`HTTP ${status}`);
        await expect(pending).rejects.toBeInstanceOf(TeamsIc3SendError);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(acquire).toHaveBeenCalledOnce();
        fetchMock.mockResolvedValueOnce(success());
        await client.send('48:notes', 'next explicit send');
        expect(acquire).toHaveBeenCalledTimes(2);
    });

    it.each([undefined, null, '', 'wrong', '12.3', {}, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed success ID %j without retry', async id => {
            const client = new Ic3DirectMessageClient({ region: 'amer', acquireToken: async () => token() });
            fetchMock.mockResolvedValueOnce(Response.json({ OriginalArrivalTime: id }, { status: 201 }));
            await expect(client.send('48:notes', 'test')).rejects.toThrow('invalid message ID');
            expect(fetchMock).toHaveBeenCalledOnce();
        },
    );

    it('rejects malformed JSON and network failures without replay or private error details', async () => {
        const client = new Ic3DirectMessageClient({ region: 'amer', acquireToken: async () => token() });
        fetchMock.mockResolvedValueOnce(new Response('private response details', { status: 201 }));
        await expect(client.send('48:notes', 'test')).rejects.toThrow('invalid message ID');
        fetchMock.mockRejectedValueOnce(new Error('private request details 401'));
        await expect(client.send('48:notes', 'next explicit send')).rejects.toThrow(
            'Teams IC3 direct send failed; delivery may be unknown',
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['credential', 'request', 'response'])('bounds a hanging %s even if it ignores abort', async stage => {
        const controller = new AbortController();
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
        const acquire = vi.fn(() => stage === 'credential' ? new Promise<string>(() => {}) : Promise.resolve(token()));
        const client = new Ic3DirectMessageClient({ region: 'amer', acquireToken: acquire });
        if (stage === 'request') fetchMock.mockImplementation(() => new Promise(() => {}));
        else fetchMock.mockResolvedValue({
            ok: true, json: () => new Promise(() => {}),
        } as unknown as Response);
        const pending = client.send('48:notes', 'test');
        if (stage !== 'credential') await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        controller.abort();
        await expect(pending).rejects.toThrow('timed out');
        expect(fetchMock).toHaveBeenCalledTimes(stage === 'credential' ? 0 : 1);
    });

    it('does not write if a credential resolves after the deadline', async () => {
        const controller = new AbortController();
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
        let resolve!: (value: string) => void;
        const client = new Ic3DirectMessageClient({
            region: 'amer',
            acquireToken: () => new Promise(done => { resolve = done; }),
        });
        const pending = client.send('48:notes', 'test');
        controller.abort();
        await expect(pending).rejects.toThrow('timed out');
        resolve(token());
        await Promise.resolve();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function mockMcp(): void {
    fetchMock.mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === 'initialize') return Response.json({ result: { protocolVersion: '2025-03-26' } });
        if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
        if (body.method === 'tools/list') return Response.json({ result: {
            tools: ['SendMessageToSelf', 'SendMessageToChannel', 'ReplyToChannelMessage'].map(name => ({ name })),
        } });
        return Response.json({ result: { content: [{ type: 'text', text: JSON.stringify({
            id: 'mcp-message', chatId: '19:self@thread.v2',
        }) }] } });
    });
}

describe('IC3 transport and bot routing', () => {
    it('keeps MCP polling, channel sends, replies, and self sends working without an IC3 region', async () => {
        mockMcp();
        const transport = createTransport('mcp', { mcpServerUrl: 'https://mcp.example.test' });
        await transport.initialize(mcpToken(), { teamId: 'team' });
        await transport.send('channel', 'message');
        await transport.send('channel', 'reply', { replyToId: 'root' });
        await expect(transport.reactToChannelMessage({ channelId: 'channel', messageId: 'root', text: 'message' }))
            .rejects.toMatchObject({ code: 'configuration', outcome: 'not-attempted' });
        fetchMock.mockResolvedValueOnce(Response.json({ result: { content: [{ type: 'text', text: '[]' }] } }));
        await expect(transport.poll('channel')).resolves.toMatchObject({ messages: [] });
        await transport.initialize(mcpToken(), {});
        await transport.send('19:self@thread.v2', 'self');
        expect(fetchMock.mock.calls.every(([url]) => url === 'https://mcp.example.test')).toBe(true);
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        transport.stop();
    });

    it('keeps an opted-in unconfigured IC3 self send offline without disconnecting MCP', async () => {
        mockMcp();
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { selfSend: 'ic3' },
        });
        await transport.initialize(mcpToken(), {});
        fetchMock.mockClear();
        await expect(transport.send('48:notes', 'message'))
            .rejects.toMatchObject({ code: 'configuration', outcome: 'not-attempted' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        await transport.initialize(mcpToken(), { teamId: 'team' });
        await transport.send('channel', 'message');
        expect(fetchMock.mock.calls.every(([url]) => url === 'https://mcp.example.test')).toBe(true);
        transport.stop();
    });

    it('leaves the default MCP self-send path unchanged', async () => {
        mockMcp();
        const acquire = vi.fn(async () => token());
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test',
            ic3DirectMessageOptions: { region: 'emea', acquireToken: acquire },
        });
        await transport.initialize('mcp-token', {});
        expect(await transport.send('19:self@thread.v2', 'test')).toBe('mcp-message');
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        expect(acquire).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls.every(([url]) => String(url) === 'https://mcp.example.test')).toBe(true);
        transport.stop();
    });

    it.each([
        { region: 'emea' as const, oid: senderId, name: 'Test Account One' },
        { region: 'apac' as const, oid: '00000000-0000-0000-0000-000000000002', name: 'Test Account Two' },
    ])('propagates injected auth and $region routing through TeamsBot/createTransport/McpTransport', async account => {
        mockMcp();
        const value = token(account);
        const acquire = vi.fn(async () => value);
        const bot = new TeamsBot({
            mode: 'mcp', mcpServerUrl: 'https://mcp.example.test',
            operationRoutes: { selfSend: 'ic3' },
            ic3DirectMessageOptions: { region: account.region, acquireToken: acquire },
            auth: { bearerToken: mcpToken(account.oid) }, onMessage: async () => {},
        });
        try {
            await bot.start();
            fetchMock.mockClear();
            for (const target of ['19:channel@thread.tacv2', '19:group@thread.v2', '19:unverified@thread.v2']) {
                await expect(bot.send(target, 'test')).rejects.toThrow('only self-chat');
            }
            expect(acquire).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
            fetchMock.mockResolvedValue(success());
            await bot.send('48:notes', 'test');
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe(
                `https://teams.cloud.microsoft/api/chatsvc/${account.region}/v1/users/ME/conversations/48%3Anotes/messages`,
            );
            expect(init?.redirect).toBe('error');
            expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${value}`);
            expect(JSON.parse(String(init?.body))).toMatchObject({
                from: `8:orgid:${account.oid}`, fromUserId: `8:orgid:${account.oid}`, imdisplayname: account.name,
            });
            expect(acquire).toHaveBeenCalledExactlyOnceWith(init?.signal);
            expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        } finally {
            await bot.stop();
        }
    });

    it('routes through TeamsBot without a send flag, skips discovery writes/polling, and isolates the MCP token', async () => {
        mockMcp();
        const bot = new TeamsBot({
            mode: 'mcp', mcpServerUrl: 'https://mcp.example.test', operationRoutes: { selfSend: 'ic3' },
            ic3DirectMessageOptions: { region: 'amer' },
            auth: { bearerToken: mcpToken() }, onMessage: async () => {},
        });
        await bot.start();
        expect(bot.getChannelId()).toBeNull();
        const initCalls = [...fetchMock.mock.calls];
        expect(initCalls).toHaveLength(3);
        expect(initCalls.every(([, init]) => JSON.parse(String(init?.body)).method !== 'tools/call')).toBe(true);
        fetchMock.mockResolvedValueOnce(success());
        try {
            expect(await bot.send('48:notes', 'test')).toBe('1790000000123');
            const [, init] = fetchMock.mock.calls.at(-1)!;
            expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${token()}`);
            expect(acquireTokenViaAzCli).toHaveBeenCalledWith(resource, expect.any(AbortSignal));
        } finally {
            await bot.stop();
        }
    });

    it.each([401, 403, 429, 500, 'network', 'missing-id'])('bot never refreshes/retries IC3 failure %s', async failure => {
        mockMcp();
        const refresh = vi.fn(async () => 'refreshed-mcp-token');
        const bot = new TeamsBot({
            mode: 'mcp', mcpServerUrl: 'https://mcp.example.test', operationRoutes: { selfSend: 'ic3' },
            ic3DirectMessageOptions: { region: 'amer' },
            auth: { bearerToken: mcpToken(), onTokenRefresh: refresh }, onMessage: async () => {},
        });
        await bot.start();
        fetchMock.mockClear();
        if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('private 401'));
        else if (failure === 'missing-id') fetchMock.mockResolvedValueOnce(Response.json({}, { status: 201 }));
        else fetchMock.mockResolvedValueOnce(new Response('private response', { status: failure }));
        try {
            await expect(bot.send('48:notes', 'test')).rejects.toBeInstanceOf(TeamsIc3SendError);
            expect(fetchMock).toHaveBeenCalledOnce();
            expect(refresh).not.toHaveBeenCalled();
        } finally {
            await bot.stop();
        }
    });

    it('rejects channel/group/reply sends in opted-in DM mode without auth or network', async () => {
        mockMcp();
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { selfSend: 'ic3' },
        });
        await transport.initialize('mcp-token', {});
        fetchMock.mockClear();
        for (const target of ['19:channel@thread.tacv2', '19:group@thread.v2', '19:direct@thread.v2']) {
            await expect(transport.send(target, 'test')).rejects.toThrow('only self-chat');
        }
        await expect(transport.send('48:notes', 'test', { replyToId: 'root' }))
            .rejects.toMatchObject({ code: 'unsupported', outcome: 'not-attempted' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        transport.stop();
    });

    it('keeps explicit MCP polling IDs separate from the IC3 send destination', async () => {
        mockMcp();
        const transport = new McpTransport('https://mcp.example.test', undefined, undefined, undefined, { region: 'amer' },
            { routes: { selfSend: 'ic3' } });
        await transport.initialize(mcpToken(), { chatId: '19:self@thread.v2' });
        expect(transport.getChatId()).toBe('19:self@thread.v2');
        fetchMock.mockClear();
        await expect(transport.send('19:self@thread.v2', 'test')).rejects.toThrow('only self-chat');
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValueOnce(success());
        expect(await transport.send('48:notes', 'test')).toBe('1790000000123');
        transport.stop();
    });

    it('keeps channel posts and replies on MCP even when opted in', async () => {
        mockMcp();
        const acquire = vi.fn(async () => token());
        const transport = new McpTransport('https://mcp.example.test', undefined, undefined, undefined,
            { region: 'apac', acquireToken: acquire }, { routes: { selfSend: 'ic3' } });
        await transport.initialize(mcpToken(), { teamId: 'team' });
        fetchMock.mockClear();
        await transport.send('19:channel@thread.tacv2', 'test');
        await transport.send('19:channel@thread.tacv2', 'test', { replyToId: 'root' });
        expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).params.name))
            .toEqual(['SendMessageToChannel', 'ReplyToChannelMessage']);
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        expect(acquire).not.toHaveBeenCalled();
        transport.stop();
    });

    it('bot rejects empty reply targets and does not retry wrapped IC3 errors', async () => {
        mockMcp();
        const bot = new TeamsBot({
            mode: 'mcp', mcpServerUrl: 'https://mcp.example.test', operationRoutes: { selfSend: 'ic3' },
            auth: { bearerToken: 'mcp-token', onTokenRefresh: vi.fn(async () => 'refreshed-token') },
            onMessage: async () => {},
        });
        await bot.start();
        fetchMock.mockClear();
        try {
            await expect(bot.send('48:notes', 'test', { replyToId: '' }))
                .rejects.toMatchObject({ code: 'invalid-target', outcome: 'not-attempted' });
            expect(fetchMock).not.toHaveBeenCalled();
            expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
            const send = vi.spyOn(McpTransport.prototype, 'send').mockRejectedValue(
                new Error('wrapped HTTP 401', { cause: new TeamsIc3SendError('failed') }),
            );
            await expect(bot.send('48:notes', 'test')).rejects.toThrow('wrapped HTTP 401');
            expect(send).toHaveBeenCalledOnce();
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            await bot.stop();
        }
    });

    it('clears IC3 credentials on stop/reinitialize and never reuses DM routing for channels', async () => {
        mockMcp();
        const transport = createTransport('mcp', {
            mcpServerUrl: 'https://mcp.example.test', operationRoutes: { selfSend: 'ic3' },
            ic3DirectMessageOptions: { region: 'amer' },
        });
        await transport.initialize(mcpToken(), {});
        fetchMock.mockResolvedValueOnce(success());
        await transport.send('48:notes', 'test');
        transport.stop();
        await expect(transport.send('48:notes', 'test')).rejects.toThrow('not initialized');
        await transport.initialize(mcpToken(), {});
        fetchMock.mockResolvedValueOnce(success());
        await transport.send('48:notes', 'test');
        expect(acquireTokenViaAzCli).toHaveBeenCalledTimes(2);
        await transport.initialize(mcpToken(), { teamId: 'team' });
        fetchMock.mockClear();
        await transport.send('19:channel@thread.tacv2', 'test');
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).params.name).toBe('SendMessageToChannel');
        transport.stop();
    });

    it('requires MCP mode for the IC3 self route', () => {
        expect(() => createTransport('graph', { operationRoutes: { selfSend: 'ic3' } })).toThrow('require MCP mode');
    });

    it.each(['opaque-token', mcpToken('00000000-0000-0000-0000-000000000099')])(
        'does not send to a different or unestablished hybrid account', async bearerToken => {
            mockMcp();
            const bot = new TeamsBot({
                mode: 'mcp', mcpServerUrl: 'https://mcp.example.test', operationRoutes: { selfSend: 'ic3' },
                ic3DirectMessageOptions: { region: 'amer' },
                auth: { bearerToken }, onMessage: async () => {},
            });
            await bot.start();
            fetchMock.mockClear();
            try {
                await expect(bot.sendMessage({ kind: 'self' }, { content: 'message', contentType: 'text' }))
                    .rejects.toMatchObject({ outcome: 'not-attempted' });
                expect(fetchMock).not.toHaveBeenCalled();
            } finally {
                await bot.stop();
            }
        },
    );

    it('rejects account changes during refresh without changing the existing hybrid binding', async () => {
        mockMcp();
        const transport = new McpTransport('https://mcp.example.test', undefined, undefined, undefined, { region: 'amer' },
            { routes: { selfSend: 'ic3' } });
        await transport.initialize(mcpToken(), {});
        fetchMock.mockClear();
        expect(() => transport.setToken(mcpToken('00000000-0000-0000-0000-000000000099')))
            .toThrow('account changed');
        expect(() => transport.setToken('opaque-token')).toThrow('account changed');
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValueOnce(success());
        await expect(transport.operations.send({ kind: 'self' }, { content: 'message', contentType: 'text' }))
            .resolves.toMatchObject({ outcome: 'accepted', message: { backend: 'ic3' } });
        transport.stop();
    });

    it.each(['mcp', 'ic3'])('renews a polling token without cancelling an in-flight %s send', async backend => {
        mockMcp();
        const transport = new McpTransport('https://mcp.example.test', undefined, undefined, undefined, { region: 'amer' },
            { routes: { selfSend: 'ic3' } });
        await transport.initialize(mcpToken(), backend === 'mcp' ? { teamId: 'team' } : {});
        fetchMock.mockClear();
        let resolve!: (value: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
        const pending = transport.send(backend === 'mcp' ? 'channel' : '48:notes', 'message');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        const signal = fetchMock.mock.calls[0][1]?.signal;
        const operations = transport.operations;
        transport.setToken(mcpToken());
        expect(transport.operations).toBe(operations);
        expect(signal?.aborted).toBe(false);
        resolve(backend === 'ic3' ? success() : Response.json({
            result: { content: [{ type: 'text', text: '{"id":"sent"}' }] },
        }));
        await expect(pending).resolves.toBe(backend === 'ic3' ? '1790000000123' : 'sent');
        transport.stop();
    });
});
