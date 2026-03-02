/**
 * BottomNav — mobile bottom navigation bar.
 * Renders only on viewports < 768px (mobile). Hidden on tablet/desktop.
 */

import { useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import type { DashboardTab, RepoSubTab } from '../types/dashboard';

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

function ChevronLeftIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
    );
}

function ChatBubbleIconOutline() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
        </svg>
    );
}

function ChatBubbleIconFilled() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.18l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.18 48.9 48.9 0 0 1-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97Z" clipRule="evenodd" />
        </svg>
    );
}

// ── Nav items ──────────────────────────────────────────────────────────

interface NavItem {
    tab: DashboardTab;
    label: string;
    icon: (active: boolean) => JSX.Element;
}

const NAV_ITEMS: NavItem[] = [
    { tab: 'repos', label: 'Repos', icon: (active) => active ? <FolderIconFilled /> : <FolderIconOutline /> },
    { tab: 'processes', label: 'Processes', icon: (active) => active ? <PlayCircleIconFilled /> : <PlayCircleIconOutline /> },
    { tab: 'wiki', label: 'Wiki', icon: (active) => active ? <BookOpenIconFilled /> : <BookOpenIconOutline /> },
];

// ── Contextual repo nav items ──────────────────────────────────────────

interface RepoNavItem {
    id: 'back' | RepoSubTab;
    label: string;
    icon: (active: boolean) => JSX.Element;
}

const REPO_NAV_ITEMS: RepoNavItem[] = [
    { id: 'back', label: 'Back', icon: () => <ChevronLeftIcon /> },
    { id: 'queue', label: 'Queue', icon: (active) => active ? <PlayCircleIconFilled /> : <PlayCircleIconOutline /> },
    { id: 'chat', label: 'Chat', icon: (active) => active ? <ChatBubbleIconFilled /> : <ChatBubbleIconOutline /> },
];

// ── Component ──────────────────────────────────────────────────────────

export function BottomNav() {
    const { state, dispatch } = useApp();
    const { isMobile } = useBreakpoint();

    const switchTab = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        location.hash = '#' + tab;
    }, [dispatch]);

    const goBack = useCallback(() => {
        dispatch({ type: 'SET_SELECTED_REPO', id: null });
        location.hash = '#repos';
    }, [dispatch]);

    const switchRepoSubTab = useCallback((tab: RepoSubTab, repoId: string) => {
        dispatch({ type: 'SET_REPO_SUB_TAB', tab });
        location.hash = `#repos/${repoId}/${tab}`;
    }, [dispatch]);

    if (!isMobile) return null;

    const { selectedRepoId, activeRepoSubTab } = state;

    if (selectedRepoId) {
        return (
            <nav
                className="fixed bottom-0 left-0 right-0 z-[8000] h-14 flex items-center justify-around border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                aria-label="Repo navigation"
                data-testid="bottom-nav"
            >
                {REPO_NAV_ITEMS.map(({ id, label, icon }) => {
                    const active = id !== 'back' && activeRepoSubTab === id;
                    return (
                        <button
                            key={id}
                            className={`flex-1 h-full flex flex-col items-center justify-center gap-0.5 ${active ? 'text-[#0078d4]' : 'text-[#616161] dark:text-[#999999]'}`}
                            data-tab={id}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => id === 'back' ? goBack() : switchRepoSubTab(id as RepoSubTab, selectedRepoId)}
                        >
                            {icon(active)}
                            <span className="text-[10px] font-medium">{label}</span>
                        </button>
                    );
                })}
            </nav>
        );
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
