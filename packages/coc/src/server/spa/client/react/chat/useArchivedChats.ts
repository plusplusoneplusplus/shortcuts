/**
 * useArchivedChats — custom hook for managing archived chat sessions.
 *
 * Fetches archived IDs from per-workspace preferences, provides archive/unarchive
 * operations, and persists state per-workspace via PATCH /api/workspaces/:id/preferences.
 * Mirrors the usePinnedChats pattern.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';

export interface UseArchivedChatsResult {
    /** Archived session IDs for the current workspace as a Set. */
    archiveSet: Set<string>;
    /** Whether a given session ID is archived. */
    isArchived: (id: string) => boolean;
    /** Toggle archive state for a session. Auto-unpins when archiving. */
    toggleArchive: (id: string) => void;
}

export function useArchivedChats(
    workspaceId: string,
    onUnpin?: (id: string) => void,
    isPinnedFn?: (id: string) => boolean,
): UseArchivedChatsResult {
    const [archivedIds, setArchivedIds] = useState<string[]>([]);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/preferences')
            .then((prefs: any) => {
                if (!mountedRef.current) return;
                setArchivedIds(prefs?.archivedChats?.[workspaceId] ?? []);
            })
            .catch(() => {
                if (!mountedRef.current) return;
                setArchivedIds([]);
            });
        return () => { mountedRef.current = false; };
    }, [workspaceId]);

    const isArchived = useCallback(
        (id: string) => archivedIds.includes(id),
        [archivedIds],
    );

    const toggleArchive = useCallback(
        (id: string) => {
            setArchivedIds(prev => {
                const isCurrentlyArchived = prev.includes(id);
                const next = isCurrentlyArchived ? prev.filter(a => a !== id) : [id, ...prev];

                // Fire-and-forget PATCH
                fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/preferences', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ archivedChats: { [workspaceId]: next } }),
                }).catch(() => { /* best-effort */ });

                // Auto-unpin when archiving a session that is actually pinned
                if (!isCurrentlyArchived && onUnpin && (!isPinnedFn || isPinnedFn(id))) {
                    onUnpin(id);
                }

                return next;
            });
        },
        [workspaceId, onUnpin, isPinnedFn],
    );

    return { archiveSet: new Set(archivedIds), isArchived, toggleArchive };
}
