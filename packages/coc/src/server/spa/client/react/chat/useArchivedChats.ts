/**
 * useArchivedChats — custom hook for managing archived chat sessions.
 *
 * Fetches archived IDs from user preferences, provides archive/unarchive
 * operations, and persists state per-workspace via PATCH /api/preferences.
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

export function useArchivedChats(workspaceId: string, onUnpin?: (id: string) => void): UseArchivedChatsResult {
    const [archivedIds, setArchivedIds] = useState<string[]>([]);
    const allArchivedRef = useRef<Record<string, string[]>>({});
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        fetchApi('/preferences')
            .then((prefs: any) => {
                if (!mountedRef.current) return;
                const all = prefs?.archivedChats ?? {};
                allArchivedRef.current = all;
                setArchivedIds(all[workspaceId] ?? []);
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

                const updated = { ...allArchivedRef.current };
                if (next.length > 0) {
                    updated[workspaceId] = next;
                } else {
                    delete updated[workspaceId];
                }
                allArchivedRef.current = updated;

                // Fire-and-forget PATCH
                const archivedChats = Object.keys(updated).length > 0 ? updated : undefined;
                fetchApi('/preferences', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ archivedChats: archivedChats ?? {} }),
                }).catch(() => { /* best-effort */ });

                // Auto-unpin when archiving a session
                if (!isCurrentlyArchived && onUnpin) {
                    onUnpin(id);
                }

                return next;
            });
        },
        [workspaceId, onUnpin],
    );

    return { archiveSet: new Set(archivedIds), isArchived, toggleArchive };
}
