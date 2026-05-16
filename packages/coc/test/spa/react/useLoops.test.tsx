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