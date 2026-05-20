import { useState, useEffect, useCallback, useMemo } from 'react';
import { notesApi, type NotesRootEntry } from '../notesApi';

const DEFAULT_ROOT_ID = 'default';

function storageKey(workspaceId: string): string {
    return `coc-notes-selected-root-${workspaceId}`;
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
    refreshRoots: () => void;
}

export function useNotesRoots(workspaceId: string): UseNotesRootsResult {
    const [roots, setRoots] = useState<NotesRootEntry[]>([]);
    const [selectedRootId, setSelectedRootId] = useState<string>(() => {
        try {
            return localStorage.getItem(storageKey(workspaceId)) ?? DEFAULT_ROOT_ID;
        } catch {
            return DEFAULT_ROOT_ID;
        }
    });
    const [loading, setLoading] = useState(true);

    const fetchRoots = useCallback(async () => {
        setLoading(true);
        try {
            const data = await notesApi.listRoots(workspaceId);
            setRoots(data.roots);
            // If the persisted root no longer exists, fall back to default
            const validIds = new Set(data.roots.map(r => r.rootId));
            setSelectedRootId(prev => validIds.has(prev) ? prev : DEFAULT_ROOT_ID);
        } catch {
            // On error, just show default root
            setRoots([{ rootId: DEFAULT_ROOT_ID, label: 'Notes', isDefault: true }]);
            setSelectedRootId(DEFAULT_ROOT_ID);
        } finally {
            setLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        fetchRoots();
    }, [fetchRoots]);

    // Reset when workspace changes
    useEffect(() => {
        try {
            const saved = localStorage.getItem(storageKey(workspaceId));
            setSelectedRootId(saved ?? DEFAULT_ROOT_ID);
        } catch {
            setSelectedRootId(DEFAULT_ROOT_ID);
        }
    }, [workspaceId]);

    const selectRoot = useCallback((rootId: string) => {
        setSelectedRootId(rootId);
        try {
            localStorage.setItem(storageKey(workspaceId), rootId);
        } catch { /* ignore */ }
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
