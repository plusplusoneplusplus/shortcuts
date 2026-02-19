/**
 * QueuePanel — stats bar, active tasks, toggleable history.
 * Replaces renderQueuePanel from queue.ts.
 */

import { useState, useEffect, useMemo } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { Badge, Card, Button, cn } from '../shared';
import { formatDuration, statusIcon, statusLabel, typeLabel } from '../utils/format';

export function QueuePanel() {
    const { state, dispatch } = useQueue();
    const { dispatch: appDispatch } = useApp();
    const { queued, running, history, stats, showHistory, draining, drainQueued, drainRunning } = state;
    const [now, setNow] = useState(Date.now());

    const hasActive = useMemo(
        () => running.length > 0 || queued.length > 0,
        [running, queued]
    );

    useEffect(() => {
        if (!hasActive) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hasActive]);

    const openTaskInRoute = (task: any) => {
        const processId = typeof task?.processId === 'string' && task.processId
            ? task.processId
            : `queue_${task.id}`;
        const nextHash = '#process/' + encodeURIComponent(processId);

        if (location.hash !== nextHash) {
            location.hash = nextHash;
            return;
        }

        // Hash won't emit change when unchanged; update local state directly.
        dispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
        appDispatch({ type: 'SELECT_PROCESS', id: null });
    };

    return (
        <div className="flex flex-col gap-3 min-h-0">
            {/* Drain banner */}
            {draining && (
                <div className="rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 px-3 py-2 text-xs font-medium">
                    ⚠️ Server shutting down — draining {drainRunning} running, {drainQueued} queued
                </div>
            )}

            {/* Stats bar */}
            <div className="flex gap-3 text-xs text-[#848484]">
                <span>⏳ {stats.queued} queued</span>
                <span>🔄 {stats.running} running</span>
                <span>✅ {stats.completed} done</span>
                <span>❌ {stats.failed} failed</span>
            </div>

            {/* Active tasks: running then queued */}
            {running.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">Running</div>
                    <div className="flex flex-col gap-1">
                        {running.map((task: any) => (
                            <QueueTaskCard
                                key={task.id}
                                task={task}
                                now={now}
                                selected={state.selectedTaskId === task.id}
                                onClick={() => openTaskInRoute(task)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {queued.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">Queued</div>
                    <div className="flex flex-col gap-1">
                        {queued.map((task: any) => (
                            <QueueTaskCard
                                key={task.id}
                                task={task}
                                now={now}
                                selected={state.selectedTaskId === task.id}
                                onClick={() => openTaskInRoute(task)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Enqueue button */}
            <div className="flex">
                <Button
                    variant="primary"
                    size="sm"
                    onClick={() => dispatch({ type: 'TOGGLE_DIALOG' })}
                >
                    + Enqueue
                </Button>
            </div>

            {/* History section */}
            <div className="min-h-0">
                <button
                    className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                    onClick={() => dispatch({ type: 'TOGGLE_HISTORY' })}
                >
                    {showHistory ? '▼' : '▶'} History ({history.length})
                </button>
                {showHistory && history.length > 0 && (
                    <div className="mt-1 max-h-[38vh] overflow-y-auto pr-1 space-y-1">
                        {history.map((task: any) => (
                            <QueueTaskCard
                                key={task.id}
                                task={task}
                                now={now}
                                selected={state.selectedTaskId === task.id}
                                onClick={() => openTaskInRoute(task)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function QueueTaskCard({ task, now, selected, onClick }: {
    task: any;
    now: number;
    selected: boolean;
    onClick: () => void;
}) {
    const elapsed = task.status === 'running' && task.startTime
        ? formatDuration(now - new Date(task.startTime).getTime())
        : task.duration != null
            ? formatDuration(task.duration)
            : '';

    const preview = task.prompt
        ? (task.prompt.length > 60 ? task.prompt.slice(0, 60) + '…' : task.prompt)
        : task.id;

    return (
        <Card
            onClick={onClick}
            className={cn('p-2', selected && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff]')}
            aria-label={`Task ${statusLabel(task.status).toLowerCase()}: ${preview}`}
        >
            <div className="flex items-center justify-between gap-2 mb-0.5">
                <Badge status={task.status}>
                    {statusIcon(task.status)} {statusLabel(task.status)}
                </Badge>
                <span className="text-[10px] text-[#848484]">
                    {typeLabel(task.type)}
                </span>
            </div>
            <div className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc] line-clamp-1 break-words">
                {preview}
            </div>
            {elapsed && (
                <div className="text-[10px] text-[#848484] mt-0.5">{elapsed}</div>
            )}
        </Card>
    );
}
