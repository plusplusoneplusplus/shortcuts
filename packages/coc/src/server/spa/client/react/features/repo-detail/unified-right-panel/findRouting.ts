/**
 * Who answers Ctrl/Cmd+F in the unified right panel.
 *
 * The Explorer navigator owns the shortcut only while it holds the keyboard.
 * Focus in the content column stays with that content: Monaco opens its find
 * widget, diffs open theirs, and terminals may use native find-in-page.
 */

/** Whether this key event is the find shortcut. Mirrors `closeTabShortcut`. */
export function findFilterShortcut(
    event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>,
): 'filter' | null {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
    return event.key.toLowerCase() === 'f' ? 'filter' : null;
}

export interface FindFilterOwnerContext {
    /** The right panel is rendered and not collapsed. */
    panelOpen: boolean;
    /** Explorer is the selected navigator mode AND its column is wide enough to show. */
    explorerNavigatorVisible: boolean;
    /** `document.activeElement` is inside the navigator column, not merely inside the panel. */
    focusInNavigatorColumn: boolean;
    /** The filter input is actually in the DOM to receive focus. */
    filterPresent: boolean;
}

/**
 * `'filter'` — swallow the event and focus the tree filter.
 * `'ignore'` — not ours; leave the event entirely alone.
 *
 * Falling through to native or content-specific find is a valid outcome, so
 * this router has no defensive swallow outcome.
 */
export function findFilterOwner(context: FindFilterOwnerContext): 'filter' | 'ignore' {
    const { panelOpen, explorerNavigatorVisible, focusInNavigatorColumn, filterPresent } = context;
    return panelOpen && explorerNavigatorVisible && focusInNavigatorColumn && filterPresent
        ? 'filter'
        : 'ignore';
}
