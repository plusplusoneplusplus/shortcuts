/**
 * useRepoTabOrdering — unit tests for repo-tab order persistence and mechanics.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockGetGlobal = vi.fn();
const mockPatchGlobal = vi.fn().mockResolvedValue({});
const mockReplaceGlobal = vi.fn().mockResolvedValue({});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: mockGetGlobal,
            patchGlobal: mockPatchGlobal,
            replaceGlobal: mockReplaceGlobal,
        },
    }),
    getSpaCocClientErrorMessage: (e: unknown, fallback: string) => `${fallback}: ${String(e)}`,
}));

import { useRepoTabOrdering } from '../../../../src/server/spa/client/react/features/repo-detail/useRepoTabOrdering';

const repoIds = ['r1', 'r2', 'r3'];

function renderOrdering(toast: { addToast: ReturnType<typeof vi.fn> } | null = null) {
    const allRepoIdsRef = createRef<string[]>() as { current: string[] };
    allRepoIdsRef.current = [...repoIds];
    return renderHook(() => useRepoTabOrdering({ repoIds, allRepoIdsRef, toast }));
}

describe('useRepoTabOrdering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetGlobal.mockResolvedValue({ gitGroupOrder: ['g-a'], repoTabOrder: ['r2', 'r1'] });
        mockPatchGlobal.mockResolvedValue({});
        mockReplaceGlobal.mockResolvedValue({});
    });

    it('loads persisted group order and repo tab order on mount', async () => {
        const { result } = renderOrdering();
        await waitFor(() => {
            expect(result.current.groupOrder).toEqual(['g-a']);
            expect(result.current.repoTabOrder).toEqual(['r2', 'r1']);
        });
    });

    it('persists a sanitized order when moving a repo to an index', async () => {
        const { result } = renderOrdering();
        await waitFor(() => expect(result.current.repoTabOrder).toBeDefined());

        act(() => result.current.moveRepoToIndex('r3', 0));

        await waitFor(() => {
            expect(mockPatchGlobal).toHaveBeenCalledWith({ repoTabOrder: ['r3', 'r1', 'r2'] });
        });
        expect(result.current.repoLiveMessage).toBe('Repository tab order updated.');
    });

    it('enters customize mode and announces it via the live region', () => {
        const { result } = renderOrdering();
        act(() => result.current.enterCustomizeRepoTabs());
        expect(result.current.customizeRepoTabs).toBe(true);
        expect(result.current.repoLiveMessage).toBe('Repo tab customize mode started.');
    });

    it('resets order by replacing global prefs without repoTabOrder and clears customize mode', async () => {
        mockGetGlobal.mockResolvedValue({ repoTabOrder: ['r2', 'r1'], theme: 'dark' });
        const toast = { addToast: vi.fn() };
        const { result } = renderOrdering(toast);
        await waitFor(() => expect(result.current.repoTabOrder).toEqual(['r2', 'r1']));

        act(() => { result.current.enterCustomizeRepoTabs(); });
        await act(async () => { await result.current.resetRepoTabOrder(); });

        expect(mockReplaceGlobal).toHaveBeenCalledWith({ theme: 'dark' });
        expect(result.current.customizeRepoTabs).toBe(false);
        expect(result.current.repoTabOrder).toBeUndefined();
        expect(toast.addToast).toHaveBeenCalledWith('Repo tab order reset', 'success');
    });

    it('keeps the order for the session and toasts when persistence fails', async () => {
        mockPatchGlobal.mockRejectedValueOnce(new Error('boom'));
        const toast = { addToast: vi.fn() };
        const { result } = renderOrdering(toast);
        await waitFor(() => expect(result.current.repoTabOrder).toBeDefined());

        act(() => result.current.moveRepoToIndex('r3', 0));

        await waitFor(() => expect(toast.addToast).toHaveBeenCalled());
        // Optimistic local order still applied despite the failed save.
        expect(result.current.repoTabOrder).toEqual(['r3', 'r1', 'r2']);
        expect(toast.addToast.mock.calls[0][1]).toBe('error');
    });
});
