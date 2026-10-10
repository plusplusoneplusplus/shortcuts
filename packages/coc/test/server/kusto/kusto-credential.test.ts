import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, NativeAddonLoadError, type MicrosoftTokenProviderOptions } from '@plusplusoneplusplus/coc-native';
import {
    RustKustoCredential,
    kustoResourceFromScopes,
    validateKustoCluster,
    validateKustoAuthConfig,
    type KustoAuthConfig,
} from '../../../src/server/kusto/kusto-credential';

const identity = {
    account: 'fixture-account',
    tenant: '11111111-1111-4111-8111-111111111111',
    subscription: '22222222-2222-4222-8222-222222222222',
};
const config: KustoAuthConfig = { enabled: true, azureCli: identity };
const resource = 'https://kusto.kusto.windows.net';
const scope = `${resource}/.default`;

function fixture() {
    const getToken = vi.fn(async () => ({
        accessToken: 'opaque-fixture', expiresAt: Date.now() + 3_600_000,
        tokenType: 'Bearer', source: 'azure-cli' as const, target: resource,
        account: { id: identity.account, tenant: identity.tenant },
    }));
    const provider = { getToken, dispose: vi.fn(), cancelOutstanding: vi.fn() };
    const create = vi.fn((_options: MicrosoftTokenProviderOptions) => provider);
    const diagnostic = vi.fn();
    const credential = new RustKustoCredential(config, 'fixture-namespace', create, diagnostic);
    return { credential, create, provider, diagnostic };
}

afterEach(() => vi.restoreAllMocks());

describe('Kusto Azure CLI credential adapter', () => {
    it('delegates empty host identity selection to native auth and surfaces its failure unchanged', async () => {
        const { provider, create } = fixture();
        const credential = new RustKustoCredential({ enabled: true }, 'fixture-active', create);
        await credential.getToken(scope);
        expect(create).toHaveBeenCalledExactlyOnceWith({
            source: 'azure-cli', refresh: 'auto',
            azureCli: { selection: 'active-account', namespace: 'fixture-active', resource },
        });
        const error = new AuthError('AccountMismatch');
        provider.getToken.mockRejectedValueOnce(error);
        await expect(credential.getToken(scope)).rejects.toBe(error);
        expect(create).toHaveBeenCalledTimes(1);
        expect(provider.getToken).toHaveBeenCalledTimes(2);
        credential.dispose();
    });

    it('constructs only the explicit azure-cli auto provider with exact identity and SDK resource', async () => {
        const { credential, create, provider } = fixture();
        expect(create).not.toHaveBeenCalled();
        const token = await credential.getToken([scope]);
        expect(create).toHaveBeenCalledExactlyOnceWith({
            source: 'azure-cli', refresh: 'auto',
            azureCli: {
                namespace: 'fixture-namespace', account: { id: identity.account, tenant: identity.tenant },
                subscription: identity.subscription, resource,
            },
        });
        expect(token).toEqual({
            token: 'opaque-fixture', expiresOnTimestamp: (await provider.getToken.mock.results[0].value).expiresAt,
            tokenType: 'Bearer',
        });
        credential.dispose();
    });

    it('calls getToken dynamically on every SDK call and maps millisecond expiry without scaling', async () => {
        const { credential, provider, create } = fixture();
        const expiresAt = Date.now() + 120_000;
        provider.getToken.mockResolvedValueOnce({
            accessToken: 'first-fixture', tokenType: 'Bearer', source: 'azure-cli', expiresAt, target: resource,
            account: { id: identity.account, tenant: identity.tenant },
        });
        expect(await credential.getToken(scope)).toMatchObject({ token: 'first-fixture', expiresOnTimestamp: expiresAt });
        expect(await credential.getToken(scope)).toMatchObject({ token: 'opaque-fixture' });
        expect(create).toHaveBeenCalledTimes(1);
        expect(provider.getToken).toHaveBeenCalledTimes(2);
        expect(provider.getToken).toHaveBeenNthCalledWith(1);
        expect(provider.getToken).toHaveBeenNthCalledWith(2);
        credential.dispose();
    });

    it.each([
        'CliUnavailable', 'LoginRequired', 'AccountMismatch', 'InvalidConfiguration',
        'InvalidTokenResponse', 'TokenExpired', 'TimedOut',
    ] as const)('surfaces native %s unchanged without another source or retry', async code => {
        const { credential, provider, create } = fixture();
        const error = new AuthError(code);
        provider.getToken.mockRejectedValue(error);
        await expect(credential.getToken(scope)).rejects.toBe(error);
        expect(create).toHaveBeenCalledTimes(1);
        expect(provider.getToken).toHaveBeenCalledTimes(1);
        credential.dispose();
    });

    it('sanitizes missing native capability and unexpected provider payloads', async () => {
        for (const error of [
            new NativeAddonLoadError('fixture-private-location'),
            new Error('fixture-private-token-account-payload'),
        ]) {
            const credential = new RustKustoCredential(config, 'fixture', () => { throw error; });
            await expect(credential.getToken(scope)).rejects.not.toThrow('fixture-private');
            await expect(credential.getToken(scope)).rejects.toThrow('Kusto Rust auth');
            credential.dispose();
        }
    });

    it('refuses a changed target or tenant and unsupported challenges without acquiring again', async () => {
        const { credential, provider } = fixture();
        await credential.getToken(scope);
        await expect(credential.getToken('https://other.example/.default')).rejects.toThrow('audience changed');
        await expect(credential.getToken(scope, { tenantId: identity.subscription })).rejects.toThrow('AccountMismatch');
        await expect(credential.getToken(scope, { claims: 'fixture-private' })).rejects.toThrow('not supported');
        expect(provider.getToken).toHaveBeenCalledTimes(1);
        credential.dispose();
    });

    it('owns cancellation and disposal and removes the abort listener', async () => {
        const { credential, provider } = fixture();
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        let release!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        provider.getToken.mockImplementationOnce(async () => {
            await waiting;
            throw new AuthError('Cancelled');
        });
        const pending = credential.getToken(scope, { abortSignal: controller.signal });
        controller.abort();
        expect(provider.cancelOutstanding).toHaveBeenCalledTimes(1);
        release();
        await expect(pending).rejects.toThrow('Cancelled');
        expect(remove).toHaveBeenCalled();
        await expect(credential.getToken(scope, { abortSignal: controller.signal })).rejects.toThrow('Cancelled');
        credential.dispose();
        expect(provider.dispose).toHaveBeenCalledTimes(1);
        await expect(credential.getToken(scope)).rejects.toThrow('Disposed');
    });

    it('does not print identifiers or tokens in diagnostics', async () => {
        const { credential, diagnostic } = fixture();
        await credential.getToken(scope);
        const output = JSON.stringify(diagnostic.mock.calls);
        for (const secret of ['opaque-fixture', ...Object.values(identity), resource]) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('source=azure-cli');
        credential.dispose();
    });

    it('surfaces a failed automatic renewal directly and keeps the same provider without replay', async () => {
        const { credential, provider, create } = fixture();
        await credential.getToken(scope);
        const error = new AuthError('InteractionRequired');
        provider.getToken.mockRejectedValueOnce(error);
        await expect(credential.getToken(scope)).rejects.toBe(error);
        expect(create).toHaveBeenCalledTimes(1);
        expect(provider.getToken).toHaveBeenCalledTimes(2);
        credential.dispose();
    });
});

