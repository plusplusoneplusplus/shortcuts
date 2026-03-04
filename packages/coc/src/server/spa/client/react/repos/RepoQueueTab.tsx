/**
 * RepoQueueTab — workspace-scoped queue with running/queued/history sections.
 * Split-panel layout: left = task list, right = task detail / placeholder.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Badge, Card, Button, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { QueueTaskDetail } from '../queue/QueueTaskDetail';
import { formatDuration, statusIcon, formatRelativeTime } from '../utils/format';
import { useQueueDragDrop } from '../hooks/useQueueDragDrop';
import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu';
import { useBreakpoint } from '../hooks/useBreakpoint';

interface RepoQueueTabProps {
    workspaceId: string;
}

/** Primary task types surfaced as individual filter options. */
const TASK_TYPE_LABELS: Record<string, string> = {
    'follow-prompt': 'Follow Prompt',
    'run-pipeline': 'Run Pipeline',
    'code-review': 'Code Review',
    'chat': 'Chat',
    'custom': 'Custom',
};

/** Types grouped under the "Other" filter bucket. */
const OTHER_TYPES = new Set(['resolve-comments', 'ai-clarification', 'task-generation']);

function taskMatchesFilter(task: any, filter: string): boolean {
    if (filter === 'all') return true;
    if (filter === 'other') return OTHER_TYPES.has(task.type) || (!TASK_TYPE_LABELS[task.type] && !OTHER_TYPES.has(task.type));
    return task.type === filter;
}

