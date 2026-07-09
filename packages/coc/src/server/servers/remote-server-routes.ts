import type * as http from 'http';
import type { CherryPickTransferRequest } from '@plusplusoneplusplus/coc-client';
import type { Route } from '../types';
import { readJsonBody, send400, send404, send500, sendError, sendJson } from '../shared/router';
import type { DevTunnelConnector } from './devtunnel-connector';
import type { SshConnector } from './ssh-connector';
import { CherryPickTransferService, TransferHttpError } from './cherry-pick-transfer-service';
import { RemoteServerActionError, RemoteServerRuntimeService } from './remote-server-runtime-service';
import type { RemoteServerCreateInput } from './remote-server-types';
import { RemoteServerStore } from './remote-server-store';

export interface RegisterRemoteServerRoutesOptions {
    store: RemoteServerStore;
    connector: DevTunnelConnector;
    sshConnector?: SshConnector;
    getLocalBaseUrl?: () => string | undefined;
    requestTimeoutMs?: number;
}

function sendTransferFailure(res: http.ServerResponse, error: unknown): void {
    if (error instanceof TransferHttpError) {
        sendJson(res, error.body, error.statusCode);
        return;
    }
    send500(res, error instanceof Error ? error.message : String(error));
}

function sendRuntimeFailure(res: http.ServerResponse, error: unknown): void {
    if (error instanceof RemoteServerActionError) {
        sendError(res, error.statusCode, error.message);
        return;
    }
    send500(res, error instanceof Error ? error.message : String(error));
}

export function registerRemoteServerRoutes(
    routes: Route[],
    options: RegisterRemoteServerRoutesOptions,
): void {
    const runtime = new RemoteServerRuntimeService({
        store: options.store,
        connector: options.connector,
        sshConnector: options.sshConnector,
        getLocalBaseUrl: options.getLocalBaseUrl,
        requestTimeoutMs: options.requestTimeoutMs,
    });
    const transfer = new CherryPickTransferService({
        runtime,
        getLocalBaseUrl: options.getLocalBaseUrl,
        requestTimeoutMs: options.requestTimeoutMs,
    });

    routes.push({
        method: 'GET',
        pattern: '/api/servers',
        handler: (_req, res) => {
            try {
                sendJson(res, runtime.list());
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
                sendJson(res, await runtime.create(await readJsonBody(req)), 201);
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
            if (!runtime.getServer(id)) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            try {
                const updated = await runtime.update(id, await readJsonBody(req));
                if (!updated) {
                    send404(res, `Remote server not found: ${id}`);
                    return;
                }
                sendJson(res, updated);
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
            if (!runtime.remove(id)) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            sendJson(res, { ok: true });
        },
    });

    routes.push({
        method: 'POST',
        pattern: '/api/servers/test',
        handler: async (req, res) => {
            try {
                const input = runtime.validateCreate(await readJsonBody(req));
                sendJson(res, await runtime.test(input));
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
                sendJson(res, await transfer.run(body));
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
            try {
                const runtimeState = await runtime.connect(id);
                if (!runtimeState) {
                    send404(res, `Remote server not found: ${id}`);
                    return;
                }
                sendJson(res, runtimeState);
            } catch (error) {
                sendRuntimeFailure(res, error);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/servers\/([^/]+)\/disconnect$/,
        handler: (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            try {
                const runtimeState = runtime.disconnect(id);
                if (!runtimeState) {
                    send404(res, `Remote server not found: ${id}`);
                    return;
                }
                sendJson(res, runtimeState);
            } catch (error) {
                sendRuntimeFailure(res, error);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/servers\/([^/]+)\/reconnect$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            try {
                const runtimeState = await runtime.reconnect(id);
                if (!runtimeState) {
                    send404(res, `Remote server not found: ${id}`);
                    return;
                }
                sendJson(res, runtimeState);
            } catch (error) {
                sendRuntimeFailure(res, error);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/servers\/([^/]+)\/restart$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            try {
                const outcome = await runtime.restart(id);
                if (!outcome) {
                    send404(res, `Remote server not found: ${id}`);
                    return;
                }
                if (!outcome.result.ok) {
                    sendError(res, 502, `Failed to restart remote server "${outcome.server.label}": ${outcome.result.error ?? 'unknown error'}`);
                    return;
                }
                sendJson(res, { ok: true, message: 'Server is restarting...' }, 202);
            } catch (error) {
                sendRuntimeFailure(res, error);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/servers\/([^/]+)\/health$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const health = await runtime.healthById(id);
            if (!health) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            sendJson(res, health);
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/servers\/([^/]+)\/connection$/,
        handler: (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const runtimeState = runtime.runtimeById(id);
            if (!runtimeState) {
                send404(res, `Remote server not found: ${id}`);
                return;
            }
            sendJson(res, runtimeState);
        },
    });
}

export function createRemoteServerStore(dataDir: string): RemoteServerStore {
    return new RemoteServerStore(dataDir);
}

export type { RemoteServerCreateInput };
