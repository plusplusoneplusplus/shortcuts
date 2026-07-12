import type { DevTunnelConnector } from './devtunnel-connector';
import type { SshConnector, SshConnectionState } from './ssh-connector';
import { checkRemoteServerHealth, requestRemoteServerRestart, type RemoteRestartResult } from './remote-server-health';
import type {
    DevTunnelRemoteServer,
    RemoteServer,
    RemoteServerCreateInput,
    RemoteServerHealth,
    RemoteServerRuntime,
    RemoteServerRuntimeStatus,
    RemoteServerWithRuntime,
    SshRemoteServer,
} from './remote-server-types';
import { RemoteServerStore } from './remote-server-store';

export interface RemoteServerRuntimeServiceOptions {
    store: RemoteServerStore;
    connector: DevTunnelConnector;
    sshConnector?: SshConnector;
    getLocalBaseUrl?: () => string | undefined;
    requestTimeoutMs?: number;
}

type UrlHealthCache = Map<string, RemoteServerHealth>;

export type RemoteServerDisconnectResult =
    | (RemoteServerRuntime & { kind: 'devtunnel'; tunnelId: string })
    | ({ kind: 'ssh' } & SshConnectionState);

export interface RemoteServerRestartOutcome {
    server: RemoteServer;
    result: RemoteRestartResult;
}

export class RemoteServerActionError extends Error {
    constructor(
        readonly statusCode: number,
        message: string,
    ) {
        super(message);
    }
}

/** Map a cached url health probe onto the runtime status vocabulary. */
function urlRuntimeStatus(health: RemoteServerHealth | undefined): RemoteServerRuntimeStatus {
    if (!health) {
        return 'idle';
    }
    return health.status === 'online' ? 'online' : 'offline';
}

export class RemoteServerRuntimeService {
    private readonly urlHealthCache: UrlHealthCache = new Map();
    private readonly urlHealthInFlight = new Set<string>();

    constructor(private readonly options: RemoteServerRuntimeServiceOptions) {}

    list(): RemoteServerWithRuntime[] {
        const servers = this.options.store.list();
        const decorated = servers.map(server => this.decorate(server));
        this.refreshUrlHealth(servers);
        return decorated;
    }

    getServer(id: string): RemoteServer | undefined {
        return this.options.store.get(id);
    }

    validateCreate(value: unknown): RemoteServerCreateInput {
        return this.options.store.validateCreate(value);
    }

    async create(value: unknown): Promise<RemoteServerWithRuntime> {
        const server = this.options.store.create(value);
        await this.connectManaged(server);
        if (server.kind === 'url') {
            await this.healthForServer(server);
        }
        return this.decorate(server);
    }

    async update(id: string, value: unknown): Promise<RemoteServerWithRuntime | undefined> {
        const before = this.options.store.get(id);
        if (!before) {
            return undefined;
        }

        const updated = this.options.store.update(id, value);
        this.cleanupChangedRuntime(before, updated);
        await this.connectManaged(updated);
        if (updated.kind === 'url') {
            await this.healthForServer(updated);
        }
        return this.decorate(updated);
    }

    remove(id: string): boolean {
        const removed = this.options.store.remove(id);
        if (!removed) {
            return false;
        }
        this.cleanupRemovedRuntime(removed);
        return true;
    }

    async test(input: RemoteServerCreateInput): Promise<RemoteServerHealth> {
        if (input.kind === 'url') {
            return checkRemoteServerHealth({
                serverId: 'test',
                kind: 'url',
                baseUrl: input.url,
            });
        }
        if (input.kind === 'devtunnel') {
            const server: DevTunnelRemoteServer = {
                id: 'test',
                label: input.label,
                kind: 'devtunnel',
                tunnelId: input.tunnelId,
                addedAt: Date.now(),
                updatedAt: Date.now(),
            };
            return this.healthForServer(server);
        }
        const server: SshRemoteServer = {
            id: 'test',
            label: input.label,
            kind: 'ssh',
            host: input.host,
            localPort: input.localPort,
            addedAt: Date.now(),
            updatedAt: Date.now(),
        };
        return this.healthForServer(server);
    }

