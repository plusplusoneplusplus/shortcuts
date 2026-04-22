/**
 * useSwipeToArchive — horizontal swipe gesture hook for mobile archive/unarchive.
 *
 * Tracks touch events to detect a right-to-left swipe. When the horizontal
 * distance exceeds the threshold on touchend, `onSwipeConfirm` fires.
 * If the swipe is insufficient the offset animates back to 0.
 *
 * Only activates when `|dx| > |dy|` to avoid conflicting with vertical scroll.
 */

import { useRef, useState, useCallback } from 'react';

/** Minimum horizontal px before the swipe is considered a confirm. */
export const SWIPE_ARCHIVE_THRESHOLD = 80;

export interface UseSwipeToArchiveOptions {
    /** Callback fired when the swipe exceeds the threshold. */
    onSwipeConfirm: () => void;
    /** Pixel threshold to confirm (default: SWIPE_ARCHIVE_THRESHOLD). */
    threshold?: number;
    /** Whether the gesture is enabled (pass false on desktop). */
    enabled?: boolean;
}

export interface UseSwipeToArchiveResult {
    /** Bind these to the swipeable element. */
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchMove: (e: React.TouchEvent) => void;
        onTouchEnd: () => void;
    };
    /** Current horizontal offset in px (≤ 0). Apply as translateX. */
    swipeOffset: number;
    /** True while the user is actively dragging. */
    isSwiping: boolean;
    /** True during the slide-away exit animation. */
    isExiting: boolean;
}

export function useSwipeToArchive({
    onSwipeConfirm,
    threshold = SWIPE_ARCHIVE_THRESHOLD,
    enabled = true,
}: UseSwipeToArchiveOptions): UseSwipeToArchiveResult {
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const [isExiting, setIsExiting] = useState(false);

    const startXRef = useRef(0);
    const startYRef = useRef(0);
    const directionLockedRef = useRef<'horizontal' | 'vertical' | null>(null);
    const onSwipeConfirmRef = useRef(onSwipeConfirm);
    onSwipeConfirmRef.current = onSwipeConfirm;

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        if (!enabled || e.touches.length !== 1 || isExiting) return;
        const touch = e.touches[0];
        startXRef.current = touch.clientX;
        startYRef.current = touch.clientY;
        directionLockedRef.current = null;
        setIsSwiping(false);
        setSwipeOffset(0);
    }, [enabled, isExiting]);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        if (!enabled || isExiting) return;
        const touch = e.touches[0];
        if (!touch) return;

        const dx = touch.clientX - startXRef.current;
        const dy = touch.clientY - startYRef.current;

        // Lock direction once movement exceeds a small dead-zone
        if (directionLockedRef.current === null) {
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
            directionLockedRef.current = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
        }

        if (directionLockedRef.current === 'vertical') return;

        // Prevent vertical scroll once we've committed to horizontal swipe
        e.preventDefault();
        setIsSwiping(true);

        // Only allow left swipe (negative offset), clamp to reasonable range
        const offset = Math.min(0, Math.max(dx, -200));
        setSwipeOffset(offset);
    }, [enabled, isExiting]);

    const onTouchEnd = useCallback(() => {
        if (!enabled || isExiting) return;

        const offset = swipeOffset;
        directionLockedRef.current = null;

        if (Math.abs(offset) >= threshold) {
            // Confirmed — slide fully off-screen then fire callback
            setIsExiting(true);
            setSwipeOffset(-9999);
            // Fire after CSS transition completes
            setTimeout(() => {
                onSwipeConfirmRef.current();
                // Reset state after archive
                setIsExiting(false);
                setIsSwiping(false);
                setSwipeOffset(0);
            }, 200);
        } else {
            // Below threshold — snap back
            setSwipeOffset(0);
            setIsSwiping(false);
        }
    }, [enabled, isExiting, swipeOffset, threshold]);

    return {
        handlers: { onTouchStart, onTouchMove, onTouchEnd },
        swipeOffset,
        isSwiping,
        isExiting,
    };
}
