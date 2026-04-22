import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../ui/cn';

export interface OverflowMenuItem {
    key: string;
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    /** Rendered as a distinct inline element instead of a menu row */
    render?: () => ReactNode;
}

interface ChatHeaderOverflowMenuProps {
    items: OverflowMenuItem[];
    /** Workspace ID stamped on the portal div so DOM traversal in file-path-preview.ts can resolve it. */
    wsId?: string;
}

export function ChatHeaderOverflowMenu({ items, wsId }: ChatHeaderOverflowMenuProps) {
    const [open, setOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);

    const handleToggle = useCallback(() => {
        if (open) {
            setOpen(false);
            return;
        }
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 4, left: rect.right });
        setOpen(true);
    }, [open]);

    // Position correction after render
    useEffect(() => {
        if (!open || !popoverRef.current || !triggerRef.current) return;
        const popover = popoverRef.current;
        const trigger = triggerRef.current;
        const popoverRect = popover.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();

        let { top, left } = menuPos;
        left = triggerRect.right - popoverRect.width;
        if (left < 8) left = 8;
        if (left + popoverRect.width > window.innerWidth - 8) {
            left = window.innerWidth - popoverRect.width - 8;
        }
        if (top + popoverRect.height > window.innerHeight - 8) {
            top = triggerRect.top - popoverRect.height - 4;
        }
        if (top < 8) top = 8;
        if (top !== menuPos.top || left !== menuPos.left) {
            setMenuPos({ top, left });
        }
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (popoverRef.current?.contains(target)) return;
            if (triggerRef.current?.contains(target)) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    if (items.length === 0) return null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={open ? 'Close overflow menu' : 'More actions'}
                title="More actions"
                data-testid="chat-header-overflow-btn"
                onClick={handleToggle}
                className="inline-flex items-center justify-center p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <circle cx="8" cy="3" r="1.5" fill="currentColor" />
                    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="8" cy="13" r="1.5" fill="currentColor" />
                </svg>
            </button>

            {open && ReactDOM.createPortal(
                <div
                    ref={popoverRef}
                    data-testid="chat-header-overflow-menu"
                    {...(wsId ? { 'data-ws-id': wsId } : {})}
                    className={cn(
                        'fixed z-[10003] min-w-[200px] max-w-[300px] rounded-md',
                        'border border-[#e0e0e0] dark:border-[#3c3c3c]',
                        'bg-white dark:bg-[#252526] shadow-lg py-1',
                    )}
                    style={{ top: menuPos.top, left: menuPos.left }}
                >
                    {items.map(item => {
                        if (item.render) {
                            return (
                                <div key={item.key} className="px-2 py-1">
                                    {item.render()}
                                </div>
                            );
                        }
                        return (
                            <button
                                key={item.key}
                                data-testid={`overflow-item-${item.key}`}
                                onClick={() => {
                                    item.onClick();
                                    setOpen(false);
                                }}
                                className={cn(
                                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm',
                                    'text-[#1e1e1e] dark:text-[#cccccc]',
                                    'hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]',
                                    'min-h-[44px]',
                                )}
                            >
                                {item.icon && <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[#848484]">{item.icon}</span>}
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>,
                document.body,
            )}
        </>
    );
}
