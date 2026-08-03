import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewportWidth } from '../../../../src/server/spa/client/react/hooks/ui/useViewportWidth';

function setInnerWidth(px: number) {
    Object.defineProperty(window, 'innerWidth', { value: px, writable: true, configurable: true });
}

describe('useViewportWidth', () => {
    let originalWidth: number;

    beforeEach(() => {
        originalWidth = window.innerWidth;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        setInnerWidth(originalWidth);
    });

    it('returns the current window.innerWidth on mount', () => {
        setInnerWidth(1440);
        const { result } = renderHook(() => useViewportWidth());
        expect(result.current).toBe(1440);
    });

    it('updates (debounced) when the window is resized', () => {
        setInnerWidth(1000);
        const { result } = renderHook(() => useViewportWidth());
        expect(result.current).toBe(1000);

        act(() => {
            setInnerWidth(2200);
            window.dispatchEvent(new Event('resize'));
        });
        // Debounced: not applied until the timer fires.
        expect(result.current).toBe(1000);

        act(() => {
            vi.advanceTimersByTime(150);
        });
        expect(result.current).toBe(2200);
    });

    it('coalesces a burst of resize events into a single update', () => {
        setInnerWidth(800);
        const { result } = renderHook(() => useViewportWidth());

        act(() => {
            setInnerWidth(900);
            window.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(50);
            setInnerWidth(1300);
            window.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(50);
            setInnerWidth(1700);
            window.dispatchEvent(new Event('resize'));
        });
        // Still on the initial value — every tick reset the debounce timer.
        expect(result.current).toBe(800);

        act(() => {
            vi.advanceTimersByTime(150);
        });
        // Only the final width lands.
        expect(result.current).toBe(1700);
    });

    it('removes the resize listener on unmount', () => {
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => useViewportWidth());
        unmount();
        expect(removeSpy.mock.calls.map(c => c[0])).toContain('resize');
        removeSpy.mockRestore();
    });
});
