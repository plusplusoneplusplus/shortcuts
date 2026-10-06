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
 * Both directions are clamped to the viewport (with a margin) and flip to the
 * opposite side when there isn't enough room, so the panel is never cut off.
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
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Horizontal anchor: `up` left-aligns, `down` right-aligns.
        let left = (align ?? (placement === 'up' ? 'left' : 'right')) === 'left' ? t.left : t.right - p.width;
        if (left + p.width > vw - margin) left = vw - p.width - margin;
        if (left < margin) left = margin;

        // Vertical anchor: `up` opens above, `down` opens below — flip if it
        // doesn't fit, then clamp to keep the whole panel on-screen.
        if (constrainHeight) {
            const above = Math.max(0, t.top - gap - margin);
            const below = Math.max(0, vh - margin - t.bottom - gap);
            const height = Math.max(p.height, panel.scrollHeight);
            const preferred = placement === 'up' ? above : below;
            const opposite = placement === 'up' ? below : above;
            const side = height > preferred && opposite > preferred
                ? (placement === 'up' ? 'down' : 'up') : placement;
            const maxHeight = side === 'up' ? above : below;
            const top = side === 'up' ? t.top - gap - Math.min(height, maxHeight) : t.bottom + gap;
            setPos(prev => prev.top === top && prev.left === left && prev.maxHeight === maxHeight
                ? prev : { top, left, maxHeight });
            return;
        }
        let top = placement === 'up' ? t.top - p.height - gap : t.bottom + gap;
        if (placement === 'up' && top < margin) {
            top = t.bottom + gap;
        } else if (placement === 'down' && top + p.height > vh - margin) {
            top = t.top - p.height - gap;
        }
        if (top + p.height > vh - margin) top = vh - p.height - margin;
        if (top < margin) top = margin;

        setPos(prev => (prev.top === top && prev.left === left ? prev : { top, left }));
    }, [placement, triggerRef, panelRef, gap, margin, align, constrainHeight]);

    useLayoutEffect(() => {
        if (!open) return;
        recompute();
        window.addEventListener('resize', recompute);
        // Capture-phase so we react to scrolls in any ancestor scroll container.
        window.addEventListener('scroll', recompute, true);
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(recompute);
        if (triggerRef.current) observer?.observe(triggerRef.current);
        if (panelRef.current) observer?.observe(panelRef.current);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', recompute);
            window.removeEventListener('scroll', recompute, true);
        };
    }, [open, recompute]);

    return pos;
}
