/**
 * useRepoQueueStats — returns running/queued counts for a given workspace.
 * Reads from QueueContext's repoQueueMap, falling back to zeros.
 *
 * running/queued count all visible tasks (everything except hidden `chat-followup`).
 */

import { useMemo } from 'react';
import { useQueue } from '../../contexts/QueueContext';
import { TaskDefs } from '../../../../../tasks/task-types';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { workspaceReadSource } from '../../api/workspaceReads';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';

export interface QueueJob {
    id: string;
    kind?: string;
    type?: string;
    displayName?: string;
    processId?: string;
    workItemId?: string;
    payload?: { processId?: string; workItemId?: string; mode?: string };
}

export interface RepoQueueStats {
    running: number;
    queued: number;
}

export const isHidden = (t: { type?: string; payload?: any }) => t.type === TaskDefs.chat.kind && t.payload?.processId;

export function useRepoQueueJobs(workspaceId: string, client?: CocClient, routingRef?: string) {
    const { state } = useQueue();
    return useMemo<{ running: QueueJob[]; queued: QueueJob[] }>(() => {
        const entry = state.repoQueueMap[workspaceId];
        // Untagged WebSocket snapshots belong to the page-origin server only.
        const unresolvedRemote = parseRemoteCloneKey(routingRef) && !client?.options?.baseUrl;
        const matchesSource = !unresolvedRemote && (!client || (entry?.taskDataSource
            ? entry.taskDataSource === workspaceReadSource(client)
            : !client.options?.baseUrl));
        if (!entry || !matchesSource) return { running: [], queued: [] };
        return {
            running: (entry.running ?? []).filter(t => !isHidden(t)),
            queued: (entry.queued ?? []).filter(t => !isHidden(t)),
        };
    }, [state.repoQueueMap, workspaceId, client, routingRef]);
}

export function useRepoQueueStats(workspaceId: string, client?: CocClient): RepoQueueStats {
    const jobs = useRepoQueueJobs(workspaceId, client);
    return useMemo(() => ({ running: jobs.running.length, queued: jobs.queued.length }), [jobs]);
}
