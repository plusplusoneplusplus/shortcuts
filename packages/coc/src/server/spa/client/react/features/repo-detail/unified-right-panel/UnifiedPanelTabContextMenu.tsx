import {
    useCallback, useEffect, useLayoutEffect, useRef, useState,
    type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { clampSubmenuVertical } from '../../../tasks/comments/ContextMenu';
import type {
    UnifiedPanelTabMenuAction,
    UnifiedPanelTabMenuItem,
} from './unifiedPanelTabMenuModel';
import { UnifiedPanelGitOpenSubmenu } from './UnifiedPanelGitOpenSubmenu';
import type { UnifiedPanelGitOpenSource } from './panelGitCommit';

const VIEWPORT_MARGIN = 4;
export const CLOSE_OTHER_LABEL = 'Close Other';
const MENU_CLASS = 'fixed z-50 min-w-[190px] rounded border border-[#e0e0e0] bg-white py-1 text-xs text-[#1e1e1e] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]';
const ENABLED_ITEM_CLASS = 'cursor-pointer hover:bg-[#e8e8e8] focus:bg-[#e8e8e8] focus:outline-none dark:hover:bg-[#37373d] dark:focus:bg-[#37373d]';
const DISABLED_ITEM_CLASS = 'cursor-default text-[#a0a0a0] dark:text-[#666]';
const ENABLED_ITEMS = '[role="menuitem"]:not([disabled])';

type SubmenuId = 'close-other' | 'open-git';

type Row =
    | { kind: 'item'; item: UnifiedPanelTabMenuItem }
    | { kind: 'submenu'; id: SubmenuId; label: string; disabled: boolean; group: UnifiedPanelTabMenuItem['group'] };

/**
 * Arrow/Home/End move focus among `focusable`; Enter/Space click the focused
 * one. True when the key was handled.
 */
function handleMenuKey(event: ReactKeyboardEvent, focusable: HTMLButtonElement[]): boolean {
    if (focusable.length === 0) return false;
    const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Enter' || event.key === ' ') {
        if (current < 0) return false;
        event.preventDefault();
        focusable[current].click();
        return true;
    }
    let next: number;
    if (event.key === 'ArrowDown') next = (current + 1 + focusable.length) % focusable.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + focusable.length) % focusable.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = focusable.length - 1;
    else return false;
    event.preventDefault();
    focusable[next].focus();
    return true;
}

interface SubmenuRowProps {
    id: SubmenuId;
    label: string;
    disabled: boolean;
    open: boolean;
    /** Opened from the keyboard: focus moves to the first enabled child. */
    focusOnOpen: boolean;
    onOpenChange: (open: boolean, focusInside?: boolean) => void;
    onFocusHandled: () => void;
    /** Changes when the parent menu moves, so the submenu re-measures. */
    anchorKey: string;
    children: (relayout: () => void) => ReactNode;
}

/**
 * A row that opens a flyout submenu: mouse hover, tap/click, or
 * ArrowRight/Enter/Space; ArrowLeft or Escape closes only the submenu and
 * refocuses the row. The flyout flips left and clamps to the viewport.
 */
function SubmenuRow({
    id, label, disabled, open, focusOnOpen, onOpenChange, onFocusHandled, anchorKey, children,
}: SubmenuRowProps) {
    const rowRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number | null } | null>(null);
    const [layoutNonce, setLayoutNonce] = useState(0);
    const relayout = useCallback(() => setLayoutNonce(n => n + 1), []);

    useLayoutEffect(() => {
        const row = rowRef.current?.getBoundingClientRect();
        const panel = panelRef.current;
        if (!open || !row || !panel) {
            setPlacement(null);
            return;
        }
        const rect = panel.getBoundingClientRect();
        const fitsRight = row.right + rect.width + VIEWPORT_MARGIN <= window.innerWidth;
        const left = fitsRight ? row.right : row.left - rect.width;
        const vertical = clampSubmenuVertical(
            { top: row.top, bottom: row.bottom, height: row.height },
            Math.max(panel.scrollHeight, rect.height),
        );
        setPlacement({
            left: Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
            top: Math.max(VIEWPORT_MARGIN, row.top + vertical.topOffset),
            maxHeight: vertical.maxHeight,
        });
    }, [open, layoutNonce, anchorKey]);

    useLayoutEffect(() => {
        if (!open || !focusOnOpen) return;
        onFocusHandled();
        panelRef.current?.querySelector<HTMLButtonElement>(ENABLED_ITEMS)?.focus();
    }, [open, focusOnOpen, onFocusHandled]);

    const closeAndRefocus = () => {
        onOpenChange(false);
        rowRef.current?.focus();
    };

    return (
        <>
            <button
                ref={rowRef}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={disabled}
                aria-disabled={disabled}
                data-testid={`unified-panel-tab-menu-${id}`}
                onPointerEnter={event => {
                    // Touch opens on tap (click) only, so a tap does not open then toggle shut.
                    if (!disabled && event.pointerType !== 'touch') onOpenChange(true);
                }}
                onClick={() => {
                    if (!disabled) onOpenChange(!open);
                }}
                onKeyDown={event => {
                    if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!disabled) onOpenChange(true, true);
                    } else if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenChange(false);
                    }
                }}
                className={[
                    'flex w-full items-center justify-between border-none bg-transparent px-3 py-1 text-left',
                    disabled ? DISABLED_ITEM_CLASS : ENABLED_ITEM_CLASS,
                    open ? 'bg-[#e8e8e8] dark:bg-[#37373d]' : '',
                ].join(' ')}
            >
                <span>{label}</span>
                <span aria-hidden="true" data-testid={`unified-panel-tab-menu-${id}-chevron`} className="ml-3 text-[10px] text-[#848484]">▶</span>
            </button>
            {open && (
                <div
                    ref={panelRef}
                    role="menu"
                    aria-label={label}
                    data-testid={`unified-panel-tab-menu-${id}-submenu`}
                    onKeyDown={event => {
                        // Handled keys stay in the submenu; Escape closes only the submenu.
                        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            closeAndRefocus();
                            return;
                        }
                        const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>(ENABLED_ITEMS) ?? []);
                        if (handleMenuKey(event, items)) event.stopPropagation();
                    }}
                    style={{
                        left: placement?.left ?? 0,
                        top: placement?.top ?? 0,
                        visibility: placement ? undefined : 'hidden',
                        ...(placement?.maxHeight != null
                            ? { maxHeight: placement.maxHeight, overflowY: 'auto' as const }
                            : {}),
                    }}
                    className={MENU_CLASS}
                >
                    {children(relayout)}
                </div>
            )}
        </>
    );
}

