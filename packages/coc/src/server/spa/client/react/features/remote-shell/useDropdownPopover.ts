/**
 * useDropdownPopover — shared interaction plumbing for the remote repo-picker
 * dropdowns. Owns the `open` state plus the three behaviors that used to be
 * duplicated (and had drifted) across RemoteScopeCluster and the virtual
 * workspace header:
 *   • outside-click closes the popover
 *   • Escape closes the popover AND refocuses the trigger
 *   • the search input auto-focuses once the popover has rendered
 *
 * The caller owns the popover chrome; it wires `rootRef` to the popover root
 * (for outside-click), `triggerRef` to the button that toggles it (for Escape
 * refocus), and the returned `searchRef` to the search input (for auto-focus).
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

export interface DropdownPopover {
    /** Whether the popover is currently open. */
    open: boolean;
    /** Set the open state directly. */
    setOpen: (open: boolean) => void;
    /** Toggle the open state (for the trigger button). */
    toggle: () => void;
    /** Close the popover. */
    close: () => void;
    /** Ref to attach to the search input so it can auto-focus on open. */
    searchRef: RefObject<HTMLInputElement>;
}

export function useDropdownPopover(
    rootRef: RefObject<HTMLElement>,
    triggerRef: RefObject<HTMLElement>,
): DropdownPopover {
    const [open, setOpen] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, rootRef, triggerRef]);

    // Focus the search field once the popover has rendered.
    useEffect(() => {
        if (!open) return;
        const id = setTimeout(() => searchRef.current?.focus(), 0);
        return () => clearTimeout(id);
    }, [open]);

    return {
        open,
        setOpen,
        toggle: () => setOpen(o => !o),
        close: () => setOpen(false),
        searchRef,
    };
}
