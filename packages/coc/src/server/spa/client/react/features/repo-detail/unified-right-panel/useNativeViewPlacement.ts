import { useEffect, type RefObject } from 'react';

/** Modal backdrops dim the whole window. Other explicit overlays block only the views they overlap. */
const MODAL_BLOCKERS = '[role="dialog"][aria-modal="true"]';
const OVERLAP_BLOCKERS = '[data-testid="unified-panel-tab-menu"], [data-native-view-overlay]';
/** Marks DOM overlays (e.g. toasts) allowed to stay under a native view. */
const NATIVE_VIEW_PASSTHROUGH_ATTR = 'data-native-view-passthrough';
/** Hit-test grid per axis, and inset from the edges so splitters touching the placeholder don't count. */
const PROBE_GRID = 5;
const PROBE_INSET = 12;

function probeOffsets(start: number, size: number): number[] {
    const inset = Math.min(PROBE_INSET, size / 4);
    const span = size - inset * 2;
    return Array.from({ length: PROBE_GRID }, (_, i) => start + inset + (span * i) / (PROBE_GRID - 1));
}

/** Protect explicit intersecting overlays and other DOM content found by hit testing. */
function isCoveredByDom(node: HTMLElement, rect: DOMRect): boolean {
    // Explicit markers also protect overlays too small to hit the probe grid.
    // A preview in another column must not blank an unrelated native page.
    for (const overlay of document.querySelectorAll<HTMLElement>(OVERLAP_BLOCKERS)) {
        const box = overlay.getBoundingClientRect();
        const style = getComputedStyle(overlay);
        if (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
            && box.width > 0 && box.height > 0
            && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top) {
            return true;
        }
    }
    if (typeof document.elementFromPoint !== 'function') return false;
    for (const y of probeOffsets(rect.top, rect.height)) {
        for (const x of probeOffsets(rect.left, rect.width)) {
            const top = document.elementFromPoint(x, y);
            if (top && !node.contains(top) && !top.closest(`[${NATIVE_VIEW_PASSTHROUGH_ATTR}]`)) return true;
        }
    }
    return false;
}

export interface NativeViewPlacement {
    setBounds(rect: { x: number; y: number; width: number; height: number }): void;
    hide(): void;
}

/**
 * Keep a native desktop view (WebView2, drawn above the SPA)
 * over its placeholder while `shown`. Native views always paint over DOM
 * content, so the view is hidden whenever the placeholder has no size, a modal
 * dialog is up, or an explicit overlay or hit-tested DOM content overlaps it.
 */
export function useNativeViewPlacement(
    placeholder: RefObject<HTMLElement | null>,
    shown: boolean,
    placement: NativeViewPlacement | null,
): void {
    useEffect(() => {
        if (!placement) return;
        if (!shown) {
            placement.hide();
            return;
        }
        const node = placeholder.current;
        if (!node) return;
        let frame = 0;
        let disposed = false;
        const update = () => {
            if (disposed) {
                return;
            }
            frame = 0;
            const rect = node.getBoundingClientRect();
            const { x, y, width, height } = rect;
            if (width > 0 && height > 0 && !document.querySelector(MODAL_BLOCKERS) && !isCoveredByDom(node, rect)) {
                placement.setBounds({ x, y, width, height });
            } else {
                placement.hide();
            }
        };
        const schedule = () => {
            if (!disposed && !frame) frame = window.requestAnimationFrame(update);
        };
        update();
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        resize?.observe(node);
        const mutations = new MutationObserver(schedule);
        mutations.observe(document.body, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'role', 'aria-modal', 'data-native-view-overlay'],
        });
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        return () => {
            disposed = true;
            resize?.disconnect();
            mutations.disconnect();
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            if (frame) window.cancelAnimationFrame(frame);
            placement.hide();
        };
    }, [placeholder, placement, shown]);
}
