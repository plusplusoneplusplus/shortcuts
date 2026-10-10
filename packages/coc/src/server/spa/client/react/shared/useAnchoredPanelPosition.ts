/**
 * useAnchoredPanelPosition — computes fixed-viewport coordinates for a dropdown
 * panel that is portaled to `document.body` so it escapes any `overflow-hidden`
 * ancestor (e.g. the narrow, clipped sidebar column that hosts the status dock,
 * where an in-flow panel gets its right/left edge cut off).
 *
 * `down` (top-right topbar cluster): panel opens below the trigger with its
 * right edge aligned to the trigger's right edge.
 * `up` (bottom-left sidebar dock): panel opens above the trigger with its left
 * edge aligned to the trigger's left edge.
 *
 * Both directions are clamped to the visual viewport and flip when needed.
 * Constrained panels receive width and height limits for internal scrolling.
 */

import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

export type AnchoredPanelPlacement = 'up' | 'down';

export interface AnchoredPanelPositionOptions {
    /** Whether the panel is currently open (mounted). Position is only tracked while open. */
    open: boolean;
    /** `up` = open above & left-aligned; `down` = open below & right-aligned. */
    placement: AnchoredPanelPlacement;
    /** The trigger button the panel anchors to. */
    triggerRef: RefObject<HTMLElement | null>;
    /** The panel element being positioned (must be rendered while `open`). */
    panelRef: RefObject<HTMLElement | null>;
    /** Gap in px between the trigger and the panel. Default 4. */
    gap?: number;
    /** Viewport margin in px kept clear on every edge. Default 8. */
    margin?: number;
    /** Override the placement's default horizontal alignment. */
    align?: 'left' | 'right';
    /** Keep a scrollable panel beside the trigger when neither side fits. */
    constrainHeight?: boolean;
}

export interface AnchoredPanelPosition {
    top: number;
    left: number;
    maxHeight?: number;
    maxWidth?: number;
}

export function useAnchoredPanelPosition({
    open,
    placement,
    triggerRef,
    panelRef,
    gap = 4,
    margin = 8,
    align,
    constrainHeight = false,
}: AnchoredPanelPositionOptions): AnchoredPanelPosition {
    const [pos, setPos] = useState<AnchoredPanelPosition>({ top: 0, left: 0 });

    const recompute = useCallback(() => {
        const trigger = triggerRef.current;
        const panel = panelRef.current;
        if (!trigger || !panel) return;

        const t = trigger.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportTop = viewport?.offsetTop ?? 0;
        const vw = viewport?.width ?? window.innerWidth;
        const vh = viewport?.height ?? window.innerHeight;
        const right = viewportLeft + vw - margin;
        const bottom = viewportTop + vh - margin;
        const maxWidth = Math.max(0, vw - 2 * margin);
        const width = Math.min(p.width, maxWidth);

        // Horizontal anchor: `up` left-aligns, `down` right-aligns.
        let left = (align ?? (placement === 'up' ? 'left' : 'right')) === 'left' ? t.left : t.right - width;
        if (left + width > right) left = right - width;
        if (left < viewportLeft + margin) left = viewportLeft + margin;

        // Vertical anchor: `up` opens above, `down` opens below — flip if it
        // doesn't fit, then clamp to keep the whole panel on-screen.
        if (constrainHeight) {
            const aboveEnd = Math.min(bottom, Math.max(viewportTop + margin, t.top - gap));
            const belowStart = Math.max(viewportTop + margin, Math.min(bottom, t.bottom + gap));
            const above = aboveEnd - viewportTop - margin;
            const below = bottom - belowStart;
            // scrollHeight excludes borders; placement must fit the outer box too.
            const height = Math.max(p.height, panel.scrollHeight + p.height - panel.clientHeight);
            const preferred = placement === 'up' ? above : below;
            const opposite = placement === 'up' ? below : above;
            const side = height > preferred && opposite > preferred
                ? (placement === 'up' ? 'down' : 'up') : placement;
            const maxHeight = side === 'up' ? above : below;
            const top = side === 'up' ? aboveEnd - Math.min(height, maxHeight) : belowStart;
            setPos(prev => prev.top === top && prev.left === left && prev.maxHeight === maxHeight && prev.maxWidth === maxWidth
                ? prev : { top, left, maxHeight, maxWidth });
            return;
        }
        let top = placement === 'up' ? t.top - p.height - gap : t.bottom + gap;
        if (placement === 'up' && top < viewportTop + margin) {
            top = t.bottom + gap;
        } else if (placement === 'down' && top + p.height > bottom) {
            top = t.top - p.height - gap;
        }
        if (top + p.height > bottom) top = bottom - p.height;
        if (top < viewportTop + margin) top = viewportTop + margin;

        setPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }));
    }, [placement, triggerRef, panelRef, gap, margin, align, constrainHeight]);

    useLayoutEffect(() => {
        if (!open) return;
        recompute();
        window.addEventListener('resize', recompute);
        // Capture-phase so we react to scrolls in any ancestor scroll container.
        window.addEventListener('scroll', recompute, true);
        const viewport = window.visualViewport;
        viewport?.addEventListener('resize', recompute);
        viewport?.addEventListener('scroll', recompute);
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(recompute);
        // Split resizing can move a fixed-size trigger without resizing the button.
        for (let anchor = triggerRef.current; anchor; anchor = anchor.parentElement) observer?.observe(anchor);
        if (panelRef.current) observer?.observe(panelRef.current);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', recompute);
            window.removeEventListener('scroll', recompute, true);
            viewport?.removeEventListener('resize', recompute);
            viewport?.removeEventListener('scroll', recompute);
        };
    }, [open, recompute]);

    return pos;
}
