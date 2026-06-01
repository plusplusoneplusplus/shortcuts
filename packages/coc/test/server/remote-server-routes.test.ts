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
        registerRemoteServerRoutes(routes, {
            store: new RemoteServerStore(dataDir),
            connector,
            sshConnector,
        });
        apiServer = http.createServer(createRouter({ routes, spaHtml: '' }));
        return (await start(apiServer)).baseUrl;
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

    it('rejects manual connect and disconnect for direct URL entries', async () => {
        const baseUrl = await startApi(new DevTunnelConnector());
        const created = await request(baseUrl, 'POST', '/api/servers', { kind: 'url', label: 'Lab', url: 'http://lab.example.com' });

        expect((await request(baseUrl, 'POST', `/api/servers/${created.body.id}/connect`)).status).toBe(400);
        expect((await request(baseUrl, 'POST', `/api/servers/${created.body.id}/disconnect`)).status).toBe(400);
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
