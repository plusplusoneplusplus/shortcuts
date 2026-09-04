/**
 * RepoGroupView — landing page for a repo-group virtual workspace (`group-<slug>`).
 *
 * A repo group is a virtual workspace (own root under `~/.coc/repos/<groupId>/`,
 * no git) that knows about a set of registered repo workspaces; chats started
 * here get the member repos injected server-side. The view shows the Workspace
 * (chat), Git, Notes and Settings tabs — the other git-dependent tabs (PRs,
 * Work Items, branches, …) stay hidden, same treatment as My Work / My Life.
 *
 * The Git tab is a host, not a group-wide git view: it picks ONE member repo and
 * renders the ordinary single-repo panel against it (`RepoGroupGitTab`). The
 * group's own root is never treated as a git repo.
 *
 * In the remote-first desktop shell the header (identity + sub-tabs) lives in
 * the global TopBar (`VirtualWorkspaceShellHeader`); in the classic shell and on
 * mobile it renders here as `VirtualWorkspaceInlineHeader`.
 *
 * On desktop (behind `splitWorkspacePanel`) the group also gets the workspace
 * right dock. The dock's own state scopes to the group, while its Terminal and
 * Explorer point at a target picked in the dock header: the group root, or any
 * live member repo. Notes stays on the group. Members come from
 * `GET /api/repo-groups/:id`; stale ones are listed but not selectable.
 *
 * Member descriptions are edited on the Settings tab (`RepoGroupSettingsTab`),
 * not here — the Workspace tab is the chat and nothing else.
 */

import { useEffect, useMemo, useState } from 'react';
import { NotesView } from '../features/notes/NotesView';
import { RepoChatTab } from '../features/chat/RepoChatTab';
import { useRemoteShellEnabled } from '../hooks/feature-flags/useRemoteShellEnabled';
import { useSplitWorkspacePanelEnabled } from '../hooks/feature-flags/useSplitWorkspacePanelEnabled';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useApp } from '../contexts/AppContext';
import { useReposOptional } from '../contexts/ReposContext';
import { resolveRepoGroupName } from './repoGroupName';
import type { RepoGroupMember } from './repoGroupService';
import { RepoGroupGitTab } from './RepoGroupGitTab';
import { RepoGroupSettingsTab } from './RepoGroupSettingsTab';
import { useRepoGroupMembers } from './useRepoGroupMembers';
import { WorkspaceRightDock, useWorkspaceDock, type DockTarget } from '../features/repo-detail/WorkspaceRightDock';
import { VirtualWorkspaceInlineHeader } from '../features/remote-shell/VirtualWorkspaceInlineHeader';
import type { VirtualWorkspaceHeaderConfig } from '../features/remote-shell/virtualWorkspaceHeader';

/**
 * The only tabs a repo group exposes: chat ("Workspace"), Notes, and Settings.
 * Settings reuses a real repo's Alt+C — a group is never on screen at the same
 * time as a repo, so the shortcut cannot collide.
 */
const REPO_GROUP_TABS: VirtualWorkspaceHeaderConfig['tabs'] = [
    { key: 'chats', label: 'Workspace', shortcut: 'Alt+W' },
    { key: 'git', label: 'Git', shortcut: 'Alt+G' },
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
    { key: 'settings', label: 'Settings', shortcut: 'Alt+C' },
];

/**
 * Header identity + tabs for a repo-group virtual workspace, shared by the
 * TopBar (`VirtualWorkspaceShellHeader`) and in-body (`VirtualWorkspaceInlineHeader`)
 * header variants. Unlike My Work / My Life the config is per-group (id + name),
 * so it is built on demand rather than being a module constant.
 */
export function getRepoGroupHeaderConfig(workspaceId: string, label: string): VirtualWorkspaceHeaderConfig {
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
            disabled: member.stale || undefined,
        })),
    ];
}

export interface RepoGroupViewProps {
    /** The `group-<slug>` workspace id currently selected. */
    workspaceId: string;
}

