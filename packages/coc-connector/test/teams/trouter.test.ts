import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTrouterFrame, TrouterClient, trouterAccount, type TrouterSocket } from '../../src/teams/trouter';
import { IC3_RESOURCE } from '../../src/teams/ic3/ic3-direct-message-config';

const account = { tenantId: '11111111-1111-4111-8111-111111111111', objectId: '22222222-2222-4222-8222-222222222222' };
const target = '19:channel@thread.tacv2';
const acceptTarget = (id: string) => id === target;
const path = 'https://go.trouter.teams.microsoft.com/v4/a/endpoint';
const event = (name: string, args: unknown[] = [], ack = '') => `5:${ack}::${JSON.stringify({ name, args })}`;
const connected = () => event('trouter.connected', [{ surl: path }], '7+');
const jwt = (claims: object = {}, expiresIn = 3600) => `header.${Buffer.from(JSON.stringify({
    aud: IC3_RESOURCE, tid: account.tenantId, oid: account.objectId, exp: Date.now() / 1000 + expiresIn, ...claims,
})).toString('base64url')}.signature`;
const notification = (resource: object, body: object = {}) => `3:::${JSON.stringify({
    id: 'request', body: { type: 'EventMessage', resourceType: 'NewMessage', resource, ...body },
})}`;
const update = (resource: object, body: object = {}) => notification(resource, { resourceType: 'MessageUpdate', ...body });
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

class Socket implements TrouterSocket {
    readyState = 1;
    bufferedAmount = 0;
    sent: string[] = [];
    closed = false;
    listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
    addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string, data?: unknown) { this.listeners.get(type)?.forEach(fn => fn({ data })); }
    send(data: string) { this.sent.push(data); }
    close() { this.closed = true; }
}

