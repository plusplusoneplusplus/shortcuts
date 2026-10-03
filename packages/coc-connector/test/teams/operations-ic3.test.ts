import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ic3Operations } from '../../src/teams/ic3/operations-ic3';
import { Ic3DirectMessageClient, TeamsIc3SendError } from '../../src/teams/ic3/ic3-direct-message';
import { Ic3ReactionClient } from '../../src/teams/ic3/ic3-reaction';
import { acquireTokenViaAzCli } from '../../src/teams/auth';
import { TeamsOperationError, type TeamsAction, type TeamsMessageRef } from '../../src/teams/operations';

vi.mock('../../src/teams/auth', () => ({ acquireTokenViaAzCli: vi.fn() }));

const objectId = '00000000-0000-0000-0000-000000000001';
const tenantId = '00000000-0000-0000-0000-000000000002';
const otherId = '00000000-0000-0000-0000-000000000003';
const fetchMock = vi.fn<typeof fetch>();
const text = { content: 'hello', contentType: 'text' as const };
const self = { kind: 'self' as const };
const reference: TeamsMessageRef = {
    backend: 'mcp', connectionId: 'connection-one',
    destination: { kind: 'channel', teamId: 'team', channelId: '19:channel@thread.tacv2' },
    messageId: 'reply/id', rootMessageId: 'root',
};

function token(overrides: Record<string, unknown> = {}): string {
    return `header.${Buffer.from(JSON.stringify({
        aud: 'https://ic3.teams.office.com', exp: Math.floor(Date.now() / 1000) + 3600,
        oid: objectId, tid: tenantId, name: 'Test Account', ...overrides,
    })).toString('base64url')}.signature`;
}

