/**
 * unifiedPanelOpen — the imperative seam every existing entry point uses to put
 * a resource into the unified right panel (AC-04, AC-06).
 *
 * `useUnifiedPanelTabs` is the right API when the caller renders inside the
 * panel's own subtree. Almost none of AC-04's entry points do: an assistant
 * source link lives deep inside a chat transcript, a canvas event arrives on a
 * websocket with no component at all, an Explorer selection happens in a view
 * that may itself be a panel tab, and a diff action fires from a chat toolbar.
 * They share one thing — they know a workspace, a chat, and a descriptor, and
 * they want it shown. That is this module.
 *
 * Three properties the entry points depend on:
 *
 *  - **It works with no panel mounted.** State goes straight through
 *    `unifiedPanelStore`, so a tab opened while the dock is collapsed — or
 *    before the panel has rendered at all — is there when it appears.
 *  - **Revealing is one-way.** Opening a resource shows the panel if it was
 *    hidden and never hides it. Collapse stays a user gesture.
 *  - **The caller names the owner and the scope.** `ownerWorkspaceId` is the
 *    clone the bytes come from and `chatId` is the *originating* chat, not
 *    whichever chat happens to be selected when an async operation lands. Both
 *    travel in the descriptor, so a late-arriving response files its tab where
 *    it belongs instead of following the user's current selection.
 */

import { openWorkspaceDock } from '../WorkspaceDockToggle';
import { readUnifiedPanelState, writeUnifiedPanelState } from './unifiedPanelStore';
import {
    activateTab,
    openTab,
    unifiedTabId,
    type OpenUnifiedTabInput,
    type UnifiedPanelState,
} from './unifiedPanelTabsModel';

export interface OpenUnifiedPanelTabOptions {
    /**
     * Show the panel when it is collapsed. On by default: an entry point the
     * user just clicked should produce something visible. Pass `false` for a
     * background open — a resource that should be waiting in the strip without
     * taking over the screen.
     */
    reveal?: boolean;
}

/**
 * Open a resource in `workspaceId`'s panel, or focus its existing tab, and
 * reveal the panel. Returns the tab id, which is stable for a given descriptor
 * and is what a caller uses to check its tab later.
 *
 * `workspaceId` is the panel's *scope* — the workspace whose strip the tab
 * appears in. It is not necessarily `input.ownerWorkspaceId`: a repo-group
 * panel is scoped to the group while its tabs are owned by member repos.
 */
export function openUnifiedPanelTab(
    workspaceId: string,
    input: OpenUnifiedTabInput,
    options: OpenUnifiedPanelTabOptions = {},
): string {
    const id = unifiedTabIdFor(input);
    updateUnifiedPanelState(workspaceId, prev => openTab(prev, input));
    if (options.reveal !== false) openWorkspaceDock(workspaceId);
    return id;
}

/**
 * Select an already-open tab as seen from `chatId`, and reveal the panel.
 * A no-op when that chat cannot see the tab, so a stale callback from a
 * background chat can never repoint the visible one.
 *
 * Separate from `openUnifiedPanelTab` because focusing must not resurrect a tab
 * the user closed, nor refresh a descriptor's presentation fields.
 */
export function focusUnifiedPanelTab(
    workspaceId: string,
    chatId: string | null,
    tabId: string,
    options: OpenUnifiedPanelTabOptions = {},
): boolean {
    let changed = false;
    updateUnifiedPanelState(workspaceId, prev => {
        const next = activateTab(prev, chatId, tabId);
        changed = next !== prev;
        return next;
    });
    if (changed && options.reveal !== false) openWorkspaceDock(workspaceId);
    return changed;
}

/** The id `openUnifiedPanelTab` would file this descriptor under. */
export function unifiedTabIdFor(input: OpenUnifiedTabInput): string {
    return unifiedTabId({
        kind: input.kind,
        ownerWorkspaceId: input.ownerWorkspaceId,
        chatId: input.chatId,
        resourceId: input.resourceId,
    });
}

/**
 * Read-modify-write one workspace's layout. Reading at call time rather than
 * closing over a snapshot is what lets two entry points fire in the same tick —
 * a diff action and a canvas event, say — without the second clobbering the
 * first. A model no-op returns the same reference and skips the write entirely.
 */
export function updateUnifiedPanelState(
    workspaceId: string,
    update: (prev: UnifiedPanelState) => UnifiedPanelState,
): void {
    const prev = readUnifiedPanelState(workspaceId);
    const next = update(prev);
    if (next === prev) return;
    writeUnifiedPanelState(workspaceId, next);
}
