import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/identity';
import {
    AuthError,
    MicrosoftTokenProvider,
    NativeAddonLoadError,
    type MicrosoftTokenProviderOptions,
} from '@plusplusoneplusplus/coc-native';
import type { CLIConfig } from '../../config';

export type KustoAuthConfig = NonNullable<CLIConfig['kusto']>;
export type KustoProvider = Pick<MicrosoftTokenProvider, 'getToken' | 'cancelOutstanding' | 'dispose'>;
export type KustoProviderFactory = (options: MicrosoftTokenProviderOptions) => KustoProvider;

export class KustoCredentialError extends Error {
    override readonly name = 'KustoCredentialError';
}

export function validateKustoAuthConfig(config: KustoAuthConfig): Required<NonNullable<KustoAuthConfig['azureCli']>> | undefined {
    const { account, tenant, subscription } = config.azureCli ?? {};
    if (!account && !tenant && !subscription) return undefined;
    if (!account || !tenant || !subscription) {
        throw new KustoCredentialError('Kusto Rust auth: set kusto.azureCli.account, tenant and subscription on the server host.');
    }
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (account.length > 2048 || account !== account.trim() || !/^(?!-)[A-Za-z0-9._:/@-]+$/.test(account)
        || tenant.length !== 36 || subscription.length !== 36 || !guid.test(tenant) || !guid.test(subscription)) {
        throw new KustoCredentialError('Kusto Rust auth: invalid host configuration. Use the exact CLI user.name and tenant/subscription UUIDs.');
    }
    return { account, tenant, subscription };
}

/** Validate before the SDK fetches metadata or sends credentials. */
export function validateKustoCluster(clusterUrl: string): string {
    // Trusted ADX (public/sovereign/MFA), Synapse and Fabric destinations:
    // arbitrary hosts could supply auth metadata and receive the acquired bearer token.
    const suffixes = [
        '.kusto.windows.net', '.kustomfa.windows.net', '.kustodev.windows.net',
        '.kusto.usgovcloudapi.net', '.kustomfa.usgovcloudapi.net',
        '.kusto.chinacloudapi.cn', '.kustomfa.chinacloudapi.cn',
        '.kusto.azuresynapse.net', '.kusto.azuresynapse.azure.cn',
        '.kusto.data.microsoft.com', '.kusto.fabric.microsoft.com',
    ];
    let url: URL;
    try { url = new URL(clusterUrl); } catch {
        throw new KustoCredentialError('Kusto Rust auth: invalid cluster URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || url.search || url.hash || url.pathname !== '/'
        || !/^[a-z0-9.-]+$/.test(url.hostname)
        || !suffixes.some(suffix => url.hostname.endsWith(suffix))) {
        throw new KustoCredentialError('Kusto Rust auth requires an HTTPS ADX, Synapse or Fabric cluster origin without credentials, paths, query, fragment or custom port.');
    }
    return url.origin;
}

/** Kusto supplies its metadata audience, not necessarily the cluster origin. */
export function kustoResourceFromScopes(scopes: string | string[]): string {
    const list = typeof scopes === 'string' ? [scopes] : scopes;
    if (!Array.isArray(list) || list.length !== 1 || typeof list[0] !== 'string' || !list[0].endsWith('/.default')) {
        throw new KustoCredentialError('Kusto Rust auth: expected one SDK audience /.default scope.');
    }
    const resource = list[0].slice(0, -'/.default'.length);
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (resource.length === 36 && guid.test(resource)) return resource;
    let url: URL;
    try { url = new URL(resource); } catch {
        throw new KustoCredentialError('Kusto Rust auth: unsupported SDK audience.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
        || resource.length > 2048 || /\s/.test(resource) || !/^https:\/\/[A-Za-z0-9._:/-]+$/.test(resource)) {
        throw new KustoCredentialError('Kusto Rust auth: unsupported SDK audience.');
    }
    // Keep the metadata resource's spelling/trailing slash: the SDK appends /.default verbatim.
    return resource;
}

/** Native AuthError is already redacted; preserve it rather than translating codes. */
export function kustoAuthError(error: unknown): Error {
    if (error instanceof AuthError || error instanceof KustoCredentialError) return error;
    if (error instanceof NativeAddonLoadError) {
        return new KustoCredentialError('Kusto Rust auth: native Microsoft authentication capability unavailable. Build/install the matching coc-native addon (npm run build:native -w packages/coc-native).');
    }
    return new KustoCredentialError('Kusto Rust auth: credential acquisition failed. Check the native addon and explicit host configuration.');
}

/**
 * No JS token cache: every SDK request reaches the source-pinned Rust provider.
 * The current Kusto TokenCredential contract has no force-refresh parameter.
 */
export class RustKustoCredential implements TokenCredential {
    private provider?: KustoProvider;
    private resource?: string;
    private disposed = false;
    private readonly identity: ReturnType<typeof validateKustoAuthConfig>;

    constructor(
        config: KustoAuthConfig,
        private readonly namespace: string,
        private readonly createProvider: KustoProviderFactory = options => new MicrosoftTokenProvider(options),
        private readonly diagnostic: (event: string) => void = () => {},
    ) {
        this.identity = validateKustoAuthConfig(config);
    }

    async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken> {
        if (this.disposed) throw new AuthError('Disposed');
        if (options?.abortSignal?.aborted) throw new AuthError('Cancelled');
        const resource = kustoResourceFromScopes(scopes);
        if (options?.tenantId && this.identity && options.tenantId.toLowerCase() !== this.identity.tenant.toLowerCase()) {
            throw new AuthError('AccountMismatch');
        }
        if (options?.claims || options?.enableCae || options?.proofOfPossessionOptions) {
            throw new KustoCredentialError('Kusto Rust auth: claims, CAE and proof-of-possession challenges are not supported by Azure CLI authentication.');
        }
        if (this.resource && this.resource !== resource) {
            throw new KustoCredentialError('Kusto Rust auth: SDK audience changed; rebuild the client before acquiring another target.');
        }
        try {
            if (!this.provider) {
                this.provider = this.createProvider({
                    source: 'azure-cli', refresh: 'auto',
                    azureCli: this.identity ? {
                        namespace: this.namespace,
                        account: { id: this.identity.account, tenant: this.identity.tenant },
                        subscription: this.identity.subscription,
                        resource,
                    } : { selection: 'active-account', namespace: this.namespace, resource },
                });
                this.resource = resource;
                this.diagnostic('provider-created source=azure-cli refresh=auto');
            }
            const provider = this.provider;
            const abort = (): void => provider.cancelOutstanding();
            options?.abortSignal?.addEventListener('abort', abort);
            try {
                this.diagnostic('get-token source=azure-cli');
                const result = await provider.getToken();
                if (this.disposed) throw new AuthError('Disposed');
                if (options?.abortSignal?.aborted) throw new AuthError('Cancelled');
                if (options?.tenantId && options.tenantId.toLowerCase() !== result.account.tenant.toLowerCase()) {
                    throw new AuthError('AccountMismatch');
                }
                // Native auth owns token validation, expiry, cache and refresh.
                return { token: result.accessToken, expiresOnTimestamp: result.expiresAt, tokenType: 'Bearer' };
            } finally {
                options?.abortSignal?.removeEventListener('abort', abort);
            }
        } catch (error) { throw kustoAuthError(error); }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.provider?.dispose();
    }
}
