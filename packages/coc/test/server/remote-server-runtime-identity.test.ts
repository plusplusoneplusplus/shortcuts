import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRemoteServerHealth } from '../../src/server/servers/remote-server-health';
import { RemoteServerRuntimeService } from '../../src/server/servers/remote-server-runtime-service';
import { RemoteServerStore } from '../../src/server/servers/remote-server-store';

vi.mock('../../src/server/servers/remote-server-health', () => ({
    checkRemoteServerHealth: vi.fn(), requestRemoteServerRestart: vi.fn(),
}));

const dataDirs: string[] = [];
afterEach(() => {
    for (const dir of dataDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    vi.resetAllMocks();
});

function setup(kind: 'ssh' | 'devtunnel' | 'url') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-identity-'));
    dataDirs.push(dir);
    const store = new RemoteServerStore(dir);
    const server = store.create(kind === 'ssh'
        ? { kind, label: 'Remote', host: 'remote', localPort: 51000 }
        : kind === 'devtunnel' ? { kind, label: 'Remote', tunnelId: 'tunnel' }
        : { kind, label: 'Remote', url: 'http://localhost:51000' });
    const state = { status: 'online', effectiveUrl: 'http://localhost:51000', port: 51000 };
    const connector = { connect: vi.fn(), getState: () => state, disconnect: vi.fn() };
    const service = new RemoteServerRuntimeService({ store, connector: connector as any, sshConnector: connector as any });
    vi.mocked(checkRemoteServerHealth).mockImplementation(async target => ({
        serverId: target.serverId, kind: target.kind, status: 'online',
        effectiveUrl: target.baseUrl, serverIdentity: 'destination-a', lastChecked: 1,
    }));
    return { service, store, server, state, connector };
}

describe('remote runtime destination identity', () => {
    it.each(['ssh', 'devtunnel'] as const)('refreshes %s identity without connecting idle entries', async kind => {
        const { service, server, state, connector } = setup(kind);
        state.status = 'idle';
        service.list();
        expect(checkRemoteServerHealth).not.toHaveBeenCalled();
        expect(connector.connect).not.toHaveBeenCalled();
        state.status = 'online';
        service.list();
        await vi.waitFor(() => expect(service.runtimeById(server.id)?.serverIdentity).toBe('destination-a'));
        expect(service.decorate(server).serverIdentity).toBe('destination-a');
    });

    it.each(['ssh', 'devtunnel'] as const)('revalidates %s identity at a changed forwarded port', async kind => {
        const { service, server, state } = setup(kind);
        await service.healthById(server.id);
        state.effectiveUrl = 'http://localhost:52000';
        expect(service.runtimeById(server.id)?.serverIdentity).toBeUndefined();
        await service.healthById(server.id);
        expect(service.runtimeById(server.id)).toMatchObject({ serverIdentity: 'destination-a', effectiveUrl: state.effectiveUrl });
        vi.mocked(checkRemoteServerHealth).mockResolvedValueOnce({ serverId: server.id, kind,
            status: 'online', effectiveUrl: state.effectiveUrl, serverIdentity: 'destination-b', lastChecked: 2 });
        await service.healthById(server.id);
        expect(service.runtimeById(server.id)?.serverIdentity).toBe('destination-b');
    });

    it.each(['update', 'remove', 'newer-probe'] as const)('discards delayed identity after %s', async action => {
        const { service, server } = setup('url');
        let finish!: (value: any) => void;
        vi.mocked(checkRemoteServerHealth).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = service.healthById(server.id);
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        if (action === 'update') await service.update(server.id, { url: 'http://localhost:52000' });
        else if (action === 'remove') service.remove(server.id);
        else await service.healthById(server.id);
        finish({ serverId: server.id, kind: 'url', status: 'online', effectiveUrl: server.url,
            serverIdentity: 'stale-server', lastChecked: 0 });
        await pending;
        expect(service.runtimeById(server.id)?.serverIdentity).toBe(action === 'remove' ? undefined : 'destination-a');
    });

    it('keeps destination identities separate when registry aliases point to different servers', async () => {
        const { service, store, server } = setup('url');
        const second = store.create({ kind: 'url', label: 'Same label', url: 'http://localhost:52000' });
        vi.mocked(checkRemoteServerHealth).mockImplementation(async target => ({
            serverId: target.serverId, kind: target.kind, status: 'online', effectiveUrl: target.baseUrl,
            serverIdentity: target.serverId === server.id ? 'destination-a' : 'destination-b', lastChecked: 1,
        }));
        await Promise.all([service.healthById(server.id), service.healthById(second.id)]);
        expect(service.runtimeById(server.id)?.serverIdentity).toBe('destination-a');
        expect(service.runtimeById(second.id)?.serverIdentity).toBe('destination-b');
        service.remove(server.id);
        expect(service.runtimeById(second.id)?.serverIdentity).toBe('destination-b');
    });

    it('does not reuse identity when a successful health response omits it', async () => {
        const { service, server } = setup('url');
        await service.healthById(server.id);
        vi.mocked(checkRemoteServerHealth).mockResolvedValueOnce({ serverId: server.id, kind: 'url',
            status: 'online', effectiveUrl: server.url, lastChecked: 2 });
        await service.healthById(server.id);
        expect(service.runtimeById(server.id)?.serverIdentity).toBeUndefined();
    });
});
