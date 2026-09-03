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
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';
import {
    DEFAULT_CONTENT_SEARCH_FILTERS,
    DEFAULT_CONTENT_SEARCH_MODES,
    type ContentSearchErrorKind,
    type ContentSearchFilters,
    type ContentSearchModes,
    type ContentSearchStatus,
    type ExplorerView,
} from './types';

export interface ExplorerPreviewFile {
    path: string;
    name: string;
    /**
     * One-based line to reveal when the file opens. Set when the file is opened
     * from a content-search hit; absent for a plain tree click.
     */
    line?: number;
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

/** localStorage key for which sidebar view (tree or search) is showing. */
export function explorerViewStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:explorer-view`;
}

/** localStorage key for the content-search query text, per workspace. */
export function explorerContentQueryStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:explorer-content-query`;
}

/** localStorage key for the content-search mode toggles, per workspace. */
export function explorerContentModesStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:explorer-content-modes`;
}

/** localStorage key for the content-search include/exclude filters, per workspace. */
export function explorerContentFiltersStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:explorer-content-filters`;
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
            return typeof parsed.line === 'number'
                ? { path: parsed.path, name: parsed.name, line: parsed.line }
                : { path: parsed.path, name: parsed.name };
        }
        return null;
    },
    serialize(value) {
        return JSON.stringify(value);
    },
};

const VIEW_CODEC: Codec<ExplorerView> = {
    fallback: 'tree',
    parse(raw) {
        const parsed = JSON.parse(raw);
        return parsed === 'search' ? 'search' : 'tree';
    },
    serialize(value) {
        return JSON.stringify(value);
    },
};

const QUERY_CODEC: Codec<string> = {
    fallback: '',
    parse(raw) {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : '';
    },
    serialize(value) {
        return JSON.stringify(value);
    },
};

const MODES_CODEC: Codec<ContentSearchModes> = {
    fallback: DEFAULT_CONTENT_SEARCH_MODES,
    parse(raw) {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return DEFAULT_CONTENT_SEARCH_MODES;
        return {
            caseSensitive: parsed.caseSensitive === true,
            wholeWord: parsed.wholeWord === true,
            regex: parsed.regex === true,
        };
    },
    serialize(value) {
        return JSON.stringify(value);
    },
};

