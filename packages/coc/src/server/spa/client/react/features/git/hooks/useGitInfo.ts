/**
 * useGitInfo — fetches the current branch's remote sync status for a workspace.
 *
 * Calls GET /api/workspaces/:id/git-info on mount and whenever workspaceId changes.
 * Returns ahead/behind counts (0 on error or when no remote tracking branch exists).
 */

import { useState, useEffect } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';

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
    // Route to the workspace's clone: a remote clone reads git-info from its own
    // server, a local clone from the default origin (AC-07).
    const client = useCocClient(workspaceId);

    useEffect(() => {
        let cancelled = false;
        setState(prev => ({ ...prev, loading: true, error: false }));
        client.workspaces.gitInfo(workspaceId)
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
    }, [workspaceId, client]);

    return state;
}
