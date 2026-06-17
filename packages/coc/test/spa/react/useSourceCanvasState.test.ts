/**
 * Tests for useSourceCanvasState — the open/close state hook for the docked
 * source-file canvas (AC-02). Covers open/close, the mutual-exclusivity
 * `onOpen` callback, and single-document replace-on-reopen.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSourceCanvasState } from '../../../src/server/spa/client/react/features/chat/source-canvas/useSourceCanvasState';

describe('useSourceCanvasState', () => {
    it('starts closed with no file ref', () => {
        const { result } = renderHook(() => useSourceCanvasState());
        expect(result.current.isOpen).toBe(false);
        expect(result.current.fileRef).toBeNull();
    });

    it('open sets the file ref and flips isOpen', () => {
        const { result } = renderHook(() => useSourceCanvasState());
        act(() => result.current.open({ fullPath: '/a/b.ts', line: 42 }));
        expect(result.current.isOpen).toBe(true);
        expect(result.current.fileRef).toEqual({ fullPath: '/a/b.ts', line: 42 });
    });

    it('close clears the file ref', () => {
        const { result } = renderHook(() => useSourceCanvasState());
        act(() => result.current.open({ fullPath: '/a/b.ts' }));
        act(() => result.current.close());
        expect(result.current.isOpen).toBe(false);
        expect(result.current.fileRef).toBeNull();
    });

    it('fires onOpen each time the canvas opens (drives mutual exclusivity)', () => {
        const onOpen = vi.fn();
        const { result } = renderHook(() => useSourceCanvasState({ onOpen }));
        act(() => result.current.open({ fullPath: '/a/b.ts' }));
        act(() => result.current.open({ fullPath: '/c/d.ts' }));
        expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it('does not fire onOpen on close', () => {
        const onOpen = vi.fn();
        const { result } = renderHook(() => useSourceCanvasState({ onOpen }));
        act(() => result.current.open({ fullPath: '/a/b.ts' }));
        onOpen.mockClear();
        act(() => result.current.close());
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('a new open replaces the prior content (single document, no tabs)', () => {
        const { result } = renderHook(() => useSourceCanvasState());
        act(() => result.current.open({ fullPath: '/a/b.ts', line: 1 }));
        act(() => result.current.open({ fullPath: '/c/d.ts', line: 5, endLine: 9 }));
        expect(result.current.fileRef).toEqual({ fullPath: '/c/d.ts', line: 5, endLine: 9 });
    });

    it('keeps stable open/close identities across re-renders', () => {
        const { result, rerender } = renderHook(() => useSourceCanvasState());
        const firstOpen = result.current.open;
        const firstClose = result.current.close;
        rerender();
        expect(result.current.open).toBe(firstOpen);
        expect(result.current.close).toBe(firstClose);
    });
});
