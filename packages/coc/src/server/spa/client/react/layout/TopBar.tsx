/**
 * TopBar — top navigation bar with tab switching and theme toggle.
 *
 * Right-side layout:
 *   [Connected pill] [NotificationBell] [Admin] [Theme]
 *
 * The Skills / Logs / Usage / Models / Servers nav targets now live in
 * the Admin page's left-panel "Tools" group — see `AdminPanel.tsx`. They
 * are no longer rendered as a topbar dropdown.
 */

import { useCallback, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useQueue } from '../contexts/QueueContext';
import { useRepos } from '../contexts/ReposContext';
import { useTheme } from './ThemeProvider';
import { buildNoteHash, buildRepoSubTabSuffix } from './Router';
import { NotificationBell } from '../shared/NotificationBell';
import { RepoTabStrip } from '../features/repo-detail/RepoTabStrip';
import { MY_WORK_WORKSPACE_ID } from '../repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../repos/MyLifeView';
import { useMyWorkEnabled } from '../hooks/feature-flags/useMyWorkEnabled';
import { useMyLifeEnabled } from '../hooks/feature-flags/useMyLifeEnabled';
import { RepoManagementPopover } from '../repos/RepoManagementPopover';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { getHostname } from '../utils/config';
import type { DashboardTab } from '../types/dashboard';
import type { WsStatus } from '../hooks/useWebSocket';

/** Set to `true` to re-enable the top-level Wiki tab in navigation. */
export const SHOW_WIKI_TAB = false;
/** Set to `true` to re-enable the topbar Memory icon. */
export const SHOW_MEMORY_TAB = false;

export const ALL_TABS: { label: string; tab: DashboardTab }[] = [
    { label: 'Wiki', tab: 'wiki' },
];

export const TABS: { label: string; tab: DashboardTab }[] = SHOW_WIKI_TAB
    ? ALL_TABS
    : ALL_TABS.filter(t => t.tab !== 'wiki');

const themeEmoji: Record<string, string> = {
    auto: '🌗',
    dark: '🌙',
    light: '☀️',
};

const wsStatusConfig: Record<WsStatus, { color: string; label: string; pulse: boolean }> = {
    open: { color: 'bg-[#16825d] dark:bg-[#89d185]', label: 'Connected', pulse: false },
    connecting: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Connecting…', pulse: true },
    reconnecting: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Reconnecting…', pulse: true },
    closing: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Disconnecting…', pulse: true },
    closed: { color: 'bg-[#f14c4c] dark:bg-[#f48771]', label: 'Disconnected', pulse: false },
};

export interface TopBarProps {
    onAdminOpen?: () => void;
}

