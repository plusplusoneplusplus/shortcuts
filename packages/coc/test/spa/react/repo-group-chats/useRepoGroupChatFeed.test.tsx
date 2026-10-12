/**
 * @vitest-environment jsdom
 *
 * useRepoGroupChatFeed — owning-server reads, stale-response rejection, cursor
 * pagination with stale-cursor restart, and live refresh from the owning
 * server's socket only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { RepoGroupChatFeedResponse } from '@plusplusoneplusplus/coc-client';

const { getRepoGroupChats } = vi.hoisted(() => ({ getRepoGroupChats: vi.fn() }));

vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroupChats,
}));

import { QueueProvider, useQueue } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import {
    REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS,
    useRepoGroupChatFeed,
    resetRepoGroupChatFeedCacheForTests,
} from '../../../../src/server/spa/client/react/repos/useRepoGroupChatFeed';

const sources = [
    { workspaceId: 'grp', role: 'group' as const, available: true },
    { workspaceId: 'ws-a', role: 'member' as const, name: 'alpha', available: true },
];

function page(overrides: Partial<RepoGroupChatFeedResponse> = {}): RepoGroupChatFeedResponse {
    return {
        groupId: 'grp',
        membershipKey: 'm1',
        sources,
        running: [],
        queued: [],
        history: [],
        hasMore: false,
        counts: { total: 0, running: 0, queued: 0, history: 0, byOwner: {}, partial: false },
        ...overrides,
    } as RepoGroupChatFeedResponse;
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.clearAllMocks();
    resetRepoGroupChatFeedCacheForTests();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useRepoGroupChatFeed', () => {
    it('loads older active search matches on later pages without inserting ahead of the loaded prefix', async () => {
        getRepoGroupChats.mockResolvedValueOnce(page({
            history: [{ id: 'newest', ownerWorkspaceId: 'ws-a', lastActivityAt: 30 }],
            hasMore: true, nextCursor: 'c1',
        })).mockResolvedValueOnce(page({
            history: [{ id: 'middle', ownerWorkspaceId: 'ws-a', lastActivityAt: 20 }],
            hasMore: true, nextCursor: 'c2',
        })).mockResolvedValueOnce(page({
            running: [{ id: 'task', processId: 'old-active', queueTaskId: 'task', ownerWorkspaceId: 'ws-a', lastActivityAt: 10 }],
            hasMore: true, nextCursor: 'c3',
        })).mockResolvedValueOnce(page({
            queued: [{ id: 'old-queued', processId: 'old-queued', ownerWorkspaceId: 'ws-a', lastActivityAt: 5 }],
        }));
        const { result } = renderHook(() => useRepoGroupChatFeed({
            groupId: 'grp', serverKey: 'local', enabled: true, pageSize: 1, filters: { q: 'cobalt' },
        }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const order = () => [...result.current.model!.history, ...result.current.model!.running, ...result.current.model!.queued]
            .sort((a, b) => b.item.lastActivityAt - a.item.lastActivityAt).map(row => row.canonicalId);
        expect(order()).toEqual(['newest']);
        for (const expected of [['newest', 'middle'], ['newest', 'middle', 'old-active'], ['newest', 'middle', 'old-active', 'old-queued']]) {
            await act(async () => { await result.current.loadMore(); });
            expect(order()).toEqual(expected);
        }
        expect(result.current.model?.running[0].queueTaskId).toBe('task');
        expect(result.current.model?.queued[0].queueTaskId).toBeUndefined();
        expect(result.current.model?.hasMore).toBe(false);
        expect(getRepoGroupChats.mock.calls.map(call => call[1])).toEqual([
            { q: 'cobalt', limit: 1 }, { q: 'cobalt', limit: 1, cursor: 'c1' },
            { q: 'cobalt', limit: 1, cursor: 'c2' }, { q: 'cobalt', limit: 1, cursor: 'c3' },
        ]);
    });

    it('keeps the full list cache independent from a one-row unread badge reader', async () => {
        getRepoGroupChats.mockImplementation(async (_groupId, query) => page({
            history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' },
                ...(query.limit > 1 ? [{ id: 'p2', ownerWorkspaceId: 'ws-a' }] : [])],
        }));
        const list = renderHook(({ ownerAvailable }) => useRepoGroupChatFeed({
            groupId: 'grp', serverKey: 'server-a', baseUrl: 'https://owner.test',
            enabled: true, ownerAvailable,
        }), { initialProps: { ownerAvailable: true } });
        await waitFor(() => expect(list.result.current.model?.history).toHaveLength(2));
        const badge = renderHook(() => useRepoGroupChatFeed({
            groupId: 'grp', serverKey: 'server-a', baseUrl: 'https://owner.test', enabled: true, pageSize: 1,
        }));
        await waitFor(() => expect(badge.result.current.model?.history).toHaveLength(1));
        list.rerender({ ownerAvailable: false });
        expect(list.result.current.model?.history.map(row => row.canonicalId)).toEqual(['p1', 'p2']);
    });

    it('invalidates pending pages on a retained-endpoint offline transition and reconciles on reconnect', async () => {
        const late = deferred<RepoGroupChatFeedResponse>();
        getRepoGroupChats.mockResolvedValueOnce(page({
            history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }],
            hasMore: true, nextCursor: 'c1',
        })).mockReturnValueOnce(late.promise);
        const { result, rerender } = renderHook(
            ({ ownerAvailable }) => useRepoGroupChatFeed({
                groupId: 'grp', serverKey: 'server-a', baseUrl: 'https://owner.test', enabled: true, ownerAvailable,
            }), { initialProps: { ownerAvailable: true } });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        let pending!: Promise<void>;
        act(() => { pending = result.current.loadMore(); });
        const signal = getRepoGroupChats.mock.calls[1][3] as AbortSignal;
        rerender({ ownerAvailable: false });
        expect(signal.aborted).toBe(true);
        expect(result.current.model?.counts.partial).toBe(true);
        expect(result.current.model?.sources.every(source => !source.available)).toBe(true);
        expect(result.current.model?.history.map(row => row.canonicalId)).toEqual(['p1']);
        await act(async () => {
            late.resolve(page({ history: [{ id: 'obsolete', ownerWorkspaceId: 'ws-a' }] }));
            await pending;
            await result.current.refresh();
            await result.current.loadMore();
        });
        expect(getRepoGroupChats).toHaveBeenCalledTimes(2);
        expect(result.current.model?.history.map(row => row.canonicalId)).toEqual(['p1']);
        getRepoGroupChats.mockResolvedValue(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }));
        rerender({ ownerAvailable: true });
        await waitFor(() => expect(result.current.model?.counts.partial).toBe(false));
        expect(result.current.model?.history).toHaveLength(1);
        expect(getRepoGroupChats.mock.calls.every(call => call[2] === 'https://owner.test')).toBe(true);
    });

    it('retains cached history as unavailable after owner disconnect without ever reading locally', async () => {
        getRepoGroupChats.mockResolvedValue(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }));
        const { result, rerender } = renderHook(
            ({ baseUrl }) => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'server-a', baseUrl, enabled: true }),
            { initialProps: { baseUrl: 'https://owner.test' as string | undefined } });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const calls = getRepoGroupChats.mock.calls.length;
        rerender({ baseUrl: undefined });
        await waitFor(() => expect(result.current.model?.counts.partial).toBe(true));
        expect(result.current.model?.history[0].canonicalId).toBe('p1');
        expect(result.current.model?.sources.every(source => !source.available)).toBe(true);
        expect(getRepoGroupChats).toHaveBeenCalledTimes(calls);
        rerender({ baseUrl: 'https://owner.test' });
        await waitFor(() => expect(result.current.model?.counts.partial).toBe(false));
        expect(result.current.model?.history).toHaveLength(1);
    });

    it('drops removed members but keeps cached rows only for still registered unavailable sources', async () => {
        getRepoGroupChats.mockResolvedValue(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        getRepoGroupChats.mockResolvedValue(page({ sources: [
            sources[0], { ...sources[1], available: false },
        ], counts: { total: 0, running: 0, queued: 0, history: 0, byOwner: {}, partial: true } }));
        await act(async () => { await result.current.refresh(); });
        expect(result.current.model?.history).toHaveLength(1);
        getRepoGroupChats.mockResolvedValue(page({ membershipKey: 'm2', sources: [sources[0]] }));
        await act(async () => { await result.current.refresh(); });
        expect(result.current.model?.history).toHaveLength(0);
        expect(result.current.model?.counts.total).toBe(0);
    });

    it('refreshes membership and local reconnect using the current query', async () => {
        getRepoGroupChats.mockResolvedValue(page());
        renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(getRepoGroupChats).toHaveBeenCalledTimes(1));
        act(() => window.dispatchEvent(new CustomEvent('coc-local-ws-connect', { detail: {} })));
        await waitFor(() => expect(getRepoGroupChats).toHaveBeenCalledTimes(2));
        act(() => window.dispatchEvent(new CustomEvent('coc-local-ws-message', {
            detail: { type: 'workspace-topology-changed', workspaceId: 'grp', action: 'updated' },
        })));
        await waitFor(() => expect(getRepoGroupChats).toHaveBeenCalledTimes(3));
    });

    it('reads the local group from the local server', async () => {
        getRepoGroupChats.mockResolvedValue(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(getRepoGroupChats).toHaveBeenCalledWith('grp', { limit: 50 }, undefined, expect.any(AbortSignal));
        expect(result.current.model!.history[0].key).toBe('local|ws-a|p1');
    });

    it('reads a remote-hosted group from its own server and keys rows by that server', async () => {
        getRepoGroupChats.mockResolvedValue(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }));
        const { result } = renderHook(() => useRepoGroupChatFeed({
            groupId: 'grp', baseUrl: 'http://remote:4000', serverKey: 'srv-2', enabled: true,
        }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(getRepoGroupChats.mock.calls[0][2]).toBe('http://remote:4000');
        expect(result.current.model!.history[0].key).toBe('srv-2|ws-a|p1');
    });

    it('does nothing while disabled', () => {
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: false }));
        expect(getRepoGroupChats).not.toHaveBeenCalled();
        expect(result.current.status).toBe('idle');
        expect(result.current.model).toBeNull();
    });

    it('drops a slow response superseded by a filter change', async () => {
        const slow = deferred<RepoGroupChatFeedResponse>();
        getRepoGroupChats
            .mockReturnValueOnce(slow.promise)
            .mockResolvedValueOnce(page({ history: [{ id: 'archived-1', ownerWorkspaceId: 'ws-a' }] }));
        const { result, rerender } = renderHook(
            ({ archived }) => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true, filters: { archived } }),
            { initialProps: { archived: 'exclude' as 'exclude' | 'only' } },
        );
        rerender({ archived: 'only' });
        await waitFor(() => expect(result.current.model?.history[0]?.canonicalId).toBe('archived-1'));
        await act(async () => { slow.resolve(page({ history: [{ id: 'old', ownerWorkspaceId: 'ws-a' }] })); });
        expect(result.current.model!.history.map(r => r.canonicalId)).toEqual(['archived-1']);
        expect(getRepoGroupChats.mock.calls[1][1]).toEqual({ archived: 'only', limit: 50 });
    });

    it('clears the previous group rows when the group changes', async () => {
        const second = deferred<RepoGroupChatFeedResponse>();
        getRepoGroupChats
            .mockResolvedValueOnce(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }))
            .mockReturnValueOnce(second.promise);
        const { result, rerender } = renderHook(
            ({ groupId }) => useRepoGroupChatFeed({ groupId, serverKey: 'local', enabled: true }),
            { initialProps: { groupId: 'grp' } },
        );
        await waitFor(() => expect(result.current.status).toBe('ready'));
        rerender({ groupId: 'grp-2' });
        await waitFor(() => expect(result.current.model).toBeNull());
        expect(result.current.status).toBe('loading');
    });

    it('does not refetch when an equal filters object is passed again', async () => {
        getRepoGroupChats.mockResolvedValue(page());
        const { result, rerender } = renderHook(
            ({ f }) => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true, filters: f }),
            { initialProps: { f: { owners: ['ws-a', 'grp'] } } },
        );
        await waitFor(() => expect(result.current.status).toBe('ready'));
        rerender({ f: { owners: ['grp', 'ws-a'] } });
        expect(getRepoGroupChats).toHaveBeenCalledTimes(1);
    });

    it('loads more with the cursor and skips duplicates', async () => {
        getRepoGroupChats
            .mockResolvedValueOnce(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }], hasMore: true, nextCursor: 'c1' }))
            .mockResolvedValueOnce(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }, { id: 'p2', ownerWorkspaceId: 'grp' }] }));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        await act(async () => { await result.current.loadMore(); });
        expect(getRepoGroupChats.mock.calls[1][1]).toEqual({ limit: 50, cursor: 'c1' });
        expect(result.current.model!.history.map(r => r.key)).toEqual(['local|ws-a|p1', 'local|grp|p2']);
        expect(result.current.model!.hasMore).toBe(false);
    });

    it('restarts from the first page when the cursor is stale', async () => {
        getRepoGroupChats
            .mockResolvedValueOnce(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }], hasMore: true, nextCursor: 'c1' }))
            .mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409, code: 'STALE_CURSOR' }))
            .mockResolvedValueOnce(page({ membershipKey: 'm2', history: [{ id: 'p9', ownerWorkspaceId: 'ws-a' }] }));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        await act(async () => { await result.current.loadMore(); });
        expect(getRepoGroupChats.mock.calls[2][1]).toEqual({ limit: 50 });
        expect(result.current.model!.membershipKey).toBe('m2');
        expect(result.current.model!.history.map(r => r.canonicalId)).toEqual(['p9']);
    });

    it('restarts when a next page reports a different membership', async () => {
        getRepoGroupChats
            .mockResolvedValueOnce(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }], hasMore: true, nextCursor: 'c1' }))
            .mockResolvedValueOnce(page({ membershipKey: 'm2', history: [{ id: 'p2', ownerWorkspaceId: 'ws-a' }] }))
            .mockResolvedValueOnce(page({ membershipKey: 'm2', history: [{ id: 'p3', ownerWorkspaceId: 'ws-a' }] }));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.model!.history.map(r => r.canonicalId)).toEqual(['p3']);
    });

    it('keeps the last rows when a live refresh fails', async () => {
        getRepoGroupChats
            .mockResolvedValueOnce(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }))
            .mockRejectedValueOnce(new Error('offline'));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        await act(async () => { await result.current.refresh(); });
        expect(result.current.status).toBe('ready');
        expect(result.current.error).toBe('offline');
        expect(result.current.model!.history).toHaveLength(1);
    });

    it('reports an error on a failed cold load', async () => {
        getRepoGroupChats.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.error).toBe('boom');
    });

    it('refreshes at the loaded depth on a local event for a source workspace', async () => {
        getRepoGroupChats
            .mockResolvedValueOnce(page({ history: [{ id: 'p1', ownerWorkspaceId: 'ws-a' }] }))
            .mockResolvedValue(page({ running: [{ id: 't1', processId: 'p1', ownerWorkspaceId: 'ws-a' }] }));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true, pageSize: 10 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        vi.useFakeTimers();
        act(() => {
            window.dispatchEvent(new CustomEvent('coc-local-ws-message', { detail: { type: 'process-updated', process: { id: 'x', workspaceId: 'other' } } }));
            window.dispatchEvent(new CustomEvent('coc-local-ws-message', { detail: { type: 'process-updated', process: { id: 'p1', workspaceId: 'ws-a' } } }));
            window.dispatchEvent(new CustomEvent('coc-local-ws-message', { detail: { type: 'process-added', process: { id: 'p2', workspaceId: 'grp' } } }));
        });
        await act(async () => { vi.advanceTimersByTime(REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS); });
        vi.useRealTimers();
        await waitFor(() => expect(result.current.model!.running).toHaveLength(1));
        // Debounced into one refresh; the transition leaves one row, not two.
        expect(getRepoGroupChats).toHaveBeenCalledTimes(2);
        expect(getRepoGroupChats.mock.calls[1][1]).toEqual({ limit: 10 });
        expect(result.current.model!.history).toHaveLength(0);
    });

    it('listens only to the owning remote server socket, including reconnects', async () => {
        getRepoGroupChats.mockResolvedValue(page());
        const { result } = renderHook(() => useRepoGroupChatFeed({
            groupId: 'grp', baseUrl: 'http://remote:4000', serverKey: 'srv-2', enabled: true,
        }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        vi.useFakeTimers();
        act(() => {
            // Local and other-server events with matching ids are ignored.
            window.dispatchEvent(new CustomEvent('coc-local-ws-message', { detail: { type: 'process-updated', process: { workspaceId: 'ws-a' } } }));
            window.dispatchEvent(new CustomEvent('coc-remote-ws-message', {
                detail: { baseUrl: 'http://other:4000', message: { type: 'queue-updated', queue: { repoId: 'ws-a' } } },
            }));
        });
        await act(async () => { vi.advanceTimersByTime(REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS * 2); });
        expect(getRepoGroupChats).toHaveBeenCalledTimes(1);
        act(() => {
            window.dispatchEvent(new CustomEvent('coc-remote-ws-message', {
                detail: { baseUrl: 'http://remote:4000', message: { type: 'queue-updated', queue: { repoId: 'ws-a' } } },
            }));
        });
        await act(async () => { vi.advanceTimersByTime(REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS); });
        expect(getRepoGroupChats).toHaveBeenCalledTimes(2);
        act(() => {
            window.dispatchEvent(new CustomEvent('coc-remote-ws-connect', { detail: { baseUrl: 'http://remote:4000' } }));
        });
        await act(async () => { vi.advanceTimersByTime(REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS); });
        expect(getRepoGroupChats).toHaveBeenCalledTimes(3);
        for (const call of getRepoGroupChats.mock.calls) expect(call[2]).toBe('http://remote:4000');
    });

    it('refreshes a local group when a source workspace queue changes, but not other repos', async () => {
        getRepoGroupChats.mockResolvedValue(page());
        const wrapper = ({ children }: { children: ReactNode }) => <QueueProvider>{children}</QueueProvider>;
        const { result } = renderHook(() => ({
            feed: useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }),
            queue: useQueue(),
        }), { wrapper });
        await waitFor(() => expect(result.current.feed.status).toBe('ready'));
        vi.useFakeTimers();
        act(() => {
            result.current.queue.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'unrelated', queue: { running: [{ id: 't0' }], queued: [] } });
        });
        await act(async () => { vi.advanceTimersByTime(REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS); });
        expect(getRepoGroupChats).toHaveBeenCalledTimes(1);
        act(() => {
            result.current.queue.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'ws-a', queue: { running: [], queued: [{ id: 't1' }] } });
        });
        await act(async () => { vi.advanceTimersByTime(REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS); });
        expect(getRepoGroupChats).toHaveBeenCalledTimes(2);
    });
    it('revokes a delayed manual refresh immediately when a newer live event arrives', async () => {
        getRepoGroupChats.mockResolvedValue(page({ history: [{ id: 'current', ownerWorkspaceId: 'ws-a' }] }));
        const { result } = renderHook(() => useRepoGroupChatFeed({ groupId: 'grp', serverKey: 'local', enabled: true }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        let finish!: (value: any) => void;
        getRepoGroupChats.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        let refresh!: Promise<void>;
        act(() => { refresh = result.current.refresh(); });
        vi.useFakeTimers();
        act(() => window.dispatchEvent(new CustomEvent('coc-local-ws-message', {
            detail: { type: 'process-added', process: { id: 'newer', workspaceId: 'ws-a' } },
        })));
        await act(async () => { finish(page({ history: [{ id: 'stale', ownerWorkspaceId: 'ws-a' }] })); await refresh; });
        expect(result.current.model!.history[0].canonicalId).toBe('current');
        getRepoGroupChats.mockResolvedValue(page({ history: [{ id: 'newer', ownerWorkspaceId: 'ws-a' }] }));
        await act(async () => { vi.advanceTimersByTime(REPO_GROUP_CHAT_FEED_REFRESH_DEBOUNCE_MS); });
        expect(result.current.model!.history[0].canonicalId).toBe('newer');
        vi.useRealTimers();
    });

});
