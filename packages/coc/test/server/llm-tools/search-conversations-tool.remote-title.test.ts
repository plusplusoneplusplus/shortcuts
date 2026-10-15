import { describe, expect, it, vi } from 'vitest';
import type { ProcessIndexEntry, ProcessStore } from '@plusplusoneplusplus/forge';
import { createCache } from '../../../src/server/cache';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { createSearchConversationsTool } from '../../../src/server/llm-tools/search-conversations-tool';
import { buildRemoteCloneKey, createWorkspaceDirectory, type WorkspaceDirectoryEntry } from '../../../src/server/servers/workspace-directory';

const invocation = { sessionId: 'session', toolCallId: 'call', toolName: 'search_conversations', arguments: {} };
const entry = (id: string, extra: Partial<ProcessIndexEntry> = {}): ProcessIndexEntry => ({
    id, workspaceId: 'shared-workspace', type: 'chat', status: 'completed',
    startTime: '2026-10-01T00:00:00Z', promptPreview: 'Prompt', title: 'Release plan', ...extra,
});

function setup(kind = 'ssh', entries = [entry('current')]) {
    const selected = buildRemoteCloneKey('remote-server', 'shared-workspace');
    const store = {
        getWorkspaces: vi.fn().mockResolvedValue([{ id: 'shared-workspace', name: 'Local workspace' }]),
        getProcessSummaries: vi.fn(), getProcess: vi.fn(), searchConversations: vi.fn(),
    } as unknown as ProcessStore;
    const server = { id: 'remote-server', label: 'Build machine', kind, effectiveUrl: 'http://localhost:51000' };
    const servers = [server];
    const fetchImpl = vi.fn(async (url: string | URL) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/api/workspaces') return Response.json({ workspaces: [{ id: 'shared-workspace', name: 'Remote project' }] });
        if (parsed.pathname === '/api/processes/summaries') {
            const offset = Number(parsed.searchParams.get('offset'));
            const limit = Number(parsed.searchParams.get('limit'));
            return Response.json({ summaries: entries.slice(offset, offset + limit), total: entries.length });
        }
        throw new Error('Unexpected endpoint');
    });
    const directory = createWorkspaceDirectory({
        store, remoteServers: { list: () => servers as any }, fetchImpl: fetchImpl as typeof fetch,
        lastKnownCache: createCache<WorkspaceDirectoryEntry[]>({ namespace: 'remote-title-test', immutable: true }),
    });
    const { tool } = createSearchConversationsTool({ store, workspaceId: 'shared-workspace', currentProcessId: 'current', directory });
    return { store, server, servers, directory, fetchImpl, selected, search: (args: object = {}) => tool.handler({ title: 'plan', workspaceId: selected, ...args }, invocation) };
}

