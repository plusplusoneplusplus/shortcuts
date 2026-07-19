/**
 * explorerStateStore — per-workspace, localStorage-backed persistence for the
 * File Explorer's UI state (expanded tree nodes + selected/open preview file).
 *
 * ExplorerPanel is mounted with `key={ws.id}` at both mount sites (RepoDetail,
 * WorkspaceRightDock), so every workspace switch fully remounts it and wipes all
 * local `useState`. To make the explorer's state survive a switch (and a page
 * reload), the persisted pieces live here instead — keyed per workspace under the
 * existing `split-workspace:<wsId>:*` localStorage convention (see
 * `WorkspaceDockToggle.tsx`).
 *
 * Storage split (matching the feature decision):
 *  - expanded paths + selected/open file → localStorage (this module)
 *  - fetched tree data cache (rootEntries/childrenMap) → in-memory only (elsewhere)
 *
 * Each field is exposed through a `useState`-compatible hook backed by a tiny
 * module-level pub/sub over localStorage, surfaced via `useSyncExternalStore` —
 * the same pattern as `useDockOpen`. This keeps every consumer of the same
 * workspace in sync (both mount sites, if simultaneously mounted) and persists
 * across reloads.
 */

import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';

export interface ExplorerPreviewFile {
    path: string;
    name: string;
}

// ---------------------------------------------------------------------------
// Storage keys (per workspace) — follow the `split-workspace:<wsId>:*` pattern.
// ---------------------------------------------------------------------------

/** localStorage key for the set of expanded tree-node paths, per workspace. */
export function explorerExpandedStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:explorer-expanded`;
}

/** localStorage key for the currently selected tree path, per workspace. */
export function explorerSelectedStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:explorer-selected`;
}

/** localStorage key for the open preview file (path + name), per workspace. */
export function explorerPreviewStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:explorer-preview`;
}

// ---------------------------------------------------------------------------
// Codecs — how each field is serialized to / parsed from a localStorage string.
// `fallback` must be a stable module-level reference: `useSyncExternalStore`
// requires `getSnapshot` to return a referentially-stable value when the
// underlying data is unchanged, or React re-renders in an infinite loop.
// ---------------------------------------------------------------------------

interface Codec<T> {
    /** Stable value returned when the key is absent or unparseable. */
    fallback: T;
    /** Parse a stored string into a value. May throw; callers fall back. */
    parse(raw: string): T;
    /** Serialize a value into a stored string. */
    serialize(value: T): string;
}

const EMPTY_EXPANDED: ReadonlySet<string> = new Set<string>();

const EXPANDED_CODEC: Codec<Set<string>> = {
    fallback: EMPTY_EXPANDED as Set<string>,
    parse(raw) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return EMPTY_EXPANDED as Set<string>;
        return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    },
    serialize(value) {
        return JSON.stringify([...value]);
    },
};

const SELECTED_CODEC: Codec<string | null> = {
    fallback: null,
    parse(raw) {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : null;
    },
    serialize(value) {
        return JSON.stringify(value);
    },
};

const PREVIEW_CODEC: Codec<ExplorerPreviewFile | null> = {
    fallback: null,
    parse(raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.path === 'string' && typeof parsed.name === 'string') {
            return { path: parsed.path, name: parsed.name };
        }
        return null;
    },
    serialize(value) {
        return JSON.stringify(value);
    },
};

// ---------------------------------------------------------------------------
// Module-level pub/sub over localStorage with snapshot caching.
// ---------------------------------------------------------------------------

const listeners = new Map<string, Set<() => void>>();

/** Cache of the last (raw string → parsed value) per key for referential stability. */
const snapshotCache = new Map<string, { raw: string; value: unknown }>();

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

function notify(storageKey: string): void {
    listeners.get(storageKey)?.forEach(listener => listener());
}

function readValue<T>(storageKey: string, codec: Codec<T>): T {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(storageKey);
    } catch {
        raw = null;
    }
    if (raw == null) return codec.fallback;
    const cached = snapshotCache.get(storageKey);
    if (cached && cached.raw === raw) return cached.value as T;
    let value: T;
    try {
        value = codec.parse(raw);
    } catch {
        value = codec.fallback;
    }
    snapshotCache.set(storageKey, { raw, value });
    return value;
}

function writeValue<T>(storageKey: string, codec: Codec<T>, next: T): void {
    const raw = codec.serialize(next);
    try {
        localStorage.setItem(storageKey, raw);
    } catch {
        /* ignore quota / disabled storage */
    }
    // Prime the cache with the exact reference we just wrote so the next
    // getSnapshot returns `next` without a reparse.
    snapshotCache.set(storageKey, { raw, value: next });
    notify(storageKey);
}

/**
 * A `useState`-compatible hook whose value is persisted to localStorage under
 * `storageKey` and shared across every consumer of that key. The setter accepts
 * a value or an updater function, exactly like `useState`.
 */
function usePersistedValue<T>(storageKey: string, codec: Codec<T>): [T, Dispatch<SetStateAction<T>>] {
    const value = useSyncExternalStore(
        useCallback(listener => subscribe(storageKey, listener), [storageKey]),
        () => readValue(storageKey, codec),
        () => codec.fallback,
    );
    const setValue = useCallback<Dispatch<SetStateAction<T>>>(action => {
        const current = readValue(storageKey, codec);
        const next = typeof action === 'function'
            ? (action as (prev: T) => T)(current)
            : action;
        writeValue(storageKey, codec, next);
    }, [storageKey, codec]);
    return [value, setValue];
}

// ---------------------------------------------------------------------------
// Public per-workspace hooks — drop-in replacements for the ExplorerPanel
// `useState` calls they replace (same [value, setValue] tuple shape).
// ---------------------------------------------------------------------------

/** Persisted set of expanded tree-node paths for a workspace. */
export function useExplorerExpandedPaths(workspaceId: string): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
    return usePersistedValue(explorerExpandedStorageKey(workspaceId), EXPANDED_CODEC);
}

/** Persisted selected tree path for a workspace. */
export function useExplorerSelectedPath(workspaceId: string): [string | null, Dispatch<SetStateAction<string | null>>] {
    return usePersistedValue(explorerSelectedStorageKey(workspaceId), SELECTED_CODEC);
}

/** Persisted open preview file for a workspace. */
export function useExplorerPreviewFile(workspaceId: string): [ExplorerPreviewFile | null, Dispatch<SetStateAction<ExplorerPreviewFile | null>>] {
    return usePersistedValue(explorerPreviewStorageKey(workspaceId), PREVIEW_CODEC);
}
