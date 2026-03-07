import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface ResizeState {
    dir: ResizeDir;
    startX: number;
    startY: number;
    initialWidth: number;
    initialHeight: number;
    initialLeft: number;
    initialTop: number;
}

const RESIZE_HANDLES: { dir: ResizeDir; style: React.CSSProperties }[] = [
    { dir: 'n',  style: { top: 0, left: 8, right: 8, height: 6, cursor: 'ns-resize' } },
    { dir: 's',  style: { bottom: 0, left: 8, right: 8, height: 6, cursor: 'ns-resize' } },
    { dir: 'e',  style: { right: 0, top: 8, bottom: 8, width: 6, cursor: 'ew-resize' } },
    { dir: 'w',  style: { left: 0, top: 8, bottom: 8, width: 6, cursor: 'ew-resize' } },
    { dir: 'ne', style: { top: 0, right: 0, width: 10, height: 10, cursor: 'nesw-resize' } },
    { dir: 'nw', style: { top: 0, left: 0, width: 10, height: 10, cursor: 'nwse-resize' } },
    { dir: 'se', style: { bottom: 0, right: 0, width: 10, height: 10, cursor: 'nwse-resize' } },
    { dir: 'sw', style: { bottom: 0, left: 0, width: 10, height: 10, cursor: 'nesw-resize' } },
];

const DEFAULT_MIN_W = 480;
const DEFAULT_MIN_H = 200;

export interface FloatingDialogProps {
    open: boolean;
    onClose: () => void;
    /** When provided, a minimize button (−) is rendered in the header. */
    onMinimize?: () => void;
    title?: string;
    children?: ReactNode;
    footer?: ReactNode;
    className?: string;
    /** Optional id applied to the panel div for test selection. */
    id?: string;
    /** When true, the header close button is visually disabled and non-interactive. */
    disableClose?: boolean;
    /** When true, renders 8-direction resize handles so the panel can be resized by dragging edges/corners. */
    resizable?: boolean;
    /** Minimum width in px when resizable (default: 480). */
    minWidth?: number;
    /** Minimum height in px when resizable (default: 200). */
    minHeight?: number;
    /** Maximum width in px when resizable (unconstrained by default). */
    maxWidth?: number;
    /** Maximum height in px when resizable (unconstrained by default). */
    maxHeight?: number;
}

/**
 * FloatingDialog — a draggable, optionally resizable fixed-position panel with no backdrop overlay.
 *
 * Renders via a React portal into document.body. The rest of the page remains
 * fully interactive behind it. Use instead of Dialog on desktop/tablet to avoid
 * the dark overlay blocking the rest of the UI.
 */
