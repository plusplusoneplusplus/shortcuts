import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamsBot } from '../../src/teams/bot';
import { McpClient } from '../../src/teams/mcp/mcp-client';
import { McpTransport } from '../../src/teams/mcp/transport-mcp';
import { GraphCredentialStore } from '../../src/teams/graph/graph-credential';
import { GraphChannelReader } from '../../src/teams/graph/channel-reader';
import { Ic3Operations } from '../../src/teams/ic3/operations-ic3';
import type { GraphMessage } from '../../src/teams/graph/graph-client';
import type { TeamsBotOptions, InboundTeamsMessage } from '../../src/teams/types';

const account = { tenantId: '11111111-1111-4111-8111-111111111111', objectId: '22222222-2222-4222-8222-222222222222' };
const token = (patch: Record<string, unknown> = {}) => 'header.' + Buffer.from(JSON.stringify({
    tid: account.tenantId, oid: account.objectId, aud: 'https://graph.microsoft.com',
    scp: 'ChannelMessage.Read.All', exp: Math.floor(Date.now() / 1000) + 3600, ...patch,
})).toString('base64url') + '.signature';
const rootsUrl = 'https://graph.microsoft.com/beta/teams/team/channels/channel/messages';
const replyUrl = (id: string) => `${rootsUrl}/${encodeURIComponent(id)}/replies`;
const message = (id: string, text = 'ask', time = '2026-01-01T00:00:01Z'): GraphMessage =>
    ({ id, body: { content: text }, createdDateTime: time, from: { user: { id: 'synthetic-user' } } });
const response = (value: GraphMessage[], nextLink?: string) =>
    new Response(JSON.stringify({ value, ...(nextLink ? { '@odata.nextLink': nextLink } : {}) }));
const hints = { rootMessageIds: [] as string[], reconcile: true };

function setup(options: { tracked?: string[]; replies?: () => boolean;
    discovered?: (root: InboundTeamsMessage) => Promise<void>; acquireToken?: () => Promise<string> } = {}) {
    const acquireToken = vi.fn(options.acquireToken ?? (async () => token()));
    const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => response([]));
    vi.stubGlobal('fetch', fetch);
    const transport = new McpTransport('https://example.test/mcp', options.replies ?? (() => true),
        () => options.tracked ?? [], options.discovered, false, undefined, {
            channelReadBackend: 'graph', graphReadOptions: { acquireToken },
        });
    return { transport, fetch, acquireToken };
}

