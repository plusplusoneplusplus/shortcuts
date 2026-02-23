/**
 * ProcessesSidebar — unified sidebar merging legacy ProcessList and QueuePanel.
 * Renders stats bar, queue running/queued tasks, legacy process cards,
 * enqueue button, and collapsible history in a single scrollable section.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { Card, Badge, Button, cn } from '../shared';
import { formatDuration, statusIcon, statusLabel, typeLabel, repoName } from '../utils/format';
import { resolveWorkspaceName, getProcessWorkspaceId, getProcessWorkspaceName } from '../utils/workspace';
import { getApiBase } from '../utils/config';

function groupByFolder(tasks: any[]): { folder: string | null; tasks: any[] }[] {
    const map = new Map<string | null, any[]>();
    for (const t of tasks) {
        const key = t.folderPath ?? null;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(t);
    }
    const entries = [...map.entries()].sort((a, b) => {
        if (a[0] === null) return 1;
        if (b[0] === null) return -1;
        return a[0].localeCompare(b[0]);
    });
    return entries.map(([folder, tasks]) => ({ folder, tasks }));
}

export function ProcessesSidebar() {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { queued, running, history, stats, showHistory, draining, drainQueued, drainRunning } = queueState;
    const [now, setNow] = useState(Date.now());
    const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
    const [isClearLoading, setIsClearLoading] = useState(false);

    const navigateToRepo = useCallback((e: React.MouseEvent, workspaceId: string) => {
        e.stopPropagation();
        location.hash = '#repos/' + encodeURIComponent(workspaceId);
    }, []);

    // Legacy process filtering
    const filteredLegacy = useMemo(() => {
        return state.processes
            .filter((p: any) => {
                if (p.id?.startsWith('queue_')) return false;
                if (p.parentProcessId) return false;
                if (state.workspace !== '__all' && p.workspaceId !== state.workspace) return false;
                if (state.statusFilter !== '__all' && p.status !== state.statusFilter) return false;
                if (state.searchQuery) {
                    const q = state.searchQuery.toLowerCase();
                    const title = (p.promptPreview || p.id || '').toLowerCase();
                    if (title.indexOf(q) === -1) return false;
                }
                return true;
            })
            .sort((a: any, b: any) => {
                const order: Record<string, number> = { running: 0, queued: 1, failed: 2, completed: 3, cancelled: 4 };
                const sa = order[a.status] ?? 5;
                const sb = order[b.status] ?? 5;
                if (sa !== sb) return sa - sb;
                return new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime();
            });
    }, [state.processes, state.workspace, state.statusFilter, state.searchQuery]);

    // Unified live timer
    const hasActive = useMemo(
        () => running.length > 0 || filteredLegacy.some((p: any) => p.status === 'running'),
        [running, filteredLegacy]
    );

    useEffect(() => {
        if (!hasActive) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hasActive]);

    const openTaskInRoute = useCallback((task: any) => {
        const processId = typeof task?.processId === 'string' && task.processId
            ? task.processId
            : `queue_${task.id}`;
        const nextHash = '#process/' + encodeURIComponent(processId);

        if (location.hash !== nextHash) {
            location.hash = nextHash;
            return;
        }

        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
        dispatch({ type: 'SELECT_PROCESS', id: null });
    }, [dispatch, queueDispatch]);

    const hasQueueActive = running.length > 0 || queued.length > 0;

    async function handlePauseResume() {
        setIsPauseResumeLoading(true);
        try {
            const endpoint = stats.isPaused ? '/queue/resume' : '/queue/pause';
            await fetch(getApiBase() + endpoint, { method: 'POST' });
            const data = await fetch(getApiBase() + '/queue').then(r => r.json());
            queueDispatch({ type: 'QUEUE_UPDATED', queue: data });
        } finally {
            setIsPauseResumeLoading(false);
        }
    }

    async function handleClearQueue() {
        if (!confirm('Clear all queued tasks?')) return;
        setIsClearLoading(true);
        try {
            await fetch(getApiBase() + '/queue', { method: 'DELETE' });
            const data = await fetch(getApiBase() + '/queue').then(r => r.json());
            queueDispatch({ type: 'QUEUE_UPDATED', queue: data });
        } finally {
            setIsClearLoading(false);
        }
    }

    const isEmpty = running.length === 0 && queued.length === 0 && filteredLegacy.length === 0;

    return (
        <div className="flex flex-col gap-3 min-h-0 p-2">
            {/* Drain banner */}
            {draining && (
                <div className="rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 px-3 py-2 text-xs font-medium">
                    ⚠️ Server shutting down — draining {drainRunning} running, {drainQueued} queued
                </div>
            )}

            {/* Stats bar */}
            <div className="flex items-center gap-3 text-xs text-[#848484]">
                <span>⏳ {stats.queued} queued</span>
                <span>🔄 {stats.running} running</span>
                <span>✅ {stats.completed} done</span>
                <span>❌ {stats.failed} failed</span>
                {stats.isPaused && <Badge status="warning">Paused</Badge>}
                <div className="ml-auto flex items-center gap-1">
                    {(stats.isPaused || hasQueueActive) && (
                        <Button variant="ghost" size="sm" disabled={isPauseResumeLoading}
                                onClick={handlePauseResume} title={stats.isPaused ? 'Resume' : 'Pause'}
                                data-testid="pause-resume-btn">
                            {stats.isPaused ? '▶' : '⏸'}
                        </Button>
                    )}
                    {stats.queued > 0 && (
                        <Button variant="danger" size="sm" disabled={isClearLoading}
                                onClick={handleClearQueue} title="Clear queue"
                                data-testid="clear-queue-btn">
                            🗑
                        </Button>
                    )}
                </div>
            </div>

            {/* Running queue tasks */}
            {running.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">Running</div>
                    {groupByFolder(running).map(({ folder, tasks }) => (
                        <div key={folder ?? '__unassigned__'}>
                            {folder && (
                                <div className="queue-folder-heading text-[10px] text-[#848484] dark:text-[#666] font-mono truncate mb-0.5 pl-0.5">
                                    📂 {folder}
                                </div>
                            )}
                            <div className="flex flex-col gap-1">
                                {tasks.map((task: any) => (
                                    <QueueTaskCard key={task.id} task={task} now={now}
                                        selected={queueState.selectedTaskId === task.id}
                                        onClick={() => openTaskInRoute(task)} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Queued queue tasks */}
            {queued.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">Queued</div>
                    {groupByFolder(queued).map(({ folder, tasks }) => (
                        <div key={folder ?? '__unassigned__'}>
                            {folder && (
                                <div className="queue-folder-heading text-[10px] text-[#848484] dark:text-[#666] font-mono truncate mb-0.5 pl-0.5">
                                    📂 {folder}
                                </div>
                            )}
                            <div className="flex flex-col gap-1">
                                {tasks.map((task: any) => (
                                    <QueueTaskCard key={task.id} task={task} now={now}
                                        selected={queueState.selectedTaskId === task.id}
                                        onClick={() => openTaskInRoute(task)} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Empty state */}
            {isEmpty && (
                <div className="py-6 text-center text-sm text-[#848484]">
                    No processes found
                </div>
            )}

            {/* Legacy process cards */}
            {filteredLegacy.length > 0 && (
                <div className="flex flex-col gap-1">
                    {filteredLegacy.map((p: any) => {
                        const isActive = state.selectedId === p.id;
                        const duration = p.status === 'running' && p.startTime
                            ? formatDuration(now - new Date(p.startTime).getTime())
                            : p.duration != null
                                ? formatDuration(p.duration)
                                : '';
                        const preview = p.promptPreview
                            ? (p.promptPreview.length > 80 ? p.promptPreview.slice(0, 80) + '…' : p.promptPreview)
                            : p.id;
                        const wsId = getProcessWorkspaceId(p);
                        const wsName = resolveWorkspaceName(wsId, getProcessWorkspaceName(p), state.workspaces);

                        return (
                            <Card
                                key={p.id}
                                onClick={() => {
                                    const nextHash = '#process/' + encodeURIComponent(p.id);
                                    if (location.hash !== nextHash) {
                                        location.hash = nextHash;
                                    } else {
                                        dispatch({ type: 'SELECT_PROCESS', id: p.id });
                                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
                                    }
                                }}
                                className={cn(
                                    'p-2.5',
                                    isActive && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff]'
                                )}
                            >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <Badge status={p.status}>
                                        {statusIcon(p.status)} {statusLabel(p.status)}
                                    </Badge>
                                    {duration && (
                                        <span className="text-[11px] text-[#848484] whitespace-nowrap">{duration}</span>
                                    )}
                                </div>
                                {wsName && wsId && (
                                    <div className="mb-1">
                                        <button
                                            type="button"
                                            onClick={(e) => navigateToRepo(e, wsId)}
                                            className="inline-flex items-center gap-1 text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:underline cursor-pointer bg-transparent border-none p-0"
                                            title={`Go to repo: ${wsName}`}
                                        >
                                            <span>📂</span>
                                            <span className="truncate max-w-[200px]">{wsName}</span>
                                        </button>
                                    </div>
                                )}
                                <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc] line-clamp-2 break-words">
                                    {preview}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Enqueue button */}
            <div className="flex">
                <Button
                    variant="primary"
                    size="sm"
                    onClick={() => queueDispatch({ type: 'OPEN_DIALOG' })}
                >
                    + Enqueue
                </Button>
            </div>

            {/* History section */}
            <div className="min-h-0">
                <button
                    className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                    onClick={() => queueDispatch({ type: 'TOGGLE_HISTORY' })}
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
                                selected={queueState.selectedTaskId === task.id}
                                compact
                                onClick={() => openTaskInRoute(task)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function QueueTaskCard({ task, now, selected, onClick, compact = false }: {
    task: any;
    now: number;
    selected: boolean;
    onClick: () => void;
    compact?: boolean;
}) {
    const elapsed = task.status === 'running' && task.startTime
        ? formatDuration(now - new Date(task.startTime).getTime())
        : task.duration != null
            ? formatDuration(task.duration)
            : '';

    const preview = task.prompt
        ? (task.prompt.length > 60 ? task.prompt.slice(0, 60) + '…' : task.prompt)
        : task.id;

    const repo = repoName(task.repoId) || repoName(task.workingDirectory) || repoName(task.payload?.workingDirectory);

    return (
        <Card
            onClick={onClick}
            className={cn(compact ? 'px-2 py-1.5' : 'p-2', selected && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff]')}
            aria-label={`Task ${statusLabel(task.status).toLowerCase()}: ${preview}`}
        >
            {compact ? (
                <div className="flex items-center gap-1.5 min-w-0 text-[11px] leading-5">
                    <span className="shrink-0">{statusIcon(task.status)}</span>
                    {repo && (
                        <span className="queue-task-repo-name shrink-0 text-[10px] text-[#0078d4] dark:text-[#3794ff] font-medium"
                              title={task.repoId || task.workingDirectory || task.payload?.workingDirectory}>
                            [{repo}]
                        </span>
                    )}
                    <span className="shrink-0 text-[#848484]">{typeLabel(task.type)}</span>
                    <span className="min-w-0 truncate text-[#1e1e1e] dark:text-[#cccccc]">{preview}</span>
                    {elapsed && <span className="shrink-0 text-[10px] text-[#848484]">{elapsed}</span>}
                </div>
            ) : (
                <>
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
                    {task.folderPath && (
                        <div className="queue-task-folder-badge text-[10px] text-[#848484] font-mono truncate mt-0.5"
                             title={task.folderPath}>
                            📂 {task.folderPath.length > 32
                                ? '…' + task.folderPath.slice(-32)
                                : task.folderPath}
                        </div>
                    )}
                    {elapsed && (
                        <div className="text-[10px] text-[#848484] mt-0.5">{elapsed}</div>
                    )}
                </>
            )}
        </Card>
    );
}
