/**
 * Tests for useWhisperDiffPanelState — the open/close state hook for the
 * transient read-only whisper diff panel (AC-03). Covers open/close, the
 * mutual-exclusivity `onOpen` callback, and single-document replace-on-reopen.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWhisperDiffPanelState } from '../../../src/server/spa/client/react/features/chat/whisper-diff/useWhisperDiffPanelState';
import type { WhisperDiffOpenContext } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';

function makeCtx(path: string): WhisperDiffOpenContext {
    return {
        files: [
            {
                path,
                insertions: 1,
                deletions: 0,
                netInsertions: 1,
                netDeletions: 0,
                isCreate: false,
                isDeleted: false,
            },
        ],
        toolCalls: [],
        commits: [],
        workspaceId: 'ws1',
        focusPath: path,
    };
}

describe('useWhisperDiffPanelState', () => {
    it('starts closed with no context', () => {
        const { result } = renderHook(() => useWhisperDiffPanelState());
        expect(result.current.isOpen).toBe(false);
        expect(result.current.ctx).toBeNull();
    });

    it('open sets the context and flips isOpen', () => {
        const { result } = renderHook(() => useWhisperDiffPanelState());
        const ctx = makeCtx('src/a.ts');
        act(() => result.current.open(ctx));
        expect(result.current.isOpen).toBe(true);
        expect(result.current.ctx).toBe(ctx);
    });

    it('close clears the context', () => {
        const { result } = renderHook(() => useWhisperDiffPanelState());
        act(() => result.current.open(makeCtx('src/a.ts')));
        act(() => result.current.close());
        expect(result.current.isOpen).toBe(false);
        expect(result.current.ctx).toBeNull();
    });

    it('fires onOpen each time the panel opens (drives mutual exclusivity)', () => {
        const onOpen = vi.fn();
        const { result } = renderHook(() => useWhisperDiffPanelState({ onOpen }));
        act(() => result.current.open(makeCtx('src/a.ts')));
        act(() => result.current.open(makeCtx('src/b.ts')));
        expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it('does not fire onOpen on close', () => {
        const onOpen = vi.fn();
        const { result } = renderHook(() => useWhisperDiffPanelState({ onOpen }));
        act(() => result.current.open(makeCtx('src/a.ts')));
        onOpen.mockClear();
        act(() => result.current.close());
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('a new open replaces the prior content (single document, no tabs)', () => {
        const { result } = renderHook(() => useWhisperDiffPanelState());
        act(() => result.current.open(makeCtx('src/a.ts')));
        const second = makeCtx('src/b.ts');
        act(() => result.current.open(second));
        expect(result.current.ctx).toBe(second);
    });

    it('keeps stable open/close identities across re-renders', () => {
        const { result, rerender } = renderHook(() => useWhisperDiffPanelState());
        const firstOpen = result.current.open;
        const firstClose = result.current.close;
        rerender();
        expect(result.current.open).toBe(firstOpen);
        expect(result.current.close).toBe(firstClose);
    });
});
