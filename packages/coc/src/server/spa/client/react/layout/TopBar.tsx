/**
 * TopBar — top navigation bar with tab switching and theme toggle.
 *
 * Right-side layout matches the v2 topbar refinement design:
 *   [Connected pill] [NotificationBell] [Tools ▾] [Admin] [Theme]
 *
 * The Skills / Logs / Usage / Models / Servers nav targets are grouped
 * inside the Tools dropdown menu rather than rendered as individual icon
 * buttons. Each menu row keeps its original DOM id, aria-label, title and
 * navigation behavior for backward compatibility with existing callers and
 * tests.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getHostname, isServersEnabled } from '../utils/config';
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
    onLogsOpen?: () => void;
}

interface ToolMenuItem {
    id: string;
    tab: DashboardTab | null;
    label: string;
    description: string;
    icon: string;
    onClick: () => void;
}

export function TopBar({ onAdminOpen, onLogsOpen }: TopBarProps = {}) {
    const { state, dispatch } = useApp();
    const { state: queueState } = useQueue();
    const { repos, unseenCounts, fetchRepos } = useRepos();
    const { theme, toggleTheme } = useTheme();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    const toolsContainerRef = useRef<HTMLDivElement>(null);
    const toolsButtonRef = useRef<HTMLButtonElement>(null);
    const hostname = getHostname();
    const brandLabel = hostname ? `CoC @ ${hostname}` : 'CoC';
    const brandTooltip = hostname ? `Copilot of Copilot @ ${hostname}` : 'Copilot of Copilot';
    const myWorkEnabled = useMyWorkEnabled();
    const myLifeEnabled = useMyLifeEnabled();
    const serversEnabled = isServersEnabled();

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

    // ── Tools dropdown ─────────────────────────────────────────────
    const closeTools = useCallback(() => setToolsOpen(false), []);
    const toggleTools = useCallback(() => setToolsOpen(prev => !prev), []);

    // Close tools popover on outside click / Escape
    useEffect(() => {
        if (!toolsOpen) return;
        const onPointerDown = (e: MouseEvent) => {
            if (toolsContainerRef.current && !toolsContainerRef.current.contains(e.target as Node)) {
                closeTools();
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeTools();
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [toolsOpen, closeTools]);

    const toolItems: ToolMenuItem[] = useMemo(() => {
        const items: ToolMenuItem[] = [
            {
                id: 'skills-toggle',
                tab: 'skills',
                label: 'Skills',
                description: 'Installed capabilities',
                icon: '⚡',
                onClick: () => switchTab('skills'),
            },
            {
                id: 'logs-toggle',
                // 'logs' is a routable tab; the parent's onLogsOpen handler
                // navigates to #logs which Router resolves to the Logs view.
                // Tagging the menu row with `tab: 'logs'` keeps the active
                // accent and `[data-tab="logs"]` selector working.
                tab: 'logs',
                label: 'Logs',
                description: 'Runtime events',
                icon: '📋',
                onClick: () => { onLogsOpen?.(); },
            },
        ];
        if (SHOW_MEMORY_TAB) {
            items.push({
                id: 'memory-toggle',
                tab: 'memory',
                label: 'Memory',
                description: 'Bounded recall',
                icon: '🧠',
                onClick: () => switchTab('memory'),
            });
        }
        items.push(
            {
                id: 'stats-toggle',
                tab: 'stats',
                label: 'Usage',
                description: 'Model and task stats',
                icon: '📊',
                onClick: () => switchTab('stats'),
            },
            {
                id: 'models-toggle',
                tab: 'models',
                label: 'Models',
                description: 'Model selection and limits',
                icon: '⚛',
                onClick: () => switchTab('models'),
            },
        );
        if (serversEnabled) {
            items.push({
                id: 'servers-toggle',
                tab: 'servers',
                label: 'Servers',
                description: 'Connected tools',
                icon: '🖥',
                onClick: () => switchTab('servers'),
            });
        }
        return items;
    }, [serversEnabled, onLogsOpen, switchTab]);

    const wsStatus = state.wsStatus ?? 'closed';
    const wsConfig = wsStatusConfig[wsStatus];
    const toolsActive = toolItems.some(item => item.tab !== null && state.activeTab === item.tab);

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
                <div ref={toolsContainerRef} className="relative hidden md:inline-flex">
                    <button
                        ref={toolsButtonRef}
                        id="tools-toggle"
                        type="button"
                        aria-label="Tools"
                        title="Tools"
                        aria-haspopup="menu"
                        aria-expanded={toolsOpen}
                        data-testid="tools-toggle"
                        data-tools-active={toolsActive ? 'true' : 'false'}
                        onClick={toggleTools}
                        className={
                            `inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[13px] font-semibold leading-none touch-target transition-colors ` +
                            (toolsOpen || toolsActive
                                ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/20 border-[#0969da]/40 dark:border-[#3794ff]/50 text-[#0969da] dark:text-[#79c0ff]'
                                : 'bg-white dark:bg-[#1e1e1e] border-[#d0d7de] dark:border-[#3c3c3c] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]')
                        }
                    >
                        <span aria-hidden="true" className="text-[14px] leading-none">&#9776;</span>
                        <span>Tools</span>
                    </button>
                    {toolsOpen && (
                        <div
                            id="tools-popover"
                            role="menu"
                            aria-label="Tools"
                            data-testid="tools-popover"
                            className="absolute right-0 top-full mt-1.5 z-[10001] min-w-[260px] rounded-lg border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden"
                        >
                            <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#656d76] dark:text-[#999]">
                                Global tools
                            </div>
                            <div className="p-1.5">
                                {toolItems.map(item => {
                                    const isActive = item.tab !== null && state.activeTab === item.tab;
                                    return (
                                        <button
                                            key={item.id}
                                            id={item.id}
                                            data-tab={item.tab ?? undefined}
                                            data-testid={item.id}
                                            type="button"
                                            role="menuitem"
                                            aria-label={item.label}
                                            title={item.label}
                                            onClick={() => { item.onClick(); closeTools(); }}
                                            className={
                                                `w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left transition-colors touch-target ` +
                                                (isActive
                                                    ? 'bg-[#ddf4ff] dark:bg-[#3794ff]/20 text-[#0969da] dark:text-[#79c0ff]'
                                                    : 'text-[#1f2328] dark:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]')
                                            }
                                        >
                                            <span
                                                aria-hidden="true"
                                                className="inline-flex items-center justify-center w-6 h-6 text-base leading-none flex-shrink-0"
                                            >
                                                {item.icon}
                                            </span>
                                            <span className="flex-1 min-w-0 flex flex-col leading-tight">
                                                <span className="text-[13px] font-semibold truncate">
                                                    {item.label}
                                                </span>
                                                <span className="text-[12px] text-[#656d76] dark:text-[#999] truncate">
                                                    {item.description}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <button
                    id="admin-toggle"
                    data-tab="admin"
                    className={
                        `h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center rounded touch-target text-base leading-none ` +
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
