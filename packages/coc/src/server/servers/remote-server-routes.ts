import type { Route } from '../types';
import { CocApiError, CocClient } from '@plusplusoneplusplus/coc-client';
import type {
    CherryPickTransferRequest,
    CherryPickTransferResponse,
    GitOpServerMetadata,
    GitPatchApplyRequest,
    GitPatchApplyResponse,
    GitPatchExportResponse,
} from '@plusplusoneplusplus/coc-client';
import { readJsonBody, send400, send404, send500, sendError, sendJson } from '../shared/router';
import type { DevTunnelConnector } from './devtunnel-connector';
import type { SshConnector, SshConnectionState } from './ssh-connector';
import { checkRemoteServerHealth, requestRemoteServerRestart } from './remote-server-health';
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

export interface RegisterRemoteServerRoutesOptions {
    store: RemoteServerStore;
    connector: DevTunnelConnector;
    sshConnector?: SshConnector;
    getLocalBaseUrl?: () => string | undefined;
    requestTimeoutMs?: number;
}

const LOCAL_SERVER_METADATA: GitOpServerMetadata = { id: 'local', label: 'Current CoC' };

/**
 * Cached reachability for `url`-kind servers, keyed by server id.
 *
 * `url`-kind remotes have no persistent connector (unlike ssh/devtunnel, whose
 * connectors keep live runtime state). Their runtime status is instead the last
 * health-probe result against the configured `url`: every `healthForServer` call
 * (the `/health` endpoint, plus create/update) records it here, and the
 * synchronous list/decorate path reads it back. A server stays `idle` until its
 * first probe — matching the pre-existing baseline and the ssh/devtunnel
 * "not yet connected" state — and only an actually reachable url reports
 * `online`; an unreachable one reports `offline`.
 */
type UrlHealthCache = Map<string, RemoteServerHealth>;

/** Map a cached url health probe onto the runtime status vocabulary. */
function urlRuntimeStatus(health: RemoteServerHealth | undefined): RemoteServerRuntimeStatus {
    if (!health) return 'idle';
    return health.status === 'online' ? 'online' : 'offline';
}

interface ParsedTransferEndpoint {
    serverId?: string;
    workspaceId: string;
}

interface ParsedTransferRequest {
    source: ParsedTransferEndpoint & { hashes: string[] };
    target: ParsedTransferEndpoint & { stashAndContinue: boolean };
}

interface ResolvedTransferEndpoint {
    client: CocClient;
    server: GitOpServerMetadata;
}

class TransferHttpError extends Error {
    constructor(
        readonly statusCode: number,
        readonly body: Record<string, unknown>,
    ) {
        super(String(body.error ?? 'Cherry-pick transfer failed'));
    }
}

