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
import type { SentinelTodoItem } from '@plusplusoneplusplus/coc-client';

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
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { EMPTY_UNIFIED_PANEL, activeTabId, visibleTabs } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
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
import { applyRuntimeConfigPatch } from '../../../src/server/spa/client/react/utils/config';

const OWNER = { ownerWorkspaceId: 'ws-1', ownerRoutingRef: null, processId: 'queue_sentinel' };
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
    get.mockReset().mockResolvedValue({ revision: 1, items: [item()] });
    window.location.hash = '#repos/ws-1/chats/chat-s';
});

afterEach(() => {
    cleanup();
    clearSentinelTodoExcursion();
    clearSentinelTodoChats();
    clearUnifiedPanelState();
    applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: false });
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
    beforeEach(() => applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: true }));

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

    it('adds nothing while the ledger flag is off', () => {
        applyRuntimeConfigPatch({ sentinelTodoLedgerEnabled: false });
        const { result } = renderHook(() => useUnifiedPanelTabs('ws-1', 'chat-a'));
        act(() => { startSentinelTodoExcursion(ORIGIN); visitSentinelTodoExcursionChat(stop('chat-a')); });
        expect(result.current.pinnedId).toBeNull();
        expect(result.current.tabs).toEqual([]);
    });
});

describe('UnifiedTodoTab links and remembered view', () => {
    async function renderOrigin() {
        publishSentinelTodoChat('ws-1', 'chat-s', { ownerWorkspaceId: 'ws-1', processId: OWNER.processId, title: 'Release coordination' });
        const view = render(<UnifiedTodoTab owner={OWNER} scopeWorkspaceId="ws-1" chatId="chat-s" />);
        return { ...view, link: await screen.findByRole('link', { name: 'Spike notes' }) };
    }

    it('starts an excursion from a plain click on an in-app link, naming the origin Sentinel', async () => {
        const { link } = await renderOrigin();
        fireEvent.click(link, { button: 0 });
        expect(getSentinelTodoExcursion()).toEqual({
            origin: { ...ORIGIN, linkKey: 'i1|ref:chat-a' },
            trail: [],
        });
    });

    it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])('leaves modified clicks (%o) to the browser', async init => {
        const { link } = await renderOrigin();
        fireEvent.click(link, init);
        expect(getSentinelTodoExcursion()).toBeNull();
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
        fireEvent.click(await screen.findByRole('link', { name: 'Spike notes' }));
        expect(getSentinelTodoExcursion()).toBeNull();
    });

    it('restores expanded rows and scroll per owner, and focuses the followed link after Back', async () => {
        const first = await renderOrigin();
        fireEvent.click(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { expanded: false }));
        const scroller = screen.getByTestId('sentinel-todo-tab');
        scroller.scrollTop = 120;
        fireEvent.scroll(scroller);
        fireEvent.click(first.link);
        first.unmount();
        expect(recallSentinelTodoView(OWNER)).toMatchObject({ scrollTop: 120, expandedIds: ['i1'] });

        returnFromSentinelTodoExcursion();
        const second = await renderOrigin();
        expect(within(screen.getByTestId('sentinel-todo-row-i1')).getByRole('button', { expanded: true })).toBeTruthy();
        expect(screen.getByTestId('sentinel-todo-tab').scrollTop).toBe(120);
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
