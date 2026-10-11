import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    deleteSeenEntry,
    fetchSeenMap,
    fetchUnseenCount,
    patchSeenState,
    SEEN_STATE_CHANGED_EVENT,
} from '../../../../src/server/spa/client/react/hooks/preferences/seenStateApi';

const mocks = vi.hoisted(() => ({
    seenState: {
        getMap: vi.fn(),
        updateMany: vi.fn(),
        markUnseen: vi.fn(),
        getUnseenCount: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ seenState: mocks.seenState }),
    getCocClientFor: () => ({ seenState: mocks.seenState }),
}));

describe('seenStateApi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.seenState.getMap.mockResolvedValue({ 'proc-1': '2026-05-02T00:00:00.000Z' });
        mocks.seenState.updateMany.mockResolvedValue({ 'proc-2': '2026-05-02T00:00:01.000Z' });
        mocks.seenState.markUnseen.mockResolvedValue({ ok: true });
        mocks.seenState.getUnseenCount.mockResolvedValue({ unseenCount: 3 });
    });

    it('delegates seen map reads to the typed client domain', async () => {
        await expect(fetchSeenMap('repo/a')).resolves.toEqual({
            'proc-1': '2026-05-02T00:00:00.000Z',
        });

        expect(mocks.seenState.getMap).toHaveBeenCalledWith('repo/a');
    });

    it('delegates batch updates without constructing endpoint strings', async () => {
        const entries = [{ processId: 'proc-2', seenAt: '2026-05-02T00:00:01.000Z' }];

        await expect(patchSeenState('repo/a', entries)).resolves.toEqual({
            'proc-2': '2026-05-02T00:00:01.000Z',
        });

        expect(mocks.seenState.updateMany).toHaveBeenCalledWith('repo/a', entries);
    });

    it('delegates unseen deletion and exposes a void helper result', async () => {
        await expect(deleteSeenEntry('repo/a', 'proc/3')).resolves.toBeUndefined();

        expect(mocks.seenState.markUnseen).toHaveBeenCalledWith('repo/a', 'proc/3');
    });

    it('returns the unseen count from the typed response body', async () => {
        await expect(fetchUnseenCount('repo/a')).resolves.toBe(3);

        expect(mocks.seenState.getUnseenCount).toHaveBeenCalledWith('repo/a');
    });

    it('publishes read changes only after persistence with the captured concrete owner', async () => {
        const listener = vi.fn();
        window.addEventListener(SEEN_STATE_CHANGED_EVENT, listener);
        try {
            let resolve!: (map: Record<string, string>) => void;
            mocks.seenState.updateMany.mockReturnValueOnce(new Promise(done => { resolve = done; }));
            const entries = [{ processId: 'proc', seenAt: '2026-05-02T00:00:00.000Z' }];
            const pending = patchSeenState('ws', entries, { baseUrl: 'https://owner.test' });
            expect(listener).not.toHaveBeenCalled();
            resolve({ proc: entries[0].seenAt });
            await pending;
            expect(listener.mock.calls[0][0].detail).toEqual({ workspaceId: 'ws', baseUrl: 'https://owner.test', entries });
            await deleteSeenEntry('ws', 'proc', { baseUrl: undefined });
            expect(listener.mock.calls[1][0].detail).toEqual({ workspaceId: 'ws', baseUrl: undefined, processId: 'proc' });
        } finally {
            window.removeEventListener(SEEN_STATE_CHANGED_EVENT, listener);
        }
    });

    it('propagates failed mutations without publishing a successful read-state change', async () => {
        const listener = vi.fn();
        window.addEventListener(SEEN_STATE_CHANGED_EVENT, listener);
        try {
            mocks.seenState.updateMany.mockRejectedValueOnce(new Error('offline'));
            mocks.seenState.markUnseen.mockRejectedValueOnce(new Error('offline'));
            await expect(patchSeenState('ws', [])).rejects.toThrow('offline');
            await expect(deleteSeenEntry('ws', 'proc')).rejects.toThrow('offline');
            expect(listener).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener(SEEN_STATE_CHANGED_EVENT, listener);
        }
    });
});
