/**
 * TopBar — top navigation bar with tab switching and theme toggle.
 */

import { useCallback, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useRepos } from '../context/ReposContext';
import { useTheme } from './ThemeProvider';
import { NotificationBell } from '../shared/NotificationBell';
import { RepoTabStrip } from '../repos/RepoTabStrip';
import { MY_WORK_WORKSPACE_ID } from '../repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../repos/MyLifeView';
import { useMyWorkEnabled } from '../hooks/useMyWorkEnabled';
import { useMyLifeEnabled } from '../hooks/useMyLifeEnabled';
import { RepoManagementPopover } from '../repos/RepoManagementPopover';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { getHostname } from '../utils/config';
import type { DashboardTab } from '../types/dashboard';
import type { WsStatus } from '../hooks/useWebSocket';

/** Set to `true` to re-enable the top-level Wiki tab in navigation. */
export const SHOW_WIKI_TAB = false;

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
    connecting: { color: 'bg-[#cca700] dark:bg-[#cca700]', label: 'Reconnecting…', pulse: true },
    closed: { color: 'bg-[#f14c4c] dark:bg-[#f48771]', label: 'Disconnected', pulse: false },
};

export interface TopBarProps {
    onAdminOpen?: () => void;
    onLogsOpen?: () => void;
}

export function TopBar({ onAdminOpen, onLogsOpen }: TopBarProps = {}) {
    const { state, dispatch } = useApp();
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

    const switchTab = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        location.hash = '#' + tab;
    }, [dispatch]);

    const goToRepos = useCallback(() => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        location.hash = '#repos';
    }, [dispatch]);

    const goToMyWork = useCallback(() => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id: MY_WORK_WORKSPACE_ID });
        location.hash = '#repos/' + MY_WORK_WORKSPACE_ID + '/notes';
    }, [dispatch]);

    const goToMyLife = useCallback(() => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'repos' });
        dispatch({ type: 'SET_SELECTED_REPO', id: MY_LIFE_WORKSPACE_ID });
        location.hash = '#repos/' + MY_LIFE_WORKSPACE_ID + '/notes';
    }, [dispatch]);

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
        const suffix = subTab === 'settings'
            ? `/${subTab}/${state.settingsSection}`
            : `/${subTab}`;
        location.hash = '#repos/' + encodeURIComponent(id) + suffix;
    }, [dispatch, state.repoTabState, state.settingsSection]);

    const isOnReposTab = state.activeTab === 'repos';

    // Close popover whenever the selected repo changes (e.g. user picked a repo)
    const prevSelectedRepoId = useRef(state.selectedRepoId);
    if (prevSelectedRepoId.current !== state.selectedRepoId) {
        prevSelectedRepoId.current = state.selectedRepoId;
        if (popoverOpen) setPopoverOpen(false);
    }

    return (
        <>
        <header
            className="h-10 md:h-12 px-3 flex items-center justify-between border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-[#1e1e1e] dark:text-[#cccccc]"
            data-react
        >
            <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Desktop hamburger */}
                <button
                    className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0 rounded border border-transparent hover:border-[#c8c8c8] dark:hover:border-[#3c3c3c] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-base leading-none touch-target hidden md:inline-flex items-center justify-center"
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
            <div className="flex items-center gap-1">

                <span
                    className="inline-flex items-center justify-center h-7 w-7 md:h-8 md:w-8"
                    title={wsStatusConfig[state.wsStatus ?? 'closed']?.label}
                    aria-label={`Connection: ${wsStatusConfig[state.wsStatus ?? 'closed']?.label}`}
                    data-testid="ws-status-indicator"
                >
                    <span
                        className={`inline-block w-2 h-2 rounded-full ${wsStatusConfig[state.wsStatus ?? 'closed']?.color}${wsStatusConfig[state.wsStatus ?? 'closed']?.pulse ? ' animate-pulse' : ''}`}
                    />
                </span>
                <NotificationBell />
                <button
                    id="skills-toggle"
                    data-tab="skills"
                    className={
                        `h-7 w-7 md:h-8 md:w-8 hidden md:inline-flex items-center justify-center rounded touch-target ` +
                        (state.activeTab === 'skills'
                            ? 'bg-[#0078d4] text-white'
                            : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                    }
                    aria-label="Skills"
                    title="Skills"
                    onClick={() => switchTab('skills')}
                >
                    &#9889;
                </button>
                <button
                    id="logs-toggle"
                    data-tab="logs"
                    className={
                        `h-7 w-7 md:h-8 md:w-8 hidden md:inline-flex items-center justify-center rounded touch-target ` +
                        (state.activeTab === 'logs'
                            ? 'active bg-[#0078d4] text-white'
                            : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                    }
                    aria-label="Logs"
                    title="Logs"
                    onClick={onLogsOpen}
                >
                    &#128203;
                </button>
                <button
                    id="memory-toggle"
                    data-tab="memory"
                    className={
                        `h-7 w-7 md:h-8 md:w-8 hidden md:inline-flex items-center justify-center rounded touch-target ` +
                        (state.activeTab === 'memory'
                            ? 'bg-[#0078d4] text-white'
                            : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                    }
                    aria-label="Memory"
                    title="Memory"
                    onClick={() => switchTab('memory')}
                >
                    &#129504;
                </button>
                <button
                    id="stats-toggle"
                    data-tab="stats"
                    className={
                        `h-7 w-7 md:h-8 md:w-8 hidden md:inline-flex items-center justify-center rounded touch-target ` +
                        (state.activeTab === 'stats'
                            ? 'bg-[#0078d4] text-white'
                            : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                    }
                    aria-label="Usage"
                    title="Usage"
                    onClick={() => switchTab('stats')}
                >
                    &#128202;
                </button>
                <button
                    id="models-toggle"
                    data-tab="models"
                    className={
                        `h-7 w-7 md:h-8 md:w-8 hidden md:inline-flex items-center justify-center rounded touch-target ` +
                        (state.activeTab === 'models'
                            ? 'bg-[#0078d4] text-white'
                            : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                    }
                    aria-label="Models"
                    title="Models"
                    onClick={() => switchTab('models')}
                >
                    ⚛
                </button>
                <button
                    id="admin-toggle"
                    data-tab="admin"
                    className={
                        `h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center rounded touch-target ` +
                        (state.activeTab === 'admin'
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
                    className="h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08] touch-target"
                    aria-label="Toggle theme"
                    onClick={toggleTheme}
                >
                    {themeEmoji[theme] || '🌗'}
                </button>
            </div>
        </header>
        {(isOnReposTab || (isMobile && popoverOpen)) && (
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
