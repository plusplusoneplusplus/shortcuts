/**
 * Tests for useSwipeToArchive hook.
 *
 * Covers:
 * - Swipe beyond threshold fires onSwipeConfirm
 * - Swipe below threshold snaps back (offset resets to 0)
 * - Vertical scroll is not blocked (direction lock)
 * - Disabled flag prevents gesture
 * - Only left (negative) swipe values are produced
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwipeToArchive, SWIPE_ARCHIVE_THRESHOLD } from '../../../../src/server/spa/client/react/hooks/useSwipeToArchive';

function makeTouchEvent(x: number, y: number): React.TouchEvent {
    const touch = { clientX: x, clientY: y } as Touch;
    return {
        touches: [touch] as unknown as TouchList,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as React.TouchEvent;
}

function makeTouchStartEvent(x: number, y: number): React.TouchEvent {
    const touch = { clientX: x, clientY: y } as Touch;
    return {
        touches: { 0: touch, length: 1 } as unknown as TouchList,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as React.TouchEvent;
}

describe('useSwipeToArchive', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('exports a threshold constant', () => {
        expect(SWIPE_ARCHIVE_THRESHOLD).toBe(80);
    });

    it('fires onSwipeConfirm when swipe exceeds threshold', () => {
        const onSwipeConfirm = vi.fn();
        const { result } = renderHook(() =>
            useSwipeToArchive({ onSwipeConfirm, enabled: true }),
        );

        // Start touch at x=200
        act(() => { result.current.handlers.onTouchStart(makeTouchStartEvent(200, 100)); });

        // Move left by 100px (beyond 80px threshold)
        act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 100)); });
        expect(result.current.isSwiping).toBe(true);
        expect(result.current.swipeOffset).toBeLessThan(0);

        // Release
        act(() => { result.current.handlers.onTouchEnd(); });
        expect(result.current.isExiting).toBe(true);

        // After animation timeout, confirm fires
        act(() => { vi.advanceTimersByTime(200); });
        expect(onSwipeConfirm).toHaveBeenCalledOnce();
    });

    it('snaps back when swipe is below threshold', () => {
        const onSwipeConfirm = vi.fn();
        const { result } = renderHook(() =>
            useSwipeToArchive({ onSwipeConfirm, enabled: true }),
        );

        act(() => { result.current.handlers.onTouchStart(makeTouchStartEvent(200, 100)); });
        // Move only 30px left (below 80px threshold)
        act(() => { result.current.handlers.onTouchMove(makeTouchEvent(170, 100)); });
        act(() => { result.current.handlers.onTouchEnd(); });

        expect(onSwipeConfirm).not.toHaveBeenCalled();
        expect(result.current.swipeOffset).toBe(0);
        expect(result.current.isSwiping).toBe(false);
    });

    it('does not activate for vertical scroll (direction lock)', () => {
        const onSwipeConfirm = vi.fn();
        const { result } = renderHook(() =>
            useSwipeToArchive({ onSwipeConfirm, enabled: true }),
        );

        act(() => { result.current.handlers.onTouchStart(makeTouchStartEvent(200, 100)); });
        // Move primarily vertical
        act(() => { result.current.handlers.onTouchMove(makeTouchEvent(198, 200)); });

        expect(result.current.isSwiping).toBe(false);
        expect(result.current.swipeOffset).toBe(0);
    });

    it('does nothing when enabled is false', () => {
        const onSwipeConfirm = vi.fn();
        const { result } = renderHook(() =>
            useSwipeToArchive({ onSwipeConfirm, enabled: false }),
        );

        act(() => { result.current.handlers.onTouchStart(makeTouchStartEvent(200, 100)); });
        act(() => { result.current.handlers.onTouchMove(makeTouchEvent(100, 100)); });
        act(() => { result.current.handlers.onTouchEnd(); });

        expect(result.current.swipeOffset).toBe(0);
        expect(onSwipeConfirm).not.toHaveBeenCalled();
    });

    it('only produces negative (left) offset values', () => {
        const onSwipeConfirm = vi.fn();
        const { result } = renderHook(() =>
            useSwipeToArchive({ onSwipeConfirm, enabled: true }),
        );

        act(() => { result.current.handlers.onTouchStart(makeTouchStartEvent(200, 100)); });
        // Swipe right (positive dx) — should be clamped to 0
        act(() => { result.current.handlers.onTouchMove(makeTouchEvent(300, 100)); });

        expect(result.current.swipeOffset).toBe(0);
    });

    it('clamps offset to -200 max', () => {
        const onSwipeConfirm = vi.fn();
        const { result } = renderHook(() =>
            useSwipeToArchive({ onSwipeConfirm, enabled: true }),
        );

        act(() => { result.current.handlers.onTouchStart(makeTouchStartEvent(200, 100)); });
        // Swipe very far left (-300)
        act(() => { result.current.handlers.onTouchMove(makeTouchEvent(-100, 100)); });

        expect(result.current.swipeOffset).toBe(-200);
    });

    it('respects custom threshold', () => {
        const onSwipeConfirm = vi.fn();
        const { result } = renderHook(() =>
            useSwipeToArchive({ onSwipeConfirm, enabled: true, threshold: 40 }),
        );

        act(() => { result.current.handlers.onTouchStart(makeTouchStartEvent(200, 100)); });
        act(() => { result.current.handlers.onTouchMove(makeTouchEvent(150, 100)); });
        act(() => { result.current.handlers.onTouchEnd(); });

        // 50px > 40px threshold → should confirm
        expect(result.current.isExiting).toBe(true);
        act(() => { vi.advanceTimersByTime(200); });
        expect(onSwipeConfirm).toHaveBeenCalledOnce();
    });

    it('calls preventDefault on touchmove when horizontal swipe is detected', () => {
        const onSwipeConfirm = vi.fn();
        const { result } = renderHook(() =>
            useSwipeToArchive({ onSwipeConfirm, enabled: true }),
        );

        act(() => { result.current.handlers.onTouchStart(makeTouchStartEvent(200, 100)); });
        const moveEvent = makeTouchEvent(100, 100);
        act(() => { result.current.handlers.onTouchMove(moveEvent); });

        expect(moveEvent.preventDefault).toHaveBeenCalled();
    });
});
