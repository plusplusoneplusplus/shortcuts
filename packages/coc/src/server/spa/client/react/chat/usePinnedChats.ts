/**
 * usePinnedChats — custom hook for managing pinned chat sessions.
 *
 * Fetches pinned IDs from user preferences, provides pin/unpin operations,
 * and partitions sessions into pinned vs unpinned groups.
 * Pins are persisted per-workspace via PATCH /api/preferences.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import type { ChatSessionItem } from '../types/dashboard';

export interface UsePinnedChatsResult {
    /** Ordered pinned IDs for the current workspace (newest-pinned first). */
    pinnedIds: string[];
    /** Whether a given session ID is pinned. */
    isPinned: (id: string) => boolean;
    /** Toggle pin state for a session. */
    togglePin: (id: string) => void;
    /** Split sessions into { pinned, unpinned } preserving order. */
    partitionSessions: (sessions: ChatSessionItem[]) => {
        pinned: ChatSessionItem[];
        unpinned: ChatSessionItem[];
    };
}

export function usePinnedChats(workspaceId: string): UsePinnedChatsResult {
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const allPinnedRef = useRef<Record<string, string[]>>({});
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        fetchApi('/preferences')
            .then((prefs: any) => {
                if (!mountedRef.current) return;
                const all = prefs?.pinnedChats ?? {};
                allPinnedRef.current = all;
                setPinnedIds(all[workspaceId] ?? []);
            })
            .catch(() => {
                if (!mountedRef.current) return;
                setPinnedIds([]);
            });
        return () => { mountedRef.current = false; };
    }, [workspaceId]);

    const isPinned = useCallback(
        (id: string) => pinnedIds.includes(id),
        [pinnedIds],
    );

    const togglePin = useCallback(
        (id: string) => {
            setPinnedIds(prev => {
                const isPinned = prev.includes(id);
                const next = isPinned ? prev.filter(p => p !== id) : [id, ...prev];

                const updated = { ...allPinnedRef.current };
                if (next.length > 0) {
                    updated[workspaceId] = next;
                } else {
                    delete updated[workspaceId];
                }
                allPinnedRef.current = updated;

                // Fire-and-forget PATCH
                const pinnedChats = Object.keys(updated).length > 0 ? updated : undefined;
                fetchApi('/preferences', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pinnedChats: pinnedChats ?? {} }),
                }).catch(() => { /* best-effort */ });

                return next;
            });
        },
        [workspaceId],
    );

    const partitionSessions = useCallback(
        (sessions: ChatSessionItem[]) => {
            const pinSet = new Set(pinnedIds);
            // Prune stale IDs that don't match any loaded session
            const sessionIdSet = new Set(sessions.map(s => s.id));
            const validPinnedIds = pinnedIds.filter(id => sessionIdSet.has(id));

            const pinnedMap = new Map(sessions.map(s => [s.id, s]));
            const pinned = validPinnedIds
                .map(id => pinnedMap.get(id))
                .filter((s): s is ChatSessionItem => s != null);
            const unpinned = sessions.filter(s => !pinSet.has(s.id));

            return { pinned, unpinned };
        },
        [pinnedIds],
    );

    return { pinnedIds, isPinned, togglePin, partitionSessions };
}
