/**
 * Tests for useWiki — wiki list fetching and AppContext integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWiki } from '../../../../src/server/spa/client/react/wiki/hooks/useWiki';

// ── Mocks ────────────────────────────────────────────────────────────

const dispatchMock = vi.fn();
const stateMock = { wikis: [] as any[] };

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: stateMock, dispatch: dispatchMock }),
}));

const fetchApiMock = vi.fn();
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        wiki: {
            list: () => fetchApiMock(),
        },
    }),
}));

describe('useWiki', () => {
    beforeEach(() => {
        dispatchMock.mockReset();
        fetchApiMock.mockReset();
        stateMock.wikis = [];
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loads wikis on mount through the typed client', async () => {
        fetchApiMock.mockResolvedValue([]);
        renderHook(() => useWiki());
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(1));
    });

    it('dispatches SET_WIKIS with returned array on success', async () => {
        const wikis = [{ id: 'w1', name: 'My Wiki' }];
        fetchApiMock.mockResolvedValue(wikis);

        renderHook(() => useWiki());

        await waitFor(() =>
            expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_WIKIS', wikis }),
        );
    });

    it('dispatches SET_WIKIS with empty array on error', async () => {
        fetchApiMock.mockRejectedValue(new Error('network error'));

        renderHook(() => useWiki());

        await waitFor(() =>
            expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_WIKIS', wikis: [] }),
        );
    });

    it('reload() triggers a fresh fetch', async () => {
        fetchApiMock.mockResolvedValue([]);
        const { result } = renderHook(() => useWiki());

        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(1));

        fetchApiMock.mockResolvedValue([{ id: 'w2', name: 'New Wiki' }]);
        await result.current.reload();

        expect(fetchApiMock).toHaveBeenCalledTimes(2);
        expect(dispatchMock).toHaveBeenLastCalledWith({
            type: 'SET_WIKIS',
            wikis: [{ id: 'w2', name: 'New Wiki' }],
        });
    });

    it('returns wikis from context state', () => {
        stateMock.wikis = [{ id: 'ctx-wiki' }];
        fetchApiMock.mockResolvedValue([]);
        const { result } = renderHook(() => useWiki());
        expect(result.current.wikis).toBe(stateMock.wikis);
    });
});
