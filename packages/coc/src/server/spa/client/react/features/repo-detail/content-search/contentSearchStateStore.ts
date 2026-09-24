/**
 * Scope-owned state for the tracked-content overlay.
 *
 * Controls are compact and survive a reload in localStorage. Result payloads
 * stay in this module's memory: they survive closing or leaving and returning
 * to a scope in the same page, but a reload never replays stale matches.
 */
import {
    useCallback,
    useSyncExternalStore,
    type Dispatch,
    type SetStateAction,
} from 'react';
import type {
    ContentSearchOverlayFailure,
    ContentSearchOverlayMatch,
} from './ContentSearchOverlay';
import {
    DEFAULT_CONTENT_SEARCH_CONTROLS,
    type ContentSearchControls,
} from './contentSearchControls';

export type ContentSearchOverlayStatus =
    | 'idle'
    | 'loading'
    | 'success'
    | 'empty'
    | 'error'
    | 'unavailable';

export type ContentSearchOverlayErrorKind = 'regex' | 'glob' | 'request' | 'unavailable';

export interface ContentSearchResultState {
    status: ContentSearchOverlayStatus;
    matches: ContentSearchOverlayMatch[];
    truncated: boolean;
    error: string | null;
    errorKind: ContentSearchOverlayErrorKind | null;
    /** The query the current results came from, not necessarily the typed value. */
    query: string;
    failures: ContentSearchOverlayFailure[];
}

export const EMPTY_CONTENT_SEARCH_RESULTS: ContentSearchResultState = {
    status: 'idle',
    matches: [],
    truncated: false,
    error: null,
    errorKind: null,
    query: '',
    failures: [],
};

/** A scope key includes both page kind and concrete clone owner. */
export function contentSearchScopeKey(options: {
    workspaceId: string;
    scope: 'repo' | 'group';
    routingRef?: string | null;
}): string {
    return JSON.stringify([
        options.scope,
        options.workspaceId,
        options.routingRef ?? null,
    ]);
}

export function contentSearchControlsStorageKey(scopeKey: string): string {
    return `content-search-overlay:${encodeURIComponent(scopeKey)}:controls`;
}

const controlListeners = new Map<string, Set<() => void>>();
const controlSnapshots = new Map<string, { raw: string; value: ContentSearchControls }>();
const controlValues = new Map<string, ContentSearchControls>();
const resultListeners = new Map<string, Set<() => void>>();
const resultStates = new Map<string, ContentSearchResultState>();

function subscribe(
    listeners: Map<string, Set<() => void>>,
    key: string,
    listener: () => void,
): () => void {
    const current = listeners.get(key) ?? new Set<() => void>();
    current.add(listener);
    listeners.set(key, current);
    return () => {
        current.delete(listener);
        if (current.size === 0) {
            listeners.delete(key);
        }
    };
}

function parseControls(raw: string): ContentSearchControls {
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown> | null;
        const modes = parsed?.modes as Record<string, unknown> | null | undefined;
        if (!parsed || typeof parsed !== 'object') {
            return DEFAULT_CONTENT_SEARCH_CONTROLS;
        }
        return {
            query: typeof parsed.query === 'string' ? parsed.query : '',
            modes: {
                caseSensitive: modes?.caseSensitive === true,
                wholeWord: modes?.wholeWord === true,
                regex: modes?.regex === true,
            },
            include: typeof parsed.include === 'string' ? parsed.include : '',
            exclude: typeof parsed.exclude === 'string' ? parsed.exclude : '',
            includeUntracked: parsed.includeUntracked === true,
        };
    } catch {
        return DEFAULT_CONTENT_SEARCH_CONTROLS;
    }
}

function readControls(scopeKey: string): ContentSearchControls {
    const storageKey = contentSearchControlsStorageKey(scopeKey);
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(storageKey);
    } catch {
        // Disabled storage behaves like an empty store.
    }
    if (raw === null) {
        return controlValues.get(scopeKey) ?? DEFAULT_CONTENT_SEARCH_CONTROLS;
    }
    const cached = controlSnapshots.get(storageKey);
    if (cached?.raw === raw) {
        return cached.value;
    }
    const value = parseControls(raw);
    controlValues.set(scopeKey, value);
    controlSnapshots.set(storageKey, { raw, value });
    return value;
}

function writeControls(scopeKey: string, value: ContentSearchControls): void {
    const storageKey = contentSearchControlsStorageKey(scopeKey);
    const raw = JSON.stringify(value);
    try {
        localStorage.setItem(storageKey, raw);
    } catch {
        // Keep the current page functional when storage is unavailable.
    }
    controlValues.set(scopeKey, value);
    controlSnapshots.set(storageKey, { raw, value });
    controlListeners.get(scopeKey)?.forEach(listener => listener());
}

export function useContentSearchControls(
    scopeKey: string,
): [ContentSearchControls, Dispatch<SetStateAction<ContentSearchControls>>] {
    const controls = useSyncExternalStore(
        useCallback(listener => subscribe(controlListeners, scopeKey, listener), [scopeKey]),
        () => readControls(scopeKey),
        () => DEFAULT_CONTENT_SEARCH_CONTROLS,
    );
    const setControls = useCallback<Dispatch<SetStateAction<ContentSearchControls>>>(action => {
        const current = readControls(scopeKey);
        const next = typeof action === 'function'
            ? (action as (value: ContentSearchControls) => ContentSearchControls)(current)
            : action;
        writeControls(scopeKey, next);
    }, [scopeKey]);
    return [controls, setControls];
}

export function useContentSearchResults(
    scopeKey: string,
): [ContentSearchResultState, Dispatch<SetStateAction<ContentSearchResultState>>] {
    const getSnapshot = useCallback(
        () => resultStates.get(scopeKey) ?? EMPTY_CONTENT_SEARCH_RESULTS,
        [scopeKey],
    );
    const results = useSyncExternalStore(
        useCallback(listener => subscribe(resultListeners, scopeKey, listener), [scopeKey]),
        getSnapshot,
        () => EMPTY_CONTENT_SEARCH_RESULTS,
    );
    const setResults = useCallback<Dispatch<SetStateAction<ContentSearchResultState>>>(action => {
        const current = resultStates.get(scopeKey) ?? EMPTY_CONTENT_SEARCH_RESULTS;
        const next = typeof action === 'function'
            ? (action as (value: ContentSearchResultState) => ContentSearchResultState)(current)
            : action;
        if (next === current) {
            return;
        }
        resultStates.set(scopeKey, next);
        resultListeners.get(scopeKey)?.forEach(listener => listener());
    }, [scopeKey]);
    return [results, setResults];
}

/** Simulates a page reload without erasing persisted controls. */
export function resetContentSearchMemoryForTests(): void {
    controlSnapshots.clear();
    controlValues.clear();
    resultStates.clear();
}
