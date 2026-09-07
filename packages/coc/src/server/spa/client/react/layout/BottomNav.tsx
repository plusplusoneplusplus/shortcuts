/**
 * BottomNav — mobile top navigation bar (positioned below the TopBar).
 * Renders only on viewports < 768px (mobile). Hidden on tablet/desktop.
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import type { DashboardTab } from '../types/dashboard';
import { getNavItems } from './navDestinations';
import { isServersEnabled } from '../utils/config';

// ── Contextual repo nav items (removed — handled by MobileTabBar in RepoDetail) ──

// ── Component ──────────────────────────────────────────────────────────

export function BottomNav() {
    const { state, dispatch } = useApp();
    const { isMobile } = useBreakpoint();
    const { selectedRepoId } = state;
    const navRef = useRef<HTMLElement>(null);
    const serversEnabled = isServersEnabled();
    const navItems = useMemo(() => getNavItems(serversEnabled), [serversEnabled]);

    // Nav is only visible on mobile when no repo is selected (MobileTabBar handles
    // repo-level nav) and off the repos tab, where `MobileScopeBar` takes the row:
    // there the scope, not the admin destinations, is the primary axis.
    const isNavVisible = isMobile && !selectedRepoId && state.activeTab !== 'repos';

    const switchTab = useCallback((tab: DashboardTab) => {
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        location.hash = '#' + tab;
    }, [dispatch]);

    useLayoutEffect(() => {
        if (!isNavVisible) {
            document.documentElement.style.setProperty('--bottom-nav-height', '0px');
            return;
        }
        const nav = navRef.current;
        if (!nav) return;
        const observer = new ResizeObserver(() => {
            document.documentElement.style.setProperty('--bottom-nav-height', nav.offsetHeight + 'px');
        });
        observer.observe(nav);
        document.documentElement.style.setProperty('--bottom-nav-height', nav.offsetHeight + 'px');
        return () => {
            observer.disconnect();
            document.documentElement.style.setProperty('--bottom-nav-height', '0px');
        };
    }, [isNavVisible]);

    if (!isNavVisible) return null;

    return (
        <nav
            ref={navRef}
            className="fixed top-10 left-0 right-0 z-[8000] h-12 flex items-center overflow-x-auto border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]"
            aria-label="Mobile navigation"
            data-testid="bottom-nav"
        >
            {navItems.map(({ tab, label, icon }) => {
                const active = state.activeTab === tab;
                return (
                    <button
                        key={tab}
                        className={`flex-1 min-w-[3.5rem] h-full flex flex-col items-center justify-center gap-0.5 ${active ? 'text-[#0078d4] bg-[#0078d4]/10 dark:bg-[#0078d4]/15 rounded-lg' : 'text-[#616161] dark:text-[#999999]'}`}
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
