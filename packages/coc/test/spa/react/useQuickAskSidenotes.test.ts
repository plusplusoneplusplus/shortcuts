import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { fetchApiMock } = vi.hoisted(() => ({ fetchApiMock: vi.fn() }));

vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => true,
}));
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: fetchApiMock,
}));

import { useQuickAskSidenotes } from '../../../src/server/spa/client/react/features/chat/quick-ask/useQuickAskSidenotes';
import type { QuickAskSelection } from '../../../src/server/spa/client/react/features/chat/quick-ask/types';

function selection(overrides: Partial<QuickAskSelection> = {}): QuickAskSelection {
    return {
        turnIndex: 1,
        selectedText: 'Daly formula',
        contextBefore: 'the ',
        contextAfter: ' metric',
        rect: { top: 0, left: 0, bottom: 0, right: 0 },
        ...overrides,
    };
}

describe('useQuickAskSidenotes', () => {
    beforeEach(() => {
        fetchApiMock.mockReset();
    });

    it('is a no-op when process/workspace are unknown', async () => {
        fetchApiMock.mockResolvedValue({ sidenotes: [] });
        const { result } = renderHook(() => useQuickAskSidenotes(undefined, undefined));
        expect(result.current.enabled).toBe(false);
        act(() => result.current.createSidenote(selection()));
        expect(result.current.items).toEqual([]);
        expect(fetchApiMock).not.toHaveBeenCalled();
    });

    it('hydrates persisted side-notes on mount', async () => {
        fetchApiMock.mockResolvedValueOnce({
            sidenotes: [{ id: 's1', processId: 'p1', turnIndex: 0, anchor: { selectedText: 'x', contextBefore: '', contextAfter: '', fingerprint: 'f' }, answer: 'A', label: 'x', createdAt: 't' }],
        });
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(result.current.items).toHaveLength(1));
        expect(result.current.items[0].status).toBe('ready');
        expect(fetchApiMock).toHaveBeenCalledWith('/api/processes/p1/sidenotes?workspace=ws-1');
    });

    it('creates optimistically then resolves to a ready side-note', async () => {
        fetchApiMock.mockResolvedValueOnce({ sidenotes: [] }); // hydrate
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(1));

        let resolvePost: (v: any) => void = () => {};
        fetchApiMock.mockImplementationOnce(() => new Promise(res => { resolvePost = res; }));

        act(() => result.current.createSidenote(selection()));
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].status).toBe('asking');

        await act(async () => {
            resolvePost({ sidenote: { id: 'srv1', processId: 'p1', turnIndex: 1, anchor: { selectedText: 'Daly formula', contextBefore: '', contextAfter: '', fingerprint: 'f' }, answer: 'Answer', label: 'Daly formula', createdAt: 't' } });
        });

        await waitFor(() => expect(result.current.items[0].status).toBe('ready'));
        expect(result.current.items[0].id).toBe('srv1');
        expect(result.current.items[0].answer).toBe('Answer');
    });

    it('marks the side-note as error when the lookup fails, then retries', async () => {
        fetchApiMock.mockResolvedValueOnce({ sidenotes: [] }); // hydrate
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(1));

        fetchApiMock.mockRejectedValueOnce(new Error('502'));
        await act(async () => { result.current.createSidenote(selection()); });
        await waitFor(() => expect(result.current.items[0].status).toBe('error'));
        const failedId = result.current.items[0].id;

        fetchApiMock.mockResolvedValueOnce({ sidenote: { id: 'srv2', processId: 'p1', turnIndex: 1, anchor: { selectedText: 'Daly formula', contextBefore: '', contextAfter: '', fingerprint: 'f' }, answer: 'Recovered', label: 'Daly formula', createdAt: 't' } });
        await act(async () => { result.current.retrySidenote(failedId); });
        await waitFor(() => expect(result.current.items[0].status).toBe('ready'));
        expect(result.current.items[0].answer).toBe('Recovered');
    });

    it('deletes a persisted side-note and calls the delete endpoint', async () => {
        fetchApiMock.mockResolvedValueOnce({
            sidenotes: [{ id: 's1', processId: 'p1', turnIndex: 0, anchor: { selectedText: 'x', contextBefore: '', contextAfter: '', fingerprint: 'f' }, answer: 'A', label: 'x', createdAt: 't' }],
        });
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(result.current.items).toHaveLength(1));

        fetchApiMock.mockResolvedValueOnce(undefined); // DELETE
        act(() => result.current.deleteSidenote('s1'));
        expect(result.current.items).toHaveLength(0);
        expect(fetchApiMock).toHaveBeenLastCalledWith(
            '/api/processes/p1/sidenotes/s1?workspace=ws-1',
            { method: 'DELETE' },
        );
    });
});
