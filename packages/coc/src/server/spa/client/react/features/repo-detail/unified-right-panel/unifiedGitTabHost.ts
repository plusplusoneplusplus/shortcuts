/**
 * unifiedGitTab — the seam between the split workspace's git list and the
 * panel's single Git tab.
 *
 * The git detail is still rendered by `RepoGitTab` (its selection, data, and
 * actions live there), which portals `RepoGitDetailPane` into a DOM node. In the
 * desktop split view that node is the Git tab's body instead of the middle
 * pane, so the chat stays put while a git click fills the right panel.
 *
 * The tab body registers its node here, keyed by the panel scope, and the page
 * that mounts `RepoGitTab` reads it back through `useUnifiedGitTabHost`. The
 * two sit in unrelated subtrees, so this is a tiny cross-tree store rather than
 * React context — the same reason the tab state itself is a store.
 */

import { useSyncExternalStore } from 'react';
import { openUnifiedPanelTab } from './unifiedPanelOpen';
import { useUnifiedPanelState } from './unifiedPanelStore';
import type { PersistedGitView } from '../../git/repoGitTab/types';
import {
    findTab, GIT_TAB_RESOURCE_ID, unifiedTabId, type OpenUnifiedTabInput, type UnifiedPanelTab,
} from './unifiedPanelTabsModel';

/** The strip label of every Git tab. */
export const GIT_TAB_LABEL = 'Git';

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

/** The descriptor of a chat's one Git tab. */
export function unifiedGitTabInput(input: {
    ownerWorkspaceId: string;
    ownerRoutingRef?: string | null;
    /** The chat the panel is showing; the tab belongs to that chat. */
    chatId: string | null;
    /** What the tab now shows, persisted so a reload can restore it. */
    gitView?: PersistedGitView;
    gitMemberId?: string;
}): OpenUnifiedTabInput {
    return {
        kind: 'git',
        ownerWorkspaceId: input.ownerWorkspaceId,
        ...(input.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: input.ownerRoutingRef }),
        chatId: input.chatId,
        resourceId: GIT_TAB_RESOURCE_ID,
        label: GIT_TAB_LABEL,
        ...(input.gitView === undefined ? {} : { gitView: input.gitView }),
        ...(input.gitMemberId === undefined ? {} : { gitMemberId: input.gitMemberId }),
    };
}

/**
 * Open (or focus) the chat's Git tab in `scopeWorkspaceId`'s panel and reveal
 * the panel. Repeated opens reuse the one tab: its id carries no view identity.
 */
export function openUnifiedGitTab(
    scopeWorkspaceId: string,
    input: Parameters<typeof unifiedGitTabInput>[0],
): string {
    return openUnifiedPanelTab(scopeWorkspaceId, unifiedGitTabInput(input));
}

/**
 * The id of a chat's one Git tab. Each chat (or the no-chat draft scope when
 * `chatId` is null) has its own, so a chat switch never shows another chat's
 * git detail.
 */
export function unifiedGitTabId(input: {
    ownerWorkspaceId: string;
    ownerRoutingRef?: string | null;
    chatId: string | null;
}): string {
    return unifiedTabId({
        kind: 'git',
        ownerWorkspaceId: input.ownerWorkspaceId,
        ownerRoutingRef: input.ownerRoutingRef,
        chatId: input.chatId,
        resourceId: GIT_TAB_RESOURCE_ID,
    });
}

/** The chat's Git tab in `scopeWorkspaceId`'s panel, or null when closed. */
export function useUnifiedGitTab(
    scopeWorkspaceId: string,
    input: Parameters<typeof unifiedGitTabId>[0],
): UnifiedPanelTab | null {
    const [state] = useUnifiedPanelState(scopeWorkspaceId);
    return findTab(state, unifiedGitTabId(input));
}

/** Whether `scopeWorkspaceId`'s panel currently holds this workspace's Git tab. */
export function useUnifiedGitTabOpen(
    scopeWorkspaceId: string,
    input: Parameters<typeof unifiedGitTabId>[0],
): boolean {
    return useUnifiedGitTab(scopeWorkspaceId, input) !== null;
}
