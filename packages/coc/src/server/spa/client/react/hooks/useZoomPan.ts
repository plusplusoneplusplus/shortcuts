import { useState, useEffect, useRef, useCallback } from 'react';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;
const ZOOM_BTN_STEP = 0.25;
const DRAG_THRESHOLD = 3;

export interface UseZoomPanOptions {
    /** Minimum allowed scale. Default: 0.25 */
    minZoom?: number;
    /** Maximum allowed scale. Default: 3 */
    maxZoom?: number;
    /** Whether wheel zoom requires Ctrl/Cmd held. Default: false */
    requireModifierKey?: boolean;
    /** Intrinsic content width (for fit-to-view calculation). */
    contentWidth: number;
    /** Intrinsic content height (for fit-to-view calculation). */
    contentHeight: number;
}

export interface ZoomPanState {
    /** Current zoom scale (1 = 100%). */
    scale: number;
    /** Current horizontal pan offset in px. */
    translateX: number;
    /** Current vertical pan offset in px. */
    translateY: number;
    /** Whether the user is currently dragging. */
    isDragging: boolean;
}

export interface UseZoomPanReturn {
    /** Ref to attach to the outer container `<div>` that receives pointer events. */
    containerRef: React.RefObject<HTMLDivElement>;
    /** Current transform state. */
    state: ZoomPanState;
    /** SVG transform string: `"translate(tx, ty) scale(s)"`. */
    svgTransform: string;
    /** Zoom in by one button step. */
    zoomIn: () => void;
    /** Zoom out by one button step. */
    zoomOut: () => void;
    /** Reset to scale=1, translate=(0,0). */
    reset: () => void;
    /** Auto-fit: calculate scale so all content fits the container. */
    fitToView: () => void;
    /** Formatted zoom percentage string, e.g. `"125%"`. */
    zoomLabel: string;
}

export function useZoomPan(options: UseZoomPanOptions): UseZoomPanReturn {
    const {
        minZoom = MIN_ZOOM,
        maxZoom = MAX_ZOOM,
        requireModifierKey = false,
        contentWidth,
        contentHeight,
    } = options;

    const containerRef = useRef<HTMLDivElement>(null);
    const [state, setState] = useState<ZoomPanState>({
        scale: 1, translateX: 0, translateY: 0, isDragging: false,
    });
    const dragRef = useRef({
        isDragging: false,
        active: false,
        startX: 0, startY: 0,
        lastTX: 0, lastTY: 0,
    });

    const clampScale = useCallback((s: number) =>
        Math.max(minZoom, Math.min(maxZoom, s)), [minZoom, maxZoom]);

    // Wheel zoom (cursor-centered)
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            if (requireModifierKey && !e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            e.stopPropagation();

            setState(prev => {
                const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                const newScale = clampScale(prev.scale + delta);
                if (newScale === prev.scale) return prev;

                const rect = el.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const px = (mx - prev.translateX) / prev.scale;
                const py = (my - prev.translateY) / prev.scale;

                return {
                    ...prev,
                    scale: newScale,
                    translateX: mx - px * newScale,
                    translateY: my - py * newScale,
                };
            });
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [clampScale, requireModifierKey]);

    // Mouse drag pan
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            if (target.closest('button, [data-no-drag]')) return;

            dragRef.current = {
                isDragging: true,
                active: false,
                startX: e.clientX,
                startY: e.clientY,
                lastTX: 0,
                lastTY: 0,
            };
            setState(prev => {
                dragRef.current.lastTX = prev.translateX;
                dragRef.current.lastTY = prev.translateY;
                return prev;
            });
            e.preventDefault();
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!dragRef.current.isDragging) return;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;

            if (!dragRef.current.active) {
                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                dragRef.current.active = true;
                setState(prev => ({ ...prev, isDragging: true }));
                el.style.cursor = 'grabbing';
            }

            setState(prev => ({
                ...prev,
                translateX: dragRef.current.lastTX + dx,
                translateY: dragRef.current.lastTY + dy,
            }));
        };

        const onMouseUp = () => {
            if (!dragRef.current.isDragging) return;
            dragRef.current.isDragging = false;
            dragRef.current.active = false;
            setState(prev => ({ ...prev, isDragging: false }));
            el.style.cursor = '';
        };

        el.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        return () => {
            el.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    const svgTransform = `translate(${state.translateX}, ${state.translateY}) scale(${state.scale})`;
    const zoomLabel = `${Math.round(state.scale * 100)}%`;

    const zoomIn = useCallback(() => {
        setState(prev => ({ ...prev, scale: clampScale(prev.scale + ZOOM_BTN_STEP) }));
    }, [clampScale]);

    const zoomOut = useCallback(() => {
        setState(prev => ({ ...prev, scale: clampScale(prev.scale - ZOOM_BTN_STEP) }));
    }, [clampScale]);

    const reset = useCallback(() => {
        setState({ scale: 1, translateX: 0, translateY: 0, isDragging: false });
    }, []);

    const fitToView = useCallback(() => {
        const el = containerRef.current;
        if (!el || contentWidth <= 0 || contentHeight <= 0) return;
        const rect = el.getBoundingClientRect();
        const scaleX = rect.width / contentWidth;
        const scaleY = rect.height / contentHeight;
        const fitScale = clampScale(Math.min(scaleX, scaleY) * 0.95);
        const tx = (rect.width - contentWidth * fitScale) / 2;
        const ty = (rect.height - contentHeight * fitScale) / 2;
        setState({ scale: fitScale, translateX: tx, translateY: ty, isDragging: false });
    }, [contentWidth, contentHeight, clampScale]);

    return { containerRef, state, svgTransform, zoomIn, zoomOut, reset, fitToView, zoomLabel };
}
