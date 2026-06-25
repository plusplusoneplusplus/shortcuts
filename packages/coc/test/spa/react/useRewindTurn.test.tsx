/**
 * Tests for useRewindTurn — the orchestration behind "Rewind to here" (AC-04):
 * confirm flow, success (composer restore + conversation refresh), error toast on
 * rejection, eligibility/idle guards, and double-submit protection.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRewindTurn, type UseRewindTurnOptions } from '../../../src/server/spa/client/react/features/chat/hooks/useRewindTurn';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function setup(overrides: Partial<UseRewindTurnOptions> = {}) {
    const rewindTurn = vi.fn();
    const restoreComposer = vi.fn();
    const refreshConversation = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const opts: UseRewindTurnOptions = {
        client: { processes: { rewindTurn } },
        processId: 'proc-1',
        restoreComposer,
        refreshConversation,
        onError,
        ...overrides,
    };
    const view = renderHook(() => useRewindTurn(opts));
    return { rewindTurn, restoreComposer, refreshConversation, onError, view };
}

describe('useRewindTurn', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('requestRewind opens the dialog for a turn; cancel closes it', () => {
        const { view } = setup();
        expect(view.result.current.targetIndex).toBeNull();
        act(() => view.result.current.requestRewind(2));
        expect(view.result.current.targetIndex).toBe(2);
        act(() => view.result.current.cancel());
        expect(view.result.current.targetIndex).toBeNull();
    });

    it('confirm rewinds, restores the composer with text + images, refreshes, and closes', async () => {
        const { view, rewindTurn, restoreComposer, refreshConversation } = setup();
        rewindTurn.mockResolvedValue({ restored: { content: 'edit me', images: [PNG] }, turnsRemoved: 3 });

        act(() => view.result.current.requestRewind(2));
        await act(async () => { await view.result.current.confirm(); });

        expect(rewindTurn).toHaveBeenCalledWith('proc-1', 2);
        // Composer restored with the rewound text + a reconstructed image attachment.
        const [restoredContent, restoredAtts] = restoreComposer.mock.calls[0];
        expect(restoredContent).toBe('edit me');
        expect(restoredAtts).toHaveLength(1);
        expect(restoredAtts[0].dataUrl).toBe(PNG);
        expect(restoredAtts[0].category).toBe('image');
        // Conversation re-fetched after the server truncated it.
        expect(refreshConversation).toHaveBeenCalledWith('proc-1');
        expect(view.result.current.targetIndex).toBeNull();
        expect(view.result.current.pending).toBe(false);
    });

    it('restores text only when the rewound turn had no images', async () => {
        const { view, rewindTurn, restoreComposer } = setup();
        rewindTurn.mockResolvedValue({ restored: { content: 'just text' }, turnsRemoved: 1 });

        act(() => view.result.current.requestRewind(0));
        await act(async () => { await view.result.current.confirm(); });

        const [content, atts] = restoreComposer.mock.calls[0];
        expect(content).toBe('just text');
        expect(atts).toEqual([]);
    });

    it('surfaces a backend rejection via onError and does not refresh', async () => {
        const { view, rewindTurn, restoreComposer, refreshConversation, onError } = setup();
        rewindTurn.mockRejectedValue(new Error('Conversation is not idle'));

        act(() => view.result.current.requestRewind(5));
        await act(async () => { await view.result.current.confirm(); });

        expect(onError).toHaveBeenCalledWith('Conversation is not idle');
        expect(restoreComposer).not.toHaveBeenCalled();
        expect(refreshConversation).not.toHaveBeenCalled();
        // Dialog closes and the in-flight state clears even on failure.
        expect(view.result.current.targetIndex).toBeNull();
        expect(view.result.current.pending).toBe(false);
    });

    it('falls back to a generic message when the rejection is not an Error', async () => {
        const { view, rewindTurn, onError } = setup();
        rewindTurn.mockRejectedValue('opaque failure');

        act(() => view.result.current.requestRewind(1));
        await act(async () => { await view.result.current.confirm(); });

        expect(onError).toHaveBeenCalledWith('Failed to rewind conversation.');
    });

    it('does nothing when there is no target turn', async () => {
        const { view, rewindTurn } = setup();
        await act(async () => { await view.result.current.confirm(); });
        expect(rewindTurn).not.toHaveBeenCalled();
    });

    it('does nothing when there is no processId', async () => {
        const { view, rewindTurn } = setup({ processId: null });
        act(() => view.result.current.requestRewind(0));
        await act(async () => { await view.result.current.confirm(); });
        expect(rewindTurn).not.toHaveBeenCalled();
    });

    it('guards against double-submit while a rewind is in flight', async () => {
        const { view, rewindTurn } = setup();
        let resolveRewind: (v: unknown) => void = () => {};
        rewindTurn.mockReturnValue(new Promise((r) => { resolveRewind = r; }));

        act(() => view.result.current.requestRewind(0));
        // Fire two confirms in the same burst; the second must be a no-op.
        await act(async () => {
            void view.result.current.confirm();
            void view.result.current.confirm();
        });
        expect(view.result.current.pending).toBe(true);
        expect(rewindTurn).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveRewind({ restored: { content: 'x' } });
            await Promise.resolve();
        });
        await waitFor(() => expect(view.result.current.pending).toBe(false));
    });

    it('cancel is a no-op while a rewind is in flight', async () => {
        const { view } = setup({
            client: { processes: { rewindTurn: vi.fn().mockReturnValue(new Promise(() => {})) } },
        });
        act(() => view.result.current.requestRewind(3));
        await act(async () => { void view.result.current.confirm(); });
        expect(view.result.current.pending).toBe(true);
        act(() => view.result.current.cancel());
        // Still showing the dialog because a request is mid-flight.
        expect(view.result.current.targetIndex).toBe(3);
    });
});
