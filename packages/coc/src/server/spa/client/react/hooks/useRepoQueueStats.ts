/**
 * useRepoQueueStats — returns running/queued counts for a given workspace.
 * Reads from QueueContext's repoQueueMap, falling back to zeros.
 */

import { useMemo } from 'react';
import { useQueue } from '../context/QueueContext';

export interface RepoQueueStats {
    running: number;
    queued: number;
}

export function useRepoQueueStats(workspaceId: string): RepoQueueStats {
    const { state } = useQueue();
    return useMemo(() => {
        const entry = state.repoQueueMap[workspaceId];
        if (!entry) return { running: 0, queued: 0 };
        return {
            running: entry.stats?.running ?? entry.running?.length ?? 0,
            queued: entry.stats?.queued ?? entry.queued?.length ?? 0,
        };
    }, [state.repoQueueMap, workspaceId]);
}
