/**
 * RepoGroupView — landing page for a repo-group virtual workspace (`group-<slug>`).
 *
 * A repo group is a virtual workspace (own root under `~/.coc/repos/<groupId>/`,
 * no git) that knows about a set of registered repo workspaces; chats started
 * here get the member repos injected server-side. The view shows Workspace
 * (chat), Notes and Settings. Git lives inside the Workspace split.
 *
 * `RepoGroupGitTab` hosts ONE member repo inside the split Workspace panel. The group's root is never treated as a git repo.
 *
 * In the remote-first desktop shell the header (identity + sub-tabs) lives in
 * the global TopBar (`VirtualWorkspaceShellHeader`); in the classic shell and on
 * mobile it renders here as `VirtualWorkspaceInlineHeader`.
 *
 * On desktop the group also gets the workspace
 * right dock. The dock's own state scopes to the group, while its Terminal and
 * Explorer point at a target picked in the panel's open menu: the group root, or any
 * live member repo. Notes stays on the group. Members come from
 * `GET /api/repo-groups/:id`; stale ones are listed but not selectable.
 *
 * Member descriptions are edited on the Settings tab (`RepoGroupSettingsTab`),
 * not here — the Workspace tab is the chat and nothing else.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NotesView } from '../features/notes/NotesView';
import { RepoChatTab } from '../features/chat/RepoChatTab';
import { RefreshSidebarButton } from '../features/chat/RefreshSidebarButton';
import { SplitWorkspacePanel } from '../features/repo-detail/SplitWorkspacePanel';
import { GroupRailGitView } from '../features/repo-detail/RailGitSummary';
import { useGroupRailGit } from '../features/repo-detail/useRailGitSummary';
import { UnifiedRightPanel } from '../features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { ContentSearchOverlayHost } from '../features/repo-detail/content-search/ContentSearchOverlayHost';
import type { ContentSearchOverlayMatch } from '../features/repo-detail/content-search/ContentSearchOverlay';
import { openContentSearchMatch } from '../features/repo-detail/content-search/contentSearchOpen';
import { UnifiedPanelHostProvider } from '../features/repo-detail/unified-right-panel/unifiedPanelHost';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useApp } from '../contexts/AppContext';
import { useQueue, useQueueOptional } from '../contexts/QueueContext';
import { useRepoQueueJobs } from '../queue/hooks/useRepoQueueStats';
import { useCocClient } from './cloneRouting';
import { workspaceReadSource } from '../api/workspaceReads';
import { StatusActions } from '../layout/StatusActions';
import { useReposOptional } from '../contexts/ReposContext';
import { ToastContext } from '../contexts/ToastContext';
import { resolveRepoGroupName, resolveRepoGroupDisplayName } from './repoGroupName';
import type { RepoGroupMember } from './repoGroupService';
import { RepoGroupGitTab } from './RepoGroupGitTab';
import { RepoGroupSettingsTab } from './RepoGroupSettingsTab';
import { useRepoGroupMembers } from './useRepoGroupMembers';
import { useWorkspaceDock, type DockTarget } from '../features/repo-detail/useWorkspaceDock';
import { setWorkspaceDockExpanded, useWorkspaceDockExpanded } from '../features/repo-detail/WorkspaceDockToggle';
import { VirtualWorkspaceInlineHeader } from '../features/remote-shell/VirtualWorkspaceInlineHeader';
import { VirtualWorkspaceMobileTabBar } from '../features/remote-shell/VirtualWorkspaceMobileTabBar';
import type { VirtualWorkspaceHeaderConfig } from '../features/remote-shell/virtualWorkspaceHeader';
import { getRemoteCloneKey, getWorkspaceSelectionId, parseRemoteCloneKey } from './cloneIdentity';
import { useRepoGroupAggregatedChatsEnabled } from '../hooks/feature-flags/useRepoGroupAggregatedChatsEnabled';
import { useRepoGroupChatFeed } from './useRepoGroupChatFeed';
import { LOCAL_CHAT_FEED_SERVER_KEY, repoGroupChatKey } from './repoGroupChatFeed';
import { useRepoGroupChatSelection } from './useRepoGroupChatSelection';
import { RepoGroupMemberChatDetail } from './RepoGroupMemberChatDetail';
import { allRepoGroupChatRows } from './repoGroupChatFeed';
import { RepoGroupChatList } from './RepoGroupChatList';
import { useRepoGroupChatFilters } from './useRepoGroupChatFilters';
import { WorkspaceOwnerContext } from './workspaceOwnerContext';
import type { RepoChatTabListContext } from '../features/chat/RepoChatTab';

/**
 * The only tabs a repo group exposes: chat ("Workspace"), Notes, and Settings.
 * Settings reuses a real repo's Alt+C — a group is never on screen at the same
 * time as a repo, so the shortcut cannot collide.
 */
