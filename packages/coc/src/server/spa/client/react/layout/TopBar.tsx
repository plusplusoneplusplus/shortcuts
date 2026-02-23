/**
 * TopBar — top navigation bar with tab switching and theme toggle.
 */

import { useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useTheme } from './ThemeProvider';
import type { DashboardTab } from '../types/dashboard';

export const TABS: { label: string; tab: DashboardTab }[] = [
    { label: 'Repos', tab: 'repos' },
    { label: 'Processes', tab: 'processes' },
    { label: 'Wiki', tab: 'wiki' },
];

const themeEmoji: Record<string, string> = {
    auto: '🌗',
    dark: '🌙',
    light: '☀️',
};

export function TopBar() {
    const { state, dispatch } = useApp();
    const { theme, toggleTheme } = useTheme();

    const switchTab = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        location.hash = '#' + tab;
    }, [dispatch]);

    const toggleReposSidebar = useCallback(() => {
        if (state.activeTab !== 'repos') return;
        dispatch({ type: 'TOGGLE_REPOS_SIDEBAR' });
    }, [dispatch, state.activeTab]);

    return (
        <header
            className="h-12 px-3 flex items-center justify-between border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-[#1e1e1e] dark:text-[#cccccc]"
            data-react
        >
            <div className="flex items-center gap-3 min-w-0">
                <button
                    className="h-8 w-8 rounded border border-transparent hover:border-[#c8c8c8] dark:hover:border-[#3c3c3c] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-base leading-none"
                    id="hamburger-btn"
                    aria-label="Toggle sidebar"
                    aria-pressed={state.reposSidebarCollapsed}
                    title={state.reposSidebarCollapsed ? 'Expand repository sidebar' : 'Collapse repository sidebar'}
                    onClick={toggleReposSidebar}
                >
                    &#9776;
                </button>
                <span className="text-sm font-semibold whitespace-nowrap">AI Execution Dashboard</span>
                <nav className="flex items-center gap-1 min-w-0" id="tab-bar">
                    {TABS.map(({ label, tab }) => (
                        <button
                            key={tab}
                            className={
                                `h-8 px-3 rounded text-sm transition-colors ` +
                                (state.activeTab === tab
                                    ? 'bg-[#0078d4] text-white'
                                    : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                            }
                            data-tab={tab}
                            onClick={() => switchTab(tab)}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
            </div>
            <div className="flex items-center gap-1">
                <a
                    id="admin-toggle"
                    className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                    href="#admin"
                    aria-label="Admin"
                    title="Admin"
                >
                    &#9881;
                </a>
                <button
                    id="theme-toggle"
                    className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                    aria-label="Toggle theme"
                    onClick={toggleTheme}
                >
                    {themeEmoji[theme] || '🌗'}
                </button>
            </div>
        </header>
    );
}
