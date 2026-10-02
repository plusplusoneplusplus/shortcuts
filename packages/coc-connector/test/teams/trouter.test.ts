import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTrouterFrame, TrouterClient, trouterAccount, type TrouterSocket } from '../../src/teams/trouter';
import { IC3_RESOURCE } from '../../src/teams/ic3/ic3-direct-message-config';

const account = { tenantId: '11111111-1111-4111-8111-111111111111', objectId: '22222222-2222-4222-8222-222222222222' };
const target = '19:channel@thread.tacv2';
const path = 'https://go-msit.trouter.teams.microsoft.com/v4/a/endpoint';
const event = (name: string, args: unknown[] = [], ack = '') => `5:${ack}::${JSON.stringify({ name, args })}`;
const connected = () => event('trouter.connected', [{ surl: path }], '7+');
const jwt = (claims: object = {}, expiresIn = 3600) => `header.${Buffer.from(JSON.stringify({
    aud: IC3_RESOURCE, tid: account.tenantId, oid: account.objectId, exp: Date.now() / 1000 + expiresIn, ...claims,
})).toString('base64url')}.signature`;
const notification = (resource: object, body: object = {}) => `3:::${JSON.stringify({
    id: 'request', body: { type: 'EventMessage', resourceType: 'NewMessage', resource, ...body },
})}`;
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
        expect(parseTrouterFrame('2::', target).send).toEqual(['2::']);
        expect(parseTrouterFrame(connected(), target)).toEqual({ send: ['6:::7+[]'], registrationPath: path });
    });
    it('ACKs HTTP before ignoring unrelated notifications', () => {
        const result = parseTrouterFrame(notification({ to: '19:unrelated@thread.tacv2' }), target);
        expect(result.send).toEqual(['3:::{"id":"request","status":200,"headers":{}}']);
        expect(result.wake).toBeUndefined();
    });
    it('prefers real source thread and reply chain over synthetic activity stream', () => {
        const result = parseTrouterFrame(notification({
            to: '48:notifications', properties: { activity: {
                sourceThreadId: encodeURIComponent(target), sourceReplyChainId: 'root',
            } },
        }), target);
        expect(result.wake).toEqual({ cause: 'message', conversationId: target, rootMessageId: 'root' });
    });
    it('never lets synthetic or missing source activate the configured channel', () => {
        expect(parseTrouterFrame(notification({ to: '48:notifications' }), target).wake).toBeUndefined();
        expect(parseTrouterFrame(notification({}), target).wake).toBeUndefined();
        expect(parseTrouterFrame(notification({ to: target, properties: {
            activity: { sourceThreadId: '19:unrelated@thread.tacv2' },
        } }), target).wake).toBeUndefined();
    });
    it('normalizes conversation URLs and JSON string envelopes', () => {
        const body = JSON.stringify({ type: 'EventMessage', resourceType: 'NewMessage',
            resource: JSON.stringify({ conversationLink: `https://example.test/conversations/${encodeURIComponent(target)}/messages/message`,
                parentMessageId: 'root' }) });
        expect(parseTrouterFrame(`3:::${JSON.stringify({ id: 42, body })}`, target).wake)
            .toMatchObject({ conversationId: target, rootMessageId: 'root' });
    });
    it('message loss forces reconciliation', () => {
        expect(parseTrouterFrame(event('trouter.message_loss'), target).wake).toEqual({ cause: 'message-loss' });
    });
    it.each(['garbage', '3:::{}', '3:::not-json', '5:::{}broken', '0::', '7:::error',
        notification({ to: '%ZZ' }), '3:::' + 'x'.repeat(256 * 1024)])('rejects malformed/oversized frames', raw => {
        expect(() => parseTrouterFrame(raw, target)).toThrow();
    });
    it.each(['http://go-msit.trouter.teams.microsoft.com/path', 'ftp://example.test/path',
        'https://example.test/\u0000path',
        'https://user:pass@go-msit.trouter.teams.microsoft.com/path'])('rejects unsafe registrar forwarding paths', surl => {
        expect(() => parseTrouterFrame(event('trouter.connected', [{ surl }]), target)).toThrow();
    });
    it('accepts opaque HTTPS forwarding paths without using them as fetch targets', () => {
        const forwardingPath = 'https://example.test/opaque';
        expect(parseTrouterFrame(event('trouter.connected', [{ surl: forwardingPath }]), target).registrationPath)
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
        target?: () => string | null } = {}) {
        const sockets: Socket[] = [];
        const wake = vi.fn();
        const acquireToken = options.acquireToken ?? vi.fn(async () => jwt());
        const fetch = options.fetch ?? vi.fn(async () => new Response(null, { status: 201 }));
        const client = new TrouterClient({
            target: options.target ?? (() => target), expectedAccount: account, onWake: wake,
            acquireToken, fetch, onState: options.onState, onError: options.onError,
            socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; },
        });
        clients.push(client);
        client.start();
        return { client, sockets, wake, fetch, acquireToken };
    }

    async function register(sockets: Socket[]) {
        await flush();
        sockets.at(-1)!.emit('open');
        sockets.at(-1)!.emit('message', connected());
        await flush();
    }

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
    it('heartbeat timeout, malformed input and overflow reconnect with reconciliation', async () => {
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
        await vi.advanceTimersByTimeAsync(60_000);
        expect(latest.closed).toBe(true);
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