beforeEach(() => {
    vi.spyOn(McpClient.prototype, 'initialize').mockResolvedValue(undefined);
    // Graph reply availability must not depend on MCP advertising its reply tool.
    vi.spyOn(McpClient.prototype, 'listTools').mockResolvedValue({ tools: [] });
    vi.spyOn(McpClient.prototype, 'callTool').mockRejectedValue(new Error('MCP reads are forbidden'));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('hybrid Graph channel reads', () => {
    it('reads beta roots and fully paginated beta replies with chronological IDs and authorship', async () => {
        const discovered = vi.fn(async (_root: InboundTeamsMessage) => {});
        const credential = token();
        const s = setup({ discovered, acquireToken: async () => credential });
        await s.transport.initialize(token({ aud: 'mcp' }), { teamId: 'team', channelId: 'channel' });
        s.fetch.mockImplementation(async url => {
            const path = new URL(url).pathname;
            if (path.endsWith('/messages')) return response([message('root', '<p>/list repos</p>')]);
            if (new URL(url).searchParams.has('page')) return response([message('reply-first', 'first', '2026-01-01T00:00:02Z')]);
            return response([{ ...message('reply-last', 'last', '2026-01-01T00:00:03Z'), from: { application: { id: 'app' } } }],
                `${replyUrl('root')}?page=2`);
        });
        const read = await s.transport.poll('channel');
        expect(read.messages.map(msg => msg.messageId)).toEqual(['root', 'reply-first', 'reply-last']);
        expect(read.messages[0].text).toBe('/list repos');
        expect(read.messages[1]).toMatchObject({ replyToMessageId: 'root', senderAadId: 'synthetic-user',
            createdDateTime: '2026-01-01T00:00:02Z' });
        expect(read.messages[2].botAuthored).toBe(true);
        expect(discovered).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ messageId: 'root' }));
        expect(discovered.mock.invocationCallOrder[0]).toBeLessThan(s.fetch.mock.invocationCallOrder[1]);
        expect(s.fetch).toHaveBeenCalledTimes(3);
        expect(s.fetch.mock.calls.map(([url]) => String(url))).toEqual([
            `${rootsUrl}?$top=50`, `${replyUrl('root')}?$top=50`, `${replyUrl('root')}?page=2`,
        ]);
        expect(s.fetch.mock.calls.every(([, init]) => init?.method === 'GET'
            && init.headers && (init.headers as Record<string, string>).Authorization === `Bearer ${credential}`)).toBe(true);
        expect(McpClient.prototype.callTool).not.toHaveBeenCalled();
        s.transport.stop();
    });

    it('known-root wakes bypass root discovery and rotation, finish pagination, and retain backfill', async () => {
        const s = setup({ tracked: Array.from({ length: 100 }, (_, i) => `tracked-${i}`) });
        await s.transport.initialize(token(), { teamId: 'team' });
        Object.assign(s.transport, { rootPages: new Map([['channel', `${rootsUrl}?older=1`]]) });
        s.fetch.mockImplementation(async url => {
            expect(new URL(url).pathname).toBe(new URL(replyUrl('tracked-99')).pathname);
            return new URL(url).searchParams.has('page') ? response([message('two')])
                : response([message('one')], `${replyUrl('tracked-99')}?page=2`);
        });
        const read = await s.transport.poll('channel', 'previous', { reconcile: false, rootMessageIds: ['tracked-99'] });
        expect(read.messages.map(msg => msg.messageId)).toEqual(['one', 'two']);
        expect(read.nextSince).toBe('previous');
        expect(s.fetch).toHaveBeenCalledTimes(2);
        s.transport.commitNotificationRead('channel');
        s.fetch.mockClear();
        s.fetch.mockImplementation(async () => response([]));
        await s.transport.poll('channel', undefined, hints);
        expect(s.fetch.mock.calls.some(([url]) => String(url) === `${rootsUrl}?older=1`)).toBe(true);
        s.transport.stop();
    });

    it.each([
        { reconcile: false, rootMessageIds: ['unknown'] },
        { reconcile: false, rootMessageIds: [] },
        { reconcile: true, rootMessageIds: ['tracked-9'] },
    ])('reconciles known threads without inventing bindings for hints %j', async readHints => {
        const tracked = Array.from({ length: 10 }, (_, i) => `tracked-${i}`);
        const discovered = vi.fn(async (_root: InboundTeamsMessage) => {});
        const s = setup({ tracked, discovered });
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockImplementation(async url => response(new URL(url).pathname.endsWith('/messages') ? [message('visible')] : []));
        await s.transport.poll('channel', undefined, readHints);
        expect(s.fetch).toHaveBeenCalledTimes(12);
        for (const id of [...tracked, 'visible']) {
            expect(s.fetch.mock.calls.some(([url]) => new URL(url).pathname === new URL(replyUrl(id)).pathname)).toBe(true);
        }
        expect(s.fetch.mock.calls.some(([url]) => String(url).includes('/unknown/'))).toBe(false);
        expect(discovered).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ messageId: 'visible' }));
        s.transport.stop();
    });

    it('gates replies without gating default Graph root reads and retains IC3 Likes', async () => {
        const s = setup({ replies: () => false, tracked: ['tracked'] });
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockImplementation(async () => response([message('root')]));
        expect((await s.transport.poll('channel')).messages).toHaveLength(1);
        expect(s.fetch).toHaveBeenCalledOnce();
        const react = vi.spyOn(Ic3Operations.prototype, 'react').mockResolvedValue(undefined);
        await s.transport.reactToChannelMessage({ channelId: 'channel', messageId: 'reply',
            replyToMessageId: 'root', text: '' });
        expect(react).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            messageId: 'reply', rootMessageId: 'root', backend: 'mcp',
        }), 'like', undefined);
        s.transport.stop();
    });

    it('orders paginated root catch-up chronologically when thread replies are disabled', async () => {
        const s = setup({ replies: () => false });
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockResolvedValueOnce(response([message('head', 'old', '2026-01-01T00:00:00Z')]));
        await s.transport.poll('channel');
        s.transport.commitNotificationRead('channel');
        s.fetch.mockResolvedValueOnce(response([message('later', 'later', '2026-01-01T00:00:03Z')], `${rootsUrl}?page=2`))
            .mockResolvedValueOnce(response([message('earlier', 'earlier', '2026-01-01T00:00:02Z'),
                message('head', 'old', '2026-01-01T00:00:00Z')]));
        const read = await s.transport.poll('channel');
        expect(read.messages.map(msg => msg.messageId)).toEqual(['head', 'earlier', 'later']);
        expect(read.nextSince).toBe('later');
        s.transport.stop();
    });

    it.each(['read', 'admission'])('does not advance the head after incomplete %s', async failure => {
        const s = setup();
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockImplementation(async url => response(new URL(url).pathname.endsWith('/messages') ? [message('old')] : []));
        await s.transport.poll('channel');
        s.transport.commitNotificationRead('channel');
        s.fetch.mockImplementation(async url => {
            if (new URL(url).pathname.endsWith('/replies')) return response([]);
            if (new URL(url).searchParams.has('page')) {
                if (failure === 'read') return new Response(null, { status: 429, headers: { 'Retry-After': '90' } });
                return response([message('old')]);
            }
            return response([message('new')], `${rootsUrl}?page=2`);
        });
        if (failure === 'read') {
            await expect(s.transport.poll('channel')).rejects.toMatchObject({ status: 429, retryAfterMs: 90_000 });
        } else await s.transport.poll('channel'); // omit commit: consumer admission failed
        s.fetch.mockClear();
        s.fetch.mockImplementation(async url => response(new URL(url).pathname.endsWith('/replies') ? []
            : new URL(url).searchParams.has('page') ? [message('old')] : [message('new')],
            new URL(url).pathname.endsWith('/messages') && !new URL(url).searchParams.has('page') ? `${rootsUrl}?page=2` : undefined));
        await s.transport.poll('channel', undefined, { reconcile: false, rootMessageIds: ['old'] });
        expect(s.fetch.mock.calls.some(([url]) => String(url) === `${rootsUrl}?page=2`)).toBe(true);
        s.transport.stop();
    });

    it.each([403, 404, 429, 500])('never falls back on Graph read HTTP %s and surfaces safe errors', async status => {
        const s = setup();
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockImplementation(async () => new Response('sensitive provider body', { status, headers: { 'Retry-After': '30' } }));
        const error = await s.transport.poll('channel').catch(error => error);
        expect(error.status).toBe(status);
        expect(error.message).not.toContain('sensitive');
        if (status === 403) expect(error.message).toContain('ChannelMessage.Read.All consent and channel membership');
        if (status === 429) expect(error.retryAfterMs).toBe(30_000);
        expect(McpClient.prototype.callTool).not.toHaveBeenCalled();
        s.transport.stop();
    });

    it.each(['foreign', 'different-channel', 'different-thread', 'wrong-version', 'cycle', 'malformed'])('rejects unsafe/incomplete reply pagination: %s', async kind => {
        const s = setup({ tracked: ['tracked'] });
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockImplementation(async () => kind === 'malformed' ? new Response('{"value":{}}')
            : response([message('reply')], kind === 'foreign' ? 'https://example.test/steal'
                : kind === 'different-channel' ? replyUrl('tracked').replace('/channels/channel/', '/channels/other/')
                : kind === 'wrong-version' ? replyUrl('tracked').replace('/beta/', '/v1.0/')
                : kind === 'different-thread' ? replyUrl('other') : `${replyUrl('tracked')}?page=2`));
        await expect(s.transport.poll('channel', undefined, { reconcile: false, rootMessageIds: ['tracked'] })).rejects.toThrow();
        expect(s.fetch.mock.calls.every(([url]) => new URL(url).pathname === new URL(replyUrl('tracked')).pathname)).toBe(true);
        expect(s.fetch.mock.calls.every(([url]) => new URL(url).hostname === 'graph.microsoft.com')).toBe(true);
        s.transport.stop();
    });

    it('accepts equivalent channel ID escaping in Graph next links without changing thread identity', async () => {
        const channelId = '19:synthetic@thread.tacv2';
        const reader = new GraphChannelReader(account, { acquireToken: async () => token() });
        await reader.initialize();
        const fetch = vi.fn(async () => response([message('reply')]));
        vi.stubGlobal('fetch', fetch);
        const next = `https://graph.microsoft.com/beta/teams/team/channels/${channelId}/messages/root/replies?page=2`;
        const read = await reader.page('team', channelId, 'root', next);
        expect(read.messages[0]).toMatchObject({ channelId, messageId: 'reply', replyToMessageId: 'root' });
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][0]).toBe(next);
        reader.stop();
    });

    it('keeps Graph channel writes on v1.0 alongside beta channel reads', async () => {
        const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => response([]));
        vi.stubGlobal('fetch', fetch);
        const credential = token({ scp: 'Group.ReadWrite.All' });
        const transport = new McpTransport('https://example.test/mcp', () => false,
            undefined, undefined, false, undefined, {
                channelReadBackend: 'graph', graphReadOptions: { acquireToken: async () => credential },
                routes: { channelSend: 'graph', channelReply: 'graph' },
                graphOutboundOptions: { acquireToken: async () => credential },
            });
        await transport.initialize(token({ aud: 'mcp' }), { teamId: 'team' });
        await transport.poll('channel');
        fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'sent-root' }), { status: 201 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'sent-reply' }), { status: 201 }));
        expect(await transport.send('channel', 'answer')).toBe('sent-root');
        expect(await transport.send('channel', 'answer', { replyToId: 'root' })).toBe('sent-reply');
        expect(fetch.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
            [`${rootsUrl}?$top=50`, 'GET'],
            [rootsUrl.replace('/beta/', '/v1.0/'), 'POST'],
            [replyUrl('root').replace('/beta/', '/v1.0/'), 'POST'],
        ]);
        expect(McpClient.prototype.callTool).not.toHaveBeenCalled();
        transport.stop();
    });

    it('cancels pages and prevents late results on stop', async () => {
        const s = setup({ tracked: ['tracked'] });
        await s.transport.initialize(token(), { teamId: 'team' });
        let release!: (response: Response) => void;
        s.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const reading = s.transport.poll('channel', undefined, { reconcile: false, rootMessageIds: ['tracked'] });
        await vi.waitFor(() => expect(s.fetch).toHaveBeenCalledOnce());
        const signal = s.fetch.mock.calls[0][1]?.signal;
        s.transport.stop();
        expect(signal?.aborted).toBe(true);
        release(response([message('late')]));
        await expect(reading).rejects.toThrow();
        expect(s.fetch).toHaveBeenCalledOnce();
    });

    it('keeps selected channels isolated and rejects a configured but unavailable Graph reader', async () => {
        const s = setup({ tracked: ['tracked'] });
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockImplementation(async () => response([]));
        await s.transport.poll('another-channel', undefined, { reconcile: false, rootMessageIds: ['tracked'] });
        expect(s.fetch.mock.calls.every(([url]) => new URL(url).pathname.includes('/channels/another-channel/'))).toBe(true);
        Object.assign(s.transport, { graphReader: undefined });
        await expect(s.transport.poll('channel')).rejects.toThrow('Graph channel reader unavailable');
        expect(McpClient.prototype.callTool).not.toHaveBeenCalled();
        s.transport.stop();
    });

    it('retries a failed reply page without returning partial replies', async () => {
        const s = setup({ tracked: ['tracked'] });
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockResolvedValueOnce(response([message('one')], `${replyUrl('tracked')}?page=2`))
            .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '20' } }));
        const readHints = { reconcile: false, rootMessageIds: ['tracked'] };
        await expect(s.transport.poll('channel', undefined, readHints)).rejects.toMatchObject({ retryAfterMs: 20_000 });
        s.fetch.mockResolvedValueOnce(response([message('one')], `${replyUrl('tracked')}?page=2`))
            .mockResolvedValueOnce(response([message('two')]));
        expect((await s.transport.poll('channel', undefined, readHints)).messages.map(msg => msg.messageId)).toEqual(['one', 'two']);
        expect(s.fetch).toHaveBeenCalledTimes(4);
        s.transport.stop();
    });

    it('does not start reply reads after disposal during root persistence', async () => {
        let release!: () => void;
        const discovered = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
        const s = setup({ discovered });
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockResolvedValueOnce(response([message('root')]));
        const reading = s.transport.poll('channel');
        await vi.waitFor(() => expect(discovered).toHaveBeenCalledOnce());
        s.transport.stop();
        release();
        await expect(reading).rejects.toThrow();
        expect(s.fetch).toHaveBeenCalledOnce();
    });
});

