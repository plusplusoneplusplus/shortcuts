/**
 * RepoActivityTab — unified Activity tab combining a queue-style left rail
 * with conditional right-pane rendering for chat tasks versus other queue tasks.
 *
 * Top-level chat tasks are rendered inline via ActivityChatDetail.
 * All task types are handled by the unified ActivityChatDetail component.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { useRepos } from '../context/ReposContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ActivityListPane } from './ActivityListPane';
import { ActivityDetailPane } from './ActivityDetailPane';
import { useUnseenActivity } from '../hooks/useUnseenActivity';
import { ChatPreferencesProvider } from '../context/ChatPreferencesContext';
import { useNotifications } from '../context/NotificationContext';
import type { ProcessHistoryItem } from '../../../../shared/process-history-item';
import { isQueueProcessId, toQueueProcessId, toTaskId } from '../utils/queue-process-id';

export interface RepoActivityTabProps {
    workspaceId: string;
}

export function RepoActivityTab({ workspaceId }: RepoActivityTabProps) {
    const [running, setRunning] = useState<any[]>([]);
    const [queued, setQueued] = useState<any[]>([]);
    const [history, setHistory] = useState<ProcessHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [now, setNow] = useState(Date.now());
    const [isPaused, setIsPaused] = useState(false);
    const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
    const [isAutopilotPaused, setIsAutopilotPaused] = useState(false);
    const [isAutopilotPauseLoading, setIsAutopilotPauseLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pauseReason, setPauseReason] = useState<{ taskId: string; displayName: string; failedAt: string } | undefined>();

    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { dispatch: appDispatch } = useApp();
    const { refreshUnseenCounts } = useRepos();
    const selectedTaskId = queueState.selectedTaskIdByRepo[workspaceId] ?? null;
    const { isMobile, isTablet } = useBreakpoint();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: isTablet ? 256 : 320,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'activity-left-panel-width',
    });
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    const repoQueue = queueState.repoQueueMap[workspaceId];

    /** Match a task against selectedTaskId which may be a processId (queue_xxx). */
    function findBySelectedId(tasks: any[], selectedId: string): any | undefined {
        return tasks.find((t: any) =>
            t.id === selectedId ||
            t.processId === selectedId ||
            (!isQueueProcessId(t.id) && toQueueProcessId(t.id) === selectedId)
        );
    }

    // Track the selected task object for detail pane routing
    const [selectedTask, setSelectedTask] = useState<any>(null);
    const selectedTaskRef = useRef<any>(null);

    const fetchHistory = useCallback(async (offset = 0) => {
        const data = await fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/history?limit=100&offset=${offset}`
        ).catch(() => null);
        const items = (data?.history as ProcessHistoryItem[]) || [];
        if (offset === 0) {
            setHistory(items);
        } else {
            setHistory(prev => [...prev, ...items]);
        }
        setHasMore(data?.hasMore ?? false);
    }, [workspaceId]);

    const fetchQueue = useCallback(async () => {
        try {
            const data = await fetchApi('/queue?repoId=' + encodeURIComponent(workspaceId));
            const nextRunning = data?.running || [];
            const nextQueued = data?.queued || [];
            const nextStats = data?.stats || undefined;
            setRunning(nextRunning);
            setQueued(nextQueued);
            setIsPaused(!!nextStats?.isPaused);
            setPauseReason(nextStats?.pauseReason);
            setIsAutopilotPaused(!!nextStats?.isAutopilotPaused);
            await fetchHistory();

            queueDispatch({
                type: 'REPO_QUEUE_UPDATED',
                repoId: workspaceId,
                queue: { queued: nextQueued, running: nextRunning, stats: nextStats },
            });
        } catch {
            setRunning([]);
            setQueued([]);
            setHistory([]);
        }
        setLoading(false);
    }, [workspaceId, queueDispatch, fetchHistory]);

    const handleLoadMore = useCallback(async () => {
        setLoadingMore(true);
        try {
            await fetchHistory(history.length);
        } finally {
            setLoadingMore(false);
        }
    }, [fetchHistory, history.length]);

    useEffect(() => {
        setLoading(true);
        fetchQueue();
    }, [workspaceId, fetchQueue]);

    // Track active (running + queued) task IDs to detect departures and arrivals
    const prevActiveIdsRef = useRef<string[]>([]);

    // Apply per-repo WS updates
    useEffect(() => {
        if (!repoQueue) return;
        setRunning(repoQueue.running);
        setQueued(repoQueue.queued);

        // Detect task departures or arrivals and refetch history.
        // Departure: a previously-active ID disappeared (task completed/failed).
        // Arrival: a new active ID exists in our local history (follow-up re-queue).
        const currIds = [
            ...repoQueue.running.map((t: any) => t.id),
            ...repoQueue.queued.map((t: any) => t.id),
        ];
        const prevIds = prevActiveIdsRef.current;
        const hasDeparture = prevIds.some(id => !currIds.includes(id));
        const historyIds = new Set(history.map((t: any) => t.id));
        const hasArrivalFromHistory = currIds.some(id => !prevIds.includes(id) && historyIds.has(id));
        prevActiveIdsRef.current = currIds;

        if (hasDeparture || hasArrivalFromHistory) {
            fetchHistory();
        }

        if (repoQueue?.stats?.isPaused !== undefined) {
            setIsPaused(repoQueue.stats.isPaused);
            setPauseReason(repoQueue.stats.pauseReason);
        }
        if (repoQueue?.stats?.isAutopilotPaused !== undefined) {
            setIsAutopilotPaused(repoQueue.stats.isAutopilotPaused);
        }
        setLoading(false);
    }, [repoQueue, workspaceId]);

    // Clear selection if the selected task is no longer reachable.
    // Tasks from deep-links may not appear in the paginated history list,
    // so we verify via the API before clearing.
    useEffect(() => {
        if (!selectedTaskId || loading) return;
        const allTasks = [...running, ...queued, ...history];
        if (findBySelectedId(allTasks, selectedTaskId)) return;

        let cancelled = false;
        // selectedTaskId is always a processId; probe /processes/ first, fall back to /queue/
        const probeProcess = fetchApi(`/processes/${encodeURIComponent(selectedTaskId)}`)
            .then((data: any) => {
                if (cancelled) return;
                if (data?.process) return; // found
                // Not found as process — try queue with derived bare taskId
                const bareId = isQueueProcessId(selectedTaskId) ? toTaskId(selectedTaskId) : selectedTaskId;
                return fetchApi(`/queue/${encodeURIComponent(bareId)}`).then((qData: any) => {
                    if (cancelled) return;
                    if (!qData?.task) throw new Error('not found');
                });
            })
            .catch(() => {
                if (cancelled) return;
                queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
                setSelectedTask(null);
                selectedTaskRef.current = null;
                const activityBase = '#repos/' + encodeURIComponent(workspaceId) + '/activity';
                if (location.hash.startsWith(activityBase + '/')) {
                    location.hash = activityBase;
                }
            });
        void probeProcess;
        return () => { cancelled = true; };
    }, [selectedTaskId, running, queued, history, loading, queueDispatch, workspaceId]);

    // Update selectedTask when lists change
    useEffect(() => {
        if (!selectedTaskId) {
            setSelectedTask(null);
            selectedTaskRef.current = null;
            return;
        }
        const allTasks = [...running, ...queued, ...history];
        const found = findBySelectedId(allTasks, selectedTaskId) || null;
        setSelectedTask(found);
        selectedTaskRef.current = found;
    }, [selectedTaskId, running, queued, history]);

    // Reset mobile detail view when selection is cleared
    useEffect(() => {
        if (!selectedTaskId) setMobileShowDetail(false);
    }, [selectedTaskId]);

    // Track unseen activity for completed tasks
    const { unseenProcessIds, markSeen: rawMarkSeen, markAllSeen: rawMarkAllSeen, markTasksSeen: rawMarkTasksSeen, markUnseen: rawMarkUnseen } = useUnseenActivity(workspaceId, history, selectedTaskId);
    const { markReadByProcessId } = useNotifications();

    // Wrap seen-state mutations to refresh badge counts after debounced API flush
    const scheduleUnseenRefresh = useCallback(() => {
        setTimeout(() => refreshUnseenCounts([workspaceId]), 300);
    }, [refreshUnseenCounts, workspaceId]);

    const markSeen = useCallback((processId: string) => {
        rawMarkSeen(processId);
        scheduleUnseenRefresh();
    }, [rawMarkSeen, scheduleUnseenRefresh]);

    const markAllSeen = useCallback(() => {
        rawMarkAllSeen();
        scheduleUnseenRefresh();
    }, [rawMarkAllSeen, scheduleUnseenRefresh]);

    const markTasksSeen = useCallback((tasks: any[]) => {
        rawMarkTasksSeen(tasks);
        scheduleUnseenRefresh();
    }, [rawMarkTasksSeen, scheduleUnseenRefresh]);

    const markUnseen = useCallback((processId: string) => {
        rawMarkUnseen(processId);
        scheduleUnseenRefresh();
    }, [rawMarkUnseen, scheduleUnseenRefresh]);
    // Activity-specific selectTask: chat tasks stay inline instead of navigating away
    const selectTask = useCallback((id: string, task?: any) => {
        if (task?.type === 'run-workflow') {
            const processId = task.processId || task.id;
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/workflow/' + encodeURIComponent(processId);
            return;
        }
        // Derive processId for seen-state, notifications, and URL
        const processId = isQueueProcessId(id) ? id : (task?.processId ?? toQueueProcessId(id));
        if (selectedTaskId === processId) {
            queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
            if (isMobile) setMobileShowDetail(true);
            return;
        }
        markSeen(processId);
        markReadByProcessId(processId);
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: processId, repoId: workspaceId });
        setSelectedTask(task || null);
        selectedTaskRef.current = task || null;
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/activity/' + encodeURIComponent(processId);
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, workspaceId, isMobile, selectedTaskId, markSeen, markReadByProcessId]);

    // Auto-dismiss notification when a deep-linked task is viewed via hash URL
    useEffect(() => {
        if (!selectedTaskId) return;
        markReadByProcessId(selectedTaskId);
    }, [selectedTaskId, markReadByProcessId]);

    // Scroll selected task card into view
    useEffect(() => {
        if (!selectedTaskId) return;
        const timer = setTimeout(() => {
            let el = document.querySelector(`[data-task-id="${CSS.escape(selectedTaskId)}"]`);
            // Fallback: selectedTaskId is processId but card has bare taskId
            if (!el && isQueueProcessId(selectedTaskId)) {
                el = document.querySelector(`[data-task-id="${CSS.escape(toTaskId(selectedTaskId))}"]`);
            }
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

    async function handlePauseResumeAutopilot() {
        setIsAutopilotPauseLoading(true);
        try {
            const endpoint = isAutopilotPaused
                ? '/queue/resume-autopilot'
                : '/queue/pause-autopilot';
            await fetchApi(endpoint + '?repoId=' + encodeURIComponent(workspaceId), { method: 'POST' });
            await fetchQueue();
        } finally {
            setIsAutopilotPauseLoading(false);
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
    }, [isRefreshing, fetchQueue]);

    if (loading) {
        return (
            <ChatPreferencesProvider workspaceId={workspaceId}>
                <div className="p-4 text-sm text-[#848484]">Loading queue...</div>
            </ChatPreferencesProvider>
        );
    }

    const listPane = (
        <ActivityListPane
            running={running}
            queued={queued}
            history={history}
            isPaused={isPaused}
            isPauseResumeLoading={isPauseResumeLoading}
            isRefreshing={isRefreshing}
            selectedTaskId={selectedTaskId}
            isMobile={isMobile}
            now={now}
            workspaceId={workspaceId}
            unseenProcessIds={unseenProcessIds}
            onMarkAllRead={markTasksSeen}
            onMarkRead={markSeen}
            onMarkUnread={markUnseen}
            onSelectTask={selectTask}
            onPauseResume={handlePauseResume}
            isAutopilotPaused={isAutopilotPaused}
            isAutopilotPauseLoading={isAutopilotPauseLoading}
            onPauseResumeAutopilot={handlePauseResumeAutopilot}
            onRefresh={handleRefresh}
            onOpenDialog={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId })}
            fetchQueue={fetchQueue}
            pauseReason={pauseReason}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
        />
    );

    if (isMobile) {
        return (
            <ChatPreferencesProvider workspaceId={workspaceId}>
                <div className="flex flex-col h-full overflow-hidden" data-testid="activity-split-panel">
                    {mobileShowDetail && selectedTaskId ? (
                        <div className="flex-1 flex flex-col overflow-hidden" data-testid="activity-detail-panel" data-pane="detail">
                            <ActivityDetailPane
                                selectedTaskId={selectedTaskId}
                                selectedTask={selectedTask}
                                onBack={() => setMobileShowDetail(false)}
                                workspaceId={workspaceId}
                            />
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col overflow-hidden" data-testid="activity-mobile-list">
                            {listPane}
                        </div>
                    )}
                </div>
            </ChatPreferencesProvider>
        );
    }

    return (
        <ChatPreferencesProvider workspaceId={workspaceId}>
            <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="activity-split-panel">
            {/* Left panel — task list */}
            <div
                className="flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden"
                style={{ width: leftPanelWidth }}
                data-testid="activity-list-panel"
            >
                {listPane}
            </div>

            {/* Resize handle */}
            <div
                className="flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                data-testid="activity-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize activity panel"
                tabIndex={0}
            />

            {/* Right panel — detail or placeholder */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col" data-testid="activity-detail-panel" data-pane="detail">
                <ActivityDetailPane
                    selectedTaskId={selectedTaskId}
                    selectedTask={selectedTask}
                    workspaceId={workspaceId}
                />
            </div>
        </div>
        </ChatPreferencesProvider>
    );
}
