import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => true,
}));
// The hook routes every call through the clone registry so a remote clone's
// side-notes are written on ITS server, not the local data dir.
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    requestForWorkspace: requestMock,
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
        requestMock.mockReset();
    });

    it('is a no-op when process/workspace are unknown', async () => {
        requestMock.mockResolvedValue({ sidenotes: [] });
        const { result } = renderHook(() => useQuickAskSidenotes(undefined, undefined));
        expect(result.current.enabled).toBe(false);
        act(() => result.current.createSidenote(selection()));
        expect(result.current.items).toEqual([]);
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('hydrates persisted side-notes on mount', async () => {
        requestMock.mockResolvedValueOnce({
            sidenotes: [{ id: 's1', processId: 'p1', turnIndex: 0, anchor: { selectedText: 'x', contextBefore: '', contextAfter: '', fingerprint: 'f' }, answer: 'A', label: 'x', createdAt: 't' }],
        });
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(result.current.items).toHaveLength(1));
        expect(result.current.items[0].status).toBe('ready');
        expect(requestMock).toHaveBeenCalledWith('ws-1', '/api/processes/p1/sidenotes?workspace=ws-1');
    });

    it('creates optimistically then resolves to a ready side-note', async () => {
        requestMock.mockResolvedValueOnce({ sidenotes: [] }); // hydrate
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

        let resolvePost: (v: any) => void = () => {};
        requestMock.mockImplementationOnce(() => new Promise(res => { resolvePost = res; }));

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
        requestMock.mockResolvedValueOnce({ sidenotes: [] }); // hydrate
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

        requestMock.mockRejectedValueOnce(new Error('502'));
        await act(async () => { result.current.createSidenote(selection()); });
        await waitFor(() => expect(result.current.items[0].status).toBe('error'));
        const failedId = result.current.items[0].id;

        requestMock.mockResolvedValueOnce({ sidenote: { id: 'srv2', processId: 'p1', turnIndex: 1, anchor: { selectedText: 'Daly formula', contextBefore: '', contextAfter: '', fingerprint: 'f' }, answer: 'Recovered', label: 'Daly formula', createdAt: 't' } });
        await act(async () => { result.current.retrySidenote(failedId); });
        await waitFor(() => expect(result.current.items[0].status).toBe('ready'));
        expect(result.current.items[0].answer).toBe('Recovered');
    });

    it('passes a custom question through in the POST body (AC-02)', async () => {
        requestMock.mockResolvedValueOnce({ sidenotes: [] }); // hydrate
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

        requestMock.mockImplementationOnce(() => new Promise(() => {})); // never resolves
        act(() => result.current.createSidenote(selection(), 'why does this matter?'));

        const [, , opts] = requestMock.mock.calls[1];
        const body = JSON.parse(opts.body);
        expect(body.question).toBe('why does this matter?');
        // Optimistic item also carries the question locally.
        expect(result.current.items[0].question).toBe('why does this matter?');
    });

    it('omits question for empty/whitespace-only input (default-explain fast path)', async () => {
        requestMock.mockResolvedValueOnce({ sidenotes: [] }); // hydrate
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

        requestMock.mockImplementationOnce(() => new Promise(() => {}));
        act(() => result.current.createSidenote(selection(), '   '));

        const [, , opts] = requestMock.mock.calls[1];
        const body = JSON.parse(opts.body);
        expect('question' in body).toBe(false);
        expect(result.current.items[0].question).toBeUndefined();
    });

    it('omits question when none is provided at all', async () => {
        requestMock.mockResolvedValueOnce({ sidenotes: [] }); // hydrate
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

        requestMock.mockImplementationOnce(() => new Promise(() => {}));
        act(() => result.current.createSidenote(selection()));

        const [, , opts] = requestMock.mock.calls[1];
        const body = JSON.parse(opts.body);
        expect('question' in body).toBe(false);
    });

    it('deletes a persisted side-note and calls the delete endpoint', async () => {
        requestMock.mockResolvedValueOnce({
            sidenotes: [{ id: 's1', processId: 'p1', turnIndex: 0, anchor: { selectedText: 'x', contextBefore: '', contextAfter: '', fingerprint: 'f' }, answer: 'A', label: 'x', createdAt: 't' }],
        });
        const { result } = renderHook(() => useQuickAskSidenotes('p1', 'ws-1'));
        await waitFor(() => expect(result.current.items).toHaveLength(1));

        requestMock.mockResolvedValueOnce(undefined); // DELETE
        act(() => result.current.deleteSidenote('s1'));
        expect(result.current.items).toHaveLength(0);
        expect(requestMock).toHaveBeenLastCalledWith(
            'ws-1',
            '/api/processes/p1/sidenotes/s1?workspace=ws-1',
            { method: 'DELETE' },
        );
    });
});
