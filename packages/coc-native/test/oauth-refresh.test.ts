import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AuthError, exchangeMicrosoftRefreshToken, loadNativeMicrosoftOAuthRefresh,
} from '../src/index';
import type { MicrosoftOAuthRefreshOptions, MicrosoftOAuthRefreshResponse } from '../src/index';

const options: MicrosoftOAuthRefreshOptions = {
    authority: 'https://login.microsoftonline.com/organizations',
    clientId: '33333333-3333-4333-8333-333333333333',
    scopes: ['fixture.scope', 'offline_access'],
    resource: 'https://resource.example',
    timeoutMs: 100,
};
const response: MicrosoftOAuthRefreshResponse = {
    accessToken: 'access-fixture', tokenType: 'Bearer', expiresIn: 3600,
};

afterEach(() => {
    vi.doUnmock('../src/loader');
    vi.resetModules();
});

async function fixture(work: () => Promise<MicrosoftOAuthRefreshResponse>) {
    const instances: SyntheticRequest[] = [];
    class SyntheticRequest {
        cancel() {}
        exchange(_refresh: string) { return work(); }
        constructor(readonly config: MicrosoftOAuthRefreshOptions, readonly timeout?: number) {
            vi.spyOn(this, 'cancel');
            vi.spyOn(this, 'exchange');
            instances.push(this);
        }
    }
    vi.doMock('../src/loader', async importOriginal => ({
        ...await importOriginal<typeof import('../src/loader')>(),
        loadNativeAddon: () => ({ NativeMicrosoftOAuthRefreshRequest: SyntheticRequest }),
    }));
    vi.resetModules();
    const api = await import('../src/index');
    return { api, instances };
}

describe('built Microsoft refresh boundary without auth I/O', () => {
    it('exports a one-shot handle and cancels before exchange without sending HTTP', () => {
        const request = new (loadNativeMicrosoftOAuthRefresh().NativeMicrosoftOAuthRefreshRequest)(options);
        request.cancel();
        expect(() => request.exchange('refresh-fixture')).toThrow('[auth-sdk:Cancelled]');
        expect(() => request.exchange('refresh-fixture')).toThrow('[auth-sdk:InvalidConfiguration]');
    });

    it.each(['', 'private\nfixture'])('rejects invalid refresh input %# before transport', async refresh => {
        const error = await exchangeMicrosoftRefreshToken(options, refresh).catch(error => error);
        expect(error).toBeInstanceOf(AuthError);
        expect(error.code).toBe('InvalidConfiguration');
        expect(error.cause).toBeUndefined();
        expect(String(error)).not.toContain('private');
    });

    it.each([
        { ...options, authority: 'https://fixture.example/common' },
        { ...options, authority: 'http://login.microsoftonline.com/common' },
        { ...options, authority: 'https://login.microsoftonline.com/common?fixture=private' },
        { ...options, clientId: 'private-fixture' },
        { ...options, scopes: [] },
        { ...options, scopes: ['invalid scope'] },
        { ...options, resource: 'private\nfixture' },
        ...[0, 99, 900_001, 0.5, Number.NaN].map(timeoutMs => ({ ...options, timeoutMs })),
    ])('rejects invalid configuration %# without auth I/O', async config => {
        await expect(exchangeMicrosoftRefreshToken(config, 'refresh-fixture'))
            .rejects.toMatchObject({ code: 'InvalidConfiguration' });
    });

    it('does not load or submit for an already cancelled caller', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(exchangeMicrosoftRefreshToken(options, 'refresh-fixture', controller.signal))
            .rejects.toMatchObject({ code: 'Cancelled' });
    });
});