function toRuntime(
    server: RemoteServer,
    connector: DevTunnelConnector,
    sshConnector?: SshConnector,
    urlHealthCache?: UrlHealthCache,
): RemoteServerRuntime {
    if (server.kind === 'url') {
        const health = urlHealthCache?.get(server.id);
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

function decorate(
    server: RemoteServer,
    connector: DevTunnelConnector,
    sshConnector?: SshConnector,
    urlHealthCache?: UrlHealthCache,
): RemoteServerWithRuntime {
    const runtime = toRuntime(server, connector, sshConnector, urlHealthCache);
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

function transferError(statusCode: number, body: Record<string, unknown>): never {
    throw new TransferHttpError(statusCode, body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function parseTransferEndpoint(value: unknown, label: 'source' | 'target'): ParsedTransferEndpoint {
    if (!isRecord(value)) {
        transferError(400, { error: `${label} must be an object` });
    }
    const workspaceId = nonEmptyString(value.workspaceId);
    if (!workspaceId) {
        transferError(400, { error: `${label}.workspaceId is required` });
    }
    const rawServerId = nonEmptyString(value.serverId);
    const serverId = rawServerId && rawServerId !== LOCAL_SERVER_METADATA.id ? rawServerId : undefined;
    return { serverId, workspaceId };
}

const TRANSFER_HASH_PATTERN = /^[a-fA-F0-9]{4,40}$/;

function parseSourceHashes(source: Record<string, unknown>): string[] {
    if (Array.isArray(source.commitHashes)) {
        const hashes = source.commitHashes
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim())
            .filter(value => value.length > 0);
        if (hashes.length === 0) {
            transferError(400, { error: 'source.commitHashes must contain at least one git commit hash' });
        }
        if (!hashes.every(value => TRANSFER_HASH_PATTERN.test(value))) {
            transferError(400, { error: 'source.commitHashes must all be git commit hashes' });
        }
        return hashes;
    }
    const commitHash = nonEmptyString(source.commitHash);
    if (!commitHash || !TRANSFER_HASH_PATTERN.test(commitHash)) {
        transferError(400, { error: 'source.commitHash is required and must be a git commit hash' });
    }
    return [commitHash];
}

function parseTransferRequest(value: unknown): ParsedTransferRequest {
    if (!isRecord(value)) {
        transferError(400, { error: 'Request body must be a JSON object' });
    }
    const source = parseTransferEndpoint(value.source, 'source');
    const target = parseTransferEndpoint(value.target, 'target');
    if (!isRecord(value.source)) {
        transferError(400, { error: 'source must be an object' });
    }
    const hashes = parseSourceHashes(value.source);
    const stashAndContinue = isRecord(value.target) && value.target.stashAndContinue === true;
    return {
        source: { ...source, hashes },
        target: { ...target, stashAndContinue },
    };
}

function endpointLabel(endpoint: ResolvedTransferEndpoint): string {
    return endpoint.server.label ? `${endpoint.server.label} (${endpoint.server.id})` : endpoint.server.id;
}

function remoteErrorBody(error: CocApiError, phase: 'export' | 'apply', endpoint: ResolvedTransferEndpoint): Record<string, unknown> {
    const body: Record<string, unknown> = isRecord(error.body) ? { ...error.body } : { error: error.message };
    if (typeof body.error !== 'string' || !body.error) {
        body.error = error.message;
    }
    body.phase = phase;
    body.server = endpoint.server;
    return body;
}

async function callEndpoint<T>(
    endpoint: ResolvedTransferEndpoint,
    phase: 'export' | 'apply',
    action: () => Promise<T>,
): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof CocApiError) {
            transferError(error.status || 502, remoteErrorBody(error, phase, endpoint));
        }
        const message = error instanceof Error ? error.message : String(error);
        transferError(502, {
            error: `Failed to ${phase} commit patch via ${endpointLabel(endpoint)}: ${message}`,
            phase,
            server: endpoint.server,
        });
    }
}

async function resolveTransferEndpoint(
    ref: ParsedTransferEndpoint,
    options: RegisterRemoteServerRoutesOptions,
    urlHealthCache: UrlHealthCache,
): Promise<ResolvedTransferEndpoint> {
    const timeoutMs = options.requestTimeoutMs ?? 30_000;
    if (!ref.serverId) {
        const localBaseUrl = options.getLocalBaseUrl?.();
        if (!localBaseUrl) {
            transferError(503, {
                error: 'Current CoC server is not available for local cherry-pick transfer',
                server: LOCAL_SERVER_METADATA,
                status: 'offline',
            });
        }
        return {
            client: new CocClient({ baseUrl: localBaseUrl, timeoutMs }),
            server: LOCAL_SERVER_METADATA,
        };
    }

    const server = options.store.get(ref.serverId);
    if (!server) {
        transferError(404, { error: `Remote server not found: ${ref.serverId}` });
    }
    const health = await healthForServer(server, options.connector, options.sshConnector, urlHealthCache);
    const metadata: GitOpServerMetadata = { id: server.id, label: server.label };
    if (health.status !== 'online' || !health.effectiveUrl) {
        transferError(503, {
            error: `Remote server "${server.label}" is not online${health.error ? `: ${health.error}` : ''}`,
            server: metadata,
            status: health.status,
            lastError: health.error,
        });
    }
    return {
        client: new CocClient({ baseUrl: health.effectiveUrl, timeoutMs }),
        server: metadata,
    };
}

async function runCherryPickTransfer(
    request: ParsedTransferRequest,
    options: RegisterRemoteServerRoutesOptions,
    urlHealthCache: UrlHealthCache,
): Promise<CherryPickTransferResponse> {
    const sourceEndpoint = await resolveTransferEndpoint(request.source, options, urlHealthCache);
    const targetEndpoint = await resolveTransferEndpoint(request.target, options, urlHealthCache);

    const exported = await callEndpoint<GitPatchExportResponse>(
        sourceEndpoint,
        'export',
        () => sourceEndpoint.client.git.exportCommitPatches(request.source.workspaceId, request.source.hashes),
    );
    const sourceCommits = exported.sourceCommits ?? [exported.sourceCommit];
    const applyRequest: GitPatchApplyRequest = {
        patch: exported.patch,
        stashAndContinue: request.target.stashAndContinue,
        sourceServer: sourceEndpoint.server,
        sourceWorkspace: exported.sourceWorkspace,
        sourceCommit: exported.sourceCommit,
        sourceCommits,
        normalizedSourceRemoteUrl: exported.normalizedSourceRemoteUrl,
    };
    const applied = await callEndpoint<GitPatchApplyResponse>(
        targetEndpoint,
        'apply',
        () => targetEndpoint.client.git.applyCommitPatch(request.target.workspaceId, applyRequest),
    );

    return {
        success: true,
        source: {
            server: sourceEndpoint.server,
            workspace: exported.sourceWorkspace,
            commit: exported.sourceCommit,
            commits: sourceCommits,
            normalizedRemoteUrl: exported.normalizedSourceRemoteUrl,
        },
        target: {
            server: targetEndpoint.server,
            workspace: applied.targetWorkspace,
            branch: applied.targetBranch,
            head: applied.targetHead ?? applied.newCommitHash,
        },
        result: applied,
    };
}

function sendTransferFailure(res: import('http').ServerResponse, error: unknown): void {
    if (error instanceof TransferHttpError) {
        sendJson(res, error.body, error.statusCode);
        return;
    }
    send500(res, error instanceof Error ? error.message : String(error));
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

async function healthForServer(
    server: RemoteServer,
    connector: DevTunnelConnector,
    sshConnector?: SshConnector,
    urlHealthCache?: UrlHealthCache,
): Promise<RemoteServerHealth> {
    if (server.kind === 'devtunnel') {
        await connectIfDevTunnel(server, connector);
    }
    if (server.kind === 'ssh') {
        await connectIfSsh(server, sshConnector);
    }
    const runtime = toRuntime(server, connector, sshConnector, urlHealthCache);
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
    // `url`-kind has no connector to hold runtime state, so the probe result IS
    // the runtime status. Record it (keyed by the real server id) so the
    // synchronous list/decorate path reflects actual reachability.
    if (server.kind === 'url' && urlHealthCache) {
        urlHealthCache.set(server.id, health);
    }
    return health;
}

export function registerRemoteServerRoutes(
    routes: Route[],
    options: RegisterRemoteServerRoutesOptions,
): void {
    const { store, connector, sshConnector } = options;

    // Last-known reachability for url-kind servers (see UrlHealthCache). Lives for
    // the life of the route registration, the same lifetime as the ssh/devtunnel
    // connectors whose runtime state it mirrors for the connector-less url kind.
    const urlHealthCache: UrlHealthCache = new Map();
    // In-flight url health probes, so concurrent list requests share one probe per
    // server instead of stampeding the remote.
    const urlHealthInFlight = new Set<string>();

    /**
     * Serve-stale-revalidate: refresh url-kind reachability in the background so
     * the next list reflects the current state, without blocking this response.
     * Equivalent to how ssh/devtunnel connectors keep their state warm out of band.
     */
    function refreshUrlHealth(servers: RemoteServer[]): void {
        for (const server of servers) {
            if (server.kind !== 'url' || urlHealthInFlight.has(server.id)) {
                continue;
            }
            urlHealthInFlight.add(server.id);
            void healthForServer(server, connector, sshConnector, urlHealthCache)
                .catch(() => {
                    // checkRemoteServerHealth never rejects; this is defensive only.
                })
                .finally(() => {
                    urlHealthInFlight.delete(server.id);
                });
        }
    }

    routes.push({
        method: 'GET',
        pattern: '/api/servers',
        handler: (_req, res) => {
            try {
                const servers = store.list();
                sendJson(res, servers.map(server => decorate(server, connector, sshConnector, urlHealthCache)));
                // Kick off a background reachability refresh for url-kind remotes so a
                // reachable one converges to `online` (and an unreachable one to
                // `offline`) on subsequent polls, without delaying this response.
                refreshUrlHealth(servers);
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
                // Probe a new url-kind remote up front so the create response (and the
                // next list) reflects whether it is actually reachable.
                if (server.kind === 'url') {
                    await healthForServer(server, connector, sshConnector, urlHealthCache);
                }
                sendJson(res, decorate(server, connector, sshConnector, urlHealthCache), 201);
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
                if (before.kind === 'url' && updated.kind !== 'url') {
                    urlHealthCache.delete(before.id);
                }
                await connectIfDevTunnel(updated, connector);
                await connectIfSsh(updated, sshConnector);
                // The url may have changed; re-probe so the response reflects the new target.
                if (updated.kind === 'url') {
                    await healthForServer(updated, connector, sshConnector, urlHealthCache);
                }
                sendJson(res, decorate(updated, connector, sshConnector, urlHealthCache));
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
            if (removed.kind === 'url') {
                urlHealthCache.delete(removed.id);
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
                    sendJson(res, await healthForServer(server, connector, sshConnector, urlHealthCache));
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
                sendJson(res, await healthForServer(server, connector, sshConnector, urlHealthCache));
            } catch (error) {
                send400(res, error instanceof Error ? error.message : String(error));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: '/api/servers/cherry-pick-transfer',
        handler: async (req, res) => {
            try {
                const body = await readJsonBody<CherryPickTransferRequest>(req);
                sendJson(res, await runCherryPickTransfer(parseTransferRequest(body), options, urlHealthCache));
            } catch (error) {
                sendTransferFailure(res, error);
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
                sendJson(res, toRuntime(server, connector, sshConnector, urlHealthCache));
                return;
            }
            await connectIfDevTunnel(server, connector);
            sendJson(res, toRuntime(server, connector, sshConnector, urlHealthCache));
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
                sendJson(res, toRuntime(server, connector, sshConnector, urlHealthCache));
                return;
            }
            try {
                await connector.reconnect(server.tunnelId);
            } catch {
                // The failed state is stored on the connector and returned below.
            }
            sendJson(res, toRuntime(server, connector, sshConnector, urlHealthCache));
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/servers\/([^/]+)\/restart$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const server = store.get(id);
            if (!server) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            // Restart the *remote process*, distinct from /reconnect (which only
            // re-spawns the local tunnel). Reach the remote the same way the health
            // checker does: build the target from the server's resolved effectiveUrl
            // (tunnel servers via their local forwarded port, url servers directly).
            // Stateless proxy — nothing is persisted.
            const { effectiveUrl } = toRuntime(server, connector, sshConnector, urlHealthCache);
            if (!effectiveUrl) {
                sendError(res, 502, `Remote server "${server.label}" has no reachable endpoint to restart`);
                return;
            }
            const result = await requestRemoteServerRestart(effectiveUrl);
            if (!result.ok) {
                sendError(res, 502, `Failed to restart remote server "${server.label}": ${result.error ?? 'unknown error'}`);
                return;
            }
            // The remote replied 2xx before exiting → restart accepted.
            sendJson(res, { ok: true, message: 'Server is restarting...' }, 202);
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
            sendJson(res, await healthForServer(server, connector, sshConnector, urlHealthCache));
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
            sendJson(res, toRuntime(server, connector, sshConnector, urlHealthCache));
        },
    });
}

export function createRemoteServerStore(dataDir: string): RemoteServerStore {
    return new RemoteServerStore(dataDir);
}

export type { RemoteServerCreateInput };
