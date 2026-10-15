/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { publishDashboardTopology, getDashboardTopology } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { createDashboardDiscoverySocketRelay } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/socket-relay';
import { tagRemoteWorkspaces } from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';

const local = (id = 'same', name = id, virtual = false) => ({ id, name, virtual } as WorkspaceInfo);
const remote = (alias: string, kind: 'ssh' | 'devtunnel' = 'ssh', identity: string | undefined = alias, offline = false, port = 5000) =>
    tagRemoteWorkspaces({ id: alias, label: `${alias} server`, kind, serverIdentity: identity },
        `http://localhost:${port}`, [local('same'), local('group-g', 'Group', true)], offline);
const disposers: (() => void)[] = [];
function socket(baseUrl?: string) {
    const send = vi.fn();
    const relay = createDashboardDiscoverySocketRelay({ send }, baseUrl);
    disposers.push(() => relay.dispose());
    relay.onOpen();
    return { send, relay };
}
function read(target: ReturnType<typeof socket>, overrides = {}) {
    const capability = target.send.mock.calls.map(([msg]) => msg).findLast(msg => msg.type === 'dashboard-discovery-capability');
    target.relay.onMessage({ type: 'dashboard-workspaces-request', request: {
        id: 'request', workspaceId: capability?.workspaceId, revision: capability?.revision, ...overrides,
    } });
    return target.send.mock.lastCall![0].reply;
}
afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    publishDashboardTopology(null, []);
    vi.restoreAllMocks();
});

