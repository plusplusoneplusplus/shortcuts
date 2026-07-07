/**
 * TopBar — top navigation bar with tab switching and the status/action cluster.
 *
 * Right-side layout (the cluster itself lives in `StatusActions`):
 *   [+ New?] [Connected pill] [NotificationBell] [Quota] [Admin] [Theme]
 *
 * In the remote-first shell (desktop), the cluster moves to a global bottom
 * status bar spanning every tab (see `GlobalStatusDock` → `StatusActions`
 * variant="sidebar", mounted by the App shell), so it is hidden here whenever
 * that dock is on screen (`statusInDock`).
 *
 * The Skills / Logs / Usage / Models / Servers nav targets now live in
 * the Admin page's left-panel "Tools" group — see `AdminPanel.tsx`. They
 * are no longer rendered as a topbar dropdown.
 */

import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useQueue } from '../contexts/QueueContext';
import { useRepos } from '../contexts/ReposContext';
import { buildNoteHash } from './Router';
import { StatusActions } from './StatusActions';
import { RepoTabStrip } from '../features/repo-detail/RepoTabStrip';
import { RemoteShellHeader } from '../features/remote-shell/RemoteShellHeader';
import { useRemoteShellEnabled } from '../hooks/feature-flags/useRemoteShellEnabled';
import { MY_WORK_WORKSPACE_ID } from '../repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../repos/MyLifeView';
import { useMyWorkEnabled } from '../hooks/feature-flags/useMyWorkEnabled';
import { useMyLifeEnabled } from '../hooks/feature-flags/useMyLifeEnabled';
import { RepoManagementPopover } from '../repos/RepoManagementPopover';
import { findRepoBySelectionId } from '../repos/cloneIdentity';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { getHostname } from '../utils/config';
import { SHOW_WIKI_TAB, SHOW_MEMORY_TAB } from '../navFlags';
import type { DashboardTab } from '../types/dashboard';
import { useWorkspaceNavigation } from '../hooks/useWorkspaceNavigation';

// Nav flags live in navFlags.ts; re-exported here for modules that import them
// from TopBar (BottomNav, Router).
export { SHOW_WIKI_TAB, SHOW_MEMORY_TAB };

export const ALL_TABS: { label: string; tab: DashboardTab }[] = [
    { label: 'Wiki', tab: 'wiki' },
];

export const TABS: { label: string; tab: DashboardTab }[] = SHOW_WIKI_TAB
    ? ALL_TABS
    : ALL_TABS.filter(t => t.tab !== 'wiki');

export interface TopBarProps {
    onAdminOpen?: () => void;
}

