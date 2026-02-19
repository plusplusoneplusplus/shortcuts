/**
 * ContextMenu — portal-based right-click context menu for markdown review.
 */

import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

export interface ContextMenuItem {
    label: string;
    icon?: string;
    disabled?: boolean;
    onClick: () => void;
}

export interface ContextMenuProps {
    position: { x: number; y: number };
    items: ContextMenuItem[];
    onClose: () => void;
}

export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    // Close on click outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // Delay to avoid immediate close from the same right-click
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handler);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handler);
        };
    }, [onClose]);

    return ReactDOM.createPortal(
        <div
            ref={menuRef}
            className="fixed z-[10004] min-w-[160px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl rounded-md py-1"
            style={{ top: position.y, left: position.x }}
            data-testid="context-menu"
            role="menu"
        >
            {items.map((item, i) => (
                <button
                    key={i}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        item.disabled
                            ? 'text-[#a0a0a0] dark:text-[#5a5a5a] cursor-default'
                            : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer'
                    }`}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!item.disabled) {
                            item.onClick();
                            onClose();
                        }
                    }}
                    disabled={item.disabled}
                    role="menuitem"
                    data-testid={`context-menu-item-${i}`}
                >
                    {item.icon && <span className="mr-1.5">{item.icon}</span>}
                    {item.label}
                </button>
            ))}
        </div>,
        document.body
    );
}
