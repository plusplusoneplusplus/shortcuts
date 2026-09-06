/**
 * unifiedDirtyClose — the unsaved-edits half of AC-05's close guard.
 *
 * The terminal guard (`unifiedTerminalClose`) asks before ending a process;
 * this one asks before throwing away a buffer. Both hang off the same
 * `requestClose` seam in `UnifiedRightPanel`, so every close path — the strip's
 * ✕ and a view's own close button — inherits them.
 *
 * Two things this module decides, and one it deliberately does not:
 *
 *  - **Which tabs can lose work.** Only kinds that report dirtiness AND can
 *    write it back qualify. A read-only tab (a chat source link) can never be
 *    dirty, and a diff, a terminal, and the two navigators hold nothing to
 *    save, so none of them ever raises the prompt.
 *  - **What the prompt names.** One readable path per tab, with the trusted
 *    absolute-path prefix stripped and the owning repo prepended when the tab
 *    carries one, so a repo-group member's file is tellable from its namesake.
 *  - It does NOT decide what "Save" does. The buffer registers its own save
 *    function with the panel (`PreviewPane`'s `onRegisterSave`), and a write
 *    that fails leaves the tab open and dirty — the panel owns that outcome,
 *    exactly as `ExplorerPanel` does for the flag-off editor tabs.
 */

import { TRUSTED_PATH_PREFIX } from '../explorer/ExactOpen';
import type { UnifiedPanelTab, UnifiedTabKind } from './unifiedPanelTabsModel';

/**
 * Kinds whose close can discard unsaved work.
 *
 * Only `file` today: it is the one kind that both reports dirtiness
 * (`PreviewPane`'s `onDirtyChange`) and hands the panel a way to write it back
 * (`onRegisterSave`). Notes and canvases autosave through their own sessions
 * and report neither, so listing them here would offer a Save button with
 * nothing behind it. They join this set when they gain those two seams.
 */
export const DIRTY_CLOSE_KINDS: ReadonlySet<UnifiedTabKind> = new Set<UnifiedTabKind>(['file']);

/**
 * Whether closing `tab` right now would discard unsaved edits, and therefore
 * has to ask first. A missing tab, a clean one, and a read-only one all close
 * straight through.
 */
export function needsDirtyCloseConfirm(
    tab: Pick<UnifiedPanelTab, 'kind' | 'readOnly'> | undefined | null,
    isDirty: boolean,
): boolean {
    if (!tab || !isDirty) return false;
    if (tab.readOnly === true) return false;
    return DIRTY_CLOSE_KINDS.has(tab.kind);
}

/**
 * What the prompt calls this tab: the resource path without the internal
 * trusted-path marker, prefixed with the owning repo when the tab is attributed
 * to one. Falls back to the label for a descriptor with no usable path.
 */
export function dirtyCloseLabel(tab: Pick<UnifiedPanelTab, 'resourceId' | 'label' | 'repoLabel'>): string {
    const raw = tab.resourceId.startsWith(TRUSTED_PATH_PREFIX)
        ? tab.resourceId.slice(TRUSTED_PATH_PREFIX.length)
        : tab.resourceId;
    const path = raw.trim() === '' ? tab.label : raw;
    return tab.repoLabel ? `${tab.repoLabel}: ${path}` : path;
}

/** The error the prompt shows when the write fails and the tab stays open. */
export const DIRTY_CLOSE_SAVE_FAILED =
    'Failed to save the file. It is still open with unsaved changes.';
