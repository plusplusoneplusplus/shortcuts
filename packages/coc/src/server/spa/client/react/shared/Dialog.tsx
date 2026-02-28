import { useEffect, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';

export interface DialogProps {
    open: boolean;
    onClose: () => void;
    /** When provided, a minimize button (▬) is rendered in the header next to the title. */
    onMinimize?: () => void;
    title?: string;
    children?: ReactNode;
    footer?: ReactNode;
    className?: string;
    /** Optional id applied to the outer overlay div for test selection. */
    id?: string;
}

export function Dialog({ open, onClose, onMinimize, title, children, footer, className, id }: DialogProps) {
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
    const base = hasMaxWOverride
        ? 'relative w-full rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-6 flex flex-col gap-4'
        : 'relative w-full max-w-lg rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-6 flex flex-col gap-4';

    return ReactDOM.createPortal(
        <div
            id={id}
            className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 dark:bg-black/60"
            onClick={onClose}
        >
            <div
                className={cn(base, className)}
                onClick={e => e.stopPropagation()}
            >
                {title && (
                    <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{title}</h2>
                        {onMinimize && (
                            <button
                                data-testid="dialog-minimize-btn"
                                className="ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm leading-none px-1"
                                onClick={onMinimize}
                                aria-label="Minimize"
                                title="Minimize (Esc)"
                            >
                                ▬
                            </button>
                        )}
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
