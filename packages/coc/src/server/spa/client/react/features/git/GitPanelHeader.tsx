/**
 * GitPanelHeader — fixed header strip for the git left panel.
 *
 * Shows branch name pill, ahead/behind badge, a split action button
 * (Pull as default + chevron dropdown for Fetch/Pull/Push), and a refresh button.
 */

import { useState, useEffect, useRef } from 'react';
import { formatRelativeTime } from '../../utils/format';

interface GitPanelHeaderProps {
    branch: string;
    ahead: number;
    behind: number;
    refreshing: boolean;
    onRefresh: () => void;
    onBranchClick?: () => void;
    onFetch?: () => void;
    onPull?: () => void;
    onPush?: () => void;
    onRebaseAutosquash?: () => void;
    fetching?: boolean;
    pulling?: boolean;
    pushing?: boolean;
    rebasing?: boolean;
    lastRefreshedAt?: number | null;
    /**
     * Slim single-row variant for when the toolbar is hoisted into the
     * split-workspace "Git" section header: drops the strip's own
     * background/border/sticky chrome, shrinks the pills and buttons to fit a
     * 22px header row, and shortens the relative timestamp ("5m" not "5m ago").
     */
    compact?: boolean;
}

const spinKeyframes = `@keyframes gitRefreshSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .git-refresh-spin { animation: gitRefreshSpin 1s linear infinite; }`;

