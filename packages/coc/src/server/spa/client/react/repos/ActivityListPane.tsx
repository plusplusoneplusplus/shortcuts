/**
 * ActivityListPane — shared queue-style left rail for Activity and Queue tabs.
 *
 * Renders running/queued/history sections with filters, drag/drop,
 * pause markers, context menus, and selection highlighting.
 * Shared queue task list used by the Activity tab.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Badge, Card, Button, cn } from '../shared';
import { getApiBase } from '../utils/config';
import { formatDuration, formatRelativeTime } from '../utils/format';
import { useQueueDragDrop } from '../hooks/useQueueDragDrop';
import { useQueueTouchDragDrop } from '../hooks/useQueueTouchDragDrop';
import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu';
import { useWorkflowProgress } from '../hooks/useWorkflowProgress';

/** Primary task types surfaced as individual filter options. */
export const TASK_TYPE_LABELS: Record<string, string> = {
    'chat': 'Chat',
    'run-workflow': 'Run Workflow',
    'run-script': 'Run Script',
};

/** Mode-based labels for chat tasks. */
const CHAT_MODE_LABELS: Record<string, string> = {
    'ask': 'Ask',
    'plan': 'Plan',
    'autopilot': 'Autopilot',
};

export function taskMatchesFilter(task: any, filter: string): boolean {
    if (filter === 'all') return true;
    // Mode-based filtering for chat tasks
    if (filter === 'ask' || filter === 'plan' || filter === 'autopilot') {
        return task.type === 'chat' && task.payload?.mode === filter;
    }
    return task.type === filter;
}

/** Return a type-specific icon for a task, matching the chat mode selector icons. */
export function getTaskTypeIcon(task: any): string {
    const type = task.type as string;
    const payload = task.payload || {};
    if (type === 'chat') {
        if (payload.mode === 'ask') return '💡';
        if (payload.mode === 'plan') return '📋';
        return '🤖';
    }
    if (type === 'run-workflow') return '▶️';
    if (type === 'run-script') return '⚡';
    return '🤖';
}

/** Extract a short preview of the user prompt from the task payload. */
export function getTaskPromptPreview(task: any): string {
    const text = task.prompt || task.payload?.promptContent || task.payload?.prompt || '';
    if (!text || /^Use the \S+ skill\.$/.test(text)) return '';
    return text.length > 60 ? text.substring(0, 57) + '…' : text;
}

export interface ActivityListPaneProps {
    running: any[];
    queued: any[];
    history: any[];
    isPaused: boolean;
    isPauseResumeLoading: boolean;
    isRefreshing: boolean;
    selectedTaskId: string | null;
    isMobile: boolean;
    now: number;
    workspaceId?: string;
    /** Set of task IDs with unseen activity (bold + dot indicator). */
    unseenTaskIds?: Set<string>;
    /** Mark all completed tasks as read. */
    onMarkAllRead?: () => void;
    /** Mark a single completed task as read. */
    onMarkRead?: (taskId: string) => void;
    /** Mark a single completed task as unread. */
    onMarkUnread?: (taskId: string) => void;
    onSelectTask: (id: string, task?: any) => void;
    onPauseResume: () => void;
    onRefresh: () => void;
    onOpenDialog: () => void;
    fetchQueue: () => Promise<void>;
}

