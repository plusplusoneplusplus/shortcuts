/**
 * diffDefinitionReturn — the way back from an Explorer file a diff's go to
 * definition opened.
 *
 * The diff and the Explorer tab live in unrelated subtrees (the diff is often
 * the panel's own Git tab, kept alive while hidden), so this is a small
 * cross-tree store keyed by panel scope and Explorer tab id. The Explorer tab
 * shows a "Back to <ref> · <file>" chip and the panel's Back key consults it
 * first; taking it re-selects the tab that hosted the diff and lets the diff
 * restore its file, side, cursor and scroll.
 */

import { useSyncExternalStore } from 'react';
import { focusUnifiedPanelTab } from '../../repo-detail/unified-right-panel/unifiedPanelOpen';

export interface DiffDefinitionReturn {
    /** Chip text after "Back to ", e.g. `abc1234 · parser.ts`. */
    label: string;
    /** Panel tab that was active when the jump started; null when none was. */
    originTabId: string | null;
    /** The chat whose view of the panel holds `originTabId`. */
    chatId: string | null;
    /** Puts the diff back where the jump started; a no-op once it unmounted. */
    restore?: () => void;
}

const entries = new Map<string, DiffDefinitionReturn>();
const listeners = new Set<() => void>();

function key(scopeWorkspaceId: string, tabId: string): string {
    return `${scopeWorkspaceId}\u0000${tabId}`;
}

function notify(): void {
    for (const listener of listeners) listener();
}

/** Remember how to get back from Explorer tab `tabId`; replaces an older entry. */
export function recordDiffDefinitionReturn(scopeWorkspaceId: string, tabId: string, entry: DiffDefinitionReturn): void {
    entries.set(key(scopeWorkspaceId, tabId), entry);
    notify();
}

export function getDiffDefinitionReturn(scopeWorkspaceId: string, tabId: string): DiffDefinitionReturn | null {
    return entries.get(key(scopeWorkspaceId, tabId)) ?? null;
}

/** Forget the way back from `tabId` (the tab closed). */
export function clearDiffDefinitionReturn(scopeWorkspaceId: string, tabId: string): void {
    if (entries.delete(key(scopeWorkspaceId, tabId))) notify();
}

/** Drop every entry (test isolation). */
export function resetDiffDefinitionReturns(): void {
    if (entries.size === 0) return;
    entries.clear();
    notify();
}

/**
 * Go back to the diff that opened Explorer tab `tabId`. Returns false when that
 * tab was not opened by a diff jump, so the caller keeps its own Back.
 */
export function returnToDiffDefinitionOrigin(scopeWorkspaceId: string, tabId: string): boolean {
    const entry = getDiffDefinitionReturn(scopeWorkspaceId, tabId);
    if (!entry) return false;
    clearDiffDefinitionReturn(scopeWorkspaceId, tabId);
    if (entry.originTabId !== null) focusUnifiedPanelTab(scopeWorkspaceId, entry.chatId, entry.originTabId);
    entry.restore?.();
    return true;
}

export function useDiffDefinitionReturn(scopeWorkspaceId: string, tabId: string): DiffDefinitionReturn | null {
    return useSyncExternalStore(
        listener => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        () => getDiffDefinitionReturn(scopeWorkspaceId, tabId),
        () => null,
    );
}
