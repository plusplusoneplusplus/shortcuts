import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction,
    type UIEventHandler,
} from 'react';

const DEFAULT_ROOT_ID = 'default';

/**
 * Scroll scope for the stacked sidebar. Every root shares one scroll container
 * there, so its position belongs to the whole column rather than to whichever
 * section was touched last.
 */
export const NOTES_STACKED_SCROLL_ROOT_ID = '__all__';

export function notesTreeExpandedStorageKey(workspaceId: string, rootId: string): string {
    return `coc-notes-expanded-${workspaceId}-${rootId}`;
}

export function notesTreeScrollStorageKey(workspaceId: string, rootId: string): string {
    return `coc-notes-scroll-${workspaceId}-${rootId}`;
}

export function notesSectionExpandedStorageKey(workspaceId: string, rootId: string): string {
    return `coc-notes-section-expanded-${workspaceId}-${rootId}`;
}

/** Persisted section open/closed flag; `null` when nothing was stored yet. */
export function readSectionExpanded(storageKey: string): boolean | null {
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        return null;
    } catch {
        return null;
    }
}

export function readExpandedPaths(storageKey: string): Set<string> {
    try {
        const raw = localStorage.getItem(storageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) {
            return new Set();
        }
        return new Set(parsed.filter((path): path is string => typeof path === 'string'));
    } catch {
        return new Set();
    }
}

export function readNotesTreeScroll(storageKey: string): number {
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw === null) {
            return 0;
        }
        const value = Number(raw);
        return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    } catch {
        return 0;
    }
}

function writeExpandedPaths(storageKey: string, expanded: Set<string>): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch {
        /* ignore */
    }
}

function writeNotesTreeScroll(storageKey: string, scrollTop: number): void {
    try {
        localStorage.setItem(storageKey, String(Math.max(0, Math.floor(scrollTop))));
    } catch {
        /* ignore */
    }
}

/**
 * Persisted expanded-folder state scoped to one workspace and Notes root.
 * Storage reads on mount and scope changes never count as user changes.
 */
export function useNotesTreeExpansion(
    workspaceId: string,
    selectedRootId: string | undefined,
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
    const storageKey = notesTreeExpandedStorageKey(workspaceId, selectedRootId ?? DEFAULT_ROOT_ID);
    const [state, setState] = useState(() => ({
        storageKey,
        expanded: readExpandedPaths(storageKey),
        shouldPersist: false,
    }));

    useEffect(() => {
        setState(prev => prev.storageKey === storageKey
            ? prev
            : {
                storageKey,
                expanded: readExpandedPaths(storageKey),
                shouldPersist: false,
            });
    }, [storageKey]);

    useEffect(() => {
        if (state.storageKey === storageKey && state.shouldPersist) {
            writeExpandedPaths(storageKey, state.expanded);
        }
    }, [state, storageKey]);

    const setExpanded = useCallback<Dispatch<SetStateAction<Set<string>>>>((action) => {
        setState(prev => {
            const current = prev.storageKey === storageKey
                ? prev.expanded
                : readExpandedPaths(storageKey);
            const expanded = typeof action === 'function' ? action(current) : action;
            return { storageKey, expanded, shouldPersist: true };
        });
    }, [storageKey]);

    return [
        state.storageKey === storageKey ? state.expanded : readExpandedPaths(storageKey),
        setExpanded,
    ];
}

export interface UseNotesTreesExpansionResult {
    /** Expanded folders for every listed root, keyed by root ID. */
    expandedByRoot: Record<string, Set<string>>;
    /** Expanded folders for one root (falls back to storage for unlisted roots). */
    getExpanded: (rootId: string) => Set<string>;
    /** Update one root's expanded folders; persists under that root's own key. */
    setExpanded: (rootId: string, action: SetStateAction<Set<string>>) => void;
    /** Flip one folder open/closed inside one root. */
    toggleExpanded: (rootId: string, path: string) => void;
}

/**
 * Expanded-folder state for several roots at once — the stacked-sections
 * counterpart of `useNotesTreeExpansion`, which only covers a single root and
 * cannot be called once per root in a loop.
 *
 * Storage keys are identical to the single-root hook's, so a root's folders
 * stay expanded across the switch to stacked sections. Entries are read from
 * storage on first sight and written back only after a user change.
 */
