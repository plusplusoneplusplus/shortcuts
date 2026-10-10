import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import { AuthError, MicrosoftTokenProvider, NativeAddonLoadError, type MicrosoftToken } from '@plusplusoneplusplus/coc-native';
import {
    ADO_RESOURCE_ID,
    disposeAdoTokenResolver,
    resetAdoTokenResolverForTests,
    resolveAdoAccessToken,
    resolveAdoAccessTokenValue,
} from '../../src/ado/ado-token-resolver';

vi.mock('@plusplusoneplusplus/coc-native', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>(),
    MicrosoftTokenProvider: vi.fn(),
}));

const token: MicrosoftToken = {
    accessToken: 'test-access-token',
    expiresAt: 1_700_003_600_000,
    tokenType: 'Bearer',
    source: 'azure-cli',
    target: ADO_RESOURCE_ID,
    account: { id: 'account@example.test', tenant: '00000000-0000-0000-0000-000000000001' },
};

function mockProvider() {
    return {
        getToken: vi.fn<() => Promise<MicrosoftToken>>().mockResolvedValue(token),
        dispose: vi.fn(),
    };
}

let provider: ReturnType<typeof mockProvider>;

beforeEach(() => {
    resetAdoTokenResolverForTests();
    vi.clearAllMocks();
    provider = mockProvider();
    vi.mocked(MicrosoftTokenProvider).mockImplementation(function () {
        return provider as MicrosoftTokenProvider;
    });
});

afterEach(() => {
    resetAdoTokenResolverForTests();
    vi.unstubAllEnvs();
});

describe('native ADO token resolver', () => {
    it('uses explicit Azure CLI source, ADO target and automatic refresh', async () => {
        await expect(resolveAdoAccessToken()).resolves.toEqual({
            token: token.accessToken,
            expiresAt: token.expiresAt,
            account: { upn: token.account.id, displayName: token.account.id, adoId: null },
        });
        expect(MicrosoftTokenProvider).toHaveBeenCalledExactlyOnceWith({
            source: 'azure-cli',
            refresh: 'auto',
            expiryMarginSeconds: 300,
            azureCli: {
                selection: 'active-account',
                namespace: expect.stringMatching(/^coc-ado-/),
                resource: ADO_RESOURCE_ID,
            },
        });
    });

    it('shares a provider across concurrent workspace callers', async () => {
        const results = await Promise.all([
            resolveAdoAccessTokenValue(),
            resolveAdoAccessTokenValue(),
            resolveAdoAccessTokenValue(),
        ]);
        expect(results).toEqual(Array(3).fill(token.accessToken));
        expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
        expect(provider.getToken).toHaveBeenCalledTimes(3);
    });

    it('asks native auth for every token so renewal is not bypassed by a JS cache', async () => {
        provider.getToken.mockResolvedValueOnce(token)
            .mockResolvedValueOnce({ ...token, accessToken: 'renewed-token', expiresAt: token.expiresAt + 3600_000 });
        expect(await resolveAdoAccessTokenValue()).toBe(token.accessToken);
        expect(await resolveAdoAccessToken()).toMatchObject({
            token: 'renewed-token', expiresAt: token.expiresAt + 3600_000,
        });
        expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
    });

    it('normalizes host directories and honors COC_DATA_DIR', async () => {
        const dataDir = path.resolve('host-data');
        vi.stubEnv('COC_DATA_DIR', dataDir);
        await resolveAdoAccessTokenValue();
        await resolveAdoAccessTokenValue({ dataDir: path.join(dataDir, 'nested', '..') });
        expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
    });

    it('isolates authentication lifetimes and namespaces for different hosts', async () => {
        await resolveAdoAccessTokenValue({ dataDir: path.resolve('host-one') });
        await resolveAdoAccessTokenValue({ dataDir: path.resolve('host-two') });
        const calls = vi.mocked(MicrosoftTokenProvider).mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0][0]).not.toEqual(calls[1][0]);
    });

    it.each(['LoginRequired', 'AccountMismatch', 'TokenExpired', 'TimedOut', 'Cancelled'] as const)(
        'preserves %s without null results, retries or fallback',
        async code => {
            const error = new AuthError(code);
            provider.getToken.mockRejectedValueOnce(error);
            await expect(resolveAdoAccessTokenValue()).rejects.toBe(error);
            expect(provider.getToken).toHaveBeenCalledOnce();
            expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
        },
    );

    it('preserves native installation errors and does not retain a failed constructor', async () => {
        const error = new NativeAddonLoadError('native authentication unavailable');
        vi.mocked(MicrosoftTokenProvider).mockImplementationOnce(function () { throw error; });
        await expect(resolveAdoAccessToken()).rejects.toBe(error);
        await expect(resolveAdoAccessTokenValue()).resolves.toBe(token.accessToken);
        expect(MicrosoftTokenProvider).toHaveBeenCalledTimes(2);
    });

    it('disposes only the selected host and selects afresh on the next call', async () => {
        const first = provider;
        const second = mockProvider();
        vi.mocked(MicrosoftTokenProvider)
            .mockImplementationOnce(function () { return first as MicrosoftTokenProvider; })
            .mockImplementationOnce(function () { return second as MicrosoftTokenProvider; });
        const one = path.resolve('host-one');
        const two = path.resolve('host-two');
        await resolveAdoAccessTokenValue({ dataDir: one });
        await resolveAdoAccessTokenValue({ dataDir: two });
        disposeAdoTokenResolver(one);
        disposeAdoTokenResolver(one);
        expect(first.dispose).toHaveBeenCalledOnce();
        expect(second.dispose).not.toHaveBeenCalled();
        await resolveAdoAccessTokenValue({ dataDir: two });
        expect(MicrosoftTokenProvider).toHaveBeenCalledTimes(2);
        await resolveAdoAccessTokenValue({ dataDir: one });
        expect(MicrosoftTokenProvider).toHaveBeenCalledTimes(3);
    });

    it('rejects late acquisitions after shutdown rather than returning a revoked token', async () => {
        let complete!: (value: MicrosoftToken) => void;
        provider.getToken.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
        const pending = resolveAdoAccessTokenValue();
        disposeAdoTokenResolver();
        complete(token);
        await expect(pending).rejects.toMatchObject({ code: 'Disposed' });
        expect(provider.dispose).toHaveBeenCalledOnce();
    });

    it('does not discard a provider on account mismatch and silently switch identities', async () => {
        await resolveAdoAccessTokenValue();
        provider.getToken.mockRejectedValue(new AuthError('AccountMismatch'));
        await expect(resolveAdoAccessTokenValue()).rejects.toMatchObject({ code: 'AccountMismatch' });
        await expect(resolveAdoAccessTokenValue()).rejects.toMatchObject({ code: 'AccountMismatch' });
        expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
    });
});
