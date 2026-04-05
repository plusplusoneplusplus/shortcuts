/**
 * useRepoQueueStats — returns running/queued counts for a given workspace.
 * Reads from QueueContext's repoQueueMap, falling back to zeros.
 *
 * running/queued count all visible tasks (everything except hidden `chat-followup`).
 * Also provides split counts for chats (type==='chat') vs tasks (everything else).
 */

import { useMemo } from 'react';
import { useQueue } from '../context/QueueContext';

export interface RepoQueueStats {
    running: number;
    queued: number;
    chatsRunning: number;
    chatsQueued: number;
    tasksRunning: number;
    tasksQueued: number;
}

const isHidden = (t: { type?: string; payload?: any }) => t.type === 'chat' && t.payload?.processId;
const isChat = (t: { type?: string }) => t.type === 'chat';

export function useRepoQueueStats(workspaceId: string): RepoQueueStats {
    const { state } = useQueue();
    return useMemo(() => {
        const entry = state.repoQueueMap[workspaceId];
        if (!entry) return { running: 0, queued: 0, chatsRunning: 0, chatsQueued: 0, tasksRunning: 0, tasksQueued: 0 };
        const runningArr = (entry.running ?? []).filter(t => !isHidden(t));
        const queuedArr = (entry.queued ?? []).filter(t => !isHidden(t));
        return {
            running: runningArr.length,
            queued: queuedArr.length,
            chatsRunning: runningArr.filter(isChat).length,
            chatsQueued: queuedArr.filter(isChat).length,
            tasksRunning: runningArr.filter(t => !isChat(t)).length,
            tasksQueued: queuedArr.filter(t => !isChat(t)).length,
        };
    }, [state.repoQueueMap, workspaceId]);
}
