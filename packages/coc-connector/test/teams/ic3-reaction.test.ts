import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ic3ReactionClient } from '../../src/teams/ic3/ic3-reaction';

const resource = 'https://ic3.teams.office.com';
const fetchMock = vi.fn<typeof fetch>();

function token(aud = resource, exp = Math.floor(Date.now() / 1000) + 3600): string {
    return `header.${Buffer.from(JSON.stringify({ aud, exp })).toString('base64url')}.signature`;
}

describe('IC3 channel Like', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('rejects unset region before invoking a supplied credential provider or network', async () => {
        const acquire = vi.fn(async () => token());
        for (const client of [new Ic3ReactionClient(acquire), new Ic3ReactionClient()]) {
            const pending = client.reactToChannelMessage({ channelId: 'channel', messageId: 'root', text: 'ask' });
            await expect(pending).rejects.toMatchObject({
                backend: 'ic3', code: 'configuration', outcome: 'not-attempted',
                message: expect.stringContaining('reconnect'),
            });
        }
        expect(acquire).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([301, 403, 404, 500])('does not diagnose or probe another region on HTTP %s', async status => {
        const client = new Ic3ReactionClient({ region: 'apac', acquireToken: async () => token() });
        fetchMock.mockResolvedValueOnce(new Response(null, { status }));
        const pending = client.reactToChannelMessage({ channelId: 'channel', messageId: 'root', text: 'ask' });
        await expect(pending).rejects.toThrow('check IC3 region configuration');
        await expect(pending).rejects.not.toThrow(/wrong region/i);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toContain('/chatsvc/apac/');
    });

    it('targets the exact root or reply via Teams cloud with the separate IC3 credential', async () => {
        const acquire = vi.fn(async () => token());
        const client = new Ic3ReactionClient({ region: 'amer', acquireToken: acquire });
        fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_790_750_000_000);

        await client.reactToChannelMessage({ channelId: '19:channel@thread.tacv2', messageId: 'root', text: 'ask' });
        await client.reactToChannelMessage({
            channelId: '19:channel@thread.tacv2', messageId: 'reply', replyToMessageId: 'root', text: 'follow-up',
        });

        expect(acquire).toHaveBeenCalledOnce();
        expect(acquire.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const calls = fetchMock.mock.calls;
        expect(calls.map(([url]) => url)).toEqual([
            'https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/19%3Achannel%40thread.tacv2/messages/root/properties?name=emotions',
            'https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/19%3Achannel%40thread.tacv2/messages/reply/properties?name=emotions',
        ]);
        for (const [, options] of calls) {
            expect(options?.method).toBe('PUT');
            expect(options?.headers).toMatchObject({ Authorization: `Bearer ${token()}` });
            expect(options?.body).toBe(JSON.stringify({ emotions: { key: 'like', value: now() } }));
            expect(options?.signal).toBeInstanceOf(AbortSignal);
            expect(options?.redirect).toBe('error');
        }
    });

    it.each([
        ['wrong audience', () => token('https://graph.microsoft.com')],
        ['expired token', () => token(resource, Math.floor(Date.now() / 1000) - 1)],
        ['invalid token', () => 'not-a-token'],
    ])('refuses a %s without making a request', async (_label, makeToken) => {
        const client = new Ic3ReactionClient({ region: 'amer', acquireToken: async () => makeToken() });
        await expect(client.reactToChannelMessage({ channelId: 'channel', messageId: 'message', text: 'ask' }))
            .rejects.toThrow('invalid IC3 credential');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a missing target before acquiring a credential', async () => {
        const acquire = vi.fn(async () => token());
        const client = new Ic3ReactionClient({ region: 'amer', acquireToken: acquire });
        await expect(client.reactToChannelMessage({ channelId: '', messageId: 'message', text: 'ask' }))
            .rejects.toThrow('missing message target');
        expect(acquire).not.toHaveBeenCalled();
    });

    it('surfaces credential failure without exposing credential provider details', async () => {
        const client = new Ic3ReactionClient({ region: 'amer', acquireToken: async () => { throw new Error('private auth details'); } });
        await expect(client.reactToChannelMessage({ channelId: 'channel', messageId: 'message', text: 'ask' }))
            .rejects.toThrow('IC3 credential could not be acquired');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects HTTP failures without reading provider bodies and reacquires after 401', async () => {
        const acquire = vi.fn(async () => token());
        const client = new Ic3ReactionClient({ region: 'amer', acquireToken: acquire });
        fetchMock.mockResolvedValueOnce(new Response('private error details', { status: 401 }))
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        const msg = { channelId: 'channel', messageId: 'message', text: 'ask' };
        await expect(client.reactToChannelMessage(msg)).rejects.toThrow('HTTP 401');
        await client.reactToChannelMessage(msg);
        expect(acquire).toHaveBeenCalledTimes(2);
    });

    it('reports other rejected and failed requests without leaking provider details', async () => {
        const client = new Ic3ReactionClient({ region: 'amer', acquireToken: async () => token() });
        const msg = { channelId: 'channel', messageId: 'message', text: 'ask' };
        fetchMock.mockResolvedValueOnce(new Response('private response', { status: 500 }))
            .mockRejectedValueOnce(new Error('private network details'));
        await expect(client.reactToChannelMessage(msg)).rejects.toThrow('HTTP 500');
        await expect(client.reactToChannelMessage(msg)).rejects.toThrow('Teams channel Like reaction failed');
    });

    it('aborts an unresponsive request and reports the timeout', async () => {
        const controller = new AbortController();
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
        fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('private abort detail')));
        }));
        const client = new Ic3ReactionClient({ region: 'amer', acquireToken: async () => token() });
        const pending = client.reactToChannelMessage({ channelId: 'channel', messageId: 'message', text: 'ask' });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        controller.abort();
        await expect(pending).rejects.toThrow('Teams channel Like reaction timed out');
    });

    it('bounds credential acquisition under the same deadline', async () => {
        const controller = new AbortController();
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
        const client = new Ic3ReactionClient({ region: 'amer', acquireToken: signal => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('private credential detail')));
        }) });
        const pending = client.reactToChannelMessage({ channelId: 'channel', messageId: 'message', text: 'ask' });
        controller.abort();
        await expect(pending).rejects.toThrow('Teams channel Like reaction timed out');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