export function FloatingDialog({
    open,
    onClose,
    onMinimize,
    title,
    children,
    footer,
    className,
    id,
    disableClose,
    resizable = false,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
}: FloatingDialogProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
    const resizeRef = useRef<ResizeState | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);

    // Keep constraint props accessible in the stable global-event effect via refs
    const minWRef = useRef(minWidth ?? DEFAULT_MIN_W);
    const minHRef = useRef(minHeight ?? DEFAULT_MIN_H);
    const maxWRef = useRef(maxWidth);
    const maxHRef = useRef(maxHeight);
    minWRef.current = minWidth ?? DEFAULT_MIN_W;
    minHRef.current = minHeight ?? DEFAULT_MIN_H;
    maxWRef.current = maxWidth;
    maxHRef.current = maxHeight;

    // ESC key handling
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    // Reset position and size when dialog opens
    useEffect(() => {
        if (open) { setPos(null); setSize(null); }
    }, [open]);

    // Global drag and resize tracking
    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (dragOffset.current) {
                setPos({
                    left: e.clientX - dragOffset.current.dx,
                    top: e.clientY - dragOffset.current.dy,
                });
                return;
            }
            if (!resizeRef.current) return;
            const { dir, startX, startY, initialWidth, initialHeight, initialLeft, initialTop } = resizeRef.current;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let w = initialWidth;
            let h = initialHeight;
            let l = initialLeft;
            let t = initialTop;
            if (dir.includes('e')) w = initialWidth + dx;
            if (dir.includes('s')) h = initialHeight + dy;
            if (dir.includes('w')) { w = initialWidth - dx; l = initialLeft + dx; }
            if (dir.includes('n')) { h = initialHeight - dy; t = initialTop + dy; }
            const minW = minWRef.current;
            const minH = minHRef.current;
            const maxW = maxWRef.current;
            const maxH = maxHRef.current;
            if (w < minW) { if (dir.includes('w')) l = initialLeft + initialWidth - minW; w = minW; }
            if (h < minH) { if (dir.includes('n')) t = initialTop + initialHeight - minH; h = minH; }
            if (maxW !== undefined && w > maxW) w = maxW;
            if (maxH !== undefined && h > maxH) h = maxH;
            const vpW = window.innerWidth;
            const vpH = window.innerHeight;
            if (l < 0) { w = w + l; l = 0; if (w < minW) w = minW; }
            if (t < 0) { h = h + t; t = 0; if (h < minH) h = minH; }
            if (l + w > vpW) w = vpW - l;
            if (t + h > vpH) h = vpH - t;
            setSize({ width: w, height: h });
            setPos({ left: l, top: t });
        };
        const onMouseUp = () => {
            dragOffset.current = null;
            resizeRef.current = null;
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    if (!open) return null;

    const hasMaxWOverride = className ? /\bmax-w-\[/.test(className) : false;

    const panelStyle: React.CSSProperties = {
        ...(pos
            ? { left: pos.left, top: pos.top, transform: 'none' }
            : { top: '10vh', left: '50%', transform: 'translateX(-50%)' }),
        ...(size ? { width: size.width, height: size.height, maxWidth: 'none', minWidth: 'unset' } : {}),
    };

    const panelClass = cn(
        'fixed z-[10002]',
        hasMaxWOverride
            ? 'w-full rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-6 flex flex-col gap-4'
            : 'w-full max-w-[600px] min-w-[480px] rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-6 flex flex-col gap-4',
        className,
    );

    const handleTitleBarMouseDown = (e: React.MouseEvent) => {
        if (!panelRef.current) return;
        e.preventDefault();
        const rect = panelRef.current.getBoundingClientRect();
        dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    };

    const handleResizeMouseDown = (dir: ResizeDir) => (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!panelRef.current) return;
        const rect = panelRef.current.getBoundingClientRect();
        resizeRef.current = {
            dir,
            startX: e.clientX,
            startY: e.clientY,
            initialWidth: rect.width,
            initialHeight: rect.height,
            initialLeft: rect.left,
            initialTop: rect.top,
        };
    };

    const showHeader = !!(title || onMinimize || true); // always show header for close button
    const closeDisabled = !!disableClose;

    return ReactDOM.createPortal(
        <div
            ref={panelRef}
            id={id}
            data-testid="floating-dialog-panel"
            className={panelClass}
            style={panelStyle}
        >
            {/* 8-direction resize handles — rendered only when resizable=true */}
            {resizable && RESIZE_HANDLES.map(({ dir, style }) => (
                <div
                    key={dir}
                    data-resize={dir}
                    data-testid={`resize-handle-${dir}`}
                    style={{ position: 'absolute', ...style }}
                    onMouseDown={handleResizeMouseDown(dir)}
                />
            ))}
            {/* Subtle resize-grip icon in bottom-right corner */}
            {resizable && (
                <div
                    data-testid="resize-grip"
                    style={{
                        position: 'absolute',
                        bottom: 3,
                        right: 3,
                        width: 10,
                        height: 10,
                        cursor: 'nwse-resize',
                        opacity: 0.3,
                        backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
                        backgroundSize: '3px 3px',
                        pointerEvents: 'none',
                    }}
                />
            )}
            {showHeader && (
                <div
                    className="flex items-center gap-2 cursor-move select-none"
                    onMouseDown={handleTitleBarMouseDown}
                    data-testid="floating-dialog-drag-handle"
                >
                    {title && (
                        <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            {title}
                        </h2>
                    )}
                    {onMinimize && (
                        <button
                            data-testid="dialog-minimize-btn"
                            className="ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1"
                            onClick={onMinimize}
                            onMouseDown={e => e.stopPropagation()}
                            aria-label="Minimize"
                            title="Minimize"
                        >
                            −
                        </button>
                    )}
                    <button
                        data-testid="dialog-close-btn"
                        className={cn(
                            !onMinimize && 'ml-auto',
                            'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1',
                            closeDisabled && 'pointer-events-none opacity-40',
                        )}
                        onClick={closeDisabled ? undefined : onClose}
                        onMouseDown={e => e.stopPropagation()}
                        aria-label="Close"
                        title="Close"
                        disabled={closeDisabled}
                    >
                        ×
                    </button>
                </div>
            )}
            <div className={cn('text-sm text-[#1e1e1e] dark:text-[#cccccc]', resizable && size && 'overflow-y-auto flex-1 min-h-0')}>{children}</div>
            {footer && (
                <div className="flex justify-end gap-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {footer}
                </div>
            )}
        </div>,
        document.body,
    );
}
