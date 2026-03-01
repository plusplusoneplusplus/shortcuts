/**
 * RepoGitTab — Git commit history tab with left/right split layout.
 *
 * Left panel: scrollable commit list (UNPUSHED + HISTORY sections).
 * Right panel: detail view for the selected commit (metadata, files, diff).
 * Auto-selects the most recent commit on load.
 * Falls back to stacked vertical layout on narrow viewports (<900px).
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner } from '../shared';
import { CommitList } from './CommitList';
import { CommitDetail } from './CommitDetail';
import { BranchChanges } from './BranchChanges';
import type { GitCommitItem } from './CommitList';

interface RepoGitTabProps {
    workspaceId: string;
}

export function RepoGitTab({ workspaceId }: RepoGitTabProps) {
    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [unpushedCount, setUnpushedCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedCommit, setSelectedCommit] = useState<GitCommitItem | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits?limit=50`)
            .then(data => {
                const loaded = data.commits || [];
                setCommits(loaded);
                setUnpushedCount(data.unpushedCount || 0);
                // Auto-select the most recent commit
                if (loaded.length > 0) {
                    setSelectedCommit(loaded[0]);
                } else {
                    setSelectedCommit(null);
                }
            })
            .catch(err => setError(err.message || 'Failed to load commits'))
            .finally(() => setLoading(false));
    }, [workspaceId]);

    const handleSelect = useCallback((commit: GitCommitItem) => {
        setSelectedCommit(commit);
    }, []);

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

    const commitListPanel = (
        <>
            {unpushedCount > 0 && (
                <CommitList
                    title="Unpushed"
                    commits={unpushed}
                    selectedHash={selectedCommit?.hash}
                    onSelect={handleSelect}
                />
            )}
            <CommitList
                title="History"
                commits={history}
                selectedHash={selectedCommit?.hash}
                onSelect={handleSelect}
            />
        </>
    );

    const detailPanel = selectedCommit ? (
        <CommitDetail
            key={selectedCommit.hash}
            workspaceId={workspaceId}
            hash={selectedCommit.hash}
            subject={selectedCommit.subject}
            author={selectedCommit.author}
            date={selectedCommit.date}
            parentHashes={selectedCommit.parentHashes}
        />
    ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-[#848484]" data-testid="git-detail-empty">
            Select a commit to view details
        </div>
    );

    return (
        <div className="repo-git-tab flex flex-col md-split:flex-row h-full overflow-hidden" data-testid="repo-git-tab">
            {/* Left panel — commit list */}
            <aside className="w-full md-split:w-[320px] md-split:shrink-0 overflow-y-auto border-b md-split:border-b-0 md-split:border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]" data-testid="git-commit-list-panel">
                <BranchChanges workspaceId={workspaceId} />
                {commitListPanel}
            </aside>
            {/* Right panel — commit detail */}
            <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]" data-testid="git-detail-panel">
                {detailPanel}
            </main>
        </div>
    );
}
