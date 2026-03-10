/**
 * useArchivedChats — persists archived chat task IDs to the server.
 *
 * Reads and writes via PATCH /api/workspaces/:id/preferences using the
 * existing `archivedChats` field in PerRepoPreferences.  The inner key
 * within the Record is the workspaceId itself (to match the schema shape).
 *
 * Unlike useUnseenActivity (which uses localStorage), archived state is
 * stored server-side so it survives across browsers and server restarts.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase } from '../utils/config';

const MAX_ARCHIVED = 500;

export interface UseArchivedChatsResult {
    /** Set of task IDs that are currently archived. */
    archivedChatIds: Set<string>;
    /** Archive a chat by task ID. No-op if already archived. */
    archiveChat: (taskId: string) => void;
    /** Unarchive a chat by task ID. No-op if not archived. */
    unarchiveChat: (taskId: string) => void;
    /** Whether the initial load from the server has completed. */
    loaded: boolean;
}

export function useArchivedChats(workspaceId: string): UseArchivedChatsResult {
    const [archivedIds, setArchivedIds] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);
    // Keep a ref to always have latest state in async callbacks without stale closures
    const archivedIdsRef = useRef<string[]>([]);

    useEffect(() => {
        setArchivedIds([]);
        archivedIdsRef.current = [];
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
                    const map = prefs?.archivedChats;
                    if (typeof map === 'object' && map !== null) {
                        const ids = map[workspaceId];
                        if (Array.isArray(ids)) {
                            const valid = ids.filter((id: unknown) => typeof id === 'string' && id.length > 0);
                            setArchivedIds(valid);
                            archivedIdsRef.current = valid;
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
            ? { archivedChats: { [workspaceId]: ids } }
            : { archivedChats: {} };
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).catch(() => {});
    }, [workspaceId]);

    const archiveChat = useCallback((taskId: string) => {
        const current = archivedIdsRef.current;
        if (current.includes(taskId)) return;
        const next = [taskId, ...current].slice(0, MAX_ARCHIVED);
        archivedIdsRef.current = next;
        setArchivedIds(next);
        persist(next);
    }, [persist]);

    const unarchiveChat = useCallback((taskId: string) => {
        const current = archivedIdsRef.current;
        if (!current.includes(taskId)) return;
        const next = current.filter(id => id !== taskId);
        archivedIdsRef.current = next;
        setArchivedIds(next);
        persist(next);
    }, [persist]);

    const archivedChatIds = new Set(archivedIds);

    return { archivedChatIds, archiveChat, unarchiveChat, loaded };
}
