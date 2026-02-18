import { useEffect, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';

export interface DialogProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    children?: ReactNode;
    footer?: ReactNode;
    className?: string;
}

export function Dialog({ open, onClose, title, children, footer, className }: DialogProps) {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open) return null;

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/40 dark:bg-black/60"
            onClick={onClose}
        >
            <div
                className={cn(
                    'relative w-full max-w-lg rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-6 flex flex-col gap-4',
                    className
                )}
                onClick={e => e.stopPropagation()}
            >
                {title && (
                    <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{title}</h2>
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
