import { useEffect, type RefObject } from 'react';

/** Overlays a native desktop view must never cover. */
const NATIVE_VIEW_BLOCKERS = '[role="dialog"][aria-modal="true"], [data-testid="unified-panel-tab-menu"]';

export interface NativeViewPlacement {
    setBounds(rect: { x: number; y: number; width: number; height: number }): void;
    hide(): void;
}

/**
 * Keep a native desktop view (an Electron WebContentsView drawn above the SPA)
 * over its placeholder while `shown`. The view is hidden whenever the
 * placeholder has no size or a modal dialog / tab menu is up, since native
 * views always paint over DOM content.
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
            const { x, y, width, height } = node.getBoundingClientRect();
            if (width > 0 && height > 0 && !document.querySelector(NATIVE_VIEW_BLOCKERS)) {
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
