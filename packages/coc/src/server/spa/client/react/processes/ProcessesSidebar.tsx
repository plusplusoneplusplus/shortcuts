/**
 * ProcessesSidebar — unified sidebar merging legacy ProcessList and QueuePanel.
 * Renders stats bar, queue running/queued tasks, legacy process cards,
 * enqueue button, and collapsible history in a single scrollable section.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../contexts/AppContext';
import { useQueue } from '../contexts/QueueContext';
import { Card, Badge, Button, cn } from '../ui';
import { RenameDialog } from '../ui/RenameDialog';
import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu';
import { useLongPress } from '../hooks/ui/useLongPress';
import { getSpaCocClient } from '../api/cocClient';
import { formatDuration, statusIcon, statusLabel, typeLabel, repoName } from '../utils/format';
import { resolveWorkspaceName, getProcessWorkspaceId, getProcessWorkspaceName } from '../utils/workspace';
import { isQueueProcessId, toQueueProcessId } from '../utils/queue-process-id';

export interface TypeFilterOptions {
    includeTypes?: string[];
    excludeTypes?: string[];
}

export function filterQueueTask(
    task: any,
    searchQuery: string,
    statusFilter: string,
    workspace: string,
    typeFilter?: TypeFilterOptions,
): boolean {
    if (typeFilter?.includeTypes && !typeFilter.includeTypes.includes(task.type)) return false;
    if (typeFilter?.excludeTypes && typeFilter.excludeTypes.includes(task.type)) return false;
    if (statusFilter !== '__all' && task.status !== statusFilter) return false;
    if (workspace !== '__all') {
        const repoId = task.repoId || task.workingDirectory || task.payload?.workingDirectory || '';
        if (repoId !== workspace) return false;
    }
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = [task.displayName, task.prompt, task.type, task.id]
            .filter(Boolean).join(' ').toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
    }
    return true;
}

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
    const [enqueueMenuOpen, setEnqueueMenuOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; processId: string } | null>(null);
    const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);

    // Long-press support for legacy process cards (mobile context menu)
    const processLongPressIdRef = useRef<string>('');
    const processLongPress = useLongPress(
        (x: number, y: number) => {
            const processId = processLongPressIdRef.current;
            const p = state.processes.find((proc: any) => proc.id === processId);
            if (p && ['completed', 'failed', 'cancelled'].includes(p.status)) {
                setContextMenu({ x, y, processId });
            }
        },
    );

    const navigateToRepo= useCallback((e: React.MouseEvent, workspaceId: string) => {
        e.stopPropagation();
        location.hash = '#repos/' + encodeURIComponent(workspaceId);
    }, []);

    const handleRename = useCallback(async (newTitle: string) => {
        if (!renameTarget) return;
        setRenameTarget(null);
        try {
            await getSpaCocClient().processes.update(renameTarget.id, { customTitle: newTitle });
            dispatch({ type: 'PROCESS_UPDATED', process: { id: renameTarget.id, customTitle: newTitle } });
        } catch { /* WS will sync eventually */ }
    }, [renameTarget, dispatch]);

    // Queue task filtering
    const typeFilterOpts = useMemo(
        () => state.typeFilter !== '__all' ? { includeTypes: [state.typeFilter] } : undefined,
        [state.typeFilter]
    );
    const filteredRunning = useMemo(
        () => running.filter((t: any) => filterQueueTask(t, state.searchQuery, state.statusFilter, state.workspace, typeFilterOpts)),
        [running, state.searchQuery, state.statusFilter, state.workspace, typeFilterOpts]
    );
    const filteredQueued = useMemo(
        () => queued.filter((t: any) => filterQueueTask(t, state.searchQuery, state.statusFilter, state.workspace, typeFilterOpts)),
        [queued, state.searchQuery, state.statusFilter, state.workspace, typeFilterOpts]
    );
    const filteredHistory = useMemo(
        () => history.filter((t: any) => filterQueueTask(t, state.searchQuery, state.statusFilter, state.workspace, typeFilterOpts)),
        [history, state.searchQuery, state.statusFilter, state.workspace, typeFilterOpts]
    );

    // Legacy process filtering
    const filteredLegacy = useMemo(() => {
        return state.processes
            .filter((p: any) => {
                if (isQueueProcessId(p.id)) return false;
                if (p.parentProcessId) return false;
                if (state.workspace !== '__all' && p.workspaceId !== state.workspace) return false;
                if (state.statusFilter !== '__all' && p.status !== state.statusFilter) return false;
                if (state.typeFilter !== '__all' && p.type !== state.typeFilter) return false;
                if (state.searchQuery) {
                    const q = state.searchQuery.toLowerCase();
                    const title = (p.customTitle || p.title || p.lastMessagePreview || p.promptPreview || p.id || '').toLowerCase();
                    if (title.indexOf(q) === -1) return false;
                }
                return true;
            })
            .sort((a: any, b: any) => {
                const order: Record<string, number> = { running: 0, queued: 1, failed: 2, completed: 3, cancelled: 4 };
                const sa = order[a.status] ?? 5;
                const sb = order[b.status] ?? 5;
                if (sa !== sb) return sa - sb;
                return new Date(b.lastEventAt || b.startTime || 0).getTime() - new Date(a.lastEventAt || a.startTime || 0).getTime();
            });
    }, [state.processes, state.workspace, state.statusFilter, state.typeFilter, state.searchQuery]);

    // Unified live timer
    const hasActive = useMemo(
        () => filteredRunning.length > 0 || filteredLegacy.some((p: any) => p.status === 'running'),
        [filteredRunning, filteredLegacy]
    );

    useEffect(() => {
        if (!hasActive) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hasActive]);

    const openTaskInRoute = useCallback((task: any) => {
        const processId = typeof task?.processId === 'string' && task.processId
            ? task.processId
            : toQueueProcessId(task.id);
        const nextHash = '#process/' + encodeURIComponent(processId);

        if (location.hash !== nextHash) {
            location.hash = nextHash;
            return;
        }

        queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
    }, [queueDispatch]);

    const hasQueueActive = running.length > 0 || queued.length > 0;

    const historyCompleted = useMemo(() => history.filter((t: any) => t.status === 'completed').length, [history]);
    const historyFailed = useMemo(() => history.filter((t: any) => t.status === 'failed').length, [history]);

    async function handlePauseResume() {
        setIsPauseResumeLoading(true);
        try {
            if (stats.isPaused) {
                await getSpaCocClient().queue.resume();
            } else {
                await getSpaCocClient().queue.pause();
            }
            const data = await getSpaCocClient().queue.list();
            queueDispatch({ type: 'QUEUE_UPDATED', queue: data });
        } finally {
            setIsPauseResumeLoading(false);
        }
    }

    async function handleClearQueue() {
        if (!confirm('Clear all queued tasks?')) return;
        setIsClearLoading(true);
        try {
            await getSpaCocClient().queue.clear();
            const data = await getSpaCocClient().queue.list();
            queueDispatch({ type: 'QUEUE_UPDATED', queue: data });
        } finally {
            setIsClearLoading(false);
        }
    }

    const isEmpty = filteredRunning.length === 0 && filteredQueued.length === 0 && filteredLegacy.length === 0;

    // When search results are active (non-null), render search results view
    if (state.searchResults !== null) {
        return (
            <div className="flex flex-col gap-3 min-h-0 p-2">
                <SearchResultsView
                    results={state.searchResults}
                    loading={state.searchLoading}
                    onSelectProcess={(processId: string) => {
                        const nextHash = '#process/' + encodeURIComponent(processId);
                        if (location.hash !== nextHash) {
                            location.hash = nextHash;
                        } else {
                            dispatch({ type: 'SELECT_PROCESS', id: processId });
                            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
                        }
                    }}
                    selectedId={state.selectedId}
                />
            </div>
        );
    }

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
                <span>✅ {historyCompleted} done</span>
                <span>❌ {historyFailed} failed</span>
                {stats.isPaused && <Badge status="warning" title={stats.pauseReason ? `${stats.pauseReason.displayName} failed` : undefined}>Paused</Badge>}
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
            {filteredRunning.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">Running</div>
                    {groupByFolder(filteredRunning).map(({ folder, tasks }) => (
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
            {filteredQueued.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase text-[#848484] mb-1 font-medium">Queued</div>
                    {groupByFolder(filteredQueued).map(({ folder, tasks }) => (
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
                <div id="empty-state" className="py-6 text-center text-sm text-[#848484]">
                    No processes yet
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
                        const hasCustomTitle = Boolean(p.customTitle);
                        const hasAITitle = !hasCustomTitle && Boolean(p.title);
                        // Display priority:
                        //   1) user-set custom title
                        //   2) AI-generated title
                        //   3) latest message preview (newest turn)
                        //   4) prompt preview / id
                        const previewSource = p.customTitle
                            || p.title
                            || p.lastMessagePreview
                            || p.promptPreview
                            || p.id;
                        const preview = typeof previewSource === 'string' && previewSource.length > 80
                            ? previewSource.slice(0, 80) + '…'
                            : previewSource;
                        const wsId = getProcessWorkspaceId(p);
                        const wsName = resolveWorkspaceName(wsId, getProcessWorkspaceName(p), state.workspaces);

                        return (
                            <Card
                                key={p.id}
                                onClick={() => {
                                    if (processLongPress.didLongPress()) return;
                                    const nextHash = '#process/' + encodeURIComponent(p.id);
                                    if (location.hash !== nextHash) {
                                        location.hash = nextHash;
                                    } else {
                                        dispatch({ type: 'SELECT_PROCESS', id: p.id });
                                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
                                    }
                                }}
                                onContextMenu={(e: React.MouseEvent) => {
                                    if (['completed', 'failed', 'cancelled'].includes(p.status)) {
                                        e.preventDefault();
                                        setContextMenu({ x: e.clientX, y: e.clientY, processId: p.id });
                                    }
                                }}
                                onTouchStart={(e: React.TouchEvent) => { processLongPressIdRef.current = p.id; processLongPress.onTouchStart(e); }}
                                onTouchEnd={processLongPress.onTouchEnd}
                                onTouchMove={processLongPress.onTouchMove}
                                className={cn(
                                    'p-2.5 process-item',
                                    isActive && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff]'
                                )}
                            >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <Badge status={p.status}>
                                        {statusIcon(p.status)} {statusLabel(p.status, p.type)}
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
                                <div
                                    className="text-xs text-[#1e1e1e] dark:text-[#cccccc] line-clamp-2 break-words cursor-text select-none"
                                    title="Double-click to rename"
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        setRenameTarget({ id: p.id, title: p.customTitle || '' });
                                    }}
                                >
                                    {preview}
                                    {hasAITitle && <span className="ml-1 text-[10px] text-[#848484]">✦</span>}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Enqueue button with dropdown */}
            <div className="flex relative">
                <Button
                    variant="primary"
                    size="sm"
                    onClick={() => queueDispatch({ type: 'OPEN_DIALOG' })}
                >
                    + Enqueue
                </Button>
                <button
                    className="ml-1 px-1 text-xs rounded bg-[#0078d4] text-white hover:bg-[#106ebe] dark:bg-[#0e639c] dark:hover:bg-[#1177bb]"
                    onClick={() => setEnqueueMenuOpen(v => !v)}
                    data-testid="enqueue-dropdown-toggle"
                    title="More enqueue options"
                >
                    ▾
                </button>
                {enqueueMenuOpen && (
                    <div
                        className="absolute top-full left-0 mt-1 z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-lg min-w-[160px]"
                        data-testid="enqueue-dropdown-menu"
                    >
                        <button
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]"
                            onClick={() => { setEnqueueMenuOpen(false); queueDispatch({ type: 'OPEN_DIALOG' }); }}
                            data-testid="enqueue-chat-task"
                        >
                            💬 Chat Task
                        </button>
                        <button
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]"
                            onClick={() => { setEnqueueMenuOpen(false); queueDispatch({ type: 'OPEN_SCRIPT_DIALOG' }); }}
                            data-testid="enqueue-run-script"
                        >
                            🛠️ Prompt & Script
                        </button>
                    </div>
                )}
            </div>

            {/* History section */}
            <div className="min-h-0">
                <button
                    className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                    onClick={() => queueDispatch({ type: 'TOGGLE_HISTORY' })}
                >
                    {showHistory ? '▼' : '▶'} History ({filteredHistory.length})
                </button>
                {showHistory && filteredHistory.length > 0 && (
                    <div className="mt-1 max-h-[38vh] overflow-y-auto pr-1 space-y-1">
                        {filteredHistory.map((task: any) => (
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

            {contextMenu && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={[
                        {
                            label: 'Rename',
                            icon: '✏️',
                            onClick: () => {
                                const p: any = state.processes.find((proc: any) => proc.id === contextMenu.processId);
                                setRenameTarget({ id: contextMenu.processId, title: p?.customTitle || '' });
                                setContextMenu(null);
                            },
                        },
                    ]}
                    onClose={() => setContextMenu(null)}
                />
            )}

            <RenameDialog
                open={!!renameTarget}
                currentTitle={renameTarget?.title ?? ''}
                onConfirm={handleRename}
                onCancel={() => setRenameTarget(null)}
            />
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
            className={cn('process-item', compact ? 'px-2 py-1.5' : 'p-2', selected && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff]', task.frozen && 'task-frozen')}
            aria-label={`Task ${statusLabel(task.status, task.type).toLowerCase()}: ${preview}`}
        >
            {compact ? (
                <div className="flex items-center gap-1.5 min-w-0 text-[11px] leading-5">
                    <span className="shrink-0">{task.frozen ? '❄️' : statusIcon(task.status)}</span>
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
                        <Badge status={task.frozen ? 'cancelled' : task.status}>
                            {task.frozen ? '❄️' : statusIcon(task.status)} {task.frozen ? 'Frozen' : statusLabel(task.status, task.type)}
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

// ── Search results grouped by process ──────────────────────────────────

interface GroupedSearchResult {
    processId: string;
    processTitle?: string;
    promptPreview: string;
    processStatus: string;
    startTime: string;
    turns: { turnIndex: number; role: string; snippet: string; rank: number }[];
}

function groupSearchResults(results: any[]): GroupedSearchResult[] {
    const map = new Map<string, GroupedSearchResult>();
    for (const r of results) {
        if (!map.has(r.processId)) {
            map.set(r.processId, {
                processId: r.processId,
                processTitle: r.processTitle,
                promptPreview: r.promptPreview,
                processStatus: r.processStatus,
                startTime: r.startTime,
                turns: [],
            });
        }
        map.get(r.processId)!.turns.push({
            turnIndex: r.turnIndex,
            role: r.role,
            snippet: r.snippet,
            rank: r.rank,
        });
    }
    return Array.from(map.values());
}

function SearchResultsView({ results, loading, onSelectProcess, selectedId }: {
    results: any[];
    loading: boolean;
    onSelectProcess: (processId: string) => void;
    selectedId: string | null;
}) {
    if (loading) {
        return (
            <div className="py-6 text-center text-sm text-[#848484]" data-testid="search-results-loading">
                Searching…
            </div>
        );
    }

    if (results.length === 0) {
        return (
            <div className="py-6 text-center text-sm text-[#848484]" data-testid="search-no-results">
                No results found
            </div>
        );
    }

    const grouped = groupSearchResults(results);

    return (
        <div data-testid="search-results-view">
            <div className="text-[11px] text-[#848484] mb-2 font-medium" data-testid="search-results-count">
                {results.length} result{results.length !== 1 ? 's' : ''} in {grouped.length} process{grouped.length !== 1 ? 'es' : ''}
            </div>
            <div className="flex flex-col gap-2">
                {grouped.map((group) => {
                    const isActive = selectedId === group.processId;
                    const title = group.processTitle || (
                        group.promptPreview
                            ? (group.promptPreview.length > 60 ? group.promptPreview.slice(0, 60) + '…' : group.promptPreview)
                            : group.processId
                    );

                    return (
                        <Card
                            key={group.processId}
                            onClick={() => onSelectProcess(group.processId)}
                            className={cn(
                                'p-2 cursor-pointer',
                                isActive && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff]'
                            )}
                            data-testid="search-result-card"
                        >
                            <div className="flex items-center justify-between gap-2 mb-1">
                                <Badge status={group.processStatus}>
                                    {statusIcon(group.processStatus)} {statusLabel(group.processStatus, group.processType)}
                                </Badge>
                            </div>
                            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc] line-clamp-1 break-words mb-1.5">
                                {title}
                            </div>
                            <div className="flex flex-col gap-1">
                                {group.turns.map((turn) => (
                                    <div
                                        key={`${group.processId}-${turn.turnIndex}`}
                                        className="text-[11px] text-[#848484] bg-[#f5f5f5] dark:bg-[#2d2d2d] rounded px-1.5 py-1"
                                        data-testid="search-result-snippet"
                                    >
                                        <span className="inline-block text-[10px] font-medium mr-1 text-[#0078d4] dark:text-[#3794ff]">
                                            {turn.role}
                                        </span>
                                        <span
                                            className="search-snippet"
                                            dangerouslySetInnerHTML={{ __html: turn.snippet }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
