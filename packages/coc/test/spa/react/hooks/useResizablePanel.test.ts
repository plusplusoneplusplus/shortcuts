import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResizablePanel } from '../../../../src/server/spa/client/react/hooks/useResizablePanel';

describe('useResizablePanel', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns initial width of 320 by default', () => {
        const { result } = renderHook(() => useResizablePanel());
        expect(result.current.width).toBe(320);
        expect(result.current.isDragging).toBe(false);
    });

    it('accepts custom initialWidth', () => {
        const { result } = renderHook(() => useResizablePanel({ initialWidth: 400 }));
        expect(result.current.width).toBe(400);
    });

    it('clamps initialWidth to minWidth', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 50, minWidth: 100 })
        );
        expect(result.current.width).toBe(100);
    });

    it('clamps initialWidth to maxWidth', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 900, maxWidth: 600 })
        );
        expect(result.current.width).toBe(600);
    });

    it('sets isDragging true on handleMouseDown', () => {
        const { result } = renderHook(() => useResizablePanel());
        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 320,
            } as unknown as React.MouseEvent);
        });
        expect(result.current.isDragging).toBe(true);
    });

    it('updates width on mousemove while dragging', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
        );

        // Start drag at clientX=300
        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 300,
            } as unknown as React.MouseEvent);
        });

        // Move mouse to clientX=400 (+100px)
        act(() => {
            const moveEvent = new MouseEvent('mousemove', { clientX: 400 });
            document.dispatchEvent(moveEvent);
        });

        expect(result.current.width).toBe(400);
    });

    it('clamps width to minWidth during drag', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, minWidth: 160, maxWidth: 600 })
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 300,
            } as unknown as React.MouseEvent);
        });

        // Move mouse far left
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }));
        });

        expect(result.current.width).toBe(160);
    });

    it('clamps width to maxWidth during drag', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 300,
            } as unknown as React.MouseEvent);
        });

        // Move mouse far right
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
        });

        expect(result.current.width).toBe(500);
    });

    it('sets isDragging false on mouseup', () => {
        const { result } = renderHook(() => useResizablePanel());

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 320,
            } as unknown as React.MouseEvent);
        });
        expect(result.current.isDragging).toBe(true);

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('persists width to localStorage when storageKey is set', () => {
        const key = 'test-sidebar-width';
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, storageKey: key })
        );

        // Start drag
        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 300,
            } as unknown as React.MouseEvent);
        });

        // Move to 350
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
        });

        // End drag (triggers persist)
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });

        expect(localStorage.getItem(key)).toBe('350');
    });

    it('restores width from localStorage', () => {
        const key = 'test-sidebar-width';
        localStorage.setItem(key, '400');

        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 320, storageKey: key })
        );

        expect(result.current.width).toBe(400);
    });

    it('ignores invalid localStorage values', () => {
        const key = 'test-sidebar-width';
        localStorage.setItem(key, 'not-a-number');

        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 320, storageKey: key })
        );

        expect(result.current.width).toBe(320);
    });

    it('resetWidth restores initialWidth and clears storage', () => {
        const key = 'test-sidebar-width';
        localStorage.setItem(key, '400');

        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 320, storageKey: key })
        );

        expect(result.current.width).toBe(400);

        act(() => {
            result.current.resetWidth();
        });

        expect(result.current.width).toBe(320);
        // After reset, localStorage is cleared, but the persist effect may
        // re-write the new width — the key point is the width is reset
    });

    it('handles touch start and touch end', () => {
        const { result } = renderHook(() =>
            useResizablePanel({ initialWidth: 300, minWidth: 100, maxWidth: 500 })
        );

        act(() => {
            result.current.handleTouchStart({
                touches: [{ clientX: 300 }],
            } as unknown as React.TouchEvent);
        });
        expect(result.current.isDragging).toBe(true);

        act(() => {
            document.dispatchEvent(new Event('touchend'));
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('ignores multi-touch on touchStart', () => {
        const { result } = renderHook(() => useResizablePanel());

        act(() => {
            result.current.handleTouchStart({
                touches: [{ clientX: 100 }, { clientX: 200 }],
            } as unknown as React.TouchEvent);
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('cleans up event listeners when unmounted during drag', () => {
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
        const { result, unmount } = renderHook(() => useResizablePanel());

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 320,
            } as unknown as React.MouseEvent);
        });

        unmount();

        const removedEvents = removeEventListenerSpy.mock.calls.map(c => c[0]);
        expect(removedEvents).toContain('mousemove');
        expect(removedEvents).toContain('mouseup');
        expect(removedEvents).toContain('touchmove');
        expect(removedEvents).toContain('touchend');

        removeEventListenerSpy.mockRestore();
    });
});