export function TopBar({ onAdminOpen }: TopBarProps = {}) {
    const { state, dispatch } = useApp();
    const { state: queueState } = useQueue();
    const { repos, unseenCounts, fetchRepos } = useRepos();
    const { theme, toggleTheme } = useTheme();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const [popoverOpen, setPopoverOpen] = useState(false);
    const hostname = getHostname();
    const brandLabel = hostname ? `CoC @ ${hostname}` : 'CoC';
    const brandTooltip = hostname ? `Copilot of Copilot @ ${hostname}` : 'Copilot of Copilot';
    const myWorkEnabled = useMyWorkEnabled();
    const myLifeEnabled = useMyLifeEnabled();

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
        dispatch({ type: 'SET_SELECTED_REPO', id });
        const subTab = state.repoTabState[id] ?? 'chats';
        const selectedTaskId = queueState.selectedTaskIdByRepo?.[id] ?? null;
        const suffix = buildRepoSubTabSuffix(
            subTab,
            { ...state, selectedNotePath: state.notePathState?.[id] ?? null },
            selectedTaskId
        );
        location.hash = '#repos/' + encodeURIComponent(id) + suffix;
    }, [dispatch, queueState.selectedTaskIdByRepo, state]);

    const isOnReposTab = state.activeTab === 'repos';

    const wsStatus = state.wsStatus ?? 'closed';
    const wsConfig = wsStatusConfig[wsStatus];

    return (
        <>
        <header
            className="h-10 md:h-12 px-3 flex items-center justify-between border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-[#1e1e1e] dark:text-[#cccccc]"
            data-react
        >
            <div className="flex items-center gap-2 min-w-0 flex-1">
                <button
                    className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0 rounded border border-transparent hover:border-[#c8c8c8] dark:hover:border-[#3c3c3c] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-base leading-none touch-target"
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
                    className={`text-sm font-semibold whitespace-nowrap md:hidden flex-shrink-0 px-2 h-7 transition-colors inline-flex items-center ${isOnReposTab ? 'active border-b-2 border-[#0078d4] text-[#0078d4] dark:border-[#60b4ff] dark:text-[#60b4ff]' : 'hover:underline'}`}
                    onClick={e => { e.preventDefault(); goToRepos(); }}
                >{ brandLabel }</a>
                <a
                    href="#"
                    data-tab="repos"
                    className={`text-sm font-semibold whitespace-nowrap hidden md:inline-flex flex-shrink-0 px-2 h-8 transition-colors items-center ${isOnReposTab ? 'active border-b-2 border-[#0078d4] text-[#0078d4] dark:border-[#60b4ff] dark:text-[#60b4ff]' : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'}`}
                    title={brandTooltip}
                    onClick={e => { e.preventDefault(); goToRepos(); }}
                >{ brandLabel }</a>
                {myWorkEnabled && (
                    <button
                        id="my-work-toggle"
                        className={
                            `h-7 w-7 md:h-8 md:w-8 flex-shrink-0 inline-flex items-center justify-center rounded touch-target ` +
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
                            `h-7 w-7 md:h-8 md:w-8 flex-shrink-0 inline-flex items-center justify-center rounded touch-target ` +
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
                {!isMobile && (
                    <RepoTabStrip
                        repos={repos}
                        selectedRepoId={state.selectedRepoId}
                        onSelect={selectRepo}
                        unseenCounts={unseenCounts}
                        onRefresh={fetchRepos}
                    />
                )}
                {TABS.length > 0 && (
                    <nav className="hidden md:flex items-center gap-1 min-w-0 flex-shrink-0" id="tab-bar">
                        {TABS.map(({ label, tab }) => (
                            <button
                                key={tab}
                                className={
                                    `h-8 px-3 rounded text-sm transition-colors ` +
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
            <div className="flex items-center gap-1.5" data-testid="topbar-actions">
                {/* WS status — pill on desktop, bare dot on mobile to save space */}
                <span
                    className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-xs font-medium text-[#656d76] dark:text-[#999]"
                    title={wsConfig.label}
                    aria-label={`Connection: ${wsConfig.label}`}
                    data-testid="ws-status-indicator"
                    data-ws-status={wsStatus}
                >
                    <span
                        className={`inline-block w-2 h-2 rounded-full ${wsConfig.color}${wsConfig.pulse ? ' animate-pulse' : ''}`}
                        aria-hidden="true"
                    />
                    <span data-testid="ws-status-label">{wsConfig.label}</span>
                </span>
                <span
                    className="md:hidden inline-flex items-center justify-center h-7 w-7"
                    title={wsConfig.label}
                    aria-label={`Connection: ${wsConfig.label}`}
                    data-testid="ws-status-indicator-mobile"
                    data-ws-status={wsStatus}
                >
                    <span
                        className={`inline-block w-2 h-2 rounded-full ${wsConfig.color}${wsConfig.pulse ? ' animate-pulse' : ''}`}
                    />
                </span>
                <NotificationBell />
                <button
                    id="admin-toggle"
                    data-tab="admin"
                    className={
                        `h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center rounded touch-target text-base leading-none ` +
                        // The admin shell hosts both `admin` itself and the
                        // five embedded tool routes (skills/logs/stats/models/
                        // servers). Reflect "user is in the admin shell" in
                        // the highlight for any of those tabs.
                        (state.activeTab === 'admin'
                         || state.activeTab === 'skills'
                         || state.activeTab === 'logs'
                         || state.activeTab === 'stats'
                         || state.activeTab === 'models'
                         || state.activeTab === 'servers'
                            ? 'bg-[#0078d4] text-white'
                            : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                    }
                    aria-label="Admin"
                    title="Admin"
                    onClick={onAdminOpen}
                >
                    &#9881;
                </button>
                <button
                    id="theme-toggle"
                    className="h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08] touch-target text-base leading-none"
                    aria-label="Toggle theme"
                    onClick={toggleTheme}
                >
                    {themeEmoji[theme] || '🌗'}
                </button>
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
