import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseResizablePanelOptions {
    /** Initial width of the panel in pixels. Default: 320 */
    initialWidth?: number;
    /** Minimum width of the panel in pixels. Default: 160 */
    minWidth?: number;
    /** Maximum width of the panel in pixels. Default: 600 */
    maxWidth?: number;
    /** localStorage key to persist width. If set, the width is saved/restored. */
    storageKey?: string;
    /** Which side the resizable panel is on. 'left' (default): drag right to widen. 'right': drag left to widen. */
    direction?: 'left' | 'right';
}

export interface UseResizablePanelReturn {
    /** Current width of the panel in px. */
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
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);
    const skipNextPersistRef = useRef(false);

    const onMove = useCallback((clientX: number) => {
        const rawDelta = clientX - startXRef.current;
        const delta = direction === 'right' ? -rawDelta : rawDelta;
        const newWidth = clampWidth(startWidthRef.current + delta, minWidth, maxWidth);
        setWidth(newWidth);
    }, [minWidth, maxWidth, direction]);

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

        const handleMouseMove = (e: MouseEvent) => {
            e.preventDefault();
            onMove(e.clientX);
        };
        const handleMouseUp = () => onEnd();
        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                onMove(e.touches[0].clientX);
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
        };
    }, [isDragging, onMove, onEnd]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        startXRef.current = e.clientX;
        startWidthRef.current = width;
        setIsDragging(true);
    }, [width]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        startXRef.current = e.touches[0].clientX;
        startWidthRef.current = width;
        setIsDragging(true);
    }, [width]);

    const resetWidth = useCallback(() => {
        setWidth(initialWidth);
        if (storageKey) {
            try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
        }
    }, [initialWidth, storageKey]);

    return { width, isDragging, handleMouseDown, handleTouchStart, resetWidth };
}
