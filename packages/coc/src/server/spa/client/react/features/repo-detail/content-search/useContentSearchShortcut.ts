/**
 * Mounts the one capture-phase Ctrl/Cmd+Shift+F listener for a page.
 *
 * Capture phase, on `document`, is what lets the overlay win while focus sits
 * in a Monaco buffer or an ordinary input: both would otherwise consume the
 * keypress first. The decision itself is `contentSearchOwner` in
 * `./contentSearchShortcut` — this hook only supplies the live facts (scope,
 * terminal focus, whether the overlay is already up) and performs the outcome.
 */
import { useEffect } from 'react';
import {
    contentSearchOwner,
    contentSearchShortcut,
    type ContentSearchScope,
} from './contentSearchShortcut';

/**
 * Whether the focused element is inside a terminal.
 *
 * xterm.js parks focus on a helper textarea inside its `.xterm` container, and
 * every terminal surface in the app (the Terminal sub-tab and the right panel's
 * terminal tab) renders through that same component — so one class check covers
 * both hosts without either of them registering anything.
 */
export function focusIsInTerminal(doc: Document = document): boolean {
    const focused = doc.activeElement;
    if (focused === null || focused === doc.body) return false;
    return focused.closest('.xterm') !== null;
}

export interface ContentSearchShortcutOptions {
    /** The page's scope, from `resolveContentSearchScope`. `null` disables the shortcut. */
    scope: ContentSearchScope | null;
    /** The overlay is currently on screen. */
    overlayOpen: boolean;
    /** Open the overlay. The element that invoked it is captured by the caller. */
    onOpen: () => void;
    /** Re-focus and select the already-open overlay's query field. */
    onFocusExisting: () => void;
}

export function useContentSearchShortcut(options: ContentSearchShortcutOptions): void {
    const { scope, overlayOpen, onOpen, onFocusExisting } = options;
    useEffect(() => {
        if (scope === null) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (contentSearchShortcut(event) === null) return;
            const outcome = contentSearchOwner({
                scope,
                focusInTerminal: focusIsInTerminal(),
                overlayOpen,
            });
            if (outcome === 'ignore') return;
            event.preventDefault();
            event.stopPropagation();
            if (outcome === 'open') onOpen();
            else onFocusExisting();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [scope, overlayOpen, onOpen, onFocusExisting]);
}
