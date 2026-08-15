import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode, RefObject, KeyboardEvent as ReactKeyboardEvent } from 'react';

// ── Shared toolbar chrome ───────────────────────────────────────────────────

/** Vertical rule between toolbar groups. */
export function Sep() {
    return <div className="w-px h-5 mx-1 bg-[#e0e0e0] dark:bg-[#3c3c3c]" />;
}

export interface ToolbarDropdownTriggerArgs {
    open: boolean;
    /** Open the panel when closed, close it when open. */
    toggle: () => void;
    /**
     * Attach to the button that owns the panel. Escape returns focus here, and
     * the primitive does not set `aria-haspopup`/`aria-expanded` for you — the
     * trigger markup differs too much between dropdowns (plain button vs. the
     * highlight split button) for that to live here.
     */
    triggerRef: RefObject<HTMLButtonElement>;
}

export interface ToolbarDropdownProps {
    renderTrigger: (args: ToolbarDropdownTriggerArgs) => ReactNode;
    renderPanel: (args: { close: () => void }) => ReactNode;
    panelTestId: string;
    /** Layout classes for the floating panel; the chrome (border/shadow) is fixed. */
    panelClassName?: string;
    /** Render the panel as an ARIA menu with arrow-key roving focus. */
    menu?: boolean;
    menuLabel?: string;
    /** Runs whenever the panel closes — used to reset transient panel state. */
    onClose?: () => void;
}

const DROPDOWN_PANEL_CLS =
    'absolute top-full left-0 mt-1 z-50 rounded shadow-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]';

/**
 * The one dropdown implementation in this toolbar: it owns open/close state,
 * outside-click and Escape dismissal, and (in `menu` mode) roving arrow-key
 * focus over `role="menuitem"` children. Every toolbar dropdown renders through
 * this so there is a single set of document listeners to reason about.
 */
export function ToolbarDropdown({
    renderTrigger,
    renderPanel,
    panelTestId,
    panelClassName,
    menu,
    menuLabel,
    onClose,
}: ToolbarDropdownProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    // Kept in a ref so `close` stays stable across renders even when callers
    // pass an inline callback.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const close = useCallback(() => {
        setOpen(false);
        onCloseRef.current?.();
    }, []);

    useEffect(() => {
        if (!open) return;
        function handleClick(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
        }
        function handleKey(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            close();
            triggerRef.current?.focus();
        }
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open, close]);

    function menuItems(): HTMLElement[] {
        if (!panelRef.current) return [];
        return Array.from(panelRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    }

    // Opening a menu moves focus into it (starting at the active item) so the
    // arrow keys have somewhere to rove from. Selection survives because the
    // trigger suppressed the mousedown default and the commands re-focus the
    // editor.
    useEffect(() => {
        if (!open || !menu) return;
        const items = menuItems();
        const active = items.find((el) => el.getAttribute('aria-checked') === 'true');
        (active ?? items[0])?.focus();
    }, [open, menu]);

    function handleMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
        const items = menuItems();
        if (items.length === 0) return;
        e.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLElement);
        let next: number;
        if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        else if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
        else next = current <= 0 ? items.length - 1 : current - 1;
        items[next]?.focus();
    }

    return (
        <div className="relative" ref={rootRef}>
            {renderTrigger({
                open,
                toggle: () => (open ? close() : setOpen(true)),
                triggerRef,
            })}
            {open && (
                <div
                    ref={panelRef}
                    className={DROPDOWN_PANEL_CLS + ' ' + (panelClassName ?? 'p-1.5')}
                    data-testid={panelTestId}
                    role={menu ? 'menu' : undefined}
                    aria-label={menu ? menuLabel : undefined}
                    onKeyDown={menu ? handleMenuKeyDown : undefined}
                >
                    {renderPanel({ close })}
                </div>
            )}
        </div>
    );
}

// ── Dropdown menu items ─────────────────────────────────────────────────────

export interface MenuItemProps {
    /** Marks the item as the current block type — also where focus lands on open. */
    checked: boolean;
    onSelect: () => void;
    testId: string;
    /** Extra classes for the label span (heading items mimic their own weight/size). */
    labelClassName?: string;
    /** Leading glyph column; heading items leave it empty. */
    icon?: string;
    children: ReactNode;
}

/**
 * One row of a toolbar dropdown menu.
 *
 * Activation is `onMouseDown` (with `preventDefault`, so the editor selection
 * survives the click) plus Enter/Space on `keydown`. Deliberately no `onClick`:
 * suppressing the mousedown default does not suppress the following click, so
 * an `onClick` here would run the command a second time.
 */
export function MenuItem({ checked, onSelect, testId, labelClassName, icon, children }: MenuItemProps) {
    return (
        <button
            type="button"
            role="menuitem"
            aria-checked={checked}
            tabIndex={-1}
            data-testid={testId}
            className={
                'w-full flex items-center gap-2 px-2 py-1 rounded text-left whitespace-nowrap ' +
                'hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                (checked ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c]' : '')
            }
            onMouseDown={(e) => {
                e.preventDefault(); // keep editor focus
                onSelect();
            }}
            onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onSelect();
            }}
        >
            <span className="w-3 text-[10px] text-[#0078d4] dark:text-[#4daafc]">{checked ? '✓' : ''}</span>
            {icon !== undefined && <span className="w-4 text-center text-xs">{icon}</span>}
            <span className={labelClassName}>{children}</span>
        </button>
    );
}