    async connect(id: string): Promise<RemoteServerRuntime | undefined> {
        const server = this.options.store.get(id);
        if (!server) {
            return undefined;
        }
        this.assertManagedServer(server, 'connect');
        await this.connectManaged(server);
        return this.toRuntime(server);
    }

    disconnect(id: string): RemoteServerDisconnectResult | undefined {
        const server = this.options.store.get(id);
        if (!server) {
            return undefined;
        }
        this.assertManagedServer(server, 'disconnect');
        if (server.kind === 'ssh') {
            const state = this.options.sshConnector?.disconnect(server.id) ?? {
                serverId: server.id,
                host: server.host,
                localPort: server.localPort,
                status: 'idle' as const,
            };
            return { kind: 'ssh', ...state };
        }
        return {
            serverId: server.id,
            kind: 'devtunnel',
            ...this.options.connector.disconnect(server.tunnelId),
        };
    }

    async reconnect(id: string): Promise<RemoteServerRuntime | undefined> {
        const server = this.options.store.get(id);
        if (!server) {
            return undefined;
        }
        this.assertManagedServer(server, 'reconnect');
        if (server.kind === 'ssh') {
            if (this.options.sshConnector) {
                try {
                    await this.options.sshConnector.reconnect(server);
                } catch {
                    // Failed state is stored on the connector and returned below.
                }
            }
            return this.toRuntime(server);
        }
        try {
            await this.options.connector.reconnect(server.tunnelId);
        } catch {
            // Failed state is stored on the connector and returned below.
        }
        return this.toRuntime(server);
    }

    async restart(id: string): Promise<RemoteServerRestartOutcome | undefined> {
        const server = this.options.store.get(id);
        if (!server) {
            return undefined;
        }
        const { effectiveUrl } = this.toRuntime(server);
        if (!effectiveUrl) {
            throw new RemoteServerActionError(502, `Remote server "${server.label}" has no reachable endpoint to restart`);
        }
        return {
            server,
            result: await requestRemoteServerRestart(effectiveUrl),
        };
    }

    async healthById(id: string): Promise<RemoteServerHealth | undefined> {
        const server = this.options.store.get(id);
        if (!server) {
            return undefined;
        }
        return this.healthForServer(server);
    }

    runtimeById(id: string): RemoteServerRuntime | undefined {
        const server = this.options.store.get(id);
        if (!server) {
            return undefined;
        }
        return this.toRuntime(server);
    }

    async healthForServer(server: RemoteServer): Promise<RemoteServerHealth> {
        await this.connectManaged(server);
        const runtime = this.toRuntime(server);
        const baseUrl = server.kind === 'url' ? server.url : runtime.effectiveUrl;
        const health = await checkRemoteServerHealth({
            serverId: server.id,
            kind: server.kind,
            baseUrl,
            tunnelId: server.kind === 'devtunnel' ? server.tunnelId : undefined,
            localPort: runtime.localPort,
            publicUrl: runtime.publicUrl,
            lastError: runtime.lastError,
        });
        if (server.kind === 'url') {
            this.urlHealthCache.set(server.id, health);
        }
        return health;
    }

