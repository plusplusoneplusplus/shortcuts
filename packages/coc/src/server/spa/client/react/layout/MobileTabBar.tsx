/**
 * MobileTabBar — replaces the horizontal top tab strip on mobile.
 * Fixed bottom bar with pinned tabs (Tasks, Activity, Git) + a "···" More button.
 * Tapping More opens a BottomSheet listing the remaining tabs.
 */

import { useState } from 'react';
import { BottomSheet } from '../shared/BottomSheet';
import { cn } from '../shared';
import type { RepoSubTab } from '../types/dashboard';

const DEFAULT_PINNED: RepoSubTab[] = ['tasks', 'activity', 'git'];

export interface MobileTabBarProps {
    activeTab: RepoSubTab;
    onTabChange: (tab: RepoSubTab) => void;
    tabs: { key: RepoSubTab; label: string }[];
    pinnedTabs?: RepoSubTab[];
    taskCount?: number;
    activityCount?: number;
    gitPendingCount?: number;
}

export function MobileTabBar({
    activeTab,
    onTabChange,
    tabs,
    pinnedTabs = DEFAULT_PINNED,
    taskCount = 0,
    activityCount = 0,
    gitPendingCount = 0,
}: MobileTabBarProps){
    const [moreOpen, setMoreOpen] = useState(false);

    const pinnedTabItems = tabs.filter(t => pinnedTabs.includes(t.key));
    const moreTabItems = tabs.filter(t => !pinnedTabs.includes(t.key));
    const isMoreActive = moreTabItems.some(t => t.key === activeTab);

    const getBadgeCount = (key: RepoSubTab): number => {
        if (key === 'tasks') return taskCount;
        if (key === 'activity') return activityCount;
        if (key === 'git') return gitPendingCount;
        return 0;
    };

    const handleTabChange = (tab: RepoSubTab) => {
        setMoreOpen(false);
        onTabChange(tab);
    };

    return (
        <>
            <nav
                className="fixed bottom-0 left-0 right-0 z-[8000] h-14 flex items-stretch border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                aria-label="Repo tab navigation"
                data-testid="mobile-tab-bar"
            >
                {pinnedTabItems.map(t => {
                    const active = activeTab === t.key;
                    const badgeCount = getBadgeCount(t.key);
                    return (
                        <button
                            key={t.key}
                            data-tab={t.key}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                                'flex-1 flex flex-col items-center justify-center gap-0.5',
                                active ? 'text-[#0078d4]' : 'text-[#616161] dark:text-[#999999]'
                            )}
                            onClick={() => handleTabChange(t.key)}
                        >
                            <span className="text-[10px] font-medium relative inline-flex items-center gap-0.5">
                                {t.label}
                                {badgeCount > 0 && (
                                    <span
                                        className="text-[9px] bg-[#0078d4] text-white px-1 py-px rounded-full leading-none"
                                        data-testid={`mobile-tab-badge-${t.key}`}
                                    >
                                        {badgeCount}
                                    </span>
                                )}
                            </span>
                        </button>
                    );
                })}
                {moreTabItems.length > 0 && (
                    <button
                        data-tab="more"
                        aria-expanded={moreOpen}
                        className={cn(
                            'flex-1 flex flex-col items-center justify-center gap-0.5',
                            isMoreActive ? 'text-[#0078d4]' : 'text-[#616161] dark:text-[#999999]'
                        )}
                        onClick={() => setMoreOpen(true)}
                        data-testid="mobile-tab-more-btn"
                    >
                        <span className="text-[10px] font-medium">···</span>
                    </button>
                )}
            </nav>

            <BottomSheet isOpen={moreOpen} onClose={() => setMoreOpen(false)} title="More">
                <div data-testid="mobile-tab-more-sheet">
                    {moreTabItems.map(t => {
                        const active = activeTab === t.key;
                        return (
                            <button
                                key={t.key}
                                data-tab={t.key}
                                className={cn(
                                    'w-full text-left px-4 py-3 text-sm',
                                    active
                                        ? 'text-[#0078d4] font-medium'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10'
                                )}
                                onClick={() => handleTabChange(t.key)}
                                data-testid={`mobile-tab-more-item-${t.key}`}
                            >
                                {t.label}
                            </button>
                        );
                    })}
                </div>
            </BottomSheet>
        </>
    );
}
