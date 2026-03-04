import { useEffect, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';
import { useBreakpoint } from '../hooks/useBreakpoint';

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
}

export function Dialog({ open, onClose, onMinimize, title, children, footer, className, id, disableClose }: DialogProps) {
    const { isMobile } = useBreakpoint();

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

    if (!open) return null;

    const hasMaxWOverride = className ? /\bmax-w-\[/.test(className) : false;

    const overlayClass = isMobile
        ? 'fixed inset-0 z-[10002] bg-white dark:bg-[#252526]'
        : 'fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 dark:bg-black/60';

    const panelClass = isMobile
        ? 'w-full h-full flex flex-col p-4 overflow-y-auto'
        : cn(
            hasMaxWOverride
                ? 'relative w-full rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-6 flex flex-col gap-4'
                : 'relative w-full max-w-lg rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-6 flex flex-col gap-4',
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
        >
            <div
                className={isMobile ? panelClass : panelClass}
                onClick={e => e.stopPropagation()}
            >
                {showCloseBtn && (
                    <div className="flex items-center gap-2">
                        {title && <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{title}</h2>}
                        {onMinimize && (
                            <button
                                data-testid="dialog-minimize-btn"
                                className="ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1"
                                onClick={onMinimize}
                                aria-label="Minimize"
                                title="Minimize (Esc)"
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
                )}
                <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">{children}</div>
                {footer && (
                    <div className="flex justify-end gap-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                        {footer}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
