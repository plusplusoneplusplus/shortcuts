/**
 * Tests for useLoops — derived counts used by loop dashboard entry points.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLoops } from '../../../src/server/spa/client/react/features/chat/hooks/useLoops';

const { mockLoopsClient } = vi.hoisted(() => ({
    mockLoopsClient: {
        list: vi.fn(),
        pause: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ loops: mockLoopsClient }),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isLoopsEnabled: () => true,
    isRalphEnabled: () => false,
}));

describe('useLoops', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('counts non-cancelled loops as manageable and tracks active loops separately', async () => {
        mockLoopsClient.list.mockResolvedValue([
            { id: 'active-1', processId: 'process-1', status: 'active' },
            { id: 'paused-1', processId: 'process-1', status: 'paused' },
            { id: 'expired-1', processId: 'process-1', status: 'expired' },
            { id: 'cancelled-1', processId: 'process-1', status: 'cancelled' },
            { id: 'other-process', processId: 'process-2', status: 'active' },
        ]);

        const { result } = renderHook(() => useLoops('workspace-1', 'process-1'));

        await waitFor(() => expect(result.current.loops).toHaveLength(4));

        expect(result.current.activeCount).toBe(1);
        expect(result.current.manageableCount).toBe(3);
        expect(result.current.hasActiveLoops).toBe(true);
    });

    it('keeps paused-only loops manageable so the badge can remain visible', async () => {
        mockLoopsClient.list.mockResolvedValue([
            { id: 'paused-1', processId: 'process-1', status: 'paused' },
            { id: 'cancelled-1', processId: 'process-1', status: 'cancelled' },
        ]);

        const { result } = renderHook(() => useLoops('workspace-1', 'process-1'));

        await waitFor(() => expect(result.current.loops).toHaveLength(2));

        expect(result.current.activeCount).toBe(0);
        expect(result.current.manageableCount).toBe(1);
        expect(result.current.hasActiveLoops).toBe(false);
    });
});

describe('useLoops WebSocket listener', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('refetches on coc-ws-message loop-paused for matching process', async () => {
        mockLoopsClient.list.mockResolvedValueOnce([
            { id: 'l1', processId: 'process-1', status: 'active' },
        ]);
        const { result } = renderHook(() => useLoops('workspace-1', 'process-1'));
        await waitFor(() => expect(result.current.loops).toHaveLength(1));
        expect(result.current.hasActiveLoops).toBe(true);

        mockLoopsClient.list.mockResolvedValueOnce([
            { id: 'l1', processId: 'process-1', status: 'paused' },
        ]);
        window.dispatchEvent(new CustomEvent('coc-ws-message', {
            detail: { type: 'loop-paused', processId: 'process-1', loopId: 'l1', status: 'paused' },
        }));
        await waitFor(() => expect(result.current.hasActiveLoops).toBe(false));
        expect(mockLoopsClient.list).toHaveBeenCalledTimes(2);
    });

    it('ignores coc-ws-message for a different process', async () => {
        mockLoopsClient.list.mockResolvedValueOnce([
            { id: 'l1', processId: 'process-1', status: 'active' },
        ]);
        const { result } = renderHook(() => useLoops('workspace-1', 'process-1'));
        await waitFor(() => expect(result.current.loops).toHaveLength(1));

        window.dispatchEvent(new CustomEvent('coc-ws-message', {
            detail: { type: 'loop-paused', processId: 'process-other', loopId: 'l9', status: 'paused' },
        }));
        // give microtasks a chance
        await new Promise(r => setTimeout(r, 10));
        expect(mockLoopsClient.list).toHaveBeenCalledTimes(1);
    });

    it('removes the listener on unmount', async () => {
        mockLoopsClient.list.mockResolvedValue([
            { id: 'l1', processId: 'process-1', status: 'active' },
        ]);
        const { result, unmount } = renderHook(() => useLoops('workspace-1', 'process-1'));
        await waitFor(() => expect(result.current.loops).toHaveLength(1));
        const callsBefore = mockLoopsClient.list.mock.calls.length;
        unmount();
        window.dispatchEvent(new CustomEvent('coc-ws-message', {
            detail: { type: 'loop-paused', processId: 'process-1', loopId: 'l1', status: 'paused' },
        }));
        await new Promise(r => setTimeout(r, 10));
        expect(mockLoopsClient.list.mock.calls.length).toBe(callsBefore);
    });
});

// AC-02: loops are workspace-scoped, so switching conversations within the same
// workspace must re-derive the per-process view client-side WITHOUT re-issuing
// `loops.list`. Only a workspace change re-fetches.
describe('useLoops AC-02 — workspace-scoped fetch', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('does not refetch when only processId changes within the same workspace', async () => {
        mockLoopsClient.list.mockResolvedValue([
            { id: 'l1', processId: 'process-1', status: 'active' },
            { id: 'l2', processId: 'process-2', status: 'paused' },
        ]);

        const { result, rerender } = renderHook(
            ({ pid }: { pid: string }) => useLoops('workspace-1', pid),
            { initialProps: { pid: 'process-1' } },
        );

        await waitFor(() => expect(result.current.loops).toHaveLength(1));
        expect(result.current.loops[0].id).toBe('l1');
        expect(mockLoopsClient.list).toHaveBeenCalledTimes(1);

        // Switch to a different conversation in the SAME workspace.
        rerender({ pid: 'process-2' });

        // The per-process view re-derives from the cached workspace list...
        await waitFor(() => expect(result.current.loops[0]?.id).toBe('l2'));
        expect(result.current.loops).toHaveLength(1);
        // ...without issuing another loops.list round-trip.
        expect(mockLoopsClient.list).toHaveBeenCalledTimes(1);
    });

    it('refetches when the workspace changes', async () => {
        mockLoopsClient.list.mockResolvedValue([
            { id: 'l1', processId: 'process-1', status: 'active' },
        ]);

        const { rerender } = renderHook(
            ({ ws }: { ws: string }) => useLoops(ws, 'process-1'),
            { initialProps: { ws: 'workspace-1' } },
        );

        await waitFor(() => expect(mockLoopsClient.list).toHaveBeenCalledTimes(1));
        expect(mockLoopsClient.list).toHaveBeenLastCalledWith('workspace-1');

        rerender({ ws: 'workspace-2' });
        await waitFor(() => expect(mockLoopsClient.list).toHaveBeenCalledTimes(2));
        expect(mockLoopsClient.list).toHaveBeenLastCalledWith('workspace-2');
    });
});