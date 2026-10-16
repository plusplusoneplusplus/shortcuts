import { describe, expect, it, vi } from 'vitest';
import type { DashboardDiscoveryRuntime, DashboardVisibleWorkspace } from '@plusplusoneplusplus/coc-client';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { createListWorkspacesTool } from '../../../src/server/llm-tools/list-workspaces-tool';
import { buildSendToConversationAddon } from '../../../src/server/executors/prompt-builder';
import { DashboardDiscoveryRelay } from '../../../src/server/streaming/dashboard-discovery-relay';
import type { WorkspaceDirectory } from '../../../src/server/servers/workspace-directory';

function row(overrides: Partial<DashboardVisibleWorkspace> = {}): DashboardVisibleWorkspace {
    return {
        serverIdentity: 'installation-a', serverLabel: 'Build server', serverKind: 'ssh',
        workspaceId: 'shared-workspace', workspaceLabel: 'Backend', type: 'repo', online: true,
        ...overrides,
    };
}

function setup(rows: DashboardVisibleWorkspace[] = [row()]) {
    const directory: WorkspaceDirectory = {
        list: vi.fn().mockResolvedValue({ entries: [], servers: [] }),
        listRemoteChats: vi.fn(),
        startRemoteChat: vi.fn(),
    };
    const discovery = { listWorkspaces: vi.fn().mockResolvedValue(rows) };
    const { tool } = createListWorkspacesTool({
        directory, workspaceId: 'sentinel-owner', getDashboardDiscovery: () => discovery,
    });
    return { directory, discovery, tool };
}

