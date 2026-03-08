/**
 * ActivityDetailPane — right-side detail switcher for the Activity tab.
 *
 * Renders ActivityChatDetail for top-level chat tasks and
 * QueueTaskDetail for everything else.
 *
 * When a deep-link selects a task before the queue list has loaded,
 * `selectedTask` may still be null.  In that case we fetch the task
 * from the API so we can determine its type and route to the correct
 * detail component without flashing the wrong one.
 */

import { useEffect, useState } from 'react';
import { ActivityChatDetail } from './ActivityChatDetail';
import { QueueTaskDetail } from '../queue/QueueTaskDetail';
import { fetchApi } from '../hooks/useApi';
import { Spinner } from '../shared';

export interface ActivityDetailPaneProps {
    selectedTaskId: string | null;
    selectedTask: any | null;
    onBack?: () => void;
    workspaceId?: string;
}

function isTopLevelChatTask(task: any): boolean {
    return task?.type === 'chat' && !(task as any).payload?.processId;
}

export function ActivityDetailPane({ selectedTaskId, selectedTask, onBack, workspaceId }: ActivityDetailPaneProps) {
    const [fetchedTask, setFetchedTask] = useState<any>(null);
    const [fetching, setFetching] = useState(false);

    useEffect(() => {
        setFetchedTask(null);
        if (!selectedTaskId || selectedTask) return;

        let cancelled = false;
        setFetching(true);
        fetchApi(`/queue/${encodeURIComponent(selectedTaskId)}`)
            .then((data: any) => {
                if (!cancelled) setFetchedTask(data?.task ?? null);
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setFetching(false); });
        return () => { cancelled = true; };
    }, [selectedTaskId, selectedTask]);

    if (!selectedTaskId) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                <div className="text-center">
                    <div className="text-2xl mb-2">📋</div>
                    <div>Select a task to view details</div>
                </div>
            </div>
        );
    }

    const resolvedTask = selectedTask ?? fetchedTask;

    if (!resolvedTask && fetching) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                <Spinner size="sm" /> Loading task...
            </div>
        );
    }

    if (isTopLevelChatTask(resolvedTask)) {
        return <ActivityChatDetail taskId={selectedTaskId} onBack={onBack} workspaceId={workspaceId} />;
    }

    return <QueueTaskDetail onBack={onBack} />;
}
