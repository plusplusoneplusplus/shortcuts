import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction,
    type UIEventHandler,
} from 'react';

const DEFAULT_ROOT_ID = 'default';

export function notesTreeExpandedStorageKey(workspaceId: string, rootId: string): string {
    return `coc-notes-expanded-${workspaceId}-${rootId}`;
}

export function notesTreeScrollStorageKey(workspaceId: string, rootId: string): string {
    return `coc-notes-scroll-${workspaceId}-${rootId}`;
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

/**
 * Restores the scroll position once the scoped tree is ready, saves scrolls at
 * most once per animation frame, and flushes the last position on scope change
 * or unmount.
 */
export function useNotesTreeScroll(
    workspaceId: string,
    selectedRootId: string | undefined,
    treeAreaRef: RefObject<HTMLDivElement | null>,
    ready: boolean,
): UIEventHandler<HTMLDivElement> {
    const storageKey = notesTreeScrollStorageKey(workspaceId, selectedRootId ?? DEFAULT_ROOT_ID);
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