describe('dashboard discovery producer', () => {
    it('reports local, remote and cached groups across both transports without endpoints', () => {
        publishDashboardTopology('same', [local(), ...remote('ssh'), ...remote('tunnel', 'devtunnel', 'tunnel', true)]);
        const target = socket();
        const reply = read(target);
        expect(reply.ok).toBe(true);
        expect(reply.workspaces).toHaveLength(5);
        expect(reply.workspaces).toContainEqual({ serverLabel: 'Local server', serverKind: 'local', workspaceId: 'same', workspaceLabel: 'same', type: 'repo', online: true });
        expect(reply.workspaces).toContainEqual({ serverIdentity: 'tunnel', serverLabel: 'tunnel server', serverKind: 'devtunnel', workspaceId: 'group-g', workspaceLabel: 'Group', type: 'group', online: false });
        expect(reply.workspaces.filter((row: any) => row.workspaceId === 'same')).toHaveLength(3);
        expect(JSON.stringify(reply)).not.toMatch(/localhost|baseUrl|"serverId"|cloneKey/);
    });

    it('advertises only on the exact selected remote owner socket using its raw workspace', () => {
        publishDashboardTopology(buildRemoteCloneKey('ssh', 'same'), [local(), ...remote('ssh'), ...remote('tunnel', 'devtunnel', 'tunnel', false, 6000)]);
        const origin = socket();
        const ssh = socket('http://localhost:5000');
        const tunnel = socket('http://localhost:6000');
        expect(origin.send).toHaveBeenLastCalledWith({ type: 'dashboard-discovery-clear' });
        expect(tunnel.send).toHaveBeenLastCalledWith({ type: 'dashboard-discovery-clear' });
        expect(ssh.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'dashboard-discovery-capability', workspaceId: 'same' }));
        // Dashboard-visible tunnel destination is included even on an SSH owner's socket.
        expect(read(ssh).workspaces).toContainEqual(expect.objectContaining({ serverIdentity: 'tunnel' }));
    });

    it('clears on offline, unknown or ambiguous bare remote selections without local fallback', () => {
        const rows = remote('ssh');
        publishDashboardTopology('same', rows);
        const origin = socket();
        const target = socket('http://localhost:5000');
        expect(origin.send).toHaveBeenLastCalledWith({ type: 'dashboard-discovery-clear' });
        expect(target.send).toHaveBeenLastCalledWith({ type: 'dashboard-discovery-clear' });
        publishDashboardTopology(buildRemoteCloneKey('ssh', 'same'), remote('ssh', 'ssh', 'ssh', true));
        expect(target.send).toHaveBeenLastCalledWith({ type: 'dashboard-discovery-clear' });
        publishDashboardTopology('missing', [local()]);
        expect(origin.send).toHaveBeenLastCalledWith({ type: 'dashboard-discovery-clear' });
    });

    it('keeps unknown cached ownership unknown and coalesces known destination aliases', () => {
        publishDashboardTopology('same', [local(), ...remote('a', 'ssh', 'identity'), ...remote('b', 'devtunnel', 'identity'),
            ...remote('unknown', 'ssh', undefined, true).map(ws => ({ ...ws, remote: { ...ws.remote, serverIdentity: undefined } }))]);
        const reply = read(socket());
        expect(reply.workspaces).toHaveLength(5);
        expect(reply.workspaces.filter((row: any) => row.serverIdentity === 'identity')).toHaveLength(2);
        expect(reply.workspaces.find((row: any) => row.serverLabel === 'unknown server')).not.toHaveProperty('serverIdentity');
    });

    it('prefers an online alias when another alias caches the same installation offline', () => {
        publishDashboardTopology('same', [local(), ...remote('a', 'ssh', 'identity', true),
            ...remote('b', 'devtunnel', 'identity', false, 6000)]);
        const matches = read(socket()).workspaces.filter((row: any) => row.serverIdentity === 'identity');
        expect(matches).toHaveLength(2);
        expect(matches.every((row: any) => row.online && row.serverKind === 'devtunnel')).toBe(true);
    });

    it('changes revision for selection, labels, identity, online state and endpoint changes', () => {
        const revisions = new Set<string>();
        const publish = (selected: string, rows: WorkspaceInfo[]) => {
            publishDashboardTopology(selected, rows);
            revisions.add(getDashboardTopology().revision);
        };
        publish('same', [local(), ...remote('ssh')]);
        const initial = getDashboardTopology().revision;
        publishDashboardTopology('same', [...remote('ssh'), local()]);
        expect(getDashboardTopology().revision).toBe(initial);
        publish('same', [local('same', 'Renamed'), ...remote('ssh')]);
        publish('same', [local(), ...remote('ssh', 'ssh', 'new')]);
        publish('same', [local(), ...remote('ssh', 'ssh', 'new', true)]);
        publish('same', [local(), ...remote('ssh', 'ssh', 'new', false, 7000)]);
        publish(buildRemoteCloneKey('ssh', 'same'), [local(), ...remote('ssh')]);
        expect(revisions.size).toBe(6);
    });

    it('rejects old revisions and foreign workspace requests after topology/scope changes', () => {
        publishDashboardTopology('same', [local()]);
        const target = socket();
        const oldRevision = getDashboardTopology().revision;
        publishDashboardTopology('same', [local('same', 'New')]);
        expect(read(target, { revision: oldRevision })).toEqual({ id: 'request', ok: false });
        expect(read(target, { workspaceId: 'foreign' })).toEqual({ id: 'request', ok: false });
        expect(read(target).ok).toBe(true);
        publishDashboardTopology('other', [local(), local('other')]);
        expect(read(target, { workspaceId: 'same' }).ok).toBe(false);
    });

    it('re-advertises focus/reconnect and withdraws on disposal without late sends', () => {
        publishDashboardTopology('same', [local()]);
        const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
        const target = socket();
        const revision = getDashboardTopology().revision;
        focused.mockReturnValue(false);
        window.dispatchEvent(new Event('blur'));
        expect(target.send).toHaveBeenLastCalledWith(expect.objectContaining({ focused: false, revision }));
        target.relay.onClose();
        target.send.mockClear();
        publishDashboardTopology('same', [local('same', 'Changed')]);
        window.dispatchEvent(new Event('focus'));
        expect(target.send).not.toHaveBeenCalled();
        target.relay.onOpen();
        expect(read(target).ok).toBe(true);
        target.relay.dispose();
        expect(target.send).toHaveBeenLastCalledWith({ type: 'dashboard-discovery-clear' });
        target.send.mockClear();
        publishDashboardTopology(null, []);
        window.dispatchEvent(new Event('focus'));
        target.relay.onOpen();
        expect(target.relay.onMessage({ type: 'dashboard-discovery-cancel', id: 'request' })).toBe(true);
        expect(target.relay.onMessage({ type: 'process-updated' })).toBe(false);
        expect(target.send).not.toHaveBeenCalled();
    });

    it('advertises virtual local owners while excluding non-repo virtual rows from results', () => {
        publishDashboardTopology('my-work', [local('my-work', 'My work', true), local(), local('group-g', 'Group', true)]);
        const target = socket();
        expect(read(target).workspaces.map((row: any) => row.workspaceId).sort()).toEqual(['group-g', 'same']);
    });
});
