/**
 * Who answers Ctrl/Cmd+Shift+F (tracked content search).
 *
 * The overlay is a page-level peer of the Explorer/right-panel Search UI: it
 * has to open from *any* repo or repo-group sub-tab, including while the user
 * is typing in a composer or inside a Monaco buffer. That means one
 * capture-phase listener on `document` that beats Monaco's own Ctrl+Shift+F,
 * and a single pure rule deciding whether the keypress is ours at all.
 *
 * Two carve-outs, both deliberate:
 *
 *  1. A terminal keeps its keyboard. Focus inside a mounted terminal view means
 *     the user is typing at a prompt, so the event falls through untouched and
 *     terminal key handling stays exactly as it was.
 *  2. Unrelated scopes (My Work / My Life, no selection at all) never claim it,
 *     so the browser's own find-in-files-ish shortcut survives where the
 *     feature does not apply.
 *
 * Repeating the shortcut while the overlay is already open focuses and selects
 * the query instead of stacking a second dialog.
 */
import { isRepoGroupWorkspaceId, isVirtualWorkspaceId } from '../../../repos/virtualWorkspaceIds';

/** The scopes the overlay applies to. `null` means "not our scope". */
export type ContentSearchScope = 'repo' | 'group';

/**
 * Map the selected workspace id onto a search scope.
 *
 * Id shape is the whole test — `group-<slug>` is minted by the server and the
 * two client-side virtual scopes are a fixed set — so no registry lookup and no
 * async membership call is needed to decide who owns a keypress.
 */
export function resolveContentSearchScope(
    workspaceId: string | null | undefined,
): ContentSearchScope | null {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) return null;
    if (isRepoGroupWorkspaceId(workspaceId)) return 'group';
    if (isVirtualWorkspaceId(workspaceId)) return null;
    return 'repo';
}

/** Whether this key event is the content-search shortcut. */
export function contentSearchShortcut(
    event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>,
): 'search' | null {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !event.shiftKey) return null;
    return event.key.toLowerCase() === 'f' ? 'search' : null;
}

export interface ContentSearchOwnerContext {
    /** The scope the page is currently showing, from `resolveContentSearchScope`. */
    scope: ContentSearchScope | null;
    /** `document.activeElement` is inside a mounted terminal view. */
    focusInTerminal: boolean;
    /** The overlay is already on screen for this scope. */
    overlayOpen: boolean;
}

/**
 * `'open'`  — swallow the event and open the overlay.
 * `'focus'` — swallow it and re-focus/select the open overlay's query.
 * `'ignore'`— not ours; leave the event entirely alone.
 */
export function contentSearchOwner(
    context: ContentSearchOwnerContext,
): 'open' | 'focus' | 'ignore' {
    const { scope, focusInTerminal, overlayOpen } = context;
    // Unrelated scope: the feature does not exist here, so neither does the
    // shortcut. Checked before the terminal so the answer does not depend on
    // where focus happens to be on a My Work page.
    if (scope === null) return 'ignore';
    // The prompt keeps its keys.
    if (focusInTerminal) return 'ignore';
    // Already open: focus it rather than stacking another dialog.
    return overlayOpen ? 'focus' : 'open';
}
