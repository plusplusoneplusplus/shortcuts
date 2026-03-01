/**
 * useRepoQueueStats — returns running/queued counts for a given workspace.
 * Reads from QueueContext's repoQueueMap, falling back to zeros.
 *
 * Returns queue-only counts (excluding chat tasks) plus separate chatRunning/chatQueued
 * so badges on the Queue and Chat tabs stay independent.
 */

import { useMemo } from 'react';
import { useQueue } from '../context/QueueContext';

export interface RepoQueueStats {
    running: number;
    queued: number;
    chatRunning: number;
    chatQueued: number;
    chatTotal: number;
}

const isChat = (t: { type?: string }) => t.type === 'chat';
const isNonChat = (t: { type?: string }) => t.type !== 'chat';

export function useRepoQueueStats(workspaceId: string): RepoQueueStats {
    const { state } = useQueue();
    return useMemo(() => {
        const entry = state.repoQueueMap[workspaceId];
        if (!entry) return { running: 0, queued: 0, chatRunning: 0, chatQueued: 0, chatTotal: 0 };
        const runningArr = entry.running ?? [];
        const queuedArr = entry.queued ?? [];
        const historyArr = entry.history ?? [];
        const chatRunning = runningArr.filter(isChat).length;
        const chatQueued = queuedArr.filter(isChat).length;
        return {
            running: runningArr.filter(isNonChat).length,
            queued: queuedArr.filter(isNonChat).length,
            chatRunning,
            chatQueued,
            chatTotal: chatRunning + chatQueued + historyArr.filter(isChat).length,
        };
    }, [state.repoQueueMap, workspaceId]);
}
