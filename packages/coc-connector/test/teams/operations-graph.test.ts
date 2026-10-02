import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphClient, GraphHttpError } from '../../src/teams/graph/graph-client';
import { GraphOperations } from '../../src/teams/graph/operations-graph';
import { TeamsOperationError, type TeamsDestination, type TeamsMessageRef } from '../../src/teams/operations';

const channel = { kind: 'channel', teamId: 'team-a', channelId: '19:channel-a' } as const;
const chat = { kind: 'chat', chatId: '19:chat-a' } as const;
const text = { content: '<literal> & text', contentType: 'text' } as const;
const html = { content: '<b>Hello</b> <at id="0">Example User</at>', contentType: 'html',
    mentions: [{ id: 'user-id', displayName: 'Example User' }] } as const;
const ref = (destination: TeamsDestination = channel): TeamsMessageRef => ({
    destination, messageId: 'root-id', backend: 'graph', connectionId: 'connection-a',
});
const response = (id = 'message-id') => new Response(JSON.stringify({ id }), { status: 201 });
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};

describe('GraphOperations', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: GraphClient;
    let operations: GraphOperations;

    beforeEach(() => {
        fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()));
        vi.stubGlobal('fetch', fetchMock);
        client = new GraphClient({ bearerToken: 'example-token', teamId: 'default-team',
            channelId: 'default-channel', chatId: 'default-chat' });
        operations = new GraphOperations({ connectionId: 'connection-a', client });
    });

    afterEach(async () => {
        await operations.dispose();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it.each([channel, chat])('sends plain text to an explicit $kind destination', async destination => {
        const receipt = await operations.send(destination, text);
        expect(receipt).toEqual({ outcome: 'accepted', message: {
            destination, messageId: 'message-id', backend: 'graph', connectionId: 'connection-a',
        } });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(destination.kind === 'channel'
            ? 'https://graph.microsoft.com/v1.0/teams/team-a/channels/19%3Achannel-a/messages'
            : 'https://graph.microsoft.com/v1.0/chats/19%3Achat-a/messages');
        expect(JSON.parse(init.body)).toEqual({ body: text });
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(client.getChannelId()).toBe('default-channel');
        expect(client.getTeamId()).toBe('default-team');
        expect(client.getChatId()).toBe('default-chat');
    });

    it('preserves channel HTML and Graph mentions and chat HTML without mentions', async () => {
        await operations.send(channel, html);
        await operations.send(chat, { content: '<i>chat</i>', contentType: 'html' });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            body: { content: html.content, contentType: 'html' },
            mentions: [{ id: 0, mentionText: 'Example User',
                mentioned: { user: { id: 'user-id', displayName: 'Example User' } } }],
        });
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).body).toEqual({ content: '<i>chat</i>', contentType: 'html' });
    });

    it.each([undefined, 'thread-root'])('replies to the channel root %s and preserves mentions', async rootMessageId => {
        const parent = { ...ref(), rootMessageId };
        const receipt = await operations.reply(parent, html);
        expect(fetchMock.mock.calls[0][0]).toContain(`/messages/${rootMessageId ?? 'root-id'}/replies`);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).mentions[0].mentioned.user.id).toBe('user-id');
        expect(receipt.message.rootMessageId).toBe(rootMessageId ?? 'root-id');
        expect(receipt.message.destination).toEqual(channel);
    });

    it('honors plain text for replies', async () => {
        await operations.reply(ref(), text);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ body: text });
    });

    it.each([
        [undefined, '/messages/root-id/setReaction'],
        ['thread-root', '/messages/thread-root/replies/root-id/setReaction'],
        ['root-id', '/messages/root-id/setReaction'],
    ])('Likes the exact root or reply (%s)', async (rootMessageId, suffix) => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        await operations.react({ ...ref(), rootMessageId }, 'like');
        expect(fetchMock.mock.calls[0][0]).toBe(`https://graph.microsoft.com/v1.0/teams/team-a/channels/19%3Achannel-a${suffix}`);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reactionType: '👍' });
    });

    it('rejects unsupported writes before any network activity', async () => {
        const cases = [
            operations.send({ kind: 'self' }, text),
            operations.send(chat, html),
            operations.reply(ref(chat), text),
            operations.react(ref(chat), 'like'),
        ];
        for (const result of cases) {
            await expect(result).rejects.toMatchObject({ code: 'unsupported', outcome: 'not-attempted' });
        }
        expect(operations.support({ kind: 'send', destination: { kind: 'self' }, body: text })).toEqual({
            supported: false, reason: 'unsupported',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        { backend: 'mcp' as const },
        { connectionId: 'connection-b' },
        { messageId: '' },
        { rootMessageId: '' },
    ])('rejects foreign or malformed refs %j', async change => {
        await expect(operations.reply({ ...ref(), ...change }, text)).rejects.toMatchObject({
            code: 'invalid-target', outcome: 'not-attempted',
        });
        await expect(operations.react({ ...ref(), ...change }, 'like')).rejects.toMatchObject({
            code: 'invalid-target', outcome: 'not-attempted',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps concurrent channel and chat targets and receipts independent', async () => {
        const pending = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
        pending.forEach(item => fetchMock.mockImplementationOnce(() => item.promise));
        const second = { ...channel, teamId: 'team-b', channelId: '19:channel-b' };
        const promises = [operations.send(channel, text), operations.send(second, text), operations.send(chat, text)];
        pending[2].resolve(response('chat-result'));
        pending[1].resolve(response('second-result'));
        pending[0].resolve(response('first-result'));
        const receipts = await Promise.all(promises);
        expect(receipts.map(receipt => receipt.message.destination)).toEqual([channel, second, chat]);
        expect(receipts.map(receipt => receipt.message.messageId)).toEqual(['first-result', 'second-result', 'chat-result']);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            'https://graph.microsoft.com/v1.0/teams/team-a/channels/19%3Achannel-a/messages',
            'https://graph.microsoft.com/v1.0/teams/team-b/channels/19%3Achannel-b/messages',
            'https://graph.microsoft.com/v1.0/chats/19%3Achat-a/messages',
        ]);
    });

    it('refreshes and retries once only after a definite HTTP 401', async () => {
        const refresh = vi.fn().mockResolvedValue('refreshed-example-token');
        operations = new GraphOperations({ connectionId: 'connection-a', client, onTokenRefresh: refresh });
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
        await operations.send(channel, text);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-example-token');
        expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
    });

    it.each(['send', 'react'])('releases an unread %s error body before the refreshed retry', async operation => {
        const cancel = vi.fn();
        const errorBody = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(1024)); },
            cancel,
        });
        const refresh = vi.fn(async () => {
            expect(cancel).toHaveBeenCalledOnce();
            return 'refreshed-example-token';
        });
        operations = new GraphOperations({ connectionId: 'connection-a', client, onTokenRefresh: refresh });
        fetchMock.mockResolvedValueOnce(new Response(errorBody, { status: 401 }));
        if (operation === 'react') {
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
            await operations.react(ref(), 'like');
        } else {
            await operations.send(channel, text);
        }
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('does not refresh a second 401 or retry a failed refresh', async () => {
        const refresh = vi.fn().mockResolvedValue('refreshed-example-token');
        operations = new GraphOperations({ connectionId: 'connection-a', client, onTokenRefresh: refresh });
        fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 401 })));
        await expect(operations.send(channel, text)).rejects.toMatchObject({ code: 'authentication', outcome: 'rejected' });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        refresh.mockRejectedValueOnce(new Error('refresh unavailable'));
        await expect(operations.send(channel, text)).rejects.toMatchObject({ code: 'authentication', outcome: 'rejected' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it.each([
        [new Error('Graph API POST 401'), 'network', 'unknown'],
        [new TypeError('fetch failed'), 'network', 'unknown'],
        [new GraphHttpError(500), 'unavailable', 'unknown'],
        [new GraphHttpError(408), 'timeout', 'unknown'],
        [new GraphHttpError(403), 'rejected', 'rejected'],
        [new GraphHttpError(429, '2'), 'rate-limited', 'rejected'],
    ])('maps failures accurately without replay (%s)', async (error, code, outcome) => {
        const refresh = vi.fn();
        operations = new GraphOperations({ connectionId: 'connection-a', client, onTokenRefresh: refresh });
        fetchMock.mockRejectedValueOnce(error);
        await expect(operations.send(channel, text)).rejects.toMatchObject({
            backend: 'graph', code, outcome,
            ...(code === 'rate-limited' ? { retryAfterMs: 2000 } : {}),
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
    });

    it('exposes a typed HTTP rejection without consuming an untrusted response body', async () => {
        fetchMock.mockResolvedValueOnce(new Response('sensitive upstream detail', {
            status: 429, headers: { 'Retry-After': '3' },
        }));
        await expect(operations.send(channel, text)).rejects.toMatchObject({
            code: 'rate-limited', outcome: 'rejected', retryAfterMs: 3000, message: 'Graph request failed (HTTP 429)',
        });
    });

    it.each([{}, { id: '' }, { id: 42 }, null, { id: '  ' }])('rejects malformed success IDs %j', async payload => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 201 }));
        await expect(operations.send(channel, text)).rejects.toMatchObject({ code: 'protocol', outcome: 'unknown' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed success JSON without replay', async () => {
        fetchMock.mockResolvedValueOnce(new Response('invalid JSON', { status: 201 }));
        await expect(operations.send(channel, text)).rejects.toMatchObject({ code: 'protocol', outcome: 'unknown' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects pre-aborted operations without sending', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(operations.send(channel, text, { signal: controller.signal })).rejects.toMatchObject({
            code: 'timeout', outcome: 'not-attempted',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('bounds hung writes even when fetch ignores abort', async () => {
        vi.useFakeTimers();
        operations = new GraphOperations({ connectionId: 'connection-a', client, timeoutMs: 25 });
        fetchMock.mockImplementationOnce(() => new Promise(() => {}));
        const assertion = expect(operations.send(channel, text)).rejects.toMatchObject({ code: 'timeout', outcome: 'unknown' });
        await vi.advanceTimersByTimeAsync(25);
        await assertion;
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels an in-flight write and does not retry its late 401', async () => {
        const refresh = vi.fn();
        operations = new GraphOperations({ connectionId: 'connection-a', client, onTokenRefresh: refresh });
        const pending = deferred<Response>();
        fetchMock.mockReturnValueOnce(pending.promise);
        const controller = new AbortController();
        const assertion = expect(operations.send(channel, text, { signal: controller.signal })).rejects.toMatchObject({
            code: 'timeout', outcome: 'unknown',
        });
        controller.abort();
        await assertion;
        pending.resolve(new Response(null, { status: 401 }));
        await new Promise(resolve => setImmediate(resolve));
        expect(refresh).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['dispose', 'abort', 'deadline'])('prevents late retries after %s during refresh', async cancellation => {
        vi.useFakeTimers();
        const refreshed = deferred<string>();
        const started = deferred<void>();
        operations = new GraphOperations({
            connectionId: 'connection-a', client, timeoutMs: 25,
            onTokenRefresh: () => { started.resolve(); return refreshed.promise; },
        });
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
        const controller = new AbortController();
        const result = operations.send(channel, text, { signal: controller.signal });
        const assertion = expect(result).rejects.toBeInstanceOf(TeamsOperationError);
        await started.promise;
        if (cancellation === 'dispose') await operations.dispose();
        else if (cancellation === 'abort') controller.abort();
        else await vi.advanceTimersByTimeAsync(25);
        await assertion;
        refreshed.resolve('late-example-token');
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('disposes active requests and rejects new sends', async () => {
        fetchMock.mockImplementationOnce(() => new Promise(() => {}));
        const pending = expect(operations.send(channel, text)).rejects.toMatchObject({
            code: 'unavailable', outcome: 'unknown',
        });
        await operations.dispose();
        await pending;
        await expect(operations.send(channel, text)).rejects.toMatchObject({ code: 'unavailable', outcome: 'not-attempted' });
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await operations.dispose();
    });
});
