/**
 * MyLifeView — landing page for the "My Life" virtual workspace.
 *
 * Activity reuses RepoChatTab; Notes reuses NotesView. In the remote-first
 * desktop shell the header (identity + sub-tabs + Sync/Generate actions) lives in
 * the global TopBar (`VirtualWorkspaceShellHeader`); in the classic shell and on
 * mobile it renders here as `VirtualWorkspaceInlineHeader`.
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
import { generateMyLifeSummary, syncMyLife } from './repositoryService';
import { VirtualWorkspaceInlineHeader } from '../features/remote-shell/VirtualWorkspaceInlineHeader';
import type { VirtualWorkspaceHeaderConfig } from '../features/remote-shell/virtualWorkspaceHeader';
import { MY_LIFE_WORKSPACE_ID } from './virtualWorkspaceIds';

export { MY_LIFE_WORKSPACE_ID };

const MY_LIFE_TABS: VirtualWorkspaceHeaderConfig['tabs'] = [
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
    { key: 'activity', label: 'Activity', shortcut: 'Alt+A' },
    { key: 'git', label: 'Git', shortcut: 'Alt+G' },
    { key: 'schedules', label: 'Schedules', shortcut: 'Alt+S' },
    { key: 'settings', label: 'Settings', shortcut: 'Alt+C' },
];

/** Header identity + tabs + actions for the My Life virtual workspace, shared by
 *  the TopBar (`VirtualWorkspaceShellHeader`) and in-body (`VirtualWorkspaceInlineHeader`)
 *  header variants. */
export const MY_LIFE_HEADER_CONFIG: VirtualWorkspaceHeaderConfig = {
    workspaceId: MY_LIFE_WORKSPACE_ID,
    icon: '🏠',
    label: 'My Life',
    testIdPrefix: 'my-life',
    tabs: MY_LIFE_TABS,
    actions: [
        {
            key: 'sync',
            testId: 'my-life-sync-btn',
            title: 'Sync personal goals and journal entries',
            idleLabel: '🔄 Sync',
            busyLabel: '⏳ Syncing…',
            errorLabel: 'Sync failed',
            run: async () => {
                const result = await syncMyLife();
                const count = (result.goalCount ?? 0) + (result.entryCount ?? 0);
                return count > 0 ? `Synced ${count} items` : 'No new items';
            },
        },
        {
            key: 'generate',
            testId: 'my-life-generate-btn',
            title: 'Generate a weekly summary from your personal notes',
            idleLabel: '📝 Generate Summary',
            busyLabel: '⏳ Generating…',
            errorLabel: 'Generation failed',
            run: async () => {
                const result = await generateMyLifeSummary();
                if (result.path) {
                    location.hash = `#repos/${MY_LIFE_WORKSPACE_ID}/notes/${encodeURIComponent(result.path)}`;
                    return `Summary saved to ${result.path}`;
                }
                return null;
            },
        },
    ],
};

const VIRTUAL_REPO: RepoData = {
    workspace: { id: MY_LIFE_WORKSPACE_ID, rootPath: '', color: undefined, description: undefined, remoteUrl: undefined },
};

export function MyLifeView() {
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
        () => schedulesInScheduledSlideEnabled ? MY_LIFE_TABS.filter(t => t.key !== 'schedules') : MY_LIFE_TABS,
        [schedulesInScheduledSlideEnabled],
    );

    // Default to 'notes' when the current sub-tab is not one of the visible My Life tabs
    const activeTab = visibleTabs.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : 'notes';

    return (
        <div className="flex flex-col h-full" data-testid="my-life-view">
            {!headerInTopBar && <VirtualWorkspaceInlineHeader config={MY_LIFE_HEADER_CONFIG} />}

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <div style={{ display: activeTab === 'activity' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <RepoChatTab workspaceId={MY_LIFE_WORKSPACE_ID} />
                </div>
                <div style={{ display: activeTab === 'notes' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <NotesView
                        workspaceId={MY_LIFE_WORKSPACE_ID}
                        initialNotePath={state.selectedNotePath}
                        active={activeTab === 'notes'}
                        dockStatusFooter
                    />
                </div>
                <div style={{ display: activeTab === 'git' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <NotesGitTab workspaceId={MY_LIFE_WORKSPACE_ID} />
                </div>
                {!schedulesInScheduledSlideEnabled && (
                    <div style={{ display: activeTab === 'schedules' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        <RepoSchedulesTab workspaceId={MY_LIFE_WORKSPACE_ID} />
                    </div>
                )}
                {activeTab === 'settings' && <RepoSettingsTab workspaceId={MY_LIFE_WORKSPACE_ID} repo={VIRTUAL_REPO} dockStatusFooter />}
            </div>
        </div>
    );
}
