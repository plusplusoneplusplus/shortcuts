/**
 * ProcessesView — global queue activity view for the Processes tab.
 *
 * Uses the same ChatListPane + ChatDetailPane UI as the per-repo
 * Activity tab. Fetches the global queue (no repoId param) which the server
 * scopes to the global workspace queue directly — no client-side filtering needed.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '../ui';
import { getSpaCocClient } from '../api/cocClient';
import { useQueue } from '../contexts/QueueContext';
import { useApp } from '../contexts/AppContext';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { toQueueProcessId } from '../utils/queue-process-id';
import { ChatListPane } from '../features/chat/ChatListPane';
import { ChatDetailPane } from '../features/chat/ChatDetailPane';
import { useChatPaneNavigation } from '../features/chat/hooks/useChatPaneNavigation';
import { ChatPreferencesProvider, ChatPrefsSync } from '../contexts/ChatPreferencesContext';
import { ProcessesViewSkeleton } from './QueueTaskSkeleton';
import { TaskDefs } from '../../../../tasks/task-types';

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
    const listContainerRef = useRef<HTMLDivElement | null>(null);
    const detailContainerRef = useRef<HTMLDivElement | null>(null);

    const [selectedTask, setSelectedTask] = useState<any>(null);
    const selectedTaskRef = useRef<any>(null);

    const fetchQueue = useCallback(async () => {
        try {
            const data = await getSpaCocClient().queue.list();
            const nextRunning = data?.running || [];
            const nextQueued = data?.queued || [];
            const nextStats = data?.stats || undefined;
            setRunning(nextRunning);
            setQueued(nextQueued);
            setIsPaused(!!nextStats?.isPaused);
            const historyData = await getSpaCocClient().queue.history().catch(() => null);
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
        getSpaCocClient().queue.getTask(selectedTaskId)
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
        if (task?.type === TaskDefs.runWorkflow.kind && !task?.payload?.workItemId) {
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
            if (isPaused) {
                await getSpaCocClient().queue.resume();
            } else {
                await getSpaCocClient().queue.pause();
            }
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

    /**
     * Set of process / task IDs whose AI is currently awaiting interactive user
     * input. Derived from the global process index (kept fresh by `process-updated`
     * WebSocket events) plus any `pendingAskUserCount` carried on the running task
     * snapshot so the indicator appears immediately after the initial /api/queue
     * fetch.
     */
    const awaitingInputProcessIds = useMemo(() => {
        const ids = new Set<string>();
        const procs = Array.isArray(appState.processes) ? appState.processes : [];
        for (const proc of procs) {
            if (proc && typeof proc.pendingAskUserCount === 'number' && proc.pendingAskUserCount > 0) {
                ids.add(proc.id);
            }
        }
        for (const task of running) {
            const count = typeof task?.pendingAskUserCount === 'number' ? task.pendingAskUserCount : 0;
            if (count > 0) {
                if (task.processId) ids.add(task.processId);
                if (task.id) ids.add(task.id);
            }
        }
        return ids;
    }, [appState.processes, running]);

    const heightClass = isMobile
        ? 'h-[calc(100vh-48px-48px)]'
        : 'h-[calc(100vh-48px)]';

    const { focusedPane, cursorTaskId } = useChatPaneNavigation({
        listContainerRef,
        detailContainerRef,
        selectedTaskId,
        onSelectTask: (id) => selectTask(id),
        enabled: true,
        isMobile,
        mobileShowDetail,
        onEnterDetail: () => setMobileShowDetail(true),
        onEnterList: () => setMobileShowDetail(false),
    });

    if (loading) {
        return (
            <ChatPreferencesProvider workspaceId={workspaceId}>
                <ChatPrefsSync history={history} workspaceId={workspaceId} />
                <ProcessesViewSkeleton heightClass={heightClass} />
            </ChatPreferencesProvider>
        );
    }

    const listPane = (
        <ChatListPane
            running={running}
            queued={queued}
            history={history}
            isPaused={isPaused}
            isPauseResumeLoading={isPauseResumeLoading}
            isRefreshing={isRefreshing}
            selectedTaskId={selectedTaskId}
            isMobile={isMobile}
            now={now}
            workspaceId={workspaceId || undefined}
            awaitingInputProcessIds={awaitingInputProcessIds}
            onSelectTask={selectTask}
            cursorTaskId={cursorTaskId}
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
                        <div
                            ref={detailContainerRef}
                            tabIndex={-1}
                            role="region"
                            aria-label="Chat detail"
                            data-pane-focus={focusedPane === 'detail' ? 'true' : undefined}
                            className={cn(
                                'flex-1 flex flex-col overflow-hidden outline-none',
                                focusedPane === 'detail' && 'ring-1 ring-[#0078d4]/30',
                            )}
                            data-testid="activity-detail-panel"
                        >
                            <ChatDetailPane
                                selectedTaskId={selectedTaskId}
                                selectedTask={selectedTask}
                                workspaceId={workspaceId || undefined}
                                onBack={() => setMobileShowDetail(false)}
                            />
                        </div>
                    ) : (
                        <div
                            ref={listContainerRef}
                            tabIndex={-1}
                            role="region"
                            aria-label="Chat list"
                            data-pane-focus={focusedPane === 'list' ? 'true' : undefined}
                            className={cn(
                                'flex-1 flex flex-col overflow-hidden outline-none',
                                focusedPane === 'list' && 'ring-1 ring-[#0078d4]/30',
                            )}
                            data-testid="activity-mobile-list"
                        >
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
                <div
                    ref={listContainerRef}
                    tabIndex={-1}
                    role="region"
                    aria-label="Chat list"
                    data-pane-focus={focusedPane === 'list' ? 'true' : undefined}
                    className={cn(
                        'flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden outline-none',
                        isTablet ? 'w-64' : 'w-80',
                        focusedPane === 'list' && 'ring-1 ring-inset ring-[#0078d4]/30',
                    )}
                >
                    {listPane}
                </div>

                {/* Right panel — detail or placeholder */}
                <div
                    ref={detailContainerRef}
                    tabIndex={-1}
                    role="region"
                    aria-label="Chat detail"
                    data-pane-focus={focusedPane === 'detail' ? 'true' : undefined}
                    className={cn(
                        'flex-1 min-w-0 overflow-hidden flex flex-col outline-none',
                        focusedPane === 'detail' && 'ring-1 ring-inset ring-[#0078d4]/30',
                    )}
                    data-testid="activity-detail-panel"
                >
                    <ChatDetailPane
                        selectedTaskId={selectedTaskId}
                        selectedTask={selectedTask}
                        workspaceId={workspaceId || undefined}
                    />
                </div>
            </div>
        </ChatPreferencesProvider>
    );
}
