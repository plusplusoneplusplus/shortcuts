import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';

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
}

/**
 * FloatingDialog — a draggable fixed-position panel with no backdrop overlay.
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
}: FloatingDialogProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    // ESC key handling
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (onMinimize) onMinimize();
                else onClose();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose, onMinimize]);

    // Reset position when dialog opens
    useEffect(() => {
        if (open) setPos(null);
    }, [open]);

    // Global drag tracking
    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!dragOffset.current) return;
            setPos({
                left: e.clientX - dragOffset.current.dx,
                top: e.clientY - dragOffset.current.dy,
            });
        };
        const onMouseUp = () => {
            dragOffset.current = null;
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

    const panelStyle: React.CSSProperties = pos
        ? { left: pos.left, top: pos.top, transform: 'none' }
        : { top: '10vh', left: '50%', transform: 'translateX(-50%)' };

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
                            title="Minimize (Esc)"
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
            <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">{children}</div>
            {footer && (
                <div className="flex justify-end gap-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {footer}
                </div>
            )}
        </div>,
        document.body,
    );
}
