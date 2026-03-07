/**
 * QueueView — queue state hydrator embedded in the Processes view.
 * Hydrates queue state on mount.
 * The sidebar queue summary is rendered inside ProcessesView.
 * EnqueueDialog is rendered at the App level so it's accessible from any tab.
 */

import { useEffect } from 'react';
import { useQueue } from '../context/QueueContext';
import { fetchApi } from '../hooks/useApi';

export function QueueView() {
    const { dispatch } = useQueue();

    // One-shot queue fetch on mount
    useEffect(() => {
        Promise.all([
            fetchApi('/queue').catch(() => null),
            fetchApi('/queue/history').catch(() => null),
        ]).then(([queueData, historyData]) => {
            if (queueData) {
                dispatch({
                    type: 'QUEUE_UPDATED',
                    queue: {
                        queued: queueData.queued || [],
                        running: queueData.running || [],
                        stats: queueData.stats || {},
                    },
                });
            }
            if (historyData?.history) {
                dispatch({ type: 'SET_HISTORY', history: historyData.history });
            }
        });
    }, [dispatch]);

    return null;
}
