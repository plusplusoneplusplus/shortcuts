/**
 * Tests for useLongPress hook.
 *
 * Covers:
 * - Happy path: long press fires after delay
 * - Move threshold: cancels when finger moves beyond threshold
 * - Touch end: cancels in-progress timer
 * - Multi-touch: ignored (no-op)
 * - Click suppression via didLongPress()
 * - cancelSignal: cancels timer when it becomes true
 * - Default options (delay=500, moveThreshold=10)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLongPress } from '../../../../src/server/spa/client/react/hooks/ui/useLongPress';

// Minimal touch event helpers
function makeTouchEvent(x: number, y: number, numTouches = 1): React.TouchEvent {
    const touch = { clientX: x, clientY: y } as Touch;
    const touches = Array.from({ length: numTouches }, () => touch) as unknown as TouchList;
    return {
        touches,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as React.TouchEvent;
}

describe('useLongPress', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('happy path — fires after delay', () => {
        it('calls onLongPress with touch coordinates after 500 ms', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress));

            act(() => { result.current.onTouchStart(makeTouchEvent(100, 200)); });
            expect(onLongPress).not.toHaveBeenCalled();

            act(() => { vi.advanceTimersByTime(500); });
            expect(onLongPress).toHaveBeenCalledOnce();
            expect(onLongPress).toHaveBeenCalledWith(100, 200);
        });

        it('does not fire before the delay elapses', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress));

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0)); });
            act(() => { vi.advanceTimersByTime(499); });
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('respects a custom delay option', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress, { delay: 800 }));

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0)); });
            act(() => { vi.advanceTimersByTime(799); });
            expect(onLongPress).not.toHaveBeenCalled();

            act(() => { vi.advanceTimersByTime(1); });
            expect(onLongPress).toHaveBeenCalledOnce();
        });
    });

    describe('cancellation — touchEnd', () => {
        it('cancels timer on touchEnd', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress));

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0)); });
            act(() => { result.current.onTouchEnd(); });
            act(() => { vi.advanceTimersByTime(500); });
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('is safe to call touchEnd when no timer is running', () => {
            const { result } = renderHook(() => useLongPress(vi.fn()));
            expect(() => act(() => result.current.onTouchEnd())).not.toThrow();
        });
    });

    describe('cancellation — touchMove', () => {
        it('cancels when finger moves beyond default threshold (10 px) horizontally', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress));

            act(() => { result.current.onTouchStart(makeTouchEvent(100, 100)); });
            act(() => { result.current.onTouchMove(makeTouchEvent(111, 100)); }); // dx=11 > 10
            act(() => { vi.advanceTimersByTime(500); });
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('cancels when finger moves beyond threshold vertically', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress));

            act(() => { result.current.onTouchStart(makeTouchEvent(100, 100)); });
            act(() => { result.current.onTouchMove(makeTouchEvent(100, 112)); }); // dy=12 > 10
            act(() => { vi.advanceTimersByTime(500); });
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('does NOT cancel when finger moves within threshold', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress));

            act(() => { result.current.onTouchStart(makeTouchEvent(100, 100)); });
            act(() => { result.current.onTouchMove(makeTouchEvent(105, 103)); }); // dx=5, dy=3 — both ≤10
            act(() => { vi.advanceTimersByTime(500); });
            expect(onLongPress).toHaveBeenCalledOnce();
        });

        it('respects a custom moveThreshold option', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress, { moveThreshold: 5 }));

            act(() => { result.current.onTouchStart(makeTouchEvent(100, 100)); });
            act(() => { result.current.onTouchMove(makeTouchEvent(106, 100)); }); // dx=6 > 5
            act(() => { vi.advanceTimersByTime(500); });
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('is a no-op when no timer is running', () => {
            const { result } = renderHook(() => useLongPress(vi.fn()));
            expect(() => act(() => result.current.onTouchMove(makeTouchEvent(200, 200)))).not.toThrow();
        });
    });

    describe('multi-touch', () => {
        it('ignores touchStart with more than one finger', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress));

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0, 2)); });
            act(() => { vi.advanceTimersByTime(500); });
            expect(onLongPress).not.toHaveBeenCalled();
        });
    });

    describe('click suppression via didLongPress()', () => {
        it('returns true immediately after long press fires', () => {
            const { result } = renderHook(() => useLongPress(vi.fn()));

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0)); });
            act(() => { vi.advanceTimersByTime(500); });
            expect(result.current.didLongPress()).toBe(true);
        });

        it('resets flag after didLongPress() returns true', () => {
            const { result } = renderHook(() => useLongPress(vi.fn()));

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0)); });
            act(() => { vi.advanceTimersByTime(500); });
            result.current.didLongPress(); // consume
            expect(result.current.didLongPress()).toBe(false);
        });

        it('returns false when long press has not fired', () => {
            const { result } = renderHook(() => useLongPress(vi.fn()));
            expect(result.current.didLongPress()).toBe(false);
        });

        it('returns false after timer was cancelled', () => {
            const { result } = renderHook(() => useLongPress(vi.fn()));

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0)); });
            act(() => { result.current.onTouchEnd(); });
            expect(result.current.didLongPress()).toBe(false);
        });
    });

    describe('cancelSignal', () => {
        it('cancels in-progress timer when cancelSignal becomes true', () => {
            const onLongPress = vi.fn();
            let signal = false;
            const { result, rerender } = renderHook(
                ({ sig }) => useLongPress(onLongPress, { cancelSignal: sig }),
                { initialProps: { sig: false } },
            );

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0)); });

            // Simulate drag activating at 300 ms
            act(() => {
                vi.advanceTimersByTime(300);
                signal = true;
            });
            rerender({ sig: signal });

            act(() => { vi.advanceTimersByTime(200); }); // would have been 500 ms total
            expect(onLongPress).not.toHaveBeenCalled();
        });

        it('does nothing when cancelSignal is false', () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress(onLongPress, { cancelSignal: false }));

            act(() => { result.current.onTouchStart(makeTouchEvent(0, 0)); });
            act(() => { vi.advanceTimersByTime(500); });
            expect(onLongPress).toHaveBeenCalledOnce();
        });
    });
});
