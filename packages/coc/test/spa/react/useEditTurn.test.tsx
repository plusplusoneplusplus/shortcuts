/**
 * Tests for useEditTurn — the orchestration behind "Edit message" (AC-03/AC-04):
 * rewind-then-send ordering, the edited payload that reaches the send, the
 * pending latch, and both failure branches.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditTurn, type UseEditTurnOptions } from '../../../src/server/spa/client/react/features/chat/hooks/useEditTurn';
import type { ChatAttachment } from '../../../src/server/spa/client/react/types/attachments';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const IMAGE_ATTACHMENT: ChatAttachment = {
    id: 'att-1',
    name: 'pasted.png',
    mimeType: 'image/png',
    size: 68,
    dataUrl: PNG,
    category: 'image',
};

/** A CocApiError-shaped rejection: the SPA reads `body.code` / `body.error`. */
function apiError(status: number, code: string, message: string) {
    const err = new Error(message) as Error & { status: number; body: unknown };
    err.status = status;
    err.body = { error: message, code };
    return err;
}

function setup(overrides: Partial<UseEditTurnOptions> = {}) {
    const calls: string[] = [];
    const rewindTurn = vi.fn(async () => { calls.push('rewind'); return { restored: { content: 'original', images: [PNG] } }; });
    const refreshConversation = vi.fn(async () => { calls.push('refresh'); });
    const sendEdited = vi.fn(async () => { calls.push('send'); });
    const didSendFail = vi.fn(() => false);
    const restoreComposer = vi.fn();
    const onError = vi.fn();
    const opts: UseEditTurnOptions = {
        client: { processes: { rewindTurn } },
        processId: 'proc-1',
        refreshConversation,
        sendEdited,
        didSendFail,
        restoreComposer,
        onError,
        ...overrides,
    };
    const view = renderHook(() => useEditTurn(opts));
    return { calls, rewindTurn, refreshConversation, sendEdited, didSendFail, restoreComposer, onError, view };
}

