import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Per-workspace collapsed store for the Notes left sidebar (header + search +
 * meta pills + tree + docked status footer). Mirrors the split-workspace
 * whole-left-column collapse UX — a thin collapsed rail, a hover-peek float-out,
 * and docked-footer width publishing — but uses the lighter
 * `useCollapsedState`-style local store rather than the cross-tree
 * `useSyncExternalStore` pub/sub of `WorkspaceLeftCollapse`.
 *
 * The heavier cross-tree store exists only so a global Cmd/Ctrl+B handler
 * (registered on `document` in a different subtree) can toggle the same flag as
 * the sidebar's own chevron. The Notes sidebar has NO keyboard shortcut, so
 * every consumer — the rail's expand button, the collapse chevron, the
 * hover-peek gate, and the docked-footer width publish — lives inside the single
 * `NotesView` subtree, where a plain `useState` stays in sync without the extra
 * machinery.
 *
 * Collapse persists per workspace so repo / My Life / My Work each remember
 * their own state, following the `coc-notes-*-<workspaceId>` key convention and
 * the `'1'` / `'0'` value encoding used by the split-workspace collapse flags.
 */

/** Width (px) of the collapsed rail — mirrors the classic chat rail's `w-9`. */
export const NOTES_SIDEBAR_RAIL_WIDTH = 36;

/** localStorage key for whether the Notes sidebar is collapsed, per workspace. */
export function notesSidebarCollapsedStorageKey(workspaceId: string): string {
    return `coc-notes-sidebar-collapsed-${workspaceId}`;
}

/** Read the persisted collapsed flag; true only for a stored `'1'`. Never throws. */
export function readNotesSidebarCollapsed(storageKey: string): boolean {
    try {
        return localStorage.getItem(storageKey) === '1';
    } catch {
        return false;
    }
}

/**
 * Persisted, per-workspace collapsed flag for the Notes left sidebar. Only
 * writes on an explicit user toggle (never on mount or on a workspace switch),
 * so a workspace with no collapse history keeps a clean localStorage, and
 * re-syncs from storage when the workspace changes.
 */
export function useNotesSidebarCollapsed(workspaceId: string): [boolean, () => void] {
    const storageKey = notesSidebarCollapsedStorageKey(workspaceId);
    const [collapsed, setCollapsed] = useState(() => readNotesSidebarCollapsed(storageKey));
    // Suppress the persist effect for the initial value and for values loaded on
    // a workspace switch — those are reads, not user intent.
    const skipPersistRef = useRef(true);

    useEffect(() => {
        skipPersistRef.current = true;
        setCollapsed(readNotesSidebarCollapsed(storageKey));
    }, [storageKey]);

    useEffect(() => {
        if (skipPersistRef.current) {
            skipPersistRef.current = false;
            return;
        }
        try {
            localStorage.setItem(storageKey, collapsed ? '1' : '0');
        } catch {
            /* ignore */
        }
    }, [collapsed, storageKey]);

    const toggle = useCallback(() => setCollapsed(prev => !prev), []);
    return [collapsed, toggle];
}