export function useNotesTreesExpansion(
    workspaceId: string,
    rootIds: string[],
): UseNotesTreesExpansionResult {
    const rootsKey = rootIds.join('\0');
    const [state, setState] = useState<{ scopeKey: string; entries: Record<string, Set<string>> }>(
        () => ({ scopeKey: workspaceId, entries: {} }),
    );
    /** Roots changed by the user since the last persist pass. */
    const dirtyRef = useRef<Set<string>>(new Set());

    const expandedByRoot = useMemo(() => {
        const stored = state.scopeKey === workspaceId ? state.entries : {};
        const next: Record<string, Set<string>> = { ...stored };
        for (const rootId of rootsKey ? rootsKey.split('\0') : []) {
            if (!(rootId in next)) {
                next[rootId] = readExpandedPaths(notesTreeExpandedStorageKey(workspaceId, rootId));
            }
        }
        return next;
    }, [rootsKey, state, workspaceId]);

    // Drop cached entries when the workspace changes so another workspace's
    // folders never leak into this one.
    useEffect(() => {
        dirtyRef.current.clear();
        setState(prev => (prev.scopeKey === workspaceId ? prev : { scopeKey: workspaceId, entries: {} }));
    }, [workspaceId]);

    useEffect(() => {
        if (dirtyRef.current.size === 0) return;
        if (state.scopeKey !== workspaceId) return;
        for (const rootId of dirtyRef.current) {
            const expanded = state.entries[rootId];
            if (expanded) {
                writeExpandedPaths(notesTreeExpandedStorageKey(workspaceId, rootId), expanded);
            }
        }
        dirtyRef.current.clear();
    }, [state, workspaceId]);

    const setExpanded = useCallback((rootId: string, action: SetStateAction<Set<string>>) => {
        dirtyRef.current.add(rootId);
        setState(prev => {
            const prevEntries = prev.scopeKey === workspaceId ? prev.entries : {};
            const current = prevEntries[rootId]
                ?? readExpandedPaths(notesTreeExpandedStorageKey(workspaceId, rootId));
            const expanded = typeof action === 'function' ? action(current) : action;
            return { scopeKey: workspaceId, entries: { ...prevEntries, [rootId]: expanded } };
        });
    }, [workspaceId]);

    const getExpanded = useCallback(
        (rootId: string) => expandedByRoot[rootId]
            ?? readExpandedPaths(notesTreeExpandedStorageKey(workspaceId, rootId)),
        [expandedByRoot, workspaceId],
    );

    const toggleExpanded = useCallback((rootId: string, path: string) => {
        setExpanded(rootId, prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, [setExpanded]);

    return { expandedByRoot, getExpanded, setExpanded, toggleExpanded };
}

/**
 * Persisted open/closed state for one sidebar section, scoped to a workspace
 * and Notes root. `defaultExpanded` applies only until the user toggles the
 * section for the first time; after that the stored value wins.
 */
export function useNotesSectionExpanded(
    workspaceId: string,
    rootId: string,
    defaultExpanded: boolean,
): [boolean, (next: boolean) => void] {
    const storageKey = notesSectionExpandedStorageKey(workspaceId, rootId);
    const [state, setState] = useState(() => ({
        storageKey,
        expanded: readSectionExpanded(storageKey),
    }));

    useEffect(() => {
        setState(prev => prev.storageKey === storageKey
            ? prev
            : { storageKey, expanded: readSectionExpanded(storageKey) });
    }, [storageKey]);

    const setExpanded = useCallback((next: boolean) => {
        try {
            localStorage.setItem(storageKey, String(next));
        } catch {
            /* ignore */
        }
        setState({ storageKey, expanded: next });
    }, [storageKey]);

    const stored = state.storageKey === storageKey ? state.expanded : readSectionExpanded(storageKey);
    return [stored ?? defaultExpanded, setExpanded];
}

export interface UseNotesSectionsExpandedResult {
    /** Open/closed flag for every listed root, keyed by root ID. */
    expandedByRoot: Record<string, boolean>;
    /** Listed roots that are currently open, in the order they were passed. */
    expandedRootIds: string[];
    isExpanded: (rootId: string) => boolean;
    setExpanded: (rootId: string, next: boolean) => void;
    toggle: (rootId: string) => void;
}

/**
 * Open/closed state for a stack of root sections — the multi-root counterpart of
 * `useNotesSectionExpanded`, which covers one root and so cannot be called once
 * per root in a loop.
 *
 * Storage keys match the single-root hook's, so a section keeps its state across
 * reloads. A root with nothing stored starts open only when it is the fallback
 * root: `defaultExpandedRootId` (the previously selected root) when it is still
 * listed, else the first listed root — which is what guarantees at least one
 * open section on a first load (AC-02). A root the user explicitly collapsed
 * stays collapsed, even if that leaves every section closed.
 *
 * The fallback is pinned for as long as the workspace and that root survive:
 * `defaultExpandedRootId` follows the active root, and letting it move would
 * silently close the section the user just navigated away from.
 */
export function useNotesSectionsExpanded(
    workspaceId: string,
    rootIds: string[],
    defaultExpandedRootId?: string,
): UseNotesSectionsExpandedResult {
    const rootsKey = rootIds.join('\0');
    const [state, setState] = useState<{ scopeKey: string; entries: Record<string, boolean> }>(
        () => ({ scopeKey: workspaceId, entries: {} }),
    );

    const pinnedFallbackRef = useRef<{ scopeKey: string; rootId: string } | null>(null);
    const fallbackRootId = useMemo(() => {
        const ids = rootsKey ? rootsKey.split('\0') : [];
        const pinned = pinnedFallbackRef.current;
        if (pinned && pinned.scopeKey === workspaceId && ids.includes(pinned.rootId)) {
            return pinned.rootId;
        }
        const next = defaultExpandedRootId && ids.includes(defaultExpandedRootId)
            ? defaultExpandedRootId
            : ids[0];
        pinnedFallbackRef.current = next ? { scopeKey: workspaceId, rootId: next } : null;
        return next;
    }, [rootsKey, defaultExpandedRootId, workspaceId]);

    const expandedByRoot = useMemo(() => {
        const overrides = state.scopeKey === workspaceId ? state.entries : {};
        const next: Record<string, boolean> = {};
        for (const rootId of rootsKey ? rootsKey.split('\0') : []) {
            if (rootId in overrides) {
                next[rootId] = overrides[rootId];
                continue;
            }
            const stored = readSectionExpanded(notesSectionExpandedStorageKey(workspaceId, rootId));
            next[rootId] = stored ?? rootId === fallbackRootId;
        }
        return next;
    }, [fallbackRootId, rootsKey, state, workspaceId]);

    const expandedRootIds = useMemo(
        () => (rootsKey ? rootsKey.split('\0') : []).filter(rootId => expandedByRoot[rootId]),
        [expandedByRoot, rootsKey],
    );

    // Another workspace's sections must never leak into this one.
    useEffect(() => {
        setState(prev => (prev.scopeKey === workspaceId ? prev : { scopeKey: workspaceId, entries: {} }));
    }, [workspaceId]);

    const setExpanded = useCallback((rootId: string, next: boolean) => {
        try {
            localStorage.setItem(notesSectionExpandedStorageKey(workspaceId, rootId), String(next));
        } catch {
            /* ignore */
        }
        setState(prev => {
            const prevEntries = prev.scopeKey === workspaceId ? prev.entries : {};
            return { scopeKey: workspaceId, entries: { ...prevEntries, [rootId]: next } };
        });
    }, [workspaceId]);

    const isExpanded = useCallback(
        (rootId: string) => expandedByRoot[rootId]
            ?? readSectionExpanded(notesSectionExpandedStorageKey(workspaceId, rootId))
            ?? rootId === fallbackRootId,
        [expandedByRoot, fallbackRootId, workspaceId],
    );

    const toggle = useCallback(
        (rootId: string) => setExpanded(rootId, !isExpanded(rootId)),
        [isExpanded, setExpanded],
    );

    return { expandedByRoot, expandedRootIds, isExpanded, setExpanded, toggle };
}

/**
 * Restores the scroll position once the scoped tree is ready, saves scrolls at
 * most once per animation frame, and flushes the last position on scope change
 * or unmount.
 *
 * `scopeRootId` is the root whose scroll this is. A stacked sidebar shows every
 * root in one container, so it passes {@link NOTES_STACKED_SCROLL_ROOT_ID}
 * instead of a real root id.
 */
export function useNotesTreeScroll(
    workspaceId: string,
    scopeRootId: string | undefined,
    treeAreaRef: RefObject<HTMLDivElement | null>,
    ready: boolean,
): UIEventHandler<HTMLDivElement> {
    const storageKey = notesTreeScrollStorageKey(workspaceId, scopeRootId ?? DEFAULT_ROOT_ID);
    const restoredStorageKeyRef = useRef<string | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    const cancelPendingWrite = useCallback(() => {
        if (animationFrameRef.current === null) {
            return;
        }
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
    }, []);

    useLayoutEffect(() => {
        const treeArea = treeAreaRef.current;
        if (!ready || !treeArea) {
            return;
        }

        if (restoredStorageKeyRef.current !== storageKey) {
            treeArea.scrollTop = readNotesTreeScroll(storageKey);
            restoredStorageKeyRef.current = storageKey;
        }

        return () => {
            cancelPendingWrite();
            if (restoredStorageKeyRef.current === storageKey) {
                writeNotesTreeScroll(storageKey, treeArea.scrollTop);
            }
        };
    }, [cancelPendingWrite, ready, storageKey, treeAreaRef]);

    return useCallback(() => {
        if (animationFrameRef.current !== null) {
            return;
        }
        const scheduledStorageKey = storageKey;
        animationFrameRef.current = window.requestAnimationFrame(() => {
            animationFrameRef.current = null;
            if (restoredStorageKeyRef.current !== scheduledStorageKey) {
                return;
            }
            const treeArea = treeAreaRef.current;
            if (treeArea) {
                writeNotesTreeScroll(scheduledStorageKey, treeArea.scrollTop);
            }
        });
    }, [storageKey, treeAreaRef]);
}
