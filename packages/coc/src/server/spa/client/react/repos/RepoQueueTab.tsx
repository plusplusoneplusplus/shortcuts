/**
 * RepoQueueTab — workspace-scoped queue with running/queued/history sections.
 * Split-panel layout: left = task list, right = task detail / placeholder.
 *
 * Delegates list rendering to the shared ActivityListPane so the Activity tab
 * can reuse the same queue-style left rail.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { QueueTaskDetail } from '../queue/QueueTaskDetail';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ActivityListPane } from './ActivityListPane';

interface RepoQueueTabProps {
    workspaceId: string;
}

export function RepoQueueTab({ workspaceId }: RepoQueueTabProps) {
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
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    // Live-update from per-repo WebSocket events via repoQueueMap
    const repoQueue = queueState.repoQueueMap[workspaceId];

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
    }, [workspaceId, queueDispatch]);

    // Initial HTTP fetch on mount (authoritative load)
    useEffect(() => {
        setLoading(true);
        fetchQueue();
    }, [workspaceId, fetchQueue]);

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
            // Always use task.id (bare ID); RepoChatTab reconstructs queue_<id> internally
            const sessionId = task.id;
            appDispatch({ type: 'SET_SELECTED_CHAT_SESSION', id: sessionId });
            appDispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chat' as any });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(sessionId);
            return;
        }
        if (task?.type === 'run-workflow') {
            const processId = task.processId || task.id;
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/workflow/' + encodeURIComponent(processId);
            return;
        }
        if (selectedTaskId === id) {
            queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
            return;
        }
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/queue/' + encodeURIComponent(id);
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, appDispatch, workspaceId, isMobile, selectedTaskId]);

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

    const taskListContent = (
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
            onSelectTask={selectTask}
            onPauseResume={handlePauseResume}
            onRefresh={handleRefresh}
            onOpenDialog={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId })}
            fetchQueue={fetchQueue}
        />
    );

    if (running.length === 0 && queued.length === 0 && history.length === 0) {
        return taskListContent;
    }

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
        </div>
    );
}
