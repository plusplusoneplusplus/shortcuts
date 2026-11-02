import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { clampSubmenuVertical } from '../../../tasks/comments/ContextMenu';
import type {
    UnifiedPanelTabMenuAction,
    UnifiedPanelTabMenuItem,
} from './unifiedPanelTabMenuModel';

const VIEWPORT_MARGIN = 4;
export const CLOSE_OTHER_LABEL = 'Close Other';

/** Moves focus among enabled buttons for Arrow/Home/End; true when the key was handled. */
function moveFocus(key: string, focusable: HTMLButtonElement[]): boolean {
    if (focusable.length === 0) return false;
    const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (key === 'ArrowDown') next = (current + 1 + focusable.length) % focusable.length;
    else if (key === 'ArrowUp') next = (current - 1 + focusable.length) % focusable.length;
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = focusable.length - 1;
    else return false;
    focusable[next].focus();
    return true;
}

export interface UnifiedPanelTabContextMenuProps {
    x: number;
    y: number;
    items: readonly UnifiedPanelTabMenuItem[];
    onAction: (action: UnifiedPanelTabMenuAction) => void;
    onDismiss: () => void;
}

export function UnifiedPanelTabContextMenu({
    x,
    y,
    items,
    onAction,
    onDismiss,
}: UnifiedPanelTabContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef(new Map<UnifiedPanelTabMenuAction, HTMLButtonElement>());
    const closeOtherRef = useRef<HTMLButtonElement>(null);
    const submenuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x, y });
    const [submenuOpen, setSubmenuOpen] = useState(false);
    // Set when the submenu was opened from the keyboard, so focus moves into it.
    const [focusSubmenu, setFocusSubmenu] = useState(false);
    const [submenuPosition, setSubmenuPosition] = useState<{ left: number; top: number; maxHeight: number | null } | null>(null);

    const closeOtherItems = items.filter(item => item.group === 'close-other');
    const closeOtherDisabled = closeOtherItems.every(item => item.disabled);
    // The submenu row takes the place of its first child.
    const closeOtherIndex = closeOtherItems.length > 0 ? items.indexOf(closeOtherItems[0]) : -1;
    const rows = items.flatMap((item, index): Array<UnifiedPanelTabMenuItem | 'close-other'> => {
        if (item.group !== 'close-other') return [item];
        return index === closeOtherIndex ? ['close-other'] : [];
    });

    useLayoutEffect(() => {
        const rect = menuRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPosition({
            x: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
            y: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN)),
        });
    }, [x, y, items]);

    useEffect(() => {
        const first = rows.find(row => (row === 'close-other' ? !closeOtherDisabled : !row.disabled));
        if (first === 'close-other') closeOtherRef.current?.focus();
        else if (first) itemRefs.current.get(first.action)?.focus();
    }, [items]);

    // Keep the submenu beside its row and inside the viewport, flipping left
    // when there is no room on the right.
    useLayoutEffect(() => {
        const row = closeOtherRef.current?.getBoundingClientRect();
        const panel = submenuRef.current;
        if (!submenuOpen || !row || !panel) {
            setSubmenuPosition(null);
            return;
        }
        const rect = panel.getBoundingClientRect();
        const fitsRight = row.right + rect.width + VIEWPORT_MARGIN <= window.innerWidth;
        const left = fitsRight ? row.right : row.left - rect.width;
        const vertical = clampSubmenuVertical(
            { top: row.top, bottom: row.bottom, height: row.height },
            Math.max(panel.scrollHeight, rect.height),
        );
        setSubmenuPosition({
            left: Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
            top: Math.max(VIEWPORT_MARGIN, row.top + vertical.topOffset),
            maxHeight: vertical.maxHeight,
        });
    }, [submenuOpen, x, y, items]);

    useLayoutEffect(() => {
        if (!submenuOpen || !focusSubmenu) return;
        setFocusSubmenu(false);
        submenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    }, [submenuOpen, focusSubmenu]);

    useEffect(() => {
        const onMouseDown = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) onDismiss();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onDismiss();
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [onDismiss]);

    const enabledButtons = (list: readonly UnifiedPanelTabMenuItem[]) => list
        .filter(item => !item.disabled)
        .map(item => itemRefs.current.get(item.action))
        .filter((item): item is HTMLButtonElement => item !== undefined);

    const topLevelButtons = () => rows.flatMap(row => {
        if (row === 'close-other') return !closeOtherDisabled && closeOtherRef.current ? [closeOtherRef.current] : [];
        return enabledButtons([row]);
    });

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
            const current = topLevelButtons().indexOf(document.activeElement as HTMLButtonElement);
            if (current >= 0) {
                event.preventDefault();
                topLevelButtons()[current].click();
            }
            return;
        }
        if (moveFocus(event.key, topLevelButtons())) event.preventDefault();
    };

    const openSubmenuFromKeyboard = () => {
        setFocusSubmenu(true);
        setSubmenuOpen(true);
    };

    const closeSubmenuAndRefocus = () => {
        setSubmenuOpen(false);
        closeOtherRef.current?.focus();
    };

    const onSubmenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        // Handled keys stay in the submenu; Escape closes only the submenu.
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeSubmenuAndRefocus();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation();
            const focusable = enabledButtons(closeOtherItems);
            const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
            if (current >= 0) {
                event.preventDefault();
                focusable[current].click();
            }
            return;
        }
        if (moveFocus(event.key, enabledButtons(closeOtherItems))) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const renderItem = (item: UnifiedPanelTabMenuItem, onPointerEnter?: () => void) => (
        <button
            ref={node => {
                if (node) itemRefs.current.set(item.action, node);
                else itemRefs.current.delete(item.action);
            }}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-disabled={item.disabled}
            data-testid={`unified-panel-tab-menu-${item.action}`}
            onPointerEnter={onPointerEnter}
            onClick={() => {
                if (!item.disabled) onAction(item.action);
            }}
            className={[
                'block w-full border-none bg-transparent px-3 py-1 text-left',
                item.disabled
                    ? 'cursor-default text-[#a0a0a0] dark:text-[#666]'
                    : 'cursor-pointer hover:bg-[#e8e8e8] focus:bg-[#e8e8e8] focus:outline-none dark:hover:bg-[#37373d] dark:focus:bg-[#37373d]',
            ].join(' ')}
        >
            {item.label}
        </button>
    );

    let previousGroup: UnifiedPanelTabMenuItem['group'] | null = null;
    return (
        <div
            ref={menuRef}
            role="menu"
            aria-label="Tab actions"
            data-testid="unified-panel-tab-menu"
            style={{ top: position.y, left: position.x }}
            onKeyDown={onKeyDown}
            className="fixed z-50 min-w-[190px] rounded border border-[#e0e0e0] bg-white py-1 text-xs text-[#1e1e1e] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
        >
            {rows.map(row => {
                // The submenu row separates like the Close item it follows.
                const group = row === 'close-other' ? 'close' : row.group;
                const separator = previousGroup !== null && previousGroup !== group;
                previousGroup = group;
                return (
                    <div key={row === 'close-other' ? 'close-other' : row.action}>
                        {separator && (
                            <div
                                role="separator"
                                className="my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                            />
                        )}
                        {row === 'close-other' ? (
                            <>
                                <button
                                    ref={closeOtherRef}
                                    type="button"
                                    role="menuitem"
                                    aria-haspopup="menu"
                                    aria-expanded={submenuOpen}
                                    disabled={closeOtherDisabled}
                                    aria-disabled={closeOtherDisabled}
                                    data-testid="unified-panel-tab-menu-close-other"
                                    onPointerEnter={event => {
                                        // Touch opens on tap (click) only, so a tap does not open then toggle shut.
                                        if (!closeOtherDisabled && event.pointerType !== 'touch') setSubmenuOpen(true);
                                    }}
                                    onClick={() => {
                                        if (!closeOtherDisabled) setSubmenuOpen(open => !open);
                                    }}
                                    onKeyDown={event => {
                                        if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            if (!closeOtherDisabled) openSubmenuFromKeyboard();
                                        } else if (event.key === 'ArrowLeft') {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setSubmenuOpen(false);
                                        }
                                    }}
                                    className={[
                                        'flex w-full items-center justify-between border-none bg-transparent px-3 py-1 text-left',
                                        closeOtherDisabled
                                            ? 'cursor-default text-[#a0a0a0] dark:text-[#666]'
                                            : 'cursor-pointer hover:bg-[#e8e8e8] focus:bg-[#e8e8e8] focus:outline-none dark:hover:bg-[#37373d] dark:focus:bg-[#37373d]',
                                        submenuOpen ? 'bg-[#e8e8e8] dark:bg-[#37373d]' : '',
                                    ].join(' ')}
                                >
                                    <span>{CLOSE_OTHER_LABEL}</span>
                                    <span aria-hidden="true" data-testid="unified-panel-tab-menu-close-other-chevron" className="ml-3 text-[10px] text-[#848484]">▶</span>
                                </button>
                                {submenuOpen && (
                                    <div
                                        ref={submenuRef}
                                        role="menu"
                                        aria-label={CLOSE_OTHER_LABEL}
                                        data-testid="unified-panel-tab-menu-close-other-submenu"
                                        onKeyDown={onSubmenuKeyDown}
                                        style={{
                                            left: submenuPosition?.left ?? 0,
                                            top: submenuPosition?.top ?? 0,
                                            visibility: submenuPosition ? undefined : 'hidden',
                                            ...(submenuPosition?.maxHeight != null
                                                ? { maxHeight: submenuPosition.maxHeight, overflowY: 'auto' as const }
                                                : {}),
                                        }}
                                        className="fixed z-50 min-w-[190px] rounded border border-[#e0e0e0] bg-white py-1 text-xs text-[#1e1e1e] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
                                    >
                                        {closeOtherItems.map(item => <div key={item.action}>{renderItem(item)}</div>)}
                                    </div>
                                )}
                            </>
                        ) : renderItem(row, () => setSubmenuOpen(false))}
                    </div>
                );
            })}
        </div>
    );
}
