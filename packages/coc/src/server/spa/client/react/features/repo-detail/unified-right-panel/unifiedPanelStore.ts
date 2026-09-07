/**
 * unifiedPanelStore — the persistence and cross-tree plumbing under the unified
 * right panel's tab model.
 *
 * `unifiedPanelTabsModel` owns the rules; this module owns the storage. One
 * localStorage entry per workspace holds the whole `UnifiedPanelState` (every
 * chat's set, the workspace set, and the per-scope selection), served through
 * `useSyncExternalStore` so that every component reading the same workspace —
 * the strip, the panel body, and whatever entry point opens a resource from far
 * outside the panel's subtree — sees one shared value.
 *
 * The cross-tree part is not incidental. Chat source links, canvas events, and
 * the Explorer all open tabs from subtrees that are nowhere near the panel, so
 * the state cannot live in a `useState` inside the panel; it has to be a store
 * they can all write to. This is the same pattern `explorerStateStore` and
 * `useDockOpen` already use.
 *
 * Snapshots are cached by their raw string so `getSnapshot` returns a
 * referentially stable value while the stored text is unchanged — returning a
 * fresh object per call makes `useSyncExternalStore` re-render forever.
 */

import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import {
    EMPTY_UNIFIED_PANEL,
    parseUnifiedPanelState,
    serializeUnifiedPanelState,
    unifiedPanelStorageKey,
    type UnifiedPanelState,
} from './unifiedPanelTabsModel';

const listeners = new Map<string, Set<() => void>>();

/** Last (raw string → parsed state) per key, for referential stability. */
const snapshotCache = new Map<string, { raw: string; value: UnifiedPanelState }>();

function subscribe(storageKey: string, listener: () => void): () => void {
    let set = listeners.get(storageKey);
    if (!set) {
        set = new Set();
        listeners.set(storageKey, set);
    }
    set.add(listener);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(storageKey);
    };
}

/**
 * Read the persisted state for a workspace. Unreadable storage (disabled,
 * quota-blocked, private mode) degrades to the empty panel rather than
 * throwing — the panel is a layout, not data the user would lose.
 */
export function readUnifiedPanelState(workspaceId: string): UnifiedPanelState {
    const storageKey = unifiedPanelStorageKey(workspaceId);
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(storageKey);
    } catch {
        raw = null;
    }
    if (raw == null) return EMPTY_UNIFIED_PANEL;
    const cached = snapshotCache.get(storageKey);
    if (cached && cached.raw === raw) return cached.value;
    const value = parseUnifiedPanelState(raw);
    snapshotCache.set(storageKey, { raw, value });
    return value;
}

/** Persist a workspace's state and wake every subscriber on that key. */
export function writeUnifiedPanelState(workspaceId: string, next: UnifiedPanelState): void {
    const storageKey = unifiedPanelStorageKey(workspaceId);
    const raw = serializeUnifiedPanelState(next);
    try {
        localStorage.setItem(storageKey, raw);
    } catch {
        /* ignore quota / disabled storage */
    }
    // Prime the cache with the exact reference just written, so the next
    // getSnapshot hands back `next` without a reparse — and so a no-op model
    // operation keeps returning the identical reference.
    snapshotCache.set(storageKey, { raw, value: next });
    listeners.get(storageKey)?.forEach(listener => listener());
}

/**
 * The raw `[state, setState]` pair for one workspace's panel layout, shared by
 * every consumer of that workspace. The setter takes a value or an updater,
 * exactly like `useState`; updaters read the freshest persisted value at call
 * time, so two opens fired in the same tick compose instead of clobbering.
 *
 * Most callers want the operation-shaped `useUnifiedPanelTabs` wrapper rather
 * than driving `UnifiedPanelState` by hand.
 */
export function useUnifiedPanelState(
    workspaceId: string,
): [UnifiedPanelState, Dispatch<SetStateAction<UnifiedPanelState>>] {
    const storageKey = unifiedPanelStorageKey(workspaceId);
    const state = useSyncExternalStore(
        useCallback(listener => subscribe(storageKey, listener), [storageKey]),
        useCallback(() => readUnifiedPanelState(workspaceId), [workspaceId]),
        // Server render has no localStorage: start empty and hydrate on mount.
        () => EMPTY_UNIFIED_PANEL,
    );
    const setState = useCallback<Dispatch<SetStateAction<UnifiedPanelState>>>(action => {
        const current = readUnifiedPanelState(workspaceId);
        const next = typeof action === 'function'
            ? (action as (prev: UnifiedPanelState) => UnifiedPanelState)(current)
            : action;
        // The model returns the same reference for a no-op; skip the write and
        // the notify so a redundant open does not re-render every consumer.
        if (next === current) return;
        writeUnifiedPanelState(workspaceId, next);
    }, [workspaceId]);
    return [state, setState];
}

/**
 * Drop a workspace's persisted layout — or every workspace's with no argument
 * (used to isolate tests). Subscribers re-render against the empty panel.
 */
export function clearUnifiedPanelState(workspaceId?: string): void {
    const keys = workspaceId === undefined
        ? [...snapshotCache.keys(), ...listeners.keys()]
        : [unifiedPanelStorageKey(workspaceId)];
    for (const key of new Set(keys)) {
        try {
            localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
        snapshotCache.delete(key);
        listeners.get(key)?.forEach(listener => listener());
    }
}
