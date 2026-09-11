// @vitest-environment jsdom
/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentProvidersQuota, AGENT_PROVIDER_QUOTA_POLL_MS } from '../../../../src/server/spa/client/react/shared/useAgentProvidersQuota';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const mocks = vi.hoisted(() => ({
    localQuota: vi.fn(),
    remoteQuota: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        admin: {
            getAgentProvidersQuota: mocks.localQuota,
        },
    }),
    getCocClientFor: (baseUrl: string) => ({
        admin: {
            getAgentProvidersQuota: (options?: { force?: boolean }) => mocks.remoteQuota(baseUrl, options),
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

const QUOTA_RESPONSE: AgentProvidersQuotaResponse = {
    lastUpdated: '2026-06-06T10:00:00.000Z',
    providers: [
        {
            id: 'copilot',
            quotaTypes: [{
                type: 'chat',
                isUnlimitedEntitlement: false,
                usedRequests: 20,
                entitlementRequests: 100,
                remainingPercentage: 0.8,
                usageAllowedWithExhaustedQuota: false,
                overage: 0,
            }],
        },
    ],
};

const REMOTE_QUOTA_RESPONSE: AgentProvidersQuotaResponse = {
    ...QUOTA_RESPONSE,
    lastUpdated: '2026-06-06T11:00:00.000Z',
};

function deferredQuota() {
    let resolve!: (data: AgentProvidersQuotaResponse) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<AgentProvidersQuotaResponse>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('useAgentProvidersQuota', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mocks.localQuota.mockReset();
        mocks.remoteQuota.mockReset();
        resetCloneRegistryForTests();
    });

    afterEach(() => {
        resetCloneRegistryForTests();
        vi.useRealTimers();
    });

    it('uses the page-origin client for a local workspace', async () => {
        mocks.localQuota.mockResolvedValue(QUOTA_RESPONSE);

        const { result } = renderHook(() => useAgentProvidersQuota('ws-local'));

        expect(result.current.loading).toBe(true);
        expect(result.current.quotaData).toBeNull();

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.quotaData).toEqual(QUOTA_RESPONSE);
        expect(result.current.error).toBeNull();
        expect(mocks.localQuota).toHaveBeenCalledWith(undefined);
        expect(mocks.remoteQuota).not.toHaveBeenCalled();
    });

    it('uses the registered remote client for a remote repo or repo group', async () => {
        const repoKey = buildRemoteCloneKey('srv-1', 'ws-remote');
        const groupKey = buildRemoteCloneKey('srv-1', 'repo-group-team');
        registerCloneBaseUrls([
            { workspaceId: 'ws-remote', cloneKey: repoKey, baseUrl: 'http://remote.test' },
            { workspaceId: 'repo-group-team', cloneKey: groupKey, baseUrl: 'http://remote.test' },
        ]);
        mocks.remoteQuota.mockResolvedValue(REMOTE_QUOTA_RESPONSE);

        const repo = renderHook(({ target }) => useAgentProvidersQuota(target), {
            initialProps: { target: repoKey },
        });
        await waitFor(() => expect(repo.result.current.quotaData).toEqual(REMOTE_QUOTA_RESPONSE));
        expect(mocks.remoteQuota).toHaveBeenCalledWith('http://remote.test', undefined);
        repo.unmount();

        mocks.remoteQuota.mockClear();
        const group = renderHook(() => useAgentProvidersQuota(groupKey));
        await waitFor(() => expect(group.result.current.quotaData).toEqual(REMOTE_QUOTA_RESPONSE));
        expect(mocks.remoteQuota).toHaveBeenCalledWith('http://remote.test', undefined);
        expect(mocks.localQuota).not.toHaveBeenCalled();
        group.unmount();
    });

    it('transitions to refreshing (not loading) on subsequent fetches', async () => {
        mocks.localQuota.mockResolvedValue(QUOTA_RESPONSE);

        const { result } = renderHook(() => useAgentProvidersQuota());
        await waitFor(() => expect(result.current.loading).toBe(false));

        // Manual refresh while data is present → refreshing, not loading
        let refreshPromise!: Promise<void>;
        act(() => {
            refreshPromise = result.current.refresh();
        });
        expect(result.current.refreshing).toBe(true);
        expect(result.current.loading).toBe(false);

        await act(async () => { await refreshPromise; });
        expect(result.current.refreshing).toBe(false);
    });

    it('passes force:true when requested', async () => {
        const remoteKey = buildRemoteCloneKey('srv-1', 'ws-remote');
        registerCloneBaseUrls([{
            workspaceId: 'ws-remote',
            cloneKey: remoteKey,
            baseUrl: 'http://remote.test',
        }]);
        mocks.remoteQuota.mockResolvedValue(REMOTE_QUOTA_RESPONSE);

        const { result } = renderHook(() => useAgentProvidersQuota(remoteKey));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(() => result.current.refresh({ force: true }));
        expect(mocks.remoteQuota).toHaveBeenLastCalledWith('http://remote.test', { force: true });
        expect(mocks.localQuota).not.toHaveBeenCalled();
    });

    it('keeps automatic polling on the selected remote server', async () => {
        const remoteKey = buildRemoteCloneKey('srv-1', 'ws-remote');
        registerCloneBaseUrls([{
            workspaceId: 'ws-remote',
            cloneKey: remoteKey,
            baseUrl: 'http://remote.test',
        }]);
        mocks.remoteQuota.mockResolvedValue(REMOTE_QUOTA_RESPONSE);

        const { result } = renderHook(() => useAgentProvidersQuota(remoteKey));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const callsBefore = mocks.remoteQuota.mock.calls.length;
        act(() => { vi.advanceTimersByTime(AGENT_PROVIDER_QUOTA_POLL_MS); });
        await waitFor(() => expect(mocks.remoteQuota.mock.calls.length).toBeGreaterThan(callsBefore));
        expect(mocks.remoteQuota).toHaveBeenLastCalledWith('http://remote.test', undefined);
        expect(mocks.localQuota).not.toHaveBeenCalled();
    });

    it('sets error and clears quotaData on initial fetch failure', async () => {
        mocks.localQuota.mockRejectedValue(new Error('network error'));

        const { result } = renderHook(() => useAgentProvidersQuota());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe('network error');
        expect(result.current.quotaData).toBeNull();
    });

    it('keeps stale quotaData and sets error on refresh failure', async () => {
        mocks.localQuota
            .mockResolvedValueOnce(QUOTA_RESPONSE)
            .mockRejectedValueOnce(new Error('refresh failed'));

        const { result } = renderHook(() => useAgentProvidersQuota());
        await waitFor(() => expect(result.current.quotaData).toEqual(QUOTA_RESPONSE));

        await act(() => result.current.refresh());
        expect(result.current.error).toBe('refresh failed');
        expect(result.current.quotaData).toEqual(QUOTA_RESPONSE);
    });

    it('does not update state after unmount', async () => {
        let resolve!: (data: AgentProvidersQuotaResponse) => void;
        mocks.localQuota.mockReturnValue(new Promise(r => { resolve = r; }));

        const { result, unmount } = renderHook(() => useAgentProvidersQuota());
        expect(result.current.loading).toBe(true);

        unmount();
        act(() => { resolve(QUOTA_RESPONSE); });

        // After unmount the hook result is frozen — no setState calls should fire
        expect(result.current.quotaData).toBeNull();
    });

    it('does not request local quota while a persisted remote selection is unresolved', async () => {
        const remoteKey = buildRemoteCloneKey('srv-1', 'ws-remote');
        mocks.remoteQuota.mockResolvedValue(REMOTE_QUOTA_RESPONSE);

        const { result } = renderHook(() => useAgentProvidersQuota(remoteKey));

        expect(result.current.quotaData).toBeNull();
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe('Remote server route is unavailable');
        expect(mocks.localQuota).not.toHaveBeenCalled();

        act(() => registerCloneBaseUrls([{
            workspaceId: 'ws-remote',
            cloneKey: remoteKey,
            baseUrl: 'http://remote.test',
        }]));
        await waitFor(() => expect(result.current.quotaData).toEqual(REMOTE_QUOTA_RESPONSE));
        expect(mocks.remoteQuota).toHaveBeenCalledWith('http://remote.test', undefined);
        expect(mocks.localQuota).not.toHaveBeenCalled();
    });

    it('resets and reloads quota when switching local to remote to local', async () => {
        const remoteKey = buildRemoteCloneKey('srv-1', 'ws-remote');
        registerCloneBaseUrls([{
            workspaceId: 'ws-remote',
            cloneKey: remoteKey,
            baseUrl: 'http://remote.test',
        }]);
        const remotePending = deferredQuota();
        mocks.localQuota.mockResolvedValue(QUOTA_RESPONSE);
        mocks.remoteQuota.mockReturnValue(remotePending.promise);

        const { result, rerender } = renderHook(({ target }) => useAgentProvidersQuota(target), {
            initialProps: { target: 'ws-local' },
        });
        await waitFor(() => expect(result.current.quotaData).toEqual(QUOTA_RESPONSE));

        rerender({ target: remoteKey });
        expect(result.current.quotaData).toBeNull();
        expect(result.current.loading).toBe(true);
        await act(async () => remotePending.resolve(REMOTE_QUOTA_RESPONSE));
        await waitFor(() => expect(result.current.quotaData).toEqual(REMOTE_QUOTA_RESPONSE));

        rerender({ target: 'ws-local' });
        expect(result.current.quotaData).toBeNull();
        await waitFor(() => expect(result.current.quotaData).toEqual(QUOTA_RESPONSE));
        expect(mocks.localQuota).toHaveBeenCalledTimes(2);
    });

    it('ignores a late response from the previously selected remote server', async () => {
        const remoteA = buildRemoteCloneKey('srv-a', 'ws-shared');
        const remoteB = buildRemoteCloneKey('srv-b', 'ws-shared');
        registerCloneBaseUrls([
            { workspaceId: 'ws-shared', cloneKey: remoteA, baseUrl: 'http://remote-a.test' },
            { workspaceId: 'ws-shared', cloneKey: remoteB, baseUrl: 'http://remote-b.test' },
        ]);
        const pendingA = deferredQuota();
        mocks.remoteQuota.mockImplementation((baseUrl: string) =>
            baseUrl === 'http://remote-a.test'
                ? pendingA.promise
                : Promise.resolve(REMOTE_QUOTA_RESPONSE));

        const { result, rerender } = renderHook(({ target }) => useAgentProvidersQuota(target), {
            initialProps: { target: remoteA },
        });
        rerender({ target: remoteB });
        await waitFor(() => expect(result.current.quotaData).toEqual(REMOTE_QUOTA_RESPONSE));

        await act(async () => pendingA.resolve(QUOTA_RESPONSE));
        expect(result.current.quotaData).toEqual(REMOTE_QUOTA_RESPONSE);
        expect(mocks.localQuota).not.toHaveBeenCalled();
    });

    it('reloads from a changed remote endpoint after topology refresh', async () => {
        const remoteKey = buildRemoteCloneKey('srv-1', 'ws-remote');
        registerCloneBaseUrls([{
            workspaceId: 'ws-remote',
            cloneKey: remoteKey,
            baseUrl: 'http://remote-old.test',
        }]);
        mocks.remoteQuota.mockImplementation((baseUrl: string) => Promise.resolve(
            baseUrl === 'http://remote-old.test' ? QUOTA_RESPONSE : REMOTE_QUOTA_RESPONSE,
        ));
        const { result } = renderHook(() => useAgentProvidersQuota(remoteKey));
        await waitFor(() => expect(result.current.quotaData).toEqual(QUOTA_RESPONSE));

        act(() => registerCloneBaseUrls([{
            workspaceId: 'ws-remote',
            cloneKey: remoteKey,
            baseUrl: 'http://remote-new.test',
        }]));
        expect(result.current.quotaData).toBeNull();
        await waitFor(() => expect(result.current.quotaData).toEqual(REMOTE_QUOTA_RESPONSE));
        expect(mocks.remoteQuota).toHaveBeenLastCalledWith('http://remote-new.test', undefined);
    });
});
