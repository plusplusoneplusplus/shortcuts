import { Fragment, useEffect, useRef, useState, useCallback, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../ui/cn';

export interface OverflowMenuItem {
    key: string;
    label: string;
    icon?: ReactNode;
    /** Originating row/control, suitable for restoring focus after an action dialog. */
    onClick: (origin?: HTMLElement) => void;
    /** Rendered as a distinct inline element instead of a menu row */
    render?: () => ReactNode;
    /** Consecutive items with the same group render together; a separator divides groups. */
    group?: string;
    /** Visible heading at the start of a group. */
    groupLabel?: string;
    /** A selectable value; undefined keeps an ordinary action row. */
    checked?: boolean;
    /**
     * Non-actionable secondary information (duration, model/context usage).
     * Collected into a muted footer below the actions instead of a menu row.
     */
    info?: boolean;
    /** Renders the row but blocks activation (e.g. while an action is in flight). */
    disabled?: boolean;
}

interface ChatHeaderOverflowMenuProps {
    items: OverflowMenuItem[];
    /** Optional row whose native context-menu gestures open these same actions. */
    contextTargetRef?: RefObject<HTMLElement | null>;
    ariaLabel?: string;
    /** Workspace ID stamped on the portal div so DOM traversal in file-path-preview.ts can resolve it. */
    wsId?: string;
}

const MENU_ITEM_SELECTOR = ':is([role="menuitem"], [role="menuitemradio"]):not([disabled])';

function focusMenuItem(menu: HTMLElement | null, which: 'first' | 'last' | 'next' | 'prev') {
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let index: number;
    if (which === 'first') index = 0;
    else if (which === 'last') index = items.length - 1;
    else if (which === 'next') index = current < 0 ? 0 : (current + 1) % items.length;
    else index = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    items[index].focus();
}

export function ChatHeaderOverflowMenu({ items, wsId, contextTargetRef, ariaLabel = 'Conversation actions' }: ChatHeaderOverflowMenuProps) {
    const [open, setOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const contextAnchorRef = useRef<{ top: number; bottom: number; right: number } | null>(null);
    const initialFocusRef = useRef<'first' | 'last'>('first');

    const openMenu = useCallback((focus: 'first' | 'last' = 'first') => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        contextAnchorRef.current = null;
        returnFocusRef.current = el;
        initialFocusRef.current = focus;
        setMenuPos({ top: rect.bottom + 4, left: rect.right });
        setOpen(true);
    }, []);

    const closeMenu = useCallback((restoreFocus: boolean) => {
        setOpen(false);
        if (restoreFocus) (returnFocusRef.current ?? triggerRef.current)?.focus();
    }, []);

    useEffect(() => {
        const row = contextTargetRef?.current;
        if (!row || items.length === 0) return;
        const openContext = (event: MouseEvent | KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event instanceof KeyboardEvent && event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
            const target = event.target;
            if (!(target instanceof Element) || target.closest('input, textarea, select, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
            // A selected range anywhere in this row belongs to the native Copy menu.
            const selection = row.ownerDocument.getSelection();
            if (selection && !selection.isCollapsed) {
                for (let i = 0; i < selection.rangeCount; i++) {
                    if (selection.getRangeAt(i).intersectsNode(row)) return;
                }
            }
            event.preventDefault();
            event.stopPropagation();
            const rect = row.getBoundingClientRect();
            const keyboard = event instanceof KeyboardEvent;
            const anchor = keyboard
                ? { top: rect.top, bottom: rect.bottom, right: rect.right }
                : { top: event.clientY, bottom: event.clientY, right: event.clientX };
            contextAnchorRef.current = anchor;
            returnFocusRef.current = keyboard && target instanceof HTMLElement ? target : row;
            initialFocusRef.current = 'first';
            setMenuPos({ top: anchor.bottom + 4, left: anchor.right });
            setOpen(true);
        };
        row.addEventListener('contextmenu', openContext);
        row.addEventListener('keydown', openContext);
        return () => {
            row.removeEventListener('contextmenu', openContext);
            row.removeEventListener('keydown', openContext);
        };
    }, [contextTargetRef, items.length]);

    const handleToggle = useCallback(() => {
        if (open) {
            setOpen(false);
            return;
        }
        openMenu();
    }, [open, openMenu]);

    // Position correction after render: right-align to the trigger, clamp into
    // the viewport, and flip above the trigger when there is no room below.
    useEffect(() => {
        if (!open || !popoverRef.current || !triggerRef.current) return;
        const popover = popoverRef.current;
        const trigger = triggerRef.current;
        const popoverRect = popover.getBoundingClientRect();
        const triggerRect = contextAnchorRef.current ?? trigger.getBoundingClientRect();

        let { top, left } = menuPos;
        left = triggerRect.right - popoverRect.width;
        if (left < 8) left = 8;
        if (left + popoverRect.width > window.innerWidth - 8) {
            left = window.innerWidth - popoverRect.width - 8;
        }
        if (top + popoverRect.height > window.innerHeight - 8) {
            top = triggerRect.top - popoverRect.height - 4;
        }
        top = Math.max(8, Math.min(top, window.innerHeight - popoverRect.height - 8));
        if (top !== menuPos.top || left !== menuPos.left) {
            setMenuPos({ top, left });
        }
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // Move focus into the menu when it opens so arrow keys work immediately.
    useEffect(() => {
        if (open) focusMenuItem(popoverRef.current, initialFocusRef.current);
    }, [open]);

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

    // Close on Escape, returning focus to the trigger when it was inside the menu.
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const focusInside = popoverRef.current?.contains(document.activeElement) ?? false;
            closeMenu(focusInside);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, closeMenu]);

    const handleTriggerKeyDown = useCallback((e: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        if (open) focusMenuItem(popoverRef.current, e.key === 'ArrowDown' ? 'first' : 'last');
        else openMenu(e.key === 'ArrowDown' ? 'first' : 'last');
    }, [open, openMenu]);

    const handleMenuKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        // Embedded controls (References dropdown, context popover) own their keys.
        if (!['menuitem', 'menuitemradio'].includes(target.getAttribute('role') ?? '') && e.key !== 'Tab' && e.key !== 'Escape') return;
        switch (e.key) {
            case 'Escape': e.preventDefault(); e.stopPropagation(); closeMenu(true); break;
            case 'ArrowDown': e.preventDefault(); focusMenuItem(popoverRef.current, 'next'); break;
            case 'ArrowUp': e.preventDefault(); focusMenuItem(popoverRef.current, 'prev'); break;
            case 'Home': e.preventDefault(); focusMenuItem(popoverRef.current, 'first'); break;
            case 'End': e.preventDefault(); focusMenuItem(popoverRef.current, 'last'); break;
            case 'Tab': e.preventDefault(); closeMenu(true); break;
        }
    }, [closeMenu]);

    if (items.length === 0) return null;

    const actions = items.filter(item => !item.info);
    const info = items.filter(item => item.info);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={open ? 'Close overflow menu' : 'More actions'}
                aria-haspopup="menu"
                aria-expanded={open}
                title="More actions"
                data-testid="chat-header-overflow-btn"
                onClick={handleToggle}
                onKeyDown={handleTriggerKeyDown}
                className={cn(
                    'inline-flex items-center justify-center w-[26px] h-[26px] rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/60',
                    open && 'text-[#1e1e1e] dark:text-[#cccccc] bg-[#e8e8e8] dark:bg-[#2d2d2d]',
                )}
            >
                {/*
                  Horizontal three-dot glyph matches the redesign mockup
                  `⋯` overflow trigger; horizontal dots read more naturally
                  as "more actions" than the prior vertical kebab in a row of
                  same-height icon buttons.
                */}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <circle cx="3" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="13" cy="8" r="1.5" fill="currentColor" />
                </svg>
            </button>

            {open && ReactDOM.createPortal(
                <div
                    ref={popoverRef}
                    role="menu"
                    aria-label={ariaLabel}
                    data-testid="chat-header-overflow-menu"
                    {...(wsId ? { 'data-ws-id': wsId } : {})}
                    onKeyDown={handleMenuKeyDown}
                    className={cn(
                        'fixed z-[10003] w-[248px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto rounded-md p-1',
                        'border border-[#e0e0e0] dark:border-[#3c3c3c]',
                        'bg-white dark:bg-[#252526] shadow-lg text-[13px]',
                    )}
                    style={{ top: menuPos.top, left: menuPos.left }}
                >
                    {actions.map((item, index) => {
                        const separator = index > 0 && item.group !== actions[index - 1].group
                            ? <div role="separator" className="my-1 h-px bg-[#e8e8e8] dark:bg-[#3c3c3c]" />
                            : null;
                        if (item.render) {
                            return (
                                <Fragment key={item.key}>
                                    {separator}
                                    <div role="none" className="px-1.5 py-0.5">
                                        {item.render()}
                                    </div>
                                </Fragment>
                            );
                        }
                        return (
                            <Fragment key={item.key}>
                                {separator}
                                {item.groupLabel && (index === 0 || item.group !== actions[index - 1].group) && (
                                    <div role="presentation" className="px-2 py-0.5 text-[11px] font-medium text-[#616161] dark:text-[#9d9d9d]">{item.groupLabel}</div>
                                )}
                                <button
                                    type="button"
                                    role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                                    aria-checked={item.checked}
                                    tabIndex={-1}
                                    disabled={item.disabled}
                                    data-testid={`overflow-item-${item.key}`}
                                    onClick={() => {
                                        item.onClick(returnFocusRef.current ?? triggerRef.current ?? undefined);
                                        setOpen(false);
                                    }}
                                    className={cn(
                                        'group w-full flex items-center gap-2.5 px-2 min-h-[30px] max-sm:min-h-[40px] rounded text-left',
                                        'text-[#1e1e1e] dark:text-[#cccccc]',
                                        'hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]',
                                        'focus:outline-none focus-visible:bg-[#e8e8e8] dark:focus-visible:bg-[#2d2d2d] focus-visible:ring-1 focus-visible:ring-[#0078d4]/60',
                                        'disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent',
                                    )}
                                >
                                    <span
                                        aria-hidden="true"
                                        className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[#6e6e6e] dark:text-[#9d9d9d] group-hover:text-current"
                                    >
                                        {item.checked ? '✓' : item.icon}
                                    </span>
                                    <span className="truncate">{item.label}</span>
                                </button>
                            </Fragment>
                        );
                    })}
                    {info.length > 0 && (
                        <div
                            role="none"
                            data-testid="chat-header-overflow-info"
                            className={cn(
                                'flex flex-col gap-1 px-2 pt-1.5 pb-1 text-[11px] text-[#848484]',
                                actions.length > 0 && 'mt-1 border-t border-[#e8e8e8] dark:border-[#3c3c3c]',
                            )}
                        >
                            {info.map(item => (
                                <div key={item.key} data-testid={`overflow-info-${item.key}`} className="min-w-0">
                                    {item.render ? item.render() : item.label}
                                </div>
                            ))}
                        </div>
                    )}
                </div>,
                document.body,
            )}
        </>
    );
}
