/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardTopology, publishDashboardTopology } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { createDashboardDiscoverySocketRelay } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/socket-relay';
import { _resetDashboardChatCacheMemory } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/chat-cache';
import { searchDashboardChats } from '../../../../src/server/spa/client/react/shared/dashboard-discovery/chat-search';
import { isRemoteWorkspace, tagRemoteWorkspaces } from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { DashboardDiscoveryRelay } from '../../../../src/server/streaming/dashboard-discovery-relay';
import type { DashboardChatQuery, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';

const owner = { id: 'owner', name: 'Owner' } as WorkspaceInfo;
const rows = (kind: 'ssh' | 'devtunnel' = 'ssh', port = 5000, identity = 'destination', offline = false, alias: string = kind) =>
    tagRemoteWorkspaces({ id: alias, label: `${alias} server`, kind, serverIdentity: identity },
        `http://localhost:${port}`, [{ id: 'same', name: 'Repo' } as WorkspaceInfo], offline);
const query = (overrides: Partial<DashboardChatQuery> = {}): DashboardChatQuery => ({
    target: { serverIdentity: 'destination', workspaceId: 'same' }, title: 'needle', limit: 10, offset: 0, ...overrides,
});
const entry = (id = 'chat', title = 'Needle chat', extra = {}) => ({
    id, workspaceId: 'same', type: 'chat', promptPreview: 'Preview', title, ...extra,
});
const page = (summaries = [entry()], total = summaries.length, offset = 0) => ({
    summaries, total, limit: 200, offset,
});
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const disposers: (() => void)[] = [];
function socket(baseUrl?: string) {
    const send = vi.fn();
    const relay = createDashboardDiscoverySocketRelay({ send }, baseUrl);
    disposers.push(() => relay.dispose());
    relay.onOpen();
    const request = (value: unknown = query(), overrides = {}, id = 'read') => relay.onMessage({
        type: 'dashboard-chats-request', request: {
            id, workspaceId: getDashboardTopology().selectedRef === 'owner' ? 'owner' : 'same',
            revision: getDashboardTopology().revision, query: value, ...overrides,
        },
    });
    const replies = () => send.mock.calls.map(([message]) => message)
        .filter(message => message.type === 'dashboard-chats-result').map(message => message.reply);
    return { send, relay, request, replies };
}
function serve(handler: (url: URL, init?: RequestInit) => unknown = () => page()) {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost:4000');
        return json(url.pathname.endsWith('/health') ? { serverIdentity: 'destination' } : await handler(url, init));
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
}
afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    publishDashboardTopology(null, []);
    _resetDashboardChatCacheMemory();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('dashboard title-search producer', () => {
    it.each(['ssh', 'devtunnel'] as const)('persists the full %s title inventory for offline reload, new searches and pagination', async kind => {
        publishDashboardTopology('owner', [owner, ...rows(kind)]);
        const fetcher = serve(() => page([
            entry('first', 'Needle one'), entry('second', 'Needle two'), entry('other', 'Other chat'),
            entry('custom', 'Hidden', { customTitle: 'Custom needle' }),
            entry('preview', '', { promptPreview: 'Preview needle' }),
            entry('archived', 'Needle archived', { archived: true }),
            entry('foreign', 'Needle foreign', { workspaceId: 'foreign' }),
            entry('job', 'Needle job', { type: 'run-script' }),
        ]));
        const target = socket();
        target.request(query({ title: 'Other', limit: 1 }));
        await vi.waitFor(() => expect(target.replies()[0]?.result.total).toBe(1));
        const persisted = JSON.stringify({ ...localStorage });
        expect(persisted).not.toMatch(/localhost|baseUrl|promptPreview|workspaceLabel|serverLabel|archived|foreign|Needle job/);
        _resetDashboardChatCacheMemory();
        fetcher.mockClear();
        publishDashboardTopology('owner', [owner, ...rows(kind, 7000, 'destination', true)]);
        target.request(query({ offset: 1, limit: 2 }), {}, 'offline');
        await vi.waitFor(() => expect(target.replies()).toHaveLength(2));
        expect(target.replies()[1].result).toEqual({
            target: query().target, serverLabel: `${kind} server`, workspaceLabel: 'Repo', serverKind: kind,
            verification: 'unverified', total: 4,
            conversations: [{ processId: 'second', title: 'Needle two' }, { processId: 'custom', title: 'Custom needle' }],
        });
        target.request(query({ offset: 99 }), {}, 'beyond');
        await vi.waitFor(() => expect(target.replies()[2]?.result).toMatchObject({ total: 4, conversations: [] }));
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('keeps offline cached workspace/process collisions separate across installations and workspaces', async () => {
        const otherWorkspace = tagRemoteWorkspaces({ id: 'third', label: 'Third', kind: 'ssh', serverIdentity: 'destination' },
            'http://localhost:8000', [{ id: 'different', name: 'Different' } as WorkspaceInfo]);
        const workspaces = [owner, ...rows(), ...rows('devtunnel', 6000, 'other'), ...otherWorkspace];
        publishDashboardTopology('owner', workspaces);
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            return json(url.pathname.endsWith('/health') ? { serverIdentity: url.port === '6000' ? 'other' : 'destination' }
                : page([entry('same-chat', `Needle ${url.port}`, { workspaceId: url.port === '8000' ? 'different' : 'same' })]));
        }));
        const selectors = [query(), query({ target: { serverIdentity: 'other', workspaceId: 'same' } }),
            query({ target: { serverIdentity: 'destination', workspaceId: 'different' } })];
        for (const selector of selectors) await searchDashboardChats(selector, new AbortController().signal);
        _resetDashboardChatCacheMemory();
        publishDashboardTopology('owner', workspaces.map(workspace => isRemoteWorkspace(workspace)
            ? { ...workspace, remote: { ...workspace.remote, offline: true, connection: 'offline' as const } } : workspace));
        const results = await Promise.all(selectors.map(selector => searchDashboardChats(selector, new AbortController().signal)));
        expect(results.map(result => result.conversations[0].title)).toEqual(['Needle 5000', 'Needle 6000', 'Needle 8000']);
        expect(results.every(result => result.verification === 'unverified')).toBe(true);
    });

    it('serves cached titles after changing the connection alias, labels and transport', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        const fetcher = serve();
        await searchDashboardChats(query(), new AbortController().signal);
        _resetDashboardChatCacheMemory();
        publishDashboardTopology('owner', [owner, ...rows('devtunnel', 9000, 'destination', true, 'renamed')]);
        fetcher.mockClear();
        await expect(searchDashboardChats(query(), new AbortController().signal)).resolves.toMatchObject({
            serverLabel: 'renamed server', serverKind: 'devtunnel', verification: 'unverified',
            target: query().target, conversations: [{ processId: 'chat', title: 'Needle chat' }],
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(['replacement', 'unknown', 'removed'] as const)('does not use saved titles for a %s destination', async state => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        const fetcher = serve();
        await searchDashboardChats(query(), new AbortController().signal);
        fetcher.mockClear();
        publishDashboardTopology('owner', [owner, ...(state === 'removed' ? []
            : rows('ssh', 5000, state === 'unknown' ? '' : 'replacement', true))]);
        await expect(searchDashboardChats(query(), new AbortController().signal)).rejects.toThrow('unavailable');
        if (state === 'replacement') await expect(searchDashboardChats(query({ target: {
            serverIdentity: 'replacement', workspaceId: 'same',
        } }), new AbortController().signal)).rejects.toThrow('unavailable');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(['ssh', 'devtunnel'] as const)('refreshes cached titles on %s reconnect at the new port and preserves an empty inventory', async kind => {
        publishDashboardTopology('owner', [owner, ...rows(kind)]);
        const fetcher = serve();
        await searchDashboardChats(query(), new AbortController().signal);
        publishDashboardTopology('owner', [owner, ...rows(kind, 7000)]);
        fetcher.mockClear();
        serve(() => page([]));
        await expect(searchDashboardChats(query(), new AbortController().signal)).resolves.toMatchObject({
            verification: 'verified', total: 0,
        });
        publishDashboardTopology('owner', [owner, ...rows(kind, 7000, 'destination', true)]);
        _resetDashboardChatCacheMemory();
        await expect(searchDashboardChats(query(), new AbortController().signal)).resolves.toMatchObject({
            verification: 'unverified', total: 0, conversations: [],
        });
    });

    it('uses session cache when storage is denied or full', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        serve();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        await searchDashboardChats(query(), new AbortController().signal);
        publishDashboardTopology('owner', [owner, ...rows('ssh', 5000, 'destination', true)]);
        await expect(searchDashboardChats(query(), new AbortController().signal)).resolves.toMatchObject({
            verification: 'unverified', total: 1,
        });
    });

    it.each(['bad-json', 'version', 'identity', 'workspace', 'partial', 'duplicate', 'row', 'extra'] as const)(
        'rejects malformed persisted inventory: %s', async corruption => {
            publishDashboardTopology('owner', [owner, ...rows()]);
            const fetcher = serve();
            await searchDashboardChats(query(), new AbortController().signal);
            const key = localStorage.key(0)!;
            const saved = JSON.parse(localStorage.getItem(key)!);
            if (corruption === 'version') saved.version = 2;
            if (corruption === 'identity') saved.target.serverIdentity = 'other';
            if (corruption === 'workspace') saved.target.workspaceId = 'other';
            if (corruption === 'partial') saved.total++;
            if (corruption === 'duplicate') { saved.conversations.push(saved.conversations[0]); saved.total++; }
            if (corruption === 'row') saved.conversations[0].title = 42;
            if (corruption === 'extra') saved.conversations[0].baseUrl = 'private';
            localStorage.setItem(key, corruption === 'bad-json' ? '{' : JSON.stringify(saved));
            _resetDashboardChatCacheMemory();
            fetcher.mockClear();
            publishDashboardTopology('owner', [owner, ...rows('ssh', 5000, 'destination', true)]);
            await expect(searchDashboardChats(query(), new AbortController().signal)).rejects.toThrow('unavailable');
            expect(fetcher).not.toHaveBeenCalled();
        },
    );

    it('does not fall back to cache after failed online identity validation', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        serve();
        await searchDashboardChats(query(), new AbortController().signal);
        vi.stubGlobal('fetch', vi.fn(async () => json({ serverIdentity: 'replacement' })));
        await expect(searchDashboardChats(query(), new AbortController().signal)).rejects.toThrow('unavailable');
    });

    it('does not cache partial scans or publish cancelled cached reads', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        serve(url => url.searchParams.get('offset') === '0'
            ? page(Array.from({ length: 200 }, (_, i) => entry(String(i))), 201) : page([], 201, 200));
        await expect(searchDashboardChats(query(), new AbortController().signal)).rejects.toThrow('unavailable');
        expect(localStorage.length).toBe(0);
        serve();
        await searchDashboardChats(query(), new AbortController().signal);
        publishDashboardTopology('owner', [owner, ...rows('ssh', 5000, 'destination', true)]);
        const controller = new AbortController();
        controller.abort(new Error('cancelled'));
        await expect(searchDashboardChats(query(), controller.signal)).rejects.toThrow('cancelled');
        const target = socket();
        target.request();
        target.relay.onMessage({ type: 'dashboard-discovery-cancel', id: 'read' });
        await Promise.resolve();
        expect(target.replies()).toEqual([]);
    });

    it('completes the owner-scoped server relay protocol with real client reads after a tunnel port changes', async () => {
        publishDashboardTopology('owner', [owner, ...rows('devtunnel')]);
        const fetcher = serve();
        const server = new DashboardDiscoveryRelay();
        const client = { id: 'dashboard', send: (data: string) => producer.onMessage(JSON.parse(data)) };
        const producer = createDashboardDiscoverySocketRelay({ send(message) {
            const value = message as Record<string, unknown>;
            if (value.type === 'dashboard-discovery-capability') {
                server.advertise(client, value.workspaceId, value.revision, value.focused);
            } else if (value.type === 'dashboard-chats-result') {
                server.reply(client, value.reply, 'chats');
            } else if (value.type === 'dashboard-discovery-clear') server.disconnect(client);
            return true;
        } });
        disposers.push(() => producer.dispose());
        producer.onOpen();
        await expect(server.searchChats('owner', query())).resolves.toMatchObject({
            target: query().target, serverKind: 'devtunnel', verification: 'verified', total: 1,
            conversations: [{ processId: 'chat', title: 'Needle chat' }],
        });
        publishDashboardTopology('owner', [owner, ...rows('devtunnel', 7000)]);
        await expect(server.searchChats('owner', query())).resolves.toMatchObject({ target: query().target, total: 1 });
        expect(fetcher.mock.lastCall![0]).toBe('http://localhost:7000/api/health');
        publishDashboardTopology('owner', [owner, ...rows('devtunnel', 7000, 'destination', true)]);
        _resetDashboardChatCacheMemory();
        await expect(server.searchChats('owner', query())).resolves.toMatchObject({
            target: query().target, verification: 'unverified', total: 1,
            conversations: [{ processId: 'chat', title: 'Needle chat' }],
        });
        producer.onClose();
        server.disconnect(client);
        await expect(server.searchChats('owner', query())).rejects.toThrow('No dashboard');
    });

    it.each(['ssh', 'devtunnel'] as const)('reads exact %s destination summaries without transcripts or registry aliases', async kind => {
        publishDashboardTopology('owner', [owner, ...rows(kind)]);
        const fetcher = serve();
        const target = socket();
        expect(target.request()).toBe(true);
        await vi.waitFor(() => expect(target.replies()).toHaveLength(1));
        expect(target.replies()[0]).toEqual({ id: 'read', ok: true, result: {
            target: query().target, serverLabel: `${kind} server`, workspaceLabel: 'Repo', serverKind: kind,
            verification: 'verified', total: 1, conversations: [{ processId: 'chat', title: 'Needle chat' }],
        } });
        expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
            'http://localhost:5000/api/health',
            'http://localhost:5000/api/processes/summaries?workspace=same&type=chat&archived=false&limit=200&offset=0',
            'http://localhost:5000/api/health',
        ]);
        expect(fetcher.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
        expect(JSON.stringify(target.replies())).not.toMatch(/localhost|baseUrl|cloneKey|promptPreview/);
    });

    it('scans all summary pages and matches displayed titles before output pagination', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        const first = Array.from({ length: 200 }, (_, i) => entry(`filler-${i}`, 'Unrelated'));
        first[0] = entry('custom', 'Unrelated', { customTitle: 'Custom NEEDLE' });
        first[1] = entry('hidden', 'Needle', { customTitle: 'Different' });
        first[2] = entry('archived', 'Needle', { archived: true });
        first[3] = entry('foreign', 'Needle', { workspaceId: 'foreign' });
        first[4] = entry('job', 'Needle', { type: 'run-script' });
        const fetcher = serve(url => url.searchParams.get('offset') === '0' ? page(first, 202)
            : page([entry('generated'), entry('preview', '', { promptPreview: 'Preview Needle' })], 202, 200));
        const target = socket();
        target.request(query({ title: ' NEEDLE ', offset: 1, limit: 1 }));
        await vi.waitFor(() => expect(target.replies()).toHaveLength(1));
        expect(target.replies()[0].result).toMatchObject({ total: 3, conversations: [{ processId: 'generated', title: 'Needle chat' }] });
        expect(fetcher.mock.calls).toHaveLength(5);
        publishDashboardTopology('owner', [owner, ...rows('ssh', 5000, 'destination', true)]);
        _resetDashboardChatCacheMemory();
        await expect(searchDashboardChats(query({ title: 'preview' }), new AbortController().signal)).resolves.toMatchObject({
            total: 1, verification: 'unverified', conversations: [{ processId: 'preview', title: 'Preview Needle' }],
        });
        expect(fetcher.mock.calls).toHaveLength(5);
    });

    it('supports empty results and offsets beyond the full match count', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        serve(() => page([]));
        const target = socket();
        target.request(query({ offset: 99 }));
        await vi.waitFor(() => expect(target.replies()[0]?.result).toMatchObject({ total: 0, conversations: [] }));
    });

    it('keeps colliding workspace and chat IDs on their durable server', async () => {
        publishDashboardTopology('owner', [owner, ...rows(), ...rows('devtunnel', 6000, 'other')]);
        const fetcher = vi.fn(async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            return json(url.pathname.endsWith('/health') ? { serverIdentity: url.port === '5000' ? 'destination' : 'other' }
                : page([entry('same-chat', `Needle ${url.port}`)]));
        });
        vi.stubGlobal('fetch', fetcher);
        const target = socket();
        target.request();
        target.request(query({ target: { serverIdentity: 'other', workspaceId: 'same' } }), {}, 'other-read');
        await vi.waitFor(() => expect(target.replies()).toHaveLength(2));
        expect(target.replies().map(reply => reply.result.conversations[0].title).sort()).toEqual(['Needle 5000', 'Needle 6000']);
    });

    it('uses an online alias of an offline destination without probing the offline endpoint', async () => {
        publishDashboardTopology('owner', [owner, ...rows('ssh', 5000, 'destination', true),
            ...rows('devtunnel', 6000)]);
        const fetcher = serve();
        const target = socket();
        target.request();
        await vi.waitFor(() => expect(target.replies()[0]?.ok).toBe(true));
        expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('http://localhost:6000/'))).toBe(true);
    });

    it('serves another visible installation through a remote Sentinel owner socket', async () => {
        publishDashboardTopology(buildRemoteCloneKey('ssh', 'same'), [owner, ...rows(),
            ...rows('devtunnel', 6000, 'other')]);
        const fetcher = vi.fn(async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            return json(url.pathname.endsWith('/health') ? { serverIdentity: 'other' } : page());
        });
        vi.stubGlobal('fetch', fetcher);
        const wrongOwner = socket();
        wrongOwner.request(query({ target: { serverIdentity: 'other', workspaceId: 'same' } }));
        expect(wrongOwner.replies()).toEqual([{ id: 'read', ok: false }]);
        const remoteOwner = socket('http://localhost:5000');
        remoteOwner.request(query({ target: { serverIdentity: 'other', workspaceId: 'same' } }));
        await vi.waitFor(() => expect(remoteOwner.replies()[0]?.result.target.serverIdentity).toBe('other'));
        expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('http://localhost:6000/'))).toBe(true);
    });

    it.each(['ssh', 'devtunnel'] as const)('serves the exact page-origin chat to a %s Sentinel with colliding workspace IDs', async kind => {
        const localWorkspace = { id: 'same', name: 'Origin repo' } as WorkspaceInfo;
        publishDashboardTopology(buildRemoteCloneKey(kind, 'same'), [localWorkspace, ...rows(kind)], 'origin');
        const fetcher = vi.fn(async (input: RequestInfo | URL) => {
            const url = new URL(String(input), 'http://localhost:4000');
            return json(url.pathname.endsWith('/health') ? { serverIdentity: 'origin' }
                : page([entry('same-chat', 'Origin needle')]));
        });
        vi.stubGlobal('fetch', fetcher);
        const target = socket('http://localhost:5000');
        target.request(query({ target: { serverIdentity: 'origin', workspaceId: 'same' } }));
        await vi.waitFor(() => expect(target.replies()[0]?.result).toEqual({
            target: { serverIdentity: 'origin', workspaceId: 'same' }, serverLabel: 'Local server',
            workspaceLabel: 'Origin repo', serverKind: 'local', verification: 'verified', total: 1,
            conversations: [{ processId: 'same-chat', title: 'Origin needle' }],
        }));
        expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
            '/api/health', '/api/processes/summaries?workspace=same&type=chat&archived=false&limit=200&offset=0', '/api/health',
        ]);
    });

    it('revokes in-flight title reads when page-origin identity is withdrawn', async () => {
        const workspaces = [{ id: 'same', name: 'Origin' } as WorkspaceInfo, ...rows()];
        const selected = buildRemoteCloneKey('ssh', 'same');
        publishDashboardTopology(selected, workspaces, 'origin');
        let release!: (value: Response) => void;
        let signal!: AbortSignal;
        const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signal = init!.signal!;
            return new Promise<Response>(resolve => { release = resolve; });
        });
        vi.stubGlobal('fetch', fetcher);
        const target = socket('http://localhost:5000');
        target.request(query({ target: { serverIdentity: 'origin', workspaceId: 'same' } }));
        publishDashboardTopology(selected, workspaces);
        expect(signal.aborted).toBe(true);
        release(json({ serverIdentity: 'origin' }));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(target.replies()).toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('snapshots caller selectors and pagination before awaiting health', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        serve();
        const target = socket();
        const value = query();
        target.request(value);
        value.target.serverIdentity = 'other';
        value.target.workspaceId = 'foreign';
        value.title = 'unrelated';
        value.limit = 1;
        value.offset = 99;
        await vi.waitFor(() => expect(target.replies()[0]?.result).toMatchObject({
            target: { serverIdentity: 'destination', workspaceId: 'same' }, total: 1,
            conversations: [{ processId: 'chat', title: 'Needle chat' }],
        }));
    });

    it.each(['offline', 'unknown', 'absent'] as const)('rejects %s targets without local reads', async state => {
        publishDashboardTopology('owner', [owner, ...(state === 'absent' ? [] : rows('ssh', 5000,
            state === 'unknown' ? '' : 'destination', state === 'offline'))]);
        const fetcher = serve();
        const target = socket();
        target.request();
        await vi.waitFor(() => expect(target.replies()).toEqual([{ id: 'read', ok: false }]));
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([undefined, '', 'replacement'])('rejects unidentified or replaced live health identity %s', async identity => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        const fetcher = vi.fn(async () => json({ serverIdentity: identity }));
        vi.stubGlobal('fetch', fetcher);
        const target = socket();
        target.request();
        await vi.waitFor(() => expect(target.replies()).toEqual([{ id: 'read', ok: false }]));
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('rechecks identity after summaries and rejects a replacement during the final page', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        let health = 0;
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => json(String(input).endsWith('/health')
            ? { serverIdentity: ++health === 1 ? 'destination' : 'replacement' } : page())));
        const target = socket();
        target.request();
        await vi.waitFor(() => expect(target.replies()).toEqual([{ id: 'read', ok: false }]));
        expect(localStorage.length).toBe(0);
    });

    it.each([
        null, {}, { ...page(), summaries: null }, { ...page(), total: -1 }, { ...page(), total: 2 },
        { ...page(), offset: 1 }, { ...page(), limit: 100 },
        page([entry(), entry()]), page([entry('bad', 'Needle', { title: 3 })]),
        page([entry('bad', 'Needle', { archived: 'false' })]),
        page([entry('', 'Needle')]), page([entry('bad', `Needle${'x'.repeat(4096)}`)]),
    ])('rejects malformed or incomplete summaries without publishing partial matches (%#)', async response => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        serve(() => response);
        const target = socket();
        target.request();
        await vi.waitFor(() => expect(target.replies()).toEqual([{ id: 'read', ok: false }]));
    });

    it.each(['failure', 'total-change', 'duplicate'] as const)('discards first-page matches on later %s', async failure => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        serve(url => {
            if (url.searchParams.get('offset') === '0') return page(Array.from({ length: 200 }, (_, i) => entry(String(i))), 201);
            if (failure === 'failure') throw new Error('Private transport details');
            return page([entry(failure === 'duplicate' ? '0' : 'last')], failure === 'total-change' ? 202 : 201, 200);
        });
        const target = socket();
        target.request();
        await vi.waitFor(() => expect(target.replies()).toEqual([{ id: 'read', ok: false }]));
    });

    it.each([undefined, {}, query({ title: '' }), query({ limit: 101 }), query({ offset: -1 })])('rejects invalid queries (%#)', async value => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        const fetcher = serve();
        const target = socket();
        target.request(value === undefined ? null : value);
        await vi.waitFor(() => expect(target.replies()).toEqual([{ id: 'read', ok: false }]));
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('rejects stale revisions and foreign owner scope before any read', () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        const fetcher = serve();
        const target = socket();
        target.request(query(), { revision: 'old' });
        target.request(query(), { workspaceId: 'foreign' }, 'foreign');
        expect(target.replies()).toEqual([{ id: 'read', ok: false }, { id: 'foreign', ok: false }]);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(['cancel', 'close', 'dispose', 'port', 'identity', 'scope', 'remove'] as const)(
        'aborts pending I/O and suppresses late results on %s', async action => {
            publishDashboardTopology('owner', [owner, ...rows()]);
            let release!: (value: Response) => void;
            let signal: AbortSignal | undefined;
            const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
                signal = init?.signal ?? undefined;
                return new Promise<Response>(resolve => { release = resolve; });
            });
            vi.stubGlobal('fetch', fetcher);
            const target = socket();
            target.request();
            expect(fetcher).toHaveBeenCalledTimes(1);
            if (action === 'cancel') target.relay.onMessage({ type: 'dashboard-discovery-cancel', id: 'read' });
            if (action === 'close') target.relay.onClose();
            if (action === 'dispose') target.relay.dispose();
            if (action === 'port') publishDashboardTopology('owner', [owner, ...rows('ssh', 7000)]);
            if (action === 'identity') publishDashboardTopology('owner', [owner, ...rows('ssh', 5000, 'replacement')]);
            if (action === 'scope') publishDashboardTopology('same', [owner, ...rows()]);
            if (action === 'remove') publishDashboardTopology('owner', [owner]);
            expect(signal?.aborted).toBe(true);
            release(json({ serverIdentity: 'destination' }));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(target.replies()).toEqual([]);
            expect(fetcher).toHaveBeenCalledTimes(1);
        },
    );

    it('cancels only the matching in-flight summaries read and permits a fresh request with the same ID', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        const reads: { signal: AbortSignal; release: (value: unknown) => void }[] = [];
        const fetcher = serve((_url, init) => new Promise(resolve => {
            reads.push({ signal: init!.signal!, release: resolve });
        }));
        const target = socket();
        target.request();
        target.request(query(), {}, 'keep');
        await vi.waitFor(() => expect(reads).toHaveLength(2));
        target.relay.onMessage({ type: 'dashboard-discovery-cancel', id: 'unknown' });
        expect(reads.every(read => !read.signal.aborted)).toBe(true);
        target.relay.onMessage({ type: 'dashboard-discovery-cancel', id: 'read' });
        expect(reads[0].signal.aborted).toBe(true);
        expect(reads[1].signal.aborted).toBe(false);
        target.request();
        await vi.waitFor(() => expect(reads).toHaveLength(3));
        reads[0].release(page([entry('stale')]));
        reads[1].release(page([entry('kept')]));
        reads[2].release(page([entry('fresh')]));
        await vi.waitFor(() => expect(target.replies()).toHaveLength(2));
        expect(target.replies().map(reply => reply.result.conversations[0].processId).sort()).toEqual(['fresh', 'kept']);
        expect(fetcher).toHaveBeenCalledTimes(8);
    });

    it('keeps reads on focus updates, ignores duplicate IDs, and supports fresh reads after reconnect', async () => {
        publishDashboardTopology('owner', [owner, ...rows()]);
        let release!: () => void;
        const wait = new Promise<void>(resolve => { release = resolve; });
        const fetcher = serve(async () => { await wait; return page(); });
        const target = socket();
        target.request();
        target.request();
        window.dispatchEvent(new Event('focus'));
        release();
        await vi.waitFor(() => expect(target.replies()).toHaveLength(1));
        expect(fetcher).toHaveBeenCalledTimes(3);
        target.relay.onClose();
        publishDashboardTopology('owner', [owner, ...rows('devtunnel', 7000)]);
        target.relay.onOpen();
        target.request();
        await vi.waitFor(() => expect(target.replies()).toHaveLength(2));
        expect(fetcher.mock.lastCall![0]).toBe('http://localhost:7000/api/health');
    });
});
