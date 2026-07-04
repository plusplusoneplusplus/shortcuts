/**
 * ContextMenu — portal-rendered right-click menu shared by the template list items
 * (commit, AI chat, and prompt/script) in the template management surfaces.
 */

import { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../../ui';

export interface ContextMenuItem {
    label: string;
    onClick: () => void;
    danger?: boolean;
}

export interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    useEffect(() => {
        const handler = () => onClose();
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [onClose]);

    return ReactDOM.createPortal(
        <div
            className="fixed bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1 z-[10003]"
            style={{ left: x, top: y }}
            data-testid="template-context-menu"
        >
            {items.map(item => (
                <button
                    key={item.label}
                    className={cn(
                        "block w-full text-left px-4 py-1.5 text-sm hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]",
                        item.danger ? "text-red-500" : "text-[#1e1e1e] dark:text-[#cccccc]"
                    )}
                    onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
                >
                    {item.label}
                </button>
            ))}
        </div>,
        document.body
    );
}