const REPO_GROUP_TABS: VirtualWorkspaceHeaderConfig['tabs'] = [
    { key: 'chats', label: 'Workspace', shortcut: 'Alt+W' },
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
    { key: 'settings', label: 'Settings', shortcut: 'Alt+C' },
];

/**
 * Header identity + tabs for a repo-group virtual workspace, shared by the
 * TopBar (`VirtualWorkspaceShellHeader`) and in-body (`VirtualWorkspaceInlineHeader`)
 * header variants. Unlike My Work / My Life the config is per-group (id + name),
 * so it is built on demand rather than being a module constant.
 */
export function getRepoGroupHeaderConfig(
    workspaceId: string,
    label: string,
): VirtualWorkspaceHeaderConfig {
    return {
        workspaceId,
        icon: '🗂️',
        label,
        testIdPrefix: 'repo-group',
        tabs: REPO_GROUP_TABS,
        actions: [],
        defaultTab: 'chats',
    };
}

/** Label suffix explaining why a member cannot be targeted; mirrors RepoGroupDialog. */
function staleSuffix(reason: RepoGroupMember['staleReason']): string {
    return reason === 'workspace-removed' ? ' (removed)' : ' (path missing)';
}

/** Picker label for the group's own root — the chat's cwd, terminal-only. */
export const REPO_GROUP_ROOT_TARGET_LABEL = 'Group root';

/**
 * Turn a group's resolved membership into dock target options: the group's own
 * root first (so a terminal can match the chat's cwd), then every member repo.
 * A stale member stays listed — with the reason in its label — but disabled, so
 * the dock never points a terminal at a root that is not there.
 */
export function repoGroupDockTargets(workspaceId: string, members: readonly RepoGroupMember[]): DockTarget[] {
    return [
        // Listed first so it is easy to reach, but never the automatic default —
        // the group root holds only `group.json` (D-07).
        { workspaceId, label: REPO_GROUP_ROOT_TARGET_LABEL, deprioritized: true },
        ...members.map(member => ({
            workspaceId: member.workspaceId,
            label: (member.name || member.workspaceId) + (member.stale ? staleSuffix(member.staleReason) : ''),
            ...(member.rootPath ? { rootPath: member.rootPath } : {}),
            disabled: member.stale || undefined,
        })),
    ];
}

export interface RepoGroupViewProps {
    /** The `group-<slug>` workspace id currently selected. */
    workspaceId: string;
    /** Clone-qualified dashboard selection, distinct from the raw API workspace id. */
    selectionId?: string;
}

