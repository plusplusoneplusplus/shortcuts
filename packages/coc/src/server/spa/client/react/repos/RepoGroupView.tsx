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
 */

import { useMemo } from 'react';
import { NotesView } from '../features/notes/NotesView';
import { RepoChatTab } from '../features/chat/RepoChatTab';
import { useRemoteShellEnabled } from '../hooks/feature-flags/useRemoteShellEnabled';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useApp } from '../contexts/AppContext';
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

    // Group name comes from the registered workspace; the id is a readable
    // fallback while the workspace list is still loading.
    const groupName = useMemo(() => {
        const ws = (state.workspaces ?? []).find((w: any) => String(w?.id) === workspaceId);
        return String(ws?.name ?? workspaceId);
    }, [state.workspaces, workspaceId]);
    const headerConfig = useMemo(() => getRepoGroupHeaderConfig(workspaceId, groupName), [workspaceId, groupName]);

    // Landing tab when the current sub-tab is not one of the group's tabs (e.g.
    // arriving from a repo's Git tab). Mirrors useVirtualWorkspaceHeader so the
    // highlighted header tab and the content pane always agree.
    const activeTab = REPO_GROUP_TABS.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : 'chats';

    return (
        <div className="flex flex-col h-full" data-testid="repo-group-view" data-workspace={workspaceId}>
            {!headerInTopBar && <VirtualWorkspaceInlineHeader config={headerConfig} />}

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <div style={{ display: activeTab === 'chats' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <RepoChatTab workspaceId={workspaceId} />
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
        </div>
    );
}
