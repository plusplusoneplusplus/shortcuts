/**
 * BottomNav — mobile bottom navigation bar.
 * Renders only on viewports < 768px (mobile). Hidden on tablet/desktop.
 */

import { useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import type { DashboardTab } from '../types/dashboard';
import { SHOW_WIKI_TAB } from './TopBar';

// ── Inline SVG icon components (24×24, currentColor) ───────────────────

function FolderIconOutline() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v6m0 0h19.5m-19.5 0v6A2.25 2.25 0 0 0 4.5 20.25h15A2.25 2.25 0 0 0 21.75 18v-6" />
        </svg>
    );
}

function FolderIconFilled() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z" />
        </svg>
    );
}

function PlayCircleIconOutline() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z" />
        </svg>
    );
}

function PlayCircleIconFilled() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm14.024-.983a1.125 1.125 0 0 1 0 1.966l-5.603 3.113A1.125 1.125 0 0 1 9 15.113V8.887c0-.857.921-1.4 1.671-.983l5.603 3.113Z" clipRule="evenodd" />
        </svg>
    );
}

function BookOpenIconOutline() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
        </svg>
    );
}

function BookOpenIconFilled() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path d="M11.25 4.533A9.707 9.707 0 0 0 6 3a9.735 9.735 0 0 0-3.25.555.75.75 0 0 0-.5.707v14.25a.75.75 0 0 0 1 .707A8.237 8.237 0 0 1 6 18.75c1.995 0 3.823.707 5.25 1.886V4.533ZM12.75 20.636A8.214 8.214 0 0 1 18 18.75c.966 0 1.89.166 2.75.47a.75.75 0 0 0 1-.708V4.262a.75.75 0 0 0-.5-.707A9.735 9.735 0 0 0 18 3a9.707 9.707 0 0 0-5.25 1.533v16.103Z" />
        </svg>
    );
}

function BrainIconOutline() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 2.47a.75.75 0 0 0-1.06 0C7.32 3.62 6.75 5.2 6.75 6.75c0 .98.23 1.9.63 2.7A4.5 4.5 0 0 0 3 13.5a4.5 4.5 0 0 0 3.19 4.29c.04.25.08.5.14.73A3.75 3.75 0 0 0 9.75 21h4.5a3.75 3.75 0 0 0 3.42-2.48c.06-.23.1-.48.14-.73A4.5 4.5 0 0 0 21 13.5a4.5 4.5 0 0 0-4.38-4.5c.4-.8.63-1.72.63-2.7 0-1.55-.57-3.13-1.72-4.28a.75.75 0 0 0-1.06 0C13.32 3.27 12 4.88 12 6.75c0-1.87-1.32-3.48-2.47-4.28Z" />
        </svg>
    );
}

function BrainIconFilled() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path d="M9.53 2.47a.75.75 0 0 0-1.06 0C7.32 3.62 6.75 5.2 6.75 6.75c0 .98.23 1.9.63 2.7A4.5 4.5 0 0 0 3 13.5a4.5 4.5 0 0 0 3.19 4.29c.04.25.08.5.14.73A3.75 3.75 0 0 0 9.75 21h4.5a3.75 3.75 0 0 0 3.42-2.48c.06-.23.1-.48.14-.73A4.5 4.5 0 0 0 21 13.5a4.5 4.5 0 0 0-4.38-4.5c.4-.8.63-1.72.63-2.7 0-1.55-.57-3.13-1.72-4.28a.75.75 0 0 0-1.06 0C13.32 3.27 12 4.88 12 6.75c0-1.87-1.32-3.48-2.47-4.28Z" />
        </svg>
    );
}

function PuzzleIconOutline() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875S10.5 3.089 10.5 4.125c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" />
        </svg>
    );
}

function PuzzleIconFilled() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875S10.5 3.089 10.5 4.125c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" />
        </svg>
    );
}

function TerminalIconOutline() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
    );
}

function TerminalIconFilled() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path fillRule="evenodd" d="M2.25 6a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V6Zm3.97.97a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06-1.06l1.72-1.72-1.72-1.72a.75.75 0 0 1 0-1.06Zm4.28 4.28a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" clipRule="evenodd" />
        </svg>
    );
}

// ── Nav items ──────────────────────────────────────────────────────────

interface NavItem {
    tab: DashboardTab;
    label: string;
    icon: (active: boolean) => JSX.Element;
}

const ALL_NAV_ITEMS: NavItem[] = [
    { tab: 'repos', label: 'Repos', icon: (active) => active ? <FolderIconFilled /> : <FolderIconOutline /> },
    { tab: 'processes', label: 'Processes', icon: (active) => active ? <PlayCircleIconFilled /> : <PlayCircleIconOutline /> },
    { tab: 'wiki', label: 'Wiki', icon: (active) => active ? <BookOpenIconFilled /> : <BookOpenIconOutline /> },
    { tab: 'skills', label: 'Skills', icon: (active) => active ? <PuzzleIconFilled /> : <PuzzleIconOutline /> },
    { tab: 'memory', label: 'Memory', icon: (active) => active ? <BrainIconFilled /> : <BrainIconOutline /> },
    { tab: 'logs', label: 'Logs', icon: (active) => active ? <TerminalIconFilled /> : <TerminalIconOutline /> },
];

const NAV_ITEMS: NavItem[] = SHOW_WIKI_TAB
    ? ALL_NAV_ITEMS.filter(item => item.tab !== 'logs')
    : ALL_NAV_ITEMS.filter(item => item.tab !== 'wiki' && item.tab !== 'logs');

// ── Contextual repo nav items (removed — handled by MobileTabBar in RepoDetail) ──

// ── Component ──────────────────────────────────────────────────────────

export function BottomNav() {
    const { state, dispatch } = useApp();
    const { isMobile } = useBreakpoint();

    const switchTab = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        location.hash = '#' + tab;
    }, [dispatch]);

    if (!isMobile) return null;

    const { selectedRepoId } = state;

    // When a repo is selected, MobileTabBar in RepoDetail handles bottom navigation
    if (selectedRepoId) {
        return null;
    }

    return (
        <nav
            className="fixed bottom-0 left-0 right-0 z-[8000] h-14 flex items-center justify-around border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            aria-label="Mobile navigation"
            data-testid="bottom-nav"
        >
            {NAV_ITEMS.map(({ tab, label, icon }) => {
                const active = state.activeTab === tab;
                return (
                    <button
                        key={tab}
                        className={`flex-1 h-full flex flex-col items-center justify-center gap-0.5 ${active ? 'text-[#0078d4]' : 'text-[#616161] dark:text-[#999999]'}`}
                        data-tab={tab}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => switchTab(tab)}
                    >
                        {icon(active)}
                        <span className="text-[10px] font-medium">{label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
