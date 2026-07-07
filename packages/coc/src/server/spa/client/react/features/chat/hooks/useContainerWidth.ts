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

export interface ContainerWidthOptions {
    /** Throttle interval for ResizeObserver-driven updates (default 100ms). */
    throttleMs?: number;
    /** Width (px) at or above which the container is `wide` (default 700). */
    wideThreshold?: number;
    /** Width (px) at or above which the container is `medium` (default 500). */
    mediumThreshold?: number;
}

function computeTier(width: number, wide: number, medium: number): ContainerWidthTier {
    if (width >= wide) return 'wide';
    if (width >= medium) return 'medium';
    return 'narrow';
}

function computeState(width: number, wide: number, medium: number): ContainerWidthState {
    const tier = computeTier(width, wide, medium);
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
 * Thresholds default to 700/500px but are tunable per call site via options —
 * containers whose full layout needs more room (e.g. the chat composer
 * toolbar) pass a higher `wideThreshold` so compaction kicks in before their
 * content stops fitting. A bare number as the second argument is accepted as
 * `throttleMs` for backwards compatibility.
 *
 * Updates are throttled to avoid excessive re-renders during panel resize drags.
 */
export function useContainerWidth(
    ref: RefObject<HTMLElement | null>,
    options: number | ContainerWidthOptions = {},
): ContainerWidthState {
    const opts = typeof options === 'number' ? { throttleMs: options } : options;
    const throttleMs = opts.throttleMs ?? 100;
    const wideThreshold = opts.wideThreshold ?? WIDE_THRESHOLD;
    const mediumThreshold = opts.mediumThreshold ?? MEDIUM_THRESHOLD;

    const [state, setState] = useState<ContainerWidthState>(() => {
        const el = ref.current;
        if (el) return computeState(el.clientWidth, wideThreshold, mediumThreshold);
        return computeState(0, wideThreshold, mediumThreshold);
    });

    const measure = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        setState(prev => {
            const w = el.clientWidth;
            if (w === prev.width) return prev;
            return computeState(w, wideThreshold, mediumThreshold);
        });
    }, [ref, wideThreshold, mediumThreshold]);

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
