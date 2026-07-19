import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { usePortalContainer } from './usePortalContainer';

export interface ImageLightboxProps {
    /** Base64 data URL (or resolved image URL) to show, or null to hide the lightbox */
    src: string | null;
    alt?: string;
    onClose: () => void;
}

/** Minimum scale is fit-to-screen; maximum is a generous cap above native pixels. */
const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** Multiplicative step for the zoom-in / zoom-out buttons. */
const BUTTON_ZOOM_STEP = 1.5;
/** Pointer travel (px) past which a mouse gesture counts as a pan rather than a click. */
const DRAG_THRESHOLD = 3;

interface View {
    scale: number;
    x: number;
    y: number;
}

const FIT_VIEW: View = { scale: MIN_SCALE, x: 0, y: 0 };

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Full-screen overlay for viewing a single image, with fit-to-screen default
 * plus wheel/trackpad zoom, click-drag panning, and on-screen zoom controls.
 * Renders via portal to document.body (z-index 10003, above Dialog's 10002).
 *
 * The zoom/pan state is internal, so every existing consumer keeps working
 * against the unchanged `{ src, alt, onClose }` API and inherits the behavior.
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
    const portalContainer = usePortalContainer(Boolean(src));

    const overlayRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const [view, setView] = useState<View>(FIT_VIEW);
    const [dragging, setDragging] = useState(false);

    // Mirror the latest view into a ref so the imperative wheel/drag handlers can
    // read current scale/offset without being re-created on every state change.
    const viewRef = useRef(view);
    viewRef.current = view;

    // Suppresses the backdrop click that follows a pan gesture so a drag that
    // ends over the backdrop does not close the lightbox.
    const suppressClickRef = useRef(false);
    const dragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0, moved: false });

    // Reset to fit-to-screen whenever a new image opens.
    useEffect(() => {
        setView(FIT_VIEW);
    }, [src]);

    useEffect(() => {
        if (!src) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [src, onClose]);

    // Clamp pan offset so the image cannot be dragged completely off-screen.
    // When rendered dimensions are unavailable (e.g. jsdom), leave the offset as-is.
    const clampOffset = useCallback((x: number, y: number, scale: number) => {
        const img = imgRef.current;
        const overlay = overlayRef.current;
        if (!img || !overlay) return { x, y };
        const renderedW = img.offsetWidth * scale;
        const renderedH = img.offsetHeight * scale;
        if (!renderedW || !renderedH) return { x, y };
        const rect = overlay.getBoundingClientRect();
        const vw = rect.width || (typeof window !== 'undefined' ? window.innerWidth : renderedW);
        const vh = rect.height || (typeof window !== 'undefined' ? window.innerHeight : renderedH);
        const maxX = Math.max((renderedW - vw) / 2, 0);
        const maxY = Math.max((renderedH - vh) / 2, 0);
        return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
    }, []);

    // Zoom to `nextScale`, keeping the point under (anchorX, anchorY) fixed.
    const zoomTo = useCallback((nextScale: number, anchorX: number, anchorY: number) => {
        const overlay = overlayRef.current;
        const { scale, x, y } = viewRef.current;
        const newScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
        if (newScale === scale) return;
        if (newScale <= MIN_SCALE) {
            setView(FIT_VIEW);
            return;
        }
        const rect = overlay?.getBoundingClientRect();
        const cx = rect ? rect.left + rect.width / 2 : (typeof window !== 'undefined' ? window.innerWidth / 2 : 0);
        const cy = rect ? rect.top + rect.height / 2 : (typeof window !== 'undefined' ? window.innerHeight / 2 : 0);
        // Anchor point relative to the image's centered origin.
        const ax = anchorX - cx;
        const ay = anchorY - cy;
        const ratio = newScale / scale;
        const nx = ax - (ax - x) * ratio;
        const ny = ay - (ay - y) * ratio;
        const clamped = clampOffset(nx, ny, newScale);
        setView({ scale: newScale, x: clamped.x, y: clamped.y });
    }, [clampOffset]);

    const zoomFromCenter = useCallback((nextScale: number) => {
        const overlay = overlayRef.current;
        const rect = overlay?.getBoundingClientRect();
        const cx = rect ? rect.left + rect.width / 2 : (typeof window !== 'undefined' ? window.innerWidth / 2 : 0);
        const cy = rect ? rect.top + rect.height / 2 : (typeof window !== 'undefined' ? window.innerHeight / 2 : 0);
        zoomTo(nextScale, cx, cy);
    }, [zoomTo]);

    // Native (non-passive) wheel listener so we can preventDefault the page scroll.
    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay || !src) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const factor = Math.exp(-e.deltaY * 0.0015);
            zoomTo(viewRef.current.scale * factor, e.clientX, e.clientY);
        };
        overlay.addEventListener('wheel', onWheel, { passive: false });
        return () => overlay.removeEventListener('wheel', onWheel);
    }, [src, zoomTo]);

    const onDragMove = useCallback((e: MouseEvent) => {
        const d = dragRef.current;
        if (!d.active) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) d.moved = true;
        const clamped = clampOffset(d.originX + dx, d.originY + dy, viewRef.current.scale);
        setView(v => ({ ...v, x: clamped.x, y: clamped.y }));
    }, [clampOffset]);

    const onDragEnd = useCallback(() => {
        const d = dragRef.current;
        d.active = false;
        if (d.moved) suppressClickRef.current = true;
        setDragging(false);
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
    }, [onDragMove]);

    useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', onDragMove);
            window.removeEventListener('mouseup', onDragEnd);
        };
    }, [onDragMove, onDragEnd]);

    const onImageMouseDown = useCallback((e: React.MouseEvent) => {
        if (viewRef.current.scale <= MIN_SCALE) return; // panning only makes sense when zoomed
        e.preventDefault();
        const { x, y } = viewRef.current;
        dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, originX: x, originY: y, moved: false };
        setDragging(true);
        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragEnd);
    }, [onDragMove, onDragEnd]);

    const onImageDoubleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (viewRef.current.scale > MIN_SCALE) {
            setView(FIT_VIEW);
            return;
        }
        // Toggle toward actual pixels (native width / fit width) when measurable,
        // otherwise fall back to a sensible zoom-in.
        const img = imgRef.current;
        let target = 2;
        if (img && img.naturalWidth && img.offsetWidth) {
            target = clamp(img.naturalWidth / img.offsetWidth, MIN_SCALE, MAX_SCALE);
            if (target <= MIN_SCALE + 0.001) target = 2;
        }
        zoomTo(target, e.clientX, e.clientY);
    }, [zoomTo]);

    const onOverlayClick = useCallback(() => {
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
        }
        onClose();
    }, [onClose]);

    if (!src || !portalContainer) return null;

    const zoomedIn = view.scale > MIN_SCALE;
    const imgCursor = zoomedIn ? (dragging ? 'grabbing' : 'grab') : 'default';

    const controlBtn =
        'w-8 h-8 flex items-center justify-center rounded bg-black/50 text-white text-lg leading-none ' +
        'border-none hover:bg-black/70 disabled:opacity-40 disabled:cursor-default cursor-pointer';

    return ReactDOM.createPortal(
        <div
            ref={overlayRef}
            className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/80 cursor-zoom-out select-none overflow-hidden"
            data-testid="image-lightbox"
            onClick={onOverlayClick}
        >
            <img
                ref={imgRef}
                src={src}
                alt={alt}
                draggable={false}
                className="max-w-[95vw] max-h-[90vh] object-contain rounded shadow-2xl"
                style={{
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                    transformOrigin: 'center center',
                    transition: dragging ? 'none' : 'transform 0.08s ease-out',
                    cursor: imgCursor,
                    willChange: 'transform',
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={onImageMouseDown}
                onDoubleClick={onImageDoubleClick}
            />
            <div
                className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2"
                data-testid="lightbox-controls"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    className={controlBtn}
                    onClick={() => zoomFromCenter(view.scale / BUTTON_ZOOM_STEP)}
                    disabled={view.scale <= MIN_SCALE}
                    aria-label="Zoom out"
                    data-testid="lightbox-zoom-out"
                >
                    −
                </button>
                <button
                    type="button"
                    className={controlBtn}
                    onClick={() => zoomFromCenter(view.scale * BUTTON_ZOOM_STEP)}
                    disabled={view.scale >= MAX_SCALE}
                    aria-label="Zoom in"
                    data-testid="lightbox-zoom-in"
                >
                    +
                </button>
                <button
                    type="button"
                    className={controlBtn}
                    onClick={() => setView(FIT_VIEW)}
                    disabled={view.scale === MIN_SCALE && view.x === 0 && view.y === 0}
                    aria-label="Reset zoom"
                    data-testid="lightbox-reset"
                >
                    ⤢
                </button>
            </div>
            <button
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white text-lg leading-none cursor-pointer border-none hover:bg-black/70"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                aria-label="Close lightbox"
                data-testid="lightbox-close"
            >
                ×
            </button>
        </div>,
        portalContainer
    );
}
