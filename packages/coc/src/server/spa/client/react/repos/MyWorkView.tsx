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
import { MyWorkTodayTab } from '../features/my-work/MyWorkTodayTab';
import { useSchedulesInScheduledSlideEnabled } from '../hooks/feature-flags/useSchedulesInScheduledSlideEnabled';
import { useMyWorkTodayViewEnabled } from '../hooks/feature-flags/useMyWorkTodayViewEnabled';
import { useRemoteShellEnabled } from '../hooks/feature-flags/useRemoteShellEnabled';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useApp } from '../contexts/AppContext';
import type { RepoData } from './repoGrouping';
import { generateMyWorkSummary, syncMyWork } from './repositoryService';
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

/** Today tab, prepended (as the default landing tab) only when the
 *  `myWork.todayView` flag is on. Kept off `MY_WORK_TABS` so the flag-off shape
 *  is byte-for-byte today's behavior. */
const MY_WORK_TODAY_TAB: VirtualWorkspaceHeaderConfig['tabs'][number] = { key: 'today', label: 'Today', shortcut: 'Alt+T' };

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

/**
 * The My Work header config, gated by the `myWork.todayView` flag. When on, a
 * Today tab is prepended and becomes the default landing tab; when off the
 * config is `MY_WORK_HEADER_CONFIG` unchanged (Notes stays the landing tab).
 * Shared by the in-body header here and the remote-shell TopBar so both agree.
 */
export function getMyWorkHeaderConfig(todayViewEnabled: boolean): VirtualWorkspaceHeaderConfig {
    if (!todayViewEnabled) return MY_WORK_HEADER_CONFIG;
    return {
        ...MY_WORK_HEADER_CONFIG,
        tabs: [MY_WORK_TODAY_TAB, ...MY_WORK_TABS],
        defaultTab: 'today',
    };
}

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
    // Today view (default-off flag): prepends a Today tab that becomes the
    // landing tab. Off → tabs + default are byte-for-byte today's behavior.
    const todayViewEnabled = useMyWorkTodayViewEnabled();
    const headerConfig = useMemo(() => getMyWorkHeaderConfig(todayViewEnabled), [todayViewEnabled]);
    const visibleTabs = useMemo(
        () => (schedulesInScheduledSlideEnabled ? headerConfig.tabs.filter(t => t.key !== 'schedules') : headerConfig.tabs),
        [schedulesInScheduledSlideEnabled, headerConfig.tabs],
    );

    // Landing tab when the current sub-tab is not one of the visible My Work
    // tabs. Mirrors useVirtualWorkspaceHeader so the highlighted header tab and
    // the content pane always agree.
    const fallbackTab = headerConfig.defaultTab && visibleTabs.some(t => t.key === headerConfig.defaultTab)
        ? headerConfig.defaultTab
        : 'notes';
    const activeTab = visibleTabs.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : fallbackTab;

    return (
        <div className="flex flex-col h-full" data-testid="my-work-view">
            {!headerInTopBar && <VirtualWorkspaceInlineHeader config={headerConfig} />}

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {todayViewEnabled && (
                    <div style={{ display: activeTab === 'today' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        <MyWorkTodayTab workspaceId={MY_WORK_WORKSPACE_ID} active={activeTab === 'today'} />
                    </div>
                )}
                <div style={{ display: activeTab === 'activity' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <RepoChatTab workspaceId={MY_WORK_WORKSPACE_ID} />
                </div>
                <div style={{ display: activeTab === 'notes' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <NotesView
                        workspaceId={MY_WORK_WORKSPACE_ID}
                        initialNotePath={state.selectedNotePath}
                        defaultScope="per-note"
                        active={activeTab === 'notes'}
                        dockStatusFooter
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
                {activeTab === 'settings' && <RepoSettingsTab workspaceId={MY_WORK_WORKSPACE_ID} repo={VIRTUAL_REPO} dockStatusFooter />}
            </div>
        </div>
    );
}
