import { describe, expect, it, vi } from 'vitest';
import type { DashboardChatSearchResult, DashboardDiscoveryRuntime } from '@plusplusoneplusplus/coc-client';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { createSearchConversationsTool } from '../../../src/server/llm-tools/search-conversations-tool';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { DashboardDiscoveryRelay } from '../../../src/server/streaming/dashboard-discovery-relay';

const target = { serverIdentity: 'installation-a', workspaceId: 'shared-workspace' };
const args = { source: 'dashboard' as const, target, title: ' release ' };
function result(overrides: Partial<DashboardChatSearchResult> = {}): DashboardChatSearchResult {
    return {
        target, serverLabel: 'Build server', workspaceLabel: 'Backend', serverKind: 'ssh',
        verification: 'verified', total: 1, conversations: [{ processId: 'same-process', title: 'Release plan' }],
        ...overrides,
    };
}
function setup() {
    const store = {
        getWorkspaces: vi.fn(), getProcessSummaries: vi.fn(), searchConversations: vi.fn(),
        getConversationTurns: vi.fn(), getProcess: vi.fn(),
    };
    const directory = { list: vi.fn(), getRemoteChatSummaries: vi.fn() };
    const discovery = { listWorkspaces: vi.fn(), searchChats: vi.fn().mockResolvedValue(result()) };
    const { tool } = createSearchConversationsTool({
        store: store as unknown as ProcessStore, workspaceId: 'sentinel-owner', currentProcessId: 'same-process',
        directory: directory as never, getDashboardDiscovery: () => discovery,
    });
    return { store, directory, discovery, tool };
}

