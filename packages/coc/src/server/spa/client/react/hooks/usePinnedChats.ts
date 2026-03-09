/**
 * usePinnedChats — persists pinned chat task IDs to the server.
 *
 * Reads and writes via PATCH /api/workspaces/:id/preferences using the
 * existing `pinnedChats` field in PerRepoPreferences.  The inner key
 * within the Record is the workspaceId itself (to match the schema shape).
 *
 * Unlike useUnseenActivity (which uses localStorage), pinned state is
 * stored server-side so it survives across browsers and server restarts.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase } from '../utils/config';

const MAX_PINNED = 50;

export interface UsePinnedChatsResult {
    /** Set of task IDs that are currently pinned. */
    pinnedChatIds: Set<string>;
    /** Pin a chat by task ID. No-op if already pinned. */
    pinChat: (taskId: string) => void;
    /** Unpin a chat by task ID. No-op if not pinned. */
    unpinChat: (taskId: string) => void;
    /** Whether the initial load from the server has completed. */
    loaded: boolean;
}

export function usePinnedChats(workspaceId: string): UsePinnedChatsResult {
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);
    // Keep a ref to always have latest state in async callbacks without stale closures
    const pinnedIdsRef = useRef<string[]>([]);

    useEffect(() => {
        setPinnedIds([]);
        pinnedIdsRef.current = [];
        setLoaded(false);
        if (!workspaceId) {
            setLoaded(true);
            return;
        }
        let cancelled = false;
        const url = getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/preferences';
        (async () => {
            try {
                const res = await fetch(url);
                if (!res.ok) return;
                const prefs = await res.json();
                if (!cancelled) {
                    const map = prefs?.pinnedChats;
                    if (typeof map === 'object' && map !== null) {
                        const ids = map[workspaceId];
                        if (Array.isArray(ids)) {
                            const valid = ids.filter((id: unknown) => typeof id === 'string' && id.length > 0);
                            setPinnedIds(valid);
                            pinnedIdsRef.current = valid;
                        }
                    }
                }
            } catch {
                // Preferences are optional
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [workspaceId]);

    const persist = useCallback((ids: string[]) => {
        if (!workspaceId) return;
        const body = ids.length > 0
            ? { pinnedChats: { [workspaceId]: ids } }
            : { pinnedChats: {} };
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).catch(() => {});
    }, [workspaceId]);

    const pinChat = useCallback((taskId: string) => {
        const current = pinnedIdsRef.current;
        if (current.includes(taskId)) return;
        const next = [taskId, ...current].slice(0, MAX_PINNED);
        pinnedIdsRef.current = next;
        setPinnedIds(next);
        persist(next);
    }, [persist]);

    const unpinChat = useCallback((taskId: string) => {
        const current = pinnedIdsRef.current;
        if (!current.includes(taskId)) return;
        const next = current.filter(id => id !== taskId);
        pinnedIdsRef.current = next;
        setPinnedIds(next);
        persist(next);
    }, [persist]);

    const pinnedChatIds = new Set(pinnedIds);

    return { pinnedChatIds, pinChat, unpinChat, loaded };
}
