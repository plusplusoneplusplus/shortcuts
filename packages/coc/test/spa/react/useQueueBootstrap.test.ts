/**
 * Runtime tests for useQueueBootstrap — the shared queue fetch-and-dispatch used
 * by both App (on connect/reconnect) and the popped-out chat window.
 *
 * Covers: happy path (QUEUE_UPDATED + SET_HISTORY), history omitted when absent,
 * and the no-op guards (rejected fetch, malformed snapshot) that keep an offline
 * or empty popout from crashing.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { queueListMock, getSpaCocClientMock, dispatchMock } = vi.hoisted(() => ({
    queueListMock: vi.fn(),
    getSpaCocClientMock: vi.fn(),
    dispatchMock: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: getSpaCocClientMock,
}));

vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: dispatchMock }),
}));

import { useQueueBootstrap } from '../../../src/server/spa/client/react/contexts/useQueueBootstrap';

beforeEach(() => {
    queueListMock.mockReset();
    getSpaCocClientMock.mockReset();
    dispatchMock.mockReset();
    getSpaCocClientMock.mockReturnValue({ queue: { list: queueListMock } });
});

describe('useQueueBootstrap', () => {
    it('dispatches QUEUE_UPDATED and SET_HISTORY with the fetched snapshot', async () => {
        const data = {
            queued: [],
            running: [],
            stats: {},
            history: [{ id: 'run-1', status: 'completed' }],
        };
        queueListMock.mockResolvedValue(data);

        const { result } = renderHook(() => useQueueBootstrap());
        await result.current();

        expect(dispatchMock).toHaveBeenCalledWith({ type: 'QUEUE_UPDATED', queue: data });
        expect(dispatchMock).toHaveBeenCalledWith({ type: 'SET_HISTORY', history: data.history });
    });

    it('omits SET_HISTORY when the snapshot has no history', async () => {
        const data = { queued: [], running: [], stats: {} };
        queueListMock.mockResolvedValue(data);

        const { result } = renderHook(() => useQueueBootstrap());
        await result.current();

        expect(dispatchMock).toHaveBeenCalledWith({ type: 'QUEUE_UPDATED', queue: data });
        expect(dispatchMock).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_HISTORY' }),
        );
    });

    it('no-ops when the fetch rejects (offline popout does not crash)', async () => {
        queueListMock.mockRejectedValue(new Error('offline'));

        const { result } = renderHook(() => useQueueBootstrap());
        await result.current();

        expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('no-ops when the response is malformed (missing arrays)', async () => {
        queueListMock.mockResolvedValue({ queued: null, running: null });

        const { result } = renderHook(() => useQueueBootstrap());
        await result.current();

        expect(dispatchMock).not.toHaveBeenCalled();
    });
});
