/**
 * ContextMenu — portal-based right-click context menu.
 *
 * Supports viewport clamping (menu stays within the visible area) and
 * visual separators between logical groups of items.
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { BottomSheet } from '../../ui/BottomSheet';

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

/**
 * Work out where a submenu panel should sit vertically and how tall it may be.
 *
 * The panel is anchored at the top of its parent row. When the content is
 * taller than the room below that anchor, we compare the space below with the
 * space above, keep whichever is larger, and cap the panel to it so the list
 * scrolls instead of spilling off-screen.
 */
export function clampSubmenuVertical(
    anchor: { top: number; bottom: number; height: number },
    contentHeight: number,
    vpHeight: number = window.innerHeight,
    margin: number = VIEWPORT_MARGIN,
): { topOffset: number; maxHeight: number | null } {
    const spaceBelow = vpHeight - anchor.top - margin;
    const spaceAbove = anchor.bottom - margin;

    if (contentHeight <= spaceBelow) return { topOffset: 0, maxHeight: null };

    if (spaceBelow >= spaceAbove) {
        return { topOffset: 0, maxHeight: Math.max(spaceBelow, 0) };
    }

    // Grow upwards: bottom edge stays pinned to the row's bottom.
    const usable = Math.max(spaceAbove, 0);
    const height = Math.min(contentHeight, usable);
    return { topOffset: -(height - anchor.height), maxHeight: usable };
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
    const [openLeft, setOpenLeft] = useState(false);
    const [topOffset, setTopOffset] = useState(0);
    const [maxHeight, setMaxHeight] = useState<number | null>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const subRef = useRef<HTMLDivElement>(null);

    const handleEnter = useCallback(() => {
        if (rowRef.current) {
            const rect = rowRef.current.getBoundingClientRect();
            // Flip submenu to the left if not enough space on the right (use max-width 240px)
            setOpenLeft(rect.right + 240 + VIEWPORT_MARGIN > window.innerWidth);
        }
        setOpen(true);
    }, []);

    // Adjust vertical position and height after render to keep submenu within viewport
    useLayoutEffect(() => {
        if (!open || !subRef.current) {
            setTopOffset(0);
            setMaxHeight(null);
            return;
        }
        const subRect = subRef.current.getBoundingClientRect();
        const rowRect = rowRef.current?.getBoundingClientRect();
        // scrollHeight is the un-clamped content height, so re-measuring an
        // already-capped panel does not shrink it further on every pass.
        const contentHeight = Math.max(subRef.current.scrollHeight, subRect.height);
        const anchor = rowRect
            ? { top: rowRect.top, bottom: rowRect.bottom, height: rowRect.height }
            : { top: subRect.top, bottom: subRect.top, height: 0 };
        const next = clampSubmenuVertical(anchor, contentHeight);
        setTopOffset(next.topOffset);
        setMaxHeight(next.maxHeight);
    }, [open]);

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
                onMouseDown={(e) => e.preventDefault()}
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
                    className={`absolute ${openLeft ? 'right-full' : 'left-full'} top-0 z-[10005] min-w-[160px] max-w-[240px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl rounded-md py-1`}
                    style={{
                        ...(topOffset !== 0 ? { top: topOffset } : {}),
                        ...(maxHeight !== null ? { maxHeight, overflowY: 'auto' as const } : {}),
                    }}
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
                        if (child.children && child.children.length > 0) {
                            return (
                                <SubmenuItem
                                    key={ci}
                                    item={child}
                                    idx={ci}
                                    onClose={onClose}
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
                                onMouseDown={(e) => e.preventDefault()}
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
    const { isMobile } = useBreakpoint();
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

    if (isMobile) {
        const flatItems: { item: ContextMenuItem; sectionHeader?: string }[] = [];
        const flattenItems = (menuItems: ContextMenuItem[], parentLabel?: string) => {
            for (const item of menuItems) {
                if (item.separator) continue;
                if (item.children && item.children.length > 0) {
                    const header = parentLabel ? `${parentLabel} › ${item.label}` : item.label;
                    flatItems.push({ item, sectionHeader: header });
                    flattenItems(item.children, header);
                } else {
                    flatItems.push({ item });
                }
            }
        };
        flattenItems(items);

        return (
            <BottomSheet isOpen={true} onClose={onClose} data-testid="context-menu-bottomsheet">
                <div className="flex flex-col" role="menu" data-testid="context-menu-mobile">
                    {flatItems.map((entry, i) => (
                        <div key={i}>
                            {entry.sectionHeader && (
                                <div className="px-4 pt-3 pb-1 text-xs font-semibold text-[#848484]">{entry.sectionHeader}</div>
                            )}
                            {!entry.sectionHeader && (
                                <button
                                    className={`w-full text-left px-4 py-3 min-h-[44px] text-sm transition-colors flex items-center gap-2 ${
                                        entry.item.disabled
                                            ? 'text-[#a0a0a0] dark:text-[#5a5a5a] cursor-default'
                                            : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer'
                                    }`}
                                    onClick={() => {
                                        if (!entry.item.disabled) {
                                            entry.item.onClick();
                                            onClose();
                                        }
                                    }}
                                    disabled={entry.item.disabled}
                                    role="menuitem"
                                >
                                    {entry.item.icon && <span>{entry.item.icon}</span>}
                                    {entry.item.label}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </BottomSheet>
        );
    }

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
                        onMouseDown={(e) => e.preventDefault()}
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
