/**
 * RepoChatTab — unified Activity tab combining a queue-style left rail
 * with conditional right-pane rendering for chat tasks versus other queue tasks.
 *
 * Top-level chat tasks are rendered inline via ChatDetail.
 * All task types are handled by the unified ChatDetail component.
 */

import { useState, useEffect, useMemo, useCallback, useRef, cloneElement } from 'react';
import { cn } from '../../ui';
import { useCocClient } from '../../repos/cloneRouting';
import { isContainerMode, isForEachEnabled, isMapReduceEnabled } from '../../utils/config';
import { useQueue } from '../../contexts/QueueContext';
import { useApp } from '../../contexts/AppContext';
import { useRepos } from '../../contexts/ReposContext';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { ChatListPane } from './ChatListPane';
import { ChatDetailPane } from './ChatDetailPane';
import { RalphWorkflowPaneContainer } from './RalphWorkflowPaneContainer';
import { ForEachRunPane } from './ForEachRunPane';
import { MapReduceRunPane } from './MapReduceRunPane';
import { useUnseenChat } from './hooks/useUnseenChat';
import { useChatPaneNavigation } from './hooks/useChatPaneNavigation';
import { useHoverPeek } from './hooks/useHoverPeek';
import { ChatPreferencesProvider, ChatPrefsSync } from '../../contexts/ChatPreferencesContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useProcessSearch } from '../../processes/hooks/useProcessSearch';
import { adaptSearchResults } from '../../utils/search-adapter';
import type { ForEachRunSummary, MapReduceRunSummary, ProcessGroupPin, ProcessGroupPinType, ProcessHistoryItem } from '@plusplusoneplusplus/coc-client';
import { TaskDefs } from '../../../../../tasks/task-types';
import { isQueueProcessId, toQueueProcessId, toTaskId } from '../../utils/queue-process-id';
import { parseForEachRunDeepLink, parseMapReduceRunDeepLink, parseRalphSessionDeepLink } from '../../layout/Router';

export interface RepoChatTabProps {
    workspaceId: string;
    mode?: 'chats' | 'tasks';
}

function getActivityTabSegment(mode: RepoChatTabProps['mode']): 'activity' | 'chats' | 'tasks' {
    return mode === 'tasks' ? 'tasks' : mode === 'chats' ? 'chats' : 'activity';
}

function buildRalphSessionHash(
    workspaceId: string,
    mode: RepoChatTabProps['mode'],
    sessionId: string,
    fileName?: string,
): string {
    const base = '#repos/' + encodeURIComponent(workspaceId)
        + '/' + getActivityTabSegment(mode)
        + '/ralph/' + encodeURIComponent(sessionId);
    return fileName ? base + '/' + encodeURIComponent(fileName) : base;
}

function buildForEachRunHash(
    workspaceId: string,
    mode: RepoChatTabProps['mode'],
    runId: string,
): string {
    return '#repos/' + encodeURIComponent(workspaceId)
        + '/' + getActivityTabSegment(mode)
        + '/for-each/' + encodeURIComponent(runId);
}

function buildMapReduceRunHash(
    workspaceId: string,
    mode: RepoChatTabProps['mode'],
    runId: string,
): string {
    return '#repos/' + encodeURIComponent(workspaceId)
        + '/' + getActivityTabSegment(mode)
        + '/map-reduce/' + encodeURIComponent(runId);
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

/**
 * True on pointer/desktop devices (mouse/trackpad with hover). Gates the
 * hover-to-float peek so touch devices keep the existing drawer behavior.
 * Defaults to true when matchMedia is unavailable (SSR / jsdom).
 */
function hasFinePointerDevice(): boolean {
    try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
        return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
        return true;
    }
}

