import { useState, useEffect } from 'react';

/**
 * Returns the current `window.innerWidth` (in px) and keeps it up to date as the
 * window is resized. Unlike `useBreakpoint` (discrete breakpoints) or
 * `useVisualViewport` (keyboard height), this exposes the raw viewport width so a
 * caller can derive a viewport-relative size — e.g. a dock max-width that scales
 * with the monitor while reserving room for the chat pane.
 *
 * The resize listener is debounced so a burst of resize events triggers a single
 * state update (and a single downstream re-render / effect run). SSR / no-window
 * falls back to a generous default so any derived cap stays permissive before
 * hydration rather than briefly clamping to a tiny window.
 */

/** SSR / no-window fallback so a derived cap is generous before hydration. */
const SSR_FALLBACK_WIDTH = 1920;
/** Coalesce a burst of resize events into one state update. */
const RESIZE_DEBOUNCE_MS = 100;

export function useViewportWidth(): number {
    const [width, setWidth] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth : SSR_FALLBACK_WIDTH,
    );

    useEffect(() => {
        if (typeof window === 'undefined') return;

        let timer: ReturnType<typeof setTimeout> | undefined;
        const handler = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => setWidth(window.innerWidth), RESIZE_DEBOUNCE_MS);
        };

        window.addEventListener('resize', handler);
        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('resize', handler);
        };
    }, []);

    return width;
}
