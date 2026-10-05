import { useEffect, type RefObject } from 'react';

/** Overlays that always hide native views: modal backdrops dim the whole window, and the tab menu opens right against the view's edge. */
const ALWAYS_BLOCKERS = '[role="dialog"][aria-modal="true"], [data-testid="unified-panel-tab-menu"]';
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

/** True when any DOM element paints above the placeholder at one of the probe points. */
function isCoveredByDom(node: HTMLElement, rect: DOMRect): boolean {
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
 * Keep a native desktop view (an Electron WebContentsView drawn above the SPA)
 * over its placeholder while `shown`. Native views always paint over DOM
 * content, so the view is hidden whenever the placeholder has no size, a modal
 * dialog or the tab menu is up, or a hit test finds any other element (menu,
 * popover, overlay) on top of the placeholder.
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
        const update = () => {
            frame = 0;
            const rect = node.getBoundingClientRect();
            const { x, y, width, height } = rect;
            if (width > 0 && height > 0 && !document.querySelector(ALWAYS_BLOCKERS) && !isCoveredByDom(node, rect)) {
                placement.setBounds({ x, y, width, height });
            } else {
                placement.hide();
            }
        };
        const schedule = () => {
            if (!frame) frame = window.requestAnimationFrame(update);
        };
        update();
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        resize?.observe(node);
        const mutations = new MutationObserver(schedule);
        mutations.observe(document.body, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'style', 'aria-hidden'],
        });
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        return () => {
            resize?.disconnect();
            mutations.disconnect();
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            if (frame) window.cancelAnimationFrame(frame);
            placement.hide();
        };
    }, [placeholder, placement, shown]);
}