export function ActivityListPane({
    running,
    queued,
    history,
    isPaused,
    isPauseResumeLoading,
    isRefreshing,
    selectedTaskId,
    isMobile,
    now,
    workspaceId,
    unseenTaskIds,
    onMarkAllRead,
    onMarkRead,
    onMarkUnread,
    onSelectTask,
    onPauseResume,
    onRefresh,
    onOpenDialog,
    fetchQueue,
}: ActivityListPaneProps) {
    const [filterType, setFilterType] = useState<string>('all');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string; taskStatus: 'running' | 'queued' | 'completed' } | null>(null);
    const [insertingPauseAt, setInsertingPauseAt] = useState<number | null>(null);

    useEffect(() => {
        setFilterType('all');
    }, [workspaceId]);

    const allTasks = useMemo(
        () => [...running, ...queued.filter((t: any) => t.kind !== 'pause-marker'), ...history],
        [running, queued, history],
    );
    const availableFilters = useMemo(() => {
        const opts: { value: string; label: string }[] = [{ value: 'all', label: 'All' }];
        const types = new Set(allTasks.map((t: any) => t.type as string));
        for (const [type, label] of Object.entries(TASK_TYPE_LABELS)) {
            if (types.has(type)) opts.push({ value: type, label });
        }
        // Add mode-based sub-filters for chat tasks
        const chatTasks = allTasks.filter((t: any) => t.type === 'chat');
        const modes = new Set(chatTasks.map((t: any) => t.payload?.mode as string).filter(Boolean));
        for (const [mode, label] of Object.entries(CHAT_MODE_LABELS)) {
            if (modes.has(mode)) opts.push({ value: mode, label: `Chat: ${label}` });
        }
        return opts;
    }, [allTasks]);

    const filteredRunning = useMemo(() => running.filter(t => taskMatchesFilter(t, filterType)), [running, filterType]);
    const filteredQueued = useMemo(
        () => queued.filter(t => t.kind === 'pause-marker' || taskMatchesFilter(t, filterType)),
        [queued, filterType],
    );
    const filteredHistory = useMemo(() => history.filter(t => taskMatchesFilter(t, filterType)), [history, filterType]);

    const [showHistory, setShowHistory] = useState(true);

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
            body: JSON.stringify({ afterIndex, ...(workspaceId ? { repoId: workspaceId } : {}) }),
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

    const touchDrag = useQueueTouchDragDrop();

    // Merge drag state from desktop (HTML5) and mobile (touch) hooks
    const activeDraggedTaskId = draggedTaskId || touchDrag.draggedTaskId;
    const activeDropTargetIndex = dropTargetIndex ?? touchDrag.dropTargetIndex;
    const activeDropPosition = dropPosition || touchDrag.dropPosition;

    const handleTaskContextMenu= useCallback((e: React.MouseEvent, taskId: string, taskStatus: 'running' | 'queued' | 'completed') => {
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
        if (taskStatus === 'completed') {
            const isUnseen = unseenTaskIds?.has(taskId) ?? false;
            return [
                ...(isUnseen && onMarkRead ? [{ label: 'Mark as Read', icon: '✓', onClick: () => onMarkRead(taskId) }] : []),
                ...(!isUnseen && onMarkUnread ? [{ label: 'Mark as Unread', icon: '●', onClick: () => onMarkUnread(taskId) }] : []),
            ];
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
    }, [contextMenu, queued, unseenTaskIds, onMarkRead, onMarkUnread]);

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
                            onClick={onPauseResume}
                            data-testid="repo-pause-resume-btn-empty"
                        >
                            ▶ Resume
                        </Button>
                    </>
                ) : (
                    <>
                        <div className="mb-2">{workspaceId ? 'No tasks in queue for this repository' : 'No tasks in queue'}</div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onOpenDialog}
                            data-testid="repo-queue-task-btn-empty"
                        >
                            + Queue Task
                        </Button>
                    </>
                )}
            </div>
        );
    }

    return (
        <>
            <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
                {isPaused && (
                    <div className="rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 px-3 py-1.5 text-xs flex items-center gap-2" data-testid="queue-paused-banner">
                        <span className="flex-1">⏸ Queue is paused — new tasks will not start.</span>
                        <Button variant="ghost" size="sm" disabled={isPauseResumeLoading} onClick={onPauseResume} data-testid="queue-banner-resume-btn">
                            ▶ Resume
                        </Button>
                    </div>
                )}
                <div className={cn('flex items-center gap-2 mb-3')}>
                    <span className="text-sm font-medium">Queue</span>
                    {isPaused && <Badge status="warning">Paused</Badge>}
                    {availableFilters.length > 2 && (
                        <select
                            className="text-xs bg-transparent border border-[#e0e0e0] dark:border-[#474749] rounded px-1.5 py-0.5 text-[#848484] dark:text-[#999] outline-none"
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
                        onClick={onRefresh}
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
                            onClick={onPauseResume}
                            title={isPaused ? 'Resume queue' : 'Pause queue'}
                            data-testid="repo-pause-resume-btn"
                        >
                            {isPaused ? '▶' : '⏸'}
                        </Button>
                    )}
                </div>

                {filteredRunning.length > 0 && (
                    <div>
                        <div className="text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] mb-1 font-medium">
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
                                    onClick={() => onSelectTask(task.id, task)}
                                    onContextMenu={e => handleTaskContextMenu(e, task.id, 'running')}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {filteredQueued.length > 0 && (
                    <div>
                        <div className="text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] mb-1 font-medium">
                            Queued Tasks <span className="text-[10px]">({filteredQueued.filter((t: any) => t.kind !== 'pause-marker').length})</span>
                        </div>
                        <div className="flex flex-col gap-1">
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
                                            data-queue-index={index}
                                            draggable={!isMobile}
                                            onDragStart={isMobile ? undefined : createDragStartHandler(item.id, index)}
                                            onDragEnd={isMobile ? undefined : createDragEndHandler()}
                                            onDragOver={isMobile ? undefined : createDragOverHandler(index)}
                                            onDragEnter={isMobile ? undefined : createDragEnterHandler(index)}
                                            onDragLeave={isMobile ? undefined : createDragLeaveHandler(index)}
                                            onDrop={isMobile ? undefined : createDropHandler(index, handleMoveToPosition)}
                                            onTouchStart={isMobile ? touchDrag.createTouchStartHandler(item.id, index, handleMoveToPosition) : undefined}
                                            className={cn(
                                                !isMobile && 'cursor-grab active:cursor-grabbing',
                                                activeDraggedTaskId === item.id && 'opacity-40',
                                                activeDropTargetIndex === index && activeDropPosition === 'above' && 'border-t-2 border-[#007fd4]',
                                                activeDropTargetIndex === index && activeDropPosition === 'below' && 'border-b-2 border-[#007fd4]',
                                            )}
                                        >
                                            <QueueTaskItem
                                                task={item}
                                                status="queued"
                                                now={now}
                                                selected={selectedTaskId === item.id}
                                                onClick={() => onSelectTask(item.id, item)}
                                                onContextMenu={e => handleTaskContextMenu(e, item.id, 'queued')}
                                            />
                                        </div>
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

                {filteredHistory.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1.5">
                            <button
                                className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                                onClick={() => setShowHistory(!showHistory)}
                            >
                                {showHistory ? '▼' : '▶'} Completed Tasks ({filteredHistory.length})
                                {unseenTaskIds && (() => {
                                    const count = filteredHistory.filter(t => unseenTaskIds.has(t.id)).length;
                                    return count > 0 ? (
                                        <span className="ml-1 text-[9px] bg-[#0078d4] text-white px-1.5 py-px rounded-full" data-testid="unseen-count-badge">{count}</span>
                                    ) : null;
                                })()}
                            </button>
                            {onMarkAllRead && unseenTaskIds && filteredHistory.some(t => unseenTaskIds.has(t.id)) && (
                                <button
                                    className="text-[10px] text-[#0078d4] dark:text-[#3794ff] hover:underline transition-colors"
                                    onClick={onMarkAllRead}
                                    data-testid="mark-all-read-btn"
                                >
                                    Mark all read
                                </button>
                            )}
                        </div>
                        {showHistory && (
                            <div className="flex flex-col gap-1 mt-1">
                                {filteredHistory.map(task => {
                                    const isUnseen = unseenTaskIds?.has(task.id) ?? false;
                                    return (
                                        <Card
                                            key={task.id}
                                            className={cn(
                                                "p-2 cursor-pointer",
                                                selectedTaskId === task.id && "ring-2 ring-[#0078d4]"
                                            )}
                                            onClick={() => onSelectTask(task.id, task)}
                                            onContextMenu={e => handleTaskContextMenu(e, task.id, 'completed')}
                                            data-task-id={task.id}
                                            data-unseen={isUnseen || undefined}
                                        >
                                            <div className="flex items-center justify-between gap-1.5 text-xs">
                                                <span className="flex items-center gap-1 min-w-0 truncate">
                                                    {isUnseen && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]" data-testid="unseen-dot" />}
                                                    <span className="shrink-0">
                                                        {getTaskTypeIcon(task)}{task.status === 'completed' ? ' ✅' : task.status === 'failed' ? ' ❌' : task.status === 'cancelled' ? ' 🚫' : ''}
                                                    </span>
                                                    <span className={cn("truncate", isUnseen && "font-semibold")}>
                                                        {task.displayName || task.type || 'Task'}
                                                    </span>
                                                </span>
                                                <span className="text-[10px] text-[#848484] dark:text-[#999] shrink-0 whitespace-nowrap tabular-nums">
                                                    {task.completedAt ? formatRelativeTime(new Date(task.completedAt).toISOString()) : ''}
                                                </span>
                                            </div>
                                            {(() => { const p = getTaskPromptPreview(task); return p ? <div className={cn("text-[10px] mt-0.5 truncate", isUnseen ? "text-[#1e1e1e] dark:text-[#cccccc]" : "text-[#848484] dark:text-[#999]")}>{p}</div> : null; })()}
                                            {task.error && (
                                                <div className="text-[10px] text-red-500 mt-0.5 truncate">
                                                    {task.error.length > 80 ? task.error.substring(0, 77) + '...' : task.error}
                                                </div>
                                            )}
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
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
        </>
    );
}

export function QueueTaskItem({ task, status, now, selected, onClick, onContextMenu }: {
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
    const showProgress = task.type === 'run-workflow' && status === 'running';
    const progress = useWorkflowProgress(showProgress ? (task.processId || task.id) : null);
    let elapsed = '';
    if (status === 'running' && task.startedAt) {
        elapsed = formatDuration(now - new Date(task.startedAt).getTime());
    } else if (task.createdAt) {
        elapsed = formatRelativeTime(new Date(task.createdAt).toISOString());
    }

    return (
        <Card className={cn("p-2 cursor-pointer", selected && "ring-2 ring-[#0078d4]", task.frozen && "task-frozen")} onClick={onClick} onContextMenu={onContextMenu} data-task-id={task.id}>
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] min-w-0">
                    <span className="shrink-0">{task.frozen ? '❄️' : icon}</span>
                    <span className="truncate">{name}</span>
                </div>
                {elapsed && (
                    <span className="text-[10px] text-[#848484] dark:text-[#999] shrink-0 whitespace-nowrap tabular-nums">
                        {elapsed}
                    </span>
                )}
            </div>
            {promptPreview && (
                <div className="text-[10px] text-[#848484] dark:text-[#999] mt-0.5 truncate">{promptPreview}</div>
            )}
            {showProgress && progress && progress.total > 0 && (
                <div className="mt-1" data-testid="workflow-progress-indicator">
                    <div className="text-[10px] text-[#0078d4] dark:text-[#3794ff]">
                        ▶ Map: {progress.completed}/{progress.total}
                    </div>
                    <div className="mt-0.5 h-[2px] rounded-full bg-[#e0e0e0] dark:bg-[#474749] overflow-hidden">
                        <div
                            className="h-full rounded-full bg-[#0078d4] dark:bg-[#3794ff] transition-[width] duration-300"
                            style={{ width: `${Math.min(100, (progress.completed / progress.total) * 100)}%` }}
                        />
                    </div>
                </div>
            )}
        </Card>
    );
}

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
