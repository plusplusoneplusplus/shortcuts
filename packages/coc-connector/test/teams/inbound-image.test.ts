import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphChannelReader } from '../../src/teams/graph/channel-reader';

const account = { tenantId: 'tenant', objectId: 'user' };
const token = (patch: Record<string, unknown> = {}) => 'header.' + Buffer.from(JSON.stringify({
    tid: account.tenantId, oid: account.objectId, aud: 'https://graph.microsoft.com',
    scp: 'ChannelMessage.Read.All', exp: Math.floor(Date.now() / 1000) + 3600, ...patch,
})).toString('base64url') + '.signature';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const base = 'https://graph.microsoft.com/v1.0/teams/team/channels/19%3Achannel%40thread.tacv2/messages';
const contentUrl = `${base}/message/hostedContents/opaque%2Bid%3D/$value`;
const html = '<p><img src="../hostedContents/opaque%2Bid%3D/$value"></p>';
const binary = (data = png, contentType = 'image/png', extraHeaders = {}) =>
    new Response(data, { headers: { 'Content-Type': contentType, ...extraHeaders } });

async function setup(options: { html?: string; rootId?: string; receiveImages?: boolean;
    acquireToken?: (signal: AbortSignal) => Promise<string> } = {}) {
    const acquireToken = vi.fn(options.acquireToken ?? (async () => token()));
    const reader = new GraphChannelReader(account, { acquireToken }, options.receiveImages ?? true);
    const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
        value: [{ id: 'message', body: { content: options.html ?? html, contentType: 'html' },
            from: { user: { id: 'sender', displayName: 'Person' } }, createdDateTime: '2026-01-01T00:00:01Z' }],
    })));
    vi.stubGlobal('fetch', fetch);
    await reader.initialize();
    const page = await reader.page('team', '19:channel@thread.tacv2', options.rootId);
    fetch.mockClear();
    fetch.mockImplementation(async () => binary());
    return { reader, fetch, acquireToken, message: page.messages[0], image: page.messages[0].images?.[0]! };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Graph channel image transport', () => {
    it('treats Teams HTML whitespace as captionless and decodes caption instructions once', async () => {
        const s = await setup({ html: `<p>&nbsp;&#160;&#xa0;${html}</p>` });
        expect(s.message.text).toBe('');
        expect(s.message.images).toHaveLength(1);
        s.reader.stop();
        const t = await setup({ html: `<p>compare x &lt; y &amp; z &gt; 1: &amp;lt;</p>${html}` });
        expect(t.message.text).toBe('compare x < y & z > 1: &lt;');
        t.reader.stop();
    });

    it('preserves a caption and native sender while lazily fetching authenticated hosted bytes', async () => {
        const s = await setup({ html: `<p>/ask [chat] describe this</p>${html}` });
        expect(s.message).toMatchObject({ text: '/ask [chat] describe this', senderAadId: 'sender', senderName: 'Person' });
        expect(s.fetch).not.toHaveBeenCalled();
        expect(await s.image.download({ maxBytes: png.length })).toEqual(png);
        expect(s.image.mimeType).toBe('image/png');
        expect(s.fetch).toHaveBeenCalledExactlyOnceWith(contentUrl, expect.objectContaining({
            method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
            headers: { Authorization: `Bearer ${token()}` },
        }));
        s.reader.stop();
    });

    it('retains captionless images and uses the exact reply endpoint', async () => {
        const s = await setup({ rootId: 'root' });
        expect(s.message.text).toBe('');
        expect(s.message.replyToMessageId).toBe('root');
        await s.image.download({ maxBytes: 100 });
        expect(s.fetch.mock.calls[0][0]).toBe(`${base}/root/replies/message/hostedContents/opaque%2Bid%3D/$value`);
        s.reader.stop();
    });

    it.each(['v1.0', 'beta'])('recognizes an absolute %s path with raw Teams channel IDs', async version => {
        const src = contentUrl.replace('/v1.0/', `/${version}/`).replace('19%3Achannel%40thread.tacv2', '19:channel@thread.tacv2');
        const s = await setup({ html: `<img src='${src}'>` });
        await s.image.download({ maxBytes: 100 });
        expect(s.fetch.mock.calls[0][0]).toBe(contentUrl);
        s.reader.stop();
    });

    it('retains multiple image order, deduplicates hosted IDs and excludes Teams emoji', async () => {
        const s = await setup({ html: html + html
            + '<img src="../hostedContents/second/$value">'
            + '<img src="https://emoji.example.test/smile.png" itemtype="http://schema.skype.com/Emoji">' });
        expect(s.message.images).toHaveLength(2);
        for (const image of s.message.images!) await image.download({ maxBytes: 100 });
        expect(s.fetch.mock.calls.map(([url]) => url)).toEqual([contentUrl, `${base}/message/hostedContents/second/$value`]);
        s.reader.stop();
    });

    it('keeps default consumers text-only without image requests', async () => {
        const s = await setup({ receiveImages: false });
        expect(s.message.images).toBeUndefined();
        expect(s.fetch).not.toHaveBeenCalled();
        s.reader.stop();
    });

    it.each([
        'https://untrusted.test/image.png', 'http://graph.microsoft.com/image.png',
        contentUrl.replace('/teams/team/', '/teams/other/'),
        contentUrl.replace('/channels/19%3Achannel%40thread.tacv2/', '/channels/other/'),
        contentUrl.replace('/messages/message/', '/messages/other/'),
        contentUrl.replace('graph.microsoft.com/', 'user:password@graph.microsoft.com/'),
        contentUrl + '?token=secret', contentUrl + '#fragment',
        '../hostedContents/../$value', 'data:image/png;base64,secret', '%broken',
    ])('rejects an unscoped image source without any credential-bearing request: %s', async src => {
        const s = await setup({ html: `<img src="${src}">` });
        await expect(s.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'unsupported' });
        expect(s.fetch).not.toHaveBeenCalled();
        s.reader.stop();
    });

    it('rejects a root image URL used by a reply and malformed/missing sources', async () => {
        const s = await setup({ rootId: 'root', html: `<img src="${contentUrl}"><img><img src="">` });
        for (const image of s.message.images!) {
            await expect(image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'unsupported' });
        }
        expect(s.fetch).not.toHaveBeenCalled();
        s.reader.stop();
    });

    it.each(['image/svg+xml', 'text/html', '', 'constructor', 'image/jpeg'])('rejects unsupported/mismatched HTTP content type %s', async type => {
        const s = await setup();
        s.fetch.mockImplementation(async () => binary(png, type));
        await expect(s.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'unsupported' });
        s.reader.stop();
    });

    it.each([
        ['image/png', png], ['image/jpeg', Buffer.from([255, 216, 255, 0])],
        ['image/gif', Buffer.from('GIF89a')], ['image/webp', Buffer.from('RIFF1234WEBP')],
    ])('resolves MIME from an authenticated %s response', async (type, data) => {
        const s = await setup();
        s.fetch.mockImplementation(async () => binary(data, `${type.toUpperCase()}; charset=binary`));
        expect(await s.image.download({ maxBytes: 100 })).toEqual(data);
        expect(s.image.mimeType).toBe(type);
        s.reader.stop();
    });

    it.each([false, true])('enforces actual/declared byte bounds (declared: %s)', async declared => {
        const s = await setup();
        const cancel = vi.fn();
        s.fetch.mockImplementation(async () => new Response(new ReadableStream({
            start(controller) { controller.enqueue(png); }, cancel,
        }), { headers: { 'content-type': 'image/png', ...(declared ? { 'content-length': '1000' } : {}) } }));
        await expect(s.image.download({ maxBytes: png.length - 1 })).rejects.toMatchObject({ code: 'size-limit' });
        expect(cancel).toHaveBeenCalledOnce();
        s.reader.stop();
    });

    it.each([302, 403, 404, 429, 500])('sanitizes HTTP %s failures without replay', async status => {
        const s = await setup();
        s.fetch.mockImplementation(async () => new Response('sensitive provider body', { status }));
        await expect(s.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'download',
            message: 'Could not download the image. Send the image again.' });
        expect(s.fetch).toHaveBeenCalledOnce();
        s.reader.stop();
    });

    it('refreshes credentials once on 401, with the same account and endpoint', async () => {
        const s = await setup();
        const fresh = token({ exp: Math.floor(Date.now() / 1000) + 7200 });
        s.acquireToken.mockResolvedValueOnce(fresh);
        s.fetch.mockResolvedValueOnce(new Response('secret', { status: 401 }));
        expect(await s.image.download({ maxBytes: 100 })).toEqual(png);
        expect(s.acquireToken).toHaveBeenCalledTimes(2);
        expect(s.fetch.mock.calls.map(([url]) => url)).toEqual([contentUrl, contentUrl]);
        expect(s.fetch.mock.calls[1][1]?.headers).toEqual({ Authorization: `Bearer ${fresh}` });
        s.reader.stop();
    });

    it('never replays repeated authentication rejection or sends a mismatched refreshed identity', async () => {
        const s = await setup();
        s.fetch.mockImplementation(async () => new Response('secret', { status: 401 }));
        await expect(s.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'download' });
        expect(s.fetch).toHaveBeenCalledTimes(2);
        s.fetch.mockClear();
        s.acquireToken.mockResolvedValueOnce(token({ oid: 'other-account' }));
        await expect(s.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'download' });
        expect(s.fetch).toHaveBeenCalledOnce();
        s.reader.stop();
    });

    it('sanitizes fetch/stream errors and rejects empty responses', async () => {
        const s = await setup();
        s.fetch.mockRejectedValueOnce(new Error('Authorization: secret'));
        await expect(s.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'download',
            message: 'Could not download the image. Send the image again.' });
        s.fetch.mockResolvedValueOnce(new Response(null));
        await expect(s.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'download' });
        s.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
            start(controller) { controller.error(new Error('secret stream URL')); },
        }), { headers: { 'content-type': 'image/png' } }));
        await expect(s.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'download' });
        s.reader.stop();
    });

    it.each(['caller', 'stop', 'timeout'] as const)('cancels a stalled response stream on %s', async cause => {
        vi.useFakeTimers();
        const s = await setup();
        const cancel = vi.fn();
        s.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
            start(controller) { controller.enqueue(png); }, cancel,
        }), { headers: { 'content-type': 'image/png' } }));
        const controller = new AbortController();
        const download = s.image.download({ maxBytes: 100, timeoutMs: 100, signal: controller.signal });
        const rejected = expect(download).rejects.toMatchObject({ code: cause === 'timeout' ? 'timeout' : 'cancelled' });
        await vi.advanceTimersByTimeAsync(0);
        if (cause === 'caller') controller.abort();
        if (cause === 'stop') s.reader.stop();
        if (cause === 'timeout') await vi.advanceTimersByTimeAsync(100);
        await rejected;
        await vi.advanceTimersByTimeAsync(0);
        expect(cancel).toHaveBeenCalledOnce();
        s.reader.stop();
    });

    it('bounds token refresh acquisition and cancels a late response after stop', async () => {
        vi.useFakeTimers();
        const s = await setup();
        s.acquireToken.mockImplementationOnce(() => new Promise(() => {}));
        s.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
        const rejected = expect(s.image.download({ maxBytes: 100, timeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout' });
        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        const t = await setup();
        let release!: (response: Response) => void;
        t.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const stopped = expect(t.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'cancelled' });
        await vi.advanceTimersByTimeAsync(0);
        t.reader.stop();
        await stopped;
        const cancel = vi.fn();
        release(new Response(new ReadableStream({ cancel })));
        await vi.advanceTimersByTimeAsync(0);
        expect(cancel).toHaveBeenCalledOnce();
        await expect(t.image.download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'cancelled' });
        expect(t.fetch).toHaveBeenCalledOnce();
        s.reader.stop();
    });
});
