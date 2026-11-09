/**
 * unifiedGitTabHost — the seam between the split workspace's git list and the
 * panel's `coc://git` page tab.
 *
 * The git detail is still rendered by `RepoGitTab` (its selection, data, and
 * actions live there), which portals `RepoGitDetailPane` into a DOM node. In the
 * desktop split view that node is the Git page tab's body instead of the middle
 * pane, so the chat stays put while a git click fills the right panel.
 *
 * The tab body registers its node here, keyed by the panel scope, and the page
 * that mounts `RepoGitTab` reads it back through `useUnifiedGitTabHost`. The
 * two sit in unrelated subtrees, so this is a tiny cross-tree store rather than
 * React context — the same reason the tab state itself is a store. The tab's
 * own *identity and address* are workspace-scoped `coc://git` page concerns
 * (`useSplitGitPanel`, `unifiedPanelWorkspaceResources.ts`); only this DOM-host
 * and dirty-bridge seam lives here.
 */

import { useSyncExternalStore } from 'react';

const hosts = new Map<string, HTMLElement>();
const listeners = new Map<string, Set<() => void>>();

function notify(scopeWorkspaceId: string): void {
    for (const listener of listeners.get(scopeWorkspaceId) ?? []) listener();
}

/** Publish the Git tab body for a panel scope. */
export function setUnifiedGitTabHost(scopeWorkspaceId: string, node: HTMLElement): void {
    if (hosts.get(scopeWorkspaceId) === node) return;
    hosts.set(scopeWorkspaceId, node);
    notify(scopeWorkspaceId);
}

/**
 * Withdraw `node` as a panel scope's Git tab body. A no-op when a newer mount
 * already replaced it, so a late unmount cannot erase the live node.
 */
export function clearUnifiedGitTabHost(scopeWorkspaceId: string, node: HTMLElement): void {
    if (hosts.get(scopeWorkspaceId) !== node) return;
    hosts.delete(scopeWorkspaceId);
    notify(scopeWorkspaceId);
}

/** The current Git tab body for a panel scope, if one is mounted. */
export function getUnifiedGitTabHost(scopeWorkspaceId: string): HTMLElement | null {
    return hosts.get(scopeWorkspaceId) ?? null;
}

/** Subscribe to a panel scope's Git tab body. Null while no Git tab is mounted. */
export function useUnifiedGitTabHost(scopeWorkspaceId: string): HTMLElement | null {
    return useSyncExternalStore(
        listener => {
            let set = listeners.get(scopeWorkspaceId);
            if (!set) {
                set = new Set();
                listeners.set(scopeWorkspaceId, set);
            }
            set.add(listener);
            return () => {
                set!.delete(listener);
                if (set!.size === 0) listeners.delete(scopeWorkspaceId);
            };
        },
        () => getUnifiedGitTabHost(scopeWorkspaceId),
        () => null,
    );
}

/**
 * The Git tab's unsaved-edits seam: the tab body publishes the panel's
 * `onDirtyChange` / `onRegisterSave` (bound to its tab id) here, and the
 * detail portaled into it reports through them, so closing the tab while an
 * edited working-tree diff is dirty asks Save / Don't Save / Cancel.
 */
export interface UnifiedGitTabDirtyBridge {
    onDirtyChange: (isDirty: boolean) => void;
    onRegisterSave: (save: (() => Promise<boolean>) | null) => void;
}

const dirtyBridges = new Map<string, UnifiedGitTabDirtyBridge>();

/** Publish the Git tab's dirty bridge for a panel scope. */
export function setUnifiedGitTabDirtyBridge(scopeWorkspaceId: string, bridge: UnifiedGitTabDirtyBridge): void {
    dirtyBridges.set(scopeWorkspaceId, bridge);
}

/** Withdraw `bridge`; a no-op when a newer mount already replaced it. */
export function clearUnifiedGitTabDirtyBridge(scopeWorkspaceId: string, bridge: UnifiedGitTabDirtyBridge): void {
    if (dirtyBridges.get(scopeWorkspaceId) === bridge) dirtyBridges.delete(scopeWorkspaceId);
}

/** The current Git tab dirty bridge for a panel scope, if a Git tab is mounted. */
export function getUnifiedGitTabDirtyBridge(scopeWorkspaceId: string): UnifiedGitTabDirtyBridge | null {
    return dirtyBridges.get(scopeWorkspaceId) ?? null;
}
