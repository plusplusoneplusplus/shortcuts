import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useHoverPeek — temporary "peek" open/close state machine for the collapsed
 * chat-list rail.
 *
 * Hovering the rail for `openDelay` ms floats the list open as an overlay;
 * leaving the floating panel collapses it back after a `closeDelay` grace
 * window. Escape and clicks outside the panel collapse it immediately. None of
 * this touches the persisted collapsed/expanded state — it is a pure temporary
 * layer on top of the permanent `»` / `«` toggle (see AC-05).
 */
export interface UseHoverPeekOptions {
    /**
     * Whether hover-peek is active. Should be true only on a pointer/desktop
     * device when the list is in its collapsed rail state. When this flips to
     * false the peek is force-closed and any pending timers are cleared.
     */
    enabled: boolean;
    /** Delay before hovering the rail opens the peek. Default: 400ms (AC-01). */
    openDelay?: number;
    /** Grace delay before leaving the panel collapses the peek. Default: 250ms (AC-03). */
    closeDelay?: number;
    /**
     * Ref to the floating panel element. A pointerdown/mousedown outside this
     * element (while open) collapses the peek (AC-04). Optional — when absent,
     * any outside click closes.
     */
    panelRef?: React.RefObject<HTMLElement | null>;
}

export interface UseHoverPeekReturn {
    /** Whether the floating peek is currently open. */
    isOpen: boolean;
    /** Pointer entered the collapsed rail — starts the open timer. */
    onRailPointerEnter: () => void;
    /** Pointer left the collapsed rail — cancels a pending open. */
    onRailPointerLeave: () => void;
    /** Pointer entered the floating panel — cancels a pending collapse. */
    onPanelPointerEnter: () => void;
    /** Pointer left the floating panel — starts the grace collapse timer. */
    onPanelPointerLeave: () => void;
    /** Imperatively collapse the peek (selection, or any caller-driven dismiss). */
    close: () => void;
}

export function useHoverPeek(options: UseHoverPeekOptions): UseHoverPeekReturn {
    const { enabled, openDelay = 400, closeDelay = 250, panelRef } = options;

    const [isOpen, setIsOpen] = useState(false);
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearOpenTimer = useCallback(() => {
        if (openTimerRef.current !== null) {
            clearTimeout(openTimerRef.current);
            openTimerRef.current = null;
        }
    }, []);

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current !== null) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);

    const close = useCallback(() => {
        clearOpenTimer();
        clearCloseTimer();
        setIsOpen(false);
    }, [clearOpenTimer, clearCloseTimer]);

    const onRailPointerEnter = useCallback(() => {
        if (!enabled) return;
        // Re-entering the rail cancels any in-flight collapse so the peek stays.
        clearCloseTimer();
        // Already open or already counting down to open — nothing to schedule.
        if (isOpen || openTimerRef.current !== null) return;
        openTimerRef.current = setTimeout(() => {
            openTimerRef.current = null;
            setIsOpen(true);
        }, openDelay);
    }, [enabled, isOpen, openDelay, clearCloseTimer]);

    const onRailPointerLeave = useCallback(() => {
        // Leaving before the open delay elapses cancels the open (AC-01).
        clearOpenTimer();
    }, [clearOpenTimer]);

    const onPanelPointerEnter = useCallback(() => {
        // Re-entering the panel within the grace window cancels the collapse (AC-03).
        clearCloseTimer();
    }, [clearCloseTimer]);

    const onPanelPointerLeave = useCallback(() => {
        if (!isOpen) return;
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            setIsOpen(false);
        }, closeDelay);
    }, [isOpen, closeDelay, clearCloseTimer]);

    // Force-close + cancel timers whenever hover-peek is disabled (list expanded
    // permanently, switched to mobile, etc.).
    useEffect(() => {
        if (!enabled) {
            clearOpenTimer();
            clearCloseTimer();
            setIsOpen(false);
        }
    }, [enabled, clearOpenTimer, clearCloseTimer]);

    // Escape + outside-click dismissal (AC-04). Only listens while open.
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        const handlePointerDown = (e: MouseEvent) => {
            const panel = panelRef?.current;
            if (panel && e.target instanceof Node && panel.contains(e.target)) return;
            close();
        };
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handlePointerDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handlePointerDown);
        };
    }, [isOpen, close, panelRef]);

    // Clear any pending timers on unmount.
    useEffect(() => () => {
        clearOpenTimer();
        clearCloseTimer();
    }, [clearOpenTimer, clearCloseTimer]);

    return {
        isOpen,
        onRailPointerEnter,
        onRailPointerLeave,
        onPanelPointerEnter,
        onPanelPointerLeave,
        close,
    };
}
