/**
 * RepoGroupView — landing page for a repo-group virtual workspace (`group-<slug>`).
 *
 * A repo group is a virtual workspace (own root under `~/.coc/repos/<groupId>/`,
 * no git) that knows about a set of registered repo workspaces; chats started
 * here get the member repos injected server-side. The view therefore shows only
 * the Workspace (chat) tab and the Notes tab — every git-dependent tab (PRs,
 * Work Items, branches, …) is hidden, same treatment as My Work / My Life.
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
import { getRepoGroup, type RepoGroupMember } from './repoGroupService';
import { RepoGroupMemberList } from './RepoGroupMemberList';
import { WorkspaceRightDock, useWorkspaceDock, type DockTarget } from '../features/repo-detail/WorkspaceRightDock';
import { VirtualWorkspaceInlineHeader } from '../features/remote-shell/VirtualWorkspaceInlineHeader';
import type { VirtualWorkspaceHeaderConfig } from '../features/remote-shell/virtualWorkspaceHeader';

/** The only tabs a repo group exposes: chat ("Workspace") and Notes. */
const REPO_GROUP_TABS: VirtualWorkspaceHeaderConfig['tabs'] = [
    { key: 'chats', label: 'Workspace', shortcut: 'Alt+W' },
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
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

/**
 * Fetch the group's members. Returns `undefined` while the request is in flight
 * or when it fails — the dock reads that as "no picker" (better than flashing an
 * empty one, and it degrades to a scope-only dock rather than an error state)
 * and the member strip reads it as "still loading".
 *
 * `enabled` is the union of the two consumers: the dock and an OPEN member
 * strip. A group whose strip is collapsed on a shell without the dock therefore
 * makes no request at all.
 */
function useRepoGroupMembers(workspaceId: string, baseUrl: string | undefined, enabled: boolean): RepoGroupMember[] | undefined {
    const [members, setMembers] = useState<RepoGroupMember[] | undefined>(undefined);
    useEffect(() => {
        if (!enabled) {
            setMembers(undefined);
            return;
        }
        let cancelled = false;
        setMembers(undefined);
        getRepoGroup(workspaceId, baseUrl)
            .then(group => {
                if (!cancelled) setMembers(group.members ?? []);
            })
            .catch(() => {
                if (!cancelled) setMembers(undefined);
            });
        return () => { cancelled = true; };
    }, [workspaceId, baseUrl, enabled]);
    return members;
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
    // Member repos + their descriptions: one read shared with the dock picker,
    // made only once either surface actually needs it.
    const [membersOpen, setMembersOpen] = useState(false);
    const members = useRepoGroupMembers(workspaceId, groupBaseUrl, dockAvailable || membersOpen);
    const dockTargets = useMemo(
        () => (dockAvailable && members ? repoGroupDockTargets(workspaceId, members) : undefined),
        [dockAvailable, members, workspaceId]
    );
    const dock = useWorkspaceDock(workspaceId, dockTargets);

    // Landing tab when the current sub-tab is not one of the group's tabs (e.g.
    // arriving from a repo's Git tab). Mirrors useVirtualWorkspaceHeader so the
    // highlighted header tab and the content pane always agree.
    const activeTab = REPO_GROUP_TABS.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : 'chats';

    return (
        <div className="flex flex-col h-full" data-testid="repo-group-view" data-workspace={workspaceId}>
            {!headerInTopBar && <VirtualWorkspaceInlineHeader config={headerConfig} />}

            {/* Member repos — collapsed by default so the chat keeps the height,
                but one click from the landing page since a description edit is a
                rare, deliberate action. */}
            <div className="shrink-0 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <button
                    type="button"
                    data-testid="repo-group-members-toggle"
                    aria-expanded={membersOpen}
                    onClick={() => setMembersOpen(open => !open)}
                    className="w-full flex items-center gap-1.5 px-3 py-1 text-xs text-[#616161] dark:text-[#999] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a]"
                >
                    <span>{membersOpen ? '▾' : '▸'}</span>
                    <span className="font-medium">Member repos</span>
                    {members && <span className="text-[#848484]">({members.length})</span>}
                </button>
                {membersOpen && (
                    <div className="max-h-52 overflow-y-auto" data-testid="repo-group-members-panel">
                        {members
                            ? <RepoGroupMemberList workspaceId={workspaceId} baseUrl={groupBaseUrl} members={members} />
                            : <div className="text-xs text-[#848484] px-3 py-2">Loading…</div>}
                    </div>
                )}
            </div>

            {/* Tab content + the right dock as the outermost-right, full-height
                column — mirrors RepoDetail's workspace content row. */}
            <div className="flex flex-row flex-1 min-h-0 min-w-0 overflow-hidden">
                <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                    <div style={{ display: activeTab === 'chats' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        <RepoChatTab workspaceId={workspaceId} dockStatusFooter />
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
                </div>
                {dockAvailable && <WorkspaceRightDock workspaceId={workspaceId} dock={dock} targets={dockTargets} />}
            </div>
        </div>
    );
}