export function RepoQueueTab({ workspaceId }: RepoQueueTabProps) {
    const [running, setRunning] = useState<any[]>([]);
    const [queued, setQueued] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [showHistory, setShowHistory] = useState(true);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(Date.now());
    const [isPaused, setIsPaused] = useState(false);
    const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [filterType, setFilterType] = useState<string>('all');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string; taskStatus: 'running' | 'queued' } | null>(null);
    const [insertingPauseAt, setInsertingPauseAt] = useState<number | null>(null);

    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { dispatch: appDispatch } = useApp();
    const selectedTaskId = queueState.selectedTaskId;
    const { isMobile, isTablet } = useBreakpoint();
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    // Live-update from per-repo WebSocket events via repoQueueMap
    const repoQueue = queueState.repoQueueMap[workspaceId];

    const fetchQueue = async () => {
        try {
            const data = await fetchApi('/queue?repoId=' + encodeURIComponent(workspaceId));
            const nextRunning = data?.running || [];
            const nextQueued = data?.queued || [];
            const nextStats = data?.stats || undefined;
            setRunning(nextRunning);
            setQueued(nextQueued);
            setIsPaused(!!nextStats?.isPaused);
            const historyData = await fetchApi('/queue/history?repoId=' + encodeURIComponent(workspaceId)).catch(() => null);
            const nextHistory = historyData?.history || [];
            setHistory(nextHistory);

            // Keep repoQueueMap aligned with authoritative HTTP data so later WS/stats updates
            // can preserve completed history instead of reverting to stale empty arrays.
            queueDispatch({
                type: 'REPO_QUEUE_UPDATED',
                repoId: workspaceId,
                queue: {
                    queued: nextQueued,
                    running: nextRunning,
                    history: nextHistory,
                    stats: nextStats,
                },
            });
        } catch {
            setRunning([]);
            setQueued([]);
            setHistory([]);
        }
        setLoading(false);
    };

    // Initial HTTP fetch on mount (authoritative load)
    useEffect(() => {
        setLoading(true);
        setFilterType('all');
        fetchQueue();
    }, [workspaceId]);

    // Derive available filter options and filtered task lists
    const allTasks = useMemo(() => [...running, ...queued.filter((t: any) => t.kind !== 'pause-marker'), ...history], [running, queued, history]);
    const availableFilters = useMemo(() => {
        const opts: { value: string; label: string }[] = [{ value: 'all', label: 'All' }];
        const types = new Set(allTasks.map((t: any) => t.type as string));
        for (const [type, label] of Object.entries(TASK_TYPE_LABELS)) {
            if (types.has(type)) opts.push({ value: type, label });
        }
        const hasOther = allTasks.some((t: any) => !TASK_TYPE_LABELS[t.type]);
        if (hasOther) opts.push({ value: 'other', label: 'Other' });
        return opts;
    }, [allTasks]);

    const filteredRunning = useMemo(() => running.filter(t => taskMatchesFilter(t, filterType)), [running, filterType]);
    // Pause markers are always shown regardless of type filter
    const filteredQueued = useMemo(
        () => queued.filter(t => t.kind === 'pause-marker' || taskMatchesFilter(t, filterType)),
        [queued, filterType]
    );
    const filteredHistory = useMemo(() => history.filter(t => taskMatchesFilter(t, filterType)), [history, filterType]);

    // Apply per-repo WS updates directly without HTTP round-trip
    useEffect(() => {
        if (!repoQueue) return;
        setRunning(repoQueue.running);
        setQueued(repoQueue.queued);
        setHistory(repoQueue.history);
        if (repoQueue?.stats?.isPaused !== undefined) {
            setIsPaused(repoQueue.stats.isPaused);
        }
        setLoading(false);
    }, [repoQueue]);

    // Clear selection if the selected task is no longer in any list.
    // Skip while loading so deep-link selections survive the initial fetch.
    useEffect(() => {
        if (!selectedTaskId || loading) return;
        const allTasks = [...running, ...queued, ...history];
        if (!allTasks.find(t => t.id === selectedTaskId)) {
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
            // Reset URL to base queue path when auto-clearing
            const queueBase = '#repos/' + encodeURIComponent(workspaceId) + '/queue';
            if (location.hash.startsWith(queueBase + '/')) {
                location.hash = queueBase;
            }
        }
    }, [selectedTaskId, running, queued, history, loading, queueDispatch, workspaceId]);

    // Reset mobile detail view when selection is cleared
    useEffect(() => {
        if (!selectedTaskId) setMobileShowDetail(false);
    }, [selectedTaskId]);

    const selectTask = useCallback((id: string, task?: any) => {
        if (task?.type === 'chat') {
            // Navigate to Chat tab and select the session
            const sessionId = task.processId || task.id;
            appDispatch({ type: 'SET_SELECTED_CHAT_SESSION', id: sessionId });
            appDispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chat' as any });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(sessionId);
            return;
        }
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/queue/' + encodeURIComponent(id);
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, appDispatch, workspaceId, isMobile]);

    // Scroll selected task card into view (e.g. after deep-link navigation)
    useEffect(() => {
        if (!selectedTaskId) return;
        const timer = setTimeout(() => {
            const el = document.querySelector(`[data-task-id="${CSS.escape(selectedTaskId)}"]`);
            el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 100);
        return () => clearTimeout(timer);
    }, [selectedTaskId]);

    // Live timer for running tasks
    const hasActive = useMemo(() => running.length > 0, [running]);
    useEffect(() => {
        if (!hasActive) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hasActive]);

    const handleCancel = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId), { method: 'DELETE' });
        fetchQueue();
    };

    const handleMoveUp = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-up', { method: 'POST' });
        fetchQueue();
    };

    const handleMoveToTop = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-to-top', { method: 'POST' });
        fetchQueue();
    };

    const handleMoveToPosition = async (taskId: string, newIndex: number) => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-to/' + newIndex, { method: 'POST' });
        fetchQueue();
    };

    const handleFreeze = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/freeze', { method: 'POST' });
        fetchQueue();
    };

    const handleUnfreeze = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/unfreeze', { method: 'POST' });
        fetchQueue();
    };

    const handleInsertPauseMarker = async (afterIndex: number) => {
        setInsertingPauseAt(null);
        await fetch(getApiBase() + '/queue/pause-marker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ afterIndex, repoId: workspaceId }),
        });
        fetchQueue();
    };

    const handleRemovePauseMarker = async (markerId: string) => {
        await fetch(getApiBase() + '/queue/pause-marker/' + encodeURIComponent(markerId), { method: 'DELETE' });
        fetchQueue();
    };

    const {
        draggedTaskId,
        dropTargetIndex,
        dropPosition,
        createDragStartHandler,
        createDragEndHandler,
        createDragOverHandler,
        createDragEnterHandler,
        createDragLeaveHandler,
        createDropHandler,
    } = useQueueDragDrop();

    async function handlePauseResume() {
        setIsPauseResumeLoading(true);
        try {
            const endpoint = isPaused ? '/queue/resume' : '/queue/pause';
            await fetchApi(endpoint + '?repoId=' + encodeURIComponent(workspaceId), { method: 'POST' });
            await fetchQueue();
        } finally {
            setIsPauseResumeLoading(false);
        }
    }

    const handleRefresh = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await fetchQueue();
        } finally {
            setIsRefreshing(false);
        }
    }, [isRefreshing]);

    const handleTaskContextMenu = useCallback((e: React.MouseEvent, taskId: string, taskStatus: 'running' | 'queued') => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, taskId, taskStatus });
    }, []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
        if (!contextMenu) return [];
        const { taskId, taskStatus } = contextMenu;
        if (taskStatus === 'running') {
            return [{ label: 'Cancel', icon: '✕', onClick: () => handleCancel(taskId) }];
        }
        const queuedIndex = queued.findIndex(t => t.id === taskId);
        const task = queued[queuedIndex];
        const isFrozen = task?.frozen;
        return [
            ...(queuedIndex > 0 ? [{ label: 'Move Up', icon: '▲', onClick: () => handleMoveUp(taskId) }] : []),
            { label: 'Move to Top', icon: '⏬', onClick: () => handleMoveToTop(taskId) },
            { label: '', icon: '', separator: true, onClick: () => {} },
            isFrozen
                ? { label: 'Unfreeze', icon: '▶', onClick: () => handleUnfreeze(taskId) }
                : { label: 'Freeze', icon: '❄', onClick: () => handleFreeze(taskId) },
            { label: 'Cancel', icon: '✕', onClick: () => handleCancel(taskId) },
        ];
    }, [contextMenu, queued]);

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading queue...</div>;
    }

    if (running.length === 0 && queued.length === 0 && history.length === 0) {
        return (
            <div className="p-4 text-center text-sm text-[#848484]">
                {isPaused ? (
                    <>
                        <div className="mb-2">Queue is paused</div>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={isPauseResumeLoading}
                            onClick={handlePauseResume}
                            data-testid="repo-pause-resume-btn-empty"
                        >
                            ▶ Resume
                        </Button>
                    </>
                ) : (
                    <>
                        <div className="mb-2">No tasks in queue for this repository</div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId })}
                            data-testid="repo-queue-task-btn-empty"
                        >
                            + Queue Task
                        </Button>
                    </>
                )}
            </div>
        );
    }

    const taskListContent = (
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
            {/* Pause banner */}
            {isPaused && (
                <div className="rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 px-3 py-1.5 text-xs flex items-center gap-2" data-testid="queue-paused-banner">
                    <span className="flex-1">⏸ Queue is paused — new tasks will not start.</span>
                    <Button variant="ghost" size="sm" disabled={isPauseResumeLoading} onClick={handlePauseResume} data-testid="queue-banner-resume-btn">
                        ▶ Resume
                    </Button>
                </div>
            )}
            {/* Toolbar: Queue label, filter dropdown, pause/resume */}
            <div className={cn('flex items-center gap-2 mb-3')}>
                <span className="text-sm font-medium">Queue</span>
                {isPaused && <Badge status="warning">Paused</Badge>}
                {availableFilters.length > 2 && (
                    <select
                        className="text-xs bg-transparent border border-[#e0e0e0] dark:border-[#3c3c3c] rounded px-1.5 py-0.5 text-[#848484] outline-none"
                        value={filterType}
                        onChange={e => setFilterType(e.target.value)}
                        data-testid="queue-filter-dropdown"
                    >
                        {availableFilters.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                )}
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={isRefreshing}
                    loading={isRefreshing}
                    onClick={handleRefresh}
                    title="Refresh queue"
                    data-testid="queue-refresh-btn"
                >
                    {!isRefreshing && '↺'}
                </Button>
                {(isPaused || running.length > 0 || queued.length > 0) && (
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPauseResumeLoading}
                        onClick={handlePauseResume}
                        title={isPaused ? 'Resume queue' : 'Pause queue'}
                        data-testid="repo-pause-resume-btn"
                    >
                        {isPaused ? '▶' : '⏸'}
                    </Button>
                )}
            </div>

            {/* Running */}
            {filteredRunning.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">
                        Running Tasks <span className="text-[10px]">({filteredRunning.length})</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        {filteredRunning.map(task => (
                            <QueueTaskItem
                                key={task.id}
                                task={task}
                                status="running"
                                now={now}
                                selected={selectedTaskId === task.id}
                                onClick={() => selectTask(task.id, task)}
                                onContextMenu={e => handleTaskContextMenu(e, task.id, 'running')}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Queued */}
            {filteredQueued.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">
                        Queued Tasks <span className="text-[10px]">({filteredQueued.filter((t: any) => t.kind !== 'pause-marker').length})</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        {/* Insert-pause zone before first item */}
                        {!isMobile && (
                            <PauseInsertZone
                                index={-1}
                                active={insertingPauseAt === -1}
                                onMouseEnter={() => setInsertingPauseAt(-1)}
                                onMouseLeave={() => setInsertingPauseAt(null)}
                                onClick={() => handleInsertPauseMarker(-1)}
                            />
                        )}
                        {filteredQueued.map((item: any, index: number) => {
                            const globalIndex = queued.findIndex((q: any) => q.id === item.id);
                            if (item.kind === 'pause-marker') {
                                return (
                                    <PauseMarkerRow
                                        key={item.id}
                                        markerId={item.id}
                                        onRemove={() => handleRemovePauseMarker(item.id)}
                                    />
                                );
                            }
                            return (
                                <div key={item.id}>
                                    <div
                                        draggable={!isMobile}
                                        onDragStart={isMobile ? undefined : createDragStartHandler(item.id, index)}
                                        onDragEnd={isMobile ? undefined : createDragEndHandler()}
                                        onDragOver={isMobile ? undefined : createDragOverHandler(index)}
                                        onDragEnter={isMobile ? undefined : createDragEnterHandler(index)}
                                        onDragLeave={isMobile ? undefined : createDragLeaveHandler(index)}
                                        onDrop={isMobile ? undefined : createDropHandler(index, handleMoveToPosition)}
                                        className={cn(
                                            !isMobile && 'cursor-grab active:cursor-grabbing',
                                            draggedTaskId === item.id && 'opacity-40',
                                            dropTargetIndex === index && dropPosition === 'above' && 'border-t-2 border-[#007fd4]',
                                            dropTargetIndex === index && dropPosition === 'below' && 'border-b-2 border-[#007fd4]',
                                        )}
                                    >
                                        <QueueTaskItem
                                            task={item}
                                            status="queued"
                                            now={now}
                                            selected={selectedTaskId === item.id}
                                            onClick={() => selectTask(item.id, item)}
                                            onContextMenu={e => handleTaskContextMenu(e, item.id, 'queued')}
                                        />
                                    </div>
                                    {/* Insert-pause zone after each task */}
                                    {!isMobile && (
                                        <PauseInsertZone
                                            index={globalIndex}
                                            active={insertingPauseAt === globalIndex}
                                            onMouseEnter={() => setInsertingPauseAt(globalIndex)}
                                            onMouseLeave={() => setInsertingPauseAt(null)}
                                            onClick={() => handleInsertPauseMarker(globalIndex)}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* History */}
            {filteredHistory.length > 0 && (
                <div>
                    <button
                        className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                        onClick={() => setShowHistory(!showHistory)}
                    >
                        {showHistory ? '▼' : '▶'} Completed Tasks ({filteredHistory.length})
                    </button>
                    {showHistory && (
                        <div className="flex flex-col gap-1 mt-1">
                            {filteredHistory.map(task => (
                                <Card
                                    key={task.id}
                                    className={cn(
                                        "p-2 cursor-pointer",
                                        selectedTaskId === task.id && "ring-2 ring-[#0078d4]"
                                    )}
                                    onClick={() => selectTask(task.id, task)}
                                    data-task-id={task.id}
                                >
                                    <div className="flex items-center justify-between gap-1.5 text-xs">
                                        <span className="flex items-center gap-1 min-w-0 truncate">
                                            <span className="shrink-0">
                                                {getTaskTypeIcon(task)}{task.status === 'completed' ? ' ✅' : task.status === 'failed' ? ' ❌' : task.status === 'cancelled' ? ' 🚫' : ''}
                                            </span>
                                            <span className="truncate">
                                                {task.displayName || task.type || 'Task'}
                                            </span>
                                        </span>
                                        <span className="text-[10px] text-[#848484] shrink-0 whitespace-nowrap tabular-nums">
                                            {task.completedAt ? formatRelativeTime(new Date(task.completedAt).toISOString()) : ''}
                                        </span>
                                    </div>
                                    {(() => { const p = getTaskPromptPreview(task); return p ? <div className="text-[10px] text-[#848484] mt-0.5 truncate">{p}</div> : null; })()}
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

    if (isMobile) {
        return (
            <div className="flex flex-col h-full overflow-hidden" data-testid="repo-queue-split-panel">
                {mobileShowDetail && selectedTaskId ? (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="repo-queue-detail-panel">
                        <QueueTaskDetail onBack={() => setMobileShowDetail(false)} />
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="repo-queue-mobile-list">
                        {taskListContent}
                    </div>
                )}
                {contextMenu && (
                    <ContextMenu
                        position={{ x: contextMenu.x, y: contextMenu.y }}
                        items={contextMenuItems}
                        onClose={closeContextMenu}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full overflow-hidden" data-testid="repo-queue-split-panel">
            {/* Left panel — task list */}
            <div className={cn(
                'flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden',
                isTablet ? 'w-64' : 'w-80',
            )}>
                {taskListContent}
            </div>

            {/* Right panel — detail or placeholder */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col" data-testid="repo-queue-detail-panel">
                {selectedTaskId ? (
                    <QueueTaskDetail />
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                        <div className="text-center">
                            <div className="text-2xl mb-2">📋</div>
                            <div>Select a task to view details</div>
                        </div>
                    </div>
                )}
            </div>

            {contextMenu && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={contextMenuItems}
                    onClose={closeContextMenu}
                />
            )}
        </div>
    );
}

/** Return a type-specific icon for a task. */
function getTaskTypeIcon(task: any): string {
    const type = task.type as string;
    const payload = task.payload || {};
    if (type === 'chat' || type === 'readonly-chat') return '💬';
    if (type === 'follow-prompt') {
        if (payload.skillName || (Array.isArray(payload.skillNames) && payload.skillNames.length)) return '🔧';
        if (payload.promptFilePath) return '↩️';
        return '📝';
    }
    if (type === 'code-review') return '🔍';
    if (type === 'resolve-comments') return '💬';
    if (type === 'ai-clarification') return '💡';
    if (type === 'run-pipeline') return '▶️';
    return '🤖';
}

/** Extract a short preview of the user prompt from the task payload. */
function getTaskPromptPreview(task: any): string {
    const text = task.prompt || task.payload?.promptContent || task.payload?.prompt || '';
    if (!text || /^Use the \S+ skill\.$/.test(text)) return '';
    return text.length > 60 ? text.substring(0, 57) + '…' : text;
}

function QueueTaskItem({ task, status, now, selected, onClick, onContextMenu }: {
    task: any;
    status: 'running' | 'queued';
    now: number;
    selected?: boolean;
    onClick?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
}) {
    const name = task.displayName || task.type || 'Task';
    const icon = getTaskTypeIcon(task);
    const promptPreview = getTaskPromptPreview(task);
    let elapsed = '';
    if (status === 'running' && task.startedAt) {
        elapsed = formatDuration(now - new Date(task.startedAt).getTime());
    } else if (task.createdAt) {
        elapsed = formatRelativeTime(new Date(task.createdAt).toISOString());
    }

    return (
        <Card className={cn("p-2 cursor-pointer", selected && "ring-2 ring-[#0078d4]", task.frozen && "opacity-60 italic")} onClick={onClick} onContextMenu={onContextMenu} data-task-id={task.id}>
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] min-w-0">
                    <span className="shrink-0">{icon}</span>
                    <span className="truncate">{name}</span>
                </div>
                {elapsed && (
                    <span className="text-[10px] text-[#848484] shrink-0 whitespace-nowrap tabular-nums">
                        {elapsed}
                    </span>
                )}
            </div>
            {promptPreview && (
                <div className="text-[10px] text-[#848484] mt-0.5 truncate">{promptPreview}</div>
            )}
        </Card>
    );
}

/** Inline separator rendered for a pause marker in the queue. */
function PauseMarkerRow({ markerId, onRemove }: { markerId: string; onRemove: () => void }) {
    return (
        <div
            className="flex items-center gap-1.5 px-2 py-1 rounded border border-dashed border-yellow-400/60 dark:border-yellow-500/50 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400 text-xs"
            data-testid="pause-marker-row"
            title="Queue will pause when it reaches this point"
        >
            <span className="shrink-0 text-[11px]">⏸</span>
            <span className="flex-1 text-[11px]">Queue pauses here</span>
            <button
                className="shrink-0 text-[10px] opacity-50 hover:opacity-100 transition-opacity leading-none"
                onClick={onRemove}
                title="Remove pause point"
                data-testid="pause-marker-remove-btn"
            >
                ✕
            </button>
        </div>
    );
}

/** Hover zone between tasks for inserting a pause marker. */
function PauseInsertZone({ index, active, onMouseEnter, onMouseLeave, onClick }: {
    index: number;
    active: boolean;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onClick: () => void;
}) {
    return (
        <div
            className={cn(
                'flex items-center justify-center overflow-hidden transition-all duration-150 ease-in-out cursor-pointer group',
                active ? 'h-7 opacity-100' : 'h-1 opacity-0',
            )}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            data-testid={`pause-insert-zone-${index}`}
            title="Insert pause here"
        >
            {active && (
                <div className="flex items-center gap-1 text-[10px] text-yellow-600 dark:text-yellow-400 border border-dashed border-yellow-400/60 rounded px-2 py-0.5 w-full justify-center">
                    <span>⏸</span>
                    <span>Insert pause here</span>
                </div>
            )}
        </div>
    );
}
