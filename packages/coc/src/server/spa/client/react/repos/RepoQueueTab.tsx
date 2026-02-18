/**
 * RepoQueueTab — workspace-scoped queue with running/queued/history sections.
 */

import { useState, useEffect, useMemo } from 'react';
import { Badge, Card, Button, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { useQueue } from '../context/QueueContext';
import { formatDuration, statusIcon, formatRelativeTime } from '../utils/format';

interface RepoQueueTabProps {
    workspaceId: string;
}

export function RepoQueueTab({ workspaceId }: RepoQueueTabProps) {
    const [running, setRunning] = useState<any[]>([]);
    const [queued, setQueued] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(Date.now());

    const { state: queueState } = useQueue();

    const fetchQueue = async () => {
        try {
            const data = await fetchApi('/queue?repoId=' + encodeURIComponent(workspaceId));
            setRunning(data?.running || []);
            setQueued(data?.queued || []);
            const historyData = await fetchApi('/queue/history?repoId=' + encodeURIComponent(workspaceId)).catch(() => null);
            setHistory(historyData?.history || []);
        } catch {
            setRunning([]);
            setQueued([]);
            setHistory([]);
        }
        setLoading(false);
    };

    useEffect(() => {
        setLoading(true);
        fetchQueue();
    }, [workspaceId]);

    // Live-update from queue context WebSocket events
    useEffect(() => {
        fetchQueue();
    }, [queueState.stats]);

    // Live timer for running tasks
    const hasActive = useMemo(() => running.length > 0, [running]);
    useEffect(() => {
        if (!hasActive) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hasActive]);

    const handleCancel = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/tasks/' + encodeURIComponent(taskId) + '/cancel', { method: 'POST' });
        fetchQueue();
    };

    const handleMoveUp = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/tasks/' + encodeURIComponent(taskId) + '/move-up', { method: 'POST' });
        fetchQueue();
    };

    const handleMoveToTop = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/tasks/' + encodeURIComponent(taskId) + '/move-to-top', { method: 'POST' });
        fetchQueue();
    };

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading queue...</div>;
    }

    if (running.length === 0 && queued.length === 0 && history.length === 0) {
        return (
            <div className="p-4 text-center text-sm text-[#848484]">
                No tasks in queue for this repository
            </div>
        );
    }

    return (
        <div className="p-4 flex flex-col gap-3">
            {/* Running */}
            {running.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">
                        Running Tasks <span className="text-[10px]">({running.length})</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        {running.map(task => (
                            <QueueTaskItem
                                key={task.id}
                                task={task}
                                status="running"
                                now={now}
                                onCancel={() => handleCancel(task.id)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Queued */}
            {queued.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">
                        Queued Tasks <span className="text-[10px]">({queued.length})</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        {queued.map((task, index) => (
                            <QueueTaskItem
                                key={task.id}
                                task={task}
                                status="queued"
                                now={now}
                                onCancel={() => handleCancel(task.id)}
                                onMoveUp={index > 0 ? () => handleMoveUp(task.id) : undefined}
                                onMoveToTop={() => handleMoveToTop(task.id)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* History */}
            {history.length > 0 && (
                <div>
                    <button
                        className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                        onClick={() => setShowHistory(!showHistory)}
                    >
                        {showHistory ? '▼' : '▶'} Completed Tasks ({history.length})
                    </button>
                    {showHistory && (
                        <div className="flex flex-col gap-1 mt-1">
                            {history.map(task => (
                                <Card key={task.id} className="p-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span>
                                            {task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '🚫'}{' '}
                                            {(task.displayName || task.type || 'Task').substring(0, 35)}
                                        </span>
                                        <span className="text-[10px] text-[#848484]">
                                            {task.completedAt ? formatRelativeTime(new Date(task.completedAt).toISOString()) : ''}
                                        </span>
                                    </div>
                                    {task.error && (
                                        <div className="text-[10px] text-red-500 mt-0.5 truncate">
                                            {task.error.length > 80 ? task.error.substring(0, 77) + '...' : task.error}
                                        </div>
                                    )}
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function QueueTaskItem({ task, status, now, onCancel, onMoveUp, onMoveToTop }: {
    task: any;
    status: 'running' | 'queued';
    now: number;
    onCancel: () => void;
    onMoveUp?: () => void;
    onMoveToTop?: () => void;
}) {
    const name = (task.displayName || task.type || 'Task').substring(0, 35);
    const icon = status === 'running' ? '🔄' : '⏳';
    let elapsed = '';
    if (status === 'running' && task.startedAt) {
        elapsed = formatDuration(now - new Date(task.startedAt).getTime());
    } else if (task.createdAt) {
        elapsed = formatRelativeTime(new Date(task.createdAt).toISOString());
    }

    return (
        <Card className="p-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                    <span>{icon}</span>
                    <span>{name}</span>
                    {elapsed && <span className="text-[10px] text-[#848484]">{elapsed}</span>}
                </div>
                <div className="flex items-center gap-1">
                    {status === 'queued' && onMoveUp && (
                        <button className="text-[10px] px-1 hover:text-[#0078d4]" onClick={e => { e.stopPropagation(); onMoveUp(); }} title="Move up">▲</button>
                    )}
                    {status === 'queued' && onMoveToTop && (
                        <button className="text-[10px] px-1 hover:text-[#0078d4]" onClick={e => { e.stopPropagation(); onMoveToTop(); }} title="Move to top">⏬</button>
                    )}
                    <button className="text-[10px] px-1 text-red-500 hover:text-red-700" onClick={e => { e.stopPropagation(); onCancel(); }} title="Cancel">✕</button>
                </div>
            </div>
        </Card>
    );
}