export interface UnifiedPanelTabContextMenuProps {
    x: number;
    y: number;
    items: readonly UnifiedPanelTabMenuItem[];
    onAction: (action: UnifiedPanelTabMenuAction) => void;
    onDismiss: () => void;
    /** Content of a Git tab's Open submenu; required for its `open-git` item. */
    gitOpen?: UnifiedPanelGitOpenSource | null;
}

export function UnifiedPanelTabContextMenu({
    x,
    y,
    items,
    onAction,
    onDismiss,
    gitOpen,
}: UnifiedPanelTabContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x, y });
    const [openSubmenu, setOpenSubmenu] = useState<SubmenuId | null>(null);
    const [focusSubmenu, setFocusSubmenu] = useState(false);
    const clearFocusSubmenu = useCallback(() => setFocusSubmenu(false), []);

    // Bulk closes collapse into one "Close Other" row where the first of them sits.
    const closeOther = items.filter(item => item.group === 'close-other');
    const rows: Row[] = items.flatMap((item): Row[] => {
        if (item.action === 'open-git') {
            return [{ kind: 'submenu', id: 'open-git', label: item.label, disabled: item.disabled || !gitOpen, group: item.group }];
        }
        if (item.group !== 'close-other') return [{ kind: 'item', item }];
        return item === closeOther[0]
            ? [{ kind: 'submenu', id: 'close-other', label: CLOSE_OTHER_LABEL, disabled: closeOther.every(entry => entry.disabled), group: 'close' }]
            : [];
    });

    useLayoutEffect(() => {
        const rect = menuRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPosition({
            x: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
            y: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN)),
        });
    }, [x, y, items]);

    const topLevelItems = () => Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(`:scope > div > ${ENABLED_ITEMS}`) ?? [],
    );

    useEffect(() => {
        // A re-render while the user is inside the menu (or a submenu) keeps their focus.
        if (menuRef.current?.contains(document.activeElement)) return;
        topLevelItems()[0]?.focus();
    }, [items]);

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

    const setSubmenuOpen = (id: SubmenuId) => (open: boolean, focusInside = false) => {
        setOpenSubmenu(current => (open ? id : current === id ? null : current));
        setFocusSubmenu(open && focusInside);
    };

    const renderItem = (item: UnifiedPanelTabMenuItem, onPointerEnter?: () => void) => (
        <button
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
                item.disabled ? DISABLED_ITEM_CLASS : ENABLED_ITEM_CLASS,
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
            onKeyDown={event => { handleMenuKey(event, topLevelItems()); }}
            className={MENU_CLASS}
        >
            {rows.map(row => {
                const group = row.kind === 'item' ? row.item.group : row.group;
                const separator = previousGroup !== null && previousGroup !== group;
                previousGroup = group;
                return (
                    <div key={row.kind === 'item' ? row.item.action : row.id}>
                        {separator && (
                            <div
                                role="separator"
                                className="my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                            />
                        )}
                        {row.kind === 'item' ? renderItem(row.item, () => setOpenSubmenu(null)) : (
                            <SubmenuRow
                                id={row.id}
                                label={row.label}
                                disabled={row.disabled}
                                open={openSubmenu === row.id}
                                focusOnOpen={focusSubmenu}
                                onOpenChange={setSubmenuOpen(row.id)}
                                onFocusHandled={clearFocusSubmenu}
                                anchorKey={`${position.x},${position.y}`}
                            >
                                {relayout => (row.id === 'close-other'
                                    ? closeOther.map(item => <div key={item.action}>{renderItem(item)}</div>)
                                    : gitOpen && (
                                        <UnifiedPanelGitOpenSubmenu source={gitOpen} onDone={onDismiss} onLayoutChange={relayout} />
                                    ))}
                            </SubmenuRow>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
