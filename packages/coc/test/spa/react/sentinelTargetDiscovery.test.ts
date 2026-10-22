/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverSentinelTargets, validateSentinelTargetSend } from '../../../src/server/spa/client/react/features/chat/sentinelTargetDiscovery';
import { getDashboardTopology, publishDashboardTopology } from '../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { targetToken } from '../../../src/server/shared/sentinel-target-reference';
const mocks = vi.hoisted(() => ({ clients: new Map<string | undefined, any>() }));
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({ getCocClientFor: (url?: string) => mocks.clients.get(url) }));
const remote = (offline = false): any => ({ id: 'same-id', name: 'shortcuts', baseUrl: 'https://arm', remote: {
    serverId: 'routing-alias', serverIdentity: 'arm-durable', serverLabel: 'ubuntu-arm', serverKind: 'url', baseUrl: 'https://arm', connection: offline ? 'offline' : 'online', offline,
} });
function client(identity: string) {
    return { options: { baseUrl: identity === 'arm-durable' ? 'https://arm' : '' }, health: { get: vi.fn(async () => ({ serverIdentity: identity })) }, request: vi.fn(async (path: string) => {
        if (path === '/workspaces') return { workspaces: [{ id: 'same-id', name: 'shortcuts' }] };
        if (path === '/config/runtime') return { features: { sentinelTargetAutocompleteEnabled: true } };
        return { id: 'group-test', name: 'Tools', members: [{ workspaceId: 'same-id' }] };
    }) };
}
const signal = () => new AbortController().signal;
beforeEach(() => {
    mocks.clients.clear();
    mocks.clients.set(undefined, client('local-durable'));
    mocks.clients.set('https://arm', client('arm-durable'));
    publishDashboardTopology('same-id', [{ id: 'same-id', name: 'shortcuts' } as any, remote(), { id: 'group-test', name: 'Tools', virtual: true } as any], 'local-durable');
});
describe('owner-verified real inventory', () => {
    it('keeps duplicate names, exact durable identities, separate kinds and group counts', async () => {
        const results = await discoverSentinelTargets(getDashboardTopology(), signal());
        const repos = results.filter(r => r.name === 'shortcuts');
        expect(repos.map(r => r.owner).sort()).toEqual(['Local', 'ubuntu-arm']);
        expect(repos.map(r => r.target.serverIdentity).sort()).toEqual(['arm-durable', 'local-durable']);
        expect(results.find(r => r.target.kind === 'group')).toMatchObject({ members: 1, online: true });
        expect(results.filter(r => r.target.kind === 'server').every(r => !('workspaceId' in r.target))).toBe(true);
        expect(JSON.stringify(results)).not.toContain('routing-alias');
    });
    it('retains offline rows without making remote requests or selecting local duplicates', async () => {
        publishDashboardTopology('same-id', [remote(true)], 'local-durable');
        const rows = await discoverSentinelTargets(getDashboardTopology(), signal());
        expect(rows.filter(r => r.target.serverIdentity === 'arm-durable').every(r => !r.online)).toBe(true);
        expect(mocks.clients.get('https://arm').health.get).not.toHaveBeenCalled();
    });
    it('makes discovery errors retryable and rejects a replaced server identity', async () => {
        mocks.clients.get('https://arm').health.get.mockResolvedValue({ serverIdentity: 'replacement' });
        const rows = await discoverSentinelTargets(getDashboardTopology(), signal());
        expect(rows.filter(r => r.target.serverIdentity === 'arm-durable').every(r => !r.online && r.error)).toBe(true);
        mocks.clients.get('https://arm').health.get.mockResolvedValue({ serverIdentity: 'arm-durable' });
        expect((await discoverSentinelTargets(getDashboardTopology(), signal())).find(r => r.target.serverIdentity === 'arm-durable')?.online).toBe(true);
    });
    it('rejects stale reads after topology or ownership changes even if transport ignores abort', async () => {
        let release!: (value: any) => void;
        mocks.clients.get('https://arm').health.get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const pending = discoverSentinelTargets(getDashboardTopology(), signal());
        publishDashboardTopology('new-owner', [], 'new-identity');
        release({ serverIdentity: 'arm-durable' });
        await expect(pending).rejects.toThrow('unavailable');
    });
    it('validates the owning server flag and never silently substitutes local same-name targets', async () => {
        const token = targetToken({ kind: 'workspace', serverIdentity: 'arm-durable', workspaceId: 'same-id' }, '#ubuntu-arm / shortcuts');
        const owner = mocks.clients.get('https://arm');
        await validateSentinelTargetSend(token, owner, signal());
        owner.request.mockImplementation(async (path: string) => path === '/config/runtime' ? { features: {} } : { workspaces: [] });
        await expect(validateSentinelTargetSend(token, owner, signal())).rejects.toThrow('disabled');
        owner.request.mockImplementation(async (path: string) => path === '/config/runtime' ? { features: { sentinelTargetAutocompleteEnabled: true } } : { workspaces: [] });
        await expect(validateSentinelTargetSend(token, owner, signal())).rejects.toThrow('unavailable');
    });
    it('discovers server-only machines even when they own no visible workspaces', async () => {
        publishDashboardTopology('same-id', [], 'local-durable', [{ serverId: 'alias', serverIdentity: 'arm-durable', serverLabel: 'Empty host', baseUrl: 'https://arm', online: true, workspaces: [], groupWorkspaces: [], gitInfo: {}, workflows: {} }]);
        const rows = await discoverSentinelTargets(getDashboardTopology(), signal());
        expect(rows).toHaveLength(2);
        expect(rows.every(row => row.target.kind === 'server' && row.online)).toBe(true);
    });
    it('uses a remote group composer owner policy independently of its referenced local repo', async () => {
        publishDashboardTopology('remote:routing-alias:group-test', [{ id: 'same-id', name: 'shortcuts' } as any,
            { ...remote(), id: 'group-test', name: 'Tools', virtual: true }], 'local-durable');
        mocks.clients.get(undefined).request.mockImplementation(async () => ({ workspaces: [{ id: 'same-id', name: 'shortcuts' }], features: {} }));
        const token = targetToken({ kind: 'workspace', serverIdentity: 'local-durable', workspaceId: 'same-id' }, '#Local / shortcuts');
        await validateSentinelTargetSend(token, mocks.clients.get('https://arm'), signal(), 'remote:routing-alias:group-test');
        expect(mocks.clients.get('https://arm').request).toHaveBeenCalledWith('/config/runtime', expect.anything());
        expect(mocks.clients.get(undefined).request).not.toHaveBeenCalledWith('/config/runtime', expect.anything());
    });
    it('does no discovery for ordinary typing', async () => {
        await validateSentinelTargetSend('Normal draft', mocks.clients.get(undefined), signal());
        expect(mocks.clients.get(undefined).request).not.toHaveBeenCalled();
    });
});
