/**
 * useGitInfo — fetches the current branch's remote sync status for a workspace.
 *
 * Calls GET /api/workspaces/:id/git-info on mount and whenever workspaceId changes.
 * Returns ahead/behind counts (0 on error or when no remote tracking branch exists).
 */

import { useState, useEffect } from 'react';
import { fetchApi } from './useApi';

export interface GitInfo {
    branch: string | null;
    ahead: number;
    behind: number;
    dirty: boolean;
    loading: boolean;
    error: boolean;
}

const DEFAULT_GIT_INFO: GitInfo = {
    branch: null,
    ahead: 0,
    behind: 0,
    dirty: false,
    loading: true,
    error: false,
};

export function useGitInfo(workspaceId: string): GitInfo {
    const [state, setState] = useState<GitInfo>(DEFAULT_GIT_INFO);

    useEffect(() => {
        let cancelled = false;
        setState(prev => ({ ...prev, loading: true, error: false }));
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git-info`)
            .then((data: any) => {
                if (cancelled) return;
                setState({
                    branch: data?.branch ?? null,
                    ahead: data?.ahead ?? 0,
                    behind: data?.behind ?? 0,
                    dirty: data?.dirty ?? false,
                    loading: false,
                    error: false,
                });
            })
            .catch(() => {
                if (cancelled) return;
                setState({ branch: null, ahead: 0, behind: 0, dirty: false, loading: false, error: true });
            });
        return () => {
            cancelled = true;
        };
    }, [workspaceId]);

    return state;
}