describe('useEditTurn', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('startEdit opens one editor at a time and cancelEdit closes it without touching the conversation', () => {
        const { view, rewindTurn, sendEdited } = setup();
        expect(view.result.current.editingTurnIndex).toBeNull();
        act(() => view.result.current.startEdit(2));
        expect(view.result.current.editingTurnIndex).toBe(2);
        // Opening a second editor implicitly discards the first.
        act(() => view.result.current.startEdit(4));
        expect(view.result.current.editingTurnIndex).toBe(4);
        act(() => view.result.current.cancelEdit());
        expect(view.result.current.editingTurnIndex).toBeNull();
        expect(rewindTurn).not.toHaveBeenCalled();
        expect(sendEdited).not.toHaveBeenCalled();
    });

    it('submitEdit rewinds before sending, with the target turn index', async () => {
        const { view, calls, rewindTurn } = setup();
        act(() => view.result.current.startEdit(2));
        await act(async () => { await view.result.current.submitEdit(2, { text: 'edited', attachments: [] }); });

        expect(rewindTurn).toHaveBeenCalledWith('proc-1', 2);
        expect(calls).toEqual(['rewind', 'refresh', 'send']);
    });

    it('the send carries the edited text and the retained images', async () => {
        const { view, sendEdited } = setup();
        act(() => view.result.current.startEdit(2));
        await act(async () => {
            await view.result.current.submitEdit(2, { text: 'edited text', attachments: [IMAGE_ATTACHMENT] });
        });

        expect(sendEdited).toHaveBeenCalledWith('edited text', [IMAGE_ATTACHMENT]);
    });

    it('closes the editor and reports no error on success', async () => {
        const { view, restoreComposer, onError } = setup();
        act(() => view.result.current.startEdit(2));
        await act(async () => { await view.result.current.submitEdit(2, { text: 'edited', attachments: [] }); });

        expect(view.result.current.editingTurnIndex).toBeNull();
        expect(view.result.current.pending).toBe(false);
        expect(view.result.current.error).toBeNull();
        expect(restoreComposer).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('ignores the rewind restored payload — the editor already holds the edit', async () => {
        const { view, sendEdited } = setup();
        act(() => view.result.current.startEdit(2));
        await act(async () => { await view.result.current.submitEdit(2, { text: 'my edit', attachments: [] }); });

        // The mocked rewind returns `restored.content = 'original'`; it must not leak.
        expect(sendEdited).toHaveBeenCalledWith('my edit', []);
    });

    it('a rewind failure keeps the editor open with an inline error and sends nothing', async () => {
        const { view, sendEdited, restoreComposer, rewindTurn } = setup();
        rewindTurn.mockRejectedValueOnce(apiError(409, 'CONVERSATION_NOT_IDLE', 'Conversation must be idle (not running, queued, or streaming) to rewind.'));

        act(() => view.result.current.startEdit(2));
        await act(async () => { await view.result.current.submitEdit(2, { text: 'edited', attachments: [IMAGE_ATTACHMENT] }); });

        expect(view.result.current.editingTurnIndex).toBe(2);
        expect(view.result.current.pending).toBe(false);
        expect(sendEdited).not.toHaveBeenCalled();
        expect(restoreComposer).not.toHaveBeenCalled();
    });

    it('surfaces a 409 CONVERSATION_NOT_IDLE as a readable "conversation is busy" message', async () => {
        const { view, rewindTurn } = setup();
        rewindTurn.mockRejectedValueOnce(apiError(409, 'CONVERSATION_NOT_IDLE', 'Conversation must be idle (not running, queued, or streaming) to rewind.'));

        act(() => view.result.current.startEdit(2));
        await act(async () => { await view.result.current.submitEdit(2, { text: 'edited', attachments: [] }); });

        expect(view.result.current.error).toMatch(/conversation is busy/i);
        expect(view.result.current.error).not.toMatch(/rewind/i);
    });

    it('passes other rewind errors through with the server message', async () => {
        const { view, rewindTurn } = setup();
        rewindTurn.mockRejectedValueOnce(apiError(400, 'TURN_NOT_REWINDABLE', 'Turn has no captured anchor.'));

        act(() => view.result.current.startEdit(2));
        await act(async () => { await view.result.current.submitEdit(2, { text: 'edited', attachments: [] }); });

        expect(view.result.current.error).toBe('Turn has no captured anchor.');
    });

    it('a send failure after a successful rewind closes the editor and parks the edit in the composer', async () => {
        const { view, didSendFail, restoreComposer, onError } = setup();
        didSendFail.mockReturnValue(true);

        act(() => view.result.current.startEdit(2));
        await act(async () => {
            await view.result.current.submitEdit(2, { text: 'edited', attachments: [IMAGE_ATTACHMENT] });
        });

        expect(view.result.current.editingTurnIndex).toBeNull();
        expect(restoreComposer).toHaveBeenCalledWith('edited', [IMAGE_ATTACHMENT]);
        expect(onError).toHaveBeenCalledWith(expect.stringMatching(/restored into the composer/i));
    });

    it('a refresh failure between rewind and send does not block the send', async () => {
        const { view, refreshConversation, sendEdited } = setup();
        refreshConversation.mockRejectedValueOnce(new Error('network'));

        act(() => view.result.current.startEdit(2));
        await act(async () => { await view.result.current.submitEdit(2, { text: 'edited', attachments: [] }); });

        expect(sendEdited).toHaveBeenCalledWith('edited', []);
    });

    it('is pending during the round trip and cannot be double-fired', async () => {
        let releaseRewind: (() => void) | null = null;
        const gate = new Promise<void>(resolve => { releaseRewind = resolve; });
        const { view, rewindTurn, sendEdited } = setup();
        rewindTurn.mockImplementationOnce(async () => { await gate; return {}; });

        act(() => view.result.current.startEdit(2));
        let first!: Promise<void>;
        await act(async () => {
            first = view.result.current.submitEdit(2, { text: 'edited', attachments: [] });
        });
        expect(view.result.current.pending).toBe(true);

        // Second click while in flight: dropped, and cancel is refused too.
        await act(async () => { await view.result.current.submitEdit(2, { text: 'other', attachments: [] }); });
        act(() => view.result.current.cancelEdit());
        expect(view.result.current.editingTurnIndex).toBe(2);

        await act(async () => { releaseRewind!(); await first; });
        expect(rewindTurn).toHaveBeenCalledTimes(1);
        expect(sendEdited).toHaveBeenCalledTimes(1);
        expect(view.result.current.pending).toBe(false);
    });

    it('does nothing without a processId', async () => {
        const { view, rewindTurn, sendEdited } = setup({ processId: null });
        act(() => view.result.current.startEdit(2));
        await act(async () => { await view.result.current.submitEdit(2, { text: 'edited', attachments: [] }); });
        expect(rewindTurn).not.toHaveBeenCalled();
        expect(sendEdited).not.toHaveBeenCalled();
    });
});
