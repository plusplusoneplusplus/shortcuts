import { useEffect, useMemo } from 'react';
import { ChatDetailPane } from '../features/chat/ChatDetailPane';
import { ChatPreferencesProvider, ChatPrefsSync } from '../contexts/ChatPreferencesContext';
import { useMobileWorkspacePane } from '../features/repo-detail/mobileWorkspacePane';
import { repoHashBase } from '../layout/routePath';
import type { RepoGroupChatDeepLink } from '../layout/dashboardRoutes';
import { useCloneBaseUrl } from './cloneRouting';
import { parseRemoteCloneKey } from './cloneIdentity';
import { WorkspaceOwnerContext } from './workspaceOwnerContext';
import type { RepoGroupChatRow } from './repoGroupChatFeed';

export interface RepoGroupMemberChatDetailProps {
    selection: RepoGroupChatDeepLink;
    row?: RepoGroupChatRow;
    serverLabel: string;
    groupBaseUrl?: string;
    onBack: () => void;
    unavailable?: boolean;
    stale?: boolean;
    noLongerInGroup?: boolean;
}

/** Remount transport-owning descendants on owner/endpoint changes, never on list refresh. */
export function RepoGroupMemberChatDetail({ selection, row, serverLabel, groupBaseUrl, onBack, unavailable: ownerUnavailable, stale, noLongerInGroup }: RepoGroupMemberChatDetailProps) {
    const registeredBaseUrl = useCloneBaseUrl(selection.groupSelectionId);
    const remote = !!parseRemoteCloneKey(selection.groupSelectionId);
    const baseUrl = remote ? registeredBaseUrl ?? groupBaseUrl : undefined;
    const mobilePane = useMobileWorkspacePane();
    const setDetailOpen = mobilePane?.setDetailOpen;
    const setPane = mobilePane?.setPane;
    useEffect(() => {
        setPane?.('chat');
        setDetailOpen?.(true);
    }, [selection.ownerSelectionId, selection.processId, setPane, setDetailOpen]);
    const owner = useMemo(() => ({
        workspaceId: selection.ownerWorkspaceId,
        selectionId: selection.ownerSelectionId,
        baseUrl,
    }), [selection.ownerWorkspaceId, selection.ownerSelectionId, baseUrl]);
    const history = useMemo(() => row ? [row.item] : [], [row?.item]);
    const name = row?.ownerName ?? selection.ownerWorkspaceId;
    const unavailable = !!ownerUnavailable || remote && !baseUrl;
    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden" data-testid="repo-group-member-detail">
            <div className="flex items-center gap-2 px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] text-xs">
                <span className="truncate text-[#848484]" title={`${name} · ${serverLabel}`} data-testid="repo-group-member-owner">
                    {name} · {serverLabel}
                </span>
                <a
                    className="ml-auto shrink-0 text-[#0078d4] dark:text-[#3794ff] focus-visible:outline focus-visible:outline-2"
                    href={repoHashBase(selection.ownerSelectionId) + '/chats/' + encodeURIComponent(selection.processId)}
                    data-testid="repo-group-member-open-in-repo"
                >
                    Open in repo
                </a>
            </div>
            {noLongerInGroup && <div role="status" className="px-3 text-xs text-amber-700">No longer in group</div>}
            {stale && <div role="status" className="px-3 text-xs text-amber-700">Stale member: execution actions unavailable</div>}
            {unavailable ? (
                <div role="status" className="p-3 text-sm text-amber-700 dark:text-amber-400">
                    The owning server is unavailable. Reconnect it to read this conversation.
                </div>
            ) : (
                <WorkspaceOwnerContext.Provider key={`${selection.ownerSelectionId}|${baseUrl ?? 'local'}`} value={owner}>
                    <ChatPreferencesProvider key={selection.processId} workspaceId={selection.ownerWorkspaceId}>
                        <ChatPrefsSync workspaceId={selection.ownerWorkspaceId} history={history} />
                        <fieldset disabled={stale} className="flex flex-col flex-1 min-h-0 border-0 m-0 p-0">
                        <ChatDetailPane
                            selectedTaskId={selection.processId}
                            selectedTask={row?.item ?? null}
                            workspaceId={selection.ownerWorkspaceId}
                            sourceSelectionId={selection.ownerSelectionId}
                            onBack={onBack}
                            readOnly={stale}
                        />
                        </fieldset>
                    </ChatPreferencesProvider>
                </WorkspaceOwnerContext.Provider>
            )}
        </div>
    );
}
