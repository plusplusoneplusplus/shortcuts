/**
 * useRepoQueueStats — returns running/queued counts for a given workspace.
 * Reads from QueueContext's repoQueueMap, falling back to zeros.
 *
 * running/queued count all visible tasks (everything except hidden `chat-followup`).
 * chatRunning/chatQueued/chatPending are separate counts for the Chat tab badge.
 */

import { useMemo } from 'react';
import { useQueue } from '../context/QueueContext';

export interface RepoQueueStats {
    running: number;
    queued: number;
    chatRunning: number;
    chatQueued: number;
    chatPending: number;
}

const isChat = (t: { type?: string }) => t.type === 'chat';
const isHidden = (t: { type?: string }) => t.type === 'chat-followup';

export function useRepoQueueStats(workspaceId: string): RepoQueueStats {
    const { state } = useQueue();
    return useMemo(() => {
        const entry = state.repoQueueMap[workspaceId];
        const streamingCount = state.streamingChatWorkspaces[workspaceId] || 0;
        if (!entry) return { running: 0, queued: 0, chatRunning: 0, chatQueued: 0, chatPending: streamingCount };
        const runningArr = entry.running ?? [];
        const queuedArr = entry.queued ?? [];
        const chatRunning = runningArr.filter(isChat).length;
        const chatQueued = queuedArr.filter(isChat).length;
        return {
            running: runningArr.filter(t => !isHidden(t)).length,
            queued: queuedArr.filter(t => !isHidden(t)).length,
            chatRunning,
            chatQueued,
            chatPending: Math.max(chatRunning + chatQueued, streamingCount),
        };
    }, [state.repoQueueMap, state.streamingChatWorkspaces, workspaceId]);
}