describe('typed wrapper with trusted synthetic native injection', () => {
    it.each([false, true])('marshals options and optional rotation, rotated=%s', async rotated => {
        const expected = rotated ? { ...response, refreshToken: 'rotated-fixture', scope: 'actual.scope' } : { ...response };
        const { api, instances } = await fixture(async () => expected);
        const value = await api.exchangeMicrosoftRefreshToken(options, 'refresh-fixture');
        expect(instances).toHaveLength(1);
        expect(instances[0].config).toEqual(options);
        expect(instances[0].timeout).toBe(100);
        expect(instances[0].exchange).toHaveBeenCalledExactlyOnceWith('refresh-fixture');
        expect(value).toEqual(expected);
        expect(Object.isFrozen(value)).toBe(true);
        expect(instances[0].cancel).toHaveBeenCalledOnce();
        if (!rotated) {
            expect(value.refreshToken).toBeUndefined();
            expect(value.scope).toBeUndefined();
        }
    });

    it.each([
        ['InteractionRequired', 400, 'invalid_grant'],
        ['InteractionRequired', 401, 'interaction_required'],
        ['InteractionRequired', 400, 'consent_required'],
        ['InteractionRequired', 400, ''],
        ['InvalidTokenResponse', 400, ''],
        ['InvalidTokenResponse', 200, ''],
        ['InvalidTokenResponse', 500, ''],
        ['TimedOut', undefined, ''],
    ] as const)('preserves safe error metadata %s/%s/%s without raw errors', async (code, status, rejection) => {
        const { api, instances } = await fixture(async () => {
            throw new Error(`[auth-refresh:${code}:${status ?? ''}:${rejection}] private-provider-body refresh-fixture`);
        });
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const error = await api.exchangeMicrosoftRefreshToken(options, 'refresh-fixture', controller.signal)
            .catch(error => error);
        expect(error).toBeInstanceOf(api.MicrosoftOAuthRefreshError);
        expect(error).toBeInstanceOf(api.AuthError);
        expect(error).toMatchObject({ code, status, rejection: rejection || undefined });
        expect(error.cause).toBeUndefined();
        expect(String(error)).not.toContain('private-provider-body');
        expect(String(error)).not.toContain('refresh-fixture');
        expect(instances[0].cancel).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledOnce();
    });

    it.each([
        '[auth-refresh:InvalidTokenResponse:400:invalid_scope] private-fixture',
        '[auth-refresh:Unknown:400:invalid_grant] private-fixture',
        'private-fixture',
        '[auth-sdk:InvalidConfiguration] private-fixture',
    ])('never infers a terminal rejection from unrecognized diagnostics %#', async message => {
        const { api } = await fixture(async () => { throw new Error(message); });
        const error = await api.exchangeMicrosoftRefreshToken(options, 'refresh-fixture').catch(error => error);
        expect(error).toBeInstanceOf(api.AuthError);
        expect(error.code).toBe('InvalidConfiguration');
        expect(error.rejection).toBeUndefined();
        expect(error.cause).toBeUndefined();
        expect(String(error)).not.toContain('private-fixture');
    });

    it('cancels native work, waits for native settlement and removes its listener', async () => {
        let reject!: (error: Error) => void;
        const { api, instances } = await fixture(() => new Promise((_, fail) => { reject = fail; }));
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const pending = api.exchangeMicrosoftRefreshToken(options, 'refresh-fixture', controller.signal);
        let settled = false;
        void pending.then(() => { settled = true; }, () => { settled = true; });
        controller.abort();
        expect(instances[0].cancel).toHaveBeenCalledOnce();
        await Promise.resolve();
        expect(settled).toBe(false);
        reject(new Error('[auth-refresh:Cancelled::] private-fixture'));
        await expect(pending).rejects.toMatchObject({ code: 'Cancelled' });
        expect(instances[0].cancel).toHaveBeenCalledTimes(2);
        expect(remove).toHaveBeenCalledOnce();
    });

    it('does not publish a success that became stale before the wrapper resumed', async () => {
        let resolve!: (value: MicrosoftOAuthRefreshResponse) => void;
        const { api } = await fixture(() => new Promise(done => { resolve = done; }));
        const controller = new AbortController();
        const pending = api.exchangeMicrosoftRefreshToken(options, 'refresh-fixture', controller.signal);
        resolve({ ...response });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'Cancelled' });
    });

    it('keeps concurrent cancellation isolated and cleans up successful listeners', async () => {
        const resolvers: ((value: MicrosoftOAuthRefreshResponse) => void)[] = [];
        const { api, instances } = await fixture(() => new Promise(resolve => { resolvers.push(resolve); }));
        const cancelled = new AbortController();
        const survivor = new AbortController();
        const add = vi.spyOn(survivor.signal, 'addEventListener');
        const remove = vi.spyOn(survivor.signal, 'removeEventListener');
        const first = api.exchangeMicrosoftRefreshToken(options, 'first-fixture', cancelled.signal);
        const second = api.exchangeMicrosoftRefreshToken(options, 'second-fixture', survivor.signal);
        cancelled.abort();
        expect(instances[0].cancel).toHaveBeenCalledOnce();
        expect(instances[1].cancel).not.toHaveBeenCalled();
        resolvers.forEach(resolve => resolve({ ...response }));
        await expect(first).rejects.toMatchObject({ code: 'Cancelled' });
        await expect(second).resolves.toEqual(response);
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
        survivor.abort();
        expect(instances[1].cancel).toHaveBeenCalledOnce();
    });

    it('rejects missing inputs before native construction', async () => {
        const { api, instances } = await fixture(async () => ({ ...response }));
        await expect(api.exchangeMicrosoftRefreshToken(undefined as unknown as MicrosoftOAuthRefreshOptions, 'fixture'))
            .rejects.toMatchObject({ code: 'InvalidConfiguration' });
        await expect(api.exchangeMicrosoftRefreshToken(options, undefined as unknown as string))
            .rejects.toMatchObject({ code: 'InvalidConfiguration' });
        expect(instances).toHaveLength(0);
    });

    it.each(['missing', 'exchange', 'cancel'])('requires the complete refresh capability: %s', async missing => {
        class IncompleteRequest { exchange() {} cancel() {} }
        if (missing !== 'missing') Reflect.deleteProperty(IncompleteRequest.prototype, missing);
        vi.doMock('../src/loader', async importOriginal => ({
            ...await importOriginal<typeof import('../src/loader')>(),
            loadNativeAddon: () => missing === 'missing' ? {} : { NativeMicrosoftOAuthRefreshRequest: IncompleteRequest },
        }));
        vi.resetModules();
        const api = await import('../src/index');
        await expect(api.exchangeMicrosoftRefreshToken(options, 'fixture'))
            .rejects.toThrow('missing Microsoft OAuth refresh capability');
    });

    it('preserves native load failures without fallback', async () => {
        vi.doMock('../src/loader', async importOriginal => {
            const actual = await importOriginal<typeof import('../src/loader')>();
            return { ...actual, loadNativeAddon: () => { throw new actual.NativeAddonLoadError('fixture unavailable'); } };
        });
        vi.resetModules();
        const api = await import('../src/index');
        await expect(api.exchangeMicrosoftRefreshToken(options, 'fixture')).rejects.toThrow('fixture unavailable');
    });
});
