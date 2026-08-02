/**
 * Tests for useCrons — derived counts used by cron dashboard entry points.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCrons } from '../../../src/server/spa/client/react/features/chat/hooks/useCrons';

const { mockCronsClient } = vi.hoisted(() => ({
    mockCronsClient: {
        list: vi.fn(),
        pause: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ crons: mockCronsClient }),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isCronEnabled: () => true,
    isRalphEnabled: () => false,
}));

describe('useCrons', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('counts non-cancelled crons as manageable and tracks active crons separately', async () => {
        mockCronsClient.list.mockResolvedValue([
            { id: 'active-1', processId: 'process-1', status: 'active' },
            { id: 'paused-1', processId: 'process-1', status: 'paused' },
            { id: 'expired-1', processId: 'process-1', status: 'expired' },
            { id: 'cancelled-1', processId: 'process-1', status: 'cancelled' },
            { id: 'other-process', processId: 'process-2', status: 'active' },
        ]);

        const { result } = renderHook(() => useCrons('workspace-1', 'process-1'));

        await waitFor(() => expect(result.current.crons).toHaveLength(4));

        expect(result.current.activeCount).toBe(1);
        expect(result.current.manageableCount).toBe(3);
        expect(result.current.hasActiveCrons).toBe(true);
    });

    it('keeps paused-only crons manageable so the badge can remain visible', async () => {
        mockCronsClient.list.mockResolvedValue([
            { id: 'paused-1', processId: 'process-1', status: 'paused' },
            { id: 'cancelled-1', processId: 'process-1', status: 'cancelled' },
        ]);

        const { result } = renderHook(() => useCrons('workspace-1', 'process-1'));

        await waitFor(() => expect(result.current.crons).toHaveLength(2));

        expect(result.current.activeCount).toBe(0);
        expect(result.current.manageableCount).toBe(1);
        expect(result.current.hasActiveCrons).toBe(false);
    });
});

describe('useCrons WebSocket listener', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('refetches on coc-ws-message cron-paused for matching process', async () => {
        mockCronsClient.list.mockResolvedValueOnce([
            { id: 'l1', processId: 'process-1', status: 'active' },
        ]);
        const { result } = renderHook(() => useCrons('workspace-1', 'process-1'));
        await waitFor(() => expect(result.current.crons).toHaveLength(1));
        expect(result.current.hasActiveCrons).toBe(true);

        mockCronsClient.list.mockResolvedValueOnce([
            { id: 'l1', processId: 'process-1', status: 'paused' },
        ]);
        window.dispatchEvent(new CustomEvent('coc-ws-message', {
            detail: { type: 'cron-paused', processId: 'process-1', cronId: 'l1', status: 'paused' },
        }));
        await waitFor(() => expect(result.current.hasActiveCrons).toBe(false));
        expect(mockCronsClient.list).toHaveBeenCalledTimes(2);
    });

    it('ignores coc-ws-message for a different process', async () => {
        mockCronsClient.list.mockResolvedValueOnce([
            { id: 'l1', processId: 'process-1', status: 'active' },
        ]);
        const { result } = renderHook(() => useCrons('workspace-1', 'process-1'));
        await waitFor(() => expect(result.current.crons).toHaveLength(1));

        window.dispatchEvent(new CustomEvent('coc-ws-message', {
            detail: { type: 'cron-paused', processId: 'process-other', cronId: 'l9', status: 'paused' },
        }));
        // give microtasks a chance
        await new Promise(r => setTimeout(r, 10));
        expect(mockCronsClient.list).toHaveBeenCalledTimes(1);
    });

    it('removes the listener on unmount', async () => {
        mockCronsClient.list.mockResolvedValue([
            { id: 'l1', processId: 'process-1', status: 'active' },
        ]);
        const { result, unmount } = renderHook(() => useCrons('workspace-1', 'process-1'));
        await waitFor(() => expect(result.current.crons).toHaveLength(1));
        const callsBefore = mockCronsClient.list.mock.calls.length;
        unmount();
        window.dispatchEvent(new CustomEvent('coc-ws-message', {
            detail: { type: 'cron-paused', processId: 'process-1', cronId: 'l1', status: 'paused' },
        }));
        await new Promise(r => setTimeout(r, 10));
        expect(mockCronsClient.list.mock.calls.length).toBe(callsBefore);
    });
});

// AC-02: crons are workspace-scoped, so switching conversations within the same
// workspace must re-derive the per-process view client-side WITHOUT re-issuing
// `crons.list`. Only a workspace change re-fetches.
describe('useCrons AC-02 — workspace-scoped fetch', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('does not refetch when only processId changes within the same workspace', async () => {
        mockCronsClient.list.mockResolvedValue([
            { id: 'l1', processId: 'process-1', status: 'active' },
            { id: 'l2', processId: 'process-2', status: 'paused' },
        ]);

        const { result, rerender } = renderHook(
            ({ pid }: { pid: string }) => useCrons('workspace-1', pid),
            { initialProps: { pid: 'process-1' } },
        );

        await waitFor(() => expect(result.current.crons).toHaveLength(1));
        expect(result.current.crons[0].id).toBe('l1');
        expect(mockCronsClient.list).toHaveBeenCalledTimes(1);

        // Switch to a different conversation in the SAME workspace.
        rerender({ pid: 'process-2' });

        // The per-process view re-derives from the cached workspace list...
        await waitFor(() => expect(result.current.crons[0]?.id).toBe('l2'));
        expect(result.current.crons).toHaveLength(1);
        // ...without issuing another crons.list round-trip.
        expect(mockCronsClient.list).toHaveBeenCalledTimes(1);
    });

    it('refetches when the workspace changes', async () => {
        mockCronsClient.list.mockResolvedValue([
            { id: 'l1', processId: 'process-1', status: 'active' },
        ]);

        const { rerender } = renderHook(
            ({ ws }: { ws: string }) => useCrons(ws, 'process-1'),
            { initialProps: { ws: 'workspace-1' } },
        );

        await waitFor(() => expect(mockCronsClient.list).toHaveBeenCalledTimes(1));
        expect(mockCronsClient.list).toHaveBeenLastCalledWith('workspace-1');

        rerender({ ws: 'workspace-2' });
        await waitFor(() => expect(mockCronsClient.list).toHaveBeenCalledTimes(2));
        expect(mockCronsClient.list).toHaveBeenLastCalledWith('workspace-2');
    });
});