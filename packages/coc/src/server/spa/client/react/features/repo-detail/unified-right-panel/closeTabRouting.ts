/**
 * Who answers Ctrl/Cmd+W (close the active tab) in the unified right panel.
 *
 * Ctrl/Cmd+W is the browser's own close-tab/close-window key, so the panel may
 * only take it while it actually holds the keyboard — and when it does hold the
 * keyboard it must take it *completely*: falling through to the browser because
 * the panel happened to have nothing to close would shut the whole window on a
 * user who was only trying to tidy a tab strip. That is why "focused but
 * nothing to close" is its own outcome rather than "not ours".
 *
 * The one carve-out is the terminal. A plain Ctrl+W in a shell is readline's
 * delete-previous-word, and a user typing into a PTY means that far more often
 * than "close this tab". So while focus is inside the active *terminal* tab's
 * view, a plain Ctrl+W is handed to xterm (which sends `\x17` and preventDefaults
 * it itself, so the browser still never sees it); Cmd/Meta+W closes as usual.
 * The carve-out is keyed on the tab kind and where the focus is, never on
 * platform detection — the accepted consequence is that on Linux/Windows a
 * terminal tab is closed with the ✕ or a middle click rather than the keyboard.
 */

/** Whether this key event is the close-tab shortcut. Mirrors `quickOpenShortcut`. */
export function closeTabShortcut(
    event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'key'>,
): 'close' | null {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
    return event.key.toLowerCase() === 'w' ? 'close' : null;
}

export interface CloseTabOwnerContext {
    /** The right panel is rendered and not collapsed. */
    panelOpen: boolean;
    /** `document.activeElement` is inside the right panel's root. */
    panelHasFocus: boolean;
    /** The active tab is a terminal AND the focus is inside its view. */
    focusInActiveTerminal: boolean;
    /** The event carried Cmd/Meta — the terminal carve-out does not apply. */
    metaKey: boolean;
    /** The focused scope has an active tab to close. */
    hasActiveTab: boolean;
}

/**
 * `'close'` — swallow the event and close the active tab.
 * `'swallow'` — swallow the event and do nothing (nothing to close).
 * `'ignore'` — not ours; leave the event entirely alone.
 */
export type CloseTabOutcome = 'close' | 'swallow' | 'ignore';

/** Pure routing decision — see the module comment for the rule. */
export function closeTabOutcome(context: CloseTabOwnerContext): CloseTabOutcome {
    const { panelOpen, panelHasFocus, focusInActiveTerminal, metaKey, hasActiveTab } = context;
    // A collapsed panel holds no focus worth honouring, and focus elsewhere on
    // the dashboard (or nowhere at all) leaves the browser its shortcut.
    if (!panelOpen || !panelHasFocus) return 'ignore';
    // Plain Ctrl+W typed into a live shell is delete-previous-word.
    if (focusInActiveTerminal && !metaKey) return 'ignore';
    // Focused with an empty strip: still ours, still swallowed.
    if (!hasActiveTab) return 'swallow';
    return 'close';
}