function setup(options: Partial<ConstructorParameters<typeof Ic3Operations>[0]> = {}) {
    const acquire = vi.fn(async () => token());
    const operations = new Ic3Operations({
        region: 'amer', connectionId: 'connection-one', acquireToken: acquire, ...options,
    });
    return { acquire, operations };
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(acquireTokenViaAzCli).mockReset().mockResolvedValue(token());
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('IC3 operations', () => {
    it('constructs and reports support unconfigured, but rejects writes before credentials or network', async () => {
        const { operations, acquire } = setup({ region: undefined, requireAccountMatch: true });
        expect(operations.support({ kind: 'send', destination: self, body: text })).toEqual({ supported: true });
        expect(operations.support({ kind: 'react', message: reference, reaction: 'like' })).toEqual({ supported: true });
        for (const pending of [operations.send(self, text), operations.react(reference, 'like')]) {
            await expect(pending).rejects.toMatchObject({
                backend: 'ic3', code: 'configuration', outcome: 'not-attempted',
                message: expect.stringContaining('configure IC3 region'),
            });
        }
        expect(acquire).not.toHaveBeenCalled();
        expect(acquireTokenViaAzCli).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('isolates configured regions and credentials across simultaneous instances', async () => {
        const instances = (['amer', 'emea', 'apac'] as const).map(region => ({ region, ...setup({ region }) }));
        fetchMock.mockImplementation(async (_url, init) => init?.method === 'POST'
            ? Response.json({ OriginalArrivalTime: 123 }) : new Response(null, { status: 204 }));
        for (const { operations } of instances) {
            await operations.send(self, text);
            await operations.react(reference, 'like');
        }
        expect(fetchMock.mock.calls.map(([url]) => String(url).split('/chatsvc/')[1].split('/')[0]))
            .toEqual(['amer', 'amer', 'emea', 'emea', 'apac', 'apac']);
        for (const { acquire } of instances) expect(acquire).toHaveBeenCalledOnce();
    });

    it('allows self sends without a flag and needs no credentials or network for support checks', async () => {
        const { acquire, operations } = setup();
        expect(operations.support({ kind: 'send', destination: self, body: text }))
            .toEqual({ supported: true });
        expect(acquire).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValue(Response.json({ OriginalArrivalTime: '123' }));
        await expect(operations.send(self, text)).resolves.toMatchObject({ outcome: 'accepted' });
    });

    it('sends independently of MCP and returns backend-bound exact message identity', async () => {
        const operations = new Ic3Operations({ region: 'amer', connectionId: 'standalone' });
        fetchMock.mockResolvedValue(Response.json({ OriginalArrivalTime: '1234567890' }, { status: 201 }));
        await expect(operations.send(self, text)).resolves.toEqual({
            outcome: 'accepted', message: {
                destination: self, messageId: '1234567890', backend: 'ic3', connectionId: 'standalone',
            },
        });
        expect(acquireTokenViaAzCli).toHaveBeenCalledExactlyOnceWith(
            'https://ic3.teams.office.com', expect.any(AbortSignal));
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('fails closed without a proven primary account when hybrid matching is required', async () => {
        const { operations, acquire } = setup({ requireAccountMatch: true });
        expect(operations.support({ kind: 'send', destination: self, body: text }))
            .toEqual({ supported: true });
        await expect(operations.send(self, text)).rejects.toMatchObject({
            code: 'authentication', outcome: 'not-attempted',
        });
        await expect(operations.react(reference, 'like')).rejects.toMatchObject({
            code: 'authentication', outcome: 'not-attempted',
        });
        expect(acquire).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['text', 'a < b & "quoted"\nC:\\workspace\\file', 'a &lt; b &amp; &quot;quoted&quot;<br>C:\\workspace\\file'],
        ['html', '<b>C:\\workspace\\file</b>', '<b>C:\\workspace\\file</b>'],
    ] as const)('preserves %s semantics without MCP backslash escaping', async (contentType, content, expected) => {
        const { operations } = setup();
        fetchMock.mockResolvedValue(Response.json({ OriginalArrivalTime: 123 }));
        await operations.send(self, { content, contentType });
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).content).toBe(expected);
    });

    it.each(['mcp', 'ic3'] as const)('maps %s channel Like to exact channel and message, not root', async backend => {
        const { operations } = setup();
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        expect(operations.support({ kind: 'react', message: { ...reference, backend }, reaction: 'like' }))
            .toEqual({ supported: true });
        await operations.react({ ...reference, backend }, 'like');
        expect(fetchMock.mock.calls[0][0]).toContain(
            '/conversations/19%3Achannel%40thread.tacv2/messages/reply%2Fid/properties?name=emotions');
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
            emotions: { key: 'like', value: expect.any(Number) },
        });
    });

    it.each([
        { kind: 'send', destination: { kind: 'chat', chatId: 'chat' }, body: text },
        { kind: 'send', destination: reference.destination, body: text },
        { kind: 'send', destination: self, body: { ...text, mentions: [] } },
        { kind: 'send', destination: self, body: { ...text, mentions: [{ id: objectId, displayName: 'Test Account' }] } },
        { kind: 'reply', parent: reference, body: text },
        { kind: 'react', message: { ...reference, backend: 'graph' }, reaction: 'like' },
        { kind: 'react', message: { ...reference, connectionId: 'connection-two' }, reaction: 'like' },
        { kind: 'react', message: { ...reference, messageId: '' }, reaction: 'like' },
        { kind: 'react', message: { ...reference, destination: self }, reaction: 'like' },
        { kind: 'react', message: { ...reference, destination: { kind: 'chat', chatId: 'chat' } }, reaction: 'like' },
    ] satisfies TeamsAction[])('rejects unsupported action %# before authentication', async action => {
        const { operations, acquire } = setup();
        expect(operations.support(action).supported).toBe(false);
        const pending = action.kind === 'send' ? operations.send(action.destination, action.body)
            : action.kind === 'reply' ? operations.reply(action.parent, action.body)
                : operations.react(action.message, action.reaction);
        await expect(pending).rejects.toMatchObject({ backend: 'ic3', outcome: 'not-attempted' });
        expect(acquire).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shares credential cache across send and reaction and snapshots account options', async () => {
        const expectedAccount = { tenantId, objectId };
        const value = token();
        const acquire = vi.fn(async () => value);
        const { operations } = setup({ expectedAccount, acquireToken: acquire });
        expectedAccount.objectId = otherId;
        fetchMock.mockResolvedValueOnce(Response.json({ OriginalArrivalTime: '123' }))
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        await operations.send(self, text);
        await operations.react(reference, 'like');
        expect(acquire).toHaveBeenCalledOnce();
        for (const [, init] of fetchMock.mock.calls) {
            expect(init?.headers).toMatchObject({ Authorization: `Bearer ${value}` });
        }
    });

    it('does not treat a cached reaction credential as proof of sender identity', async () => {
        const { operations } = setup({ acquireToken: async () => token({ oid: undefined, name: undefined }) });
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        await operations.react(reference, 'like');
        await expect(operations.send(self, text)).rejects.toMatchObject({
            code: 'authentication', outcome: 'not-attempted',
        });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('keeps separate adapters and accounts isolated', async () => {
        const firstToken = token();
        const secondToken = token({ oid: otherId });
        const first = setup({ acquireToken: async () => firstToken }).operations;
        const second = setup({ connectionId: 'connection-two', acquireToken: async () => secondToken }).operations;
        fetchMock.mockImplementation(async () => Response.json({ OriginalArrivalTime: '123' }));
        await first.send(self, text);
        const receipt = await second.send(self, text);
        expect(receipt.message.connectionId).toBe('connection-two');
        expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).from))
            .toEqual([`8:orgid:${objectId}`, `8:orgid:${otherId}`]);
        await first.dispose();
        await second.send(self, text);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it.each([
        { tid: otherId }, { oid: otherId }, { tid: undefined }, { oid: undefined },
        { aud: 'https://graph.microsoft.com' }, { exp: 0 },
    ])('rejects unproven hybrid account %j before either write', async claims => {
        const { operations } = setup({
            expectedAccount: { tenantId, objectId }, acquireToken: async () => token(claims),
        });
        await expect(operations.send(self, text)).rejects.toMatchObject({
            code: 'authentication', outcome: 'not-attempted',
        });
        await expect(operations.react(reference, 'like')).rejects.toMatchObject({
            code: 'authentication', outcome: 'not-attempted',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['send', 'react'] as const)('sanitizes %s credential failure and marks not attempted', async kind => {
        const { operations } = setup({ acquireToken: async () => { throw new Error('private credential'); } });
        const pending = kind === 'send' ? operations.send(self, text) : operations.react(reference, 'like');
        await expect(pending).rejects.toMatchObject({
            backend: 'ic3', code: 'authentication', outcome: 'not-attempted',
        });
        await expect(pending).rejects.not.toThrow('private credential');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['amer', 'emea', 'apac'] as const)('uses allowlisted %s region for both writes', async region => {
        const { operations } = setup({ region });
        fetchMock.mockResolvedValueOnce(Response.json({ OriginalArrivalTime: 1 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        await operations.send(self, text);
        await operations.react(reference, 'like');
        expect(fetchMock.mock.calls.every(([url]) => String(url).includes(`/chatsvc/${region}/`))).toBe(true);
    });

    it.each(['unknown', '../amer', 'amer?x=1'])('rejects unsafe region %s before authentication', region => {
        expect(() => setup({ region: region as 'amer' })).toThrow('region must be');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['send', 'react'] as const)('does not retry %s HTTP failures, including authentication', async kind => {
        const { operations, acquire } = setup();
        for (const status of [401, 403, 429, 500]) {
            fetchMock.mockResolvedValueOnce(new Response('private provider body', {
                status, headers: { 'retry-after': '2' },
            }));
            const pending = kind === 'send' ? operations.send(self, text) : operations.react(reference, 'like');
            await expect(pending).rejects.toMatchObject({
                backend: 'ic3',
                code: status < 429 ? 'authentication' : status === 429 ? 'rate-limited' : 'rejected',
                outcome: status === 500 ? 'unknown' : 'rejected', retryAfterMs: 2000,
            });
            await expect(pending).rejects.not.toThrow('private provider body');
        }
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(acquire).toHaveBeenCalledTimes(4);
    });

    it.each(['send', 'react'] as const)('marks ambiguous %s network failures unknown without replay', async kind => {
        const { operations } = setup();
        fetchMock.mockRejectedValue(new Error('private request credentials'));
        const pending = kind === 'send' ? operations.send(self, text) : operations.react(reference, 'like');
        await expect(pending).rejects.toMatchObject({ backend: 'ic3', code: 'network', outcome: 'unknown' });
        await expect(pending).rejects.not.toThrow('private request credentials');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('preserves TeamsIc3SendError identity while exposing typed protocol failure', async () => {
        const { operations } = setup();
        fetchMock.mockResolvedValue(Response.json({}));
        const pending = operations.send(self, text);
        await expect(pending).rejects.toBeInstanceOf(TeamsIc3SendError);
        await expect(pending).rejects.toBeInstanceOf(TeamsOperationError);
        await expect(pending).rejects.toMatchObject({ code: 'protocol', outcome: 'unknown' });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each(['send', 'react'] as const)('honors pre-aborted caller for %s without credentials', async kind => {
        const { operations, acquire } = setup();
        const context = { signal: AbortSignal.abort() };
        const pending = kind === 'send' ? operations.send(self, text, context)
            : operations.react(reference, 'like', context);
        await expect(pending).rejects.toMatchObject({ code: 'unavailable', outcome: 'not-attempted' });
        expect(acquire).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['send', 'credential'], ['react', 'credential'], ['send', 'request'], ['react', 'request'],
        ['send', 'response'],
    ] as const)('bounds %s hanging %s with the shared ten-second deadline', async (kind, stage) => {
        const deadline = new AbortController();
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
        const { operations } = setup({
            acquireToken: () => stage === 'credential' ? new Promise(() => {}) : Promise.resolve(token()),
        });
        fetchMock.mockImplementation(() => stage === 'request' ? new Promise(() => {}) : Promise.resolve({
            ok: true, json: () => new Promise(() => {}),
        } as Response));
        const pending = kind === 'send' ? operations.send(self, text) : operations.react(reference, 'like');
        if (stage !== 'credential') await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        deadline.abort();
        await expect(pending).rejects.toMatchObject({
            code: 'timeout', outcome: stage === 'credential' ? 'not-attempted' : 'unknown',
        });
        expect(timeout).toHaveBeenCalledWith(10_000);
        expect(fetchMock).toHaveBeenCalledTimes(stage === 'credential' ? 0 : 1);
    });

    it.each(['send', 'react'] as const)('passes caller cancellation to the %s request', async kind => {
        const { operations } = setup();
        const caller = new AbortController();
        fetchMock.mockImplementation(() => new Promise(() => {}));
        const pending = kind === 'send' ? operations.send(self, text, { signal: caller.signal })
            : operations.react(reference, 'like', { signal: caller.signal });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        caller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'unavailable', outcome: 'unknown' });
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each(['send', 'react'] as const)('cancels %s credential acquisition without attempting a write', async kind => {
        const caller = new AbortController();
        let resolve!: (value: string) => void;
        const { operations } = setup({ acquireToken: () => new Promise(done => { resolve = done; }) });
        const pending = kind === 'send' ? operations.send(self, text, { signal: caller.signal })
            : operations.react(reference, 'like', { signal: caller.signal });
        caller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'unavailable', outcome: 'not-attempted' });
        resolve(token());
        await Promise.resolve();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('disposes safely during acquisition and prevents late credentials from writing', async () => {
        let resolve!: (value: string) => void;
        const { operations } = setup({ acquireToken: () => new Promise(done => { resolve = done; }) });
        const pending = operations.send(self, text);
        await operations.dispose();
        await expect(pending).rejects.toMatchObject({ outcome: 'not-attempted' });
        resolve(token());
        await Promise.resolve();
        await expect(operations.send(self, text)).rejects.toMatchObject({ outcome: 'not-attempted' });
        await expect(operations.react(reference, 'like')).rejects.toMatchObject({ outcome: 'not-attempted' });
        expect(operations.support({ kind: 'react', message: reference, reaction: 'like' }))
            .toEqual({ supported: false, reason: 'unavailable' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['send', 'react'] as const)('disposes an in-flight %s without replay', async kind => {
        const { operations } = setup();
        fetchMock.mockImplementation(() => new Promise(() => {}));
        const pending = kind === 'send' ? operations.send(self, text) : operations.react(reference, 'like');
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        await operations.dispose();
        await expect(pending).rejects.toMatchObject({ code: 'unavailable', outcome: 'unknown' });
        expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('clears cached credentials and prevents reuse after old client disposal', async () => {
        const acquire = vi.fn(async () => token());
        const sender = new Ic3DirectMessageClient({ region: 'amer', acquireToken: acquire });
        const reactions = new Ic3ReactionClient({ region: 'amer', acquireToken: acquire });
        fetchMock.mockResolvedValueOnce(Response.json({ OriginalArrivalTime: '123' }))
            .mockResolvedValueOnce(new Response(null, { status: 200 }))
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        await sender.send('48:notes', 'test');
        await reactions.reactToChannelMessage({ channelId: 'channel', messageId: 'message', text: '' });
        reactions.clearCredential();
        await reactions.reactToChannelMessage({ channelId: 'channel', messageId: 'message', text: '' });
        sender.dispose();
        reactions.dispose();
        await expect(sender.send('48:notes', 'test')).rejects.toMatchObject({ outcome: 'not-attempted' });
        await expect(reactions.reactToChannelMessage({ channelId: 'channel', messageId: 'message', text: '' }))
            .rejects.toMatchObject({ outcome: 'not-attempted' });
        expect(acquire).toHaveBeenCalledTimes(3);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
