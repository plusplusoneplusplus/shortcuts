/**
 * useChatFolders — fetch the chat folders for a workspace (AC-04).
 *
 * Only fetches when `features.chatFolders` is on and a workspace is selected;
 * with the flag off the hook is inert and returns a stable empty list, so the
 * list renders exactly as it does today.
 *
 * There are no dedicated WebSocket events for folder changes (by decision), so
 * refreshes are driven by the caller — the mutation paths in AC-05/AC-06 apply
 * their change optimistically via `setFolders` and reconcile with `refresh`.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import type { ChatFolder } from '@plusplusoneplusplus/coc-client';

export interface UseChatFoldersResult {
    folders: ChatFolder[];
    /** True while the initial fetch is in flight (the section stays absent, no skeleton). */
    loading: boolean;
    /** Re-fetch from the server, discarding optimistic state. */
    refresh: () => void;
    /** Apply an optimistic update ahead of the server round-trip. */
    setFolders: React.Dispatch<React.SetStateAction<ChatFolder[]>>;
}

const EMPTY_FOLDERS: ChatFolder[] = [];

export function useChatFolders(workspaceId: string | undefined, enabled: boolean): UseChatFoldersResult {
    const [folders, setFolders] = useState<ChatFolder[]>(EMPTY_FOLDERS);
    const [loading, setLoading] = useState(false);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = useCallback(() => {
        if (!enabled || !workspaceId) {
            setFolders(EMPTY_FOLDERS);
            return;
        }
        const client = getSpaCocClient() as any;
        if (typeof client?.processes?.listChatFolders !== 'function') {
            setFolders(EMPTY_FOLDERS);
            return;
        }
        setLoading(true);
        client.processes.listChatFolders(workspaceId)
            .then((res: { folders?: ChatFolder[] }) => {
                if (!mountedRef.current) {return;}
                setFolders(Array.isArray(res?.folders) ? res.folders : EMPTY_FOLDERS);
            })
            .catch(() => {
                // A failed folder fetch must never blank the list; keep whatever
                // we last had and let the next refresh reconcile.
                if (mountedRef.current) {setFolders(prev => prev);}
            })
            .finally(() => {
                if (mountedRef.current) {setLoading(false);}
            });
    }, [enabled, workspaceId]);

    useEffect(() => { refresh(); }, [refresh]);

    return { folders, loading, refresh, setFolders };
}
