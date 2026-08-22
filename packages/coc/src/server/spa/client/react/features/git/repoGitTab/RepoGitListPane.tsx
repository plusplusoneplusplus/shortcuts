/**
 * RepoGitListPane — the Git tab's left-hand list surface.
 *
 * Header slot, commit search, the behind-warning banner, refresh/action error
 * banners, the repo sections (branch changes, working tree, worktrees), the
 * conflict and reorder bars, the "opened by ID" row, the commit list, and the
 * load-more footer.
 *
 * Presentational: every value and callback arrives as a prop, so the same
 * subtree serves both the standalone layout and the split-workspace list slot —
 * only the wrapper classes differ (the split shell owns width/dividers, so no
 * per-panel width style or mobile hide-toggle there).
 */

import type { RefObject } from 'react';
import { CommitList, type GitCommitItem } from '../commits/CommitList';
import { BranchChanges, type BranchRangeInfo } from '../branches/BranchChanges';
import { WorkingTree } from '../working-tree/WorkingTree';
import { WorktreeList } from '../working-tree/WorktreeList';
import { isGitCommitLookupEnabled } from '../../../utils/config';
import { isLookupCandidate } from './useRepoGitSelection';
import type { GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';
import type { GitRepoStateInfo } from './types';

export interface RepoGitListPaneProps {
    workspaceId: string;
    /** Split-workspace mode uses the compact skin and drops the width/hide logic. */
    isSplitWorkspace: boolean;
    /** True when the toolbar is portaled into the split panel's section header. */
    headerHoisted: boolean;
    /** Desktop width, applied via a scoped style tag in the standalone layout. */
    sidebarWidth: number;
    /** Whether a detail view is open — drives the mobile hide-the-list toggle. */
    detailOpen: boolean;
    panelRef: RefObject<HTMLElement>;
    onPanelKeyDown: (e: React.KeyboardEvent) => void;
    /** The `GitPanelHeader`, rendered here unless it has been hoisted. */
    header: React.ReactNode;

    // Search
    searchVisible: boolean;
    searchQuery: string;
    searchInputRef: RefObject<HTMLInputElement>;
    onSearchQueryChange: (query: string) => void;
    onHideSearch: () => void;
    onCommitLookup: (sha: string) => void;
    commitLookupLoading: boolean;
    commitLookupError: string | null;
    onDismissCommitLookupError: () => void;

    // Banners
    behind: number;
    onDefaultBranch: boolean;
    refreshError: string | null;
    onDismissRefreshError: () => void;
    actionError: string | null;
    onDismissActionError: () => void;

    // Repo sections
    branchRangeData: BranchRangeInfo | null;
    branchRangeFiles: any[];
    baseMode: GitRangeBaseMode;
    selectedBranchFile: string | null;
    onBranchFileSelect: (filePath: string) => void;
    onBranchContextMenu: (e: React.MouseEvent) => void;
    onBranchRangeSelect: () => void;
    workingChangesRefreshKey: number;
    onRefresh: () => void;
    selectedWorkingTreeFile: string | null;
    onWorkingTreeFileSelect: (filePath: string, stage: 'staged' | 'unstaged' | 'untracked') => void;
    onAllWorkingCommentsClick: () => void;

    // Conflict banner
    repoState: GitRepoStateInfo | null;
    onConflictResolveAI: () => void;
    onConflictContinue: () => void;
    onConflictAbort: () => void;

    // Reorder bar
    pendingReorder: GitCommitItem[] | null;
    onApplyReorder: () => void;
    onCancelReorder: () => void;

    // Opened-by-ID row
    openedCommit: GitCommitItem | null;

    // Commit list
    commits: GitCommitItem[];
    unpushedCount: number;
    selectedCommit: GitCommitItem | null;
    selectedHashes: ReadonlySet<string>;
    selectedCommitFile: { hash: string; filePath: string } | null;
    initialCommitHash: string | null;
    onSelect: (commit: GitCommitItem) => void;
    onMultiSelect: (commits: GitCommitItem[]) => void;
    onCommitFileSelect: (hash: string, filePath: string) => void;
    onCommitContextMenu: (e: React.MouseEvent, commitHash: string) => void;
    onReorder: (order: GitCommitItem[]) => void;
    repoRoot: string | undefined;
    isMobileSelecting: boolean;
    onMobileSelectingChange: (selecting: boolean) => void;
    onSwipeAction: (action: 'review' | 'ask-ai' | 'more', commitHash: string) => void;
    classifiedHashes: ReadonlySet<string>;
    onOpenAsPopup: (commit: GitCommitItem) => void;

    // Load more
    hasMore: boolean;
    isLoadingMore: boolean;
    onLoadMore: () => void;
}

/** Dismissible red banner used by the refresh / action / lookup error rows. */
function ErrorBanner({ message, onDismiss, testId }: {
    message: string; onDismiss: () => void; testId: string;
}) {
    return (
        <div
            className="px-4 py-1.5 text-xs text-[#d32f2f] dark:text-[#f48771] bg-[#fdecea] dark:bg-[#3c2020] border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex items-start justify-between gap-2"
            data-testid={testId}
        >
            <span>{message}</span>
            <button
                onClick={onDismiss}
                className="text-[#d32f2f] dark:text-[#f48771] hover:opacity-70 leading-none shrink-0"
                aria-label="Dismiss error"
                data-testid={`${testId}-dismiss`}
                type="button"
            >
                ×
            </button>
        </div>
    );
}

export function RepoGitListPane(props: RepoGitListPaneProps) {
    const {
        isSplitWorkspace, headerHoisted, sidebarWidth, detailOpen, panelRef, onPanelKeyDown, header,
        searchVisible, searchQuery, searchInputRef, onSearchQueryChange, onHideSearch, onCommitLookup,
        commitLookupLoading, commitLookupError, onDismissCommitLookupError,
        behind, onDefaultBranch, refreshError, onDismissRefreshError, actionError, onDismissActionError,
        repoState, pendingReorder, openedCommit, commits, unpushedCount, hasMore, isLoadingMore, onLoadMore,
    } = props;

    // The compact ahead/behind badge in GitPanelHeader already shows the ahead
    // count, so an "N commits ahead" row here would duplicate the badge and waste
    // vertical space. Only the actionable "behind — consider pulling" warning stays.
    const scenarioBanner = !onDefaultBranch && behind > 0 ? (
        <div
            className="px-4 py-1.5 text-xs border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fff3cd] dark:bg-[#3c3520] text-[#856404] dark:text-[#ffc107]"
            data-testid="git-scenario-banner"
        >
            {`↓${behind} commit${behind !== 1 ? 's' : ''} behind`} — consider pulling
        </div>
    ) : null;

    const commitListPanel = searchQuery && commits.length === 0 ? (
        <div className="text-sm text-[#848484] py-8 text-center px-4" data-testid="git-search-empty">
            No commits match &ldquo;{searchQuery}&rdquo;
        </div>
    ) : (
        <CommitList
            title="History"
            commits={pendingReorder || commits}
            unpushedCount={searchQuery ? 0 : unpushedCount}
            selectedHash={props.selectedCommit?.hash}
            selectedHashes={props.selectedHashes}
            selectedFile={props.selectedCommitFile}
            initialExpandedHash={props.initialCommitHash ? props.selectedCommit?.hash : null}
            onSelect={props.onSelect}
            onMultiSelect={props.onMultiSelect}
            onFileSelect={props.onCommitFileSelect}
            onCommitContextMenu={props.onCommitContextMenu}
            workspaceId={props.workspaceId}
            reorderable={!searchQuery && unpushedCount > 1}
            onReorder={props.onReorder}
            repoRoot={props.repoRoot}
            isMobileSelecting={props.isMobileSelecting}
            onMobileSelectingChange={props.onMobileSelectingChange}
            onSwipeAction={props.onSwipeAction}
            classifiedHashes={props.classifiedHashes}
            onDoubleClick={props.onOpenAsPopup}
        />
    );

    const shaLookupReady = isGitCommitLookupEnabled() && isLookupCandidate(searchQuery.trim());

    return (
        <aside
            ref={panelRef}
            className={isSplitWorkspace
                ? 'w-full flex-1 min-h-0 overflow-y-auto bg-[#f3f3f3] dark:bg-[#252526]'
                : `w-full lg:shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]${detailOpen ? ' hidden lg:block' : ''}`}
            data-testid="git-commit-list-panel"
            onKeyDown={onPanelKeyDown}
        >
            {!isSplitWorkspace && (
                <style>{`@media (min-width: 1024px) { [data-testid="git-commit-list-panel"] { width: ${sidebarWidth}px !important; } }`}</style>
            )}
            {!headerHoisted && header}
            {/* Search input (hidden by default; revealed by Ctrl+F or `/`).
                Kept mounted whenever a query is set so filtered results stay
                visible even if the bar was toggled. Filter-bar style: subtle
                background card containing a bordered search box. */}
            {(searchVisible || searchQuery) && (
            <div
                className={`${isSplitWorkspace ? 'px-2 py-1' : 'px-2.5 py-1.5'} border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#252526]`}
                data-testid="git-search-bar"
            >
                <div className={`flex items-center gap-1.5 px-2 py-[3px] rounded-md border bg-white dark:bg-[#2d2d2d] focus-within:border-[#0078d4] focus-within:ring-2 focus-within:ring-[#0078d4]/20 ${searchQuery ? 'border-[#0078d4]' : 'border-[#d0d0d0] dark:border-[#3c3c3c]'}`}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#999] dark:text-[#888]" aria-hidden="true">
                        <path d="M6.5 1a5.5 5.5 0 1 0 3.547 9.714l3.37 3.369a.75.75 0 1 0 1.06-1.06l-3.369-3.37A5.5 5.5 0 0 0 6.5 1zm-4 5.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" fill="currentColor"/>
                    </svg>
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={e => onSearchQueryChange(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                // AC-02: Escape hides + clears the search bar.
                                searchInputRef.current?.blur();
                                onHideSearch();
                                return;
                            }
                            // SHA lookup on Enter (feature-gated)
                            if (e.key === 'Enter' && isGitCommitLookupEnabled() && isLookupCandidate(searchQuery.trim())) {
                                e.preventDefault();
                                onCommitLookup(searchQuery.trim());
                            }
                        }}
                        placeholder={isSplitWorkspace ? 'Search commits…' : 'Search subject, hash, author, path…'}
                        className={`flex-1 bg-transparent outline-none leading-5 text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#999] min-w-0 py-px ${isSplitWorkspace ? 'text-[12px]' : 'text-[13px]'}`}
                        data-testid="git-search-input"
                        aria-label="Search commits by subject, hash, author, or path"
                    />
                    {searchQuery ? (
                        <>
                            {shaLookupReady && (
                                commitLookupLoading ? (
                                    <span
                                        className="shrink-0 text-[11px] text-[#848484] dark:text-[#888] leading-none pr-1 whitespace-nowrap animate-pulse"
                                        data-testid="git-commit-lookup-loading"
                                    >
                                        Looking up…
                                    </span>
                                ) : (
                                    <span
                                        className="shrink-0 text-[11px] text-[#0078d4] dark:text-[#3794ff] leading-none pr-1 whitespace-nowrap"
                                        data-testid="git-commit-lookup-hint"
                                    >
                                        ↵ open commit
                                    </span>
                                )
                            )}
                            <button
                                onClick={() => { onHideSearch(); onDismissCommitLookupError(); }}
                                className="shrink-0 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] leading-none px-1"
                                data-testid="git-search-clear"
                                aria-label="Clear search"
                                type="button"
                            >
                                ×
                            </button>
                        </>
                    ) : (
                        <span
                            className="shrink-0 inline-flex items-center justify-center min-w-[16px] h-[18px] px-1 font-mono text-[11px] leading-none text-[#999] dark:text-[#888] border border-[#d0d0d0] dark:border-[#3c3c3c] rounded bg-[#f5f5f5] dark:bg-[#252526]"
                            aria-hidden="true"
                            data-testid="git-search-kbd"
                            title="Press / to focus search"
                        >
                            /
                        </span>
                    )}
                </div>
            </div>
            )}
            {scenarioBanner}
            {refreshError && (
                <ErrorBanner message={refreshError} onDismiss={onDismissRefreshError} testId="git-refresh-error" />
            )}
            {actionError && (
                <ErrorBanner message={actionError} onDismiss={onDismissActionError} testId="git-action-error" />
            )}
            <div
                className={`repo-sections grid ${isSplitWorkspace ? 'gap-1 px-1.5 py-1' : 'gap-2 px-2 py-2'} border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]`}
                data-testid="git-repo-sections"
            >
                <BranchChanges
                    workspaceId={props.workspaceId}
                    branchRangeData={props.branchRangeData}
                    initialFiles={props.branchRangeFiles}
                    onDefaultBranch={onDefaultBranch}
                    onFileSelect={props.onBranchFileSelect}
                    selectedFile={props.selectedBranchFile}
                    onBranchContextMenu={props.onBranchContextMenu}
                    onBranchRangeSelect={props.onBranchRangeSelect}
                    compact={isSplitWorkspace}
                    baseMode={props.baseMode}
                />
                <WorkingTree
                    workspaceId={props.workspaceId}
                    onRefresh={props.onRefresh}
                    onFileSelect={props.onWorkingTreeFileSelect}
                    selectedFilePath={props.selectedWorkingTreeFile}
                    refreshKey={props.workingChangesRefreshKey}
                    onAllCommentsClick={props.onAllWorkingCommentsClick}
                    compact={isSplitWorkspace}
                />
                <WorktreeList
                    workspaceId={props.workspaceId}
                    refreshKey={props.workingChangesRefreshKey}
                    compact={isSplitWorkspace}
                />
            </div>
            {repoState && repoState.operation !== 'none' && (
                <div
                    className="mx-2 my-2 p-3 rounded border border-[#e5a100] dark:border-[#cca700] bg-[#fff3cd] dark:bg-[#3d3522] text-xs"
                    data-testid="conflict-banner"
                >
                    <div className="font-semibold text-[#856404] dark:text-[#e5c07b] mb-1">
                        ⚠️ {repoState.operation.charAt(0).toUpperCase() + repoState.operation.slice(1)} in progress
                        {repoState.conflictFiles.length > 0 && ` — ${repoState.conflictFiles.length} conflict file${repoState.conflictFiles.length !== 1 ? 's' : ''}`}
                    </div>
                    <div className="flex gap-2 mt-2 flex-wrap">
                        <button
                            onClick={props.onConflictResolveAI}
                            className="px-2 py-1 rounded text-xs font-medium bg-[#007acc] text-white hover:bg-[#005fa3]"
                            data-testid="conflict-resolve-ai-btn"
                        >
                            Resolve with AI ⚡
                        </button>
                        <button
                            onClick={props.onConflictContinue}
                            className="px-2 py-1 rounded text-xs font-medium bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#333] dark:text-[#ccc] hover:bg-[#ccc] dark:hover:bg-[#555]"
                            data-testid="conflict-continue-btn"
                        >
                            Continue
                        </button>
                        <button
                            onClick={props.onConflictAbort}
                            className="px-2 py-1 rounded text-xs font-medium bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#d32f2f] hover:bg-[#ccc] dark:hover:bg-[#555]"
                            data-testid="conflict-abort-btn"
                        >
                            Abort
                        </button>
                    </div>
                </div>
            )}
            {pendingReorder && (
                <div
                    className="mx-2 my-2 p-3 rounded border border-[#0078d4] dark:border-[#3794ff] bg-[#e8f0fe] dark:bg-[#1a2744] text-xs flex items-center justify-between"
                    data-testid="reorder-confirmation-bar"
                >
                    <span className="text-[#333] dark:text-[#ccc]">
                        Reorder {unpushedCount} unpushed commit{unpushedCount !== 1 ? 's' : ''}?
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={props.onApplyReorder}
                            className="px-2 py-1 rounded text-xs font-medium bg-[#007acc] text-white hover:bg-[#005fa3]"
                            data-testid="reorder-apply-btn"
                        >
                            Apply
                        </button>
                        <button
                            onClick={props.onCancelReorder}
                            className="px-2 py-1 rounded text-xs font-medium bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#333] dark:text-[#ccc] hover:bg-[#ccc] dark:hover:bg-[#555]"
                            data-testid="reorder-cancel-btn"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            {commitLookupError && (
                <div className="px-4 py-1.5 text-xs text-[#d32f2f] dark:text-[#f48771] bg-[#fdecea] dark:bg-[#3c2020] border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex items-center justify-between" data-testid="git-commit-lookup-error">
                    <span>{commitLookupError}</span>
                    <button
                        onClick={onDismissCommitLookupError}
                        className="ml-2 text-[#d32f2f] dark:text-[#f48771] hover:opacity-70 leading-none"
                        aria-label="Dismiss error"
                        data-testid="git-commit-lookup-error-dismiss"
                        type="button"
                    >
                        ×
                    </button>
                </div>
            )}
            {openedCommit && (
                <div className="border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="git-opened-commit-section">
                    <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-semibold text-[#0078d4] dark:text-[#3794ff] tracking-wide uppercase">
                        Opened commit
                    </div>
                    <div
                        role="button"
                        tabIndex={0}
                        className={`flex items-center gap-2 px-2.5 py-2 text-[13px] cursor-pointer select-none hover:bg-[#e8f0fe] dark:hover:bg-[#1a2744] focus:outline-none focus:bg-[#e8f0fe] dark:focus:bg-[#1a2744]${props.selectedHashes.has(openedCommit.hash) ? ' bg-[#e8f0fe] dark:bg-[#1a2744] border-l-2 border-[#0078d4]' : ''}`}
                        onClick={() => props.onSelect(openedCommit)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onSelect(openedCommit); } }}
                        data-testid="git-opened-commit-row"
                    >
                        <span className="font-mono text-[11px] text-[#0078d4] dark:text-[#3794ff] shrink-0">{openedCommit.shortHash}</span>
                        <span className="flex-1 truncate text-[#1e1e1e] dark:text-[#ccc]">{openedCommit.subject}</span>
                        <span className="shrink-0 text-[10px] px-1 py-px rounded border border-[#0078d4]/40 text-[#0078d4] dark:text-[#3794ff] bg-[#0078d4]/5 leading-tight">by ID</span>
                    </div>
                </div>
            )}
            {commitListPanel}
            {hasMore && (
                <div className="px-4 py-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <button
                        onClick={onLoadMore}
                        disabled={isLoadingMore}
                        className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                        data-testid="git-load-more-btn"
                    >
                        {isLoadingMore ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
        </aside>
    );
}
