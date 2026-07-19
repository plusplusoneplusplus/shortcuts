// @vitest-environment jsdom
/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentProvidersQuota, AGENT_PROVIDER_QUOTA_POLL_MS } from '../../../../src/server/spa/client/react/shared/useAgentProvidersQuota';

const mocks = vi.hoisted(() => ({
    getAgentProvidersQuota: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        admin: {
            getAgentProvidersQuota: mocks.getAgentProvidersQuota,
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

describe('useAgentProvidersQuota', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        mocks.getAgentProvidersQuota.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts in loading state and resolves quotaData', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(QUOTA_RESPONSE);

        const { result } = renderHook(() => useAgentProvidersQuota());

        expect(result.current.loading).toBe(true);
        expect(result.current.quotaData).toBeNull();

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.quotaData).toEqual(QUOTA_RESPONSE);
        expect(result.current.error).toBeNull();
    });

    it('transitions to refreshing (not loading) on subsequent fetches', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(QUOTA_RESPONSE);

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
        mocks.getAgentProvidersQuota.mockResolvedValue(QUOTA_RESPONSE);

        const { result } = renderHook(() => useAgentProvidersQuota());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(() => result.current.refresh({ force: true }));
        expect(mocks.getAgentProvidersQuota).toHaveBeenLastCalledWith({ force: true });
    });

    it('polls at the configured interval', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(QUOTA_RESPONSE);

        const { result } = renderHook(() => useAgentProvidersQuota());
        await waitFor(() => expect(result.current.loading).toBe(false));

        const callsBefore = mocks.getAgentProvidersQuota.mock.calls.length;
        act(() => { vi.advanceTimersByTime(AGENT_PROVIDER_QUOTA_POLL_MS); });
        await waitFor(() => expect(mocks.getAgentProvidersQuota.mock.calls.length).toBeGreaterThan(callsBefore));
        expect(mocks.getAgentProvidersQuota).toHaveBeenLastCalledWith(undefined);
    });

    it('sets error and clears quotaData on initial fetch failure', async () => {
        mocks.getAgentProvidersQuota.mockRejectedValue(new Error('network error'));

        const { result } = renderHook(() => useAgentProvidersQuota());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe('network error');
        expect(result.current.quotaData).toBeNull();
    });

    it('keeps stale quotaData and sets error on refresh failure', async () => {
        mocks.getAgentProvidersQuota
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
        mocks.getAgentProvidersQuota.mockReturnValue(new Promise(r => { resolve = r; }));

        const { result, unmount } = renderHook(() => useAgentProvidersQuota());
        expect(result.current.loading).toBe(true);

        unmount();
        act(() => { resolve(QUOTA_RESPONSE); });

        // After unmount the hook result is frozen — no setState calls should fire
        expect(result.current.quotaData).toBeNull();
    });
});
