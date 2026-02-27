/**
 * PipelineRunHistory — shows a list of past runs for the selected pipeline,
 * with status badges, timestamps, durations, and click-to-expand detail.
 * Active (running/queued) tasks appear at the top via the QueueContext.
 */

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { useQueue } from '../context/QueueContext';
import { PipelineResultCard } from '../processes/PipelineResultCard';
import { formatDuration, statusIcon, formatRelativeTime } from '../utils/format';

export interface PipelineRunHistoryProps {
    workspaceId: string;
    pipelineName: string;
    refreshKey?: number;
}

export function PipelineRunHistory({ workspaceId, pipelineName, refreshKey }: PipelineRunHistoryProps) {
    const { state: queueState } = useQueue();
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [selectedProcess, setSelectedProcess] = useState<any | null>(null);

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
            t.type === 'run-pipeline' && (
                t.metadata?.pipelineName === pipelineName ||
                t.displayName?.includes(pipelineName)
            )
    );

    const handleSelectTask = async (task: any) => {
        if (selectedTaskId === task.id) {
            setSelectedTaskId(null);
            setSelectedProcess(null);
            return;
        }
        setSelectedTaskId(task.id);
        // Fetch process detail if processId is available
        const processId = task.processId || `queue_${task.id}`;
        try {
            const proc = await fetchApi(`/processes/${encodeURIComponent(processId)}`);
            setSelectedProcess(proc);
        } catch {
            // Show what we have from the task itself
            setSelectedProcess({
                id: processId,
                status: task.status,
                result: task.result,
                metadata: task.metadata,
                durationMs: task.durationMs,
            });
        }
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
                        isSelected={selectedTaskId === task.id}
                        onClick={() => handleSelectTask(task)}
                    />
                ))}

                {/* Completed history */}
                {history.map((task: any) => (
                    <RunHistoryItem
                        key={task.id}
                        task={task}
                        isSelected={selectedTaskId === task.id}
                        onClick={() => handleSelectTask(task)}
                    />
                ))}
            </div>

            {/* Expanded result card */}
            {selectedProcess && (
                <div className="mt-2">
                    <PipelineResultCard process={selectedProcess} />
                </div>
            )}
        </div>
    );
}

// ── RunHistoryItem ──────────────────────────────────────────────────────

interface RunHistoryItemProps {
    task: any;
    isSelected: boolean;
    onClick: () => void;
}

function RunHistoryItem({ task, isSelected, onClick }: RunHistoryItemProps) {
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
            className={
                'flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer text-xs hover:bg-[#e8e8e8] dark:hover:bg-[#333]'
                + (isSelected ? ' bg-[#e8e8e8] dark:bg-[#2a2d2e] border-l-2 border-[#0078d4]' : '')
            }
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
