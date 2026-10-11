import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SeenStateEntry, RepoGroupChatFeedResponse } from '@plusplusoneplusplus/coc-client';
import { useUnseenChat } from '../../../../src/server/spa/client/react/features/chat/hooks/useUnseenChat';
import { patchSeenState } from '../../../../src/server/spa/client/react/hooks/preferences/seenStateApi';
import { WorkspaceOwnerContext } from '../../../../src/server/spa/client/react/repos/workspaceOwnerContext';
import { resetRepoGroupChatFeedCacheForTests, useRepoGroupChatFeed } from '../../../../src/server/spa/client/react/repos/useRepoGroupChatFeed';
import { getCocClientFor } from '../../../../src/server/spa/client/react/api/cocClient';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const mocks = vi.hoisted(() => ({ getRepoGroupChats: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => mocks);

const completedAt = '2026-05-02T00:00:00.000Z';
const history = [{ id: 'proc', status: 'completed', completedAt }];
const maps = new Map<string | undefined, Record<string, string>>();

function ownerWrapper(baseUrl?: string) {
    return ({ children }: { children: ReactNode }) => (
        <WorkspaceOwnerContext.Provider value={{ workspaceId: 'ws', selectionId: baseUrl ? 'remote:owner:ws' : 'ws', baseUrl }}>
            {children}
        </WorkspaceOwnerContext.Provider>
    );
}

function feed(baseUrl?: string) {
    return useRepoGroupChatFeed({
        groupId: 'group', serverKey: baseUrl ?? 'local', baseUrl, enabled: true, pageSize: 1,
    });
}

beforeEach(() => {
    resetRepoGroupChatFeedCacheForTests();
    localStorage.clear();
    registerCloneBaseUrls([{ workspaceId: 'ws', serverId: 'other', baseUrl: 'https://other.test' }]);
    maps.clear();
    for (const baseUrl of [undefined, 'https://owner.test', 'https://other.test']) {
        maps.set(baseUrl, { seed: completedAt });
        const domain = getCocClientFor(baseUrl).seenState;
        vi.spyOn(domain, 'getMap').mockImplementation(async () => ({ ...maps.get(baseUrl) }));
        vi.spyOn(domain, 'updateMany').mockImplementation(async (_workspaceId, entries: SeenStateEntry[]) => {
            const map = maps.get(baseUrl)!;
            for (const entry of entries) map[entry.processId] = entry.seenAt;
            return { ...map };
        });
        vi.spyOn(domain, 'markUnseen').mockImplementation(async (_workspaceId, processId) => {
            delete maps.get(baseUrl)![processId];
            return { ok: true };
        });
    }
    mocks.getRepoGroupChats.mockImplementation(async (_groupId, _query, baseUrl?: string): Promise<RepoGroupChatFeedResponse> => ({
        groupId: 'group', membershipKey: 'm1',
        sources: [{ workspaceId: 'group', role: 'group', available: true }, { workspaceId: 'ws', role: 'member', available: true }],
        running: [], queued: [], history: [], hasMore: false,
        counts: { total: 1, running: 0, queued: 0, history: 1, byOwner: { ws: 1 }, partial: false,
            unread: maps.get(baseUrl)?.proc === completedAt ? 0 : 1 },
    }));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetCloneRegistryForTests();
});

describe('successful concrete-owner read-state reconciliation', () => {
    it.each([undefined, 'https://owner.test'])('native navigation reconciles its aggregate and other native readers for %s', async baseUrl => {
        const native = renderHook(({ selected }) => useUnseenChat('ws', history, selected), {
            wrapper: ownerWrapper(baseUrl), initialProps: { selected: null as string | null },
        });
        const otherNative = renderHook(() => useUnseenChat('ws', history, null), { wrapper: ownerWrapper(baseUrl) });
        const aggregate = renderHook(() => feed(baseUrl));
        const wrongServer = renderHook(() => feed('https://other.test'));
        const wrongNative = renderHook(() => useUnseenChat('ws', history, null), { wrapper: ownerWrapper('https://other.test') });
        await waitFor(() => expect(aggregate.result.current.model?.counts.unread).toBe(1));
        await waitFor(() => expect(native.result.current.unseenCount).toBe(1));
        await waitFor(() => expect(otherNative.result.current.unseenCount).toBe(1));
        await waitFor(() => expect(wrongServer.result.current.model?.counts.unread).toBe(1));
        const initialReads = mocks.getRepoGroupChats.mock.calls.length;

        native.rerender({ selected: 'proc' });
        await waitFor(() => expect(maps.get(baseUrl)?.proc).toBe(completedAt));
        await waitFor(() => expect(aggregate.result.current.model?.counts.unread).toBe(0));
        expect(native.result.current.unseenCount).toBe(0);
        expect(otherNative.result.current.unseenCount).toBe(0);
        expect(wrongNative.result.current.unseenCount).toBe(1);
        expect(wrongServer.result.current.model?.counts.unread).toBe(1);
        expect(mocks.getRepoGroupChats).toHaveBeenCalledTimes(initialReads + 1);

        act(() => { native.result.current.markUnseen('proc'); });
        await waitFor(() => expect(aggregate.result.current.model?.counts.unread).toBe(1));
        expect(maps.get(baseUrl)?.proc).toBeUndefined();
        expect(otherNative.result.current.unseenCount).toBe(1);
        expect(wrongServer.result.current.model?.counts.unread).toBe(1);
    });

    it('group detail reads update mounted native rows, including deletion of the final seen entry', async () => {
        maps.set('https://owner.test', { proc: completedAt });
        const native = renderHook(() => useUnseenChat('ws', history, null), { wrapper: ownerWrapper('https://owner.test') });
        const aggregate = renderHook(() => feed('https://owner.test'));
        await waitFor(() => expect(native.result.current.unseenCount).toBe(0));
        await waitFor(() => expect(aggregate.result.current.model?.counts.unread).toBe(0));
        act(() => { native.result.current.markUnseen('proc'); });
        await waitFor(() => expect(aggregate.result.current.model?.counts.unread).toBe(1));
        expect(native.result.current.unseenCount).toBe(1);
        expect(maps.get('https://owner.test')).toEqual({});
        await act(async () => {
            await patchSeenState('ws', [{ processId: 'proc', seenAt: completedAt }], { baseUrl: 'https://owner.test' });
        });
        await waitFor(() => expect(aggregate.result.current.model?.counts.unread).toBe(0));
        expect(native.result.current.unseenCount).toBe(0);
    });

    it('does not reconcile an aggregate as read before a failed native write', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const native = renderHook(() => useUnseenChat('ws', history, null), { wrapper: ownerWrapper('https://owner.test') });
        const aggregate = renderHook(() => feed('https://owner.test'));
        await waitFor(() => expect(aggregate.result.current.model?.counts.unread).toBe(1));
        await waitFor(() => expect(native.result.current.unseenCount).toBe(1));
        vi.mocked(getCocClientFor('https://owner.test').seenState.updateMany).mockRejectedValueOnce(new Error('offline'));
        act(() => { native.result.current.markSeen('proc'); });
        await waitFor(() => expect(warning).toHaveBeenCalled());
        expect(maps.get('https://owner.test')?.proc).toBeUndefined();
        expect(aggregate.result.current.model?.counts.unread).toBe(1);
        expect(mocks.getRepoGroupChats).toHaveBeenCalledTimes(1);
    });
});