describe('list_workspaces dashboard source', () => {
    it('discovers unregistered SSH and offline DevTunnel targets without creating registry aliases', async () => {
        const rows = [row(), row({
            serverIdentity: 'installation-b', serverKind: 'devtunnel', serverLabel: 'Tunnel',
            online: false, type: 'group',
        })];
        const { tool, discovery, directory } = setup(rows);
        const result = await tool.handler({ source: 'dashboard' }, {} as never);
        expect(discovery.listWorkspaces).toHaveBeenCalledWith('sentinel-owner');
        expect(result).toEqual({
            source: 'dashboard',
            workspaces: rows.map(value => ({
                ...value, target: { serverIdentity: value.serverIdentity, workspaceId: value.workspaceId },
            })),
            total: 2, truncated: false,
        });
        expect(directory.list).not.toHaveBeenCalled();
        expect(directory.startRemoteChat).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain('remote:');
    });

    it('keeps equal labels and workspace IDs on different servers distinct', async () => {
        const { tool } = setup([row(), row({ serverIdentity: 'installation-b' })]);
        const result = await tool.handler({ source: 'dashboard', query: 'BACK' }, {} as never);
        expect(result).toMatchObject({
            total: 2, workspaces: [
                { target: { serverIdentity: 'installation-a', workspaceId: 'shared-workspace' } },
                { target: { serverIdentity: 'installation-b', workspaceId: 'shared-workspace' } },
            ],
        });
        expect(tool.description).toContain('Ask the user');
    });

    it('preserves unknown ownership without manufacturing a target from a local kind or label', async () => {
        const { tool } = setup([row({ serverIdentity: undefined, serverKind: 'local', online: false })]);
        const result = await tool.handler({ source: 'dashboard' }, {} as never);
        expect(result).toMatchObject({ total: 1, workspaces: [{ serverKind: 'local', online: false }] });
        if (!('workspaces' in result)) throw new Error('Expected dashboard result');
        expect(result.workspaces[0]).not.toHaveProperty('target');
    });

    it('filters labels before applying the result cap', async () => {
        const { tool } = setup([
            ...Array.from({ length: 55 }, (_, i) => row({ workspaceId: `ws-${i}` })),
            row({ workspaceId: 'last', serverLabel: 'Unique host', workspaceLabel: 'Special' }),
        ]);
        const all = await tool.handler({ source: 'dashboard' }, {} as never);
        expect(all).toMatchObject({
            total: 56, truncated: true,
        });
        if (!('workspaces' in all)) throw new Error('Expected dashboard result');
        expect(all.workspaces).toHaveLength(50);
        const result = await tool.handler({ source: 'dashboard', query: 'UNIQUE' }, {} as never);
        expect(result).toMatchObject({ total: 1, truncated: false, workspaces: [{ workspaceId: 'last' }] });
        if (!('workspaces' in result)) throw new Error('Expected dashboard result');
        expect(result.workspaces).toHaveLength(1);
    });

    it('does not consult a dashboard for the default or explicit registered source', async () => {
        const { tool, discovery, directory } = setup();
        for (const args of [{}, { source: 'registered' as const }]) {
            expect(await tool.handler(args, {} as never)).toEqual({
                workspaces: [], servers: [], total: 0, truncated: false,
            });
        }
        expect(discovery.listWorkspaces).not.toHaveBeenCalled();
        expect(directory.list).toHaveBeenCalledTimes(2);
    });

    it('rejects invalid source and query values before any discovery', async () => {
        const { tool, discovery, directory } = setup();
        for (const args of [{ source: 'other' }, { source: 'dashboard', query: 42 }]) {
            expect(await tool.handler(args as never, {} as never)).toHaveProperty('error');
        }
        expect(directory.list).not.toHaveBeenCalled();
        expect(discovery.listWorkspaces).not.toHaveBeenCalled();
    });

    it('fails explicitly for unavailable infrastructure or missing invoking scope', async () => {
        const { directory, discovery } = setup();
        for (const options of [
            { directory, workspaceId: 'owner' },
            { directory, getDashboardDiscovery: () => discovery },
        ]) {
            const { tool } = createListWorkspacesTool(options);
            expect(await tool.handler({ source: 'dashboard' }, {} as never)).toHaveProperty('error');
        }
        expect(directory.list).not.toHaveBeenCalled();
        expect(discovery.listWorkspaces).not.toHaveBeenCalled();
    });

    it('discards failures without leaking transport details or falling back to local data', async () => {
        const { tool, directory, discovery } = setup();
        discovery.listWorkspaces.mockRejectedValue(new Error('private endpoint and transport details'));
        const result = await tool.handler({ source: 'dashboard' }, {} as never);
        expect(result).toEqual({
            error: 'Dashboard workspace discovery unavailable. No registered or local fallback was attempted.',
        });
        expect(directory.list).not.toHaveBeenCalled();
    });

    it('resolves the relay after addon construction and pins the invoking owner through real relay requests', async () => {
        let discovery: DashboardDiscoveryRuntime | undefined;
        const relay = new DashboardDiscoveryRelay();
        const enqueue = vi.fn();
        const store = { getWorkspaces: vi.fn() } as unknown as ProcessStore;
        const addon = buildSendToConversationAddon(store, 'sentinel-owner', enqueue, undefined, undefined, {
            getDashboardDiscovery: () => discovery,
        });
        const tool = addon.tools.find(tool => tool.name === 'list_workspaces')!;
        expect(await tool.handler({ source: 'dashboard' }, {} as never)).toHaveProperty('error');
        discovery = relay;
        const send = vi.fn((data: string) => {
            const event = JSON.parse(data);
            if (event.type === 'dashboard-workspaces-request') {
                expect(event.request.workspaceId).toBe('sentinel-owner');
                relay.reply(client, { id: event.request.id, ok: true, workspaces: [row()] });
            }
        });
        const client = { id: 'owner-dashboard', send };
        const foreign = { id: 'foreign-dashboard', send: vi.fn() };
        relay.advertise(client, 'sentinel-owner', 'revision-1', true);
        relay.advertise(foreign, 'other-owner', 'revision-1', true);
        expect(await tool.handler({ source: 'dashboard', workspaceId: 'other-owner' }, {} as never)).toMatchObject({
            source: 'dashboard', total: 1,
        });
        expect(foreign.send).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        relay.disconnect(client);
        expect(await tool.handler({ source: 'dashboard' }, {} as never)).toHaveProperty('error');
        expect(store.getWorkspaces).not.toHaveBeenCalled();
        relay.advertise(client, 'sentinel-owner', 'revision-2', true);
        expect(await tool.handler({ source: 'dashboard' }, {} as never)).toMatchObject({ total: 1 });
        relay.disconnect(client);
        relay.disconnect(foreign);
    });
});
