import { useState, useEffect, useCallback, type RefObject } from 'react';

export type ContainerWidthTier = 'wide' | 'medium' | 'narrow';

export interface ContainerWidthState {
    /** Current container width in px (0 if not yet measured) */
    width: number;
    /** Tier label derived from width thresholds */
    tier: ContainerWidthTier;
    /** Convenience flags */
    isWide: boolean;
    isMedium: boolean;
    isNarrow: boolean;
}

const WIDE_THRESHOLD = 700;
const MEDIUM_THRESHOLD = 500;

function computeTier(width: number): ContainerWidthTier {
    if (width >= WIDE_THRESHOLD) return 'wide';
    if (width >= MEDIUM_THRESHOLD) return 'medium';
    return 'narrow';
}

function computeState(width: number): ContainerWidthState {
    const tier = computeTier(width);
    return {
        width,
        tier,
        isWide: tier === 'wide',
        isMedium: tier === 'medium',
        isNarrow: tier === 'narrow',
    };
}

/**
 * Measures the `clientWidth` of the element referenced by `ref` via
 * ResizeObserver and returns a tier classification (`wide` / `medium` / `narrow`).
 *
 * Updates are throttled to avoid excessive re-renders during panel resize drags.
 */
export function useContainerWidth(
    ref: RefObject<HTMLElement | null>,
    throttleMs = 100,
): ContainerWidthState {
    const [state, setState] = useState<ContainerWidthState>(() => {
        const el = ref.current;
        if (el) return computeState(el.clientWidth);
        return computeState(0);
    });

    const measure = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        setState(prev => {
            const w = el.clientWidth;
            if (w === prev.width) return prev;
            return computeState(w);
        });
    }, [ref]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // initial measurement
        measure();

        if (typeof ResizeObserver === 'undefined') return;

        let rafId: number | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const observer = new ResizeObserver(() => {
            // throttle: schedule at most once per throttleMs
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                rafId = requestAnimationFrame(measure);
            }, throttleMs);
        });

        observer.observe(el);

        return () => {
            observer.disconnect();
            if (timer) clearTimeout(timer);
            if (rafId != null) cancelAnimationFrame(rafId);
        };
    }, [ref, measure, throttleMs]);

    return state;
}
