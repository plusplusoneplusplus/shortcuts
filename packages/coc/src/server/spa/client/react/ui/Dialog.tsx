import { useEffect, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { usePortalContainer } from './usePortalContainer';

export interface DialogProps {
    open: boolean;
    onClose: () => void;
    /** When provided, a minimize button (−) is rendered in the header next to the title. */
    onMinimize?: () => void;
    title?: string;
    children?: ReactNode;
    footer?: ReactNode;
    className?: string;
    /** Optional id applied to the outer overlay div for test selection. */
    id?: string;
    /** When true, the header close button is visually disabled and non-interactive. */
    disableClose?: boolean;
    /**
     * When provided, replaces the built-in header entirely. The consumer owns all
     * header UI. When set, `title`, `onMinimize`, and `disableClose` have no effect
     * on the header.
     */
    renderHeader?: () => ReactNode;
    /** When true, the dialog remains mounted but is visually hidden and inert. */
    hidden?: boolean;
}

export function Dialog({ open, onClose, onMinimize, title, children, footer, className, id, disableClose, renderHeader, hidden }: DialogProps) {
    const { isMobile } = useBreakpoint();
    const portalContainer = usePortalContainer(open);

    useEffect(() => {
        if (!open || hidden) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, hidden, onClose]);

    if (!open || !portalContainer) return null;

    const hasMaxWOverride = className ? /\bmax-w-\[/.test(className) : false;

    const overlayClass = isMobile
        ? 'fixed inset-0 z-[10002] bg-white dark:bg-[#252526]'
        : 'fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 dark:bg-black/60';

    const panelClass = isMobile
        ? 'w-full h-full flex flex-col p-4 overflow-hidden'
        : cn(
            hasMaxWOverride
                ? 'relative w-full max-h-[90vh] overflow-hidden rounded-lg bg-white dark:bg-[#252526] border border-[#c8c8c8] dark:border-[#555555] shadow-xl p-6 flex flex-col gap-4'
                : 'relative w-full max-w-lg max-h-[90vh] overflow-hidden rounded-lg bg-white dark:bg-[#252526] border border-[#c8c8c8] dark:border-[#555555] shadow-xl p-6 flex flex-col gap-4',
            className,
        );

    // On mobile, close button is always shown (no backdrop to tap)
    const showCloseBtn = isMobile || !!title;
    const closeDisabled = isMobile ? false : !!disableClose;

    return ReactDOM.createPortal(
        <div
            id={id}
            data-testid="dialog-overlay"
            className={overlayClass}
            onClick={isMobile ? undefined : (onMinimize ?? onClose)}
            onMouseDown={e => e.stopPropagation()}
            style={hidden ? { display: 'none' } : undefined}
            aria-hidden={hidden || undefined}
        >
            <div
                className={isMobile ? panelClass : panelClass}
                onClick={e => e.stopPropagation()}
            >
                {renderHeader
                    ? renderHeader()
                    : (showCloseBtn && (
                    <div className="flex items-center gap-2">
                        {title && <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{title}</h2>}
                        {onMinimize && (
                            <button
                                data-testid="dialog-minimize-btn"
                                className="ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1"
                                onClick={onMinimize}
                                aria-label="Minimize"
                                title="Minimize"
                            >
                                −
                            </button>
                        )}
                        <button
                            data-testid="dialog-close-btn"
                            className={cn(
                                !onMinimize && !title && 'ml-auto',
                                !onMinimize && title && 'ml-auto',
                                'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1',
                                closeDisabled && 'pointer-events-none opacity-40'
                            )}
                            onClick={closeDisabled ? undefined : onClose}
                            aria-label="Close"
                            title="Close"
                            disabled={closeDisabled}
                        >
                            ×
                        </button>
                    </div>
                ))}
                <div className={cn('text-sm text-[#1e1e1e] dark:text-[#cccccc] flex-1 min-h-0 overflow-y-auto')}>{children}</div>
                {footer && (
                    <div className="flex justify-end gap-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        portalContainer
    );
}
