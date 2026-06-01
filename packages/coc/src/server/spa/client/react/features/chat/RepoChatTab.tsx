/**
 * RepoChatTab — unified Activity tab combining a queue-style left rail
 * with conditional right-pane rendering for chat tasks versus other queue tasks.
 *
 * Top-level chat tasks are rendered inline via ChatDetail.
 * All task types are handled by the unified ChatDetail component.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { cn } from '../../ui';
import { getSpaCocClient } from '../../api/cocClient';
import { isContainerMode } from '../../utils/config';
import { useQueue } from '../../contexts/QueueContext';
import { useApp } from '../../contexts/AppContext';
import { useRepos } from '../../contexts/ReposContext';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { ChatListPane } from './ChatListPane';
import { ChatDetailPane } from './ChatDetailPane';
import { RalphWorkflowPaneContainer } from './RalphWorkflowPaneContainer';
import { useUnseenChat } from './hooks/useUnseenChat';
import { useChatPaneNavigation } from './hooks/useChatPaneNavigation';
import { ChatPreferencesProvider, ChatPrefsSync } from '../../contexts/ChatPreferencesContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useProcessSearch } from '../../processes/hooks/useProcessSearch';
import { adaptSearchResults } from '../../utils/search-adapter';
import type { ProcessHistoryItem } from '@plusplusoneplusplus/coc-client';
import { TaskDefs } from '../../../../../tasks/task-types';
import { isQueueProcessId, toQueueProcessId, toTaskId } from '../../utils/queue-process-id';
import { parseRalphSessionDeepLink } from '../../layout/Router';

export interface RepoChatTabProps {
    workspaceId: string;
    mode?: 'chats' | 'tasks';
}

type QueuePauseOptions = { durationHours?: 1 | 2 | 3 | 4 | 8; until?: number | string };

function isQueuePauseOptions(value: unknown): value is QueuePauseOptions {
    return !!value
        && typeof value === 'object'
        && ('durationHours' in value || 'until' in value);
}

function getActiveProcessIds(tasks: any[]): string[] {
    return tasks.map((task: any) => task.processId ?? toQueueProcessId(task.id));
}

export function RepoChatTab({ workspaceId, mode }: RepoChatTabProps) {
    const { state: queueState, dispatch: queueDispatch } = useQueue();

    // Seed from per-workspace caches so revisiting a repo renders the sidebar
    // instantly while the freshness fetch runs in the background.
    const cachedHistory = queueState.repoHistoryMap?.[workspaceId];
    const cachedQueue = queueState.repoQueueMap[workspaceId];

    const [running, setRunning] = useState<any[]>(cachedQueue?.running ?? []);
    const [queued, setQueued] = useState<any[]>(cachedQueue?.queued ?? []);
    const [history, setHistory] = useState<ProcessHistoryItem[]>(
        (cachedHistory?.items as ProcessHistoryItem[]) ?? [],
    );
    const [loading, setLoading] = useState(!cachedHistory && !cachedQueue);
    const [hasMore, setHasMore] = useState<boolean>(cachedHistory?.hasMore ?? false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [now, setNow] = useState(Date.now());
    const [isPaused, setIsPaused] = useState(false);
    const [pausedUntil, setPausedUntil] = useState<number | string | undefined>();
    const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
    const [isAutopilotPaused, setIsAutopilotPaused] = useState(false);
    const [autopilotPausedUntil, setAutopilotPausedUntil] = useState<number | string | undefined>();
    const [isAutopilotPauseLoading, setIsAutopilotPauseLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pauseReason, setPauseReason] = useState<{ taskId: string; displayName: string; failedAt: string } | undefined>();

    // Server-side search state
    const [searchQuery, setSearchQuery] = useState('');
    const {
        results: rawSearchResults,
        total: searchTotal,
        loading: searchLoading,
        hasMore: searchHasMore,
        loadMore: searchLoadMore,
        loadingMore: searchLoadingMore,
    } = useProcessSearch(searchQuery, { workspace: workspaceId, ...(mode === 'chats' ? { typeFilter: 'chat' } : {}) });
    const searchResults = useMemo(
        () => searchQuery.length >= 2 ? adaptSearchResults(rawSearchResults) : null,
        [rawSearchResults, searchQuery],
    );

    const handleSearchQueryChange = useCallback((query: string) => {
        setSearchQuery(query);
    }, []);

    const { state: appState, dispatch: appDispatch } = useApp();
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
    const listContainerRef = useRef<HTMLDivElement | null>(null);
    const detailContainerRef = useRef<HTMLDivElement | null>(null);
    // Ref to signal that mobileShowDetail=true was set intentionally for the new-chat flow,
    // so the selectedTaskId=null reset effect does not immediately clear it.
    const mobileNewChatRef = useRef(false);

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
        const data = await getSpaCocClient().workspaces.history(workspaceId, { limit: 100, offset }).catch(() => null);
        const items = (data?.history as ProcessHistoryItem[]) || [];
        const nextHasMore = data?.hasMore ?? false;
        if (offset === 0) {
            setHistory(items);
            queueDispatch({ type: 'REPO_HISTORY_UPDATED', repoId: workspaceId, items, hasMore: nextHasMore });
        } else {
            setHistory(prev => {
                const merged = [...prev, ...items];
                queueDispatch({ type: 'REPO_HISTORY_UPDATED', repoId: workspaceId, items: merged, hasMore: nextHasMore });
                return merged;
            });
        }
        setHasMore(nextHasMore);
    }, [workspaceId, queueDispatch]);

    const fetchQueueAndHistory = useCallback(async () => {
        // In container mode, skip fetch if agent hasn't been resolved yet —
        // the effect will re-fire once currentAgentId is set.
        if (isContainerMode() && !appState.currentAgentId) return;
        try {
            const [queueData, historyData] = await Promise.all([
                getSpaCocClient().queue.list({ repoId: workspaceId }).catch(() => null),
                getSpaCocClient().workspaces.history(workspaceId, { limit: 100, offset: 0 }).catch(() => null),
            ]);
            // Only update queue/pause state when the queue fetch actually succeeded —
            // a transient network error must not clear the running list out from under
            // the user (this was the "no tasks in queue" flash on rapid repo switches).
            if (queueData) {
                const nextRunning = queueData.running || [];
                const nextQueued = queueData.queued || [];
                const nextStats = queueData.stats || undefined;
                setRunning(nextRunning);
                setQueued(nextQueued);
                setIsPaused(!!nextStats?.isPaused);
                setPausedUntil(nextStats?.pausedUntil);
                setPauseReason(nextStats?.pauseReason);
                setIsAutopilotPaused(!!nextStats?.isAutopilotPaused);
                setAutopilotPausedUntil(nextStats?.autopilotPausedUntil);
                queueDispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: workspaceId,
                    queue: { queued: nextQueued, running: nextRunning, stats: nextStats },
                });
            }

            if (historyData) {
                const items = (historyData.history as ProcessHistoryItem[]) || [];
                const nextHasMore = historyData.hasMore ?? false;
                setHistory(items);
                setHasMore(nextHasMore);
                queueDispatch({
                    type: 'REPO_HISTORY_UPDATED',
                    repoId: workspaceId,
                    items,
                    hasMore: nextHasMore,
                });
            }
        } catch {
            // Both fetches already have inner `.catch(() => null)`; this outer catch is
            // defensive. Deliberately do NOT clear local lists — keep the cached view.
        }
        setLoading(false);
    }, [workspaceId, queueDispatch, appState.currentAgentId]);

    const fetchQueue = fetchQueueAndHistory;

    const handleLoadMore = useCallback(async () => {
        setLoadingMore(true);
        try {
            await fetchHistory(history.length);
        } finally {
            setLoadingMore(false);
        }
    }, [fetchHistory, history.length]);

    useEffect(() => {
        // Only show a loading spinner when we have nothing cached for this repo.
        // If a cache hit seeded `history`/`running`, fetch silently in the
        // background so the user never sees a flash of "loading…" on revisit.
        const hasCachedQueue = !!queueState.repoQueueMap[workspaceId];
        const hasCachedHistory = !!queueState.repoHistoryMap?.[workspaceId];
        if (!hasCachedQueue && !hasCachedHistory) {
            setLoading(true);
        }
        fetchQueue();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId, fetchQueue]);

    // Refresh queue when a Ralph session completes (fired by App.tsx WS handler)
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail?.repoId || detail.repoId === workspaceId) {
                fetchQueue();
            }
        };
        window.addEventListener('ralph-session-complete', handler);
        return () => window.removeEventListener('ralph-session-complete', handler);
    }, [workspaceId, fetchQueue]);

    // Track active (running + queued) process IDs to detect departures and arrivals
    const prevActiveIdsRef = useRef<string[]>([]);

    // Apply per-repo WS updates
    useEffect(() => {
        if (!repoQueue) return;
        setRunning(repoQueue.running);
        setQueued(repoQueue.queued);

        const activeProcessIds = [
            ...getActiveProcessIds(repoQueue.running),
            ...getActiveProcessIds(repoQueue.queued),
        ];
        const activeProcessIdSet = new Set(activeProcessIds);
        setHistory(prev => {
            const next = prev.filter((task: any) => !activeProcessIdSet.has(task.id));
            return next.length === prev.length ? prev : next;
        });

        // Detect task departures or arrivals and refetch history.
        // Departure: a previously-active process disappeared (task completed/failed).
        // Arrival: a process already in local history became active again (follow-up re-queue).
        const currIds = activeProcessIds;
        const prevIds = prevActiveIdsRef.current;
        const hasDeparture = prevIds.some(id => !activeProcessIdSet.has(id));
        const historyIds = new Set(history.map((t: any) => t.id));
        const hasArrivalFromHistory = currIds.some(id => !prevIds.includes(id) && historyIds.has(id));
        prevActiveIdsRef.current = currIds;

        if (hasDeparture || hasArrivalFromHistory) {
            fetchHistory();
        }

        if (repoQueue?.stats?.isPaused !== undefined) {
            setIsPaused(repoQueue.stats.isPaused);
            setPausedUntil(repoQueue.stats.pausedUntil);
            setPauseReason(repoQueue.stats.pauseReason);
        }
        if (repoQueue?.stats?.isAutopilotPaused !== undefined) {
            setIsAutopilotPaused(repoQueue.stats.isAutopilotPaused);
            setAutopilotPausedUntil(repoQueue.stats.autopilotPausedUntil);
        }
        setLoading(false);
    }, [repoQueue, history, fetchHistory]);

    // Merge title / customTitle / lastMessagePreview updates from process-updated
    // WS events into history items so the sidebar reflects renames and new turn
    // previews without a refetch.
    useEffect(() => {
        if (!history.length || !appState.processes.length) return;
        setHistory(prev => {
            let changed = false;
            const next = prev.map((item: any) => {
                const proc: any = appState.processes.find((p: any) => p.id === item.id);
                if (!proc) return item;
                const patch: any = {};
                if (proc.title !== undefined && proc.title !== item.title) patch.title = proc.title;
                if (proc.customTitle !== undefined && proc.customTitle !== item.customTitle) patch.customTitle = proc.customTitle;
                if (proc.lastMessagePreview !== undefined && proc.lastMessagePreview !== item.lastMessagePreview) patch.lastMessagePreview = proc.lastMessagePreview;
                if (Object.keys(patch).length === 0) return item;
                // Recompute displayName so downstream consumers stay consistent.
                if (patch.customTitle !== undefined || patch.title !== undefined) {
                    patch.displayName = patch.customTitle ?? item.customTitle ?? patch.title ?? item.title ?? item.displayName;
                }
                changed = true;
                return { ...item, ...patch };
            });
            return changed ? next : prev;
        });
    }, [appState.processes]); // eslint-disable-line react-hooks/exhaustive-deps

    // Clear selection if the selected task is no longer reachable.
    // Tasks from deep-links may not appear in the paginated history list,
    // so we verify via the API before clearing.
    useEffect(() => {
        if (!selectedTaskId || loading) return;
        const allTasks = [...running, ...queued, ...history];
        if (findBySelectedId(allTasks, selectedTaskId)) return;

        let cancelled = false;
        // selectedTaskId is always a processId; probe /processes/ first, fall back to /queue/
        const probeProcess = getSpaCocClient().processes.get(selectedTaskId)
            .then((data: any) => {
                if (cancelled) return;
                if (data?.process) return; // found
                // Not found as process — try queue with derived bare taskId
                const bareId = isQueueProcessId(selectedTaskId) ? toTaskId(selectedTaskId) : selectedTaskId;
                return getSpaCocClient().queue.getTask(bareId).then((qData: any) => {
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

    // Sync mobile detail view with selectedTaskId (handles deep links, back-button, page refresh)
    useEffect(() => {
        if (!selectedTaskId) {
            if (mobileNewChatRef.current) {
                mobileNewChatRef.current = false;
                return;
            }
            setMobileShowDetail(false);
        } else if (isMobile) {
            setMobileShowDetail(true);
        }
    }, [selectedTaskId, isMobile]);

    // Track unseen activity for completed tasks
    const { unseenProcessIds, markSeen: rawMarkSeen, markAllSeen: rawMarkAllSeen, markTasksSeen: rawMarkTasksSeen, markUnseen: rawMarkUnseen } = useUnseenChat(workspaceId, history, selectedTaskId);

    /**
     * Set of process IDs that currently have one or more pending ask-user questions
     * (i.e. the AI is waiting for user input). Derived from the global process index,
     * which is seeded from `/api/processes/summaries` on bootstrap and kept fresh by
     * `process-updated` WebSocket events. Falls back to `running` task entries that
     * carry a `pendingAskUserCount` from the /api/queue response so the indicator is
     * correct even if the process index has not arrived yet.
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
        if (task?.type === TaskDefs.runWorkflow.kind && !task?.payload?.workItemId && !task?.workItemId) {
            const processId = task.processId || task.id;
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/workflow/' + encodeURIComponent(processId);
            return;
        }
        // Derive processId for seen-state, notifications, and URL
        const processId = isQueueProcessId(id) ? id : (task?.processId ?? toQueueProcessId(id));
        if (selectedTaskId === processId) {
            markSeen(processId);
            markReadByProcessId(processId);
            queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
            if (isMobile) setMobileShowDetail(true);
            return;
        }
        markSeen(processId);
        markReadByProcessId(processId);
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: processId, repoId: workspaceId });
        setSelectedTask(task || null);
        selectedTaskRef.current = task || null;
        // Commit the mobile detail-pane state BEFORE updating location.hash.
        // The hash change triggers the Router's synchronous useLayoutEffect which
        // re-dispatches SELECT_QUEUE_TASK — if mobileShowDetail isn't already true
        // by then, an intermediate render shows the list with a "selected" highlight
        // instead of navigating to the detail pane (requiring a second tap).
        if (isMobile) setMobileShowDetail(true);
        // Use the canonical path segment matching `mode` so the Router doesn't
        // fire a legacy /activity/ → /chats/ redirect (location.replace), which
        // causes an extra hashchange + render cycle visible as a one-frame blink.
        const tabSegment = mode === 'tasks' ? 'tasks' : mode === 'chats' ? 'chats' : 'activity';
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/' + tabSegment + '/' + encodeURIComponent(processId);
    }, [queueDispatch, workspaceId, isMobile, selectedTaskId, markSeen, markReadByProcessId, mode]);

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
    const hasActive = useMemo(
        () => running.length > 0 || (isPaused && pausedUntil !== undefined) || (isAutopilotPaused && autopilotPausedUntil !== undefined),
        [autopilotPausedUntil, isAutopilotPaused, isPaused, pausedUntil, running],
    );
    useEffect(() => {
        if (!hasActive) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hasActive]);

    async function handlePauseResume(options?: QueuePauseOptions) {
        setIsPauseResumeLoading(true);
        try {
            if (isPaused) {
                await getSpaCocClient().queue.resume({ repoId: workspaceId });
            } else {
                await getSpaCocClient().queue.pause({ repoId: workspaceId }, isQueuePauseOptions(options) ? options : undefined);
            }
            await fetchQueue();
        } finally {
            setIsPauseResumeLoading(false);
        }
    }

    async function handlePauseResumeAutopilot(options?: QueuePauseOptions) {
        setIsAutopilotPauseLoading(true);
        try {
            if (isAutopilotPaused) {
                await getSpaCocClient().queue.resumeAutopilot({ repoId: workspaceId });
            } else {
                await getSpaCocClient().queue.pauseAutopilot({ repoId: workspaceId }, isQueuePauseOptions(options) ? options : undefined);
            }
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

    const [selectedRalphSessionId, setSelectedRalphSessionId] = useState<string | null>(null);

    // When a chat task is selected, drop any active Ralph session selection so
    // the right pane consistently reflects the user's most recent click.
    useEffect(() => {
        if (selectedTaskId && selectedRalphSessionId) {
            setSelectedRalphSessionId(null);
        }
    }, [selectedTaskId, selectedRalphSessionId]);

    const handleSelectRalphSession = useCallback((sessionId: string) => {
        // Selecting a Ralph session clears the chat-task selection.
        if (selectedTaskId) {
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
            setSelectedTask(null);
            selectedTaskRef.current = null;
        }
        setSelectedRalphSessionId(sessionId);
        // Write a refresh-survivable hash. `mode === 'tasks' ? 'tasks' : ...`
        // mirrors the convention in `selectTask` so layout mode round-trips.
        const tabSegment = mode === 'tasks' ? 'tasks' : mode === 'chats' ? 'chats' : 'activity';
        const next = '#repos/' + encodeURIComponent(workspaceId) + '/' + tabSegment + '/ralph/' + encodeURIComponent(sessionId);
        if (location.hash !== next) location.hash = next;
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, workspaceId, selectedTaskId, isMobile, mode]);

    // Restore Ralph session selection from the URL hash on mount and on
    // hashchange (browser back / forward / refresh).
    useEffect(() => {
        const apply = () => {
            const parsed = parseRalphSessionDeepLink(location.hash);
            if (parsed && parsed.workspaceId === workspaceId) {
                setSelectedRalphSessionId((prev) => (prev === parsed.sessionId ? prev : parsed.sessionId));
            } else {
                setSelectedRalphSessionId((prev) => (prev === null ? prev : null));
            }
        };
        apply();
        window.addEventListener('hashchange', apply);
        return () => window.removeEventListener('hashchange', apply);
    }, [workspaceId]);

    const handleSelectRalphIteration = useCallback((processId: string) => {
        // Switching to an iteration's chat detail clears the workflow pane.
        setSelectedRalphSessionId(null);
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: processId, repoId: workspaceId });
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, workspaceId, isMobile]);

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
                <div className="p-4 text-sm text-[#848484]">Loading queue...</div>
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
            workspaceId={workspaceId}
            unseenProcessIds={unseenProcessIds}
            awaitingInputProcessIds={awaitingInputProcessIds}
            onMarkAllRead={markTasksSeen}
            onMarkRead={markSeen}
            onMarkUnread={markUnseen}
            onSelectTask={selectTask}
            onPauseResume={handlePauseResume}
            pausedUntil={pausedUntil}
            isAutopilotPaused={isAutopilotPaused}
            autopilotPausedUntil={autopilotPausedUntil}
            isAutopilotPauseLoading={isAutopilotPauseLoading}
            onPauseResumeAutopilot={handlePauseResumeAutopilot}
            onRefresh={handleRefresh}
            onOpenDialog={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId })}
            fetchQueue={fetchQueue}
            pauseReason={pauseReason}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
            searchResults={searchResults}
            searchLoading={searchLoading}
            searchTotal={searchTotal}
            searchHasMore={searchHasMore}
            searchLoadingMore={searchLoadingMore}
            onSearchQueryChange={handleSearchQueryChange}
            onLoadMoreSearchResults={searchLoadMore}
            activeTab={mode}
            selectedRalphSessionId={selectedRalphSessionId}
            onSelectRalphSession={handleSelectRalphSession}
            cursorTaskId={cursorTaskId}
            onNewChat={() => {
                if (isMobile) {
                    mobileNewChatRef.current = true;
                    setMobileShowDetail(true);
                }
                queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
                setSelectedTask(null);
                selectedTaskRef.current = null;
                setSelectedRalphSessionId(null);
                const tabSegment = mode === 'tasks' ? 'tasks' : mode === 'chats' ? 'chats' : 'activity';
                location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/' + tabSegment;
                if (isMobile) setMobileShowDetail(true);
            }}
        />
    );

    if (isMobile) {
        return (
            <ChatPreferencesProvider workspaceId={workspaceId}>
                <ChatPrefsSync history={history} workspaceId={workspaceId} />
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden" data-testid="activity-split-panel">
                    {mobileShowDetail ? (
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
                            data-pane="detail"
                        >
                            {selectedRalphSessionId ? (
                                <RalphWorkflowPaneContainer
                                    workspaceId={workspaceId}
                                    sessionId={selectedRalphSessionId}
                                    onClose={() => {
                                        setSelectedRalphSessionId(null);
                                        setMobileShowDetail(false);
                                    }}
                                    onSelectIteration={handleSelectRalphIteration}
                                />
                            ) : (
                                <ChatDetailPane
                                    selectedTaskId={selectedTaskId}
                                    selectedTask={selectedTask}
                                    onBack={() => setMobileShowDetail(false)}
                                    workspaceId={workspaceId}
                                    readOnly={mode === 'tasks'}
                                />
                            )}
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
            <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="activity-split-panel">
            {/* Left panel — task list */}
            <div
                ref={listContainerRef}
                tabIndex={-1}
                role="region"
                aria-label="Chat list"
                data-pane-focus={focusedPane === 'list' ? 'true' : undefined}
                className={cn(
                    'flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden outline-none',
                    focusedPane === 'list' && 'ring-1 ring-inset ring-[#0078d4]/30',
                )}
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

            {/* Right panel — workflow pane (Ralph session selected) or chat detail */}
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
                data-pane="detail"
            >
                {selectedRalphSessionId ? (
                    <RalphWorkflowPaneContainer
                        workspaceId={workspaceId}
                        sessionId={selectedRalphSessionId}
                        onClose={() => setSelectedRalphSessionId(null)}
                        onSelectIteration={handleSelectRalphIteration}
                    />
                ) : (
                    <ChatDetailPane
                        selectedTaskId={selectedTaskId}
                        selectedTask={selectedTask}
                        workspaceId={workspaceId}
                        readOnly={mode === 'tasks'}
                    />
                )}
            </div>
        </div>
        </ChatPreferencesProvider>
    );
}
