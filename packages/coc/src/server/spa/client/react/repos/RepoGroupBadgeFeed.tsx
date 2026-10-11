import { useEffect } from 'react';
import { useRepoGroupChatFeed } from './useRepoGroupChatFeed';
import { getWorkspaceSelectionId, parseRemoteCloneKey } from './cloneIdentity';
import { isRemoteWorkspace } from './remoteWorkspaceAggregation';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';

export interface RepoGroupUnreadBadge {
    unread: number;
    partial: boolean;
}

/** Shell badges stay live even when the group's chat view is not mounted. */
export function RepoGroupBadgeFeed({ workspace, onChange }: {
    workspace: WorkspaceInfo;
    onChange: (selectionId: string, badge: RepoGroupUnreadBadge | undefined) => void;
}) {
    const selectionId = getWorkspaceSelectionId(workspace);
    const remote = isRemoteWorkspace(workspace) ? workspace : undefined;
    const feed = useRepoGroupChatFeed({
        groupId: workspace.id,
        serverKey: parseRemoteCloneKey(selectionId)?.serverId ?? 'local',
        baseUrl: remote?.baseUrl,
        ownerAvailable: !remote || !remote.remote.offline && remote.remote.connection === 'online',
        enabled: true,
        pageSize: 1,
    });
    const unread = feed.model?.counts.unread ?? 0;
    const partial = !feed.model || feed.model.counts.partial;
    useEffect(() => {
        onChange(selectionId, { unread, partial });
    }, [selectionId, unread, partial, onChange]);
    useEffect(() => () => onChange(selectionId, undefined), [selectionId, onChange]);
    return null;
}
