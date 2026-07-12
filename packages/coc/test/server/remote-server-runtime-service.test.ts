import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevTunnelConnector, type DevTunnelChildProcess } from '../../src/server/servers/devtunnel-connector';
import { RemoteServerActionError, RemoteServerRuntimeService } from '../../src/server/servers/remote-server-runtime-service';
import { RemoteServerStore } from '../../src/server/servers/remote-server-store';
import { SshConnector } from '../../src/server/servers/ssh-connector';

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

async function eventually(assertion: () => void): Promise<void> {
    let lastError: unknown;
    for (let i = 0; i < 40; i += 1) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }
    throw lastError;
}

async function startRemoteCoc(): Promise<StartedServer> {
    const server = http.createServer((req, res) => {
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
    return start(server);
}

describe('RemoteServerRuntimeService', () => {
    let dataDir: string;
    let remoteServer: http.Server | undefined;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-server-runtime-service-'));
    });

    afterEach(async () => {
        if (remoteServer?.listening) await stop(remoteServer);
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    function createService(options?: { sshConnector?: SshConnector; connector?: DevTunnelConnector }): {
        store: RemoteServerStore;
        service: RemoteServerRuntimeService;
        connector: DevTunnelConnector;
    } {
        const store = new RemoteServerStore(dataDir);
        const connector = options?.connector ?? new DevTunnelConnector();
        const service = new RemoteServerRuntimeService({
            store,
            connector,
            sshConnector: options?.sshConnector,
        });
        return { store, service, connector };
    }

    it('serves stale direct-URL runtime state and refreshes reachability in the background', async () => {
        const remote = await startRemoteCoc();
        remoteServer = remote.server;
        const { store, service } = createService();
        const server = store.create({ kind: 'url', label: 'Remote', url: remote.baseUrl });

        expect(service.list()[0]).toMatchObject({
            id: server.id,
            kind: 'url',
            status: 'idle',
            effectiveUrl: remote.baseUrl,
        });

        await eventually(() => {
            expect(service.runtimeById(server.id)).toMatchObject({
                kind: 'url',
                status: 'online',
                effectiveUrl: remote.baseUrl,
            });
        });
        expect(service.list()[0]).toMatchObject({
            kind: 'url',
            status: 'online',
            effectiveUrl: remote.baseUrl,
        });
    });

    it('disconnects a DevTunnel only after the last server using that tunnel is removed', () => {
        const { store, service, connector } = createService();
        const disconnectSpy = vi.spyOn(connector, 'disconnect');
        const first = store.create({ kind: 'devtunnel', label: 'First', tunnelId: 'shared-tunnel' });
        const second = store.create({ kind: 'devtunnel', label: 'Second', tunnelId: 'shared-tunnel' });

        expect(service.remove(first.id)).toBe(true);
        expect(disconnectSpy).not.toHaveBeenCalled();

        expect(service.remove(second.id)).toBe(true);
        expect(disconnectSpy).toHaveBeenCalledWith('shared-tunnel');
    });

    it('disconnects stale SSH runtime before reconnecting when host settings change', async () => {
        const children: FakeChild[] = [];
        const sshConnector = new SshConnector({
            processStarter: () => {
                const child = new FakeChild();
                children.push(child);
                return child;
            },
            healthChecker: async () => true,
            readinessPollMs: 1,
            initialReconnectBackoffMs: 100_000,
        });
        const disconnectSpy = vi.spyOn(sshConnector, 'disconnect');
        const { store, service } = createService({ sshConnector });
        const server = store.create({ kind: 'ssh', label: 'Box', host: 'ubuntu-arm', localPort: 4000 });

        await service.connect(server.id);
        const updated = await service.update(server.id, { localPort: 5000 });

        expect(disconnectSpy).toHaveBeenCalledWith(server.id);
        expect(children[0].killed).toBe(true);
        expect(updated).toMatchObject({
            kind: 'ssh',
            localPort: 5000,
            status: 'online',
            effectiveUrl: 'http://127.0.0.1:5000',
        });
    });

    it('fails restart with a typed 502 when a managed server has no effective endpoint', async () => {
        const { store, service } = createService();
        const server = store.create({ kind: 'devtunnel', label: 'VM', tunnelId: 'missing-endpoint' });

        await expect(service.restart(server.id)).rejects.toMatchObject({
            statusCode: 502,
            message: 'Remote server "VM" has no reachable endpoint to restart',
        } satisfies Partial<RemoteServerActionError>);
    });
});
