/**
 * QueueView — top-level Queue sub-tab.
 * Mounts queue overlays (detail drawer + enqueue dialog) and hydrates queue state.
 * The sidebar queue summary is rendered inside ProcessesView.
 */

import { useEffect } from 'react';
import { useQueue } from '../context/QueueContext';
import { QueueTaskDetail } from './QueueTaskDetail';
import { EnqueueDialog } from './EnqueueDialog';
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

    return (
        <>
            <QueueTaskDetail />
            <EnqueueDialog />
        </>
    );
}