describe('Trouter protocol', () => {
    it('responds to heartbeat and event ACKs', () => {
        expect(parseTrouterFrame('2::', acceptTarget).send).toEqual(['2::']);
        expect(parseTrouterFrame(connected(), acceptTarget)).toEqual({ send: ['6:::7+[]'], registrationPath: path });
    });
    it('ACKs HTTP before ignoring unrelated notifications', () => {
        const result = parseTrouterFrame(notification({ to: '19:unrelated@thread.tacv2' }), acceptTarget);
        expect(result.send).toEqual(['3:::{"id":"request","status":200,"headers":{}}']);
        expect(result.wake).toBeUndefined();
    });
    it('prefers real source thread and reply chain over synthetic activity stream', () => {
        const result = parseTrouterFrame(notification({
            to: '48:notifications', properties: { activity: {
                sourceThreadId: encodeURIComponent(target), sourceReplyChainId: 'root',
            } },
        }), acceptTarget);
        expect(result.wake).toEqual({ cause: 'message', conversationId: target, rootMessageId: 'root' });
    });
    it('never lets synthetic or missing source activate the configured channel', () => {
        expect(parseTrouterFrame(notification({ to: '48:notifications' }), acceptTarget).wake).toBeUndefined();
        expect(parseTrouterFrame(notification({}), acceptTarget).wake).toBeUndefined();
        expect(parseTrouterFrame(notification({ to: target, properties: {
            activity: { sourceThreadId: '19:unrelated@thread.tacv2' },
        } }), acceptTarget).wake).toBeUndefined();
    });
    it('normalizes conversation URLs and JSON string envelopes', () => {
        const body = JSON.stringify({ type: 'EventMessage', resourceType: 'NewMessage',
            resource: JSON.stringify({ conversationLink: `https://example.test/conversations/${encodeURIComponent(target)}/messages/message`,
                parentMessageId: 'root' }) });
        expect(parseTrouterFrame(`3:::${JSON.stringify({ id: 42, body })}`, acceptTarget).wake)
            .toMatchObject({ conversationId: target, rootMessageId: 'root' });
    });
    it('message loss forces reconciliation', () => {
        expect(parseTrouterFrame(event('trouter.message_loss'), acceptTarget).wake).toEqual({ cause: 'message-loss' });
    });
    it.each(['48:notes', '19:direct@thread.v2', '19:group@unq.gbl.spaces'])(
        'exposes reaction updates from explicitly accepted chat %s independently of message wakes', conversationId => {
            const emotions = [{ key: 'smilerobot', users: [{ mri: `8:orgid:${account.objectId}`, time: Date.now(), value: '' }] }];
            const result = parseTrouterFrame(update({
                id: 'source-message', to: conversationId, from: '8:orgid:another-user',
                parentMessageId: 'quoted-parent', properties: { emotions },
            }), id => id === conversationId);
            expect(result.send).toEqual(['3:::{"id":"request","status":200,"headers":{}}']);
            expect(result.wake).toBeUndefined();
            expect(result.messageUpdate).toEqual({
                conversationId, messageId: 'source-message', rootMessageId: 'quoted-parent', emotions,
            });
        });
    it('normalizes JSON string envelopes and prefers source identity for updates', () => {
        const chat = '19:group@thread.v2';
        const resource = JSON.stringify({ id: 'message', to: '48:notifications',
            properties: JSON.stringify({ emotions: '[]', activity: { sourceThreadId: encodeURIComponent(chat),
                sourceReplyChainId: 'root' } }) });
        const body = JSON.stringify({ type: 'EventMessage', resourceType: 'MessageUpdate', resource,
            time: '2026-01-01T00:00:00.001Z' });
        expect(parseTrouterFrame(`3:::${JSON.stringify({ id: 42, body })}`, id => id === chat).messageUpdate)
            .toEqual({ conversationId: chat, messageId: 'message', rootMessageId: 'root', emotions: '[]',
                eventTime: '2026-01-01T00:00:00.001Z' });
    });
    it.each([[], null, '[]'])('preserves empty/removal payload %j without interpreting it as a trigger', emotions => {
        const result = parseTrouterFrame(update({ id: 'message', to: '48:notes', properties: { emotions } }), () => true);
        expect(result.messageUpdate?.emotions).toEqual(emotions);
        expect(result.wake).toBeUndefined();
    });
    it.each(['2026-01-01T00:00:00.123Z', 1_800_000_000_000, null, 'invalid', { time: 42 }])(
        'preserves native event time without interpreting it: %j', time => {
            const result = parseTrouterFrame(update({
                id: 'message', to: '48:notes', originalarrivaltime: '2000-01-01T00:00:00Z',
                version: '1', properties: { emotions: [] },
            }, { time }), () => true);
            expect(result.messageUpdate).toMatchObject({ eventTime: time });
            expect(result.wake).toBeUndefined();
        },
    );
    it('does not invent event time from target metadata or transport receipt', () => {
        const result = parseTrouterFrame(update({
            id: 'message', to: '48:notes', originalarrivaltime: '2026-01-01T00:00:00Z',
            composetime: '2026-01-01T00:00:00Z', version: String(Date.now()),
            properties: { emotions: [] },
        }), () => true);
        expect(result.messageUpdate).not.toHaveProperty('eventTime');
    });
    it.each([
        { id: 'message', to: target, properties: { emotions: [] } },
        { id: 'message', to: '48:notifications', properties: { emotions: [] } },
        { id: 'message', to: '48:unknown', properties: { emotions: [] } },
        { id: 'message', to: '19:meeting@thread.skype', properties: { emotions: [] } },
        { id: 'message', to: '48:notes', properties: {} },
        { id: 'message', to: '48:notes', content: 'edited text' },
        { to: '48:notes', properties: { emotions: [] } },
        { id: '', to: '48:notes', properties: { emotions: [] } },
        { id: 'bad/id', to: '48:notes', properties: { emotions: [] } },
        { id: 'bad\nid', to: '48:notes', properties: { emotions: [] } },
        { id: 'message', properties: { emotions: [] } },
    ])('ACKs but excludes unsupported, untargeted or incomplete reaction updates: %j', resource => {
        const result = parseTrouterFrame(update(resource), () => true);
        expect(result.send).toHaveLength(1);
        expect(result.messageUpdate).toBeUndefined();
        expect(result.wake).toBeUndefined();
    });
    it('never exposes updates for inactive targets, unselected chats or other notification types', () => {
        const resource = { id: 'message', to: '48:notes', properties: { emotions: [] } };
        expect(parseTrouterFrame(update(resource), null).messageUpdate).toBeUndefined();
        expect(parseTrouterFrame(update(resource), acceptTarget).messageUpdate).toBeUndefined();
        expect(parseTrouterFrame(update(resource, { type: 'Other' }), () => true).messageUpdate).toBeUndefined();
        expect(parseTrouterFrame(update(resource, { resourceType: 'MessageDelete' }), () => true).messageUpdate).toBeUndefined();
        const newMessage = parseTrouterFrame(notification(resource), () => true);
        expect(newMessage.messageUpdate).toBeUndefined();
        expect(newMessage.wake?.conversationId).toBe('48:notes');
    });
    it('supports an explicit multi-chat policy without accepting channels or synthetic notification streams', () => {
        const accept = (id: string) => id === '48:notes' || /^19:[\w-]+@thread\.v2$/.test(id);
        for (const id of ['48:notes', '19:direct@thread.v2', '19:group@thread.v2']) {
            expect(parseTrouterFrame(notification({ to: id }), accept).wake)
                .toMatchObject({ cause: 'message', conversationId: id });
        }
        for (const id of ['48:notifications', '48:unknown', target]) {
            expect(parseTrouterFrame(notification({ to: id }), accept).wake).toBeUndefined();
        }
        expect(parseTrouterFrame(notification({ to: '48:notes' }), acceptTarget).wake).toBeUndefined();
    });
    it.each(['48:notes', target])('ACKs %s without waking when the target is inactive', id => {
        const result = parseTrouterFrame(notification({ to: id }), null);
        expect(result.send).toEqual(['3:::{"id":"request","status":200,"headers":{}}']);
        expect(result.wake).toBeUndefined();
    });
    it.each(['48:notifications', '48:unknown'])('excludes synthetic %s even with a permissive predicate', id => {
        expect(parseTrouterFrame(notification({ to: id }), () => true).wake).toBeUndefined();
    });
    it.each(['garbage', '3:::{}', '3:::not-json', '5:::{}broken', '0::', '7:::error',
        notification({ to: '%ZZ' }), '3:::' + 'x'.repeat(256 * 1024)])('rejects malformed/oversized frames', raw => {
        expect(() => parseTrouterFrame(raw, acceptTarget)).toThrow();
    });
    it.each(['http://go.trouter.teams.microsoft.com/path', 'ftp://example.test/path',
        'https://example.test/\u0000path',
        'https://user:pass@go.trouter.teams.microsoft.com/path'])('rejects unsafe registrar forwarding paths', surl => {
        expect(() => parseTrouterFrame(event('trouter.connected', [{ surl }]), acceptTarget)).toThrow();
    });
    it('accepts opaque HTTPS forwarding paths without using them as fetch targets', () => {
        const forwardingPath = 'https://example.test/opaque';
        expect(parseTrouterFrame(event('trouter.connected', [{ surl: forwardingPath }]), acceptTarget).registrationPath)
            .toBe(forwardingPath);
    });
    it('reader identity must be present and valid independently of audience', () => {
        expect(trouterAccount(jwt({ aud: 'reader-resource' }))).toEqual(account);
        expect(() => trouterAccount('opaque')).toThrow('identity');
        expect(() => trouterAccount(jwt({ oid: 'invalid' }))).toThrow('identity');
    });
});

