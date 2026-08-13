import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notesApi, type NoteTreeNode } from '../notesApi';

/** Everything one root's section needs to render its body. */
export interface NotesRootTreeState {
    tree: NoteTreeNode[] | null;
    notesRoot: string | null;
    systemFolders: string[];
    loading: boolean;
    error: string | null;
}

export interface UseNotesTreesResult {
    /** Trees already fetched this session, keyed by root ID. */
    trees: Record<string, NotesRootTreeState>;
    /**
     * State for one root: its cached tree, a loading placeholder while its first
     * fetch is in flight, or an idle placeholder for a root nobody expanded yet.
     */
    getTree: (rootId: string) => NotesRootTreeState;
    /** True once a root has been requested at least once. */
    isFetched: (rootId: string) => boolean;
    /** Re-fetch one root. A root that was never expanded stays unfetched. */
    refresh: (rootId: string) => Promise<void>;
    /** Re-fetch every root fetched so far. */
    refreshAll: () => Promise<void>;
}

const IDLE_STATE: NotesRootTreeState = {
    tree: null,
    notesRoot: null,
    systemFolders: [],
    loading: false,
    error: null,
};

const LOADING_STATE: NotesRootTreeState = { ...IDLE_STATE, loading: true };

/** `default` is the managed root, which the tree endpoint takes as no root param. */
export function notesRootParam(rootId: string): string | undefined {
    return rootId && rootId !== 'default' ? rootId : undefined;
}

interface TreeCache {
    scopeKey: string;
    entries: Record<string, NotesRootTreeState>;
}

/**
 * Fetches and caches one tree per notes root, lazily: a root is only requested
 * once it appears in `activeRootIds` (i.e. its section is expanded), and its
 * tree is kept for the rest of the session so collapsing and re-expanding never
 * re-fetches (AC-03).
 *
 * Switching workspace drops the whole cache. `notes-changed` events for the
 * current workspace refresh every root fetched so far.
 */
export function useNotesTrees(workspaceId: string, activeRootIds: string[]): UseNotesTreesResult {
    const [cache, setCache] = useState<TreeCache>(() => ({ scopeKey: workspaceId, entries: {} }));
    const scopeRef = useRef(workspaceId);
    scopeRef.current = workspaceId;
    /** Per-root request counters so a slow response never overwrites a newer one. */
    const generationsRef = useRef<Record<string, number>>({});
    /** Roots requested under the current workspace — the lazy-fetch guard. */
    const requestedRef = useRef<{ scopeKey: string; ids: Set<string> }>({ scopeKey: workspaceId, ids: new Set() });

    const entries = cache.scopeKey === workspaceId ? cache.entries : {};
    const activeKey = activeRootIds.join('\0');
    const activeSet = useMemo(() => new Set(activeKey ? activeKey.split('\0') : []), [activeKey]);

    const fetchRoot = useCallback(async (rootId: string) => {
        const scopeKey = workspaceId;
        const generation = (generationsRef.current[rootId] ?? 0) + 1;
        generationsRef.current[rootId] = generation;

        const merge = (next: NotesRootTreeState) => {
            setCache(prev => ({
                scopeKey,
                entries: { ...(prev.scopeKey === scopeKey ? prev.entries : {}), [rootId]: next },
            }));
        };

        setCache(prev => {
            const prevEntries = prev.scopeKey === scopeKey ? prev.entries : {};
            const current = prevEntries[rootId] ?? IDLE_STATE;
            return {
                scopeKey,
                entries: { ...prevEntries, [rootId]: { ...current, loading: true, error: null } },
            };
        });

        const isStale = () =>
            generationsRef.current[rootId] !== generation || scopeRef.current !== scopeKey;

        try {
            const data = await notesApi.getTree(workspaceId, notesRootParam(rootId));
            if (isStale()) return;
            merge({
                tree: data.tree,
                notesRoot: data.notesRoot,
                systemFolders: data.systemFolders ?? [],
                loading: false,
                error: null,
            });
        } catch (err: any) {
            if (isStale()) return;
            merge({
                ...IDLE_STATE,
                loading: false,
                error: err?.message ?? 'Failed to load notes tree',
            });
        }
    }, [workspaceId]);

    // Drop everything on workspace change so a stale tree never flashes.
    useEffect(() => {
        requestedRef.current = { scopeKey: workspaceId, ids: new Set() };
        generationsRef.current = {};
        setCache(prev => (prev.scopeKey === workspaceId ? prev : { scopeKey: workspaceId, entries: {} }));
    }, [workspaceId]);

    // Lazy fetch: request each newly active root exactly once per workspace.
    useEffect(() => {
        if (requestedRef.current.scopeKey !== workspaceId) {
            requestedRef.current = { scopeKey: workspaceId, ids: new Set() };
        }
        for (const rootId of activeKey ? activeKey.split('\0') : []) {
            if (requestedRef.current.ids.has(rootId)) continue;
            requestedRef.current.ids.add(rootId);
            void fetchRoot(rootId);
        }
    }, [activeKey, fetchRoot, workspaceId]);

    const refresh = useCallback(async (rootId: string) => {
        if (!requestedRef.current.ids.has(rootId)) return;
        await fetchRoot(rootId);
    }, [fetchRoot]);

    const refreshAll = useCallback(async () => {
        await Promise.all([...requestedRef.current.ids].map(rootId => fetchRoot(rootId)));
    }, [fetchRoot]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { wsId?: string } | undefined;
            if (detail?.wsId !== workspaceId) return;
            void refreshAll();
        };
        window.addEventListener('notes-changed', handler);
        return () => window.removeEventListener('notes-changed', handler);
    }, [refreshAll, workspaceId]);

    const getTree = useCallback(
        (rootId: string): NotesRootTreeState =>
            entries[rootId] ?? (activeSet.has(rootId) ? LOADING_STATE : IDLE_STATE),
        [activeSet, entries],
    );

    const isFetched = useCallback((rootId: string) => rootId in entries, [entries]);

    return { trees: entries, getTree, isFetched, refresh, refreshAll };
}
