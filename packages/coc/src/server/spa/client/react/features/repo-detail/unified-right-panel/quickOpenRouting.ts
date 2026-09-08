/**
 * Who answers Ctrl/Cmd+P (Quick Open) and Ctrl/Cmd+O (Exact Open).
 *
 * Two surfaces can host a file picker at the same time: the Explorer sub-tab in
 * the main area, and the unified right panel. Both used to listen on `document`,
 * so with both mounted one keypress opened two dialogs — and once the Explorer
 * became a *column* of the panel rather than a tab, collapsing that column left
 * no listener at all. Routing is therefore decided in one place, from four
 * facts, and exactly one owner acts on a keypress.
 *
 * The rule, in order:
 *
 *  1. Focus inside the right panel → the panel. It is the surface the user is
 *     typing in, whether or not its file-tree column is open.
 *  2. Focus inside a mounted Explorer tab → the Explorer tab.
 *  3. Focus anywhere else (the chat composer, `document.body`, nothing) → the
 *     Explorer tab when it is mounted, otherwise the panel. That keeps today's
 *     behaviour for a user who has no right panel open.
 *
 * `null` means nobody owns it and the browser keeps its own shortcut.
 */
export type QuickOpenOwner = 'panel' | 'explorer';

export interface QuickOpenOwnerContext {
    /** The right panel is rendered and not collapsed. */
    panelOpen: boolean;
    /** `document.activeElement` is inside the right panel's root. */
    panelHasFocus: boolean;
    /** An Explorer sub-tab (`mode: 'editor'`) is mounted somewhere. */
    explorerMounted: boolean;
    /** `document.activeElement` is inside that Explorer tab's root. */
    explorerHasFocus: boolean;
}

/** Pure routing decision — see the module comment for the ordered rule. */
export function quickOpenOwner(context: QuickOpenOwnerContext): QuickOpenOwner | null {
    const { panelOpen, panelHasFocus, explorerMounted, explorerHasFocus } = context;
    // 1. The panel has the keyboard. A collapsed panel cannot, so `panelOpen`
    //    is checked too rather than trusting containment alone.
    if (panelOpen && panelHasFocus) return 'panel';
    // 2. The Explorer tab has the keyboard.
    if (explorerMounted && explorerHasFocus) return 'explorer';
    // 3. Focus is somewhere else entirely: the Explorer tab first, because that
    //    is where Ctrl+P went before the panel existed.
    if (explorerMounted) return 'explorer';
    if (panelOpen) return 'panel';
    return null;
}

/** The keys this router claims, or `null` for anything else. */
export function quickOpenShortcut(
    event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'key'>,
): 'quick' | 'exact' | null {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
    const key = event.key.toLowerCase();
    if (key === 'p') return 'quick';
    if (key === 'o') return 'exact';
    return null;
}

// ---------------------------------------------------------------------------
// The Explorer-tab registry
// ---------------------------------------------------------------------------
//
// The panel has to know whether an Explorer sub-tab is mounted, and whether it
// holds the focus, before it can decide anything — and the two live in
// different React subtrees with no shared provider. A module-level registry of
// "am I focused?" probes is the smallest thing that answers both: presence is
// `explorerMounted`, calling the probes is `explorerHasFocus`.

type FocusProbe = () => boolean;

const explorerProbes = new Set<FocusProbe>();

/**
 * Register an Explorer sub-tab. Only `mode: 'editor'` mounts do this: a
 * navigator/sidebar Explorer is somebody else's column and never owns Ctrl+P.
 * Returns the unregister function for the effect's cleanup.
 */
export function registerExplorerQuickOpen(hasFocus: FocusProbe): () => void {
    explorerProbes.add(hasFocus);
    return () => { explorerProbes.delete(hasFocus); };
}

/** Whether any Explorer sub-tab is mounted right now. */
export function isExplorerQuickOpenMounted(): boolean {
    return explorerProbes.size > 0;
}

/** Whether a mounted Explorer sub-tab currently contains the focus. */
export function explorerQuickOpenHasFocus(): boolean {
    for (const probe of explorerProbes) {
        if (probe()) return true;
    }
    return false;
}

/** Test seam: drop every registration. */
export function clearExplorerQuickOpenRegistry(): void {
    explorerProbes.clear();
}