describe('search_conversations dashboard title lookup', () => {
    it.each(['ssh', 'devtunnel'] as const)('returns exact durable identities and labels for unregistered %s chats', async serverKind => {
        const { tool, discovery, directory, store } = setup();
        discovery.searchChats.mockResolvedValue(result({ serverKind }));
        const value = await tool.handler(args, {} as never);
        expect(discovery.searchChats).toHaveBeenCalledWith('sentinel-owner', {
            target, title: 'release', limit: 10, offset: 0,
        }, undefined);
        expect(value).toMatchObject({
            source: 'dashboard', mode: 'title', target, serverLabel: 'Build server', workspaceLabel: 'Backend',
            serverKind, verification: 'verified', total: 1, limit: 10, offset: 0, hasMore: false, ambiguous: false,
            results: [{ processId: 'same-process', title: 'Release plan', serverIdentity: 'installation-a',
                workspaceId: 'shared-workspace', serverLabel: 'Build server', workspaceLabel: 'Backend', verification: 'verified' }],
        });
        for (const read of Object.values(store)) expect(read).not.toHaveBeenCalled();
        for (const read of Object.values(directory)) expect(read).not.toHaveBeenCalled();
        expect(JSON.stringify(value)).not.toContain('remote:');
    });

    it('reports ambiguity from the full count beyond one page and preserves offline verification', async () => {
        const { tool, discovery } = setup();
        discovery.searchChats.mockResolvedValue(result({ verification: 'unverified', total: 3 }));
        expect(await tool.handler({ ...args, limit: 1, offset: 1 }, {} as never)).toMatchObject({
            total: 3, limit: 1, offset: 1, hasMore: true, ambiguous: true, verification: 'unverified',
            results: [{ verification: 'unverified' }], message: expect.stringContaining('Ask the user'),
        });
        discovery.searchChats.mockResolvedValue(result({ total: 3, conversations: [] }));
        expect(await tool.handler({ ...args, offset: 4 }, {} as never)).toMatchObject({
            results: [], total: 3, ambiguous: true, hasMore: false,
        });
        discovery.searchChats.mockResolvedValue(result({ total: 0, conversations: [] }));
        expect(await tool.handler(args, {} as never)).toMatchObject({ total: 0, results: [], ambiguous: false });
    });

    it.each([
        { source: 'other' }, { target: undefined }, { target: {} }, { target: null },
        { target: { serverIdentity: ' ', workspaceId: 'ws' } },
        { target: { serverIdentity: 'a', workspaceId: '' } },
        { target: { ...target, endpoint: 'private' } }, { target: { ...target, serverIdentity: 'a'.repeat(513) } },
        { title: undefined }, { title: '' }, { title: 42 }, { title: 'x'.repeat(513) },
        { query: '' }, { workspaceId: 'foreign-owner' }, { since: 'bad-date' }, { until: '' }, { summarize: false },
        { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: NaN }, { limit: '2' },
        { offset: -1 }, { offset: 0.5 }, { offset: Infinity }, { offset: Number.MAX_SAFE_INTEGER + 1 },
        { source: 'registered' }, { source: undefined },
    ])('rejects unsupported/unknown selectors or filters before any read: %j', async overrides => {
        const { tool, discovery, store, directory } = setup();
        expect(await tool.handler({ ...args, ...overrides } as never, {} as never)).toMatchObject({ code: 'invalid' });
        expect(discovery.searchChats).not.toHaveBeenCalled();
        for (const read of Object.values(store)) expect(read).not.toHaveBeenCalled();
        for (const read of Object.values(directory)) expect(read).not.toHaveBeenCalled();
    });

    it('requires the invoking scope and resolves unavailable/throwing infrastructure without fallback or details', async () => {
        const { store } = setup();
        for (const options of [
            {}, { workspaceId: 'owner' },
            { workspaceId: 'owner', getDashboardDiscovery: () => { throw new Error('private transport'); } },
            { getDashboardDiscovery: () => ({ searchChats: vi.fn() }) as never },
        ]) {
            const { tool } = createSearchConversationsTool({ store: store as unknown as ProcessStore, ...options });
            const value = await tool.handler(args, {} as never);
            expect(value).toMatchObject({ code: 'unavailable' });
            expect(JSON.stringify(value)).not.toContain('private');
        }
        const { tool, discovery, directory } = setup();
        discovery.searchChats.mockRejectedValue(new Error('private ssh://host:1234'));
        expect(await tool.handler(args, {} as never)).toEqual({ error: 'Dashboard title lookup is unavailable.', code: 'unavailable' });
        expect(directory.list).not.toHaveBeenCalled();
    });

    it('uses the late-bound relay through the full chat bundle and isolates owners and identity collisions', async () => {
        let discovery: DashboardDiscoveryRuntime | undefined;
        const relay = new DashboardDiscoveryRelay();
        const { store } = setup();
        const bundle = buildChatToolBundle({
            store: store as unknown as ProcessStore, workspaceId: 'sentinel-owner', processId: 'same-process',
            sendToConversationRuntime: { getDashboardDiscovery: () => discovery },
        });
        const tool = bundle.tools.find(tool => tool.name === 'search_conversations')!;
        expect(await tool.handler(args, {} as never)).toMatchObject({ code: 'unavailable' });
        discovery = relay;
        const events: any[] = [];
        const client = { id: 'selected-owner', send: vi.fn((data: string) => {
            const event = JSON.parse(data);
            events.push(event);
            if (event.type === 'dashboard-chats-request') relay.reply(client, {
                id: event.request.id, ok: true, result: result({ target: event.request.query.target }),
            }, 'chats');
        }) };
        const foreign = { id: 'foreign-owner', send: vi.fn() };
        relay.advertise(client, 'sentinel-owner', 'rev-1', true);
        relay.advertise(foreign, 'shared-workspace', 'rev-1', true);
        for (const serverIdentity of ['installation-a', 'installation-b']) {
            expect(await tool.handler({ ...args, target: { ...target, serverIdentity } }, {} as never)).toMatchObject({
                target: { ...target, serverIdentity }, results: [{ processId: 'same-process', serverIdentity }],
            });
        }
        expect(events.filter(e => e.type === 'dashboard-chats-request')).toHaveLength(2);
        expect(events[0].request.workspaceId).toBe('sentinel-owner');
        expect(foreign.send).not.toHaveBeenCalled();
        relay.disconnect(client);
        expect(await tool.handler(args, {} as never)).toMatchObject({ code: 'unavailable' });
        relay.advertise(client, 'sentinel-owner', 'rev-2', true);
        expect(await tool.handler(args, {} as never)).toMatchObject({ total: 1 });
        relay.disconnect(client);
        relay.disconnect(foreign);
        for (const read of Object.values(store)) expect(read).not.toHaveBeenCalled();
    });

    it('forwards invocation cancellation to the real relay and suppresses late results', async () => {
        const relay = new DashboardDiscoveryRelay();
        const client = { id: 'dashboard', send: vi.fn((_data: string) => {}) };
        relay.advertise(client, 'sentinel-owner', 'rev', true);
        const { store } = setup();
        const { tool } = createSearchConversationsTool({
            store: store as unknown as ProcessStore, workspaceId: 'sentinel-owner', getDashboardDiscovery: () => relay,
        });
        const controller = new AbortController();
        const pending = tool.handler(args, { signal: controller.signal } as never);
        const request = JSON.parse(client.send.mock.calls[0][0] as string).request;
        controller.abort(new Error('cancelled'));
        expect(await pending).toMatchObject({ code: 'unavailable' });
        expect(JSON.parse(client.send.mock.calls[1][0] as string)).toEqual({ type: 'dashboard-discovery-cancel', id: request.id });
        relay.reply(client, { id: request.id, ok: true, result: result() }, 'chats');
        const count = client.send.mock.calls.length;
        expect(await tool.handler(args, { signal: controller.signal } as never)).toMatchObject({ code: 'unavailable' });
        expect(client.send).toHaveBeenCalledTimes(count);
        relay.disconnect(client);
    });
});
