/**
 * useRepoQueueStats — returns running/queued counts for a given workspace.
 * Reads from QueueContext's repoQueueMap, falling back to zeros.
 *
 * running/queued count all visible tasks (everything except hidden `chat-followup`).
 */

import { useMemo } from 'react';
import { useQueue } from '../context/QueueContext';

export interface RepoQueueStats {
    running: number;
    queued: number;
}

const isHidden = (t: { type?: string; payload?: any }) => t.type === 'chat' && t.payload?.processId;

export function useRepoQueueStats(workspaceId: string): RepoQueueStats {
    const { state } = useQueue();
    return useMemo(() => {
        const entry = state.repoQueueMap[workspaceId];
        if (!entry) return { running: 0, queued: 0 };
        const runningArr = entry.running ?? [];
        const queuedArr = entry.queued ?? [];
        return {
            running: runningArr.filter(t => !isHidden(t)).length,
            queued: queuedArr.filter(t => !isHidden(t)).length,
        };
    }, [state.repoQueueMap, workspaceId]);
}