export function RepoGroupView({ workspaceId }: RepoGroupViewProps) {
    const { state } = useApp();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const remoteShell = useRemoteShellEnabled();
    // In the remote-first desktop shell the header lives in the global TopBar
    // (`VirtualWorkspaceShellHeader`); render the in-body header everywhere else.
    const headerInTopBar = remoteShell && !isMobile;

    // Group name comes from the registered workspace — the local list for a local
    // group, the aggregated remote groups for one that lives on a remote server.
    // The id is a readable fallback while those lists are still loading.
    const remoteGroups = useReposOptional()?.remoteGroupWorkspaces;
    const groupName = useMemo(
        () => resolveRepoGroupName(workspaceId, state.workspaces, remoteGroups),
        [state.workspaces, remoteGroups, workspaceId]
    );
    const headerConfig = useMemo(() => getRepoGroupHeaderConfig(workspaceId, groupName), [workspaceId, groupName]);

    // Landing tab when the current sub-tab is not one of the group's tabs (e.g.
    // arriving from a repo's Git tab). Mirrors useVirtualWorkspaceHeader so the
    // highlighted header tab and the content pane always agree.
    const activeTab = REPO_GROUP_TABS.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : 'chats';

    // Keep the git panel mounted once visited (same trick as RepoDetail's
    // `wasVisited`), so switching tabs does not throw away its loaded history.
    const [gitVisited, setGitVisited] = useState(false);
    useEffect(() => { if (activeTab === 'git') setGitVisited(true); }, [activeTab]);

    // Right dock (Terminal / Explorer / Notes) — same gate as RepoDetail. Its
    // state scopes to the GROUP, so switching member repos never closes or
    // resizes it; only the terminal/explorer content follows the picker. The
    // group detail read goes to whichever server owns the group — local for a
    // local group, the remote's baseUrl for one aggregated from a remote server.
    const dockAvailable = useSplitWorkspacePanelEnabled() && !isMobile;
    const groupBaseUrl = useMemo(() => {
        const match = (remoteGroups ?? []).find(ws => String(ws?.id ?? '') === workspaceId);
        const url = (match as { baseUrl?: unknown } | undefined)?.baseUrl;
        return typeof url === 'string' && url.length > 0 ? url : undefined;
    }, [remoteGroups, workspaceId]);
    // Member repos, for the dock's target picker and the Git tab's host. The
    // Settings tab does its own read — it needs the descriptions too, and only
    // while it is the visible tab.
    const membersNeeded = dockAvailable || gitVisited;
    const members = useRepoGroupMembers(workspaceId, groupBaseUrl, membersNeeded);
    const dockTargets = useMemo(
        () => (dockAvailable && members ? repoGroupDockTargets(workspaceId, members) : undefined),
        [dockAvailable, members, workspaceId]
    );
    const dock = useWorkspaceDock(workspaceId, dockTargets);

    return (
        <div className="flex flex-col h-full" data-testid="repo-group-view" data-workspace={workspaceId}>
            {!headerInTopBar && <VirtualWorkspaceInlineHeader config={headerConfig} />}

            {/* Tab content + the right dock as the outermost-right, full-height
                column — mirrors RepoDetail's workspace content row. */}
            <div className="flex flex-row flex-1 min-h-0 min-w-0 overflow-hidden">
                <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                    <div style={{ display: activeTab === 'chats' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        <RepoChatTab workspaceId={workspaceId} dockStatusFooter />
                    </div>
                    <div style={{ display: activeTab === 'git' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        {gitVisited && <RepoGroupGitTab workspaceId={workspaceId} members={members} />}
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
                            baseUrl={groupBaseUrl}
                            active={activeTab === 'settings'}
                        />
                    </div>
                </div>
                {dockAvailable && <WorkspaceRightDock workspaceId={workspaceId} dock={dock} targets={dockTargets} />}
            </div>
        </div>
    );
}
