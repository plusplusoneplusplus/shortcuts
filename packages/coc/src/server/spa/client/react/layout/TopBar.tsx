/**
 * TopBar — top navigation bar with tab switching and theme toggle.
 */

import { useApp } from '../context/AppContext';
import { useTheme } from './ThemeProvider';
import type { DashboardTab } from '../types/dashboard';

const TABS: { label: string; tab: DashboardTab }[] = [
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

    return (
        <header className="top-bar" data-react>
            <div className="top-bar-left">
                <button className="hamburger-btn" id="hamburger-btn" aria-label="Toggle sidebar">
                    &#9776;
                </button>
                <span className="top-bar-logo">AI Execution Dashboard</span>
                <nav className="top-bar-tabs" id="tab-bar">
                    {TABS.map(({ label, tab }) => (
                        <button
                            key={tab}
                            className={`top-bar-tab${state.activeTab === tab ? ' active' : ''}`}
                            data-tab={tab}
                            onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', tab })}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
            </div>
            <div className="top-bar-right">
                <a id="admin-toggle" className="top-bar-btn" href="#admin" aria-label="Admin" title="Admin">
                    &#9881;
                </a>
                <button id="theme-toggle" className="top-bar-btn" aria-label="Toggle theme" onClick={toggleTheme}>
                    {themeEmoji[theme] || '🌗'}
                </button>
            </div>
        </header>
    );
}