describe('authentication configuration and URL boundary', () => {
    it.each([
        { account: identity.account },
        { ...identity, account: '-option' }, { ...identity, account: 'fixture&command' },
        { ...identity, account: 'fixture-account\n' }, { ...identity, tenant: `${identity.tenant}\n` },
        { ...identity, tenant: 'organizations' }, { ...identity, subscription: 'subscription-name' },
    ])('rejects incomplete/unsafe explicit host identity', azureCli => {
        expect(() => validateKustoAuthConfig({ azureCli })).toThrow('Kusto Rust auth');
    });

    it.each([undefined, {}, { account: '', tenant: '', subscription: '' }])(
        'selects native active identity for empty configuration', azureCli => {
            expect(validateKustoAuthConfig({ azureCli })).toBeUndefined();
        });

    it.each([
        'http://fixture.kusto.windows.net', 'https://fixture.example',
        'https://fixture.kusto.windows.net.example', 'https://fixture.kusto.windows.net:444',
        'https://evilkusto.windows.net', 'https://fixture.kusto.windows.net.evil.example',
        'https://fixture.kusto.windows.net/path', 'https://fixture.kusto.windows.net/?token=fixture',
        'https://fixture.kusto.windows.net/#fixture', 'https://fixture@fixture.kusto.windows.net',
        'https://127.0.0.1', 'not-a-url',
    ])('rejects untrusted cluster %s before metadata/auth', url => {
        expect(() => validateKustoCluster(url)).toThrow('Kusto Rust auth');
    });

    it.each([
        'https://fixture.kusto.windows.net', 'https://fixture.kustomfa.windows.net',
        'https://fixture.kustodev.windows.net', 'https://fixture.kusto.usgovcloudapi.net',
        'https://fixture.kustomfa.usgovcloudapi.net', 'https://fixture.kusto.chinacloudapi.cn',
        'https://fixture.kustomfa.chinacloudapi.cn', 'https://fixture.kusto.azuresynapse.net',
        'https://fixture.kusto.azuresynapse.azure.cn', 'https://fixture.kusto.data.microsoft.com',
        'https://fixture.kusto.fabric.microsoft.com',
    ])('accepts supported HTTPS cloud origin %s', url => {
        expect(validateKustoCluster(`${url}/`)).toBe(url);
    });

    it.each([
        resource, 'https://kusto.kustomfa.windows.net', 'https://kusto.kusto.usgovcloudapi.net',
        'https://kusto.kusto.chinacloudapi.cn', 'https://fixture.kusto.windows.net',
        'https://resource.example/', identity.tenant,
    ])('preserves SDK audience %s, not the cluster', audience => {
        expect(kustoResourceFromScopes([`${audience}/.default`])).toBe(audience);
    });

    it.each([
        [], [scope, scope], ['https://resource.example'], ['http://resource.example/.default'],
        ['https://fixture@resource.example/.default'], ['https://resource.example?secret=fixture/.default'],
        ['https://resource.example\n/.default'],
    ].map(scopes => ({ scopes })))('rejects invalid SDK audience scopes', ({ scopes }) => {
        expect(() => kustoResourceFromScopes(scopes)).toThrow('Kusto Rust auth');
    });
});