describe('Trouter lifecycle', () => {
    const clients: TrouterClient[] = [];
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
    afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.stop())); vi.restoreAllMocks(); vi.useRealTimers(); });

    function setup(options: { acquireToken?: () => Promise<string>; fetch?: any; onState?: any; onError?: any;
        target?: () => ((id: string) => boolean) | null;
        onMessageUpdate?: ConstructorParameters<typeof TrouterClient>[0]['onMessageUpdate'] } = {}) {
        const sockets: Socket[] = [];
        const wake = vi.fn();
        const acquireToken = options.acquireToken ?? vi.fn(async () => jwt());
        const fetch = options.fetch ?? vi.fn(async () => new Response(null, { status: 201 }));
        const onMessageUpdate = options.onMessageUpdate ?? vi.fn();
        const client = new TrouterClient({
            target: options.target ?? (() => acceptTarget), expectedAccount: account, onWake: wake,
            acquireToken, fetch, onState: options.onState, onError: options.onError,
            onMessageUpdate,
            socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; },
        });
        clients.push(client);
        client.start();
        return { client, sockets, wake, fetch, acquireToken, onMessageUpdate };
    }

    async function register(sockets: Socket[]) {
        await flush();
        sockets.at(-1)!.emit('open');
        sockets.at(-1)!.emit('message', connected());
        await flush();
    }

    it('delivers only registered-session updates without synthesizing normal message wakes', async () => {
        const s = setup({ target: () => id => id === '48:notes' });
        await flush();
        const frame = update({ id: 'message', to: '48:notes', properties: { emotions: [] } },
            { time: '2026-01-01T00:00:00.001Z' });
        s.sockets[0].emit('message', frame);
        expect(s.onMessageUpdate).not.toHaveBeenCalled();
        await register(s.sockets);
        s.wake.mockClear();
        s.sockets[0].emit('message', frame);
        expect(s.onMessageUpdate).toHaveBeenCalledExactlyOnceWith({
            conversationId: '48:notes', messageId: 'message', emotions: [], rootMessageId: undefined,
            eventTime: '2026-01-01T00:00:00.001Z',
        });
        expect(s.wake).not.toHaveBeenCalled();
        expect(s.fetch).toHaveBeenCalledOnce();
    });
    it('revokes update delivery on live target changes, reconnect and stop', async () => {
        let enabled = true;
        const s = setup({ target: () => enabled ? id => id === '48:notes' : null });
        await register(s.sockets);
        const frame = update({ id: 'message', to: '48:notes', properties: { emotions: [] } });
        s.sockets[0].emit('message', frame);
        enabled = false;
        s.sockets[0].emit('message', frame);
        enabled = true;
        const stale = s.sockets[0];
        stale.emit('close');
        await flush();
        stale.emit('message', frame);
        await vi.advanceTimersByTimeAsync(501);
        await flush();
        s.sockets[1].emit('message', frame);
        expect(s.onMessageUpdate).toHaveBeenCalledTimes(1);
        await register(s.sockets);
        s.sockets[1].emit('message', frame);
        expect(s.onMessageUpdate).toHaveBeenCalledTimes(2);
        await s.client.stop();
        s.sockets[1].emit('message', frame);
        expect(s.onMessageUpdate).toHaveBeenCalledTimes(2);
    });
    it('does not replay reaction updates on message loss or reconnect', async () => {
        const s = setup({ target: () => () => true });
        await register(s.sockets);
        s.sockets[0].emit('message', event('trouter.message_loss'));
        s.sockets[0].emit('close');
        await flush();
        await vi.advanceTimersByTimeAsync(501);
        await register(s.sockets);
        expect(s.onMessageUpdate).not.toHaveBeenCalled();
    });
    it('keeps protocol health independent of update observer exceptions', async () => {
        const onMessageUpdate = vi.fn(() => { throw new Error('observer'); });
        const s = setup({ target: () => id => id === '48:notes', onMessageUpdate });
        await register(s.sockets);
        s.sockets[0].emit('message', update({ id: 'message', to: '48:notes', properties: { emotions: [] } }));
        s.sockets[0].emit('message', '2::');
        expect(onMessageUpdate).toHaveBeenCalledOnce();
        expect(s.client.getStatus()).toEqual({ state: 'registered', error: null });
        expect(s.sockets[0].sent.at(-1)).toBe('2::');
        expect(s.sockets[0].closed).toBe(false);
    });
    it('uses one account registration for multiple explicitly accepted chat sources', async () => {
        const first = '19:first@thread.v2';
        const second = '19:second@thread.v2';
        const s = setup({ target: () => id => [first, second, '48:notes'].includes(id) });
        await register(s.sockets);
        s.wake.mockClear();
        for (const to of [first, second, '48:notes', target, '48:notifications']) {
            s.sockets[0].emit('message', notification({ to }));
        }
        expect(s.wake.mock.calls.map(([wake]) => wake.conversationId)).toEqual([first, second, '48:notes']);
        expect(s.fetch).toHaveBeenCalledOnce();
        expect(s.sockets).toHaveLength(1);
    });
    it('applies live target changes without reconnecting or waking while inactive', async () => {
        let selected: string | null = target;
        const s = setup({ target: () => {
            const id = selected;
            return id ? candidate => candidate === id : null;
        } });
        await register(s.sockets);
        s.wake.mockClear();
        s.sockets[0].emit('message', notification({ to: target }));
        selected = '19:another@thread.tacv2';
        s.sockets[0].emit('message', notification({ to: target }));
        s.sockets[0].emit('message', notification({ to: selected }));
        selected = null;
        s.sockets[0].emit('message', event('trouter.message_loss'));
        s.sockets[0].emit('message', notification({ to: target }));
        expect(s.wake.mock.calls.map(([wake]) => wake.conversationId)).toEqual([target, '19:another@thread.tacv2']);
        expect(s.fetch).toHaveBeenCalledOnce();
        expect(s.sockets).toHaveLength(1);
    });
    it('authenticates with separate IC3 credentials and registers TTL without any message write', async () => {
        const s = setup();
        await register(s.sockets);
        const authentication = JSON.parse(s.sockets[0].sent[0].slice(4));
        expect(authentication.name).toBe('user.authenticate');
        expect(authentication.args[0].headers.Authorization).toBe(`Bearer ${jwt()}`);
        expect(s.sockets[0].sent[1]).toBe('6:::7+[]');
        expect(s.fetch).toHaveBeenCalledOnce();
        expect(s.client.getStatus()).toEqual({ state: 'registered', error: null });
        const [url, request] = s.fetch.mock.calls[0];
        expect(url).toBe('https://teams.cloud.microsoft/registrar/prod/V2/registrations');
        expect(request.redirect).toBe('error');
        const body = JSON.parse(request.body);
        expect(body.transports.TROUTER).toEqual([{ context: '', path, ttl: 3600 }]);
        s.sockets[0].emit('message', notification({ to: target, parentMessageId: 'root' }));
        expect(s.wake).toHaveBeenCalledWith({ cause: 'message', conversationId: target, rootMessageId: 'root' });
        expect(s.fetch).toHaveBeenCalledOnce();
    });
    it.each([{ aud: 'reader-resource' }, { oid: '33333333-3333-4333-8333-333333333333' }, { tid: undefined }])(
        'fails closed on invalid IC3 audience/account', async claims => {
            const s = setup({ acquireToken: async () => jwt(claims) });
            await flush();
            expect(s.sockets).toHaveLength(0);
            expect(s.fetch).not.toHaveBeenCalled();
        });
    it('disconnect reconnects with jitter, a fresh credential and stable registration identity', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const s = setup();
        await register(s.sockets);
        const first = JSON.parse(s.fetch.mock.calls[0][1].body).registrationId;
        s.sockets[0].emit('close');
        await flush();
        expect(s.wake).toHaveBeenCalledWith({ cause: 'disconnect' });
        await vi.advanceTimersByTimeAsync(249);
        expect(s.sockets).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        await register(s.sockets);
        expect(s.sockets).toHaveLength(2);
        expect(s.acquireToken).toHaveBeenCalledTimes(2);
        expect(JSON.parse(s.fetch.mock.calls[1][1].body).registrationId).toBe(first);
    });
    it('honors registrar 429 Retry-After', async () => {
        const fetch = vi.fn(async () => new Response(null, { status: 429, headers: { 'retry-after': '90' } }));
        const s = setup({ fetch });
        await register(s.sockets);
        expect(s.client.getStatus()).toMatchObject({ state: 'retrying', error: { code: 'rate-limited' } });
        await vi.advanceTimersByTimeAsync(89_999);
        expect(s.sockets).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(s.sockets).toHaveLength(2);
    });
    it('renews both token and TTL by reconnecting before expiry', async () => {
        const s = setup({ acquireToken: vi.fn(async () => jwt({}, 300)) });
        await register(s.sockets);
        await vi.advanceTimersByTimeAsync(59_000);
        // Heartbeats keep the lease live; renewal is independent of activity.
        s.sockets[0].emit('message', '2::');
        await vi.advanceTimersByTimeAsync(59_000);
        s.sockets[0].emit('message', '2::');
        await vi.advanceTimersByTimeAsync(59_000);
        s.sockets[0].emit('message', '2::');
        await vi.advanceTimersByTimeAsync(3000);
        expect(s.sockets[0].closed).toBe(true);
        await vi.advanceTimersByTimeAsync(501);
        expect(s.acquireToken).toHaveBeenCalledTimes(2);
    });
    it('malformed input and overflow reconnect with reconciliation', async () => {
        const s = setup();
        await register(s.sockets);
        s.sockets[0].bufferedAmount = 256 * 1024 + 1;
        s.sockets[0].emit('message', '2::');
        await flush();
        expect(s.sockets[0].closed).toBe(true);
        expect(s.wake).toHaveBeenCalledWith({ cause: 'disconnect' });
        await vi.advanceTimersByTimeAsync(501);
        s.sockets[1].emit('message', { binary: true });
        await flush();
        expect(s.sockets[1].closed).toBe(true);
        await vi.advanceTimersByTimeAsync(1001);
        const latest = s.sockets.at(-1)!;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(latest.closed).toBe(true);
    });
    it('keeps a registered connection open during silence and receives later updates', async () => {
        const onError = vi.fn();
        const s = setup({ onError, target: () => id => id === '48:notes' });
        await register(s.sockets);
        s.wake.mockClear();
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(s.sockets).toHaveLength(1);
        expect(s.sockets[0].closed).toBe(false);
        expect(s.client.getStatus()).toEqual({ state: 'registered', error: null });
        expect(onError).not.toHaveBeenCalled();
        expect(s.wake).not.toHaveBeenCalled();
        s.sockets[0].emit('message', update({ id: 'message', to: '48:notes', properties: { emotions: [] } }));
        expect(s.onMessageUpdate).toHaveBeenCalledOnce();
        s.sockets[0].emit('message', '2::');
        expect(s.sockets[0].sent.at(-1)).toBe('2::');
        await s.client.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('registration TTL renews even while a longer token stays valid', async () => {
        const s = setup({ acquireToken: vi.fn(async () => jwt({}, 7200)) });
        await register(s.sockets);
        for (let i = 0; i < 55; i++) {
            await vi.advanceTimersByTimeAsync(59_000);
            s.sockets[0].emit('message', '2::');
        }
        await vi.advanceTimersByTimeAsync(55_000);
        expect(s.sockets[0].closed).toBe(true);
        await vi.advanceTimersByTimeAsync(501);
        await register(s.sockets);
        expect(s.fetch).toHaveBeenCalledTimes(2);
        expect(s.acquireToken).toHaveBeenCalledTimes(2);
    });
    it('a failed reconnect does not repeatedly trigger short-interval reads', async () => {
        const s = setup({ acquireToken: vi.fn(async () => { throw new Error('unavailable'); }) });
        await vi.advanceTimersByTimeAsync(35_000);
        expect(s.acquireToken.mock.calls.length).toBeGreaterThan(2);
        expect(s.wake).toHaveBeenCalledTimes(1);
    });
    it('shutdown clears handshake watchdog timers even before registration', async () => {
        const s = setup();
        await flush();
        await s.client.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('stop cancels credential wait and suppresses late credential/socket callbacks', async () => {
        let resolve!: (value: string) => void;
        const s = setup({ acquireToken: () => new Promise(r => { resolve = r; }) });
        await s.client.stop();
        resolve(jwt());
        await flush();
        expect(s.sockets).toHaveLength(0);
        expect(s.wake).not.toHaveBeenCalled();
    });
    it('stop aborts registration and ignores a late success without reconnecting', async () => {
        let resolve!: (response: Response) => void;
        const s = setup({ fetch: vi.fn(() => new Promise(r => { resolve = r; })) });
        await register(s.sockets);
        const signal = s.fetch.mock.calls[0][1].signal as AbortSignal;
        await s.client.stop();
        expect(signal.aborted).toBe(true);
        resolve(new Response(null, { status: 201 }));
        await flush();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(s.sockets).toHaveLength(1);
        expect(s.wake).not.toHaveBeenCalled();
    });
    it('observer exceptions do not break the connection', async () => {
        const s = setup({ onState: () => { throw new Error('observer'); } });
        await register(s.sockets);
        expect(s.fetch).toHaveBeenCalledOnce();
        expect(s.sockets[0].closed).toBe(false);
    });
    it('reports sanitized permission errors and clears them on recovery', async () => {
        const onError = vi.fn();
        const fetch = vi.fn()
            .mockResolvedValueOnce(new Response('private provider body', { status: 403 }))
            .mockResolvedValue(new Response(null, { status: 202 }));
        const s = setup({ fetch, onError });
        await register(s.sockets);
        expect(s.client.getStatus()).toMatchObject({ state: 'retrying', error: { code: 'authentication' } });
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'authentication' }));
        expect(JSON.stringify(s.client.getStatus())).not.toContain('private provider body');
        await vi.advanceTimersByTimeAsync(501);
        await register(s.sockets);
        expect(s.client.getStatus()).toEqual({ state: 'registered', error: null });
    });
    it('public status cannot mutate instance error state; observer errors do not prevent retries', async () => {
        const s = setup({ acquireToken: async () => { throw new Error('private credential failure'); },
            onError: () => { throw new Error('observer'); } });
        await flush();
        const status = s.client.getStatus();
        expect(status.error?.code).toBe('credentials');
        status.error!.message = 'modified';
        expect(s.client.getStatus().error?.message).not.toBe('modified');
        expect(JSON.stringify(s.client.getStatus())).not.toContain('private credential failure');
        await vi.advanceTimersByTimeAsync(501);
        expect(s.client.getStatus().state).toBe('retrying');
    });
    it('never emits wakes without an allowlisted target, including loss and reconnect', async () => {
        const s = setup({ target: () => null });
        await register(s.sockets);
        s.sockets[0].emit('message', event('trouter.message_loss'));
        s.sockets[0].emit('message', notification({ to: target }));
        s.sockets[0].emit('close');
        await flush();
        expect(s.wake).not.toHaveBeenCalled();
    });
    it('late frames and registrar results cannot change a newer session generation', async () => {
        let resolve!: (response: Response) => void;
        const fetch = vi.fn()
            .mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }))
            .mockResolvedValue(new Response(null, { status: 202 }));
        const s = setup({ fetch });
        await register(s.sockets);
        const stale = s.sockets[0];
        stale.emit('close');
        await flush();
        await vi.advanceTimersByTimeAsync(501);
        await register(s.sockets);
        const count = s.wake.mock.calls.length;
        resolve(new Response(null, { status: 202 }));
        stale.emit('message', notification({ to: target, parentMessageId: 'stale' }));
        stale.emit('error');
        await flush();
        expect(s.client.getStatus()).toEqual({ state: 'registered', error: null });
        expect(s.wake).toHaveBeenCalledTimes(count);
    });
});
