/**
 * RepoGitTab — Git commit history tab with left/right split layout.
 *
 * Left panel: GitPanelHeader + scenario banner + scrollable commit list
 * (UNPUSHED + HISTORY sections).
 * Right panel: detail view for the selected commit (metadata, files, diff).
 * Auto-selects the most recent commit on load.
 * Falls back to stacked vertical layout on narrow viewports (<900px).
 *
 * Branch-range data is fetched here and passed down to BranchChanges and
 * GitPanelHeader so both can display branch/ahead/behind information.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner } from '../shared';
import { CommitList } from './CommitList';
import { CommitDetail } from './CommitDetail';
import { BranchChanges } from './BranchChanges';
import { BranchFileDiff } from './BranchFileDiff';
import { GitPanelHeader } from './GitPanelHeader';
import type { GitCommitItem } from './CommitList';
import type { BranchRangeInfo } from './BranchChanges';

interface RepoGitTabProps {
    workspaceId: string;
}

type RightPanelView =
    | { type: 'commit'; commit: GitCommitItem }
    | { type: 'branch-file'; filePath: string };

export function RepoGitTab({ workspaceId }: RepoGitTabProps) {
    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [unpushedCount, setUnpushedCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [rightPanelView, setRightPanelView] = useState<RightPanelView | null>(null);

    // Branch-range state (lifted from BranchChanges)
    const [branchRangeData, setBranchRangeData] = useState<BranchRangeInfo | null>(null);
    const [onDefaultBranch, setOnDefaultBranch] = useState(false);
    const [branchName, setBranchName] = useState<string>('');
    const [ahead, setAhead] = useState(0);
    const [behind, setBehind] = useState(0);

    const fetchCommits = useCallback(() => {
        return fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits?limit=50`)
            .then(data => {
                const loaded = data.commits || [];
                setCommits(loaded);
                setUnpushedCount(data.unpushedCount || 0);
                return loaded;
            });
    }, [workspaceId]);

    const fetchBranchRange = useCallback(() => {
        return fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range`)
            .then(data => {
                if (data.onDefaultBranch) {
                    setOnDefaultBranch(true);
                    setBranchRangeData(null);
                    setBranchName(data.branchName || data.defaultBranch || 'main');
                    setAhead(0);
                    setBehind(0);
                } else {
                    setOnDefaultBranch(false);
                    const rangeInfo: BranchRangeInfo = {
                        baseRef: data.baseRef,
                        headRef: data.headRef,
                        commitCount: data.commitCount,
                        additions: data.additions,
                        deletions: data.deletions,
                        mergeBase: data.mergeBase,
                        branchName: data.branchName,
                        fileCount: Array.isArray(data.files) ? data.files.length : 0,
                    };
                    setBranchRangeData(rangeInfo);
                    setBranchName(data.branchName || data.headRef || '');
                    setAhead(data.commitCount || 0);
                    setBehind(data.behindCount || 0);
                }
            })
            .catch(() => {
                setOnDefaultBranch(true);
                setBranchRangeData(null);
            });
    }, [workspaceId]);

    // Initial load
    useEffect(() => {
        setLoading(true);
        setError(null);
        Promise.all([fetchCommits(), fetchBranchRange()])
            .then(([loaded]) => {
                if (loaded.length > 0) {
                    setRightPanelView({ type: 'commit', commit: loaded[0] });
                } else {
                    setRightPanelView(null);
                }
            })
            .catch(err => setError(err.message || 'Failed to load commits'))
            .finally(() => setLoading(false));
    }, [workspaceId, fetchCommits, fetchBranchRange]);

    // Refresh all data (non-blocking, keeps current content visible)
    const refreshAll = useCallback(() => {
        if (refreshing) return;
        setRefreshing(true);
        setRefreshError(null);
        const prevSelectedHash = rightPanelView?.type === 'commit' ? rightPanelView.commit.hash : null;
        Promise.all([fetchCommits(), fetchBranchRange()])
            .then(([loaded]) => {
                // Retain selection if the commit still exists
                if (prevSelectedHash) {
                    const found = loaded.find((c: GitCommitItem) => c.hash === prevSelectedHash);
                    if (found) {
                        setRightPanelView({ type: 'commit', commit: found });
                    } else if (loaded.length > 0) {
                        setRightPanelView({ type: 'commit', commit: loaded[0] });
                    } else {
                        setRightPanelView(null);
                    }
                } else if (rightPanelView?.type === 'branch-file') {
                    // Keep the branch-file view as-is during refresh
                } else if (loaded.length > 0) {
                    setRightPanelView({ type: 'commit', commit: loaded[0] });
                }
            })
            .catch(err => setRefreshError(err.message || 'Refresh failed'))
            .finally(() => setRefreshing(false));
    }, [refreshing, rightPanelView, fetchCommits, fetchBranchRange]);

    const handleSelect = useCallback((commit: GitCommitItem) => {
        setRightPanelView({ type: 'commit', commit });
    }, []);

    const handleFileSelect = useCallback((filePath: string) => {
        setRightPanelView({ type: 'branch-file', filePath });
    }, []);

    // Keyboard shortcut: R to refresh when focused in left panel
    const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'r' || e.key === 'R') {
            if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
                e.preventDefault();
                refreshAll();
            }
        }
    }, [refreshAll]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8" data-testid="git-tab-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-[#d32f2f] dark:text-[#f48771]" data-testid="git-tab-error">
                {error}
            </div>
        );
    }

    const unpushed = commits.slice(0, unpushedCount);
    const history = commits.slice(unpushedCount);
    const selectedCommit = rightPanelView?.type === 'commit' ? rightPanelView.commit : null;
    const selectedBranchFile = rightPanelView?.type === 'branch-file' ? rightPanelView.filePath : null;

    // Scenario banner
    const scenarioBanner = (() => {
        if (onDefaultBranch) return null;
        const parts: string[] = [];
        if (ahead > 0) parts.push(`↑${ahead} commit${ahead !== 1 ? 's' : ''} ahead`);
        if (behind > 0) parts.push(`↓${behind} commit${behind !== 1 ? 's' : ''} behind`);
        if (parts.length === 0) return null;
        const isWarning = behind > 0;
        return (
            <div
                className={`px-4 py-1.5 text-xs border-b border-[#e0e0e0] dark:border-[#3c3c3c] ${
                    isWarning
                        ? 'bg-[#fff3cd] dark:bg-[#3c3520] text-[#856404] dark:text-[#ffc107]'
                        : 'bg-[#f0f9ff] dark:bg-[#1a2733] text-[#0078d4] dark:text-[#3794ff]'
                }`}
                data-testid="git-scenario-banner"
            >
                {parts.join(' · ')}
                {behind > 0 && ' — consider pulling'}
            </div>
        );
    })();

    const commitListPanel = (
        <>
            <CommitList
                title="Unpushed"
                commits={unpushed}
                selectedHash={selectedCommit?.hash}
                onSelect={handleSelect}
                showEmpty
                emptyMessage="Nothing to push — you're up to date"
            />
            <CommitList
                title="History"
                commits={history}
                selectedHash={selectedCommit?.hash}
                onSelect={handleSelect}
                defaultCollapsed={unpushedCount > 0}
            />
        </>
    );

    const detailPanel = rightPanelView?.type === 'commit' ? (
        <CommitDetail
            key={rightPanelView.commit.hash}
            workspaceId={workspaceId}
            hash={rightPanelView.commit.hash}
            subject={rightPanelView.commit.subject}
            author={rightPanelView.commit.author}
            date={rightPanelView.commit.date}
            parentHashes={rightPanelView.commit.parentHashes}
        />
    ) : rightPanelView?.type === 'branch-file' ? (
        <BranchFileDiff
            key={rightPanelView.filePath}
            workspaceId={workspaceId}
            filePath={rightPanelView.filePath}
        />
    ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-[#848484]" data-testid="git-detail-empty">
            Select a commit to view details
        </div>
    );

    return (
        <div className="repo-git-tab flex flex-col md-split:flex-row h-full overflow-hidden" data-testid="repo-git-tab">
            {/* Left panel — commit list */}
            <aside
                className="w-full md-split:w-[320px] md-split:shrink-0 overflow-y-auto border-b md-split:border-b-0 md-split:border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]"
                data-testid="git-commit-list-panel"
                onKeyDown={handlePanelKeyDown}
            >
                <GitPanelHeader
                    branch={branchName || 'HEAD'}
                    ahead={ahead}
                    behind={behind}
                    refreshing={refreshing}
                    onRefresh={refreshAll}
                />
                {scenarioBanner}
                {refreshError && (
                    <div className="px-4 py-1.5 text-xs text-[#d32f2f] dark:text-[#f48771] bg-[#fdecea] dark:bg-[#3c2020] border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="git-refresh-error">
                        {refreshError}
                    </div>
                )}
                <BranchChanges
                    workspaceId={workspaceId}
                    branchRangeData={branchRangeData}
                    onDefaultBranch={onDefaultBranch}
                    onFileSelect={handleFileSelect}
                    selectedFile={selectedBranchFile}
                />
                {commitListPanel}
            </aside>
            {/* Right panel — commit detail */}
            <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]" data-testid="git-detail-panel">
                {detailPanel}
            </main>
        </div>
    );
}
