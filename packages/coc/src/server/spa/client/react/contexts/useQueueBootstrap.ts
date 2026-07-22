/**
 * useQueueBootstrap — shared one-shot queue fetch-and-dispatch.
 *
 * Fetches the current queue snapshot and dispatches it into the surrounding
 * QueueProvider. Used by both the main App (on connect / WS reconnect) and the
 * popped-out chat window, which mounts its own empty QueueProvider and would
 * otherwise resolve every recorded implementation run to 'unknown'.
 */

import { useCallback } from 'react';
import { useQueue } from './QueueContext';
import { getSpaCocClient } from '../api/cocClient';

export function useQueueBootstrap() {
    const { dispatch } = useQueue();
    return useCallback(async () => {
        const data = await getSpaCocClient().queue.list().catch(() => null);
        if (data && Array.isArray(data.queued) && Array.isArray(data.running)) {
            dispatch({ type: 'QUEUE_UPDATED', queue: data });
            if (data.history) {
                dispatch({ type: 'SET_HISTORY', history: data.history });
            }
        }
    }, [dispatch]);
}
