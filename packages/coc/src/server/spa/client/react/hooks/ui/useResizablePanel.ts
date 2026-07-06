import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseResizablePanelOptions {
    /**
     * Initial size of the panel in pixels. This is a width for horizontal
     * (`left`/`right`) panels and a height for vertical (`top`/`bottom`) panels.
     * Default: 320
     */
    initialWidth?: number;
    /** Minimum size of the panel in pixels. Default: 160 */
    minWidth?: number;
    /** Maximum size of the panel in pixels. Default: 600 */
    maxWidth?: number;
    /** localStorage key to persist the size. If set, the size is saved/restored. */
    storageKey?: string;
    /**
     * Which edge the resizable panel is anchored to. This determines both the
     * drag axis and the direction that grows the panel:
     * - 'left' (default): horizontal; drag right to widen a left-anchored panel.
     * - 'right': horizontal; drag left to widen a right-anchored panel.
     * - 'top': vertical; drag down to grow a top-anchored panel.
     * - 'bottom': vertical; drag up to grow a bottom-anchored panel.
     */
    direction?: 'left' | 'right' | 'top' | 'bottom';
}

export interface UseResizablePanelReturn {
    /**
     * Current size of the panel in px — a width for horizontal panels, a height
     * for vertical (`top`/`bottom`) panels.
     */
    width: number;
    /** Whether the user is currently dragging the resize handle. */
    isDragging: boolean;
    /** Attach to the resize handle element. */
    handleMouseDown: (e: React.MouseEvent) => void;
    /** Attach to the resize handle element for touch devices. */
    handleTouchStart: (e: React.TouchEvent) => void;
    /** Reset width to initial value. */
    resetWidth: () => void;
}

function loadPersistedWidth(key: string | undefined, fallback: number): number {
    if (!key) return fallback;
    try {
        const stored = localStorage.getItem(key);
        if (stored !== null) {
            const parsed = Number(stored);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
    } catch { /* ignore */ }
    return fallback;
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
    return Math.min(Math.max(width, minWidth), maxWidth);
}

export function useResizablePanel(options: UseResizablePanelOptions = {}): UseResizablePanelReturn {
    const {
        initialWidth = 320,
        minWidth = 160,
        maxWidth = 600,
        storageKey,
        direction = 'left',
    } = options;

    const [width, setWidth] = useState(() => {
        const persisted = loadPersistedWidth(storageKey, initialWidth);
        return clampWidth(persisted, minWidth, maxWidth);
    });
    const [isDragging, setIsDragging] = useState(false);
    const startCoordRef = useRef(0);
    const startWidthRef = useRef(0);
    const skipNextPersistRef = useRef(false);

    // `top`/`bottom` panels resize along the Y axis; `left`/`right` along X.
    const isVertical = direction === 'top' || direction === 'bottom';
    // A drag away from the anchored edge grows the panel: dragging right/down
    // grows a left/top panel (+delta), dragging left/up grows a right/bottom
    // panel (−delta).
    const growSign = direction === 'right' || direction === 'bottom' ? -1 : 1;

    const onMove = useCallback((clientCoord: number) => {
        const rawDelta = clientCoord - startCoordRef.current;
        const delta = growSign * rawDelta;
        const newWidth = clampWidth(startWidthRef.current + delta, minWidth, maxWidth);
        setWidth(newWidth);
    }, [minWidth, maxWidth, growSign]);

    const onEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    useEffect(() => {
        if (isDragging) return;
        skipNextPersistRef.current = true;
        const persisted = loadPersistedWidth(storageKey, initialWidth);
        setWidth(clampWidth(persisted, minWidth, maxWidth));
    }, [initialWidth, maxWidth, minWidth, storageKey]);

    // Persist width when dragging ends
    useEffect(() => {
        if (skipNextPersistRef.current) {
            skipNextPersistRef.current = false;
            return;
        }
        if (!isDragging && storageKey) {
            try { localStorage.setItem(storageKey, String(width)); } catch { /* ignore */ }
        }
    }, [isDragging, width, storageKey]);

    // Global mouse/touch listeners while dragging
    useEffect(() => {
        if (!isDragging) return;

        // While dragging, cover the viewport with a transparent overlay so the
        // pointer stays over the main document the whole time. Without it, a
        // drag that crosses an <iframe> (e.g. the canvas panel) stalls: the
        // iframe is a separate document that swallows `mousemove`, so the drag
        // only tracks while the cursor is exactly over the thin resize handle.
        // The overlay keeps pointer events flowing regardless of what sits
        // underneath, and gives a consistent resize cursor across the window.
        const overlay = document.createElement('div');
        overlay.setAttribute('data-resize-overlay', '');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '9999';
        overlay.style.cursor = isVertical ? 'row-resize' : 'col-resize';
        overlay.style.userSelect = 'none';
        document.body.appendChild(overlay);

        const handleMouseMove = (e: MouseEvent) => {
            e.preventDefault();
            onMove(isVertical ? e.clientY : e.clientX);
        };
        const handleMouseUp = () => onEnd();
        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                onMove(isVertical ? e.touches[0].clientY : e.touches[0].clientX);
            }
        };
        const handleTouchEnd = () => onEnd();

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
            overlay.remove();
        };
    }, [isDragging, onMove, onEnd, isVertical]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        startCoordRef.current = isVertical ? e.clientY : e.clientX;
        startWidthRef.current = width;
        setIsDragging(true);
    }, [width, isVertical]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        startCoordRef.current = isVertical ? e.touches[0].clientY : e.touches[0].clientX;
        startWidthRef.current = width;
        setIsDragging(true);
    }, [width, isVertical]);

    const resetWidth = useCallback(() => {
        setWidth(initialWidth);
        if (storageKey) {
            try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
        }
    }, [initialWidth, storageKey]);

    return { width, isDragging, handleMouseDown, handleTouchStart, resetWidth };
}
