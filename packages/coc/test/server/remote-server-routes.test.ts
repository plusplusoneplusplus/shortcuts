import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';
import { DevTunnelConnector, type DevTunnelChildProcess } from '../../src/server/servers/devtunnel-connector';
import { SshConnector } from '../../src/server/servers/ssh-connector';
import { registerRemoteServerRoutes } from '../../src/server/servers/remote-server-routes';
import { RemoteServerStore } from '../../src/server/servers/remote-server-store';
import { createExecutionServer } from '../../src/server';

class FakeChild extends EventEmitter implements DevTunnelChildProcess {
    killed = false;
    kill(): boolean {
        this.killed = true;
        return true;
    }
    override once(event: 'exit' | 'error', listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }
}

interface StartedServer {
    server: http.Server;
    baseUrl: string;
}

interface MockCocRequest {
    method: string;
    url: string;
    body: any;
}

function start(server: http.Server): Promise<StartedServer> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
        });
    });
}

function stop(server: http.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function request(baseUrl: string, method: string, route: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${route}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

function readBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve(text ? JSON.parse(text) : undefined);
        });
        req.on('error', reject);
    });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

describe('remote server routes', () => {
    let dataDir: string;
    let apiServer: http.Server | undefined;
    let remoteServer: http.Server | undefined;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-server-routes-'));
    });

    afterEach(async () => {
        if (apiServer?.listening) await stop(apiServer);
        if (remoteServer?.listening) await stop(remoteServer);
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    async function startApi(connector: DevTunnelConnector, sshConnector?: SshConnector): Promise<string> {
        const routes: Route[] = [];
        let localBaseUrl: string | undefined;
        registerRemoteServerRoutes(routes, {
            store: new RemoteServerStore(dataDir),
            connector,
            sshConnector,
            getLocalBaseUrl: () => localBaseUrl,
            requestTimeoutMs: 2_000,
        });
        apiServer = http.createServer(createRouter({ routes, spaHtml: '' }));
        localBaseUrl = (await start(apiServer)).baseUrl;
        return localBaseUrl;
    }

    async function startRemoteCoc(): Promise<string> {
        remoteServer = http.createServer((req, res) => {
            if (req.url === '/api/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', uptime: 12, processCount: 3 }));
                return;
            }
            if (req.url === '/api/admin/version') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ version: '1.2.3', commit: 'abc123' }));
                return;
            }
            if (req.url === '/api/admin/config') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ hostname: 'remote-box' }));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        return (await start(remoteServer)).baseUrl;
    }

    async function startMockCoc(options: {
        label: string;
        exportWorkspaceId?: string;
        exportResponse?: unknown;
        exportStatus?: number;
        applyWorkspaceId?: string;
        applyResponse?: unknown;
        applyStatus?: number;
        healthStatus?: number;
    }): Promise<{ baseUrl: string; requests: MockCocRequest[]; server: http.Server }> {
        const requests: MockCocRequest[] = [];
        const server = http.createServer(async (req, res) => {
            if (req.url === '/api/health') {
                send(res, options.healthStatus ?? 200, { status: 'ok', uptime: 1, processCount: 1 });
                return;
            }
            if (req.url === '/api/admin/version') {
                send(res, 200, { version: '1.0.0', commit: 'abc123' });
                return;
            }
            if (req.url === '/api/admin/config') {
                send(res, 200, { hostname: options.label });
                return;
            }
            const match = req.url?.match(/^\/api\/workspaces\/([^/]+)\/git\/patch\/(export|apply)$/);
            if (req.method === 'POST' && match) {
                const body = await readBody(req);
                requests.push({ method: req.method, url: req.url, body });
                const workspaceId = decodeURIComponent(match[1]);
                const action = match[2];
                if (action === 'export' && workspaceId === options.exportWorkspaceId) {
                    send(res, options.exportStatus ?? 200, options.exportResponse);
                    return;
                }
                if (action === 'apply' && workspaceId === options.applyWorkspaceId) {
                    send(res, options.applyStatus ?? 200, options.applyResponse);
                    return;
                }
            }
            send(res, 404, { error: `Not found: ${req.method} ${req.url}` });
        });
        const started = await start(server);
        return { baseUrl: started.baseUrl, requests, server };
    }

    it('creates, lists, patches, and deletes URL and DevTunnel entries', async () => {
        const portListJson = JSON.stringify({
            ports: [{ portNumber: 4000, protocol: 'http', portUri: 'https://my-remote-coc-4000.usw2.devtunnels.ms' }],
        });
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: portListJson, stderr: '' }),
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });
        const baseUrl = await startApi(connector);

        const urlCreate = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Lab', url: 'http://lab.example.com/' });
        expect(urlCreate.status).toBe(201);
        expect(urlCreate.body).toMatchObject({ kind: 'url', label: 'Lab', url: 'http://lab.example.com', effectiveUrl: 'http://lab.example.com' });

        const tunnelCreate = await request(baseUrl, 'POST', '/api/servers', { kind: 'devtunnel', label: 'VM', tunnelId: 'my-remote-coc' });
        expect(tunnelCreate.status).toBe(201);
        expect(tunnelCreate.body).toMatchObject({
            kind: 'devtunnel',
            tunnelId: 'my-remote-coc',
            effectiveUrl: 'http://127.0.0.1:4000',
            localPort: 4000,
            publicUrl: 'https://my-remote-coc-4000.usw2.devtunnels.ms',
        });

        const list = await request(baseUrl, 'GET', '/api/servers');
        expect(list.status).toBe(200);
        expect(list.body).toHaveLength(2);

        const patched = await request(baseUrl, 'PATCH', `/api/servers/${urlCreate.body.id}`, { label: 'Lab 2' });
        expect(patched.status).toBe(200);
        expect(patched.body.label).toBe('Lab 2');

        const deleted = await request(baseUrl, 'DELETE', `/api/servers/${urlCreate.body.id}`);
        expect(deleted.status).toBe(200);
        expect((await request(baseUrl, 'GET', '/api/servers')).body).toHaveLength(1);
    });

    it('tests URL entries and returns the common health shape without persisting', async () => {
        const remoteBase = await startRemoteCoc();
        const baseUrl = await startApi(new DevTunnelConnector());

        const test = await request(baseUrl, 'POST', '/api/servers/test', { kind: 'url', label: 'Remote', url: remoteBase });
        expect(test.status).toBe(200);
        expect(test.body).toMatchObject({
            serverId: 'test',
            kind: 'url',
            status: 'online',
            effectiveUrl: remoteBase,
            version: '1.2.3',
            commit: 'abc123',
            serverName: 'remote-box',
            uptime: 12,
            processCount: 3,
        });
        expect((await request(baseUrl, 'GET', '/api/servers')).body).toEqual([]);
    });

    it('uses the DevTunnel effective local URL for health', async () => {
        const remoteBase = await startRemoteCoc();
        const port = new URL(remoteBase).port;
        const portListJson = JSON.stringify({
            ports: [{ portNumber: Number(port), protocol: 'http', portUri: `https://my-remote-coc-${port}.usw2.devtunnels.ms` }],
        });
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: portListJson, stderr: '' }),
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });
        const baseUrl = await startApi(connector);

        const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'devtunnel', label: 'VM', tunnelId: 'my-remote-coc' });
        const health = await request(baseUrl, 'GET', `/api/servers/${created.body.id}/health`);

        expect(health.status).toBe(200);
        expect(health.body).toMatchObject({
            kind: 'devtunnel',
            status: 'online',
            effectiveUrl: remoteBase,
            tunnelId: 'my-remote-coc',
            localPort: Number(port),
            publicUrl: `https://my-remote-coc-${port}.usw2.devtunnels.ms`,
        });
    });

    it('surfaces the underlying connector error when the tunnel cannot resolve an endpoint', async () => {
        const connector = new DevTunnelConnector({
            commandRunner: async () => {
                throw Object.assign(new Error('devtunnel not found'), { code: 'ENOENT' });
            },
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });
        const baseUrl = await startApi(connector);

        const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'devtunnel', label: 'VM', tunnelId: 'my-remote-coc' });
        const health = await request(baseUrl, 'GET', `/api/servers/${created.body.id}/health`);

        expect(health.status).toBe(200);
        expect(health.body).toMatchObject({
            kind: 'devtunnel',
            status: 'offline',
            error: 'devtunnel CLI is not installed or not on PATH',
        });
        expect(health.body.error).not.toBe('No effective endpoint is available');
    });

    it('rejects manual connect and disconnect for direct URL entries', async () => {
        const baseUrl = await startApi(new DevTunnelConnector());
        const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Lab', url: 'http://lab.example.com' });

        expect((await request(baseUrl, 'POST', `/api/servers/${created.body.id}/connect`)).status).toBe(400);
        expect((await request(baseUrl, 'POST', `/api/servers/${created.body.id}/disconnect`)).status).toBe(400);
    });

    describe('url-kind runtime reachability', () => {
        it('reports a reachable URL server as online with its configured url as effectiveUrl', async () => {
            const remoteBase = await startRemoteCoc();
            const baseUrl = await startApi(new DevTunnelConnector());

            // Creation probes reachability up front, so the create response already
            // reflects the live status (no connector maintains url-kind state).
            const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Reachable', url: remoteBase });
            expect(created.status).toBe(201);
            expect(created.body).toMatchObject({
                kind: 'url',
                status: 'online',
                effectiveUrl: remoteBase,
            });

            // GET /api/servers (the dashboard's source) must surface the same online
            // status so aggregateRemoteWorkspaces fetches this remote's clones.
            const list = await request(baseUrl, 'GET', '/api/servers');
            expect(list.status).toBe(200);
            expect(list.body).toHaveLength(1);
            expect(list.body[0]).toMatchObject({
                kind: 'url',
                status: 'online',
                effectiveUrl: remoteBase,
            });
        });

        it('reports an unreachable URL server as offline (never online)', async () => {
            // Start then immediately stop a server to obtain a guaranteed-refused
            // endpoint (fast ECONNREFUSED rather than a slow timeout).
            const deadServer = http.createServer(() => {});
            const dead = await start(deadServer);
            await stop(deadServer);

            const baseUrl = await startApi(new DevTunnelConnector());
            const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Unreachable', url: dead.baseUrl });
            expect(created.status).toBe(201);
            expect(created.body.kind).toBe('url');
            expect(created.body.status).toBe('offline');
            expect(created.body.status).not.toBe('online');
            expect(created.body.effectiveUrl).toBe(dead.baseUrl);

            const list = await request(baseUrl, 'GET', '/api/servers');
            expect(list.body[0].status).toBe('offline');
            expect(list.body[0].status).not.toBe('online');
        });

        it('reflects a /health probe result in the subsequent /api/servers listing', async () => {
            const remoteBase = await startRemoteCoc();
            const baseUrl = await startApi(new DevTunnelConnector());
            const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Reachable', url: remoteBase });

            // An explicit health check refreshes the cached reachability the list reads.
            const health = await request(baseUrl, 'GET', `/api/servers/${created.body.id}/health`);
            expect(health.body).toMatchObject({ kind: 'url', status: 'online', effectiveUrl: remoteBase });

            const list = await request(baseUrl, 'GET', '/api/servers');
            expect(list.body[0]).toMatchObject({ status: 'online', effectiveUrl: remoteBase });
        });
    });

    describe('cherry-pick transfer orchestration', () => {
        let extraServers: http.Server[] = [];

        afterEach(async () => {
            await Promise.all(extraServers.map(server => server.listening ? stop(server) : Promise.resolve()));
            extraServers = [];
        });

        const patchExport = {
            sourceWorkspace: { id: 'source-ws', name: 'Source Repo' },
            sourceCommit: {
                hash: 'abc123def456',
                subject: 'Move feature',
                author: { name: 'Patch Author', email: 'patch-author@example.test', date: '2026-06-04T00:00:00+00:00' },
            },
            normalizedSourceRemoteUrl: 'example.test/org/repo',
            patch: { format: 'format-patch', body: 'From abc123def456 Mon Sep 17 00:00:00 2001\n' },
        };
        const patchApply = {
            success: true,
            targetWorkspace: { id: 'target-ws', name: 'Target Repo' },
            targetBranch: 'main',
            targetHead: 'def456abc789',
            newCommitHash: 'def456abc789',
            stashed: false,
            operation: {
                id: 'op-1',
                workspaceId: 'target-ws',
                op: 'cherry-pick-transfer',
                status: 'success',
                startedAt: '2026-06-04T00:00:01.000Z',
            },
        };

        it('exports from one remote server and applies on another remote server', async () => {
            const source = await startMockCoc({ label: 'source-coc', exportWorkspaceId: 'source-ws', exportResponse: patchExport });
            const target = await startMockCoc({ label: 'target-coc', applyWorkspaceId: 'target-ws', applyResponse: patchApply });
            extraServers.push(source.server, target.server);
            const baseUrl = await startApi(new DevTunnelConnector());
            const sourceServer = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Source Server', url: source.baseUrl });
            const targetServer = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Target Server', url: target.baseUrl });

            const result = await request(baseUrl, 'POST', '/api/servers/cherry-pick-transfer', {
                source: { serverId: sourceServer.body.id, workspaceId: 'source-ws', commitHash: 'abc123def456' },
                target: { serverId: targetServer.body.id, workspaceId: 'target-ws', stashAndContinue: true },
            });

            expect(result.status).toBe(200);
            expect(result.body).toMatchObject({
                success: true,
                source: {
                    server: { id: sourceServer.body.id, label: 'Source Server' },
                    workspace: { id: 'source-ws', name: 'Source Repo' },
                    commit: { hash: 'abc123def456', subject: 'Move feature' },
                    normalizedRemoteUrl: 'example.test/org/repo',
                },
                target: {
                    server: { id: targetServer.body.id, label: 'Target Server' },
                    workspace: { id: 'target-ws', name: 'Target Repo' },
                    branch: 'main',
                    head: 'def456abc789',
                },
            });
            expect(source.requests).toEqual([
                { method: 'POST', url: '/api/workspaces/source-ws/git/patch/export', body: { hash: 'abc123def456' } },
            ]);
            expect(target.requests[0]).toMatchObject({
                method: 'POST',
                url: '/api/workspaces/target-ws/git/patch/apply',
                body: {
                    patch: patchExport.patch,
                    stashAndContinue: true,
                    sourceServer: { id: sourceServer.body.id, label: 'Source Server' },
                    sourceWorkspace: patchExport.sourceWorkspace,
                    sourceCommit: patchExport.sourceCommit,
                    normalizedSourceRemoteUrl: 'example.test/org/repo',
                },
            });
        });

        it('supports local-to-remote and remote-to-local orchestration through the initiating server', async () => {
            const remote = await startMockCoc({
                label: 'remote-coc',
                exportWorkspaceId: 'remote-source',
                exportResponse: { ...patchExport, sourceWorkspace: { id: 'remote-source', name: 'Duplicate Repo' } },
                applyWorkspaceId: 'remote-target',
                applyResponse: { ...patchApply, targetWorkspace: { id: 'remote-target', name: 'Duplicate Repo' } },
            });
            extraServers.push(remote.server);

            const routes: Route[] = [];
            let localBaseUrl: string | undefined;
            routes.push({
                method: 'POST',
                pattern: '/api/workspaces/local-source/git/patch/export',
                handler: async (req, res) => {
                    await readBody(req);
                    send(res, 200, { ...patchExport, sourceWorkspace: { id: 'local-source', name: 'Duplicate Repo' } });
                },
            });
            routes.push({
                method: 'POST',
                pattern: '/api/workspaces/local-target/git/patch/apply',
                handler: async (req, res) => {
                    const body = await readBody(req);
                    send(res, 200, {
                        ...patchApply,
                        targetWorkspace: { id: 'local-target', name: 'Duplicate Repo' },
                        operation: { ...patchApply.operation, metadata: body },
                    });
                },
            });
            registerRemoteServerRoutes(routes, {
                store: new RemoteServerStore(dataDir),
                connector: new DevTunnelConnector(),
                getLocalBaseUrl: () => localBaseUrl,
                requestTimeoutMs: 2_000,
            });
            apiServer = http.createServer(createRouter({ routes, spaHtml: '' }));
            localBaseUrl = (await start(apiServer)).baseUrl;

            const remoteServer = await request(localBaseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Remote Server', url: remote.baseUrl });
            const localToRemote = await request(localBaseUrl, 'POST', '/api/servers/cherry-pick-transfer', {
                source: { workspaceId: 'local-source', commitHash: 'abc123def456' },
                target: { serverId: remoteServer.body.id, workspaceId: 'remote-target' },
            });
            const remoteToLocal = await request(localBaseUrl, 'POST', '/api/servers/cherry-pick-transfer', {
                source: { serverId: remoteServer.body.id, workspaceId: 'remote-source', commitHash: 'abc123def456' },
                target: { workspaceId: 'local-target' },
            });

            expect(localToRemote.status).toBe(200);
            expect(localToRemote.body.source.server).toEqual({ id: 'local', label: 'Current CoC' });
            expect(localToRemote.body.target.server).toEqual({ id: remoteServer.body.id, label: 'Remote Server' });
            expect(remoteToLocal.status).toBe(200);
            expect(remoteToLocal.body.source.server).toEqual({ id: remoteServer.body.id, label: 'Remote Server' });
            expect(remoteToLocal.body.target.server).toEqual({ id: 'local', label: 'Current CoC' });
        });

        it('returns a clear 503 when a registered remote server is offline', async () => {
            const offline = await startMockCoc({
                label: 'offline-coc',
                healthStatus: 500,
                exportWorkspaceId: 'source-ws',
                exportResponse: patchExport,
            });
            extraServers.push(offline.server);
            const baseUrl = await startApi(new DevTunnelConnector());
            const sourceServer = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Offline Server', url: offline.baseUrl });

            const result = await request(baseUrl, 'POST', '/api/servers/cherry-pick-transfer', {
                source: { serverId: sourceServer.body.id, workspaceId: 'source-ws', commitHash: 'abc123def456' },
                target: { workspaceId: 'local-target' },
            });

            expect(result.status).toBe(503);
            expect(result.body).toMatchObject({
                server: { id: sourceServer.body.id, label: 'Offline Server' },
                status: 'offline',
            });
            expect(result.body.error).toContain('Offline Server');
        });

        it('propagates remote apply conflicts with the existing 409 conflict shape', async () => {
            const source = await startMockCoc({ label: 'source-coc', exportWorkspaceId: 'source-ws', exportResponse: patchExport });
            const target = await startMockCoc({
                label: 'target-coc',
                applyWorkspaceId: 'target-ws',
                applyStatus: 409,
                applyResponse: {
                    error: 'Patch apply stopped with conflicts',
                    conflicts: true,
                    gitState: { operation: 'cherry-pick', gitOperation: 'am', conflictFiles: ['shared.txt'] },
                },
            });
            extraServers.push(source.server, target.server);
            const baseUrl = await startApi(new DevTunnelConnector());
            const sourceServer = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Source Server', url: source.baseUrl });
            const targetServer = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Target Server', url: target.baseUrl });

            const result = await request(baseUrl, 'POST', '/api/servers/cherry-pick-transfer', {
                source: { serverId: sourceServer.body.id, workspaceId: 'source-ws', commitHash: 'abc123def456' },
                target: { serverId: targetServer.body.id, workspaceId: 'target-ws' },
            });

            expect(result.status).toBe(409);
            expect(result.body).toMatchObject({
                error: 'Patch apply stopped with conflicts',
                conflicts: true,
                phase: 'apply',
                server: { id: targetServer.body.id, label: 'Target Server' },
                gitState: { operation: 'cherry-pick', gitOperation: 'am', conflictFiles: ['shared.txt'] },
            });
        });
    });

    describe('restart route', () => {
        let restartServer: http.Server | undefined;

        afterEach(async () => {
            if (restartServer?.listening) await stop(restartServer);
            restartServer = undefined;
        });

        async function startRestartableRemote(options?: { restartStatus?: number }): Promise<{ baseUrl: string; restartCalls: MockCocRequest[] }> {
            const restartCalls: MockCocRequest[] = [];
            restartServer = http.createServer(async (req, res) => {
                if (req.method === 'POST' && req.url === '/api/admin/restart') {
                    restartCalls.push({ method: req.method, url: req.url, body: await readBody(req) });
                    // Remote replies *before* it would exit, mirroring admin-handler.
                    send(res, options?.restartStatus ?? 200, { message: 'Server is restarting...' });
                    return;
                }
                // Health-checker probes so the server can be created as a url-kind remote.
                if (req.url === '/api/health') {
                    send(res, 200, { status: 'ok', uptime: 1, processCount: 1 });
                    return;
                }
                if (req.url === '/api/admin/version') {
                    send(res, 200, { version: '1.0.0', commit: 'abc123' });
                    return;
                }
                if (req.url === '/api/admin/config') {
                    send(res, 200, { hostname: 'remote-box' });
                    return;
                }
                send(res, 404, { error: `Not found: ${req.method} ${req.url}` });
            });
            return { baseUrl: (await start(restartServer)).baseUrl, restartCalls };
        }

        it('proxies a POST to the remote /api/admin/restart and returns 2xx on success', async () => {
            const remote = await startRestartableRemote();
            const baseUrl = await startApi(new DevTunnelConnector());
            const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Remote', url: remote.baseUrl });

            const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/restart`);
            expect(res.status).toBeGreaterThanOrEqual(200);
            expect(res.status).toBeLessThan(300);
            expect(remote.restartCalls).toHaveLength(1);
            expect(remote.restartCalls[0]).toMatchObject({ method: 'POST', url: '/api/admin/restart' });
        });

        it('returns 404 for an unknown server id', async () => {
            const baseUrl = await startApi(new DevTunnelConnector());
            const res = await request(baseUrl, 'POST', '/api/servers/does-not-exist/restart');
            expect(res.status).toBe(404);
        });

        it('returns an error status when the remote responds non-2xx', async () => {
            const remote = await startRestartableRemote({ restartStatus: 500 });
            const baseUrl = await startApi(new DevTunnelConnector());
            const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Remote', url: remote.baseUrl });

            const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/restart`);
            expect(res.status).toBe(502);
            expect(res.body).toHaveProperty('error');
            expect(remote.restartCalls).toHaveLength(1);
        });

        it('returns an error status when the remote is unreachable', async () => {
            // Start then immediately stop a server to obtain a guaranteed-refused endpoint.
            const deadServer = http.createServer(() => {});
            const dead = await start(deadServer);
            await stop(deadServer);
            const baseUrl = await startApi(new DevTunnelConnector());
            const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Dead', url: dead.baseUrl });

            const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/restart`);
            expect(res.status).toBe(502);
            expect(res.body).toHaveProperty('error');
        });
    });

    it('reconnect returns 404 for missing server', async () => {
        const baseUrl = await startApi(new DevTunnelConnector());
        const res = await request(baseUrl, 'POST', '/api/servers/nonexistent/reconnect');
        expect(res.status).toBe(404);
    });

    it('reconnect returns 400 for URL servers', async () => {
        const baseUrl = await startApi(new DevTunnelConnector());
        const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Lab', url: 'http://lab.example.com' });
        const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/reconnect`);
        expect(res.status).toBe(400);
    });

    describe('ssh-kind routes', () => {
        function makeSshConnector() {
            const children: FakeChild[] = [];
            const processStarter = vi.fn(() => {
                const c = new FakeChild();
                children.push(c);
                return c;
            });
            const connector = new SshConnector({
                processStarter,
                healthChecker: async () => true,
                readinessPollMs: 1,
                initialReconnectBackoffMs: 100_000, // prevent auto-reconnect during tests
            });
            return { connector, children, processStarter };
        }

        it('POST /connect calls sshConnector.connect and returns online state', async () => {
            const { connector: sshConnector } = makeSshConnector();
            const connectSpy = vi.spyOn(sshConnector, 'connect');
            const baseUrl = await startApi(new DevTunnelConnector(), sshConnector);

            const created = await request(baseUrl, 'POST', '/api/servers', {
                kind: 'ssh', label: 'My SSH', host: 'ubuntu-arm', localPort: 4000,
            });
            expect(created.status).toBe(201);
            // Creation auto-connects; reset spy to isolate POST /connect behavior
            connectSpy.mockClear();

            const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/connect`);
            expect(res.status).toBe(200);
            expect(connectSpy).toHaveBeenCalledOnce();
            expect(res.body).toMatchObject({ kind: 'ssh', status: 'online', effectiveUrl: 'http://127.0.0.1:4000' });
        });

        it('POST /disconnect calls sshConnector.disconnect and returns idle state', async () => {
            const { connector: sshConnector } = makeSshConnector();
            const disconnectSpy = vi.spyOn(sshConnector, 'disconnect');
            const baseUrl = await startApi(new DevTunnelConnector(), sshConnector);

            const created = await request(baseUrl, 'POST', '/api/servers', {
                kind: 'ssh', label: 'My SSH', host: 'ubuntu-arm', localPort: 4000,
            });
            await request(baseUrl, 'POST', `/api/servers/${created.body.id}/connect`);

            const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/disconnect`);
            expect(res.status).toBe(200);
            expect(disconnectSpy).toHaveBeenCalledWith(created.body.id);
            expect(res.body).toMatchObject({ kind: 'ssh', status: 'idle' });
        });

        it('POST /reconnect (success) calls sshConnector.reconnect and returns online state', async () => {
            const { connector: sshConnector } = makeSshConnector();
            const reconnectSpy = vi.spyOn(sshConnector, 'reconnect');
            const baseUrl = await startApi(new DevTunnelConnector(), sshConnector);

            const created = await request(baseUrl, 'POST', '/api/servers', {
                kind: 'ssh', label: 'My SSH', host: 'ubuntu-arm', localPort: 4000,
            });
            await request(baseUrl, 'POST', `/api/servers/${created.body.id}/connect`);

            const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/reconnect`);
            expect(res.status).toBe(200);
            expect(reconnectSpy).toHaveBeenCalledOnce();
            expect(res.body).toMatchObject({ kind: 'ssh', status: 'online', effectiveUrl: 'http://127.0.0.1:4000' });
        });

        it('POST /reconnect (failure) returns failed state when connector throws', async () => {
            const sshConnector = new SshConnector({
                processStarter: vi.fn(() => new FakeChild()),
                healthChecker: async () => false, // always fail health
                readinessTimeoutMs: 20,
                readinessPollMs: 5,
                initialReconnectBackoffMs: 100_000,
            });
            const baseUrl = await startApi(new DevTunnelConnector(), sshConnector);

            const created = await request(baseUrl, 'POST', '/api/servers', {
                kind: 'ssh', label: 'My SSH', host: 'ubuntu-arm', localPort: 4000,
            });
            const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/reconnect`);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ kind: 'ssh', status: 'failed' });
        });
    });

    it('reconnect returns runtime with online status on success', async () => {
        const portListJson = JSON.stringify({
            ports: [{ portNumber: 4000, protocol: 'http', portUri: 'https://t-4000.usw2.devtunnels.ms' }],
        });
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: portListJson, stderr: '' }),
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });
        const baseUrl = await startApi(connector);

        const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'devtunnel', label: 'VM', tunnelId: 'my-remote-coc' });
        expect(created.body.status).toBe('online');

        const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/reconnect`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            serverId: created.body.id,
            kind: 'devtunnel',
            status: 'online',
            effectiveUrl: 'http://127.0.0.1:4000',
            publicUrl: 'https://t-4000.usw2.devtunnels.ms',
        });
    });

    it('reconnect returns runtime with failed status when connect fails', async () => {
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: '4000 http coc', stderr: '' }),
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });
        const baseUrl = await startApi(connector);

        const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'devtunnel', label: 'VM', tunnelId: 'my-remote-coc' });

        // Now make reconnect fail
        (connector as any).commandRunner = async () => { throw Object.assign(new Error('boom'), { code: 'ENOENT' }); };

        const res = await request(baseUrl, 'POST', `/api/servers/${created.body.id}/reconnect`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'failed' });
    });
});

describe('createExecutionServer remote server lifecycle', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-server-startup-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('autoconnects configured DevTunnel entries and disposes connectors on close', async () => {
        const store = new RemoteServerStore(dataDir);
        store.create({ kind: 'devtunnel', label: 'VM', tunnelId: 'my-remote-coc' });
        const connectSpy = vi.spyOn(DevTunnelConnector.prototype, 'connectConfigured').mockResolvedValue([]);
        const disposeSpy = vi.spyOn(DevTunnelConnector.prototype, 'dispose').mockImplementation(() => {});

        const server = await createExecutionServer({
            port: 0,
            host: '127.0.0.1',
            dataDir,
            queue: { autoStart: false },
            fileConfig: { skills: { autoUpdate: false, defaultSkills: [] } },
        });
        await server.close();

        expect(connectSpy).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ kind: 'devtunnel', tunnelId: 'my-remote-coc' }),
        ]));
        expect(disposeSpy).toHaveBeenCalled();
    });

    it('autoconnects configured SSH entries and disposes SshConnector on close', async () => {
        const store = new RemoteServerStore(dataDir);
        store.create({ kind: 'ssh', label: 'My SSH Box', host: 'ubuntu-arm', localPort: 4000 });
        const connectSpy = vi.spyOn(SshConnector.prototype, 'connectConfigured').mockResolvedValue([]);
        const disposeSpy = vi.spyOn(SshConnector.prototype, 'dispose').mockImplementation(() => {});

        const server = await createExecutionServer({
            port: 0,
            host: '127.0.0.1',
            dataDir,
            queue: { autoStart: false },
            fileConfig: { skills: { autoUpdate: false, defaultSkills: [] } },
        });
        await server.close();

        expect(connectSpy).toHaveBeenCalledWith(expect.arrayContaining([
            expect.objectContaining({ kind: 'ssh', host: 'ubuntu-arm', localPort: 4000 }),
        ]));
        expect(disposeSpy).toHaveBeenCalled();
    });
});
