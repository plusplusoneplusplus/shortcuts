/**
 * useCommitListGestures — hover tooltip, long-press, and swipe-reveal state.
 *
 * Keeps every timer-backed pointer affordance in one place: the 1000ms hover
 * delay before the commit tooltip appears, the 150ms grace period so the mouse
 * can travel onto the tooltip, touch-start dismissal for hybrid devices, the
 * long-press-to-context-menu gesture, and which row is currently swiped open.
 *
 * Selection is deliberately NOT owned here — swipe-right reports the row id and
 * the list applies the selection transition, so gestures stay stateless with
 * respect to which commits are selected.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useLongPress } from '../../../hooks/ui/useLongPress';
import type { GitCommitItem } from './commitListTypes';

/** Delay before a hovered row reveals its tooltip. */
export const TOOLTIP_SHOW_DELAY_MS = 1000;
/** Grace period after leaving a row so the pointer can reach the tooltip. */
export const TOOLTIP_HIDE_DELAY_MS = 150;

export interface CommitListGestures {
    hoveredCommit: GitCommitItem | null;
    tooltipAnchorRect: DOMRect | null;
    handleRowMouseEnter: (commit: GitCommitItem, e: React.MouseEvent) => void;
    handleRowMouseLeave: () => void;
    handleTooltipMouseEnter: () => void;
    handleTooltipMouseLeave: () => void;

    swipeActiveRowId: string | null;
    handleSwipeReveal: (rowId: string) => void;
    handleSwipeClose: () => void;
    handleSwipeDetected: () => void;

    /** Long-press handlers plus the ref the row sets before the press starts. */
    mobileLongPress: ReturnType<typeof useLongPress>;
    longPressCommitHashRef: React.MutableRefObject<string | null>;
    /** True when the click that follows a long press on `hash` must be swallowed. */
    consumeLongPressClick: (hash: string) => boolean;

    /** Builds the synthetic MouseEvent used to open the context menu from a button. */
    openContextMenuFromElement: (element: HTMLElement, commitHash: string) => void;
    handleCommitOverflowTouchStart: (e: React.TouchEvent<HTMLButtonElement>) => void;
    handleCommitOverflowTouchEnd: (e: React.TouchEvent<HTMLButtonElement>, commitHash: string) => void;
}

export function useCommitListGestures(options: {
    touchOnly: boolean;
    onCommitContextMenu?: (e: React.MouseEvent, commitHash: string) => void;
}): CommitListGestures {
    const { touchOnly, onCommitContextMenu } = options;

    // Hover tooltip state
    const [hoveredCommit, setHoveredCommit] = useState<GitCommitItem | null>(null);
    const [tooltipAnchorRect, setTooltipAnchorRect] = useState<DOMRect | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Swipe reveal state: which row is currently swiped open
    const [swipeActiveRowId, setSwipeActiveRowId] = useState<string | null>(null);
    const swipeCancelLongPressRef = useRef(false);

    const longPressCommitHashRef = useRef<string | null>(null);
    const suppressLongPressClickHashRef = useRef<string | null>(null);

    const createSyntheticContextMenuEvent = useCallback((element: HTMLElement): React.MouseEvent => {
        const rect = element.getBoundingClientRect();
        return {
            clientX: rect.left,
            clientY: rect.bottom,
            preventDefault: () => {},
            stopPropagation: () => {},
        } as React.MouseEvent;
    }, []);

    const openContextMenuFromElement = useCallback((element: HTMLElement, commitHash: string) => {
        onCommitContextMenu?.(createSyntheticContextMenuEvent(element), commitHash);
    }, [createSyntheticContextMenuEvent, onCommitContextMenu]);

    const mobileLongPress = useLongPress((x: number, y: number) => {
        if (!touchOnly) return;
        const hash = longPressCommitHashRef.current;
        if (!hash) return;
        suppressLongPressClickHashRef.current = hash;
        // Open context menu at the touch coordinates (same as desktop right-click)
        onCommitContextMenu?.({
            clientX: x,
            clientY: y,
            preventDefault: () => {},
            stopPropagation: () => {},
        } as React.MouseEvent, hash);
    }, { cancelSignal: swipeCancelLongPressRef.current });

    // A long press already opened the context menu; the synthesized click that
    // follows must not also select/expand the row it landed on.
    const consumeLongPressClick = useCallback((hash: string): boolean => {
        const didLongPress = mobileLongPress.didLongPress();
        if (!didLongPress) return false;
        const suppressed = suppressLongPressClickHashRef.current === hash;
        suppressLongPressClickHashRef.current = null;
        return suppressed;
    }, [mobileLongPress]);

    const handleCommitOverflowTouchStart = useCallback((e: React.TouchEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleCommitOverflowTouchEnd = useCallback((e: React.TouchEvent<HTMLButtonElement>, commitHash: string) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenuFromElement(e.currentTarget, commitHash);
    }, [openContextMenuFromElement]);

    // Swipe reveal handlers
    const handleSwipeReveal = useCallback((rowId: string) => {
        setSwipeActiveRowId(rowId);
    }, []);

    const handleSwipeClose = useCallback(() => {
        setSwipeActiveRowId(null);
    }, []);

    const handleSwipeDetected = useCallback(() => {
        swipeCancelLongPressRef.current = true;
        // Reset after a tick so the useLongPress hook picks up the signal
        setTimeout(() => { swipeCancelLongPressRef.current = false; }, 0);
    }, []);

    // Hover tooltip handlers with 1000ms delay
    const handleRowMouseEnter = useCallback((commit: GitCommitItem, e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        hoverTimerRef.current = setTimeout(() => {
            setHoveredCommit(commit);
            setTooltipAnchorRect(rect);
        }, TOOLTIP_SHOW_DELAY_MS);
    }, []);

    const handleRowMouseLeave = useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        // Delay hiding so mouse can move onto the tooltip without it disappearing
        hideTimerRef.current = setTimeout(() => {
            setHoveredCommit(null);
            setTooltipAnchorRect(null);
        }, TOOLTIP_HIDE_DELAY_MS);
    }, []);

    const handleTooltipMouseEnter = useCallback(() => {
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    }, []);

    const handleTooltipMouseLeave = useCallback(() => {
        setHoveredCommit(null);
        setTooltipAnchorRect(null);
    }, []);

    // Dismiss tooltip on touch start (handles hybrid devices that switch from mouse to touch)
    useEffect(() => {
        const onTouchStart = () => {
            if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
            }
            setHoveredCommit(null);
            setTooltipAnchorRect(null);
        };
        document.addEventListener('touchstart', onTouchStart, { passive: true });
        return () => document.removeEventListener('touchstart', onTouchStart);
    }, []);

    // Clean up timers on unmount
    useEffect(() => {
        return () => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        };
    }, []);

    return {
        hoveredCommit,
        tooltipAnchorRect,
        handleRowMouseEnter,
        handleRowMouseLeave,
        handleTooltipMouseEnter,
        handleTooltipMouseLeave,
        swipeActiveRowId,
        handleSwipeReveal,
        handleSwipeClose,
        handleSwipeDetected,
        mobileLongPress,
        longPressCommitHashRef,
        consumeLongPressClick,
        openContextMenuFromElement,
        handleCommitOverflowTouchStart,
        handleCommitOverflowTouchEnd,
    };
}
