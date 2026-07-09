/**
 * MyWorkView — landing page for the "My Work" virtual workspace.
 *
 * Activity reuses RepoChatTab; Notes reuses NotesView. In the remote-first
 * desktop shell the header (identity + sub-tabs + Sync/Generate actions) lives in
 * the global TopBar (`VirtualWorkspaceShellHeader`); in the classic shell and on
 * mobile it renders here as `VirtualWorkspaceInlineHeader` so tab switching and
 * the actions stay reachable.
 */

import { useMemo } from 'react';
import { NotesView } from '../features/notes/NotesView';
import { RepoChatTab } from '../features/chat/RepoChatTab';
import { NotesGitTab } from '../features/notes/NotesGitTab';
import { RepoSchedulesTab } from '../features/schedules/RepoSchedulesTab';
import { RepoSettingsTab } from '../features/repo-settings/RepoSettingsTab';
import { useSchedulesInScheduledSlideEnabled } from '../hooks/feature-flags/useSchedulesInScheduledSlideEnabled';
import { useRemoteShellEnabled } from '../hooks/feature-flags/useRemoteShellEnabled';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useApp } from '../contexts/AppContext';
import type { RepoData } from './repoGrouping';
import { generateMyWorkSummary, syncMyWork } from './repositoryService';
import { DockedStatusFooter } from '../layout/DockedStatusFooter';
import { VirtualWorkspaceInlineHeader } from '../features/remote-shell/VirtualWorkspaceInlineHeader';
import type { VirtualWorkspaceHeaderConfig } from '../features/remote-shell/virtualWorkspaceHeader';

export const MY_WORK_WORKSPACE_ID = 'my_work';

const MY_WORK_TABS: VirtualWorkspaceHeaderConfig['tabs'] = [
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
    { key: 'activity', label: 'Activity', shortcut: 'Alt+A' },
    { key: 'git', label: 'Git', shortcut: 'Alt+G' },
    { key: 'schedules', label: 'Schedules', shortcut: 'Alt+S' },
    { key: 'settings', label: 'Settings', shortcut: 'Alt+C' },
];

/** Header identity + tabs + actions for the My Work virtual workspace, shared by
 *  the TopBar (`VirtualWorkspaceShellHeader`) and in-body (`VirtualWorkspaceInlineHeader`)
 *  header variants. */
export const MY_WORK_HEADER_CONFIG: VirtualWorkspaceHeaderConfig = {
    workspaceId: MY_WORK_WORKSPACE_ID,
    icon: '📋',
    label: 'My Work',
    testIdPrefix: 'my-work',
    tabs: MY_WORK_TABS,
    actions: [
        {
            key: 'sync',
            testId: 'my-work-sync-btn',
            title: 'Sync action items and follow-ups from Work IQ',
            idleLabel: '🔄 Sync Work IQ',
            busyLabel: '⏳ Syncing…',
            errorLabel: 'Sync failed',
            run: async () => {
                const result = await syncMyWork();
                const count = (result.actionItemCount ?? 0) + (result.followUpCount ?? 0);
                return count > 0 ? `Synced ${count} items` : 'No new items';
            },
        },
        {
            key: 'generate',
            testId: 'my-work-generate-btn',
            title: 'Generate a weekly summary from your notes and cross-repo activity',
            idleLabel: '📝 Generate Summary',
            busyLabel: '⏳ Generating…',
            errorLabel: 'Generation failed',
            run: async () => {
                const result = await generateMyWorkSummary();
                if (result.path) {
                    location.hash = `#repos/${MY_WORK_WORKSPACE_ID}/notes/${encodeURIComponent(result.path)}`;
                    return `Summary saved to ${result.path}`;
                }
                return null;
            },
        },
    ],
};

const VIRTUAL_REPO: RepoData = {
    workspace: { id: MY_WORK_WORKSPACE_ID, rootPath: '', color: undefined, description: undefined, remoteUrl: undefined },
};

export function MyWorkView() {
    const { state } = useApp();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const remoteShell = useRemoteShellEnabled();
    // In the remote-first desktop shell the header lives in the global TopBar
    // (`VirtualWorkspaceShellHeader`); render the in-body header everywhere else.
    const headerInTopBar = remoteShell && !isMobile;

    // Hide the standalone Schedules tab when schedule management has moved into
    // the chat-list "Scheduled" slide (feature flag). The Activity tab reuses
    // RepoChatTab, which hosts that slide, so nothing is stranded.
    const schedulesInScheduledSlideEnabled = useSchedulesInScheduledSlideEnabled();
    const visibleTabs = useMemo(
        () => schedulesInScheduledSlideEnabled ? MY_WORK_TABS.filter(t => t.key !== 'schedules') : MY_WORK_TABS,
        [schedulesInScheduledSlideEnabled],
    );

    // Default to 'notes' when the current sub-tab is not one of the visible My Work tabs
    const activeTab = visibleTabs.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : 'notes';

    return (
        <div className="flex flex-col h-full" data-testid="my-work-view">
            {!headerInTopBar && <VirtualWorkspaceInlineHeader config={MY_WORK_HEADER_CONFIG} />}

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <div style={{ display: activeTab === 'activity' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <RepoChatTab workspaceId={MY_WORK_WORKSPACE_ID} />
                </div>
                <div style={{ display: activeTab === 'notes' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <NotesView
                        workspaceId={MY_WORK_WORKSPACE_ID}
                        initialNotePath={state.selectedNotePath}
                        defaultScope="per-workspace"
                        active={activeTab === 'notes'}
                    />
                </div>
                <div style={{ display: activeTab === 'git' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <NotesGitTab workspaceId={MY_WORK_WORKSPACE_ID} />
                </div>
                {!schedulesInScheduledSlideEnabled && (
                    <div style={{ display: activeTab === 'schedules' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        <RepoSchedulesTab workspaceId={MY_WORK_WORKSPACE_ID} />
                    </div>
                )}
                {activeTab === 'settings' && <RepoSettingsTab workspaceId={MY_WORK_WORKSPACE_ID} repo={VIRTUAL_REPO} />}
            </div>

            {/* Remote-first shell: dock the status/action cluster at the bottom
                of the My Work body so it lives in this view's own chrome instead
                of the app-wide bottom band. No-ops in classic / mobile, where the
                topbar keeps the cluster. */}
            <DockedStatusFooter />
        </div>
    );
}
