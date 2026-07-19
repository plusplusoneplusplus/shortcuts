/**
 * explorerDirtyStore — per-workspace "has unsaved editor edits" signal for the
 * File Explorer, plus the guard that prompts before a workspace switch discards
 * them (AC-03 of preserve-explorer-state).
 *
 * The problem: ExplorerPanel (and its Monaco-backed PreviewPane) is remounted
 * with `key={ws.id}` on every workspace switch, and the switch itself is
 * dispatched from outside the explorer (the workspace tab strip → the nav hooks
 * `useWorkspaceNavigation` / `useShellNavigation`). To warn the user before their
 * dirty buffer is thrown away, the switch handler must be able to read, at switch
 * time, whether the workspace it is leaving has an unsaved explorer edit. A
 * component's local `useState` cannot answer that — so PreviewPane reports its
 * dirtiness into this tiny module-level store, and the nav hooks read it
 * synchronously.
 *
 * Multiple ExplorerPanel instances can be mounted for the same workspace at once
 * (the RepoDetail explorer sub-tab AND the WorkspaceRightDock), so dirtiness is
 * tracked as a *set of instance ids* per workspace rather than a single boolean:
 * a workspace is dirty while any of its editor instances is dirty, and one
 * instance reporting clean never clobbers another that is still dirty.
 *
 * This is in-memory only and intentionally leaf-level (React + `window` only, no
 * explorer/Monaco imports) so the nav hooks can import it without dragging the
 * heavy editor graph into every consumer of the tab strip.
 */

import { useCallback, useSyncExternalStore } from 'react';

/** Prompt shown when a workspace switch would discard unsaved explorer edits. */
export const EXPLORER_UNSAVED_SWITCH_MESSAGE =
    'You have unsaved changes in the file editor. Discard them and switch workspaces?';

// ---------------------------------------------------------------------------
// Module-level per-workspace dirty registry + pub/sub.
// ---------------------------------------------------------------------------

/** workspaceId → set of dirty editor-instance ids. Absent/empty means clean. */
const dirtyInstances = new Map<string, Set<string>>();
const listeners = new Map<string, Set<() => void>>();

function subscribe(workspaceId: string, listener: () => void): () => void {
    let set = listeners.get(workspaceId);
    if (!set) {
        set = new Set();
        listeners.set(workspaceId, set);
    }
    set.add(listener);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(workspaceId);
    };
}

function notify(workspaceId: string): void {
    listeners.get(workspaceId)?.forEach(listener => listener());
}

/**
 * Record whether a single editor instance (identified by a stable per-mount id)
 * currently holds unsaved edits for a workspace. Subscribers are notified only
 * when the workspace's overall dirty state actually flips.
 */
export function setExplorerInstanceDirty(workspaceId: string, instanceId: string, isDirty: boolean): void {
    let set = dirtyInstances.get(workspaceId);
    const had = set?.has(instanceId) ?? false;
    if (isDirty === had) return;
    const wasDirty = (set?.size ?? 0) > 0;
    if (isDirty) {
        if (!set) {
            set = new Set();
            dirtyInstances.set(workspaceId, set);
        }
        set.add(instanceId);
    } else {
        set!.delete(instanceId);
        if (set!.size === 0) dirtyInstances.delete(workspaceId);
    }
    const nowDirty = (dirtyInstances.get(workspaceId)?.size ?? 0) > 0;
    if (nowDirty !== wasDirty) notify(workspaceId);
}

/** Whether any editor instance for a workspace currently has unsaved edits. */
export function isExplorerDirty(workspaceId: string | null | undefined): boolean {
    if (!workspaceId) return false;
    return (dirtyInstances.get(workspaceId)?.size ?? 0) > 0;
}

/**
 * Drop all dirty tracking for a workspace (or every workspace when omitted).
 * Used after a confirmed discard and to isolate tests. Subscribers are notified.
 */
export function clearExplorerDirty(workspaceId?: string): void {
    if (workspaceId === undefined) {
        const keys = [...dirtyInstances.keys()];
        dirtyInstances.clear();
        keys.forEach(notify);
        return;
    }
    if (dirtyInstances.delete(workspaceId)) notify(workspaceId);
}

/** Reactive read of a workspace's dirty flag, for UI that wants to show it. */
export function useIsExplorerDirty(workspaceId: string): boolean {
    return useSyncExternalStore(
        useCallback(listener => subscribe(workspaceId, listener), [workspaceId]),
        () => isExplorerDirty(workspaceId),
        () => false,
    );
}

// ---------------------------------------------------------------------------
// The workspace-switch guard.
// ---------------------------------------------------------------------------

/**
 * Gate a workspace switch on unsaved explorer edits (AC-03).
 *
 * When switching away from `fromWorkspaceId` to a *different* `toWorkspaceId`,
 * and the workspace being left has a dirty editor buffer, prompt the user
 * (`window.confirm`, matching the SPA's existing dirty-navigation guards in
 * WorkItemDetail / MarkdownReviewEditor). Returns `true` if the switch may
 * proceed — either nothing was dirty, or the user confirmed the discard — in
 * which case the workspace's dirty flag is cleared. Returns `false` to cancel the
 * switch (the user chose to stay), leaving the dirty buffer intact.
 */
export function confirmDiscardExplorerEditsOnSwitch(
    fromWorkspaceId: string | null | undefined,
    toWorkspaceId: string,
): boolean {
    if (!fromWorkspaceId || fromWorkspaceId === toWorkspaceId) return true;
    if (!isExplorerDirty(fromWorkspaceId)) return true;
    const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(EXPLORER_UNSAVED_SWITCH_MESSAGE)
        : true;
    if (confirmed) clearExplorerDirty(fromWorkspaceId);
    return confirmed;
}
