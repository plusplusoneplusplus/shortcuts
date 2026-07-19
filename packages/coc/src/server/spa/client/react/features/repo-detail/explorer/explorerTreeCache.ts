/**
 * explorerTreeCache — in-memory, per-workspace cache of the File Explorer's
 * fetched tree data (root entries + lazily-loaded directory children).
 *
 * ExplorerPanel is remounted with `key={ws.id}` at both mount sites (RepoDetail,
 * WorkspaceRightDock), so every workspace switch fully remounts it and wipes all
 * of its `useState`. Persisting the fetched tree here — module-level, keyed per
 * workspace — lets a switch-back reuse already-loaded directory listings instead
 * of re-fetching them (AC-02 of preserve-explorer-state).
 *
 * Storage split (matching the feature decision):
 *  - expanded paths + selected/open file → localStorage (see explorerStateStore)
 *  - fetched tree data (rootEntries / childrenMap) → in-memory only (this module)
 *
 * Unlike the localStorage-backed UI state, this cache is deliberately in-memory
 * only: a page reload starts empty and re-fetches. `rootLoaded` records whether
 * the root listing has already been fetched this session so the mount effect can
 * skip the root request on a switch-back.
 *
 * Each field is exposed through a `useState`-compatible hook backed by a tiny
 * module-level pub/sub, surfaced via `useSyncExternalStore` — the same shape as
 * explorerStateStore, but with the value living in memory rather than in
 * localStorage. Because the cache object per workspace is a stable reference,
 * `getSnapshot` returns a referentially-stable value when the underlying field is
 * unchanged, which `useSyncExternalStore` requires to avoid infinite re-renders.
 */

import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { TreeEntry } from './types';

/** The mutable, in-memory tree cache for a single workspace. */
interface WorkspaceTreeCache {
    /** Root-level entries as returned by the depth-2 mount fetch. */
    rootEntries: TreeEntry[];
    /** Lazily-loaded children keyed by directory path. */
    childrenMap: Map<string, TreeEntry[]>;
    /** Whether the root listing has been fetched this session. */
    rootLoaded: boolean;
}

type CacheField = keyof WorkspaceTreeCache;

// ---------------------------------------------------------------------------
// Module-level per-workspace cache + pub/sub.
// ---------------------------------------------------------------------------

const caches = new Map<string, WorkspaceTreeCache>();
const listeners = new Map<string, Set<() => void>>();

/** Returns the (stable) cache object for a workspace, creating an empty one lazily. */
function getCache(workspaceId: string): WorkspaceTreeCache {
    let cache = caches.get(workspaceId);
    if (!cache) {
        cache = { rootEntries: [], childrenMap: new Map(), rootLoaded: false };
        caches.set(workspaceId, cache);
    }
    return cache;
}

/** A per-workspace, per-field pub/sub channel key. */
function channelKey(workspaceId: string, field: CacheField): string {
    return `${workspaceId}::${field}`;
}

function subscribe(key: string, listener: () => void): () => void {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(key);
    };
}

function notify(key: string): void {
    listeners.get(key)?.forEach(listener => listener());
}

/**
 * A `useState`-compatible hook whose value is a single field of a workspace's
 * in-memory tree cache, shared across every consumer of that workspace. Because
 * the cache object is stable, `getSnapshot` returns the same reference until a
 * setter replaces the field, satisfying `useSyncExternalStore`'s stability
 * requirement.
 */
function useCacheField<K extends CacheField>(
    workspaceId: string,
    field: K,
): [WorkspaceTreeCache[K], Dispatch<SetStateAction<WorkspaceTreeCache[K]>>] {
    const key = channelKey(workspaceId, field);
    const getSnapshot = useCallback(() => getCache(workspaceId)[field], [workspaceId, field]);
    const value = useSyncExternalStore(
        useCallback(listener => subscribe(key, listener), [key]),
        getSnapshot,
        getSnapshot,
    );
    const setValue = useCallback<Dispatch<SetStateAction<WorkspaceTreeCache[K]>>>(action => {
        const cache = getCache(workspaceId);
        const current = cache[field];
        const next = typeof action === 'function'
            ? (action as (prev: WorkspaceTreeCache[K]) => WorkspaceTreeCache[K])(current)
            : action;
        cache[field] = next;
        notify(key);
    }, [workspaceId, field, key]);
    return [value, setValue];
}

// ---------------------------------------------------------------------------
// Public per-workspace hooks — drop-in replacements for the ExplorerPanel
// `useState` calls they replace (same [value, setValue] tuple shape), but the
// value survives the `key={ws.id}` remount because it lives in this module.
// ---------------------------------------------------------------------------

/** In-memory cached root entries for a workspace. */
export function useExplorerRootEntries(
    workspaceId: string,
): [TreeEntry[], Dispatch<SetStateAction<TreeEntry[]>>] {
    return useCacheField(workspaceId, 'rootEntries');
}

/** In-memory cached directory-children map for a workspace. */
export function useExplorerChildrenMap(
    workspaceId: string,
): [Map<string, TreeEntry[]>, Dispatch<SetStateAction<Map<string, TreeEntry[]>>>] {
    return useCacheField(workspaceId, 'childrenMap');
}

/** Whether the root listing has already been fetched this session for a workspace. */
export function useExplorerRootLoaded(
    workspaceId: string,
): [boolean, Dispatch<SetStateAction<boolean>>] {
    return useCacheField(workspaceId, 'rootLoaded');
}

/**
 * Resets the in-memory tree cache. With a `workspaceId`, resets just that
 * workspace (used by the explorer's Refresh action to force a full re-fetch);
 * with no argument, clears every workspace (used to isolate tests). Subscribers
 * are notified so mounted panels re-render against the emptied cache.
 */
export function clearExplorerTreeCache(workspaceId?: string): void {
    const targets = workspaceId === undefined ? [...caches.keys()] : [workspaceId];
    for (const ws of targets) {
        caches.set(ws, { rootEntries: [], childrenMap: new Map(), rootLoaded: false });
        notify(channelKey(ws, 'rootEntries'));
        notify(channelKey(ws, 'childrenMap'));
        notify(channelKey(ws, 'rootLoaded'));
    }
}
