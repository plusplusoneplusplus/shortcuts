import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_QUICK_ASK_TURNS, patchQuickAskTurn, quickAskHistory, useDocumentQuickAskSelection,
    useDocumentQuickAskThread, type DocumentQuickAskThread,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/useDocumentQuickAsk';
import type { QuickAskSelection } from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

const { readSelection } = vi.hoisted(() => ({ readSelection: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/features/chat/quick-ask/quick-ask-selection', () => ({
    getQuickAskSelection: readSelection,
}));

const selection: QuickAskSelection = {
    turnIndex: 0, selectedText: 'selected phrase', contextBefore: 'before', contextAfter: 'after',
    rect: { top: 10, left: 20, right: 80, bottom: 30 },
};

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('document Quick Ask thread', () => {
    it('shares optimistic, answer, follow-up, retry and history transitions without losing document metadata', () => {
        const { result } = renderHook(() => useDocumentQuickAskThread<{ paper: boolean }>('owner'));
        let started!: DocumentQuickAskThread & { paper: boolean };
        act(() => { started = result.current.start(selection, 'First?', 'note', { paper: true }); });
        expect(started.note.status).toBe('asking');
        expect(started.position).toEqual({ top: 36, left: 20 });
        act(() => result.current.setOpen(prev => patchQuickAskTurn(prev, 'note', 0, { status: 'ready', answer: 'First answer' })));
        const post = vi.fn();
        act(() => result.current.advance('Next?', post));
        const next = result.current.open!;
        expect(next.paper).toBe(true);
        expect(quickAskHistory(next.turns, 1)).toEqual([{ question: 'First?', answer: 'First answer' }]);
        expect(post).toHaveBeenCalledWith(next, 1);
        act(() => result.current.setOpen(prev => patchQuickAskTurn(prev, 'note', 1, { status: 'error', error: 'Lookup failed' })));
        act(() => result.current.advance(1, post));
        expect(result.current.open!.turns[1]).toMatchObject({ question: 'Next?', status: 'asking', error: undefined });
        expect(result.current.open!.turns[0].answer).toBe('First answer');
        expect(patchQuickAskTurn(result.current.open, 'different-note', 0, { answer: 'stale' })).toBe(result.current.open);
        expect(patchQuickAskTurn(result.current.open, 'note', 12, { answer: 'stale' })).toBe(result.current.open);
    });

    it('caps follow-ups and ignores nonexistent retries', () => {
        const { result } = renderHook(() => useDocumentQuickAskThread('owner'));
        const post = vi.fn();
        act(() => { result.current.start(selection, undefined, 'note', {}); });
        for (let i = 1; i < MAX_QUICK_ASK_TURNS + 2; i++) act(() => result.current.advance('Next', post));
        act(() => result.current.advance(100, post));
        expect(result.current.open!.turns).toHaveLength(MAX_QUICK_ASK_TURNS);
        expect(post).toHaveBeenCalledTimes(MAX_QUICK_ASK_TURNS - 1);
    });

    it('invalidates superseded attempts and owner/unmount requests, but dismissal permits persistence', () => {
        const { result, rerender, unmount } = renderHook(({ owner }) => useDocumentQuickAskThread(owner), {
            initialProps: { owner: 'remote-a:workspace' },
        });
        const first = result.current.beginRequest('note', 0);
        const retry = result.current.beginRequest('note', 0);
        expect(first.signal.aborted).toBe(true);
        expect(first.isCurrent()).toBe(false);
        act(() => result.current.closePopover());
        expect(retry.isCurrent()).toBe(true);
        rerender({ owner: 'remote-b:workspace' });
        expect(retry.signal.aborted).toBe(true);
        expect(retry.isCurrent()).toBe(false);
        expect(result.current.open).toBeNull();
        const last = result.current.beginRequest('note', 1);
        unmount();
        expect(last.signal.aborted).toBe(true);
        expect(last.isCurrent()).toBe(false);
    });
});

describe('document Quick Ask selection', () => {
    it('captures document anchors before clearing keyboard selection and dismisses outside input', () => {
        const element = document.createElement('div');
        const containerRef = { current: element };
        const removeRanges = vi.fn();
        vi.spyOn(window, 'getSelection').mockReturnValue({ removeAllRanges: removeRanges } as unknown as Selection);
        readSelection.mockReturnValue(selection);
        const beforeInput = vi.fn(() => expect(removeRanges).not.toHaveBeenCalled());
        const { result } = renderHook(() => useDocumentQuickAskSelection(containerRef, true, 'owner', beforeInput));
        fireEvent.keyDown(document, { key: 'J', ctrlKey: true });
        expect(beforeInput).toHaveBeenCalledOnce();
        expect(removeRanges).toHaveBeenCalledOnce();
        expect(result.current.input).toBe(selection);
        const input = document.createElement('div');
        input.dataset.testid = 'quick-ask-input';
        document.body.append(input);
        fireEvent.mouseDown(input);
        expect(result.current.input).toBe(selection);
        fireEvent.mouseDown(document.body);
        expect(result.current.input).toBeNull();
        input.remove();
    });

    it('cancels delayed pointer capture on owner changes, disabling and unmount', () => {
        vi.useFakeTimers();
        readSelection.mockReset();
        readSelection.mockReturnValue(selection);
        const containerRef = { current: document.createElement('div') };
        const { result, rerender, unmount } = renderHook(
            ({ owner, enabled }) => useDocumentQuickAskSelection(containerRef, enabled, owner),
            { initialProps: { owner: 'a', enabled: true } },
        );
        fireEvent.mouseUp(document);
        rerender({ owner: 'b', enabled: true });
        act(() => vi.runAllTimers());
        expect(readSelection).not.toHaveBeenCalled();
        fireEvent.mouseUp(document);
        act(() => vi.runAllTimers());
        expect(result.current.selection).toBe(selection);
        rerender({ owner: 'b', enabled: false });
        expect(result.current.selection).toBeNull();
        rerender({ owner: 'b', enabled: true });
        fireEvent.mouseUp(document);
        unmount();
        act(() => vi.runAllTimers());
        expect(readSelection).toHaveBeenCalledOnce();
    });
});