describe('Graph reader credentials', () => {
    it.each([
        { scp: 'ChannelMessage.Send' }, { scp: 'User.Read' }, { aud: 'mcp' }, { exp: 0 },
        { oid: account.tenantId }, { tid: account.objectId }, { scp: undefined, roles: ['ChannelMessage.Read.All'] },
    ])('rejects missing read consent, invalid audience/expiry and account mismatch: %j', async patch => {
        const reader = new GraphChannelReader(account, { acquireToken: async () => token(patch) });
        await expect(reader.initialize()).rejects.toMatchObject({ backend: 'graph', code: 'authentication' });
        reader.stop();
    });

    it('validates read and write consent independently without requesting a broad grant', async () => {
        const signal = new AbortController().signal;
        const credential = token();
        await expect(new GraphCredentialStore(account, { acquireToken: async () => credential }, 'read').get(signal)).resolves.toBe(credential);
        await expect(new GraphCredentialStore(account, { acquireToken: async () => token() }).get(signal))
            .rejects.toThrow('ChannelMessage.Send');
        await expect(new GraphCredentialStore(account, { acquireToken: async () => token({ scp: 'ChannelMessage.Send' }) }, 'read').get(signal))
            .rejects.toThrow('least-privilege ChannelMessage.Read.All');
    });

    it.each([false, true])('refreshes a definitive 401 with the original pinned identity (mismatch=%s)', async mismatch => {
        const s = setup();
        s.acquireToken.mockResolvedValueOnce(token()).mockResolvedValueOnce(token(mismatch ? { oid: account.tenantId } : {}));
        await s.transport.initialize(token(), { teamId: 'team' });
        s.fetch.mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(response([]));
        if (mismatch) await expect(s.transport.poll('channel')).rejects.toThrow('identity mismatch');
        else expect((await s.transport.poll('channel')).messages).toEqual([]);
        expect(s.acquireToken).toHaveBeenCalledTimes(2);
        expect(s.fetch).toHaveBeenCalledTimes(mismatch ? 1 : 2);
        expect(s.fetch.mock.calls.every(([url]) => String(url) === `${rootsUrl}?$top=50`)).toBe(true);
        expect(McpClient.prototype.callTool).not.toHaveBeenCalled();
        s.transport.stop();
    });

    it.each([undefined, 'root', 'reply-page'] as const)('retains beta routing on a 401 refresh for %s reads', async target => {
        const original = token();
        const refreshed = token({ scp: 'ChannelMessage.Read.All User.Read' });
        const acquireToken = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(refreshed);
        const reader = new GraphChannelReader(account, { acquireToken });
        await reader.initialize();
        const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => response([]))
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(response([message('read')]));
        vi.stubGlobal('fetch', fetch);
        const rootId = target ? 'root' : undefined;
        const nextLink = target === 'reply-page' ? `${replyUrl('root')}?$skiptoken=synthetic` : undefined;
        expect((await reader.page('team', 'channel', rootId, nextLink)).messages[0].messageId).toBe('read');
        const expectedUrl = nextLink ?? `${rootId ? replyUrl(rootId) : rootsUrl}?$top=50`;
        expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([expectedUrl, expectedUrl]);
        expect(fetch).toHaveBeenNthCalledWith(1, expectedUrl, expect.objectContaining({
            headers: expect.objectContaining({ Authorization: `Bearer ${original}` }),
        }));
        expect(fetch).toHaveBeenNthCalledWith(2, expectedUrl, expect.objectContaining({
            headers: expect.objectContaining({ Authorization: `Bearer ${refreshed}` }),
        }));
        expect(acquireToken).toHaveBeenCalledTimes(2);
        reader.stop();
    });

    it('sanitizes acquisition failures and cancels uncooperative acquisition on stop', async () => {
        const unavailable = new GraphChannelReader(account, { acquireToken: async () => { throw new Error('sensitive account data'); } });
        await expect(unavailable.initialize()).rejects.toThrow('az login');
        unavailable.stop();
        let release!: (token: string) => void;
        const reader = new GraphChannelReader(account, { acquireToken: () => new Promise(resolve => { release = resolve; }) });
        const starting = reader.initialize();
        const rejection = expect(starting).rejects.toThrow('cancelled');
        reader.stop();
        await rejection;
        release(token());
    });

    it('requires an account identity before acquisition and fails closed on expiry refresh', async () => {
        vi.useFakeTimers();
        const acquireToken = vi.fn(async () => token());
        const reader = new GraphChannelReader(undefined, { acquireToken });
        await expect(reader.initialize()).rejects.toThrow('MCP reader tenant/object identity');
        expect(acquireToken).not.toHaveBeenCalled();
        reader.stop();
        const s = setup();
        s.acquireToken.mockResolvedValueOnce(token()).mockImplementationOnce(async () => token({ oid: account.tenantId }));
        await s.transport.initialize(token(), { teamId: 'team' });
        await vi.advanceTimersByTimeAsync(3_550_000);
        await expect(s.transport.poll('channel')).rejects.toThrow('identity mismatch');
        expect(s.fetch).not.toHaveBeenCalled();
        s.transport.stop();
    });
});

