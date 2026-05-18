/**
 * Tests for useSwipeReveal hook.
 *
 * Covers:
 * - Left swipe reveals action buttons (translateX goes negative)
 * - Right swipe triggers callback
 * - Spring-back below threshold
 * - Direction lock (vertical swipe ignored)
 * - Single-row exclusivity (closing when another row reveals)
 * - Disabled flag prevents gesture
 * - Swipe detection cancels long-press (onSwipeDetected callback)
 * - Tap on revealed row closes it
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useSwipeReveal,
    SWIPE_LEFT_MAX,
    SWIPE_LEFT_THRESHOLD,
    SWIPE_RIGHT_THRESHOLD,
    SWIPE_DETECT_THRESHOLD,
} from '../../../../src/server/spa/client/react/hooks/ui/useSwipeReveal';

function makeTouchEvent(x: number, y: number, numTouches = 1): React.TouchEvent {
    const touch = { clientX: x, clientY: y } as Touch;
    const touches = Array.from({ length: numTouches }, () => touch) as unknown as TouchList;
    return {
        touches,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as React.TouchEvent;
}

describe('useSwipeReveal', () => {
    const defaultOptions = {
        rowId: 'row-1',
        activeRowId: null as string | null,
        onReveal: vi.fn(),
        onClose: vi.fn(),
        onSwipeRight: vi.fn(),
        onSwipeDetected: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('exports threshold constants', () => {
        it('SWIPE_LEFT_MAX is 180', () => {
            expect(SWIPE_LEFT_MAX).toBe(180);
        });

        it('SWIPE_LEFT_THRESHOLD is 90', () => {
            expect(SWIPE_LEFT_THRESHOLD).toBe(90);
        });

        it('SWIPE_RIGHT_THRESHOLD is 60', () => {
            expect(SWIPE_RIGHT_THRESHOLD).toBe(60);
        });

        it('SWIPE_DETECT_THRESHOLD is 15', () => {
            expect(SWIPE_DETECT_THRESHOLD).toBe(15);
        });
    });

    describe('left swipe — reveals action buttons', () => {
        it('produces negative translateX when swiping left', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(200, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 100)); });

            expect(result.current.translateX).toBeLessThan(0);
            expect(result.current.isSwiping).toBe(true);
        });

        it('snaps open when swipe exceeds threshold and calls onReveal', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(200, 100)); });
            // Move left beyond threshold (SWIPE_LEFT_THRESHOLD = 90)
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 100)); });
            act(() => { result.current.handlers.onTouchEnd(); });

            expect(result.current.translateX).toBe(-SWIPE_LEFT_MAX);
            expect(defaultOptions.onReveal).toHaveBeenCalledWith('row-1');
        });

        it('springs back when swipe is below threshold', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(200, 100)); });
            // Move left only 50px (below 90px threshold)
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(150, 100)); });
            act(() => { result.current.handlers.onTouchEnd(); });

            expect(result.current.translateX).toBe(0);
            expect(defaultOptions.onReveal).not.toHaveBeenCalled();
        });

        it('clamps translateX to -SWIPE_LEFT_MAX', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(300, 100)); });
            // Move left by 250px (beyond max)
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(50, 100)); });

            expect(result.current.translateX).toBe(-SWIPE_LEFT_MAX);
        });
    });

    describe('right swipe — triggers callback', () => {
        it('calls onSwipeRight when swipe exceeds threshold', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });
            // Move right beyond threshold (SWIPE_RIGHT_THRESHOLD = 60)
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(200, 100)); });
            act(() => { result.current.handlers.onTouchEnd(); });

            expect(defaultOptions.onSwipeRight).toHaveBeenCalledWith('row-1');
            // Springs back after right swipe
            expect(result.current.translateX).toBe(0);
        });

        it('does not call onSwipeRight when swipe is below threshold', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });
            // Move right only 30px (below 60px threshold)
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(130, 100)); });
            act(() => { result.current.handlers.onTouchEnd(); });

            expect(defaultOptions.onSwipeRight).not.toHaveBeenCalled();
            expect(result.current.translateX).toBe(0);
        });

        it('applies resistance to right swipe offset', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(200, 100)); });

            // Right swipe applies 0.4 damping: 100 * 0.4 = 40
            expect(result.current.translateX).toBe(40);
        });
    });

    describe('direction lock', () => {
        it('ignores vertical swipe (no translateX change)', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });
            // Move vertically
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 200)); });

            expect(result.current.translateX).toBe(0);
        });

        it('locks direction once determined', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });
            // First move: vertical — locks to vertical
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(102, 115)); });
            // Second move: horizontal — but direction is locked to vertical, so ignored
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(200, 115)); });

            expect(result.current.translateX).toBe(0);
        });
    });

    describe('single-row exclusivity', () => {
        it('resets translateX when another row becomes active', () => {
            const { result, rerender } = renderHook(
                (props) => useSwipeReveal(props),
                { initialProps: { ...defaultOptions, activeRowId: 'row-1' as string | null } },
            );

            // Simulate this row being swiped open
            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(200, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 100)); });
            act(() => { result.current.handlers.onTouchEnd(); });

            expect(result.current.translateX).toBe(-SWIPE_LEFT_MAX);

            // Another row becomes active
            rerender({ ...defaultOptions, activeRowId: 'row-2' });

            expect(result.current.translateX).toBe(0);
        });
    });

    describe('swipe detection — cancels long-press', () => {
        it('calls onSwipeDetected when horizontal movement exceeds detect threshold', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });
            // Move by SWIPE_DETECT_THRESHOLD + 1 = 16px
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100 - SWIPE_DETECT_THRESHOLD - 1, 100)); });

            expect(defaultOptions.onSwipeDetected).toHaveBeenCalledTimes(1);
        });

        it('does not call onSwipeDetected for small movements', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });
            // Move by 10px (below 15px threshold)
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(90, 100)); });

            expect(defaultOptions.onSwipeDetected).not.toHaveBeenCalled();
        });

        it('calls onSwipeDetected only once per gesture', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(80, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(60, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(40, 100)); });

            expect(defaultOptions.onSwipeDetected).toHaveBeenCalledTimes(1);
        });
    });

    describe('disabled flag', () => {
        it('returns translateX 0 when disabled', () => {
            const { result } = renderHook(() =>
                useSwipeReveal({ ...defaultOptions, disabled: true }),
            );

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(200, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 100)); });

            expect(result.current.translateX).toBe(0);
        });

        it('does not call onReveal when disabled', () => {
            const { result } = renderHook(() =>
                useSwipeReveal({ ...defaultOptions, disabled: true }),
            );

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(200, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(50, 100)); });
            act(() => { result.current.handlers.onTouchEnd(); });

            expect(defaultOptions.onReveal).not.toHaveBeenCalled();
        });
    });

    describe('tap on revealed row', () => {
        it('closes the revealed row when tapped and calls onClose', () => {
            const { result, rerender } = renderHook(
                (props) => useSwipeReveal(props),
                { initialProps: { ...defaultOptions, activeRowId: 'row-1' as string | null } },
            );

            // Open via swipe
            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(200, 100)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 100)); });
            act(() => { result.current.handlers.onTouchEnd(); });

            expect(result.current.translateX).toBe(-SWIPE_LEFT_MAX);

            // Re-render to sync isRevealed
            rerender({ ...defaultOptions, activeRowId: 'row-1' });

            // Tap (touchStart on revealed row)
            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(100, 100)); });

            expect(result.current.translateX).toBe(0);
            expect(defaultOptions.onClose).toHaveBeenCalled();
        });
    });

    describe('multi-touch ignored', () => {
        it('ignores multi-touch start', () => {
            const { result } = renderHook(() => useSwipeReveal(defaultOptions));

            act(() => { result.current.handlers.onTouchStart(makeTouchEvent(200, 100, 2)); });
            act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 100)); });

            expect(result.current.translateX).toBe(0);
            expect(result.current.isSwiping).toBe(false);
        });
    });
});
