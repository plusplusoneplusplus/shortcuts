/**
 * QueueView — top-level Queue sub-tab.
 * Renders QueuePanel, conditionally QueueTaskDetail and EnqueueDialog.
 */

import { useEffect } from 'react';
import { useQueue } from '../context/QueueContext';
import { QueuePanel } from './QueuePanel';
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
        <div className="p-4">
            <QueuePanel />
            <QueueTaskDetail />
            <EnqueueDialog />
        </div>
    );
}