export function TopBar({ onAdminOpen }: TopBarProps = {}) {
    const { state, dispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const { repos, unseenCounts, fetchRepos } = useRepos();
    const { navigateToWorkspace } = useWorkspaceNavigation();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const remoteShell = useRemoteShellEnabled();
    const [popoverOpen, setPopoverOpen] = useState(false);
    const hostname = getHostname();
    const brandLabel = hostname ? `CoC @ ${hostname}` : 'CoC';
    const brandTooltip = hostname ? `Copilot of Copilot @ ${hostname}` : 'Copilot of Copilot';
    const myWorkEnabled = useMyWorkEnabled();
    const myLifeEnabled = useMyLifeEnabled();
    // On macOS desktop the native title bar is replaced by hiddenInset traffic lights
    // that overlay the left edge of this header. Reserve space so they don't cover
    // the hamburger button. Falls back to navigator.platform for builds where the
    // preload hasn't yet exposed cocDesktop.platform.
    const isMacDesktop =
        typeof window !== 'undefined' &&
        (window as { cocDesktop?: { isDesktop?: boolean; platform?: string } }).cocDesktop?.isDesktop === true &&
        (
            (window as { cocDesktop?: { platform?: string } }).cocDesktop?.platform === 'darwin' ||
            /Mac/.test(navigator.platform)
        );

    const switchTab= useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        location.hash = '#' + tab;
    }, [dispatch]);

    const goToRepos = useCallback(() => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        location.hash = '#repos';
    }, [dispatch]);

    const goToMyWork = useCallback(() => {
        const savedPath = state.notePathState?.[MY_WORK_WORKSPACE_ID];
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id: MY_WORK_WORKSPACE_ID });
        location.hash = savedPath
            ? buildNoteHash(MY_WORK_WORKSPACE_ID, savedPath)
            : '#repos/' + MY_WORK_WORKSPACE_ID + '/notes';
    }, [dispatch, state.notePathState]);

    const goToMyLife = useCallback(() => {
        const savedPath = state.notePathState?.[MY_LIFE_WORKSPACE_ID];
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id: MY_LIFE_WORKSPACE_ID });
        location.hash = savedPath
            ? buildNoteHash(MY_LIFE_WORKSPACE_ID, savedPath)
            : '#repos/' + MY_LIFE_WORKSPACE_ID + '/notes';
    }, [dispatch, state.notePathState]);

    const toggleRepoManagement = useCallback(() => {
        if (state.activeTab !== 'repos') {
            location.hash = '#repos';
            return;
        }
        setPopoverOpen(prev => !prev);
    }, [state.activeTab]);

    const selectRepo = useCallback((id: string) => {
        navigateToWorkspace(id);
    }, [navigateToWorkspace]);

    const isOnReposTab = state.activeTab === 'repos';
    const selectedRepo = useMemo(() => {
        const scopedRepos = repos.filter(r => !state.currentAgentId || !r.workspace.agentId || r.workspace.agentId === state.currentAgentId);
        return findRepoBySelectionId(scopedRepos, state.selectedRepoId) || findRepoBySelectionId(repos, state.selectedRepoId);
    }, [repos, state.currentAgentId, state.selectedRepoId]);
    // Single-row remote header: the sole remote-repo layout when the remote
    // shell is on (desktop, repos tab, a clone selected). No selection or off
    // the repos tab → nothing renders in the remote slot.
    const showRemoteHeader = remoteShell && isOnReposTab && !!selectedRepo && !isMobile;

    // In the remote-first shell the status cluster (connection / notifications /
    // quota / admin / theme) moves to a global bottom status bar
    // (`GlobalStatusDock`) that spans every tab on desktop. Hide the topbar
    // cluster exactly when that dock is on screen so the two never both show —
    // and, on mobile / classic mode where the dock is absent, keep it here so
    // the controls never vanish. Must match GlobalStatusDock's own gate.
    const statusInDock = remoteShell && !isMobile;

    return (
        <>
        <header
            className="h-10 md:h-10 px-3 flex items-center justify-between border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-[#1e1e1e] dark:text-[#cccccc] drag-region"
            style={isMacDesktop ? { paddingLeft: '88px' } : undefined}
            data-react
            data-mac-desktop={isMacDesktop ? 'true' : undefined}
        >
            <div className="flex items-center gap-2 min-w-0 flex-1">
                <button
                    className="h-7 w-7 flex-shrink-0 rounded border border-transparent hover:border-[#c8c8c8] dark:hover:border-[#3c3c3c] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-base leading-none touch-target"
                    id="hamburger-btn"
                    aria-label={isOnReposTab ? 'Manage repositories' : 'Go to repositories'}
                    aria-pressed={isOnReposTab ? popoverOpen : false}
                    title={isOnReposTab ? 'Manage repositories' : 'Go to repositories'}
                    onClick={toggleRepoManagement}
                >
                    &#9776;
                </button>
                <a
                    href="#"
                    data-tab-mobile="repos"
                    className={`text-sm font-semibold truncate min-w-0 shrink md:hidden px-1 md:px-2 h-7 transition-colors inline-flex items-center ${isOnReposTab ? 'active border-b-2 border-[#0078d4] text-[#0078d4] dark:border-[#60b4ff] dark:text-[#60b4ff]' : 'hover:underline'}`}
                    title={brandTooltip}
                    onClick={e => { e.preventDefault(); goToRepos(); }}
                >{ brandLabel }</a>
                <a
                    href="#"
                    data-tab="repos"
                    className={`text-sm font-semibold whitespace-nowrap hidden md:inline-flex flex-shrink-0 px-2 h-7 transition-colors items-center ${isOnReposTab ? 'active border-b-2 border-[#0078d4] text-[#0078d4] dark:border-[#60b4ff] dark:text-[#60b4ff]' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'}`}
                    title={brandTooltip}
                    onClick={e => { e.preventDefault(); goToRepos(); }}
                >{ brandLabel }</a>
                {myWorkEnabled && (
                    <button
                        id="my-work-toggle"
                        className={
                            `h-7 w-7 flex-shrink-0 inline-flex items-center justify-center rounded touch-target ` +
                            (isOnReposTab && state.selectedRepoId === MY_WORK_WORKSPACE_ID
                                ? 'bg-[#0078d4] text-white'
                                : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                        }
                        aria-label="My Work"
                        title="My Work"
                        onClick={goToMyWork}
                    >
                        💼
                    </button>
                )}
                {myLifeEnabled && (
                    <button
                        id="my-life-toggle"
                        className={
                            `h-7 w-7 flex-shrink-0 inline-flex items-center justify-center rounded touch-target ` +
                            (isOnReposTab && state.selectedRepoId === MY_LIFE_WORKSPACE_ID
                                ? 'bg-[#0078d4] text-white'
                                : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                        }
                        aria-label="My Life"
                        title="My Life"
                        onClick={goToMyLife}
                    >
                        🏠
                    </button>
                )}
                {!isMobile && (remoteShell ? (
                    showRemoteHeader && selectedRepo ? (
                        <RemoteShellHeader repo={selectedRepo} repos={repos} />
                    ) : isOnReposTab ? (
                        <RepoTabStrip
                            repos={repos}
                            selectedRepoId={state.selectedRepoId}
                            onSelect={selectRepo}
                            unseenCounts={unseenCounts}
                            onRefresh={fetchRepos}
                        />
                    ) : null
                ) : (
                    <RepoTabStrip
                        repos={repos}
                        selectedRepoId={state.selectedRepoId}
                        onSelect={selectRepo}
                        unseenCounts={unseenCounts}
                        onRefresh={fetchRepos}
                    />
                ))}
                {TABS.length > 0 && (
                    <nav className="hidden md:flex items-center gap-1 min-w-0 flex-shrink-0" id="tab-bar">
                        {TABS.map(({ label, tab }) => (
                            <button
                                key={tab}
                                className={
                                    `h-7 px-3 rounded text-sm transition-colors ` +
                                    (state.activeTab === tab
                                        ? 'active border-b-2 border-[#0078d4] text-[#0078d4] dark:border-[#60b4ff] dark:text-[#60b4ff]'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                                }
                                data-tab={tab}
                                onClick={() => switchTab(tab)}
                            >
                                {label}
                            </button>
                        ))}
                    </nav>
                )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1.5" data-testid="topbar-actions">
                {showRemoteHeader && selectedRepo && (
                    <button
                        data-testid="header-new-btn"
                        title={`Queue a task on ${selectedRepo.workspace.name}`}
                        onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: String(selectedRepo.workspace.id) })}
                        className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[12px] font-semibold text-[#1f2328] dark:text-[#cccccc] hover:border-[#1f883d] dark:hover:border-[#2ea043] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a] transition-colors"
                    >
                        <span className="text-[#1f883d] dark:text-[#3fb950] text-[15px] leading-none">+</span>
                        <span>New</span>
                    </button>
                )}
                {/* Status cluster — hidden here when it lives in the global
                    bottom status bar (remote-first shell, desktop). */}
                {!statusInDock && (
                    <StatusActions variant="topbar" onAdminOpen={onAdminOpen} />
                )}
            </div>
        </header>
        {isOnReposTab && (
            <RepoManagementPopover
                open={popoverOpen}
                onClose={() => setPopoverOpen(false)}
                repos={repos}
                onRefresh={fetchRepos}
            />
        )}
        </>
    );
}