export function RepoChatTab({ workspaceId, mode }: RepoChatTabProps) {
    const { state: queueState, dispatch: queueDispatch } = useQueue();

    // Per-clone client (AC-07): the Activity tab's conversation LIST + queue +
    // group-pins + forEach/mapReduce + pause/resume all load from THIS clone's
    // server. A local clone resolves to the default origin (unchanged).
    const cloneClient = useCocClient(workspaceId);

    // Seed from per-workspace caches so revisiting a repo renders the sidebar
    // instantly while the freshness fetch runs in the background.
    const cachedHistory = queueState.repoHistoryMap?.[workspaceId];
    const cachedQueue = queueState.repoQueueMap[workspaceId];

    const [running, setRunning] = useState<any[]>(cachedQueue?.running ?? []);
    const [queued, setQueued] = useState<any[]>(cachedQueue?.queued ?? []);
    const [history, setHistory] = useState<ProcessHistoryItem[]>(
        (cachedHistory?.items as ProcessHistoryItem[]) ?? [],
    );
    const [forEachRuns, setForEachRuns] = useState<ForEachRunSummary[]>([]);
    const [mapReduceRuns, setMapReduceRuns] = useState<MapReduceRunSummary[]>([]);
    const [groupPins, setGroupPins] = useState<ProcessGroupPin[]>([]);
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
    const [listCollapsed, setListCollapsed] = useState<boolean>(() => {
        try { return localStorage.getItem('activity-list-collapsed') === 'true'; } catch { return false; }
    });
    const toggleListCollapsed = useCallback((collapsed: boolean) => {
        setListCollapsed(collapsed);
        try { localStorage.setItem('activity-list-collapsed', collapsed ? 'true' : 'false'); } catch { /* ignore */ }
    }, []);
    const listContainerRef = useRef<HTMLDivElement | null>(null);
    const detailContainerRef = useRef<HTMLDivElement | null>(null);
    const peekPanelRef = useRef<HTMLDivElement | null>(null);
    // Hover-to-float peek: only on pointer/desktop devices while the list is
    // collapsed. This is a temporary overlay layer — it never persists state.
    const [hasFinePointer] = useState(hasFinePointerDevice);
    const hoverPeek = useHoverPeek({
        enabled: !isMobile && listCollapsed && hasFinePointer,
        panelRef: peekPanelRef,
    });
    // Drive a one-shot slide-in once the peek mounts (matches the ~200ms drawer timing).
    const [peekVisible, setPeekVisible] = useState(false);
    useEffect(() => {
        if (!hoverPeek.isOpen) {
            setPeekVisible(false);
            return;
        }
        const raf = requestAnimationFrame(() => setPeekVisible(true));
        return () => cancelAnimationFrame(raf);
    }, [hoverPeek.isOpen]);
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
        const data = await cloneClient.workspaces.history(workspaceId, { limit: 100, offset }).catch(() => null);
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
    }, [workspaceId, queueDispatch, cloneClient]);

    const fetchQueueAndHistory = useCallback(async () => {
        // In container mode, skip fetch if agent hasn't been resolved yet —
        // the effect will re-fire once currentAgentId is set.
        if (isContainerMode() && !appState.currentAgentId) return;
        try {
            const client = cloneClient;
            const groupPinsRequest = typeof client.processes.listGroupPins === 'function'
                ? client.processes.listGroupPins(workspaceId).catch(() => null)
                : Promise.resolve(null);
            const [queueData, historyData, forEachData, mapReduceData, groupPinsData] = await Promise.all([
                client.queue.list({ repoId: workspaceId }).catch(() => null),
                client.workspaces.history(workspaceId, { limit: 100, offset: 0 }).catch(() => null),
                isForEachEnabled() ? client.forEach.list(workspaceId).catch(() => null) : Promise.resolve(null),
                isMapReduceEnabled() ? client.mapReduce.list(workspaceId).catch(() => null) : Promise.resolve(null),
                groupPinsRequest,
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

            if (isForEachEnabled()) {
                setForEachRuns(Array.isArray(forEachData) ? forEachData : []);
            } else {
                setForEachRuns([]);
            }
            if (isMapReduceEnabled()) {
                setMapReduceRuns(Array.isArray(mapReduceData) ? mapReduceData : []);
            } else {
                setMapReduceRuns([]);
            }
            if (groupPinsData) {
                setGroupPins(Array.isArray(groupPinsData.pins) ? groupPinsData.pins : []);
            }
        } catch {
            // Both fetches already have inner `.catch(() => null)`; this outer catch is
            // defensive. Deliberately do NOT clear local lists — keep the cached view.
        }
        setLoading(false);
    }, [workspaceId, queueDispatch, appState.currentAgentId, cloneClient]);

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
        setGroupPins([]);
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
        const probeProcess = cloneClient.processes.get(selectedTaskId)
            .then((data: any) => {
                if (cancelled) return;
                if (data?.process) return; // found
                // Not found as process — try queue with derived bare taskId
                const bareId = isQueueProcessId(selectedTaskId) ? toTaskId(selectedTaskId) : selectedTaskId;
                return cloneClient.queue.getTask(bareId).then((qData: any) => {
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
    }, [selectedTaskId, running, queued, history, loading, queueDispatch, workspaceId, cloneClient]);

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

    // Selecting a conversation from the floating peek opens it in the main pane
    // and collapses the list back to the rail — without persisting (AC-05).
    const handlePeekSelectTask = useCallback((id: string, task?: any) => {
        selectTask(id, task);
        hoverPeek.close();
    }, [selectTask, hoverPeek]);

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
                await cloneClient.queue.resume({ repoId: workspaceId });
            } else {
                await cloneClient.queue.pause({ repoId: workspaceId }, isQueuePauseOptions(options) ? options : undefined);
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
                await cloneClient.queue.resumeAutopilot({ repoId: workspaceId });
            } else {
                await cloneClient.queue.pauseAutopilot({ repoId: workspaceId }, isQueuePauseOptions(options) ? options : undefined);
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

    const handleSetGroupPin = useCallback(async (type: ProcessGroupPinType, groupId: string, pinned: boolean) => {
        const previousPins = groupPins;
        const nextPinnedAt = new Date().toISOString();
        setGroupPins(prev => {
            const remaining = prev.filter(pin => !(pin.type === type && pin.groupId === groupId));
            return pinned ? [{ type, groupId, pinnedAt: nextPinnedAt }, ...remaining] : remaining;
        });
        try {
            const result = await cloneClient.processes.pinGroup(workspaceId, type, groupId, pinned);
            setGroupPins(prev => {
                const remaining = prev.filter(pin => !(pin.type === type && pin.groupId === groupId));
                return result.pin ? [result.pin, ...remaining] : remaining;
            });
        } catch {
            setGroupPins(previousPins);
        }
    }, [groupPins, workspaceId, cloneClient]);

    const [selectedRalphSessionId, setSelectedRalphSessionId] = useState<string | null>(null);
    const [selectedRalphFileName, setSelectedRalphFileName] = useState<string | null>(null);
    const [selectedForEachRunId, setSelectedForEachRunId] = useState<string | null>(null);
    const [selectedMapReduceRunId, setSelectedMapReduceRunId] = useState<string | null>(null);

    // When a chat task is selected, drop any active parent-run selection so
    // the right pane consistently reflects the user's most recent click.
    useEffect(() => {
        if (selectedTaskId) {
            if (selectedRalphSessionId) {
                setSelectedRalphSessionId(null);
                setSelectedRalphFileName(null);
            }
            if (selectedForEachRunId) {
                setSelectedForEachRunId(null);
            }
            if (selectedMapReduceRunId) {
                setSelectedMapReduceRunId(null);
            }
        }
    }, [selectedTaskId, selectedRalphSessionId, selectedForEachRunId, selectedMapReduceRunId]);

    const handleSelectRalphSession = useCallback((sessionId: string) => {
        // Selecting a Ralph session clears the chat-task selection.
        if (selectedTaskId) {
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
            setSelectedTask(null);
            selectedTaskRef.current = null;
        }
        setSelectedRalphSessionId(sessionId);
        setSelectedRalphFileName(null);
        setSelectedForEachRunId(null);
        setSelectedMapReduceRunId(null);
        // Write a refresh-survivable hash. `mode === 'tasks' ? 'tasks' : ...`
        // mirrors the convention in `selectTask` so layout mode round-trips.
        const next = buildRalphSessionHash(workspaceId, mode, sessionId);
        if (location.hash !== next) location.hash = next;
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, workspaceId, selectedTaskId, isMobile, mode]);

    const handleSelectRalphFile = useCallback((fileName: string) => {
        if (!selectedRalphSessionId) return;
        setSelectedRalphFileName(fileName);
        const next = buildRalphSessionHash(workspaceId, mode, selectedRalphSessionId, fileName);
        if (location.hash !== next) location.hash = next;
    }, [workspaceId, mode, selectedRalphSessionId]);

    // Restore Ralph session selection from the URL hash on mount and on
    // hashchange (browser back / forward / refresh).
    useEffect(() => {
        const apply = () => {
            const parsed = parseRalphSessionDeepLink(location.hash);
            if (parsed && parsed.workspaceId === workspaceId) {
                setSelectedRalphSessionId((prev) => (prev === parsed.sessionId ? prev : parsed.sessionId));
                setSelectedRalphFileName((prev) => {
                    const next = parsed.fileName ?? null;
                    return prev === next ? prev : next;
                });
            } else {
                setSelectedRalphSessionId((prev) => (prev === null ? prev : null));
                setSelectedRalphFileName((prev) => (prev === null ? prev : null));
            }
        };
        apply();
        window.addEventListener('hashchange', apply);
        return () => window.removeEventListener('hashchange', apply);
    }, [workspaceId]);

    useEffect(() => {
        const apply = () => {
            const parsed = parseForEachRunDeepLink(location.hash);
            if (parsed && parsed.workspaceId === workspaceId && isForEachEnabled()) {
                if (selectedTaskId) {
                    queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
                }
                setSelectedTask(null);
                selectedTaskRef.current = null;
                setSelectedRalphSessionId((prev) => (prev === null ? prev : null));
                setSelectedRalphFileName((prev) => (prev === null ? prev : null));
                setSelectedForEachRunId((prev) => (prev === parsed.runId ? prev : parsed.runId));
                setSelectedMapReduceRunId((prev) => (prev === null ? prev : null));
                if (isMobile) setMobileShowDetail(true);
            } else {
                setSelectedForEachRunId((prev) => (prev === null ? prev : null));
            }
        };
        apply();
        window.addEventListener('hashchange', apply);
        return () => window.removeEventListener('hashchange', apply);
    }, [workspaceId, selectedTaskId, queueDispatch, isMobile]);

    const handleSelectRalphIteration = useCallback((processId: string) => {
        // Switching to an iteration's chat detail clears the workflow pane.
        setSelectedRalphSessionId(null);
        setSelectedRalphFileName(null);
        setSelectedForEachRunId(null);
        setSelectedMapReduceRunId(null);
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: processId, repoId: workspaceId });
        if (isMobile) setMobileShowDetail(true);
    }, [queueDispatch, workspaceId, isMobile]);

    const handleSelectForEachChildProcess = useCallback((processId: string) => {
        setSelectedForEachRunId(null);
        selectTask(processId);
    }, [selectTask]);

    const handleSelectForEachGenerationProcess = useCallback((processId: string) => {
        setSelectedForEachRunId(null);
        selectTask(processId);
    }, [selectTask]);

    const handleSelectMapReduceChildProcess = useCallback((processId: string) => {
        setSelectedMapReduceRunId(null);
        selectTask(processId);
    }, [selectTask]);

    const handleSelectMapReduceGenerationProcess = useCallback((processId: string) => {
        setSelectedMapReduceRunId(null);
        selectTask(processId);
    }, [selectTask]);

    const handleOpenForEachRun = useCallback((runId: string) => {
        if (!isForEachEnabled()) return;
        if (selectedTaskId) {
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
            setSelectedTask(null);
            selectedTaskRef.current = null;
        }
        setSelectedRalphSessionId(null);
        setSelectedRalphFileName(null);
        setSelectedForEachRunId(runId);
        setSelectedMapReduceRunId(null);
        const next = buildForEachRunHash(workspaceId, mode, runId);
        if (location.hash !== next) location.hash = next;
        if (isMobile) setMobileShowDetail(true);
    }, [isMobile, mode, queueDispatch, selectedTaskId, workspaceId]);

    useEffect(() => {
        const apply = () => {
            const parsed = parseMapReduceRunDeepLink(location.hash);
            if (parsed && parsed.workspaceId === workspaceId && isMapReduceEnabled()) {
                if (selectedTaskId) {
                    queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
                }
                setSelectedTask(null);
                selectedTaskRef.current = null;
                setSelectedRalphSessionId((prev) => (prev === null ? prev : null));
                setSelectedRalphFileName((prev) => (prev === null ? prev : null));
                setSelectedForEachRunId((prev) => (prev === null ? prev : null));
                setSelectedMapReduceRunId((prev) => (prev === parsed.runId ? prev : parsed.runId));
                if (isMobile) setMobileShowDetail(true);
            } else {
                setSelectedMapReduceRunId((prev) => (prev === null ? prev : null));
            }
        };
        apply();
        window.addEventListener('hashchange', apply);
        return () => window.removeEventListener('hashchange', apply);
    }, [workspaceId, selectedTaskId, queueDispatch, isMobile]);

    const handleOpenMapReduceRun = useCallback((runId: string) => {
        if (!isMapReduceEnabled()) return;
        if (selectedTaskId) {
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
            setSelectedTask(null);
            selectedTaskRef.current = null;
        }
        setSelectedRalphSessionId(null);
        setSelectedRalphFileName(null);
        setSelectedForEachRunId(null);
        setSelectedMapReduceRunId(runId);
        const next = buildMapReduceRunHash(workspaceId, mode, runId);
        if (location.hash !== next) location.hash = next;
        if (isMobile) setMobileShowDetail(true);
    }, [isMobile, mode, queueDispatch, selectedTaskId, workspaceId]);

    const handleNewChat = useCallback(() => {
        if (isMobile) {
            mobileNewChatRef.current = true;
            setMobileShowDetail(true);
        }
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
        setSelectedTask(null);
        selectedTaskRef.current = null;
        setSelectedRalphSessionId(null);
        setSelectedRalphFileName(null);
        setSelectedForEachRunId(null);
        setSelectedMapReduceRunId(null);
        const tabSegment = getActivityTabSegment(mode);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/' + tabSegment;
        if (isMobile) setMobileShowDetail(true);
    }, [isMobile, mode, queueDispatch, workspaceId]);

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
            forEachRuns={forEachRuns}
            mapReduceRuns={mapReduceRuns}
            groupPins={groupPins}
            onSetGroupPin={handleSetGroupPin}
            selectedForEachRunId={selectedForEachRunId}
            onSelectForEachRun={handleOpenForEachRun}
            selectedMapReduceRunId={selectedMapReduceRunId}
            onSelectMapReduceRun={handleOpenMapReduceRun}
            cursorTaskId={cursorTaskId}
            onNewChat={handleNewChat}
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
                                        setSelectedRalphFileName(null);
                                        setMobileShowDetail(false);
                                    }}
                                    onSelectIteration={handleSelectRalphIteration}
                                    selectedFileName={selectedRalphFileName ?? undefined}
                                    onSelectFile={handleSelectRalphFile}
                                />
                            ) : selectedForEachRunId ? (
                                <ForEachRunPane
                                    workspaceId={workspaceId}
                                    runId={selectedForEachRunId}
                                    onClose={() => {
                                        setSelectedForEachRunId(null);
                                        setMobileShowDetail(false);
                                    }}
                                    onSelectGenerationProcess={handleSelectForEachGenerationProcess}
                                    onSelectChildProcess={handleSelectForEachChildProcess}
                                />
                            ) : selectedMapReduceRunId ? (
                                <MapReduceRunPane
                                    workspaceId={workspaceId}
                                    runId={selectedMapReduceRunId}
                                    onClose={() => {
                                        setSelectedMapReduceRunId(null);
                                        setMobileShowDetail(false);
                                    }}
                                    onSelectGenerationProcess={handleSelectMapReduceGenerationProcess}
                                    onSelectChildProcess={handleSelectMapReduceChildProcess}
                                />
                            ) : (
                                <ChatDetailPane
                                    selectedTaskId={selectedTaskId}
                                    selectedTask={selectedTask}
                                     onBack={() => setMobileShowDetail(false)}
                                     workspaceId={workspaceId}
                                     readOnly={mode === 'tasks'}
                                     onOpenForEachRun={handleOpenForEachRun}
                                     onOpenMapReduceRun={handleOpenMapReduceRun}
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
            <div className={cn('relative flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="activity-split-panel">
            {listCollapsed ? (
                <>
                {/* Collapsed rail — a thin strip with an expand affordance.
                    Hovering it floats the full list open as a temporary peek (AC-01). */}
                <div
                    className="w-9 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col items-center pt-2"
                    data-testid="activity-list-collapsed"
                    onMouseEnter={hoverPeek.onRailPointerEnter}
                    onMouseLeave={hoverPeek.onRailPointerLeave}
                >
                    <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded text-[#848484] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]"
                        onClick={handleNewChat}
                        aria-label="Start a new conversation"
                        title="Start a new conversation"
                        data-testid="activity-list-collapsed-new-chat"
                    >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                            <path d="M7 2v10M2 7h10" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        className="mt-1 w-7 h-7 flex items-center justify-center rounded text-[#848484] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]"
                        onClick={() => toggleListCollapsed(false)}
                        aria-label="Show chat list"
                        title="Show chat list"
                        data-testid="activity-list-expand"
                    >
                        »
                    </button>
                    <span
                        className="mt-2 text-[10px] tracking-wide text-[#848484] select-none"
                        style={{ writingMode: 'vertical-rl' }}
                    >
                        Chats
                    </span>
                </div>
                {/* Floating peek — the full list overlaid on the conversation
                    (AC-02): no backdrop, no focus trap, reuses ChatListPane. */}
                {hoverPeek.isOpen && (
                    <div
                        ref={peekPanelRef}
                        className={cn(
                            'absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden',
                            'border-r border-[#e0e0e0] dark:border-[#3c3c3c]',
                            'bg-[#fafafa] dark:bg-[#1e1e1e] shadow-xl',
                            'transition-transform duration-200 ease-out',
                            peekVisible ? 'translate-x-0' : '-translate-x-full',
                        )}
                        style={{ width: leftPanelWidth }}
                        data-testid="activity-list-peek"
                        onMouseEnter={hoverPeek.onPanelPointerEnter}
                        onMouseLeave={hoverPeek.onPanelPointerLeave}
                    >
                        {cloneElement(listPane, { onSelectTask: handlePeekSelectTask })}
                    </div>
                )}
                </>
            ) : (
                <>
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

                {/* Resize handle + collapse affordance */}
                <div className="relative flex items-stretch flex-shrink-0 group">
                    <div
                        className="flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors h-full"
                        onMouseDown={handleMouseDown}
                        onTouchStart={handleTouchStart}
                        data-testid="activity-resize-handle"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize activity panel"
                        tabIndex={0}
                    />
                    <button
                        type="button"
                        className="absolute top-1 -left-6 w-6 h-6 flex items-center justify-center rounded text-[#848484] bg-[#fafafa] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] opacity-0 group-hover:opacity-100 hover:text-[#333] dark:hover:text-[#ddd] transition-opacity"
                        onClick={() => toggleListCollapsed(true)}
                        aria-label="Hide chat list"
                        title="Hide chat list"
                        data-testid="activity-list-collapse"
                    >
                        «
                    </button>
                </div>
                </>
            )}

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
                        onClose={() => {
                            setSelectedRalphSessionId(null);
                            setSelectedRalphFileName(null);
                        }}
                        onSelectIteration={handleSelectRalphIteration}
                        selectedFileName={selectedRalphFileName ?? undefined}
                        onSelectFile={handleSelectRalphFile}
                    />
                ) : selectedForEachRunId ? (
                    <ForEachRunPane
                        workspaceId={workspaceId}
                        runId={selectedForEachRunId}
                        onClose={() => setSelectedForEachRunId(null)}
                        onSelectGenerationProcess={handleSelectForEachGenerationProcess}
                        onSelectChildProcess={handleSelectForEachChildProcess}
                    />
                ) : selectedMapReduceRunId ? (
                    <MapReduceRunPane
                        workspaceId={workspaceId}
                        runId={selectedMapReduceRunId}
                        onClose={() => setSelectedMapReduceRunId(null)}
                        onSelectGenerationProcess={handleSelectMapReduceGenerationProcess}
                        onSelectChildProcess={handleSelectMapReduceChildProcess}
                    />
                ) : (
                    <ChatDetailPane
                        selectedTaskId={selectedTaskId}
                        selectedTask={selectedTask}
                        workspaceId={workspaceId}
                        readOnly={mode === 'tasks'}
                        onOpenForEachRun={handleOpenForEachRun}
                        onOpenMapReduceRun={handleOpenMapReduceRun}
                    />
                )}
            </div>
        </div>
        </ChatPreferencesProvider>
    );
}
