import type { Route } from '../types';
import { readJsonBody, send400, send404, send500, sendError, sendJson } from '../shared/router';
import type { DevTunnelConnector } from './devtunnel-connector';
import type { SshConnector, SshConnectionState } from './ssh-connector';
import { checkRemoteServerHealth } from './remote-server-health';
import type {
    DevTunnelRemoteServer,
    RemoteServer,
    RemoteServerCreateInput,
    RemoteServerRuntime,
    RemoteServerWithRuntime,
    SshRemoteServer,
} from './remote-server-types';
import { RemoteServerStore } from './remote-server-store';

export interface RegisterRemoteServerRoutesOptions {
    store: RemoteServerStore;
    connector: DevTunnelConnector;
    sshConnector?: SshConnector;
}

function toRuntime(server: RemoteServer, connector: DevTunnelConnector, sshConnector?: SshConnector): RemoteServerRuntime {
    if (server.kind === 'url') {
        return {
            serverId: server.id,
            kind: 'url',
            effectiveUrl: server.url,
            status: 'idle',
        };
    }
    if (server.kind === 'ssh') {
        const state: SshConnectionState | undefined = sshConnector?.getState(server.id);
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
    const state = connector.getState(server.tunnelId);
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

function decorate(server: RemoteServer, connector: DevTunnelConnector, sshConnector?: SshConnector): RemoteServerWithRuntime {
    const runtime = toRuntime(server, connector, sshConnector);
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

async function connectIfDevTunnel(server: RemoteServer, connector: DevTunnelConnector): Promise<void> {
    if (server.kind !== 'devtunnel') {
        return;
    }
    try {
        await connector.connect(server.tunnelId);
    } catch {
        // The failed state is stored on the connector and returned to the caller.
    }
}

async function connectIfSsh(server: RemoteServer, sshConnector?: SshConnector): Promise<void> {
    if (server.kind !== 'ssh' || !sshConnector) {
        return;
    }
    try {
        await sshConnector.connect(server);
    } catch {
        // The failed state is stored on the connector and returned to the caller.
    }
}

function disconnectIfUnusedTunnel(tunnelId: string, store: RemoteServerStore, connector: DevTunnelConnector): void {
    const stillUsed = store.list().some(server => server.kind === 'devtunnel' && server.tunnelId === tunnelId);
    if (!stillUsed) {
        connector.disconnect(tunnelId);
    }
}

async function healthForServer(server: RemoteServer, connector: DevTunnelConnector, sshConnector?: SshConnector) {
    if (server.kind === 'devtunnel') {
        await connectIfDevTunnel(server, connector);
    }
    if (server.kind === 'ssh') {
        await connectIfSsh(server, sshConnector);
    }
    const runtime = toRuntime(server, connector, sshConnector);
    const baseUrl = server.kind === 'url' ? server.url : runtime.effectiveUrl;
    return checkRemoteServerHealth({
        serverId: server.id,
        kind: server.kind,
        baseUrl,
        tunnelId: server.kind === 'devtunnel' ? server.tunnelId : undefined,
        localPort: runtime.localPort,
        publicUrl: runtime.publicUrl,
        lastError: runtime.lastError,
    });
}

export function registerRemoteServerRoutes(
    routes: Route[],
    options: RegisterRemoteServerRoutesOptions,
): void {
    const { store, connector, sshConnector } = options;

    routes.push({
        method: 'GET',
        pattern: '/api/servers',
        handler: (_req, res) => {
            try {
                sendJson(res, store.list().map(server => decorate(server, connector, sshConnector)));
            } catch (error) {
                send500(res, error instanceof Error ? error.message : String(error));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: '/api/servers',
        handler: async (req, res) => {
            try {
                const server = store.create(await readJsonBody(req));
                await connectIfDevTunnel(server, connector);
                await connectIfSsh(server, sshConnector);
                sendJson(res, decorate(server, connector, sshConnector), 201);
            } catch (error) {
                send400(res, error instanceof Error ? error.message : String(error));
            }
        },
    });

    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/servers\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const before = store.get(id);
            if (!before) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            try {
                const updated = store.update(id, await readJsonBody(req));
                if (before.kind === 'devtunnel' && (updated.kind !== 'devtunnel' || updated.tunnelId !== before.tunnelId)) {
                    disconnectIfUnusedTunnel(before.tunnelId, store, connector);
                }
                if (before.kind === 'ssh' && updated.kind !== 'ssh') {
                    sshConnector?.disconnect(before.id);
                }
                await connectIfDevTunnel(updated, connector);
                await connectIfSsh(updated, sshConnector);
                sendJson(res, decorate(updated, connector, sshConnector));
            } catch (error) {
                send400(res, error instanceof Error ? error.message : String(error));
            }
        },
    });

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/servers\/([^/]+)$/,
        handler: (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const removed = store.remove(id);
            if (!removed) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            if (removed.kind === 'devtunnel') {
                disconnectIfUnusedTunnel(removed.tunnelId, store, connector);
            }
            if (removed.kind === 'ssh') {
                sshConnector?.disconnect(removed.id);
            }
            sendJson(res, { ok: true });
        },
    });

    routes.push({
        method: 'POST',
        pattern: '/api/servers/test',
        handler: async (req, res) => {
            try {
                const input = store.validateCreate(await readJsonBody(req));
                if (input.kind === 'url') {
                    sendJson(res, await checkRemoteServerHealth({
                        serverId: 'test',
                        kind: 'url',
                        baseUrl: input.url,
                    }));
                    return;
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
                    sendJson(res, await healthForServer(server, connector, sshConnector));
                    return;
                }
                // ssh kind: health check against the local forwarded port (no spawn at test time)
                const server: SshRemoteServer = {
                    id: 'test',
                    label: input.label,
                    kind: 'ssh',
                    host: input.host,
                    localPort: input.localPort,
                    addedAt: Date.now(),
                    updatedAt: Date.now(),
                };
                sendJson(res, await healthForServer(server, connector, sshConnector));
            } catch (error) {
                send400(res, error instanceof Error ? error.message : String(error));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/servers\/([^/]+)\/connect$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const server = store.get(id);
            if (!server) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            if (server.kind === 'url') {
                sendError(res, 400, 'Direct URL servers do not support connect');
                return;
            }
            if (server.kind === 'ssh') {
                await connectIfSsh(server, sshConnector);
                sendJson(res, toRuntime(server, connector, sshConnector));
                return;
            }
            await connectIfDevTunnel(server, connector);
            sendJson(res, toRuntime(server, connector, sshConnector));
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/servers\/([^/]+)\/disconnect$/,
        handler: (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const server = store.get(id);
            if (!server) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            if (server.kind === 'url') {
                sendError(res, 400, 'Direct URL servers do not support disconnect');
                return;
            }
            if (server.kind === 'ssh') {
                const state = sshConnector?.disconnect(server.id) ?? { serverId: server.id, host: server.host, localPort: server.localPort, status: 'idle' as const };
                sendJson(res, { kind: 'ssh' as const, ...state });
                return;
            }
            sendJson(res, {
                serverId: server.id,
                kind: 'devtunnel',
                ...connector.disconnect(server.tunnelId),
            });
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/servers\/([^/]+)\/reconnect$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const server = store.get(id);
            if (!server) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            if (server.kind === 'url') {
                sendError(res, 400, 'Direct URL servers do not support reconnect');
                return;
            }
            if (server.kind === 'ssh') {
                if (sshConnector) {
                    try {
                        await sshConnector.reconnect(server);
                    } catch {
                        // Failed state is stored on the connector.
                    }
                }
                sendJson(res, toRuntime(server, connector, sshConnector));
                return;
            }
            try {
                await connector.reconnect(server.tunnelId);
            } catch {
                // The failed state is stored on the connector and returned below.
            }
            sendJson(res, toRuntime(server, connector, sshConnector));
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/servers\/([^/]+)\/health$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const server = store.get(id);
            if (!server) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            sendJson(res, await healthForServer(server, connector, sshConnector));
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/servers\/([^/]+)\/connection$/,
        handler: (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const server = store.get(id);
            if (!server) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            sendJson(res, toRuntime(server, connector, sshConnector));
        },
    });
}

export function createRemoteServerStore(dataDir: string): RemoteServerStore {
    return new RemoteServerStore(dataDir);
}

export type { RemoteServerCreateInput };
