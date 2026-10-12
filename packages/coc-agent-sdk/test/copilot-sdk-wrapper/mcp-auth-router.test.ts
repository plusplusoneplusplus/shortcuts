import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CopilotSession } from '@github/copilot-sdk';
import { McpAuthRouter } from '../../src/mcp-auth-router';

const routers: McpAuthRouter[] = [];
afterEach(() => {
    routers.splice(0).forEach(router => router.close());
    vi.useRealTimers();
});

function setup(signal?: AbortSignal, deadline = Date.now() + 10000) {
    const handler = vi.fn().mockResolvedValue({ accessToken: 'managed-fixture-token' });
    const notify = vi.fn();
    const cancel = vi.fn().mockResolvedValue({ success: true });
    const login = vi.fn().mockResolvedValue({ authorizationUrl: 'https://example.test/authorize' });
    const session = { sessionId: 'fixture-session', rpc: { mcp: { oauth: { handlePendingRequest: cancel, login } } } } as unknown as CopilotSession;
    const router = new McpAuthRouter({ managed: 'https://example.test/managed' }, handler, notify, signal, deadline);
    routers.push(router);
    return { router, handler, notify, cancel, login, session };
}

const request = (serverName = 'generic', serverUrl = 'https://example.test/generic', reason: 'initial' | 'refresh' | 'reauth' | 'upscope' = 'initial') => ({
    serverName, serverUrl, requestId: 'fixture-request', reason,
});
const context = { sessionId: 'fixture-session' };
const drain = () => new Promise(resolve => setImmediate(resolve));

describe('McpAuthRouter', () => {
    it.each(['initial', 'refresh', 'reauth', 'upscope'] as const)('routes managed %s to the host unchanged', async reason => {
        const { router, handler, login } = setup();
        const auth = request('managed', 'https://example.test/managed', reason);
        expect(await router.onAuthRequest(auth, context)).toEqual({ accessToken: 'managed-fixture-token' });
        expect(handler).toHaveBeenCalledWith(auth, context);
        expect(login).not.toHaveBeenCalled();
    });

    it.each([
        ['managed', 'https://example.test/wrong'],
        ['wrong', 'https://example.test/managed'],
        ['toString', 'https://example.test/managed'],
    ])('fails closed for mismatched identity %s', async (name, url) => {
        const { router, handler, login, session } = setup();
        router.ready(session);
        expect(await router.onAuthRequest(request(name, url), context)).toEqual({ kind: 'cancelled' });
        router.login(name, url);
        await drain();
        expect(handler).not.toHaveBeenCalled();
        expect(login).not.toHaveBeenCalled();
    });

    it.each(['initial', 'refresh', 'reauth', 'upscope'] as const)('cancels generic %s before same-session runtime login', async reason => {
        const { router, handler, notify, cancel, login, session } = setup();
        expect(router.onAuthRequest(request('generic', undefined, reason), context)).toEqual({ kind: 'cancelled' });
        expect(login).not.toHaveBeenCalled();
        router.ready(session);
        await drain();
        expect(cancel).toHaveBeenCalledWith({ requestId: 'fixture-request', result: { kind: 'cancelled' } });
        expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(login.mock.invocationCallOrder[0]);
        expect(login).toHaveBeenCalledWith({ serverName: 'generic' });
        expect(handler).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'generic', sessionId: 'fixture-session', authorizationUrl: 'https://example.test/authorize' }));
    });

    it('does not deadlock create/resume and drops callbacks from a failed resume', async () => {
        const { router, login, cancel, session } = setup();
        expect(router.onAuthRequest(request(), { sessionId: 'failed-resume' })).toEqual({ kind: 'cancelled' });
        router.ready(session);
        await drain();
        expect(cancel).not.toHaveBeenCalled();
        expect(login).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent generic login and emits no host credentials', async () => {
        const { router, handler, login, notify, session } = setup();
        router.ready(session);
        router.login('generic', 'https://example.test/generic');
        router.onAuthRequest(request(), context);
        await drain();
        expect(login).toHaveBeenCalledOnce();
        expect(handler).not.toHaveBeenCalled();
        expect(JSON.stringify(notify.mock.calls)).not.toContain('managed-fixture-token');
    });

    it('does not login after abort while awaiting session readiness', async () => {
        const controller = new AbortController();
        const { router, login, session } = setup(controller.signal);
        router.onAuthRequest(request(), context);
        controller.abort();
        router.ready(session);
        await drain();
        expect(login).not.toHaveBeenCalled();
    });

    it('does not login after abort while acknowledging pending cancellation', async () => {
        const controller = new AbortController();
        const { router, login, cancel, session } = setup(controller.signal);
        let resolve!: () => void;
        cancel.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
        router.ready(session);
        router.onAuthRequest(request(), context);
        await drain();
        controller.abort();
        resolve();
        await drain();
        expect(login).not.toHaveBeenCalled();
    });

    it.each([null, undefined, { kind: 'cancelled' }])('never falls back to runtime login when managed handler returns %s', async result => {
        const { router, handler, login, session } = setup();
        handler.mockResolvedValue(result);
        router.ready(session);
        expect(await router.onAuthRequest(request('managed', 'https://example.test/managed'), context)).toEqual(result);
        await drain();
        expect(login).not.toHaveBeenCalled();
    });

    it('drops late login notifications after close', async () => {
        const { router, login, notify, session } = setup();
        let resolve!: (result: { authorizationUrl: string }) => void;
        login.mockImplementation(() => new Promise(r => { resolve = r; }));
        router.ready(session);
        router.login('generic', 'https://example.test/generic');
        await drain();
        router.close();
        resolve({ authorizationUrl: 'https://example.test/authorize' });
        await drain();
        expect(notify).not.toHaveBeenCalled();
    });

    it('does not deliver a native token after the turn closes', async () => {
        const { router, handler } = setup();
        let resolve!: (result: { accessToken: string }) => void;
        handler.mockImplementation(() => new Promise(r => { resolve = r; }));
        const result = router.onAuthRequest(request('managed', 'https://example.test/managed'), context);
        router.close();
        resolve({ accessToken: 'managed-fixture-token' });
        expect(await result).toEqual({ kind: 'cancelled' });
    });

    it('releases pending readiness at the deadline without login', async () => {
        vi.useFakeTimers();
        const { router, login, session } = setup(undefined, Date.now() + 10);
        router.onAuthRequest(request(), context);
        await vi.advanceTimersByTimeAsync(10);
        router.ready(session);
        await vi.advanceTimersByTimeAsync(0);
        expect(login).not.toHaveBeenCalled();
    });
});
