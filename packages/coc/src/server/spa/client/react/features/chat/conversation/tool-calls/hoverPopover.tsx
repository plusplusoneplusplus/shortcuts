/**
 * Reusable hover-popover primitive shared by the whisper summary spans
 * (skills, memories, files, commits, pull requests, pushes).
 *
 * Owns the one hover state machine those spans previously each copied: a
 * grace-timer on mouse-leave (so the pointer can cross the gap into the
 * popover), and Escape / outside-pointer dismissal. Portal positioning stays in
 * the individual popover components; `clampPopoverPosition` keeps any of them
 * inside the viewport.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';

/** Grace period before a popover hides after the pointer leaves its anchor. */
export const HOVER_GRACE_MS = 150;

// ---------------------------------------------------------------------------
// Shared popover positioning — clamp to viewport
// ---------------------------------------------------------------------------

export function clampPopoverPosition(
    rect: DOMRect,
    popoverWidth: number,
    popoverHeight: number,
): { top: number; left: number } {
    const margin = 8;
    let left = rect.left;
    let top = rect.bottom + 4;

    // Clamp right edge
    if (left + popoverWidth > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - popoverWidth - margin);
    }
    // Flip above if clipped at bottom
    if (top + popoverHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - popoverHeight - 4);
    }
    return { top, left };
}

export function useHoverPopoverDismissal(
    open: boolean,
    anchorRef: React.RefObject<HTMLElement | null>,
    popoverRef: React.RefObject<HTMLElement | null>,
    onDismiss: () => void,
) {
    useEffect(() => {
        if (!open) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onDismiss();
            }
        };
        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }
            if (anchorRef.current?.contains(target)) {
                return;
            }
            if (popoverRef.current?.contains(target)) {
                return;
            }
            onDismiss();
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
        };
    }, [open, anchorRef, popoverRef, onDismiss]);
}

export interface HoverPopoverController<T extends HTMLElement> {
    /** True while the popover should be shown. */
    hovered: boolean;
    /**
     * Attach to the hover trigger element. Typed as a mutable ref so it stays
     * assignable to a DOM `ref` prop under the React 18 element typings used
     * here (a read-only `RefObject<T | null>` is not).
     */
    anchorRef: React.MutableRefObject<T | null>;
    /** Attach to the portaled popover element. */
    popoverRef: React.MutableRefObject<HTMLDivElement | null>;
    /** Cancels any pending hide and opens the popover. */
    showPopover: () => void;
    /** Starts the grace timer that hides the popover. */
    hidePopover: () => void;
    /** Immediately closes the popover and clears any pending grace timer. */
    dismissPopover: () => void;
}

/**
 * Hover state machine for a summary span + its popover. Wire `showPopover` /
 * `hidePopover` to both the anchor and the popover so the pointer can travel
 * between them without the popover closing.
 */
export function useHoverPopover<T extends HTMLElement = HTMLSpanElement>(): HoverPopoverController<T> {
    const [hovered, setHovered] = useState(false);
    const anchorRef = useRef<T | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showPopover = useCallback(() => {
        if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
        setHovered(true);
    }, []);

    const hidePopover = useCallback(() => {
        graceTimer.current = setTimeout(() => setHovered(false), HOVER_GRACE_MS);
    }, []);

    const dismissPopover = useCallback(() => {
        if (graceTimer.current) {
            clearTimeout(graceTimer.current);
            graceTimer.current = null;
        }
        setHovered(false);
    }, []);

    useHoverPopoverDismissal(hovered, anchorRef, popoverRef, dismissPopover);

    return { hovered, anchorRef, popoverRef, showPopover, hidePopover, dismissPopover };
}

/** Handlers a summary span passes down to its portaled popover component. */
export interface HoverPopoverAnchorProps {
    anchorRef: React.RefObject<HTMLSpanElement | null>;
    popoverRef: React.RefObject<HTMLDivElement | null>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

export interface HoverSummarySpanProps {
    /** Dotted-underline trigger text. */
    text: React.ReactNode;
    testId?: string;
    /** Gate: only render the popover when there is content to show. */
    hasContent: boolean;
    /** Renders the portaled popover, wired to this span's anchor + handlers. */
    renderPopover: (anchor: HoverPopoverAnchorProps) => React.ReactNode;
}

/**
 * Dotted-underline summary span that reveals a portaled popover on hover. Used
 * by the uniform whisper summary spans (skills, memories, commits, pull
 * requests, pushes). Spans that also render inline content or intercept clicks
 * (e.g. files) use `useHoverPopover` directly.
 */
export function HoverSummarySpan({ text, testId, hasContent, renderPopover }: HoverSummarySpanProps) {
    const { hovered, anchorRef, popoverRef, showPopover, hidePopover } = useHoverPopover<HTMLSpanElement>();

    return (
        <span
            ref={anchorRef}
            onMouseEnter={showPopover}
            onMouseLeave={hidePopover}
            className="underline decoration-dotted cursor-default"
            data-testid={testId}
        >
            {text}
            {hovered && hasContent && renderPopover({
                anchorRef,
                popoverRef,
                onMouseEnter: showPopover,
                onMouseLeave: hidePopover,
            })}
        </span>
    );
}
