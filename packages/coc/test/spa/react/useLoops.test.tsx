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
