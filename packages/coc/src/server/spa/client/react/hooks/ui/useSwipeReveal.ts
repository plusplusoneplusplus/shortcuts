/**
 * useSwipeReveal — bidirectional swipe gesture hook for commit rows.
 *
 * Swipe left: reveals action buttons on the right side of the row.
 * Swipe right: triggers a callback (e.g. toggle selection).
 *
 * Features:
 * - Spring-back animation below threshold, snap-open above threshold
 * - Only one row can be swiped open at a time (managed via activeRowId)
 * - Horizontal movement > 15px cancels any in-progress long-press
 * - Direction lock: once the swipe direction is determined, it's locked
 */

import { useState, useRef, useCallback, useEffect } from 'react';

/** Max pixel offset when action buttons are fully revealed (swipe left). */
export const SWIPE_LEFT_MAX = 180;
/** Pixel threshold for snapping open vs springing back (swipe left). */
export const SWIPE_LEFT_THRESHOLD = 90;
/** Pixel threshold for triggering the right-swipe callback. */
export const SWIPE_RIGHT_THRESHOLD = 60;
/** Horizontal movement (px) that indicates a swipe is in progress (cancels long-press). */
export const SWIPE_DETECT_THRESHOLD = 15;

export interface UseSwipeRevealOptions {
    /** Unique ID for this row (used for single-row exclusivity). */
    rowId: string;
    /** Currently active (swiped-open) row ID. Null if none. */
    activeRowId: string | null;
    /** Called when this row becomes the active swiped-open row (swipe left). */
    onReveal: (rowId: string) => void;
    /** Called when the active row should be closed. */
    onClose: () => void;
    /** Called when a right-swipe exceeds the threshold. */
    onSwipeRight?: (rowId: string) => void;
    /** Called when horizontal movement exceeds the detect threshold (to cancel long-press). */
    onSwipeDetected?: () => void;
    /** When true, the hook is disabled (e.g. during drag-and-drop). */
    disabled?: boolean;
}

export interface UseSwipeRevealResult {
    /** Current horizontal translate offset for the row content (negative = left). */
    translateX: number;
    /** Whether action buttons are fully revealed (snap-open state). */
    isRevealed: boolean;
    /** Whether a swipe gesture is actively in progress. */
    isSwiping: boolean;
    /** Touch event handlers to attach to the row element. */
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchMove: (e: React.TouchEvent) => void;
        onTouchEnd: () => void;
    };
}

export function useSwipeReveal(options: UseSwipeRevealOptions): UseSwipeRevealResult {
    const {
        rowId,
        activeRowId,
        onReveal,
        onClose,
        onSwipeRight,
        onSwipeDetected,
        disabled = false,
    } = options;

    const [translateX, setTranslateX] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);

    const startXRef = useRef(0);
    const startYRef = useRef(0);
    const directionRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
    const swipeDetectedRef = useRef(false);
    const isRevealedRef = useRef(false);
    const rawDxRef = useRef(0);

    // Whether this row is the currently revealed one
    const isRevealed = activeRowId === rowId && !isSwiping && translateX <= -SWIPE_LEFT_THRESHOLD;

    // Close this row when another row becomes active
    useEffect(() => {
        if (activeRowId !== null && activeRowId !== rowId) {
            setTranslateX(0);
            isRevealedRef.current = false;
        }
    }, [activeRowId, rowId]);

    // Keep ref in sync
    useEffect(() => {
        isRevealedRef.current = isRevealed;
    }, [isRevealed]);

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        if (disabled || e.touches.length !== 1) return;
        const touch = e.touches[0];
        startXRef.current = touch.clientX;
        startYRef.current = touch.clientY;
        directionRef.current = 'none';
        swipeDetectedRef.current = false;
        rawDxRef.current = 0;

        // If this row is currently revealed and user taps, close it
        if (isRevealedRef.current) {
            setTranslateX(0);
            isRevealedRef.current = false;
            onClose();
            return;
        }

        // If another row is open, close it
        if (activeRowId !== null && activeRowId !== rowId) {
            onClose();
        }

        setIsSwiping(true);
    }, [disabled, activeRowId, rowId, onClose]);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        if (disabled || !isSwiping || e.touches.length !== 1) return;
        const touch = e.touches[0];
        const dx = touch.clientX - startXRef.current;
        const dy = touch.clientY - startYRef.current;

        // Direction lock
        if (directionRef.current === 'none') {
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                directionRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
            }
            if (directionRef.current !== 'horizontal') return;
        }
        if (directionRef.current === 'vertical') return;

        // Notify long-press cancellation
        if (!swipeDetectedRef.current && Math.abs(dx) > SWIPE_DETECT_THRESHOLD) {
            swipeDetectedRef.current = true;
            onSwipeDetected?.();
        }

        if (dx < 0) {
            // Swipe left: clamp to -SWIPE_LEFT_MAX
            rawDxRef.current = dx;
            setTranslateX(Math.max(dx, -SWIPE_LEFT_MAX));
        } else {
            // Swipe right: track raw dx, apply resistance for visual feedback
            rawDxRef.current = dx;
            setTranslateX(Math.min(dx * 0.4, SWIPE_RIGHT_THRESHOLD * 1.2));
        }
    }, [disabled, isSwiping, onSwipeDetected]);

    const onTouchEnd = useCallback(() => {
        if (disabled || !isSwiping) return;
        setIsSwiping(false);

        if (directionRef.current !== 'horizontal') {
            setTranslateX(0);
            return;
        }

        if (translateX <= -SWIPE_LEFT_THRESHOLD) {
            // Snap open — reveal action buttons
            setTranslateX(-SWIPE_LEFT_MAX);
            onReveal(rowId);
        } else if (rawDxRef.current >= SWIPE_RIGHT_THRESHOLD) {
            // Right swipe confirmed (use raw dx for threshold, not damped translateX)
            setTranslateX(0);
            onSwipeRight?.(rowId);
        } else {
            // Below threshold — spring back
            setTranslateX(0);
        }
    }, [disabled, isSwiping, translateX, rowId, onReveal, onSwipeRight]);

    return {
        translateX: disabled ? 0 : translateX,
        isRevealed,
        isSwiping,
        handlers: {
            onTouchStart,
            onTouchMove,
            onTouchEnd,
        },
    };
}
