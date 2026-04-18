/**
 * ProcessesView — global queue activity view for the Processes tab.
 *
 * Uses the same ActivityListPane + ActivityDetailPane UI as the per-repo
 * Activity tab. Fetches the global queue (no repoId param) which the server
 * scopes to the global workspace queue directly — no client-side filtering needed.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { toQueueProcessId } from '../utils/queue-process-id';
import { ActivityListPane } from '../repos/ActivityListPane';
import { ActivityDetailPane } from '../repos/ActivityDetailPane';
import { ChatPreferencesProvider, ChatPrefsSync } from '../context/ChatPreferencesContext';
import { ProcessesViewSkeleton } from './QueueTaskSkeleton';

export function ProcessesView() {
    const [running, setRunning] = useState<any[]>([]);
    const [queued, setQueued] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(Date.now());
    const [isPaused, setIsPaused] = useState(false);
    const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Minimum skeleton display time so the loading state is always perceptible.
    const SKELETON_MIN_MS = 300;
    const loadingStartRef = useRef(Date.now());
    const endLoading = useCallback(() => {
        const elapsed = Date.now() - loadingStartRef.current;
        const remaining = SKELETON_MIN_MS - elapsed;
        if (remaining > 0) {
            setTimeout(() => setLoading(false), remaining);
        } else {
            setLoading(false);
        }
    }, []);

    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: appState } = useApp();
    const workspaceId = appState.selectedRepoId ?? '';
    const selectedTaskId = queueState.selectedTaskId;
    const { isMobile, isTablet } = useBreakpoint();
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    const [selectedTask, setSelectedTask] = useState<any>(null);
    const selectedTaskRef = useRef<any>(null);

    const fetchQueue = useCallback(async () => {
        try {
            const data = await fetchApi('/queue');
            const nextRunning = data?.running || [];
            const nextQueued = data?.queued || [];
            const nextStats = data?.stats || undefined;
            setRunning(nextRunning);
            setQueued(nextQueued);
            setIsPaused(!!nextStats?.isPaused);
            const historyData = await fetchApi('/queue/history').catch(() => null);
            const nextHistory = historyData?.history || [];
            setHistory(nextHistory);

            // Sync global queue context
            queueDispatch({
                type: 'QUEUE_UPDATED',
                queue: { queued: nextQueued, running: nextRunning, history: nextHistory, stats: nextStats },
            });
        } catch {
            setRunning([]);
            setQueued([]);
            setHistory([]);
        }
        endLoading();
    }, [queueDispatch, endLoading]);

    useEffect(() => {
        setLoading(true);
        loadingStartRef.current = Date.now();
        fetchQueue();
    }, [fetchQueue]);

    // Apply global WS updates — scoped to global workspace queue by the server
    useEffect(() => {
        if (!queueState.queueInitialized) return;
        setRunning(queueState.running);
        setQueued(queueState.queued);
        setHistory(queueState.history);
        if (queueState.stats?.isPaused !== undefined) {
            setIsPaused(queueState.stats.isPaused);
        }
        endLoading();
    }, [queueState.running, queueState.queued, queueState.history, queueState.stats, queueState.queueInitialized, endLoading]);

    // Clear selection if the selected task is no longer reachable
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
                if (location.hash.startsWith('#process/') || location.hash.startsWith('#processes/')) {
                    location.hash = '#processes';
                }
            });
        return () => { cancelled = true; };
    }, [selectedTaskId, running, queued, history, loading, queueDispatch]);

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

    // Sync mobile detail view with selectedTaskId (handles deep links)
    useEffect(() => {
        if (!selectedTaskId) setMobileShowDetail(false);
        else if (isMobile) setMobileShowDetail(true);
    }, [selectedTaskId, isMobile]);

    const selectTask = useCallback((id: string, task?: any) => {
        if (task?.type === 'run-workflow' && !task?.payload?.workItemId) {
            const repoId = task.repoId || task.workingDirectory || task.payload?.workingDirectory;
            if (repoId) {
                const processId = task.processId || task.id;
                location.hash = '#repos/' + encodeURIComponent(repoId) + '/workflow/' + encodeURIComponent(processId);
                return;
            }
        }
        if (selectedTaskId === id) {
            queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
            if (isMobile) setMobileShowDetail(true);
            return;
        }
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id });
        setSelectedTask(task || null);
        selectedTaskRef.current = task || null;
        location.hash = '#process/' + encodeURIComponent(toQueueProcessId(id));
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, isMobile, selectedTaskId]);

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
            await fetchApi(endpoint, { method: 'POST' });
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

    const heightClass = isMobile
        ? 'h-[calc(100vh-48px-48px)]'
        : 'h-[calc(100vh-48px)]';

    if (loading) {
        return (
            <ChatPreferencesProvider workspaceId={workspaceId}>
                <ChatPrefsSync history={history} workspaceId={workspaceId} />
                <ProcessesViewSkeleton heightClass={heightClass} />
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
            onSelectTask={selectTask}
            onPauseResume={handlePauseResume}
            onRefresh={handleRefresh}
            onOpenDialog={() => queueDispatch({ type: 'OPEN_DIALOG' })}
            fetchQueue={fetchQueue}
        />
    );

    if (isMobile) {
        return (
            <ChatPreferencesProvider workspaceId={workspaceId}>
                <ChatPrefsSync history={history} workspaceId={workspaceId} />
                <div id="view-processes" className={`flex flex-col ${heightClass} overflow-hidden`} data-testid="activity-split-panel">
                    {mobileShowDetail && selectedTaskId ? (
                        <div className="flex-1 flex flex-col overflow-hidden" data-testid="activity-detail-panel">
                            <ActivityDetailPane
                                selectedTaskId={selectedTaskId}
                                selectedTask={selectedTask}
                                onBack={() => setMobileShowDetail(false)}
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
            <ChatPrefsSync history={history} workspaceId={workspaceId} />
            <div id="view-processes" className={`flex ${heightClass} overflow-hidden`} data-testid="activity-split-panel">
                {/* Left panel — task list */}
                <div className={cn(
                    'flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden',
                    isTablet ? 'w-64' : 'w-80',
                )}>
                    {listPane}
                </div>

                {/* Right panel — detail or placeholder */}
                <div className="flex-1 min-w-0 overflow-hidden flex flex-col" data-testid="activity-detail-panel">
                    <ActivityDetailPane
                        selectedTaskId={selectedTaskId}
                        selectedTask={selectedTask}
                    />
                </div>
            </div>
        </ChatPreferencesProvider>
    );
}
