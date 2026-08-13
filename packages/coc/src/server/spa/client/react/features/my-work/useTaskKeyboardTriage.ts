/**
 * useTaskKeyboardTriage — the key dispatcher behind the Today tab.
 *
 * Triage is a repetitive scan-and-decide loop, and that loop should never need
 * the mouse: `j`/`k` move, `x` toggles, `e` edits in place, `d` opens the due
 * picker, `s` defers to tomorrow, `/` jumps to the filter. Every one of these
 * calls the exact handler the corresponding click calls, so this is an
 * accelerator over the existing UI rather than a second way to do things.
 *
 * Scoping rules, in order — a global handler that fires while the user is on
 * Notes or in a dialog is worse than no shortcuts at all:
 *  - never while focus is on a text-entry surface (quick-add, the inline
 *    editor, the filter, the date input) — otherwise typing "extra" toggles and
 *    edits things;
 *  - never while the tab is unmounted or hidden. The Today tab is a keep-alive
 *    pane that stays mounted under `display:none` when another sub-tab is
 *    showing, so `enabled` alone is not enough and `offsetParent === null` is
 *    the check that catches it;
 *  - never from inside a dialog or the conversation detail pane layered over
 *    the tab.
 * The listener is registered once and removed on unmount; every changing input
 * is read through a ref, so nothing here re-registers on a keystroke.
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { isEditableTarget } from '../../hooks/useScopedFindShortcut';

export interface TaskKeyboardTriageOptions {
    /** The tab root; bounds the shortcuts to this pane. */
    containerRef: RefObject<HTMLElement | null>;
    /** False while the tab is not the visible sub-tab. */
    enabled: boolean;
    /** Ids of the rows currently on screen, in visual order — the nav order. */
    order: string[];
    selectedId: string | null;
    /** True while a row's snooze menu is open; that menu owns the keyboard. */
    menuOpen?: boolean;
    onSelect: (id: string | null) => void;
    /** `x` — check/uncheck the selected row. */
    onToggle: (id: string) => void;
    /** `e` — open the selected row's inline editor. */
    onEdit: (id: string) => void;
    /** `d` — open the selected row's due-date menu. */
    onSetDue: (id: string) => void;
    /** `s` — defer the selected row by one day. */
    onSnooze: (id: string) => void;
    /** `/` — focus the filter box. */
    onFocusFilter: () => void;
    /** Escape — close whatever is open, or drop the selection. */
    onEscape: () => void;
}

/** Next id in `order`, wrapping at the ends; first/last when nothing is selected. */
export function stepSelection(order: string[], selectedId: string | null, delta: 1 | -1): string | null {
    if (order.length === 0) return null;
    const index = selectedId === null ? -1 : order.indexOf(selectedId);
    // No selection yet — or the selected row went away under us (ids are
    // content-derived, so any write reflows them). Enter from the near end.
    if (index === -1) return delta === 1 ? order[0] : order[order.length - 1];
    return order[(index + delta + order.length) % order.length];
}

export function useTaskKeyboardTriage(options: TaskKeyboardTriageOptions): void {
    const { containerRef } = options;
    // Every input changes on nearly every render (`order` is a fresh array, the
    // callbacks close over current state). Reading them through one ref keeps
    // the effect's dep list down to the container, so the listener is attached
    // once for the life of the tab instead of being torn down per keystroke.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const o = optionsRef.current;
            if (!o.enabled) return;
            // Chorded keys belong to the app and the browser, not to triage.
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            // Never steal a keystroke from something the user is typing into.
            if (isEditableTarget(e.target)) return;

            const container = containerRef.current;
            // Unmounted, or a hidden keep-alive pane behind another sub-tab.
            if (!container || container.offsetParent === null) return;

            const targetEl = e.target instanceof Element ? e.target : null;
            const insideThis = targetEl ? container.contains(targetEl) : true;
            // Focus sits in a dialog or the detail pane layered over the tab.
            if (!insideThis && targetEl?.closest('[role="dialog"],[data-pane="detail"]')) return;

            // An open snooze menu owns the keyboard: `s` in there should not
            // also snooze the row behind it.
            if (o.menuOpen) {
                if (e.key === 'Escape') { e.preventDefault(); o.onEscape(); }
                return;
            }

            const selected = o.selectedId;
            switch (e.key) {
                case 'j':
                    e.preventDefault();
                    o.onSelect(stepSelection(o.order, selected, 1));
                    return;
                case 'k':
                    e.preventDefault();
                    o.onSelect(stepSelection(o.order, selected, -1));
                    return;
                case '/':
                    e.preventDefault();
                    o.onFocusFilter();
                    return;
                case 'Escape':
                    e.preventDefault();
                    o.onEscape();
                    return;
                default:
                    break;
            }

            // The rest act on a row, so they need one selected.
            if (!selected || !o.order.includes(selected)) return;
            switch (e.key) {
                case 'x': e.preventDefault(); o.onToggle(selected); return;
                case 'e': e.preventDefault(); o.onEdit(selected); return;
                case 'd': e.preventDefault(); o.onSetDue(selected); return;
                case 's': e.preventDefault(); o.onSnooze(selected); return;
                default: return;
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [containerRef]);
}
