/**
 * useLongPress — touch long-press gesture hook.
 *
 * Returns touch event handlers that detect a long-press gesture and invoke
 * `onLongPress(x, y)` after the configured delay, cancelling if the finger
 * moves beyond `moveThreshold` pixels.
 *
 * `didLongPress()` lets callers suppress the `onClick` that fires immediately
 * after `touchend`.
 */

import { useRef, useEffect } from 'react';

export interface UseLongPressOptions {
    /** Milliseconds to hold before long-press fires. Default: 500. */
    delay?: number;
    /** Pixel movement budget before the press is cancelled. Default: 10. */
    moveThreshold?: number;
    /**
     * When true, cancels any in-progress long-press timer.
     * Useful to pass `!!draggedTaskId` so a drag start (at 300 ms) cancels
     * the context-menu timer (at 500 ms) for queued items.
     */
    cancelSignal?: boolean;
}

export interface UseLongPressResult {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchMove: (e: React.TouchEvent) => void;
    /** Returns true (and resets the flag) if the last event was a long press. */
    didLongPress: () => boolean;
}

export function useLongPress(
    onLongPress: (x: number, y: number) => void,
    options: UseLongPressOptions = {},
): UseLongPressResult {
    const { delay = 500, moveThreshold = 10, cancelSignal = false } = options;

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const firedRef = useRef(false);
    const startPosRef = useRef({ x: 0, y: 0 });
    // Keep a stable ref so the timer closure always calls the latest callback
    const onLongPressRef = useRef(onLongPress);
    onLongPressRef.current = onLongPress;

    const cancel = () => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    // Cancel in-progress timer whenever the external signal becomes true
    // (e.g. drag-and-drop activates at 300 ms, before the 500 ms context menu)
    useEffect(() => {
        if (cancelSignal) cancel();
    }, [cancelSignal]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        onTouchStart: (e: React.TouchEvent) => {
            firedRef.current = false;
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            startPosRef.current = { x: touch.clientX, y: touch.clientY };
            const x = touch.clientX;
            const y = touch.clientY;
            timerRef.current = setTimeout(() => {
                firedRef.current = true;
                timerRef.current = null;
                onLongPressRef.current(x, y);
            }, delay);
        },
        onTouchEnd: cancel,
        onTouchMove: (e: React.TouchEvent) => {
            if (timerRef.current === null) return;
            const touch = e.touches[0];
            if (!touch) { cancel(); return; }
            const dx = touch.clientX - startPosRef.current.x;
            const dy = touch.clientY - startPosRef.current.y;
            if (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) {
                cancel();
            }
        },
        didLongPress: () => {
            if (firedRef.current) {
                firedRef.current = false;
                return true;
            }
            return false;
        },
    };
}