    toRuntime(server: RemoteServer): RemoteServerRuntime {
        if (server.kind === 'url') {
            const health = this.urlHealthCache.get(server.id);
            return {
                serverId: server.id,
                kind: 'url',
                effectiveUrl: server.url,
                status: urlRuntimeStatus(health),
                lastChecked: health?.lastChecked,
                lastError: health?.status === 'online' ? undefined : health?.error,
            };
        }
        if (server.kind === 'ssh') {
            const state: SshConnectionState | undefined = this.options.sshConnector?.getState(server.id);
            return {
                serverId: server.id,
                kind: 'ssh',
                effectiveUrl: state?.effectiveUrl,
                status: state?.status ?? 'idle',
                localPort: server.localPort,
                lastChecked: state?.lastChecked,
                lastError: state?.lastError,
            };
        }
        const state = this.options.connector.getState(server.tunnelId);
        return {
            serverId: server.id,
            kind: 'devtunnel',
            effectiveUrl: state.effectiveUrl,
            status: state.status,
            tunnelId: server.tunnelId,
            localPort: state.port,
            publicUrl: state.publicUrl,
            lastChecked: state.lastChecked,
            lastError: state.lastError,
        };
    }

    decorate(server: RemoteServer): RemoteServerWithRuntime {
        const runtime = this.toRuntime(server);
        return {
            ...server,
            effectiveUrl: runtime.effectiveUrl,
            status: runtime.status,
            tunnelId: server.kind === 'devtunnel' ? server.tunnelId : runtime.tunnelId,
            localPort: runtime.localPort,
            publicUrl: runtime.publicUrl,
            lastChecked: runtime.lastChecked,
            lastError: runtime.lastError,
        } as RemoteServerWithRuntime;
    }

    private async connectManaged(server: RemoteServer): Promise<void> {
        if (server.kind === 'devtunnel') {
            try {
                await this.options.connector.connect(server.tunnelId);
            } catch {
                // The failed state is stored on the connector and returned to callers.
            }
            return;
        }
        if (server.kind === 'ssh' && this.options.sshConnector) {
            try {
                await this.options.sshConnector.connect(server);
            } catch {
                // The failed state is stored on the connector and returned to callers.
            }
        }
    }

    private refreshUrlHealth(servers: RemoteServer[]): void {
        for (const server of servers) {
            if (server.kind !== 'url' || this.urlHealthInFlight.has(server.id)) {
                continue;
            }
            this.urlHealthInFlight.add(server.id);
            void this.healthForServer(server)
                .catch(() => {
                    // checkRemoteServerHealth never rejects; this is defensive only.
                })
                .finally(() => {
                    this.urlHealthInFlight.delete(server.id);
                });
        }
    }

    private cleanupChangedRuntime(before: RemoteServer, updated: RemoteServer): void {
        if (before.kind === 'devtunnel' && (updated.kind !== 'devtunnel' || updated.tunnelId !== before.tunnelId)) {
            this.disconnectIfUnusedTunnel(before.tunnelId);
        }
        if (before.kind === 'ssh' && (
            updated.kind !== 'ssh'
            || updated.host !== before.host
            || updated.localPort !== before.localPort
        )) {
            this.options.sshConnector?.disconnect(before.id);
        }
        if (before.kind === 'url' && updated.kind !== 'url') {
            this.urlHealthCache.delete(before.id);
        }
    }

    private cleanupRemovedRuntime(removed: RemoteServer): void {
        if (removed.kind === 'devtunnel') {
            this.disconnectIfUnusedTunnel(removed.tunnelId);
        }
        if (removed.kind === 'ssh') {
            this.options.sshConnector?.disconnect(removed.id);
        }
        if (removed.kind === 'url') {
            this.urlHealthCache.delete(removed.id);
        }
    }

    private disconnectIfUnusedTunnel(tunnelId: string): void {
        const stillUsed = this.options.store.list().some(server => server.kind === 'devtunnel' && server.tunnelId === tunnelId);
        if (!stillUsed) {
            this.options.connector.disconnect(tunnelId);
        }
    }

    private assertManagedServer(server: RemoteServer, action: 'connect' | 'disconnect' | 'reconnect'): asserts server is DevTunnelRemoteServer | SshRemoteServer {
        if (server.kind === 'url') {
            throw new RemoteServerActionError(400, `Direct URL servers do not support ${action}`);
        }
    }
}
