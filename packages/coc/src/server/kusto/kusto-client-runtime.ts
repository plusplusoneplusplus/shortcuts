import { randomUUID } from 'node:crypto';
import { buildKustoClient, type KustoClientFactory, type KustoClientLike } from './kusto-exec';
import {
    KustoCredentialError,
    RustKustoCredential,
    validateKustoCluster,
    validateKustoAuthConfig,
    kustoAuthError,
    type KustoAuthConfig,
    type KustoProviderFactory,
} from './kusto-credential';

export interface KustoToolsRuntime {
    getEnabled(): boolean;
    clientFactory: KustoClientFactory;
}

interface OwnedClient {
    credential: RustKustoCredential;
    client?: KustoClientLike;
    pending: Promise<KustoClientLike>;
}

/** One owner per server host; configuration and provider state never cross hosts. */
export function createKustoClientRuntime(
    getConfig: () => KustoAuthConfig,
    options: {
        buildClient?: typeof buildKustoClient;
        createProvider?: KustoProviderFactory;
        diagnostic?: (event: string) => void;
    } = {},
) {
    const namespace = `coc-kusto-${randomUUID()}`;
    const diagnostic = options.diagnostic ?? (event => console.debug(`[kusto-auth] engine=rust ${event}`));
    const buildClient = options.buildClient ?? buildKustoClient;
    let cache = new Map<string, OwnedClient>();
    let identity: string | undefined;
    let disposed = false;

    function clear(): void {
        const old = cache;
        cache = new Map();
        for (const entry of old.values()) {
            entry.credential.dispose();
            entry.client?.close?.();
        }
    }

    function syncConfig(): KustoAuthConfig {
        if (disposed) throw new KustoCredentialError('Kusto client owner is closed.');
        const config = getConfig();
        const next = JSON.stringify([
            config.enabled === true,
            config.azureCli?.account, config.azureCli?.tenant, config.azureCli?.subscription,
        ]);
        if (next !== identity) {
            clear();
            identity = next;
        }
        return config;
    }

    function resolveConfigForRun(): KustoAuthConfig {
        const config = syncConfig();
        if (!config.enabled) throw new KustoCredentialError('Kusto is disabled on the server host.');
        validateKustoAuthConfig(config);
        return config;
    }

    const clientFactory: KustoClientFactory = async ({ clusterUrl }) => {
        // Validate the target before metadata I/O.
        const cluster = validateKustoCluster(clusterUrl);
        const config = resolveConfigForRun();
        const owner = cache;
        let entry = owner.get(cluster);
        diagnostic(entry ? 'client-cache-hit source=azure-cli' : 'client-cache-miss source=azure-cli');
        if (!entry) {
            const credential = new RustKustoCredential(config, `${namespace}-${randomUUID()}`, options.createProvider, diagnostic);
            const owned: OwnedClient = { credential, pending: buildClient(cluster, credential).then(sdkClient => {
                if (!disposed) syncConfig();
                if (cache !== owner || disposed) {
                    sdkClient.close?.();
                    throw new KustoCredentialError('Kusto client configuration changed during construction. Run again explicitly.');
                }
                owned.client = sdkClient;
                return {
                    execute: async (database, query) => {
                        try { resolveConfigForRun(); }
                        catch (error) { clear(); throw error; }
                        if (cache !== owner) {
                            throw new KustoCredentialError('Kusto client configuration changed. Run again explicitly.');
                        }
                        try { return await sdkClient.execute(database, query); }
                        catch (error) {
                            // The SDK wraps credential errors; expose the native redacted error.
                            if (error instanceof Error && error.name === 'KustoAuthenticationError') {
                                throw kustoAuthError(Reflect.get(error, 'inner'));
                            }
                            throw error;
                        }
                    },
                    close: () => sdkClient.close?.(),
                };
            }).catch((error: unknown) => {
                credential.dispose();
                owner.delete(cluster);
                if (error instanceof KustoCredentialError) throw error;
                throw new KustoCredentialError('Kusto Rust auth: SDK client construction failed. Check the SDK and native installation.');
            }) };
            owner.set(cluster, owned);
            entry = owned;
        }
        return entry.pending;
    };

    return {
        clientFactory,
        getEnabled: () => getConfig().enabled === true,
        /** Called after host config updates; lazy reads also detect refresh() changes. */
        syncConfig,
        dispose(): void {
            disposed = true;
            clear();
        },
    };
}
