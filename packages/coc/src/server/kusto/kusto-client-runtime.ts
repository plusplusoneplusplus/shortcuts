import { randomUUID } from 'node:crypto';
import { buildKustoClient, type KustoClientFactory, type KustoClientLike, type KustoCommandClientLike, type KustoCommandClientFactory } from './kusto-exec';
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
    commandClientFactory?: KustoCommandClientFactory;
}

type RuntimeClient = KustoClientLike & Partial<KustoCommandClientLike>;

interface OwnedClient {
    credential: RustKustoCredential;
    client?: RuntimeClient;
    pending: Promise<KustoClientLike & KustoCommandClientLike>;
}

/** One owner per server host; configuration and provider state never cross hosts. */
export function createKustoClientRuntime(
    getConfig: () => KustoAuthConfig,
    options: {
        buildClient?: (cluster: string, credential: RustKustoCredential) => Promise<RuntimeClient>;
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

    const getClient = async (clusterUrl: string): Promise<KustoClientLike & KustoCommandClientLike> => {
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
                // Apply the same live ownership/auth checks to both explicit SDK contracts.
                const execute = async (method: 'executeQuery' | 'executeMgmt', database: string, text: string, signal?: AbortSignal) => {
                    signal?.throwIfAborted();
                    try { resolveConfigForRun(); }
                    catch (error) { clear(); throw error; }
                    if (cache !== owner) {
                        throw new KustoCredentialError('Kusto client configuration changed. Run again explicitly.');
                    }
                    const handler = sdkClient[method];
                    if (!handler) throw new Error('Kusto command execution is unavailable on this host.');
                    try { return await handler.call(sdkClient, database, text, ...(signal ? [signal] : [])); }
                    catch (error) {
                        // The SDK wraps credential errors; expose the native redacted error.
                        if (error instanceof Error && error.name === 'KustoAuthenticationError') {
                            throw kustoAuthError(Reflect.get(error, 'inner'));
                        }
                        throw error;
                    }
                };
                return {
                    executeQuery: (database, query, signal) => execute('executeQuery', database, query, signal),
                    executeMgmt: (database, command, signal) => execute('executeMgmt', database, command, signal),
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

    const clientFactory: KustoClientFactory = ({ clusterUrl }) => getClient(clusterUrl);
    const commandClientFactory: KustoCommandClientFactory = async ({ clusterUrl }) => {
        const client = await getClient(clusterUrl);
        return { executeMgmt: (database, command, signal) => client.executeMgmt(database, command, signal) };
    };

    return {
        clientFactory,
        commandClientFactory,
        getEnabled: () => getConfig().enabled === true,
        /** Called after host config updates; lazy reads also detect refresh() changes. */
        syncConfig,
        dispose(): void {
            disposed = true;
            clear();
        },
    };
}
