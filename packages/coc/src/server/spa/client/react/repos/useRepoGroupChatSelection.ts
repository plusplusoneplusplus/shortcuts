import { useCallback, useEffect, useState } from 'react';
import {
    buildRepoGroupChatHash,
    parseRepoGroupChatDeepLink,
    type RepoGroupChatDeepLink,
} from '../layout/dashboardRoutes';
import { repoHashBase } from '../layout/routePath';
import { parseRemoteCloneKey } from './cloneIdentity';
import { LOCAL_CHAT_FEED_SERVER_KEY, repoGroupChatKey, type RepoGroupChatRow } from './repoGroupChatFeed';

function readSelection(groupSelectionId: string): RepoGroupChatDeepLink | null {
    const link = parseRepoGroupChatDeepLink(location.hash);
    return link?.groupSelectionId === groupSelectionId ? link : null;
}

/** URL-backed owner identity survives refresh, history and unloaded feed pages. */
export function useRepoGroupChatSelection(groupSelectionId: string, enabled: boolean) {
    const [link, setLink] = useState(() => enabled ? readSelection(groupSelectionId) : null);
    useEffect(() => {
        const apply = () => setLink(enabled ? readSelection(groupSelectionId) : null);
        apply();
        window.addEventListener('hashchange', apply);
        return () => window.removeEventListener('hashchange', apply);
    }, [groupSelectionId, enabled]);

    const selection = enabled && link?.groupSelectionId === groupSelectionId ? link : null;
    const serverKey = parseRemoteCloneKey(groupSelectionId)?.serverId ?? LOCAL_CHAT_FEED_SERVER_KEY;
    const selectedKey = selection
        ? repoGroupChatKey(serverKey, selection.ownerWorkspaceId, selection.processId)
        : null;
    const selectMember = useCallback((row: RepoGroupChatRow) => {
        const hash = buildRepoGroupChatHash(groupSelectionId, row.ownerWorkspaceId, row.canonicalId);
        setLink(parseRepoGroupChatDeepLink(hash));
        location.hash = hash;
    }, [groupSelectionId]);
    const clearSelection = useCallback(() => setLink(null), []);
    const backToGroupChats = useCallback(() => {
        setLink(null);
        location.hash = repoHashBase(groupSelectionId) + '/chats';
    }, [groupSelectionId]);

    return { selection, selectedKey, selectMember, clearSelection, backToGroupChats };
}
