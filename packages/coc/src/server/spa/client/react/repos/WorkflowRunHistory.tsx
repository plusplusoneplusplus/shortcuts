/**
 * WorkflowRunHistory — shows a list of past runs for the selected pipeline,
 * with status badges, timestamps, durations, and click-to-navigate to workflow detail.
 * Active (running/queued) tasks appear at the top via the QueueContext.
 */

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { useQueue } from '../context/QueueContext';
import { formatDuration, statusIcon, formatRelativeTime } from '../utils/format';

export interface WorkflowRunHistoryProps {
    workspaceId: string;
    pipelineName: string;
    refreshKey?: number;
}

export function WorkflowRunHistory({ workspaceId, pipelineName, refreshKey }: WorkflowRunHistoryProps) {
    const { state: queueState } = useQueue();
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchHistory = useCallback(async () => {
        try {
            const data = await fetchApi(
                `/queue/history?repoId=${encodeURIComponent(workspaceId)}&pipelineName=${encodeURIComponent(pipelineName)}`
            );
            setHistory(data.history || []);
        } catch {
            setHistory([]);
        } finally {
            setLoading(false);
        }
    }, [workspaceId, pipelineName]);

    useEffect(() => {
        setLoading(true);
        fetchHistory();
    }, [fetchHistory, refreshKey]);

    // Active tasks for this pipeline from WebSocket queue state
    const repoQueue = queueState.repoQueueMap[workspaceId];
    const activeTasks = [...(repoQueue?.running || []), ...(repoQueue?.queued || [])].filter(
        (t: any) =>
            t.type === 'run-workflow' && (
                t.metadata?.pipelineName === pipelineName ||
                t.displayName?.includes(pipelineName)
            )
    );

    const handleSelectTask = (task: any) => {
        const processId = task.processId || `queue_${task.id}`;
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/pipelines/' + encodeURIComponent(pipelineName) + '/run/' + encodeURIComponent(processId);
    };

    const isEmpty = activeTasks.length === 0 && history.length === 0 && !loading;

    return (
        <div className="px-4 pb-4" data-testid="pipeline-run-history">
            <h3 className="text-xs font-semibold text-[#848484] uppercase tracking-wide mb-2 mt-4">
                Run History
            </h3>

            {loading && (
                <p className="text-xs text-[#848484]">Loading history…</p>
            )}

            {isEmpty && (
                <p className="text-xs text-[#848484]" data-testid="empty-state">
                    No runs yet. Click ▶ Run to execute this pipeline.
                </p>
            )}

            <div className="space-y-1">
                {/* Active tasks */}
                {activeTasks.map((task: any) => (
                    <RunHistoryItem
                        key={task.id}
                        task={task}
                        onClick={() => handleSelectTask(task)}
                    />
                ))}

                {/* Completed history */}
                {history.map((task: any) => (
                    <RunHistoryItem
                        key={task.id}
                        task={task}
                        onClick={() => handleSelectTask(task)}
                    />
                ))}
            </div>
        </div>
    );
}

// ── RunHistoryItem ──────────────────────────────────────────────────────

interface RunHistoryItemProps {
    task: any;
    onClick: () => void;
}

function RunHistoryItem({ task, onClick }: RunHistoryItemProps) {
    const status = task.status || 'queued';
    const icon = statusIcon(status);
    const startTime = task.startedAt || task.createdAt || task.startTime;
    const duration = task.durationMs ?? (
        task.startedAt && task.completedAt
            ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
            : null
    );

    return (
        <div
            className="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer text-xs hover:bg-[#e8e8e8] dark:hover:bg-[#333]"
            role="button"
            onClick={onClick}
            data-testid="run-history-item"
        >
            <span>{icon}</span>
            <Badge status={status} />
            {startTime && (
                <span className="text-[#848484]">{formatRelativeTime(startTime)}</span>
            )}
            {duration != null && duration > 0 && (
                <span className="text-[#848484] ml-auto">{formatDuration(duration)}</span>
            )}
        </div>
    );
}