describe('remote title lookup', () => {
    it.each(['ssh', 'devtunnel'])('routes %s summaries with server/workspace identity and keeps colliding local process IDs', async kind => {
        const { search, store, fetchImpl, selected } = setup(kind);
        expect(await search({ since: '2026-10-01', until: '2026-10-16' })).toMatchObject({
            total: 1, ambiguous: false, results: [{ processId: 'current', workspaceId: selected,
                conversationWorkspaceId: 'shared-workspace', serverId: 'remote-server', server: 'Build machine', workspaceLabel: 'Remote project' }],
        });
        const url = new URL(String(fetchImpl.mock.calls[1][0]));
        expect(url.pathname).toBe('/api/processes/summaries');
        expect(Object.fromEntries(url.searchParams)).toEqual({ workspace: 'shared-workspace', type: 'chat', limit: '200', offset: '0',
            since: '2026-10-01T00:00:00.000Z', until: '2026-10-16T00:00:00.000Z' });
        expect(store.getProcessSummaries).not.toHaveBeenCalled();
        expect(store.getProcess).not.toHaveBeenCalled();
    });

    it('matches displayed titles before pagination and checks workspace/type/archive ownership', async () => {
        const entries = Array.from({ length: 200 }, (_, i) => entry(`other-${i}`, { title: 'Other' }));
        entries.push(entry('wrong-owner', { workspaceId: 'other' }), entry('job', { type: 'workflow' }),
            entry('archived', { archived: true }), entry('renamed', { customTitle: 'Other' }),
            entry('one'), entry('two', { customTitle: 'The PLAN' }), entry('three', { title: undefined, promptPreview: 'My plan' }));
        const { search, fetchImpl } = setup('ssh', entries);
        expect(await search({ limit: 1, offset: 1 })).toMatchObject({
            total: 3, ambiguous: true, hasMore: true, results: [{ processId: 'two', title: 'The PLAN' }],
            message: 'Multiple chats match. Ask the user which chat to attach.',
        });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('reads chat metadata only from the selected server when remote workspace and process IDs collide', async () => {
        const { search, servers, fetchImpl } = setup();
        servers.push({ id: 'another-server', label: 'Another machine', kind: 'devtunnel', effectiveUrl: 'http://localhost:53000' });
        const result = await search({ workspaceId: buildRemoteCloneKey('another-server', 'shared-workspace') });
        expect(result).toMatchObject({ total: 1, results: [{ processId: 'current', serverId: 'another-server', server: 'Another machine' }] });
        const summaryUrls = fetchImpl.mock.calls.map(([url]) => new URL(String(url)))
            .filter(url => url.pathname === '/api/processes/summaries');
        expect(summaryUrls.map(url => url.port)).toEqual(['53000']);
    });

    it('uses the new endpoint after reconnect without changing identity', async () => {
        const { search, server, fetchImpl } = setup('devtunnel');
        const first = await search();
        server.effectiveUrl = 'http://localhost:52000';
        expect(await search()).toEqual(first);
        expect(fetchImpl.mock.calls.slice(2).every(([url]) => new URL(String(url)).port === '52000')).toBe(true);
    });

    it.each(['remote:unknown:shared-workspace', 'remote:%ZZ:shared-workspace'])('never resolves unavailable identity %s locally', async workspaceId => {
        const { search, store } = setup();
        expect(await search({ workspaceId })).toMatchObject({ code: 'unavailable' });
        expect(store.getProcessSummaries).not.toHaveBeenCalled();
    });

    it('reports offline with no local fallback', async () => {
        const { search, server, store } = setup();
        await search();
        server.effectiveUrl = '';
        expect(await search()).toMatchObject({ code: 'unavailable' });
        expect(store.getProcessSummaries).not.toHaveBeenCalled();
    });

    it.each([404, 500])('hides transport details and discards partial matches on HTTP %s', async status => {
        const { search, fetchImpl } = setup('ssh', Array.from({ length: 201 }, (_, i) => entry(String(i))));
        const normal = fetchImpl.getMockImplementation()!;
        fetchImpl.mockImplementation(async url => new URL(String(url)).searchParams.get('offset') === '200'
            ? Response.json({ error: 'secret endpoint details' }, { status }) : normal(url));
        const result = await search();
        expect(result).toEqual({ error: 'Remote title lookup is unavailable.', code: 'unavailable' });
    });

    it.each([{ summaries: [], total: '1' }, { summaries: [null], total: 1 }, { summaries: [entry('bad', { customTitle: 42 as any })], total: 1 }])(
        'rejects malformed remote metadata %j', async body => {
            const { search, fetchImpl } = setup();
            const normal = fetchImpl.getMockImplementation()!;
            fetchImpl.mockImplementation(async url => new URL(String(url)).pathname.endsWith('/summaries') ? Response.json(body) : normal(url));
            expect(await search()).toMatchObject({ code: 'unavailable' });
        });

    it('wires the owner directory through the normal chat tool bundle', async () => {
        const { store, directory, selected } = setup();
        const bundle = buildChatToolBundle({ store, workspaceId: 'shared-workspace', processId: 'current',
            sendToConversationRuntime: { workspaceDirectory: directory },
            canvasToolsEnabled: false, kustoToolsEnabled: false, systemOneToolEnabled: false,
        });
        const search = bundle.tools.find(tool => tool.name === 'search_conversations')!;
        expect(await search.handler({ title: 'plan', workspaceId: selected }, invocation)).toMatchObject({ total: 1 });
    });
});
