/**
 * MobileScopeBar — the 40px row that replaces `BottomNav` on the Repos tab at
 * mobile width.
 *
 * `BottomNav`'s six admin destinations (Skills / Memory / Usage / Servers /
 * Logs / Wiki) are not the primary axis of the repos tab — the *scope* is — and
 * at 48px they cost more of a short viewport than they earn. Here the row holds
 * the active scope chip (status dot · icon · name · `⧉N` · chevron) plus its
 * unseen badge, and folds those destinations behind a `⋯` sheet. Off the repos
 * tab `BottomNav` renders unchanged.
 *
 * Tapping the chip opens `ScopePickerSheet` — the same `useScopePickerModel`
 * rows the desktop dropdown renders.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { useRepos } from '../contexts/ReposContext';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useQueue } from '../contexts/QueueContext';
import { isHidden as isHiddenTask } from '../queue/hooks/useRepoQueueStats';
import { BottomSheet } from '../ui/BottomSheet';
import { ScopePickerSheet } from '../features/remote-shell/ScopePickerSheet';
import { computeCloneStatusMap, summarizeRemote } from '../features/remote-shell/shellModel';
import { CloneCountBadge, Chevron, RepoGroupGlyph, UnseenBadge } from '../features/remote-shell/scopePickerGlyphs';
import { findRepoBySelectionId } from '../repos/cloneIdentity';
import { groupReposByRemote } from '../repos/repoGrouping';
import { resolveRepoGroupName } from '../repos/repoGroupName';
import {
    MY_LIFE_WORKSPACE_ID,
    MY_WORK_WORKSPACE_ID,
    isRepoGroupWorkspaceId,
} from '../repos/virtualWorkspaceIds';
import type { DashboardTab } from '../types/dashboard';
import { getNavItems } from './navDestinations';
import { isServersEnabled } from '../utils/config';

interface ActiveScope {
    /** Emoji marker for a virtual scope; repo groups use the drawn glyph instead. */
    icon: string | null;
    isGroup: boolean;
    name: string;
    color: string;
    cloneCount: number;
    unseen: number;
}

/**
 * Visibility gate. Kept in its own component, reading nothing but `AppContext`
 * and the breakpoint, so the repos/queue contexts the bar's body needs are only
 * touched when the bar actually renders — the same minimal-dependency root
 * `BottomNav` has.
 */
export function MobileScopeBar() {
    const { state } = useApp();
    const { isMobile } = useBreakpoint();
    // The bar stands in for BottomNav on this tab, and only when no workspace is
    // selected — once one is, its own MobileTabBar owns the top row.
    if (!isMobile || state.activeTab !== 'repos' || state.selectedRepoId) return null;
    return <MobileScopeBarBody />;
}

