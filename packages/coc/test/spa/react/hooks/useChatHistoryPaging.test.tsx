/* @vitest-environment jsdom */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { PAGE_TURNS } from '@plusplusoneplusplus/forge/history-paging';
import { useChatHistoryPaging } from '../../../../src/server/spa/client/react/features/chat/hooks/useChatHistoryPaging';
import { ConversationArea } from '../../../../src/server/spa/client/react/features/chat/ConversationArea';
import type { ClientConversationTurn } from '../../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useMessageNavigation', () => ({
    useMessageNavigation: () => ({ currentTurnIndex: null, navHintVisible: false }),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn, turnIndex }: any) => <div data-turn-index={turnIndex}>{turn.content}</div>,
}));
vi.mock('../../../../src/server/spa/client/react/queue/PendingTaskInfoPanel', () => ({ PendingTaskInfoPanel: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/chat/QueuedBubble', () => ({ QueuedFollowUps: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/chat/BackgroundTasksIndicator', () => ({ BackgroundTasksIndicator: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/chat/AskUserInline', () => ({ AskUserInline: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/chat/McpOAuthPrompt', () => ({ McpOAuthPrompt: () => null }));
vi.mock('../../../../src/server/spa/client/react/ui', () => ({ Spinner: () => <span aria-label="Loading" /> }));

class Observer {
    static instances: Observer[] = [];
    callback: IntersectionObserverCallback;
    options: IntersectionObserverInit;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
        this.callback = callback;
        this.options = options;
        Observer.instances.push(this);
    }
    intersect(value = true) {
        this.callback([{ isIntersecting: value } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    static get latest() { return Observer.instances.at(-1)!; }
}
function turns(start: number, end: number): ClientConversationTurn[] {
    return Array.from({ length: end - start }, (_, n) => ({ role: (start + n) % 2 ? 'assistant' : 'user', turnIndex: start + n, content: `message-${start + n}`, timeline: [] }));
}
function page(start: number, end: number, revision = 0) {
    return { turns: turns(start, end), oldestTurnIndex: start, hasMore: start > 0, totalTurns: 200, historyRevision: revision };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}
let current: ReturnType<typeof useChatHistoryPaging>;
let cache: ClientConversationTurn[];
let reset: ReturnType<typeof vi.fn>;
let mockClient: CocClient;
let get: ReturnType<typeof vi.fn>;
let list: ReturnType<typeof vi.fn>;
let pinned: ReturnType<typeof vi.fn>;

function Harness({ scope = 'local|chat', client = mockClient, enabled = true, pid = 'chat', workspace = 'workspace' }) {
    const [loaded, setLoaded] = useState<ClientConversationTurn[]>([]);
    const ref = useRef<ClientConversationTurn[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const set = useCallback((next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => {
        const resolved = typeof next === 'function' ? next(ref.current) : next;
        ref.current = resolved;
        setLoaded(resolved);
    }, []);
    current = useChatHistoryPaging({
        enabled, scopeKey: scope, client, workspaceId: workspace, processId: pid,
        turns: loaded, turnsRef: ref, setTurns: set, scrollRef, onReset: reset,
    });
    cache = current.cacheTurns(loaded);
    useEffect(() => {
        set([]);
        void current.readProcess(pid).then(data => set(data.process?.conversationTurns as ClientConversationTurn[] ?? [])).catch(() => {});
    }, [scope, client, enabled, pid, set]);
    return <ConversationArea
        turns={loaded} loading={false} error={null} pendingQueue={[]} isScrolledUp
        scrollRef={scrollRef} onScrollToBottom={() => {}} isPending={false}
        task={{ status: 'completed' }} fullTask={null} onCancel={() => {}} onMoveToTop={() => {}}
        variant="inline" taskId={pid} onPinTurn={() => {}} historyPaging={enabled ? current : undefined}
    />;
}

beforeEach(() => {
    Observer.instances = [];
    vi.stubGlobal('IntersectionObserver', Observer);
    reset = vi.fn();
    get = vi.fn().mockResolvedValue({ process: { conversationTurns: turns(170, 200) }, history: page(170, 200) });
    list = vi.fn().mockResolvedValue(page(140, 170));
    pinned = vi.fn().mockResolvedValue({ turns: [] });
    mockClient = { processes: { get, listTurns: list, pinnedTurns: pinned } } as unknown as CocClient;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        const sc = this.closest('[data-testid="activity-chat-conversation"]') as HTMLElement | null;
        const nodes = sc ? Array.from(sc.querySelectorAll('[data-turn-index]:not([data-pinned-section] *)')) : [];
        const index = nodes.indexOf(this);
        const top = index < 0 ? 0 : index * 80 - (sc?.scrollTop ?? 0);
        return { top, bottom: top + 80, height: 80, width: 500, x: 0, y: top, left: 0, right: 500, toJSON() {} } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
        return this.querySelectorAll('[data-turn-index]:not([data-pinned-section] *)').length * 80;
    });
    HTMLElement.prototype.scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function mount(props = {}) {
    const view = render(<Harness {...props} />);
    await waitFor(() => expect(screen.getByText('message-199')).toBeTruthy());
    return view;
}
describe('owner-scoped conversation history paging', () => {
    it('requests the shared latest page and pins from the owning workspace', async () => {
        await mount();
        expect(get).toHaveBeenCalledWith('chat', { workspace: 'workspace', turnsLimit: PAGE_TURNS }, { signal: expect.any(AbortSignal) });
        expect(pinned).toHaveBeenCalledWith('chat', { workspace: 'workspace' }, { signal: expect.any(AbortSignal) });
        expect(Observer.latest.options.root).toBe(screen.getByTestId('activity-chat-conversation'));
        expect(Observer.latest.options.rootMargin).toBe('600px 0px 0px 0px');
    });
    it('bounds cached live appends to the latest paired page', async () => {
        await mount();
        expect(current.cacheTurns(turns(140, 201))).toHaveLength(31);
        expect(current.cacheTurns(turns(140, 201))[0].turnIndex).toBe(170);
        expect(current.cacheTurns(turns(140, 202))).toHaveLength(30);
        expect(current.cacheTurns(turns(140, 202))[0].turnIndex).toBe(172);
    });
    it('deduplicates concurrent intersections and prepends without duplicates while restoring the visible offset', async () => {
        await mount();
        const pending = deferred<ReturnType<typeof page>>();
        list.mockReturnValueOnce(pending.promise);
        const sc = screen.getByTestId('activity-chat-conversation');
        sc.scrollTop = 190;
        const anchor = sc.querySelector('[data-turn-index="172"]')!;
        const offset = anchor.getBoundingClientRect().top;
        act(() => { Observer.latest.intersect(); Observer.latest.intersect(); Observer.latest.intersect(); });
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
        expect(screen.getByText('Loading earlier messages...')).toBeTruthy();
        await act(async () => pending.resolve({ ...page(140, 170), turns: [...turns(140, 170), ...turns(170, 171)] }));
        expect(sc.querySelectorAll('[data-turn-index]')).toHaveLength(60);
        expect(anchor.getBoundingClientRect().top).toBe(offset);
        expect(cache).toHaveLength(PAGE_TURNS);
        expect(cache[0].turnIndex).toBe(170);
        expect(screen.queryByRole('button', { name: /earlier/i })).toBeNull();
    });
    it('preserves streaming bottom following when a page is prepended', async () => {
        await mount();
        const sc = screen.getByTestId('activity-chat-conversation');
        sc.scrollTop = sc.scrollHeight - sc.clientHeight;
        await act(async () => { Observer.latest.intersect(); });
        expect(sc.scrollTop).toBe(sc.scrollHeight);
    });
    it('renders start of conversation and stops reading after the final page', async () => {
        await mount();
        list.mockResolvedValueOnce(page(0, 170));
        const observer = Observer.latest;
        await act(async () => observer.intersect());
        expect(screen.getByText('Start of conversation')).toBeTruthy();
        await act(async () => observer.intersect());
        expect(list).toHaveBeenCalledTimes(1);
        expect(observer.disconnect).toHaveBeenCalled();
    });
    it('retries at 1/2/4 seconds, caps at 30 seconds and recovers without a button', async () => {
        await mount();
        vi.useFakeTimers();
        list.mockRejectedValue(new Error('offline'));
        await act(async () => Observer.latest.intersect());
        expect(screen.getByText(/Couldn't load earlier/)).toBeTruthy();
        for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
            const count = list.mock.calls.length;
            await act(async () => { vi.advanceTimersByTime(delay - 1); });
            expect(list).toHaveBeenCalledTimes(count);
            await act(async () => { vi.advanceTimersByTime(1); });
            expect(list).toHaveBeenCalledTimes(count + 1);
        }
        list.mockResolvedValue(page(140, 170));
        await act(async () => { vi.advanceTimersByTime(30000); });
        expect(screen.queryByText(/Couldn't load earlier/)).toBeNull();
        expect(screen.getByText('message-140')).toBeTruthy();
    });
    it('reintersection retries immediately and leaving the top stops timer retries', async () => {
        await mount();
        vi.useFakeTimers();
        list.mockRejectedValueOnce(new Error('offline'));
        await act(async () => Observer.latest.intersect());
        act(() => Observer.latest.intersect(false));
        await act(async () => vi.advanceTimersByTime(1000));
        expect(list).toHaveBeenCalledTimes(1);
        await act(async () => Observer.latest.intersect());
        expect(list).toHaveBeenCalledTimes(2);
        expect(screen.getByText('message-140')).toBeTruthy();
    });
    it('load-through sequentially fills every page before scrolling and highlighting turn 5', async () => {
        await mount();
        vi.useFakeTimers();
        list.mockImplementation((_id, options) => Promise.resolve(page(Math.max(0, options.beforeTurnIndex - PAGE_TURNS), options.beforeTurnIndex)));
        await act(async () => { void current.navigateToTurn(5); });
        expect(list.mock.calls.map(call => call[1].beforeTurnIndex)).toEqual([170, 140, 110, 80, 50, 20]);
        await act(async () => vi.advanceTimersByTime(20));
        const target = document.querySelector('[data-turn-index="5"]')!;
        expect(target.classList.contains('minimap-highlight-pulse')).toBe(true);
        expect(document.querySelectorAll('[data-turn-index]')).toHaveLength(200);
        expect(screen.queryByTestId('history-jump-placeholder')).toBeNull();
    });
    it('shows a load-through placeholder, aborts on owner/chat switches and ignores late pages', async () => {
        const view = await mount();
        const pending = deferred<ReturnType<typeof page>>();
        list.mockReturnValueOnce(pending.promise);
        await act(async () => { void current.navigateToTurn(5); });
        expect(screen.getByText('Loading turn #5...')).toBeTruthy();
        const signal = list.mock.calls[0][2].signal;
        const otherGet = vi.fn().mockResolvedValue({ process: { conversationTurns: turns(170, 200) }, history: page(170, 200) });
        const otherList = vi.fn();
        const remote = { processes: { get: otherGet, listTurns: otherList, pinnedTurns: pinned } } as unknown as CocClient;
        view.rerender(<Harness scope="remote|other" client={remote} pid="other" />);
        await waitFor(() => expect(otherGet).toHaveBeenCalled());
        expect(signal.aborted).toBe(true);
        await act(async () => pending.resolve(page(140, 170)));
        expect(screen.queryByText('message-140')).toBeNull();
        expect(otherList).not.toHaveBeenCalled();
        expect(list).toHaveBeenCalledTimes(1);
    });
    it('aborts and ignores a late initial process read after an owner switch', async () => {
        const pending = deferred<any>();
        get.mockReturnValueOnce(pending.promise);
        const view = render(<Harness />);
        const signal = get.mock.calls[0][2].signal;
        view.rerender(<Harness scope="remote|new-chat" pid="new-chat" />);
        await waitFor(() => expect(screen.getByText('message-199')).toBeTruthy());
        expect(signal.aborted).toBe(true);
        await act(async () => pending.resolve({ process: { conversationTurns: turns(0, 30) }, history: page(0, 30) }));
        expect(screen.queryByText('message-0')).toBeNull();
        expect(current.history?.oldestTurnIndex).toBe(170);
    });
    it('same-revision reconnect replaces only the tail and a revision reset drops all older history', async () => {
        await mount();
        await act(async () => Observer.latest.intersect());
        get.mockResolvedValueOnce({ process: { conversationTurns: [{ ...turns(170, 171)[0], content: 'replaced' }, ...turns(171, 200)] }, history: page(170, 200) });
        await act(async () => {
            const data = await current.readProcess('chat');
            // SSE and REST use the same merger.
            const merged = data.process!.conversationTurns!;
            expect(merged).toHaveLength(60);
            expect(merged[0].turnIndex).toBe(140);
            expect(merged[30].content).toBe('replaced');
        });
        const pending = deferred<ReturnType<typeof page>>();
        list.mockReturnValueOnce(pending.promise);
        await act(async () => Observer.latest.intersect());
        get.mockResolvedValueOnce({ process: { conversationTurns: turns(170, 200) }, history: page(170, 200, 1) });
        await act(async () => {
            const data = await current.readProcess('chat');
            expect(data.process!.conversationTurns).toHaveLength(30);
        });
        expect(reset).toHaveBeenCalledTimes(1);
        expect(list.mock.calls[1][2].signal.aborted).toBe(true);
        await act(async () => pending.resolve(page(110, 140)));
        expect(screen.queryByText('message-110')).toBeNull();
    });
    it('unloaded pins stay discoverable and navigate through their missing pages', async () => {
        pinned.mockResolvedValue({ turns: [{ ...turns(5, 6)[0], pinnedAt: '2026-01-01T00:00:00Z' }] });
        await mount();
        await waitFor(() => expect(screen.getByText('message-5')).toBeTruthy());
        list.mockImplementation((_id, options) => Promise.resolve(page(Math.max(0, options.beforeTurnIndex - PAGE_TURNS), options.beforeTurnIndex)));
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Go to turn #5' })));
        expect(list).toHaveBeenCalledTimes(6);
    });
    it('flag off preserves full hydration and never probes pages or pins', async () => {
        get.mockResolvedValue({ process: { conversationTurns: turns(0, 200) } });
        await mount({ enabled: false });
        expect(get).toHaveBeenCalledWith('chat', { workspace: 'workspace' });
        expect(list).not.toHaveBeenCalled();
        expect(pinned).not.toHaveBeenCalled();
        expect(Observer.instances).toHaveLength(0);
        expect(cache).toHaveLength(200);
        expect(screen.queryByTestId('history-status')).toBeNull();
    });
    it('empty and non-advancing pages stop safely instead of looping', async () => {
        await mount();
        list.mockResolvedValueOnce({ ...page(170, 170), turns: [], hasMore: true });
        await act(async () => { void current.navigateToTurn(5); });
        expect(list).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Start of conversation')).toBeTruthy();
        expect(screen.queryByTestId('history-jump-placeholder')).toBeNull();
    });
});
