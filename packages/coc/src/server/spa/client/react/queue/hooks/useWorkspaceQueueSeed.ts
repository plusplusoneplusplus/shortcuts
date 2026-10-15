import { useEffect, useRef } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { useQueue } from '../../contexts/QueueContext';
import { readWorkspaceQueue, workspaceReadCacheKey, workspaceReadSource } from '../../api/workspaceReads';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';

/** Keep rail data fresh even while the conversation list is not mounted. */
export function useWorkspaceQueueSeed(workspaceId: string, client: CocClient, routingRef?: string): void {
    const { state, dispatch } = useQueue();
    const source = workspaceReadSource(client);
    const key = workspaceReadCacheKey(workspaceId, source);
    const queueRef = useRef(state.repoQueueMap[key]);
    queueRef.current = state.repoQueueMap[key];
    const unresolvedRemote = !!parseRemoteCloneKey(routingRef) && !client.options?.baseUrl;

    useEffect(() => {
        if (unresolvedRemote) return;
        let disposed = false;
        let generation = 0;
        const refresh = async (force: boolean) => {
            const request = ++generation;
            const expectedRevision = queueRef.current?.taskRevision ?? 0;
            try {
                const queue = await readWorkspaceQueue(client, workspaceId, force);
                if (!disposed && request === generation) {
                    dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: workspaceId, queue, source, expectedRevision });
                }
            } catch (error) {
                if (!disposed && request === generation) console.warn('Could not refresh workspace queue', error);
            }
        };
        const baseUrl = client.options?.baseUrl || undefined;
        const eventName = baseUrl ? 'coc-remote-ws-connect' : 'coc-local-ws-connect';
        const onConnect = (event: Event) => {
            if ((event as CustomEvent).detail?.baseUrl === baseUrl) void refresh(true);
        };
        window.addEventListener(eventName, onConnect);
        void refresh(false);
        return () => {
            disposed = true;
            readWorkspaceQueue.invalidate(client, workspaceId);
            window.removeEventListener(eventName, onConnect);
        };
    }, [workspaceId, client, source, unresolvedRemote, dispatch]);
}
