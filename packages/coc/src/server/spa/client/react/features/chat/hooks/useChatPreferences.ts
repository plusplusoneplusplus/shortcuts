/**
 * useChatPreferences — persists pinned and archived chat task IDs to the server.
 *
 * Reads and writes via PATCH /api/workspaces/:id/preferences using the
 * existing `pinnedChats` and `archivedChats` fields in PerRepoPreferences.
 * Issues a single GET on mount instead of two separate requests.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWorkspacePreferences, patchWorkspacePreferences, type PerRepoPrefsClient } from '../../../hooks/preferences/preferencesApi';

const MAX_PINNED = 50;
const MAX_ARCHIVED = 500;

export interface UseChatPreferencesResult {
    /** Set of task IDs that are currently pinned. */
    pinnedChatIds: Set<string>;
    /** Pin a chat by task ID. No-op if already pinned. */
    pinChat: (taskId: string) => void;
    /** Unpin a chat by task ID. No-op if not pinned. */
    unpinChat: (taskId: string) => void;
    /** Set of task IDs that are currently archived. */
    archivedChatIds: Set<string>;
    /** Archive a chat by task ID. No-op if already archived. */
    archiveChat: (taskId: string) => void;
    /** Unarchive a chat by task ID. No-op if not archived. */
    unarchiveChat: (taskId: string) => void;
    /** Archive multiple chats in one request. */
    archiveChats: (taskIds: string[]) => void;
    /** Unarchive multiple chats in one request. */
    unarchiveChats: (taskIds: string[]) => void;
    /** True once the single GET /preferences response has settled (both sets ready). */
    loaded: boolean;
}

export function useChatPreferences(workspaceId: string): UseChatPreferencesResult {
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const pinnedIdsRef = useRef<string[]>([]);
    const [archivedIds, setArchivedIds] = useState<string[]>([]);
    const archivedIdsRef = useRef<string[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setPinnedIds([]); pinnedIdsRef.current = [];
        setArchivedIds([]); archivedIdsRef.current = [];
        setLoaded(false);
        if (!workspaceId) { setLoaded(true); return; }
        let cancelled = false;
        (async () => {
            try {
                const prefs = await getWorkspacePreferences(workspaceId);
                if (!cancelled) {
                    // pinnedChats
                    const pm = prefs?.pinnedChats;
                    if (typeof pm === 'object' && pm !== null) {
                        const ids = pm[workspaceId];
                        if (Array.isArray(ids)) {
                            const valid = ids.filter((id: unknown) => typeof id === 'string' && id.length > 0);
                            setPinnedIds(valid); pinnedIdsRef.current = valid;
                        }
                    }
                    // archivedChats
                    const am = prefs?.archivedChats;
                    if (typeof am === 'object' && am !== null) {
                        const ids = am[workspaceId];
                        if (Array.isArray(ids)) {
                            const valid = ids.filter((id: unknown) => typeof id === 'string' && id.length > 0);
                            setArchivedIds(valid); archivedIdsRef.current = valid;
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

    const persistPinned = useCallback((ids: string[]) => {
        if (!workspaceId) return;
        const body: Partial<PerRepoPrefsClient> = ids.length > 0
            ? { pinnedChats: { [workspaceId]: ids } }
            : { pinnedChats: {} };
        patchWorkspacePreferences(workspaceId, body).catch(() => {});
    }, [workspaceId]);

    const persistArchived = useCallback((ids: string[]) => {
        if (!workspaceId) return;
        const body: Partial<PerRepoPrefsClient> = ids.length > 0
            ? { archivedChats: { [workspaceId]: ids } }
            : { archivedChats: {} };
        patchWorkspacePreferences(workspaceId, body).catch(() => {});
    }, [workspaceId]);

    const pinChat = useCallback((taskId: string) => {
        const current = pinnedIdsRef.current;
        if (current.includes(taskId)) return;
        const next = [taskId, ...current].slice(0, MAX_PINNED);
        pinnedIdsRef.current = next;
        setPinnedIds(next);
        persistPinned(next);
    }, [persistPinned]);

    const unpinChat = useCallback((taskId: string) => {
        const current = pinnedIdsRef.current;
        if (!current.includes(taskId)) return;
        const next = current.filter(id => id !== taskId);
        pinnedIdsRef.current = next;
        setPinnedIds(next);
        persistPinned(next);
    }, [persistPinned]);

    const archiveChat = useCallback((taskId: string) => {
        const current = archivedIdsRef.current;
        if (current.includes(taskId)) return;
        const next = [taskId, ...current].slice(0, MAX_ARCHIVED);
        archivedIdsRef.current = next;
        setArchivedIds(next);
        persistArchived(next);
    }, [persistArchived]);

    const unarchiveChat = useCallback((taskId: string) => {
        const current = archivedIdsRef.current;
        if (!current.includes(taskId)) return;
        const next = current.filter(id => id !== taskId);
        archivedIdsRef.current = next;
        setArchivedIds(next);
        persistArchived(next);
    }, [persistArchived]);

    const archiveChats = useCallback((taskIds: string[]) => {
        const current = archivedIdsRef.current;
        const toAdd = taskIds.filter(id => !current.includes(id));
        if (toAdd.length === 0) return;
        const next = [...toAdd, ...current].slice(0, MAX_ARCHIVED);
        archivedIdsRef.current = next;
        setArchivedIds(next);
        persistArchived(next);
    }, [persistArchived]);

    const unarchiveChats = useCallback((taskIds: string[]) => {
        const current = archivedIdsRef.current;
        const removing = new Set(taskIds);
        const next = current.filter(id => !removing.has(id));
        if (next.length === current.length) return;
        archivedIdsRef.current = next;
        setArchivedIds(next);
        persistArchived(next);
    }, [persistArchived]);

    return {
        pinnedChatIds: new Set(pinnedIds),
        pinChat,
        unpinChat,
        archivedChatIds: new Set(archivedIds),
        archiveChat,
        unarchiveChat,
        archiveChats,
        unarchiveChats,
        loaded,
    };
}
