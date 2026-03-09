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
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { ActivityListPane } from './ActivityListPane';
import { ActivityDetailPane } from './ActivityDetailPane';
import { useUnseenActivity } from '../hooks/useUnseenActivity';
import { usePinnedChats } from '../hooks/usePinnedChats';

export interface RepoActivityTabProps {
    workspaceId: string;
}

export function RepoActivityTab({ workspaceId }: RepoActivityTabProps) {
    const [running, setRunning] = useState<any[]>([]);
    const [queued, setQueued] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(Date.now());
    const [isPaused, setIsPaused] = useState(false);
    const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { dispatch: appDispatch } = useApp();
    const selectedTaskId = queueState.selectedTaskId;
    const { isMobile, isTablet } = useBreakpoint();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: isTablet ? 256 : 320,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'activity-left-panel-width',
    });
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    const repoQueue = queueState.repoQueueMap[workspaceId];

    // Track the selected task object for detail pane routing
    const [selectedTask, setSelectedTask] = useState<any>(null);
    const selectedTaskRef = useRef<any>(null);

    const fetchQueue = useCallback(async () => {
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

            queueDispatch({
                type: 'REPO_QUEUE_UPDATED',
                repoId: workspaceId,
                queue: { queued: nextQueued, running: nextRunning, history: nextHistory, stats: nextStats },
            });
        } catch {
            setRunning([]);
            setQueued([]);
            setHistory([]);
        }
        setLoading(false);
    }, [workspaceId, queueDispatch]);

    useEffect(() => {
        setLoading(true);
        fetchQueue();
    }, [workspaceId, fetchQueue]);

    // Apply per-repo WS updates
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

    // Clear selection if the selected task is no longer reachable.
    // Tasks from deep-links may not appear in the paginated history list,
    // so we verify via the API before clearing.
    useEffect(() => {
        if (!selectedTaskId || loading) return;
        const allTasks = [...running, ...queued, ...history];
        if (allTasks.find(t => t.id === selectedTaskId)) return;

        let cancelled = false;
        fetchApi(`/queue/${encodeURIComponent(selectedTaskId)}`)
            .then((data: any) => {
                if (cancelled) return;
                if (!data?.task) throw new Error('not found');
            })
            .catch(() => {
                if (cancelled) return;
                queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
                setSelectedTask(null);
                selectedTaskRef.current = null;
                const activityBase = '#repos/' + encodeURIComponent(workspaceId) + '/activity';
                if (location.hash.startsWith(activityBase + '/')) {
                    location.hash = activityBase;
                }
            });
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
        const found = allTasks.find(t => t.id === selectedTaskId) || null;
        setSelectedTask(found);
        selectedTaskRef.current = found;
    }, [selectedTaskId, running, queued, history]);

    // Reset mobile detail view when selection is cleared
    useEffect(() => {
        if (!selectedTaskId) setMobileShowDetail(false);
    }, [selectedTaskId]);

    // Track unseen activity for completed tasks
    const { unseenTaskIds, markSeen, markAllSeen, markTasksSeen, markUnseen } = useUnseenActivity(workspaceId, history, selectedTaskId);
    // Track pinned chats (persisted server-side)
    const { pinnedChatIds, pinChat, unpinChat } = usePinnedChats(workspaceId);

    // Activity-specific selectTask: chat tasks stay inline instead of navigating away
    const selectTask = useCallback((id: string, task?: any) => {
        if (task?.type === 'run-workflow') {
            const processId = task.processId || task.id;
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/workflow/' + encodeURIComponent(processId);
            return;
        }
        if (selectedTaskId === id) {
            queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
            return;
        }
        markSeen(id);
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id });
        setSelectedTask(task || null);
        selectedTaskRef.current = task || null;
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/activity/' + encodeURIComponent(id);
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, workspaceId, isMobile, selectedTaskId, markSeen]);

    // Scroll selected task card into view
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
    }, [isRefreshing, fetchQueue]);

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading queue...</div>;
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
            unseenTaskIds={unseenTaskIds}
            onMarkAllRead={markTasksSeen}
            onMarkRead={markSeen}
            onMarkUnread={markUnseen}
            pinnedChatIds={pinnedChatIds}
            onPinChat={pinChat}
            onUnpinChat={unpinChat}
            onSelectTask={selectTask}
            onPauseResume={handlePauseResume}
            onRefresh={handleRefresh}
            onOpenDialog={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId })}
            fetchQueue={fetchQueue}
        />
    );

    if (isMobile) {
        return (
            <div className="flex flex-col h-full overflow-hidden" data-testid="activity-split-panel">
                {mobileShowDetail && selectedTaskId ? (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="activity-detail-panel">
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
        );
    }

    return (
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
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col" data-testid="activity-detail-panel">
                <ActivityDetailPane
                    selectedTaskId={selectedTaskId}
                    selectedTask={selectedTask}
                    workspaceId={workspaceId}
                />
            </div>
        </div>
    );
}
