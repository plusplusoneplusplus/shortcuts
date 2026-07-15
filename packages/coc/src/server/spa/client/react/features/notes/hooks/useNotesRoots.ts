import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { notesApi, type NotesRootEntry } from '../notesApi';

const DEFAULT_ROOT_ID = 'default';

function storageKey(workspaceId: string): string {
    return `coc-notes-selected-root-${workspaceId}`;
}

function readSelectedRoot(workspaceId: string): string {
    try {
        return localStorage.getItem(storageKey(workspaceId)) ?? DEFAULT_ROOT_ID;
    } catch {
        return DEFAULT_ROOT_ID;
    }
}

function persistSelectedRoot(workspaceId: string, rootId: string): void {
    try {
        localStorage.setItem(storageKey(workspaceId), rootId);
    } catch { /* ignore */ }
}

interface NotesRootsState {
    workspaceId: string;
    roots: NotesRootEntry[];
    selectedRootId: string;
    loading: boolean;
}

function initialState(workspaceId: string): NotesRootsState {
    return {
        workspaceId,
        roots: [],
        selectedRootId: readSelectedRoot(workspaceId),
        loading: true,
    };
}

export interface UseNotesRootsResult {
    /** All available roots (default + additional). Empty while loading. */
    roots: NotesRootEntry[];
    /** The currently selected root ID ('default' or a relative path). */
    selectedRootId: string;
    /** Whether the selected root is the default managed root. */
    isDefaultRoot: boolean;
    /** Display label for the current root. */
    selectedRootLabel: string;
    /** Whether the roots list is still loading. */
    loading: boolean;
    /** Select a different root. */
    selectRoot: (rootId: string) => void;
    /** Refresh roots from server. */
    refreshRoots: () => Promise<void>;
}

export function useNotesRoots(workspaceId: string): UseNotesRootsResult {
    const [state, setState] = useState<NotesRootsState>(() => initialState(workspaceId));
    const requestGenerationRef = useRef(0);
    const activeWorkspaceRef = useRef(workspaceId);
    activeWorkspaceRef.current = workspaceId;

    // State from the prior workspace must never be rendered or passed to that
    // workspace's routed client while the new roots request is starting.
    const visibleState = state.workspaceId === workspaceId ? state : initialState(workspaceId);
    const { roots, selectedRootId, loading } = visibleState;

    const fetchRoots = useCallback(async () => {
        if (activeWorkspaceRef.current !== workspaceId) {
            return;
        }
        const requestGeneration = ++requestGenerationRef.current;
        setState(prev => prev.workspaceId === workspaceId
            ? { ...prev, loading: true }
            : initialState(workspaceId));
        try {
            const data = await notesApi.listRoots(workspaceId);
            if (requestGeneration !== requestGenerationRef.current || activeWorkspaceRef.current !== workspaceId) {
                return;
            }

            const validIds = new Set(data.roots.map(r => r.rootId));
            setState(prev => {
                const desiredRootId = prev.workspaceId === workspaceId
                    ? prev.selectedRootId
                    : readSelectedRoot(workspaceId);
                const nextRootId = validIds.has(desiredRootId) ? desiredRootId : DEFAULT_ROOT_ID;
                if (nextRootId !== desiredRootId) {
                    persistSelectedRoot(workspaceId, nextRootId);
                }
                return {
                    workspaceId,
                    roots: data.roots,
                    selectedRootId: nextRootId,
                    loading: false,
                };
            });
        } catch {
            if (requestGeneration !== requestGenerationRef.current || activeWorkspaceRef.current !== workspaceId) {
                return;
            }
            persistSelectedRoot(workspaceId, DEFAULT_ROOT_ID);
            setState({
                workspaceId,
                roots: [{ rootId: DEFAULT_ROOT_ID, label: 'Notes', isDefault: true }],
                selectedRootId: DEFAULT_ROOT_ID,
                loading: false,
            });
        }
    }, [workspaceId]);

    useEffect(() => {
        void fetchRoots();
        return () => {
            requestGenerationRef.current += 1;
        };
    }, [fetchRoots]);

    const selectRoot = useCallback((rootId: string) => {
        setState(prev => ({
            ...(prev.workspaceId === workspaceId ? prev : initialState(workspaceId)),
            workspaceId,
            selectedRootId: rootId,
        }));
        persistSelectedRoot(workspaceId, rootId);
    }, [workspaceId]);

    const isDefaultRoot = selectedRootId === DEFAULT_ROOT_ID;

    const selectedRootLabel = useMemo(() => {
        const entry = roots.find(r => r.rootId === selectedRootId);
        return entry?.label ?? 'Notes';
    }, [roots, selectedRootId]);

    return {
        roots,
        selectedRootId,
        isDefaultRoot,
        selectedRootLabel,
        loading,
        selectRoot,
        refreshRoots: fetchRoots,
    };
}