function MobileScopeBarBody() {
    const { state, dispatch } = useApp();
    const { repos, unseenCounts, remoteGroupWorkspaces } = useRepos();
    const repoQueueMap = useQueue().state.repoQueueMap;
    const [pickerOpen, setPickerOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const barRef = useRef<HTMLElement>(null);
    const navItems = useMemo(() => getNavItems(isServersEnabled()), []);

    // The scope the chip names: the current selection, else the workspace the
    // user was last in, so backing out to the list still says where "back" goes.
    const scopeId = state.selectedRepoId ?? state.lastWorkspaceRepoId;

    const activeScope = useMemo<ActiveScope | null>(() => {
        if (!scopeId) return null;
        const unseen = unseenCounts[scopeId] ?? 0;
        if (scopeId === MY_WORK_WORKSPACE_ID) {
            return { icon: '💼', isGroup: false, name: 'My Work', color: '#848484', cloneCount: 1, unseen };
        }
        if (scopeId === MY_LIFE_WORKSPACE_ID) {
            return { icon: '🏠', isGroup: false, name: 'My Life', color: '#848484', cloneCount: 1, unseen };
        }
        if (isRepoGroupWorkspaceId(scopeId)) {
            return {
                icon: null,
                isGroup: true,
                // Neutral dot: a group aggregates clones with independent health,
                // so borrowing any member's color would misreport the others.
                color: '#848484',
                name: resolveRepoGroupName(scopeId, state.workspaces, remoteGroupWorkspaces),
                cloneCount: 1,
                unseen,
            };
        }
        const repo = findRepoBySelectionId(repos, scopeId);
        if (!repo) return null;
        const cloneStatus = computeCloneStatusMap(repos, repoQueueMap, isHiddenTask);
        const group = groupReposByRemote(repos, {}).find(g => g.repos.includes(repo));
        if (!group) {
            return { icon: null, isGroup: false, name: String(repo.workspace.name ?? scopeId), color: String(repo.workspace.color ?? '#848484'), cloneCount: 1, unseen };
        }
        const summary = summarizeRemote(group, cloneStatus, unseenCounts);
        return { icon: null, isGroup: false, name: summary.name, color: summary.color, cloneCount: summary.cloneCount, unseen: summary.unseen };
    }, [scopeId, repos, unseenCounts, repoQueueMap, state.workspaces, remoteGroupWorkspaces]);

    const switchTab = useCallback((tab: DashboardTab) => {
        setMoreOpen(false);
        dispatch({ type: 'SET_ACTIVE_TAB', tab });
        location.hash = '#' + tab;
    }, [dispatch]);

    // Shares the `--bottom-nav-height` custom property with BottomNav — only one
    // of the two is ever mounted, and `App`'s main padding reads this one var.
    useLayoutEffect(() => {
        const bar = barRef.current;
        if (!bar) return;
        const apply = () => document.documentElement.style.setProperty('--bottom-nav-height', bar.offsetHeight + 'px');
        const observer = new ResizeObserver(apply);
        observer.observe(bar);
        apply();
        return () => {
            observer.disconnect();
            document.documentElement.style.setProperty('--bottom-nav-height', '0px');
        };
    }, []);

    return (
        <>
            <nav
                ref={barRef}
                className="fixed top-10 left-0 right-0 z-[8000] h-10 flex items-center gap-1 px-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]"
                aria-label="Scope navigation"
                data-testid="mobile-scope-bar"
            >
                <button
                    data-testid="mobile-scope-chip"
                    data-scope-id={scopeId ?? ''}
                    aria-haspopup="dialog"
                    aria-expanded={pickerOpen}
                    aria-label={activeScope ? `Switch workspace (currently ${activeScope.name})` : 'Select workspace'}
                    onClick={() => setPickerOpen(true)}
                    className="flex-1 min-w-0 inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-[13px] font-semibold text-[#1f2328] dark:text-[#cccccc] text-left"
                >
                    <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: activeScope?.color ?? '#848484' }} aria-hidden />
                    {activeScope?.isGroup && <RepoGroupGlyph />}
                    {activeScope?.icon && <span aria-hidden>{activeScope.icon}</span>}
                    <span className="truncate">{activeScope?.name ?? 'Select workspace'}</span>
                    {activeScope && activeScope.cloneCount > 1 && <CloneCountBadge count={activeScope.cloneCount} />}
                    {activeScope && activeScope.unseen > 0 && <UnseenBadge count={activeScope.unseen} testId="mobile-scope-unseen-badge" />}
                    <Chevron />
                </button>
                <button
                    data-testid="mobile-scope-more-btn"
                    aria-label="More destinations"
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen(true)}
                    className="flex-shrink-0 inline-flex items-center justify-center w-9 h-8 rounded-md text-[#616161] dark:text-[#999999]"
                >
                    <span className="text-[13px] font-medium">⋯</span>
                </button>
            </nav>

            <ScopePickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} repos={repos} />

            <BottomSheet isOpen={moreOpen} onClose={() => setMoreOpen(false)} title="More" height={50}>
                <div data-testid="mobile-scope-more-sheet" className="pb-4">
                    {navItems.map(({ tab, label, icon }) => {
                        const active = state.activeTab === tab;
                        return (
                            <button
                                key={tab}
                                data-tab={tab}
                                aria-current={active ? 'page' : undefined}
                                className="w-full flex items-center gap-3 text-left px-4 min-h-[44px] text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                                onClick={() => switchTab(tab)}
                            >
                                {icon(active)}
                                {label}
                            </button>
                        );
                    })}
                </div>
            </BottomSheet>
        </>
    );
}
