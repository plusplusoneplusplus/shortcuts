/**
 * ContextMenu — portal-based right-click context menu.
 *
 * Supports viewport clamping (menu stays within the visible area) and
 * visual separators between logical groups of items.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';

const VIEWPORT_MARGIN = 8;

export interface ContextMenuItem {
    label: string;
    icon?: string;
    disabled?: boolean;
    separator?: boolean;
    children?: ContextMenuItem[];
    onClick: () => void;
}

export interface ContextMenuProps {
    position: { x: number; y: number };
    items: ContextMenuItem[];
    onClose: () => void;
}

/**
 * Clamp the menu position so it stays fully inside the viewport.
 */
export function clampMenuPosition(
    pos: { x: number; y: number },
    menuWidth: number,
    menuHeight: number,
    vpWidth: number = window.innerWidth,
    vpHeight: number = window.innerHeight,
    margin: number = VIEWPORT_MARGIN,
): { x: number; y: number } {
    let { x, y } = pos;

    if (x + menuWidth + margin > vpWidth) {
        x = vpWidth - menuWidth - margin;
    }
    if (x < margin) x = margin;

    if (y + menuHeight + margin > vpHeight) {
        y = vpHeight - menuHeight - margin;
    }
    if (y < margin) y = margin;

    return { x, y };
}

function SubmenuItem({
    item,
    idx,
    onClose,
}: {
    item: ContextMenuItem;
    idx: number;
    onClose: () => void;
}) {
    const [open, setOpen] = useState(false);
    const rowRef = useRef<HTMLDivElement>(null);
    const subRef = useRef<HTMLDivElement>(null);

    const handleEnter = useCallback(() => setOpen(true), []);
    const handleLeave = useCallback((e: React.MouseEvent) => {
        const related = e.relatedTarget as Node | null;
        if (
            subRef.current?.contains(related) ||
            rowRef.current?.contains(related)
        ) return;
        setOpen(false);
    }, []);

    return (
        <div
            ref={rowRef}
            className="relative"
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            data-testid={`context-menu-item-${idx}`}
        >
            <button
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                    item.disabled
                        ? 'text-[#a0a0a0] dark:text-[#5a5a5a] cursor-default'
                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer'
                }`}
                disabled={item.disabled}
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={open}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(prev => !prev);
                }}
            >
                <span>
                    {item.icon && <span className="mr-1.5">{item.icon}</span>}
                    {item.label}
                </span>
                <span className="ml-2 text-[10px] text-[#848484]">▶</span>
            </button>
            {open && item.children && (
                <div
                    ref={subRef}
                    className="absolute left-full top-0 z-[10005] min-w-[160px] max-w-[240px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl rounded-md py-1"
                    onMouseLeave={handleLeave}
                    data-testid={`context-submenu-${idx}`}
                    role="menu"
                >
                    {item.children.map((child, ci) => {
                        if (child.separator) {
                            return (
                                <div
                                    key={`sub-sep-${ci}`}
                                    className="my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                                    role="separator"
                                />
                            );
                        }
                        return (
                            <button
                                key={ci}
                                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                    child.disabled
                                        ? 'text-[#a0a0a0] dark:text-[#5a5a5a] cursor-default'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer'
                                }`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!child.disabled) {
                                        child.onClick();
                                        onClose();
                                    }
                                }}
                                disabled={child.disabled}
                                role="menuitem"
                                data-testid={`context-submenu-${idx}-item-${ci}`}
                            >
                                {child.icon && <span className="mr-1.5">{child.icon}</span>}
                                {child.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [clamped, setClamped] = useState(position);

    // Clamp position after first render so we know the menu dimensions
    useEffect(() => {
        if (!menuRef.current) return;
        const rect = menuRef.current.getBoundingClientRect();
        setClamped(clampMenuPosition(position, rect.width, rect.height));
    }, [position]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handler);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handler);
        };
    }, [onClose]);

    let itemIndex = 0;

    return ReactDOM.createPortal(
        <div
            ref={menuRef}
            className="fixed z-[10004] min-w-[160px] max-w-[240px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl rounded-md py-1"
            style={{ top: clamped.y, left: clamped.x }}
            data-testid="context-menu"
            role="menu"
        >
            {items.map((item, i) => {
                if (item.separator) {
                    return (
                        <div
                            key={`sep-${i}`}
                            className="my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                            role="separator"
                            data-testid={`context-menu-separator-${i}`}
                        />
                    );
                }
                const idx = itemIndex++;
                if (item.children && item.children.length > 0) {
                    return (
                        <SubmenuItem
                            key={i}
                            item={item}
                            idx={idx}
                            onClose={onClose}
                        />
                    );
                }
                return (
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
                        data-testid={`context-menu-item-${idx}`}
                    >
                        {item.icon && <span className="mr-1.5">{item.icon}</span>}
                        {item.label}
                    </button>
                );
            })}
        </div>,
        document.body
    );
}
