import { useCallback, useSyncExternalStore } from 'react';

/**
 * Cross-tree collapsed store for the whole left workspace column (CHAT + GIT) in
 * the split-workspace layout. Split into its own tiny module — mirroring how
 * `WorkspaceDockToggle` splits the dock's open flag out of `WorkspaceRightDock` —
 * so the global keydown handler (Router) can toggle the same state as the
 * sidebar's own chevron without pulling in the heavy `SplitWorkspacePanel` graph.
 *
 * The collapsed flag has to be reachable from two separate component subtrees: the
 * `«`/`»` chevron rendered inside the panel AND the Cmd/Ctrl+B handler registered on
 * `document` in Router. A plain `useState` in each would drift, so — exactly like
 * `useDockOpen` — a module-level pub/sub over localStorage (surfaced through
 * `useSyncExternalStore`) keeps every consumer of the same workspace in sync and
 * still persists across reloads. Only an explicit toggle writes (never on mount or
 * a workspace switch), matching the existing `split-workspace:<ws>:*` conventions.
 */

/** Width (px) of the collapsed rail — mirrors the classic chat rail's `w-9`. */
export const LEFT_RAIL_WIDTH = 36;

/** localStorage key for whether the whole left column is collapsed, per workspace. */
export function splitWorkspaceLeftCollapsedStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:left-collapsed`;
}

const leftCollapsedListeners = new Map<string, Set<() => void>>();

export function readLeftCollapsed(storageKey: string): boolean {
    try {
        return localStorage.getItem(storageKey) === '1';
    } catch {
        return false;
    }
}

function writeLeftCollapsed(storageKey: string, collapsed: boolean): void {
    try {
        localStorage.setItem(storageKey, collapsed ? '1' : '0');
    } catch {
        /* ignore */
    }
    leftCollapsedListeners.get(storageKey)?.forEach(listener => listener());
}

/**
 * Flip the persisted collapsed flag and notify every subscriber. A plain function
 * (not a hook) so the global keydown handler can call it from outside React.
 */
export function toggleLeftCollapsed(storageKey: string): void {
    writeLeftCollapsed(storageKey, !readLeftCollapsed(storageKey));
}

function subscribeLeftCollapsed(storageKey: string, listener: () => void): () => void {
    let listeners = leftCollapsedListeners.get(storageKey);
    if (!listeners) {
        listeners = new Set();
        leftCollapsedListeners.set(storageKey, listeners);
    }
    listeners.add(listener);
    return () => {
        listeners!.delete(listener);
        if (listeners!.size === 0) leftCollapsedListeners.delete(storageKey);
    };
}

/** Persisted, cross-tree collapsed flag for the whole left column, scoped by `storageKey`. */
export function useLeftCollapsed(storageKey: string): [boolean, () => void] {
    const collapsed = useSyncExternalStore(
        useCallback(listener => subscribeLeftCollapsed(storageKey, listener), [storageKey]),
        () => readLeftCollapsed(storageKey),
        () => false,
    );
    const toggle = useCallback(() => toggleLeftCollapsed(storageKey), [storageKey]);
    return [collapsed, toggle];
}