export function RepoGroupView({ workspaceId, selectionId = workspaceId }: RepoGroupViewProps) {
    const { state } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const queueClient = useCocClient(selectionId);
    const queueJobs = useRepoQueueJobs(workspaceId, queueClient, selectionId);
    const queueRunningCount = queueJobs.running.length;
    const queueQueuedCount = queueJobs.queued.length;
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    // In the remote-first desktop shell the header lives in the global TopBar
    // (`VirtualWorkspaceShellHeader`); render the in-body header everywhere else.
    const headerInTopBar = !isMobile;

    // Group name comes from the registered workspace — the local list for a local
    // group, the aggregated remote groups for one that lives on a remote server.
    // The id is a readable fallback while those lists are still loading.
    const remoteGroups = useReposOptional()?.remoteGroupWorkspaces;
    const groupName = useMemo(
        () => resolveRepoGroupName(selectionId, state.workspaces, remoteGroups),
        [state.workspaces, remoteGroups, selectionId]
    );
    // Split Workspace panel: the group's chat and
    // git share the Chats tab through the same `SplitWorkspacePanel` shell a repo
    // uses — chat list on top and member git list below. Desktop keeps chat
    // detail in the middle and opens Git detail in the far-right panel; mobile
    // uses a segmented control with a full-screen detail push.
    // Mobile pins only the merged Workspace tab; with the flag on neither
    // layout exposes a second, standalone Git tab.
    const headerConfig = useMemo(
        () => getRepoGroupHeaderConfig(selectionId,
            resolveRepoGroupDisplayName(selectionId, state.workspaces, remoteGroups)),
        [selectionId, state.workspaces, remoteGroups],
    );

    // Landing tab when the current sub-tab is not one of the group's tabs (e.g.
    // arriving from a repo's Git tab). Mirrors useVirtualWorkspaceHeader so the
    // highlighted header tab and the content pane always agree.
    // A `git` deep link (or a leftover selection) in split mode lands on
    // Workspace, while the git route stays intact for the embedded git host.
    const activeTab = headerConfig.tabs.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : 'chats';

    // Right dock (Terminal / Explorer / Notes) — same gate as RepoDetail. Its
    // state scopes to the GROUP, so switching member repos never closes or
    // resizes it; only the terminal/explorer content follows the picker. The
    // group detail read goes to whichever server owns the group — local for a
    // local group, the remote's baseUrl for one aggregated from a remote server.
    const dockAvailable = !isMobile;
    const remoteGroup = useMemo(
        () => (remoteGroups ?? []).find(ws => getWorkspaceSelectionId(ws) === selectionId),
        [remoteGroups, selectionId],
    );
    const groupBaseUrl = useMemo(() => {
        const url = (remoteGroup as { baseUrl?: unknown } | undefined)?.baseUrl;
        return typeof url === 'string' && url.length > 0 ? url : undefined;
    }, [remoteGroup]);
    const groupRoutingRef = getRemoteCloneKey(remoteGroup) ?? null;
    const groupOwner = useMemo(() => ({
        workspaceId, selectionId, baseUrl: groupBaseUrl,
        rootPath: remoteGroup?.rootPath ?? (!parseRemoteCloneKey(selectionId)
            ? state.workspaces.find(workspace => workspace.id === workspaceId)?.rootPath : undefined),
    }), [workspaceId, selectionId, groupBaseUrl, remoteGroup, state.workspaces]);
    // Aggregated chat list (flag `repoGroupAggregatedChats`): the group's own
    // chats plus every member's, read from the group's owning server. Row keys
    // carry that server's identity so equal ids on two servers never collide.
    const aggregatedChats = useRepoGroupAggregatedChatsEnabled();
    const remoteMarker = remoteGroup?.remote;
    const groupOwnerAvailable = !parseRemoteCloneKey(selectionId)
        || !!groupBaseUrl && !!remoteMarker && !remoteMarker.offline
            && (!remoteMarker.connection || remoteMarker.connection === 'online');
    const chatServerKey = parseRemoteCloneKey(selectionId)?.serverId ?? LOCAL_CHAT_FEED_SERVER_KEY;
    const chatServerLabel = typeof remoteMarker?.serverLabel === 'string' && remoteMarker.serverLabel
        ? remoteMarker.serverLabel
        : 'This server';
    const [chatFilters, setChatFilters] = useRepoGroupChatFilters(selectionId);
    const chatFeed = useRepoGroupChatFeed({
        groupId: workspaceId,
        baseUrl: groupBaseUrl,
        serverKey: chatServerKey,
        enabled: aggregatedChats,
        ownerAvailable: groupOwnerAvailable,
        filters: chatFilters,
    });
    const unresolvedAggregateOwner = aggregatedChats && !!parseRemoteCloneKey(selectionId) && !groupBaseUrl;
    const unavailableRefreshFlight = useRef(false);
    const [unavailableRefreshing, setUnavailableRefreshing] = useState(false);
    const memberChat = useRepoGroupChatSelection(selectionId, aggregatedChats);
    const memberRow = chatFeed.model && memberChat.selectedKey
        ? allRepoGroupChatRows(chatFeed.model).find(row => row.key === memberChat.selectedKey)
        : undefined;
    // Member repos, for the dock's target picker and the Git tab's host. The
    // Settings tab does its own read — it needs the descriptions too, and only
    // while it is the visible tab.
    // The split panel mounts the git list with the Chats tab, so it needs the
    // members straight away rather than on first Git-tab visit.
    const members = useRepoGroupMembers(workspaceId, groupBaseUrl,
        !aggregatedChats || !parseRemoteCloneKey(selectionId) || !!groupBaseUrl);
    const splitGitAvailable = isMobile || members === undefined || members.some(member => !member.stale);
    const railGitStatus = useGroupRailGit({ client: queueClient, routingRef: selectionId, members, enabled: splitGitAvailable });
    const refreshSidebarGit = useCallback(() => railGitStatus.refresh(true), [railGitStatus.refresh]);
    const toast = useContext(ToastContext);
    const refreshUnavailableGroup = useCallback(async () => {
        if (unavailableRefreshFlight.current) return;
        unavailableRefreshFlight.current = true;
        setUnavailableRefreshing(true);
        try {
            const results = await Promise.allSettled([chatFeed.refresh(), refreshSidebarGit()]);
            const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
            if (errors.length) toast?.addToast(`Could not refresh sidebar: ${errors.map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)).join('; ')}`, 'error');
        } finally {
            unavailableRefreshFlight.current = false;
            setUnavailableRefreshing(false);
        }
    }, [chatFeed.refresh, refreshSidebarGit, toast]);
    const dockTargets = useMemo(
        () => (dockAvailable && members ? repoGroupDockTargets(workspaceId, members) : undefined),
        [dockAvailable, members, workspaceId]
    );
    const dock = useWorkspaceDock(workspaceId, dockTargets);
    // An expanded panel covers the whole content row; the content stays mounted.
    const dockExpanded = useWorkspaceDockExpanded(workspaceId) && dock.isOpen && dockAvailable;
    useEffect(() => {
        if (!dockAvailable) setWorkspaceDockExpanded(workspaceId, false);
    }, [dockAvailable, workspaceId]);
    // Slots for the split Workspace panel: mobile's last-clicked detail,
    // the middle chat detail, and the shared Git toolbar. State-backed
    // (not refs) so the portals mount once the nodes exist — same shape as
    // RepoDetail's split wiring.
    const [splitLastClicked, setSplitLastClicked] = useState<'chat' | 'git'>('chat');
    const [splitDetailNode, setSplitDetailNode] = useState<HTMLDivElement | null>(null);
    const [splitRailShortcutNode, setSplitRailShortcutNode] = useState<HTMLDivElement | null>(null);
    const [splitGitHeaderNode, setSplitGitHeaderNode] = useState<HTMLDivElement | null>(null);
    const handleSplitNewChat = useCallback(() => {
        memberChat.backToGroupChats();
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: selectionId });
        setSplitLastClicked('chat');
    }, [memberChat.backToGroupChats, queueDispatch, selectionId]);
    // Group-owned rows select through the tab's native path, so the group's own
    // selection, hash and detail pane behave exactly as in the native list.
    const renderAggregatedList = useCallback((ctx: RepoChatTabListContext) => {
        const selectedKey = memberChat.selectedKey
            ?? (ctx.selectedTaskId ? repoGroupChatKey(chatServerKey, workspaceId, ctx.selectedTaskId) : null);
        return (
            <RepoGroupChatList
                feed={chatFeed}
                serverLabel={chatServerLabel}
                selectedKey={selectedKey}
                filters={chatFilters}
                onFiltersChange={setChatFilters}
                baseUrl={groupBaseUrl}
                refresh={chatFeed.refresh}
                groupSelectionId={selectionId}
                onSelect={(row) => {
                    if (row.ownerWorkspaceId === workspaceId) {
                        memberChat.clearSelection();
                        ctx.selectTask(row.item.id, row.item);
                        return;
                    }
                    memberChat.selectMember(row);
                }}
            />
        );
    }, [chatFeed, chatFilters, chatServerKey, chatServerLabel, groupBaseUrl, selectionId, memberChat.selectedKey, memberChat.selectMember, memberChat.clearSelection, workspaceId]);
    const routedGitMember = state.gitRouteScope?.routeWorkspaceId === workspaceId
        ? state.gitRouteScope.workspaceId
        : null;
    useEffect(() => {
        if (isMobile && routedGitMember && state.selectedGitCommitHash) {
            setSplitLastClicked('git');
        }
    }, [isMobile, routedGitMember, state.selectedGitCommitHash, state.selectedGitFilePath]);
    // The group's selected chat owns the panel's chat-scoped tabs. `RepoChatTab`
    // below runs against the group workspace id, so that is the key its
    // selection is filed under; the per-repo entry only, never the global
    // fallback, so another workspace's chat cannot claim these tabs.
    // `useQueueOptional` because this read is cosmetic to the group view: with
    // no provider (a focused test host) the panel simply has no chat scope.
    const panelChatId = useQueueOptional()?.state.selectedTaskIdByRepo[selectionId] ?? null;
    const openSearchMatch = useCallback((match: ContentSearchOverlayMatch, signal: AbortSignal) => {
        if (!dockAvailable) {
            return Promise.resolve({
                opened: false as const,
                error: 'The file panel is unavailable in this view.',
            });
        }
        return openContentSearchMatch({
            panelWorkspaceId: workspaceId,
            scope: 'group',
            chatId: panelChatId,
            groupBaseUrl,
            signal,
            match,
        });
    }, [dockAvailable, groupBaseUrl, panelChatId, workspaceId]);
    // See RepoDetail: publishes the panel to chat entry points below, scoped to
    // the group id (the panel's store key) and the chat it is showing.
    const unifiedPanelHost = useMemo(
        () => (dockAvailable ? { workspaceId, chatId: panelChatId } : null),
        [dockAvailable, workspaceId, panelChatId],
    );

    return (
        <UnifiedPanelHostProvider host={unifiedPanelHost}>
        <div className="flex flex-col h-full" data-testid="repo-group-view" data-workspace={workspaceId}>
            {isMobile
                ? <VirtualWorkspaceMobileTabBar
                    config={headerConfig}
                    pinnedTabs={['chats', 'notes', 'settings']}
                />
                : !headerInTopBar && <VirtualWorkspaceInlineHeader config={headerConfig} />}

            {/* Tab content + the right dock as the outermost-right, full-height
                column — mirrors RepoDetail's workspace content row. */}
            <div className="flex flex-row flex-1 min-h-0 min-w-0 overflow-hidden">
                <div className="flex-1 min-h-0 min-w-0 overflow-hidden" style={dockExpanded ? { display: 'none' } : undefined} data-testid="repo-group-content">
                    <div style={{ display: activeTab === 'chats' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                            <SplitWorkspacePanel
                                workspaceId={workspaceId}
                                mobileChatBackLabel={aggregatedChats ? 'Back to group chats' : undefined}
                                onMobileChatBack={aggregatedChats ? memberChat.backToGroupChats : undefined}
                                footer={headerInTopBar ? <StatusActions variant="sidebar" /> : undefined}
                                onNewChat={handleSplitNewChat}
                                railShortcuts={<>
                                    <div ref={setSplitRailShortcutNode} className="contents" />
                                    {unresolvedAggregateOwner && <RefreshSidebarButton busy={unavailableRefreshing} onRefresh={refreshUnavailableGroup} />}
                                </>}
                                runningCount={aggregatedChats && chatFeed.model ? chatFeed.model.counts.running : queueRunningCount}
                                queuedCount={aggregatedChats && chatFeed.model ? chatFeed.model.counts.queued : queueQueuedCount}
                                jobPreview={{
                                    ...queueJobs,
                                    scopeLabel: `${resolveRepoGroupDisplayName(selectionId, state.workspaces, remoteGroups)} / Group queue`,
                                    routeId: selectionId,
                                    scopeKey: `${selectionId}:${workspaceReadSource(queueClient)}:${activeTab}`,
                                }}
                                railGit={splitGitAvailable ? (
                                    <GroupRailGitView
                                        key={`${selectionId}:${workspaceReadSource(queueClient)}`}
                                        selectionId={selectionId}
                                        routingRef={selectionId}
                                        client={queueClient}
                                        members={members}
                                        status={railGitStatus}
                                        scopeLabel={`${resolveRepoGroupDisplayName(selectionId, state.workspaces, remoteGroups)} / Group`}
                                    />
                                ) : undefined}
                                chatHeaderExtra={
                                    <button
                                        disabled={aggregatedChats && !groupOwnerAvailable}
                                        type="button"
                                        className="rounded px-1.5 text-[10px] font-medium hover:bg-[#d7deec] dark:hover:bg-[#353a46]"
                                        onClick={handleSplitNewChat}
                                        data-testid="repo-group-split-new-chat"
                                    >
                                        + New Chat
                                    </button>
                                }
                                chatList={
                                    unresolvedAggregateOwner
                                    ? <RepoGroupChatList feed={chatFeed} serverLabel={chatServerLabel}
                                        selectedKey={memberChat.selectedKey} onSelect={memberChat.selectMember}
                                        filters={chatFilters} onFiltersChange={setChatFilters} />
                                    : <WorkspaceOwnerContext.Provider value={groupOwner}>
                                    <RepoChatTab
                                        workspaceId={workspaceId}
                                        sourceSelectionId={selectionId}
                                        sidebarOwnerAvailable={groupOwnerAvailable}
                                        layout="split-workspace"
                                        detailContainer={splitDetailNode}
                                        railShortcutContainer={splitRailShortcutNode}
                                        railScopeLabel={`${resolveRepoGroupDisplayName(selectionId, state.workspaces, remoteGroups)} / Group`}
                                        detailActive={dockAvailable || splitLastClicked === 'chat' || !splitGitAvailable}
                                        onActivateDetail={() => setSplitLastClicked('chat')}
                                        renderList={aggregatedChats ? renderAggregatedList : undefined}
                                        refreshList={aggregatedChats ? chatFeed.refresh : undefined}
                                        refreshGit={refreshSidebarGit}
                                        detailOverride={memberChat.selection ? (
                                            <RepoGroupMemberChatDetail
                                                selection={memberChat.selection}
                                                row={memberRow}
                                                serverLabel={chatServerLabel}
                                                groupBaseUrl={groupBaseUrl}
                                                rootPath={members?.find(member => member.workspaceId === memberChat.selection?.ownerWorkspaceId)?.rootPath}
                                                unavailable={!groupOwnerAvailable || chatFeed.status === 'error' || chatFeed.model?.sources.find(source =>
                                                    source.workspaceId === memberChat.selection?.ownerWorkspaceId)?.available === false}
                                                stale={chatFeed.model?.sources.find(source => source.workspaceId === memberChat.selection?.ownerWorkspaceId)?.stale}
                                                noLongerInGroup={!!chatFeed.model && !chatFeed.model.sources.some(source =>
                                                    source.workspaceId === memberChat.selection?.ownerWorkspaceId)}
                                                onBack={memberChat.backToGroupChats}
                                            />
                                        ) : aggregatedChats && !groupOwnerAvailable
                                            ? <div role="status">The owning server is unavailable.</div> : undefined}
                                    />
                                    </WorkspaceOwnerContext.Provider>
                                }
                                gitList={splitGitAvailable ? (
                                    <RepoGroupGitTab
                                        workspaceId={workspaceId}
                                        selectionId={selectionId}
                                        members={members}
                                        layout="split-workspace"
                                        detailContainer={splitDetailNode}
                                        detailActive={splitLastClicked === 'git'}
                                        onActivateDetail={() => setSplitLastClicked('git')}
                                        rightPanel={dockAvailable ? { chatId: panelChatId, ownerRoutingRef: groupRoutingRef } : undefined}
                                        headerToolbarContainer={splitGitHeaderNode}
                                        active={activeTab === 'chats'}
                                    />
                                ) : null}
                                gitHeaderExtra={
                                    <div
                                        ref={setSplitGitHeaderNode}
                                        className="flex min-w-0 flex-1 items-center"
                                        data-testid="split-workspace-git-header-toolbar"
                                    />
                                }
                                detail={
                                    <div
                                        ref={setSplitDetailNode}
                                        className="flex flex-col flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden"
                                        data-testid="split-workspace-detail-host"
                                    />
                                }
                            />
                    </div>
                    <div style={{ display: activeTab === 'notes' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        <NotesView
                            workspaceId={workspaceId}
                            initialNotePath={state.selectedNotePath}
                            defaultScope="per-note"
                            active={activeTab === 'notes'}
                            dockStatusFooter
                        />
                    </div>
                    <div style={{ display: activeTab === 'settings' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        <RepoGroupSettingsTab
                            workspaceId={workspaceId}
                            selectionId={selectionId}
                            baseUrl={groupBaseUrl}
                            active={activeTab === 'settings'}
                        />
                    </div>
                </div>
                {dockAvailable && (
                    <UnifiedRightPanel
                        workspaceId={workspaceId}
                        routingRef={groupRoutingRef}
                        chatId={panelChatId}
                        dock={dock}
                        targets={dockTargets}
                        repoGroup={{
                            id: workspaceId,
                            name: groupName,
                            liveRepoCount: members?.filter(member => !member.stale).length ?? 0,
                            baseUrl: groupBaseUrl,
                        }}
                    />
                )}
            </div>

            {/* Ctrl/Cmd+Shift+F — one query across the group's live members. */}
            <ContentSearchOverlayHost
                workspaceId={workspaceId}
                routingRef={groupRoutingRef}
                baseUrl={groupBaseUrl}
                onOpenMatch={openSearchMatch}
            />
        </div>
        </UnifiedPanelHostProvider>
    );
}