export function GitPanelHeader({ branch, ahead, behind, refreshing, onRefresh, onBranchClick, onFetch, onPull, onPush, onRebaseAutosquash, fetching, pulling, pushing, rebasing, lastRefreshedAt, compact }: GitPanelHeaderProps) {
    const hasAheadBehind = ahead > 0 || behind > 0;
    const hasAnyAction = onFetch || onPull || onPush || onRebaseAutosquash;
    const isActioning = fetching || pulling || pushing || rebasing;

    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Force re-render every 30s so the relative timestamp stays current
    const [, setTick] = useState(0);
    useEffect(() => {
        if (lastRefreshedAt == null) return;
        const id = setInterval(() => setTick(t => t + 1), 30_000);
        return () => clearInterval(id);
    }, [lastRefreshedAt]);

    useEffect(() => {
        if (!dropdownOpen) return;
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [dropdownOpen]);

    function handleAction(fn?: () => void) {
        setDropdownOpen(false);
        fn?.();
    }

    return (
        <>
            <style>{spinKeyframes}</style>
            <div
            className={compact
                ? 'git-panel-header git-panel-header--compact flex flex-1 items-center gap-1 min-w-0 px-1'
                : 'git-panel-header flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#252526] sticky top-0 z-20 min-h-[38px]'}
            data-testid="git-panel-header"
        >
            {/* Branch pill */}
            <button
                className={`inline-flex items-center font-mono font-semibold border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white/70 dark:bg-[#2d2d2d]/70 text-[#1e1e1e] dark:text-[#ccc] rounded-full truncate ${compact ? 'gap-1 px-1.5 py-0 text-[10px] leading-[15px] max-w-[160px]' : 'gap-1.5 px-2 py-[2px] text-[11px] leading-[18px] max-w-[360px]'} ${onBranchClick ? 'cursor-pointer hover:bg-white hover:border-[#0078d4] dark:hover:bg-[#2d2d2d] focus:outline-none focus:ring-2 focus:ring-[#0078d4]' : 'cursor-default'}`}
                title={branch}
                data-testid="git-branch-pill"
                onClick={onBranchClick}
                type="button"
                disabled={!onBranchClick}
            >
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6A1.5 1.5 0 004.5 10v.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.993 2.993 0 016 6.5h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
                </svg>
                <span className="truncate">{branch}</span>
            </button>

            {/* Ahead/behind badge */}
            {hasAheadBehind && (
                <span
                    className={`inline-flex items-center gap-1 font-mono font-semibold text-[#616161] dark:text-[#999] tabular-nums whitespace-nowrap ${compact ? 'text-[10px] leading-[15px]' : 'text-[11px] leading-[18px]'}`}
                    data-testid="git-ahead-behind-badge"
                >
                    {ahead > 0 && <span className="text-[#16825d]" data-testid="git-ahead-count">↑{ahead}</span>}
                    {behind > 0 && <span className="text-[#d32f2f]" data-testid="git-behind-count">↓{behind}</span>}
                </span>
            )}

            {/* Spacer */}
            <div className="flex-1 min-w-[4px]" />

            {/* Split action button (Fetch / Pull / Push) */}
            {hasAnyAction && (
                <div
                    className="relative inline-flex"
                    ref={dropdownRef}
                    data-testid="git-sync-split-btn"
                >
                    <div className={`flex items-stretch rounded-md overflow-hidden border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] ${compact ? 'h-[18px]' : 'h-6'}`}>
                        {/* Primary action: Pull */}
                        <button
                            className={`git-action-btn flex items-center gap-1 hover:bg-[#f3f3f3] dark:hover:bg-[#3c3c3c] transition-colors text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc] disabled:opacity-50 ${compact ? 'px-1 text-[10px] leading-[16px]' : 'px-1.5 text-[11px] leading-[22px]'}`}
                            onClick={() => handleAction(onPull)}
                            disabled={!!isActioning}
                            title="Pull --rebase from remote"
                            data-testid="git-sync-primary-btn"
                        >
                            {isActioning ? (
                                <svg className="w-3 h-3 git-refresh-spin" viewBox="0 0 16 16" fill="currentColor">
                                    <path fillRule="evenodd" d="M8 3a5 5 0 104.546 2.914.5.5 0 01.908-.418A6 6 0 118 2v1z" />
                                    <path d="M8 4.466V.534a.25.25 0 01.41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 018 4.466z" />
                                </svg>
                            ) : (
                                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                                    <path fillRule="evenodd" d="M8 1a.5.5 0 01.5.5v11.793l3.146-3.147a.5.5 0 01.708.708l-4 4a.5.5 0 01-.708 0l-4-4a.5.5 0 01.708-.708L7.5 13.293V1.5A.5.5 0 018 1z" />
                                </svg>
                            )}
                            Pull
                        </button>

                        {/* Chevron toggle */}
                        <button
                            className={`git-action-btn flex items-center px-1 border-l border-[#e0e0e0] dark:border-[#3c3c3c] hover:bg-[#f3f3f3] dark:hover:bg-[#3c3c3c] transition-colors text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc] disabled:opacity-50 ${compact ? 'text-[10px] leading-[16px]' : 'text-[11px] leading-[22px]'}`}
                            onClick={() => setDropdownOpen(prev => !prev)}
                            disabled={!!isActioning}
                            title="More git actions"
                            data-testid="git-sync-dropdown-toggle"
                            type="button"
                        >
                            ▾
                        </button>
                    </div>

                    {/* Dropdown menu */}
                    {dropdownOpen && (
                        <div
                            className="absolute right-0 top-full mt-1 z-30 min-w-[110px] bg-[#f5f5f5] dark:bg-[#2d2d2d] border border-[#d0d0d0] dark:border-[#555] rounded shadow-md py-1"
                            data-testid="git-sync-dropdown"
                        >
                            {onFetch && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-1 text-xs text-[#1e1e1e] dark:text-[#ccc] hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors"
                                    onClick={() => handleAction(onFetch)}
                                    title="Fetch from remote"
                                    data-testid="git-fetch-btn"
                                    type="button"
                                >
                                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M8 1a.5.5 0 01.5.5v5.793l2.146-2.147a.5.5 0 01.708.708l-3 3a.5.5 0 01-.708 0l-3-3a.5.5 0 11.708-.708L7.5 7.293V1.5A.5.5 0 018 1zM2 13.5a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z" />
                                    </svg>
                                    Fetch
                                </button>
                            )}
                            {onPull && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-1 text-xs text-[#1e1e1e] dark:text-[#ccc] hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors"
                                    onClick={() => handleAction(onPull)}
                                    title="Pull --rebase from remote"
                                    data-testid="git-pull-btn"
                                    type="button"
                                >
                                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                                        <path fillRule="evenodd" d="M8 1a.5.5 0 01.5.5v11.793l3.146-3.147a.5.5 0 01.708.708l-4 4a.5.5 0 01-.708 0l-4-4a.5.5 0 01.708-.708L7.5 13.293V1.5A.5.5 0 018 1z" />
                                    </svg>
                                    Pull
                                </button>
                            )}
                            {onPush && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-1 text-xs text-[#1e1e1e] dark:text-[#ccc] hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors"
                                    onClick={() => handleAction(onPush)}
                                    title="Push to remote"
                                    data-testid="git-push-btn"
                                    type="button"
                                >
                                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                                        <path fillRule="evenodd" d="M8 15a.5.5 0 01-.5-.5V2.707L4.354 5.854a.5.5 0 11-.708-.708l4-4a.5.5 0 01.708 0l4 4a.5.5 0 01-.708.708L8.5 2.707V14.5a.5.5 0 01-.5.5z" />
                                    </svg>
                                    Push
                                </button>
                            )}
                            {onRebaseAutosquash && (
                                <button
                                    className="flex w-full items-center gap-2 px-3 py-1 text-xs text-[#1e1e1e] dark:text-[#ccc] hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors disabled:opacity-50"
                                    onClick={() => handleAction(onRebaseAutosquash)}
                                    disabled={!!rebasing}
                                    title="Non-interactive git rebase -i --autosquash against upstream"
                                    data-testid="git-rebase-autosquash-btn"
                                    type="button"
                                >
                                    {rebasing ? (
                                        <svg className="w-3 h-3 flex-shrink-0 git-refresh-spin" viewBox="0 0 16 16" fill="currentColor">
                                            <path fillRule="evenodd" d="M8 3a5 5 0 104.546 2.914.5.5 0 01.908-.418A6 6 0 118 2v1z" />
                                            <path d="M8 4.466V.534a.25.25 0 01.41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 018 4.466z" />
                                        </svg>
                                    ) : (
                                        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                                            <path fillRule="evenodd" d="M8 3a5 5 0 104.546 2.914.5.5 0 01.908-.418A6 6 0 118 2v1z" />
                                            <path d="M8 4.466V.534a.25.25 0 01.41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 018 4.466z" />
                                        </svg>
                                    )}
                                    Rebase (autosquash)
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Last refreshed timestamp */}
            {lastRefreshedAt != null && (
                <span
                    className={`text-[#999] dark:text-[#777] whitespace-nowrap hidden sm:inline tabular-nums ${compact ? 'text-[10px]' : 'text-[11px]'}`}
                    title={new Date(lastRefreshedAt).toLocaleString()}
                    data-testid="git-last-refreshed"
                >
                    {compact
                        ? formatRelativeTime(new Date(lastRefreshedAt).toISOString()).replace(/\s+ago$/, '')
                        : formatRelativeTime(new Date(lastRefreshedAt).toISOString())}
                </span>
            )}

            {/* Refresh button */}
            <button
                className={`git-refresh-btn flex items-center justify-center rounded-md hover:bg-white dark:hover:bg-[#2d2d2d] transition-colors text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc] disabled:opacity-50 ${compact ? 'w-[18px] h-[18px]' : 'w-6 h-6'}`}
                onClick={onRefresh}
                disabled={refreshing}
                title="Refresh git data"
                data-testid="git-refresh-btn"
            >
                <svg
                    className={`w-3.5 h-3.5 ${refreshing ? 'git-refresh-spin' : ''}`}
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    data-testid="git-refresh-icon"
                >
                    <path fillRule="evenodd" d="M8 3a5 5 0 104.546 2.914.5.5 0 01.908-.418A6 6 0 118 2v1z" />
                    <path d="M8 4.466V.534a.25.25 0 01.41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 018 4.466z" />
                </svg>
            </button>
        </div>
        </>
    );
}