describe('Graph pages through durable channel admission', () => {
    function botSetup(extra: Partial<TeamsBotOptions> = {}) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const onMessage = vi.fn(async (_message: InboundTeamsMessage) => {});
        const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => response([]));
        vi.stubGlobal('fetch', fetch);
        const bot = new TeamsBot({
            mode: 'mcp', channelReadBackend: 'graph', graphReadOptions: { acquireToken: async () => token() },
            mcpServerUrl: 'https://example.test/mcp', teamId: 'team', auth: { bearerToken: token({ aud: 'mcp' }) },
            pollIntervalMs: 1000, pollChannelReplies: () => true, channelThreadRoots: () => ['tracked'],
            onMessage, ...extra,
        });
        bot.setChannelId('channel');
        return { bot, onMessage, fetch };
    }

    it('suppresses history/own/duplicates, restores dated selections, and admits roots/replies once in order', async () => {
        const admitted = new Set(['known']);
        const s = botSetup({ isOwnChannelReply: msg => msg.messageId === 'own',
            isKnownChannelReply: msg => admitted.has(msg.messageId) });
        s.onMessage.mockImplementation(async msg => { admitted.add(msg.messageId); });
        await s.bot.start();
        s.fetch.mockImplementation(async url => response(new URL(url).pathname.endsWith('/messages')
            ? [message('new-root', '/list repos'), message('old-root', 'old ask', '2025-01-01T00:00:00Z')]
            : new URL(url).pathname === new URL(replyUrl('tracked')).pathname ? [
                message('old-ask', 'historic question', '2025-01-01T00:00:00Z'),
                message('select-repo', '<p>/select repo Alpha</p>', '2025-01-01T00:00:01Z'),
                message('select-topic', '/select topic synthetic-topic', '2025-01-01T00:00:02Z'),
                message('own'), message('known'), message('live-first'), message('live-second', 'second', '2026-01-01T00:00:02Z'),
                { ...message('undated'), createdDateTime: '' },
            ] : []));
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage.mock.calls.map(([msg]) => msg.messageId))
            .toEqual(['select-repo', 'select-topic', 'new-root', 'live-first', 'live-second']);
        expect(s.onMessage.mock.calls[0][0]).toMatchObject({ historicalSelectionReplay: true, initializationReplay: true });
        expect(s.onMessage.mock.calls[3][0].reference).toMatchObject({ backend: 'graph', rootMessageId: 'tracked',
            destination: { teamId: 'team', channelId: 'channel' } });
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage).toHaveBeenCalledTimes(5);
        await s.bot.stop();
        await s.bot.start();
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage).toHaveBeenCalledTimes(5); // reconnect suppresses pre-start questions
        await s.bot.stop();
    });

    it('retries failed admission without dropping the message or committing progress', async () => {
        const s = botSetup();
        await s.bot.start();
        s.onMessage.mockRejectedValueOnce(new Error('admission unavailable'));
        s.fetch.mockImplementation(async url => response(new URL(url).pathname === new URL(replyUrl('tracked')).pathname
            ? [message('ask')] : []));
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.bot.getLastError()).toContain('admission unavailable');
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage).toHaveBeenCalledTimes(2);
        expect(s.bot.getLastError()).toBeNull();
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage).toHaveBeenCalledTimes(2);
        await s.bot.stop();
    });

    it('honors Graph Retry-After, then resumes authoritative reads', async () => {
        const s = botSetup();
        await s.bot.start();
        s.fetch.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '10' } }));
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(9999);
        expect(s.fetch).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(s.fetch.mock.calls.length).toBeGreaterThan(1);
        await s.bot.stop();
    });

    it('does not refresh MCP credentials when Graph rejects refreshed reader credentials', async () => {
        const onTokenRefresh = vi.fn(async () => token({ aud: 'mcp' }));
        const s = botSetup({ auth: { bearerToken: token({ aud: 'mcp' }), onTokenRefresh } });
        await s.bot.start();
        s.fetch.mockImplementation(async () => new Response('sensitive body', { status: 401 }));
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.fetch).toHaveBeenCalledTimes(2);
        expect(onTokenRefresh).not.toHaveBeenCalled();
        expect(s.bot.getLastError()).toContain('Graph channel read authentication rejected');
        expect(s.bot.getLastError()).not.toContain('sensitive');
        await s.bot.stop();
    });

    it('cancels an old ordinary-poll admission loop across stop and reconnect', async () => {
        let release!: () => void;
        const s = botSetup({ pollChannelReplies: () => false });
        s.onMessage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        await s.bot.start();
        s.fetch.mockImplementation(async () => response([message('first'), message('second')]));
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage).toHaveBeenCalledOnce();
        await s.bot.stop();
        await s.bot.start();
        release();
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage).toHaveBeenCalledOnce();
        expect(s.bot.isConnected()).toBe(true);
        await s.bot.stop();
    });

    it('suppresses historical Likes when selections arrive after the first successful poll', async () => {
        const s = botSetup();
        await s.bot.start();
        await vi.advanceTimersByTimeAsync(1000);
        s.fetch.mockImplementation(async url => response(new URL(url).pathname === new URL(replyUrl('tracked')).pathname
            ? [message('late-selection', '/select repo Alpha', '2025-01-01T00:00:00Z')] : []));
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            messageId: 'late-selection', historicalSelectionReplay: true, initializationReplay: true,
        }));
        await s.bot.stop();
    });

    it('keeps default roots live with replies disabled and suppresses questions posted while replies are disabled', async () => {
        let enabled = false;
        const s = botSetup({ pollChannelReplies: () => enabled });
        await s.bot.start();
        s.fetch.mockImplementation(async url => response(new URL(url).pathname.endsWith('/messages')
            ? [message('root')] : [message('while-off')]));
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage.mock.calls.map(([msg]) => msg.messageId)).toEqual(['root']);
        enabled = true;
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage).toHaveBeenCalledOnce();
        s.fetch.mockImplementation(async url => response(new URL(url).pathname.endsWith('/messages')
            ? [message('root')] : [message('after-enable', 'ask', '2026-01-01T00:00:03Z')]));
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.onMessage.mock.calls.map(([msg]) => msg.messageId)).toEqual(['root', 'after-enable']);
        await s.bot.stop();
    });
});
