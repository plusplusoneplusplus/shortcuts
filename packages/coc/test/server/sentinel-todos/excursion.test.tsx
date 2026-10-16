/**
 * Sentinel To-do excursions: following a To-do link to another chat keeps a
 * way back. Covers the pure path rules, the pinned To-do layered into the
 * visited chat's panel (never stored), the To-do tab's link handling and
 * remembered view, and the origin bar's Back / breadcrumb / close controls.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { SentinelTodoItem, SentinelTodoConversationReference, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';

const get = vi.fn();
const fakeClient = {
    sentinelTodos: { get: (...args: unknown[]) => get(...args), create: vi.fn(), update: vi.fn() },
    events: { connect: () => ({ close: vi.fn() }) },
};
vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: () => fakeClient }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...(await importOriginal<object>()),
    getCocClientForWorkspace: () => fakeClient,
}));

import { UnifiedTodoTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
import { SentinelTodoOriginBar } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelTodoOriginBar';
import { useUnifiedPanelTabs } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useUnifiedPanelTabs';
import { clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { EMPTY_UNIFIED_PANEL, activeTabId, visibleTabs, openTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { clearSentinelTodoChats, publishSentinelTodoChat } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoChats';
import {
    SENTINEL_TODO_EXCURSION_MAX_TRAIL,
    clearSentinelTodoExcursion,
    excursionStopIndex,
    getSentinelTodoExcursion,
    isPinnedSentinelTodo,
    pinnedSentinelTodoTabId,
    recallSentinelTodoView,
    rememberSentinelTodoView,
    returnFromSentinelTodoExcursion,
    startSentinelTodoExcursion,
    visitExcursionStop,
    visitSentinelTodoExcursionChat,
    withPinnedSentinelTodo,
    type SentinelTodoExcursion,
    type SentinelTodoExcursionOrigin,
} from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { sentinelTodoTabInput } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoPanelModel';
import { resolveDashboardRoute, buildRepoGroupChatHash } from '../../../src/server/spa/client/react/layout/dashboardRoutes';
import { publishDashboardTopology } from '../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { tagRemoteWorkspaces } from '../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import { buildRemoteCloneKey } from '../../../src/server/spa/client/react/repos/cloneIdentity';
import { queueReducer, type QueueContextState } from '../../../src/server/spa/client/react/contexts/QueueContext';

const OWNER = { ownerWorkspaceId: 'ws-1', ownerRoutingRef: null, processId: 'chat-s' };
const ORIGIN: SentinelTodoExcursionOrigin = {
    owner: OWNER, scopeWorkspaceId: 'ws-1', chatId: 'chat-s', title: 'Release coordination',
    href: '#repos/ws-1/chats/chat-s', linkKey: 'i1|ref:chat-a',
};

function stop(chatId: string, scopeWorkspaceId = 'ws-1') {
    return { scopeWorkspaceId, chatId, title: `Chat ${chatId}`, href: `#repos/${scopeWorkspaceId}/chats/${chatId}` };
}

function item(overrides: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    return {
        id: 'i1', title: 'Webhook follow-up', completionCondition: '', notes: '', status: 'todo',
        archived: false, revision: 1, createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
        createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [], type: 'normal', priority: 'regular',
        references: [{ processId: 'chat-a', workspaceId: 'ws-1', openLink: '#repos/ws-1/chats/chat-a', title: 'Spike notes',
            attachedAt: '2026-10-09T00:00:00.000Z', attachedBy: 'sentinel' }],
        ...overrides,
    };
}

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    get.mockReset().mockResolvedValue({ revision: 1, items: [item()] });
    window.location.hash = '#repos/ws-1/chats/chat-s';
});

afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    publishDashboardTopology(null, []);
    vi.unstubAllGlobals();
    clearSentinelTodoExcursion();
    clearSentinelTodoChats();
    clearUnifiedPanelState();
});

describe('excursion path rules', () => {
    const base: SentinelTodoExcursion = { origin: ORIGIN, trail: [] };

    it('appends new chats, trims back to a revisited one, and caps the path', () => {
        let next = visitExcursionStop(base, stop('a'))!;
        next = visitExcursionStop(next, stop('b'))!;
        expect(next.trail.map(entry => entry.chatId)).toEqual(['a', 'b']);
        expect(visitExcursionStop(next, stop('a'))!.trail.map(entry => entry.chatId)).toEqual(['a']);
        expect(visitExcursionStop(next, stop('b'))).toBe(next);
        for (const id of ['c', 'd', 'e', 'f', 'g']) next = visitExcursionStop(next, stop(id))!;
        expect(next.trail).toHaveLength(SENTINEL_TODO_EXCURSION_MAX_TRAIL);
        expect(next.trail.at(-1)!.chatId).toBe('g');
    });

    it('keeps chats with the same id in different panel scopes apart', () => {
        const next = visitExcursionStop(visitExcursionStop(base, stop('a'))!, stop('a', 'ws-2'))!;
        expect(next.trail).toHaveLength(2);
        expect(excursionStopIndex(next, 'ws-2', 'a')).toBe(1);
        expect(excursionStopIndex(next, 'ws-3', 'a')).toBe(-1);
    });

    it('ends only when the user comes back to the origin after leaving it', () => {
        const origin = stop('chat-s');
        expect(visitExcursionStop(base, origin)).toBe(base);
        expect(visitExcursionStop(visitExcursionStop(base, stop('a'))!, origin)).toBeNull();
    });

    it('layers an owner-labelled pinned To-do only into chats on the path, keeping stored selections', () => {
        const onPath = visitExcursionStop(base, stop('a'))!;
        const state = { ...EMPTY_UNIFIED_PANEL, activeByScope: { a: 'some-tab' } };
        expect(withPinnedSentinelTodo(state, onPath, 'ws-1', 'b')).toBe(state);
        expect(withPinnedSentinelTodo(state, null, 'ws-1', 'a')).toBe(state);
        const view = withPinnedSentinelTodo(state, onPath, 'ws-1', 'a');
        const [tab] = visibleTabs(view, 'a');
        expect(tab).toMatchObject({ kind: 'todo', chatId: 'a', resourceId: OWNER.processId, label: 'To-do · Release coordination' });
        expect(tab.id).toBe(pinnedSentinelTodoTabId(onPath, 'ws-1', 'a'));
        expect(view.activeByScope).toBe(state.activeByScope);
        expect(pinnedSentinelTodoTabId(onPath, 'ws-1', 'chat-s')).toBeNull();
    });

    it('treats the origin list as pinned only outside the origin chat', () => {
        expect(isPinnedSentinelTodo(base, OWNER, 'a')).toBe(true);
        expect(isPinnedSentinelTodo(base, OWNER, 'chat-s')).toBe(false);
        expect(isPinnedSentinelTodo(base, { ...OWNER, processId: 'other' }, 'a')).toBe(false);
        expect(isPinnedSentinelTodo(null, OWNER, 'a')).toBe(false);
    });
});

describe('excursion store', () => {
    it('keeps the running path when a pinned link is followed, updating only the link to refocus', () => {
        startSentinelTodoExcursion(ORIGIN);
        visitSentinelTodoExcursionChat(stop('a'));
        startSentinelTodoExcursion({ ...ORIGIN, chatId: 'a', href: '#elsewhere', linkKey: 'i1|ref:chat-b' });
        const excursion = getSentinelTodoExcursion()!;
        expect(excursion.origin).toEqual({ ...ORIGIN, linkKey: 'i1|ref:chat-b' });
        expect(excursion.trail.map(entry => entry.chatId)).toEqual(['a']);
    });

    it.each([
        { owner: OWNER, href: '#repos/ws-2/chats/child', expected: ORIGIN.href, selection: 'ws-1' },
        { owner: OWNER, href: '#repos/ws-1/activity/child', expected: '#repos/ws-1/activity/chat-s', selection: 'ws-1' },
        { owner: OWNER, href: '#repos/ws-1/tasks/child', expected: '#repos/ws-1/tasks/chat-s', selection: 'ws-1' },
        { owner: OWNER, href: '#repos/ws-1', expected: ORIGIN.href, selection: 'ws-1' },
        { owner: { ...OWNER, ownerRoutingRef: 'remote:origin:ws-1' }, href: '#repos/remote%3Achild%3Aws-1/chats/child',
            expected: '#repos/remote%3Aorigin%3Aws-1/chats/chat-s', selection: 'remote:origin:ws-1' },
        { owner: { ...OWNER, ownerWorkspaceId: 'group-g', ownerRoutingRef: 'remote:origin:group-g' },
            href: '#repos/ws-2/chats/child', expected: '#repos/remote%3Aorigin%3Agroup-g/chats/chat-s', selection: 'remote:origin:group-g' },
    ])('returns the actual owner through the router: $expected', ({ owner, href, expected, selection }) => {
        startSentinelTodoExcursion({ ...ORIGIN, owner, href });
        const returnedHref = returnFromSentinelTodoExcursion()!;
        expect(returnedHref).toBe(expected);
        const { effects } = resolveDashboardRoute(returnedHref, {
            queueState: {} as QueueContextState, selectedRepoId: 'ws-2', repoRouteState: {}, repoTabState: {}, isSchedulesInSlide: () => false,
        });
        expect(effects).toContainEqual({ kind: 'app', action: { type: 'SET_SELECTED_REPO', id: selection } });
        expect(effects).toContainEqual({ kind: 'queue', action: { type: 'SELECT_QUEUE_TASK', id: owner.processId, repoId: selection } });
    });

    it.each([null, 'server-a'])('preserves group member navigation on its owning server (%s)', serverId => {
        const group = serverId ? buildRemoteCloneKey(serverId, 'group-g') : 'group-g';
        const owner = { ...OWNER, ownerRoutingRef: serverId ? buildRemoteCloneKey(serverId, OWNER.ownerWorkspaceId) : null };
        const href = buildRepoGroupChatHash(group, OWNER.ownerWorkspaceId, OWNER.processId);
        startSentinelTodoExcursion({ ...ORIGIN, scopeWorkspaceId: group, owner, href });
        expect(returnFromSentinelTodoExcursion()).toBe(href);
    });

    it.each(['#repos/ws-1/chats/chat-s?view=agents', '#repos/ws-1/tasks/chat-s'])('preserves a valid origin sub-view (%s)', href => {
        startSentinelTodoExcursion({ ...ORIGIN, href });
        expect(returnFromSentinelTodoExcursion()).toBe(href);
    });

    it.each(['#repos/ws-1/chats/child?view=agents', '#repos/%broken/chats/child', '#repos/remote%3Aother%3Aws-1/chats/chat-s'])('rejects another chat or server route (%s)', href => {
        startSentinelTodoExcursion({ ...ORIGIN, href });
        expect(returnFromSentinelTodoExcursion()).toBe(ORIGIN.href);
    });

    it('keeps an unavailable remote origin qualified without a local or child fallback', () => {
        const owner = { ...OWNER, ownerRoutingRef: buildRemoteCloneKey('missing-server', 'ws-1') };
        startSentinelTodoExcursion({ ...ORIGIN, owner, href: '#repos/ws-1/chats/child' });
        expect(returnFromSentinelTodoExcursion()).toBe('#repos/remote%3Amissing-server%3Aws-1/chats/chat-s');
    });

    it('returns the origin route, ends the excursion, and asks the origin list to refocus the link', () => {
        rememberSentinelTodoView(OWNER, { scrollTop: 40, expandedIds: ['i1'] });
        startSentinelTodoExcursion(ORIGIN);
        expect(returnFromSentinelTodoExcursion()).toBe(ORIGIN.href);
        expect(getSentinelTodoExcursion()).toBeNull();
        expect(recallSentinelTodoView(OWNER)).toEqual({ scrollTop: 40, expandedIds: ['i1'], focusLinkKey: ORIGIN.linkKey });
        expect(returnFromSentinelTodoExcursion()).toBeNull();
    });
});

describe('pinned To-do in the visited chat panel', () => {
    it('shows the pinned tab while the chat is on the path, never stores it, and ends the excursion on close', () => {
        const { result } = renderHook(() => useUnifiedPanelTabs('ws-1', 'chat-a'));
        expect(result.current.pinnedId).toBeNull();
        act(() => { startSentinelTodoExcursion(ORIGIN); visitSentinelTodoExcursionChat(stop('chat-a')); });
        const pinnedId = result.current.pinnedId!;
        expect(result.current.tabs.map(tab => tab.id)).toEqual([pinnedId]);
        act(() => result.current.activate(pinnedId));
        expect(result.current.activeId).toBe(pinnedId);
        expect(readUnifiedPanelState('ws-1').chatTabs['chat-a'] ?? []).toEqual([]);
        act(() => result.current.close(pinnedId));
        expect(getSentinelTodoExcursion()).toBeNull();
        expect(result.current.tabs).toEqual([]);
        expect(activeTabId(readUnifiedPanelState('ws-1'), 'chat-a')).toBeNull();
    });

    it('removes the pinned copy on return and restores the origin To-do selection', () => {
        const originState = openTab(EMPTY_UNIFIED_PANEL, sentinelTodoTabInput(OWNER, ORIGIN.chatId));
        writeUnifiedPanelState('ws-1', originState);
        const { result, rerender } = renderHook(({ chatId }) => useUnifiedPanelTabs('ws-1', chatId), {
            initialProps: { chatId: ORIGIN.chatId },
        });
        act(() => { startSentinelTodoExcursion(ORIGIN); visitSentinelTodoExcursionChat(stop('chat-a')); });
        rerender({ chatId: 'chat-a' });
        act(() => result.current.activate(result.current.pinnedId!));
        expect(result.current.active?.label).toBe('To-do · Release coordination');
        act(() => { returnFromSentinelTodoExcursion(); });
        rerender({ chatId: ORIGIN.chatId });
        expect(result.current.pinnedId).toBeNull();
        expect(result.current.activeId).toBe(activeTabId(originState, ORIGIN.chatId));
        expect(result.current.active).toMatchObject({ kind: 'todo', resourceId: OWNER.processId, chatId: ORIGIN.chatId });
    });

    it('adds the pinned ledger without runtime feature configuration', () => {
        const { result } = renderHook(() => useUnifiedPanelTabs('ws-1', 'chat-a'));
        act(() => { startSentinelTodoExcursion(ORIGIN); visitSentinelTodoExcursionChat(stop('chat-a')); });
        expect(result.current.pinnedId).not.toBeNull();
        expect(result.current.tabs).toEqual([expect.objectContaining({ kind: 'todo', resourceId: OWNER.processId })]);
    });
});

describe('UnifiedTodoTab links and remembered view', () => {
    async function renderOrigin() {
        publishSentinelTodoChat('ws-1', 'chat-s', { ownerWorkspaceId: 'ws-1', processId: OWNER.processId, title: 'Release coordination' });
        const view = render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" chatId="chat-s" />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        if (!screen.queryByTestId('sentinel-todo-detail-i1')) fireEvent.click(row.querySelector('[data-todo-select]')!);
        return { ...view, link: await screen.findByRole('link', { name: 'Spike notes' }) };
    }

    it('starts an excursion from a plain click on an in-app link, naming the origin Sentinel', async () => {
        const { link } = await renderOrigin();
        fireEvent.click(link, { button: 0 });
        expect(getSentinelTodoExcursion()).toEqual({
            origin: { ...ORIGIN, linkKey: 'i1|ref:[null,"ws-1","chat-a"]' },
            trail: [],
        });
    });

    it('starts a remote reference excursion after verification and restores its qualified link focus on Back', async () => {
        const reference: SentinelTodoConversationReference = { ...(item().references![0] as SentinelTodoConversationReference), serverIdentity: 'destination', verification: 'unverified' as const };
        get.mockResolvedValue({ revision: 1, items: [item({ references: [reference] })] });
        publishDashboardTopology('ws-1', tagRemoteWorkspaces({ id: 'ssh', label: 'Laptop', kind: 'ssh', serverIdentity: 'destination' },
            'http://localhost:7000', [{ id: 'ws-1', name: 'Remote' } as WorkspaceInfo]), 'local');
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
            String(input).includes('/health') ? { serverIdentity: 'destination' }
                : { process: { id: 'chat-a', workspaceId: 'ws-1', type: 'chat' } }),
            { headers: { 'Content-Type': 'application/json' } })));
        const first = await renderOrigin();
        await act(async () => { fireEvent.click(first.link); });
        const key = 'i1|ref:["destination","ws-1","chat-a"]';
        expect(getSentinelTodoExcursion()?.origin).toMatchObject({ href: ORIGIN.href, linkKey: key, owner: OWNER });
        expect(window.location.hash).toBe('#repos/remote%3Assh%3Aws-1/chats/chat-a');
        first.unmount();
        act(() => { window.location.hash = returnFromSentinelTodoExcursion()!; });
        const second = await renderOrigin();
        expect(document.activeElement).toBe(second.link);
        expect(getSentinelTodoExcursion()).toBeNull();
    });

    it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])('leaves modified clicks (%o) to the browser', async init => {
        const { link } = await renderOrigin();
        fireEvent.click(link, init);
        expect(getSentinelTodoExcursion()).toBeNull();
    });

    it('returns to the ledger owner when the URL already selects the child', async () => {
        const { link, unmount } = await renderOrigin();
        window.location.hash = '#repos/ws-1/chats/chat-a';
        fireEvent.click(link, { button: 0 });
        unmount();
        render(<SentinelTodoOriginBar scopeWorkspaceId="ws-1" chatId="chat-a" title="Child" />);
        fireEvent.click(screen.getByTestId('sentinel-todo-origin-back'));
        const queueState = { selectedTaskId: 'chat-a', selectedTaskIdByRepo: { 'ws-1': 'chat-a' } } as QueueContextState;
        const { effects } = resolveDashboardRoute(window.location.hash, {
            queueState, selectedRepoId: 'ws-1', repoRouteState: {}, repoTabState: {}, isSchedulesInSlide: () => false,
        });
        const returned = effects.reduce((state, effect) => effect.kind === 'queue' ? queueReducer(state, effect.action) : state, queueState);
        expect(returned.selectedTaskIdByRepo['ws-1']).toBe(OWNER.processId);
        expect(returned.selectedTaskId).toBe(OWNER.processId);
        expect(getSentinelTodoExcursion()).toBeNull();
        expect(screen.queryByTestId('sentinel-todo-origin-bar')).toBeNull();
    });

    it('does not start one for external job links or a tab without its chat placement', async () => {
        get.mockResolvedValue({ revision: 1, items: [item({ references: [], jobs: [{
            processId: 'p-r', workspaceId: 'ws-r', kind: 'remote', serverId: 'srv', title: 'Remote fix',
            openLink: 'https://remote.example/#repos/ws-r/chats/p-r', linkedAt: item().createdAt, execution: { state: 'unavailable' },
        }] })] });
        const { unmount } = render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" chatId="chat-s" />);
        fireEvent.click(await screen.findByRole('link', { name: 'Remote fix' }));
        unmount();
        get.mockResolvedValue({ revision: 1, items: [item()] });
        render(<UnifiedTodoTab owner={OWNER} />);
        const row = await screen.findByTestId('sentinel-todo-row-i1');
        fireEvent.click(row.querySelector('[data-todo-select]')!);
        fireEvent.click(await screen.findByRole('link', { name: 'Spike notes' }));
        expect(getSentinelTodoExcursion()).toBeNull();
    });

    it('restores selected details and list scroll per owner, and focuses the followed link after Back', async () => {
        const first = await renderOrigin();
        const scroller = screen.getByTestId('sentinel-todo-list');
        scroller.scrollTop = 120;
        fireEvent.scroll(scroller);
        fireEvent.click(first.link);
        first.unmount();
        expect(recallSentinelTodoView(OWNER)).toMatchObject({ scrollTop: 120, expandedIds: ['i1'] });

        returnFromSentinelTodoExcursion();
        const second = await renderOrigin();
        expect(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { pressed: true })).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-list').scrollTop).toBe(120);
        expect(document.activeElement).toBe(second.link);
        expect(recallSentinelTodoView(OWNER).focusLinkKey).toBeUndefined();
    });

    it('labels the pinned copy with its owner and unpins it', async () => {
        startSentinelTodoExcursion(ORIGIN);
        render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" chatId="chat-a" />);
        const banner = await screen.findByTestId('sentinel-todo-pinned-banner');
        expect(banner.textContent).toContain('Release coordination');
        fireEvent.click(within(banner).getByRole('button', { name: 'Unpin Release coordination To-do' }));
        expect(getSentinelTodoExcursion()).toBeNull();
        expect(screen.queryByTestId('sentinel-todo-pinned-banner')).toBeNull();
    });
});

describe('SentinelTodoOriginBar', () => {
    function renderBar(chatId: string, title = `Chat ${chatId}`) {
        window.location.hash = `#repos/ws-1/chats/${chatId}`;
        return render(<SentinelTodoOriginBar scopeWorkspaceId="ws-1" chatId={chatId} title={title} />);
    }

    it('renders nothing without an excursion or off its path', () => {
        renderBar('chat-a');
        expect(screen.queryByTestId('sentinel-todo-origin-bar')).toBeNull();
        cleanup();
        act(() => startSentinelTodoExcursion(ORIGIN));
        renderBar('chat-s');
        expect(screen.queryByTestId('sentinel-todo-origin-bar')).toBeNull();
        expect(getSentinelTodoExcursion()!.trail).toEqual([]);
    });

    it('records the visit and goes Back to the origin route', () => {
        act(() => startSentinelTodoExcursion(ORIGIN));
        renderBar('chat-a');
        const nav = screen.getByRole('navigation', { name: 'Origin' });
        expect(within(nav).getByText('Chat chat-a').getAttribute('aria-current')).toBe('page');
        expect(nav.textContent).toContain('Release coordination');
        fireEvent.click(within(nav).getByRole('button', { name: 'Back to Sentinel: Release coordination' }));
        expect(window.location.hash).toBe(ORIGIN.href);
        expect(getSentinelTodoExcursion()).toBeNull();
        expect(screen.queryByTestId('sentinel-todo-origin-bar')).toBeNull();
    });

    it('reselects the Sentinel when the URL still names it but the hosted selection is a child', () => {
        act(() => startSentinelTodoExcursion(ORIGIN));
        window.history.replaceState(null, '', ORIGIN.href);
        let queueState = { selectedTaskId: 'chat-a', selectedTaskIdByRepo: { 'ws-1': 'chat-a' } } as QueueContextState;
        const applyHash = () => {
            const { effects } = resolveDashboardRoute(window.location.hash, {
                queueState, selectedRepoId: 'ws-1', repoRouteState: {}, repoTabState: {}, isSchedulesInSlide: () => false,
            });
            for (const effect of effects) if (effect.kind === 'queue') queueState = queueReducer(queueState, effect.action);
        };
        window.addEventListener('hashchange', applyHash);
        try {
            render(<SentinelTodoOriginBar scopeWorkspaceId="ws-1" chatId="chat-a" title="Child" />);
            fireEvent.click(screen.getByTestId('sentinel-todo-origin-back'));
            expect(queueState.selectedTaskIdByRepo['ws-1']).toBe(OWNER.processId);
            expect(getSentinelTodoExcursion()).toBeNull();
        } finally {
            window.removeEventListener('hashchange', applyHash);
        }
    });

    it('folds earlier chats, returns to them from the breadcrumb, and closes', () => {
        act(() => {
            startSentinelTodoExcursion(ORIGIN);
            visitSentinelTodoExcursionChat(stop('chat-a'));
            visitSentinelTodoExcursionChat(stop('chat-b'));
        });
        renderBar('chat-c');
        const nav = screen.getByRole('navigation', { name: 'Origin' });
        expect(within(nav).queryByRole('button', { name: 'Chat chat-a' })).toBeNull();
        fireEvent.click(within(nav).getByRole('button', { name: 'Show 1 earlier conversation' }));
        fireEvent.click(within(nav).getByRole('button', { name: 'Chat chat-a' }));
        expect(window.location.hash).toBe('#repos/ws-1/chats/chat-a');
        fireEvent.click(within(nav).getByRole('button', { name: /^Stop tracking the way back/ }));
        expect(getSentinelTodoExcursion()).toBeNull();
    });

    it('ends the excursion when the origin chat is opened again from anywhere', () => {
        act(() => { startSentinelTodoExcursion(ORIGIN); visitSentinelTodoExcursionChat(stop('chat-a')); });
        renderBar('chat-s');
        expect(getSentinelTodoExcursion()).toBeNull();
    });
});