const FILTERS_CODEC: Codec<ContentSearchFilters> = {
    fallback: DEFAULT_CONTENT_SEARCH_FILTERS,
    parse(raw) {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return DEFAULT_CONTENT_SEARCH_FILTERS;
        return {
            include: typeof parsed.include === 'string' ? parsed.include : '',
            exclude: typeof parsed.exclude === 'string' ? parsed.exclude : '',
            // Absent means the stored value predates the gear; default it on.
            useIgnoreFiles: parsed.useIgnoreFiles !== false,
        };
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


/** Persisted sidebar view (tree or search) for a workspace. */
export function useExplorerView(workspaceId: string): [ExplorerView, Dispatch<SetStateAction<ExplorerView>>] {
    return usePersistedValue(explorerViewStorageKey(workspaceId), VIEW_CODEC);
}

/** Persisted content-search query text for a workspace. */
export function useExplorerContentQuery(workspaceId: string): [string, Dispatch<SetStateAction<string>>] {
    return usePersistedValue(explorerContentQueryStorageKey(workspaceId), QUERY_CODEC);
}

/** Persisted content-search mode toggles for a workspace. */
export function useExplorerContentModes(
    workspaceId: string,
): [ContentSearchModes, Dispatch<SetStateAction<ContentSearchModes>>] {
    return usePersistedValue(explorerContentModesStorageKey(workspaceId), MODES_CODEC);
}

/** Persisted content-search include/exclude/ignore filters for a workspace. */
export function useExplorerContentFilters(
    workspaceId: string,
): [ContentSearchFilters, Dispatch<SetStateAction<ContentSearchFilters>>] {
    return usePersistedValue(explorerContentFiltersStorageKey(workspaceId), FILTERS_CODEC);
}

// ---------------------------------------------------------------------------
// Content-search results — in-memory, per workspace.
//
// The query and the toggles above are persisted because they are small and a
// reload should bring the panel back the way the user left it. The *results*
// deliberately are not: a full 500-match payload has no business in
// localStorage, and a reload should re-run the query against the current
// working tree rather than replay a stale answer. They still live outside React
// state because ExplorerPanel swaps the search view out whenever the user goes
// back to the tree — this is what makes the results survive that round trip
// (and only that: ExplorerPanel is mounted with `key={ws.id}`, so switching
// repos starts from a fresh, empty entry here).
// ---------------------------------------------------------------------------

export interface ContentSearchState {
    status: ContentSearchStatus;
    /** Matches for `query`, sorted by path then line. */
    matches: ExplorerContentMatch[];
    /** True when the server hit one of its caps and the list is partial. */
    truncated: boolean;
    /** Human-readable failure, set only when `status` is 'error'. */
    error: string | null;
    /** Which kind of failure `error` describes, so the UI can place it. */
    errorKind: ContentSearchErrorKind | null;
    /** The query these results answer — may lag the typed query while loading. */
    query: string;
    /**
     * Paths of the result groups the user has collapsed. Lives with the results
     * rather than in localStorage so it survives a switch to the tree view and
     * back, and is wiped whenever a new result set is written — collapsing a
     * file in one search says nothing about the next one.
     */
    collapsed: readonly string[];
}

/** Stable empty collapsed set — a fresh `[]` per render would loop consumers. */
export const NO_COLLAPSED_GROUPS: readonly string[] = [];

/** Stable empty state; also the reference returned before any search has run. */
export const IDLE_CONTENT_SEARCH_STATE: ContentSearchState = {
    status: 'idle',
    matches: [],
    truncated: false,
    error: null,
    errorKind: null,
    query: '',
    collapsed: NO_COLLAPSED_GROUPS,
};

const contentSearchStates = new Map<string, ContentSearchState>();
const contentSearchListeners = new Map<string, Set<() => void>>();

function contentSearchKey(workspaceId: string): string {
    return `content-search::${workspaceId}`;
}

/**
 * Content-search results for a workspace, shared across every mounted consumer.
 * Same `[value, setValue]` shape as the persisted hooks above.
 */
export function useExplorerContentResults(
    workspaceId: string,
): [ContentSearchState, Dispatch<SetStateAction<ContentSearchState>>] {
    const key = contentSearchKey(workspaceId);
    const getSnapshot = useCallback(
        () => contentSearchStates.get(key) ?? IDLE_CONTENT_SEARCH_STATE,
        [key],
    );
    const value = useSyncExternalStore(
        useCallback(listener => {
            let set = contentSearchListeners.get(key);
            if (!set) {
                set = new Set();
                contentSearchListeners.set(key, set);
            }
            set.add(listener);
            return () => {
                set!.delete(listener);
                if (set!.size === 0) contentSearchListeners.delete(key);
            };
        }, [key]),
        getSnapshot,
        getSnapshot,
    );
    const setValue = useCallback<Dispatch<SetStateAction<ContentSearchState>>>(action => {
        const current = contentSearchStates.get(key) ?? IDLE_CONTENT_SEARCH_STATE;
        const next = typeof action === 'function'
            ? (action as (prev: ContentSearchState) => ContentSearchState)(current)
            : action;
        contentSearchStates.set(key, next);
        contentSearchListeners.get(key)?.forEach(listener => listener());
    }, [key]);
    return [value, setValue];
}

/**
 * Drops cached content-search results — for one workspace, or all of them with
 * no argument (used to isolate tests). Subscribers re-render against idle.
 */
export function clearExplorerContentResults(workspaceId?: string): void {
    const keys = workspaceId === undefined
        ? [...contentSearchStates.keys()]
        : [contentSearchKey(workspaceId)];
    for (const key of keys) {
        contentSearchStates.delete(key);
        contentSearchListeners.get(key)?.forEach(listener => listener());
    }
}
