/**
 * RepoGitTab — Git commit history tab with UNPUSHED and HISTORY sections.
 *
 * Fetches commits from the git/commits API and splits them into
 * unpushed (ahead of remote) and pushed (history) sections.
 */

import { useState, useEffect } from 'react';
import { fetchApi } from '../hooks/useApi';
import { Spinner } from '../shared';
import { CommitList } from './CommitList';
import type { GitCommitItem } from './CommitList';

interface RepoGitTabProps {
    workspaceId: string;
}

export function RepoGitTab({ workspaceId }: RepoGitTabProps) {
    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [unpushedCount, setUnpushedCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits?limit=50`)
            .then(data => {
                setCommits(data.commits || []);
                setUnpushedCount(data.unpushedCount || 0);
            })
            .catch(err => setError(err.message || 'Failed to load commits'))
            .finally(() => setLoading(false));
    }, [workspaceId]);

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

    return (
        <div className="repo-git-tab flex flex-col" data-testid="repo-git-tab">
            {unpushedCount > 0 && (
                <CommitList
                    title="Unpushed"
                    commits={unpushed}
                    workspaceId={workspaceId}
                />
            )}
            <CommitList
                title="History"
                commits={history}
                workspaceId={workspaceId}
            />
        </div>
    );
}
