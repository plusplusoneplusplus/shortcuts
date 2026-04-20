/**
 * ChatListPane — shared queue-style left rail for Activity and Queue tabs.
 *
 * Renders running/queued/history sections with filters, drag/drop,
 * pause markers, context menus, and selection highlighting.
 * Shared queue task list used by the Activity tab.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Card, Button, cn, FilterDropdown } from '../shared';
import type { FilterItem } from '../shared';
import { getApiBase } from '../utils/config';
import { copyToClipboard, formatDuration, formatRelativeTime, statusLabel } from '../utils/format';
import { ensureQueueProcessId, isQueueProcessId, toQueueProcessId } from '../utils/queue-process-id';
import { buildRows } from '../chat/ConversationMetadataPopover';
import { useQueueDragDrop } from '../hooks/useQueueDragDrop';
import { useQueueTouchDragDrop } from '../hooks/useQueueTouchDragDrop';
import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu';
import { RenameDialog } from '../shared/RenameDialog';
import { fetchApi } from '../hooks/useApi';
import { useWorkflowProgress } from '../hooks/useWorkflowProgress';
import { getDraft } from '../hooks/useDraftStore';
import { useLongPress } from '../hooks/useLongPress';
import { useChatPrefs } from '../context/ChatPreferencesContext';
import { useQueue } from '../context/QueueContext';
import { useDisplaySettings } from '../hooks/useDisplaySettings';
import { SwipeableHistoryItem } from './SwipeableHistoryItem';
import { SummarizeChatDialog } from './SummarizeChatDialog';
import { groupHistoryByPlanFile, type HistoryGroup } from './history-grouping';
import { HistoryGroupHeader } from './HistoryGroupHeader';

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

export type ActivityTabMode = 'chats' | 'tasks';

/** Session category labels for display and filtering. */
export const SESSION_CATEGORY_LABELS: Record<string, { label: string; icon: string; color: string }> = {
    'generating-code': { label: 'Generating Code', icon: '⚙️', color: 'text-blue-600 dark:text-blue-400' },
    'resolve-plan-comments': { label: 'Resolve Plan', icon: '📥', color: 'text-purple-600 dark:text-purple-400' },
    'resolve-commit-comments': { label: 'Resolve Commit', icon: '🔺', color: 'text-amber-600 dark:text-amber-400' },
};

/** Extract session category from a task's payload. */
export function getSessionCategory(task: any): string | undefined {
    return task.payload?.sessionCategory as string | undefined;
}

/** Returns true if a task belongs to the Chats tab (any chat mode, not a work-item execution). */
export function isChatTask(task: any): boolean {
    if (task.type !== 'chat') return false;
    // Work-item executions historically used type:'chat' — exclude them from the Chats tab.
    // Queue items carry workItemId on payload; history items carry it at the top level.
    if (task.workItemId || task.payload?.workItemId) return false;
    return true;
}
const isChat = isChatTask;

/** Get a display title for a chat task, falling back to a truncated prompt preview. */
function getChatTitle(task: any): string {
    if (task.displayName) return task.displayName;
    const text = task.prompt || task.promptPreview || task.payload?.promptContent || task.payload?.prompt || '';
    if (text && !/^Use the \S+ skill\.$/.test(text)) {
        return text.length > 50 ? text.substring(0, 47) + '…' : text;
    }
    return 'Chat';
}

export function taskMatchesFilter(task: any, excludedTypes: Set<string>): boolean {
    if (excludedTypes.size === 0) return true;
    // Session category exclusion
    const cat = getSessionCategory(task);
    if (cat && excludedTypes.has(`cat:${cat}`)) return false;
    // Parent 'chat' exclusion hides all chat tasks (including those with modes)
    if (task.type === 'chat') {
        if (excludedTypes.has('chat')) return false;
        const mode = (task.payload?.mode ?? task.mode) as string | undefined;
        if (mode) return !excludedTypes.has(mode);
        return true;
    }
    return !excludedTypes.has(task.type);
}

export function taskMatchesSearch(task: any, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    const title = (task.displayName || task.title || '').toLowerCase();
    const prompt = (task.prompt || task.promptPreview || task.payload?.promptContent || task.payload?.prompt || '').toLowerCase();
    return title.includes(q) || prompt.includes(q);
}

/** Return a type-specific icon for a task, matching the chat mode selector icons. */
export function getTaskTypeIcon(task: any): string {
    const type = task.type as string;
    const payload = task.payload || {};
    const mode = payload.mode ?? task.mode;
    if (payload.scheduleId || task.scheduleId) return '📅';
    if (type === 'chat') {
        if (mode === 'ask') return '💡';
        if (mode === 'plan') return '📋';
        return '🤖';
    }
    if (type === 'run-workflow') return payload.workItemId ? '📦' : '▶️';
    if (type === 'run-script') return '🛠️';
    return '🤖';
}

/** Extract a short preview of the user prompt from the task payload. */
export function getTaskPromptPreview(task: any): string {
    const text = task.prompt || task.promptPreview || task.payload?.promptContent || task.payload?.prompt || '';
    if (!text || /^Use the \S+ skill\.$/.test(text)) return '';
    return text.length > 60 ? text.substring(0, 57) + '…' : text;
}

export interface ChatListPaneProps {
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
    /** Set of process IDs with unseen activity (bold + dot indicator). */
    unseenProcessIds?: Set<string>;
    /** Mark all completed tasks as read (receives the currently-filtered task list). */
    onMarkAllRead?: (tasks: any[]) => void;
    /** Mark a single completed task as read. */
    onMarkRead?: (taskId: string) => void;
    /** Mark a single completed task as unread. */
    onMarkUnread?: (taskId: string) => void;
    onSelectTask: (id: string, task?: any) => void;
    onPauseResume: () => void;
    /** Whether the autopilot scheduler is currently paused. */
    isAutopilotPaused?: boolean;
    /** True while the pause/resume autopilot request is in-flight. */
    isAutopilotPauseLoading?: boolean;
    /** Toggle autopilot pause/resume. */
    onPauseResumeAutopilot?: () => void;
    onRefresh: () => void;
    onOpenDialog: () => void;
    fetchQueue: () => Promise<void>;
    /** Reason for the current pause (present when auto-paused due to task failure). */
    pauseReason?: { taskId: string; displayName: string; failedAt: string };
    /** True when there are more completed tasks to load from the server. */
    hasMore?: boolean;
    /** True while a "Load more" request is in-flight. */
    loadingMore?: boolean;
    /** Callback to load the next page of completed tasks. */
    onLoadMore?: () => void;
    /** Server-side FTS5 search results (null = not searching, [] = no results). */
    searchResults?: any[] | null;
    /** True while server search is in-flight. */
    searchLoading?: boolean;
    /** Total number of server-side search matches. */
    searchTotal?: number;
    /** Whether there are more search results to load. */
    searchHasMore?: boolean;
    /** True while loading more search results. */
    searchLoadingMore?: boolean;
    /** Callback when user types in search — drives server-side search from parent. */
    onSearchQueryChange?: (query: string) => void;
    /** Callback to load more server-side search results. */
    onLoadMoreSearchResults?: () => void;
    /** Active tab mode — 'chats' shows a flat time-sorted chat list; 'tasks' shows queue-style sections. */
    activeTab?: ActivityTabMode;
    /** Deselect the current task so the inline NewChatArea is shown. */
    onNewChat?: () => void;
}

function formatMetadataText(task: any): string {
    return buildRows(task).map(r => `${r.label}: ${r.value}`).join('\n');
}

export function ChatListPane({
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
    unseenProcessIds,
    onMarkAllRead,
    onMarkRead,
    onMarkUnread,
    onSelectTask,
    onPauseResume,
    isAutopilotPaused,
    isAutopilotPauseLoading,
    onPauseResumeAutopilot,
    onRefresh,
    onOpenDialog,
    fetchQueue,
    pauseReason,
    hasMore,
    loadingMore,
    onLoadMore,
    searchResults,
    searchLoading,
    searchTotal,
    searchHasMore,
    searchLoadingMore,
    onSearchQueryChange,
    onLoadMoreSearchResults,
    activeTab,
    onNewChat,
}: ChatListPaneProps) {
    const { state: queueState } = useQueue();
    const isTaskSubmitting = queueState.isTaskSubmitting;

    /** Check if a task is the currently selected one (processId-aware). */
    const isSelected = useCallback((taskId: string): boolean => {
        if (!selectedTaskId) return false;
        if (taskId === selectedTaskId) return true;
        // selectedTaskId is a processId; check if bare taskId matches via prefix
        if (!isQueueProcessId(taskId) && toQueueProcessId(taskId) === selectedTaskId) return true;
        return false;
    }, [selectedTaskId]);
    const [excludedTypes, setExcludedTypes] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQueryRaw] = useState('');
    const [searchVisible, setSearchVisible] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const setSearchQuery = useCallback((q: string) => {
        setSearchQueryRaw(q);
        onSearchQueryChange?.(q);
    }, [onSearchQueryChange]);

    const isServerSearchActive = searchResults != null;
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string; taskStatus: 'running' | 'queued' | 'completed'; bulkIds?: string[] } | null>(null);
    const [insertingPauseAt, setInsertingPauseAt] = useState<number | null>(null);
    const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
    const [anchorHistoryId, setAnchorHistoryId] = useState<string | null>(null);
    const [summarizeDialogOpen, setSummarizeDialogOpen] = useState(false);
    const [summarizeDialogIds, setSummarizeDialogIds] = useState<string[]>([]);
    const [renameTarget, setRenameTarget] = useState<{ taskId: string; title: string } | null>(null);

    const { pinnedChatIds, archivedChatIds, pinChat: onPinChat, unpinChat: onUnpinChat, archiveChat: onArchiveChat, unarchiveChat: onUnarchiveChat, archiveChats: onArchiveChats, unarchiveChats: onUnarchiveChats } = useChatPrefs();
    const { taskCardDensity, historyGrouping } = useDisplaySettings();
    const isDense = taskCardDensity === 'dense';

    useEffect(() => {
        setExcludedTypes(new Set());
        setSearchQueryRaw('');
        onSearchQueryChange?.('');
        setSearchVisible(false);
    }, [workspaceId]);

    const detailPaneFocusedRef = useRef(false);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const detailPane = document.querySelector('[data-pane="detail"]');
            detailPaneFocusedRef.current = !!detailPane?.contains(e.target as Node);
        };
        document.addEventListener('mousedown', handler, true);
        return () => document.removeEventListener('mousedown', handler, true);
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                if (detailPaneFocusedRef.current) return;
                e.preventDefault();
                setSearchVisible(true);
                setTimeout(() => searchInputRef.current?.focus(), 0);
            }
            if (e.key === 'Escape' && searchVisible) {
                setSearchQuery('');
                setSearchVisible(false);
            }
            if (e.key === 'Escape' && selectedHistoryIds.size > 0) {
                setSelectedHistoryIds(new Set());
                setAnchorHistoryId(null);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [searchVisible]);

    const allTasks = useMemo(
        () => [...running, ...queued.filter((t: any) => t.kind !== 'pause-marker'), ...history],
        [running, queued, history],
    );
    const availableFilters = useMemo(() => {
        const types = new Set(allTasks.map((t: any) => t.type as string));
        const opts: FilterItem[] = [];
        for (const [type, label] of Object.entries(TASK_TYPE_LABELS)) {
            if (!types.has(type)) continue;
            if (type === 'chat') {
                const chatTasks = allTasks.filter((t: any) => t.type === 'chat');
                const modes = new Set(chatTasks.map((t: any) => (t.payload?.mode ?? t.mode) as string).filter(Boolean));
                const children = Object.entries(CHAT_MODE_LABELS)
                    .filter(([mode]) => modes.has(mode))
                    .map(([mode, modeLabel]) => ({ value: mode, label: modeLabel }));
                opts.push({ value: type, label, ...(children.length > 0 && { children }) });
            } else {
                opts.push({ value: type, label });
            }
        }
        return opts;
    }, [allTasks]);

    const filteredRunning = useMemo(() => running.filter(t => taskMatchesFilter(t, excludedTypes) && taskMatchesSearch(t, searchQuery)), [running, excludedTypes, searchQuery]);
    const filteredQueued = useMemo(
        () => queued.filter(t => t.kind === 'pause-marker' || (taskMatchesFilter(t, excludedTypes) && taskMatchesSearch(t, searchQuery))),
        [queued, excludedTypes, searchQuery],
    );
    const filteredHistory = useMemo(() => history.filter(t => taskMatchesFilter(t, excludedTypes) && taskMatchesSearch(t, searchQuery)), [history, excludedTypes, searchQuery]);

    // Tab-aware filtered arrays for empty state detection
    const isTaskItem = useCallback((t: any) => !isChat(t), []);
    const tabFilteredRunning = useMemo(() => activeTab === 'chats' ? filteredRunning.filter(isChat) : activeTab === 'tasks' ? filteredRunning.filter(isTaskItem) : filteredRunning, [activeTab, filteredRunning, isTaskItem]);
    const tabFilteredQueued = useMemo(() => activeTab === 'chats' ? [] : activeTab === 'tasks' ? filteredQueued.filter(isTaskItem) : filteredQueued, [activeTab, filteredQueued, isTaskItem]);
    const tabFilteredHistory = useMemo(() => activeTab === 'chats' ? filteredHistory.filter(isChat) : activeTab === 'tasks' ? filteredHistory.filter(isTaskItem) : filteredHistory, [activeTab, filteredHistory, isTaskItem]);

    // Separate archived from non-archived history (uses tab-filtered history for proper exclusions)
    const { activeHistory, filteredArchived } = useMemo(() => {
        const base = tabFilteredHistory;
        if (!archivedChatIds || archivedChatIds.size === 0) {
            return { activeHistory: base, filteredArchived: [] };
        }
        const active: any[] = [];
        const archived: any[] = [];
        for (const task of base) {
            if (archivedChatIds.has(task.id)) archived.push(task);
            else active.push(task);
        }
        return { activeHistory: active, filteredArchived: archived };
    }, [tabFilteredHistory, archivedChatIds]);

    // Split active history into pinned and non-pinned, preserving pin order
    const { filteredPinned, filteredUnpinned } = useMemo(() => {
        if (!pinnedChatIds || pinnedChatIds.size === 0) {
            return { filteredPinned: [], filteredUnpinned: activeHistory };
        }
        const pinned: any[] = [];
        const unpinned: any[] = [];
        const historyById = new Map(activeHistory.map((t: any) => [t.id, t]));
        // Preserve pin order (newest pinned first)
        for (const id of pinnedChatIds) {
            const task = historyById.get(id);
            if (task) pinned.push(task);
        }
        for (const task of activeHistory) {
            if (!pinnedChatIds.has(task.id)) unpinned.push(task);
        }
        return { filteredPinned: pinned, filteredUnpinned: unpinned };
    }, [activeHistory, pinnedChatIds]);

    // Chats tab: merge running chats + history chats into a single time-sorted list
    const chatAllItems = useMemo(() => {
        if (activeTab !== 'chats') return { pinned: [] as any[], unpinned: [] as any[], archived: [] as any[] };
        const runningChats = filteredRunning.filter(isChat);
        const historyChats = filteredHistory.filter(isChat);
        const all = [...runningChats, ...historyChats];
        // Deduplicate by processId — running tasks take priority
        const seenProcessIds = new Set<string>();
        const deduped = all.filter(t => {
            const key = t.processId || t.payload?.processId || t.id;
            if (seenProcessIds.has(key)) return false;
            seenProcessIds.add(key);
            return true;
        });
        deduped.sort((a, b) => {
            const timeA = a.completedAt || a.startedAt || a.createdAt || 0;
            const timeB = b.completedAt || b.startedAt || b.createdAt || 0;
            return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
        const pinned: any[] = [];
        const unpinned: any[] = [];
        const archived: any[] = [];
        const pinnedById = new Map<string, any>();
        for (const t of deduped) {
            if (archivedChatIds?.has(t.id)) { archived.push(t); continue; }
            if (pinnedChatIds?.has(t.id)) { pinnedById.set(t.id, t); continue; }
            unpinned.push(t);
        }
        if (pinnedChatIds) {
            for (const id of pinnedChatIds) {
                const t = pinnedById.get(id);
                if (t) pinned.push(t);
            }
        }
        return { pinned, unpinned, archived };
    }, [activeTab, filteredRunning, filteredHistory, pinnedChatIds, archivedChatIds]);

    // Group unpinned history by plan file (when grouping is enabled)
    const groupedUnpinned = useMemo(
        () => historyGrouping ? groupHistoryByPlanFile(filteredUnpinned, unseenProcessIds) : null,
        [filteredUnpinned, unseenProcessIds, historyGrouping],
    );

    // Expand/collapse state for plan-file groups
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const toggleGroup = useCallback((planFilePath: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            next.has(planFilePath) ? next.delete(planFilePath) : next.add(planFilePath);
            return next;
        });
    }, []);

    // Auto-collapse groups where all children are seen (on group list change)
    const prevGroupKeysRef = useRef<string>('');
    useEffect(() => {
        if (!groupedUnpinned) return;
        const groupKeys = groupedUnpinned
            .filter((e): e is HistoryGroup => e.kind === 'group')
            .map(g => g.planFilePath)
            .sort()
            .join('\0');
        if (groupKeys === prevGroupKeysRef.current) return;
        prevGroupKeysRef.current = groupKeys;
        const toCollapse = new Set<string>();
        for (const entry of groupedUnpinned) {
            if (entry.kind === 'group' && !entry.hasUnseen) {
                toCollapse.add(entry.planFilePath);
            }
        }
        if (toCollapse.size > 0) setCollapsedGroups(toCollapse);
    }, [groupedUnpinned]);

    // Count pinned tasks that are still running (not yet in history)
    const pinnedRunningCount = useMemo(() => {
        if (!pinnedChatIds) return 0;
        return filteredRunning.filter(t => pinnedChatIds.has(t.id)).length;
    }, [filteredRunning, pinnedChatIds]);

    const [showRunning, setShowRunning] = useState(true);
    const [showQueued, setShowQueued] = useState(true);
    const [showPinned, setShowPinned] = useState(true);
    const [showHistory, setShowHistory] = useState(true);
    const [showArchived, setShowArchived] = useState(false);

    const handleCancel = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId), { method: 'DELETE' });
        fetchQueue();
    };

    const deleteChatDirect = async (taskId: string) => {
        const url = workspaceId
            ? getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/history/' + encodeURIComponent(taskId)
            : getApiBase() + '/queue/history/' + encodeURIComponent(taskId);
        const res = await fetch(url, { method: 'DELETE' });
        if (res.ok) {
            fetchQueue();
        }
    };

    const handleDeleteChat = async (taskId: string) => {
        if (!confirm('Delete this chat? This cannot be undone.')) return;
        await deleteChatDirect(taskId);
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

    const [isAdmitting, setIsAdmitting] = useState(false);

    const handleAdmit = async (taskId: string) => {
        setIsAdmitting(true);
        try {
            await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/admit', { method: 'POST' });
            await fetchQueue();
        } finally {
            setIsAdmitting(false);
        }
    };

    const handleUnadmit = async (taskId: string) => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/unadmit', { method: 'POST' });
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

    // ── History/archived long-press via shared useLongPress hook ──
    const historyLongPressTaskRef = useRef<string>('');

    const historyLongPress = useLongPress(
        (x: number, y: number) => {
            const taskId = historyLongPressTaskRef.current;
            const bulkIds =
                selectedHistoryIds.size >= 2 && selectedHistoryIds.has(taskId)
                    ? Array.from(selectedHistoryIds)
                    : undefined;
            setContextMenu({ x, y, taskId, taskStatus: 'completed', bulkIds });
        },
    );

    // Clean up stale selection when the filtered list changes
    useEffect(() => {
        if (selectedHistoryIds.size === 0) return;
        const allHistoryIds = new Set([...filteredUnpinned.map((t: any) => t.id), ...filteredPinned.map((t: any) => t.id)]);
        const cleaned = new Set([...selectedHistoryIds].filter(id => allHistoryIds.has(id)));
        if (cleaned.size !== selectedHistoryIds.size) {
            setSelectedHistoryIds(cleaned);
        }
    }, [filteredUnpinned, filteredPinned]);

    const handleHistoryItemClick = useCallback(
        (e: React.MouseEvent, task: any, taskList: any[]) => {
            const id = task.id as string;

            if (e.shiftKey && anchorHistoryId) {
                const ids = taskList.map((t: any) => t.id as string);
                const aIdx = ids.indexOf(anchorHistoryId);
                const bIdx = ids.indexOf(id);
                if (aIdx !== -1 && bIdx !== -1) {
                    const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
                    setSelectedHistoryIds(new Set(ids.slice(lo, hi + 1)));
                    return;
                }
            }

            if (e.ctrlKey || e.metaKey) {
                setSelectedHistoryIds(prev => {
                    const next = new Set(prev);
                    next.has(id) ? next.delete(id) : next.add(id);
                    return next;
                });
                setAnchorHistoryId(id);
                return;
            }

            // Plain click: clear multi-selection, open detail
            setSelectedHistoryIds(new Set());
            setAnchorHistoryId(id);
            onSelectTask(id, task);
        },
        [anchorHistoryId, onSelectTask],
    );

    const handleTaskContextMenu= useCallback((e: React.MouseEvent, taskId: string, taskStatus: 'running' | 'queued' | 'completed') => {
        if (e.shiftKey) return; // Allow native browser context menu on shift+right-click
        e.preventDefault();
        e.stopPropagation();

        const bulkIds =
            taskStatus === 'completed' &&
            selectedHistoryIds.size >= 1 &&
            selectedHistoryIds.has(taskId)
                ? Array.from(selectedHistoryIds)
                : taskStatus === 'completed'
                    ? [taskId]
                    : undefined;

        setContextMenu({ x: e.clientX, y: e.clientY, taskId, taskStatus, bulkIds });
    }, [selectedHistoryIds]);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const handleRenameConfirm = useCallback(async (newTitle: string) => {
        if (!renameTarget) return;
        const processId = ensureQueueProcessId(renameTarget.taskId);
        setRenameTarget(null);
        try {
            await fetchApi(`/processes/${encodeURIComponent(processId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle }),
            });
            fetchQueue();
        } catch { /* WS will sync eventually */ }
    }, [renameTarget, fetchQueue]);

    const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
        if (!contextMenu) return [];
        const { taskId, taskStatus } = contextMenu;

        // Bulk context menu for multi-selected completed tasks
        if (contextMenu.bulkIds) {
            const ids = contextMenu.bulkIds;
            const anyUnseen   = ids.some(id => unseenProcessIds?.has(id));
            const anySeen     = ids.some(id => !unseenProcessIds?.has(id));
            const anyPinned   = ids.some(id => pinnedChatIds?.has(id));
            const anyUnpinned = ids.some(id => !pinnedChatIds?.has(id));
            const anyArchived   = ids.some(id => archivedChatIds?.has(id));
            const anyUnarchived = ids.some(id => !archivedChatIds?.has(id));
            return [
                { label: `${ids.length} tasks selected`, icon: '', disabled: true, onClick: () => {} },
                { label: '', icon: '', separator: true, onClick: () => {} },
                ...(anyUnseen && onMarkRead    ? [{ label: 'Mark as Read',   icon: '✓', onClick: () => { ids.forEach(id => onMarkRead!(id));   closeContextMenu(); } }] : []),
                ...(anySeen && onMarkUnread    ? [{ label: 'Mark as Unread', icon: '●', onClick: () => { ids.forEach(id => onMarkUnread!(id)); closeContextMenu(); } }] : []),
                ...(anyPinned && onUnpinChat   ? [{ label: 'Unpin',          icon: '📌', onClick: () => { ids.forEach(id => onUnpinChat!(id)); closeContextMenu(); } }] : []),
                ...(anyUnpinned && onPinChat   ? [{ label: 'Pin to top',     icon: '📌', onClick: () => { ids.forEach(id => onPinChat!(id));   closeContextMenu(); } }] : []),
                ...(anyUnarchived && onArchiveChats  ? [{ label: 'Archive',   icon: '📦', onClick: () => { onArchiveChats!(ids);   closeContextMenu(); } }] : []),
                ...(anyArchived  && onUnarchiveChats ? [{ label: 'Unarchive', icon: '📤', onClick: () => { onUnarchiveChats!(ids); closeContextMenu(); } }] : []),
                ...(ids.length <= 20 ? [{
                    label: ids.length === 1 ? 'Summarize chat' : `Summarize ${ids.length} chats`,
                    icon: '📝',
                    onClick: () => {
                        closeContextMenu();
                        setSummarizeDialogIds(ids);
                        setSummarizeDialogOpen(true);
                    },
                }] : []),
                {
                    label: ids.length === 1 ? 'Copy metadata' : `Copy metadata (${ids.length} chats)`,
                    icon: '📋',
                    onClick: () => {
                        const tasks = ids
                            .map(id => history.find((t: any) => t.id === id))
                            .filter(Boolean);
                        const text = tasks.map(t => formatMetadataText(t)).join('\n\n---\n\n');
                        void copyToClipboard(text);
                        closeContextMenu();
                    },
                },
                // Rename available only for single-item selection
                ...(ids.length === 1 ? [{
                    label: 'Rename', icon: '✏️', onClick: () => {
                        const task = history.find(t => t.id === ids[0]);
                        setRenameTarget({ taskId: ids[0], title: task?.displayName || task?.title || task?.type || '' });
                        closeContextMenu();
                    },
                }] : []),
                { label: '', icon: '', separator: true, onClick: () => {} },
                { label: `Delete ${ids.length} chats…`, icon: '🗑', onClick: () => {
                    if (confirm(`Delete ${ids.length} chats? This cannot be undone.`)) {
                        ids.forEach(id => deleteChatDirect(id));
                        setSelectedHistoryIds(new Set());
                    }
                    closeContextMenu();
                }},
            ];
        }

        if (taskStatus === 'running') {
            const isPinned = pinnedChatIds?.has(taskId) ?? false;
            return [
                ...(isPinned && onUnpinChat ? [{ label: 'Unpin', icon: '📌', onClick: () => onUnpinChat(taskId) }] : []),
                ...(!isPinned && onPinChat ? [{ label: 'Pin to top', icon: '📌', onClick: () => onPinChat(taskId) }] : []),
                { label: 'Copy metadata', icon: '📋', onClick: () => {
                    const task = running.find((t: any) => t.id === taskId);
                    if (task) void copyToClipboard(formatMetadataText(task));
                    closeContextMenu();
                }},
                { label: '', icon: '', separator: true, onClick: () => {} },
                { label: 'Cancel', icon: '✕', onClick: () => handleCancel(taskId) },
            ];
        }
        if (taskStatus === 'completed') {
            const isUnseen = unseenProcessIds?.has(taskId) ?? false;
            const isPinned = pinnedChatIds?.has(taskId) ?? false;
            const isArchived = archivedChatIds?.has(taskId) ?? false;
            const task = history.find(t => t.id === taskId);
            return [
                ...(isPinned && onUnpinChat ? [{ label: 'Unpin', icon: '📌', onClick: () => onUnpinChat(taskId) }] : []),
                ...(!isPinned && onPinChat ? [{ label: 'Pin to top', icon: '📌', onClick: () => onPinChat(taskId) }] : []),
                ...(isUnseen && onMarkRead ? [{ label: 'Mark as Read', icon: '✓', onClick: () => onMarkRead(taskId) }] : []),
                ...(!isUnseen && onMarkUnread ? [{ label: 'Mark as Unread', icon: '●', onClick: () => onMarkUnread(taskId) }] : []),
                { label: 'Rename', icon: '✏️', onClick: () => {
                    setRenameTarget({ taskId, title: task?.displayName || task?.title || task?.type || '' });
                    closeContextMenu();
                }},
                ...(isArchived && onUnarchiveChat ? [{ label: 'Unarchive', icon: '📤', onClick: () => onUnarchiveChat(taskId) }] : []),
                ...(!isArchived && onArchiveChat ? [{ label: 'Archive', icon: '📦', onClick: () => onArchiveChat(taskId) }] : []),
                { label: '', icon: '', separator: true, onClick: () => {} },
                { label: 'Delete chat', icon: '🗑', onClick: () => handleDeleteChat(taskId) },
            ];
        }
        const queuedIndex = queued.findIndex(t => t.id === taskId);
        const task = queued[queuedIndex];
        const isFrozen = task?.frozen;
        const isHeld = isAutopilotPaused && task?.payload?.mode === 'autopilot' && !task?.admitted;
        const isAdmitted = isAutopilotPaused && task?.payload?.mode === 'autopilot' && !!task?.admitted;
        return [
            ...(queuedIndex > 0 ? [{ label: 'Move Up', icon: '▲', onClick: () => handleMoveUp(taskId) }] : []),
            { label: 'Move to Top', icon: '⏬', onClick: () => handleMoveToTop(taskId) },
            { label: '', icon: '', separator: true, onClick: () => {} },
            ...(isHeld ? [{ label: 'Schedule Immediately', icon: '🚀', onClick: () => handleAdmit(taskId) }] : []),
            ...(isAdmitted ? [{ label: 'Cancel Scheduling', icon: '🚫', onClick: () => handleUnadmit(taskId) }] : []),
            ...((isHeld || isAdmitted) ? [{ label: '', icon: '', separator: true, onClick: () => {} }] : []),
            { label: 'Copy metadata', icon: '📋', onClick: () => {
                if (task) void copyToClipboard(formatMetadataText(task));
                closeContextMenu();
            }},
            isFrozen
                ? { label: 'Unfreeze', icon: '▶', onClick: () => handleUnfreeze(taskId) }
                : { label: 'Freeze', icon: '❄', onClick: () => handleFreeze(taskId) },
            { label: 'Cancel', icon: '✕', onClick: () => handleCancel(taskId) },
        ];
    }, [contextMenu, queued, running, history, unseenProcessIds, pinnedChatIds, archivedChatIds, onMarkRead, onMarkUnread, onPinChat, onUnpinChat, onArchiveChat, onUnarchiveChat, onArchiveChats, onUnarchiveChats, closeContextMenu, deleteChatDirect, workspaceId, onSelectTask, fetchQueue, isAutopilotPaused]);

    /** Render a single history card (shared between flat and grouped layouts). */
    const renderHistoryCard = useCallback((task: any) => {
        const isUnseen = unseenProcessIds?.has(task.id) ?? false;
        const hasDraft = !!getDraft(task.id);
        const isHistorySelected = selectedHistoryIds.has(task.id);
        return (
            <SwipeableHistoryItem key={task.id} isMobile={isMobile} onArchive={() => onArchiveChat(task.id)} onUnarchive={() => onUnarchiveChat(task.id)}>
            <Card
                className={cn(
                    isDense ? "px-2 py-2.5 md:py-1 cursor-pointer" : "p-2 cursor-pointer",
                    isHistorySelected
                        ? "bg-[#0078d4]/10 dark:bg-[#3794ff]/10 outline outline-1 outline-[#0078d4]/40 dark:outline-[#3794ff]/40"
                        : isSelected(task.id) && "ring-2 ring-[#0078d4]",
                    selectedHistoryIds.size > 0 && "select-none"
                )}
                onClick={e => {
                    if (historyLongPress.didLongPress()) return;
                    handleHistoryItemClick(e, task, filteredUnpinned);
                }}
                onContextMenu={e => handleTaskContextMenu(e, task.id, 'completed')}
                onTouchStart={e => { historyLongPressTaskRef.current = task.id; historyLongPress.onTouchStart(e); }}
                onTouchEnd={historyLongPress.onTouchEnd}
                onTouchMove={historyLongPress.onTouchMove}
                data-task-id={task.id}
                data-unseen={isUnseen || undefined}
                data-selected={isHistorySelected || undefined}
            >
                <div className="flex items-center justify-between gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                    <span className="flex items-center gap-1 min-w-0 truncate">
                        {isHistorySelected && <span className="shrink-0 text-[#0078d4] dark:text-[#3794ff] text-[10px]" data-testid="selection-checkbox">☑</span>}
                        {isUnseen && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]" data-testid="unseen-dot" />}
                        <span className="shrink-0">
                            {getTaskTypeIcon(task)}{task.status === 'completed' ? ' ✅' : task.status === 'failed' ? ' ❌' : task.status === 'cancelled' ? ' 🚫' : ''}
                        </span>
                        <span className={cn("truncate", isUnseen && "font-semibold")} title={task.displayName || task.title || task.type || 'Task'}>
                            {task.displayName || task.title || task.type || 'Task'}
                        </span>
                        {hasDraft && <span className="shrink-0 text-[10px] text-[#848484] dark:text-[#bbb]" title="Unsent draft" data-testid="draft-badge">✏️</span>}
                    </span>
                    <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                        {(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt) ? formatRelativeTime(new Date(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt).toISOString()) : ''}
                    </span>
                </div>
                {!isDense && (() => { const p = getTaskPromptPreview(task); return p ? <div className={cn("text-[10px] mt-0.5 truncate", isUnseen ? "text-[#1e1e1e] dark:text-[#cccccc]" : "text-[#848484] dark:text-[#bbb]")} title={p}>{p}</div> : null; })()}
                {!isDense && task.error && (
                    <div className="text-[10px] text-red-500 mt-0.5 truncate">
                        {task.error.length > 80 ? task.error.substring(0, 77) + '...' : task.error}
                    </div>
                )}
            </Card>
            </SwipeableHistoryItem>
        );
    }, [unseenProcessIds, selectedHistoryIds, isDense, isMobile, isSelected, handleHistoryItemClick, handleTaskContextMenu, filteredUnpinned, onArchiveChat, onUnarchiveChat]);

    // When a server-side search is active, always render the main body so FTS5 results
    // can be displayed even when the locally-loaded history page is empty.
    if (running.length === 0 && queued.length === 0 && history.length === 0 && !isServerSearchActive) {
        return (
            <div className="p-4 text-center text-sm text-[#848484]" data-testid="queue-empty-state">
                {isRefreshing && (
                    <div className="mb-2 animate-pulse" data-testid="queue-refreshing-indicator">Refreshing…</div>
                )}
                {activeTab === 'chats' ? (
                    <div>No chats yet</div>
                ) : isPaused ? (
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
                    <div className="mb-2">{workspaceId ? 'No tasks in queue for this repository' : 'No tasks in queue'}</div>
                )}
            </div>
        );
    }

    return (
        <>
            <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
                {/* ── Chats tab: flat time-sorted list ── */}
                {activeTab === 'chats' && (
                    <>
                        <Button variant="ghost" size="sm" onClick={onNewChat ?? onOpenDialog} className={cn("self-start", isMobile && "hidden")} data-testid="new-chat-btn">
                            💬 New Chat
                        </Button>
                        {/* Search bar — always visible on Chats tab */}
                        <div className="flex items-center gap-1.5 px-1 py-1 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e] text-xs">
                            <span className="text-[#848484]">🔍</span>
                            <input
                                type="text"
                                placeholder="Search conversations…"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="flex-1 bg-transparent outline-none text-xs placeholder:text-[#848484]"
                                data-testid="queue-search-input"
                            />
                            {searchLoading && (
                                <span className="text-[#848484] animate-pulse" data-testid="search-loading-indicator">⏳</span>
                            )}
                            {searchQuery && !searchLoading && (
                                <span className="text-[#848484] tabular-nums" data-testid="search-match-count">
                                    {isServerSearchActive ? searchTotal ?? 0 : chatAllItems.pinned.length + chatAllItems.unpinned.length + chatAllItems.archived.length}
                                </span>
                            )}
                            {searchQuery && (
                                <button
                                    className="text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] leading-none"
                                    onClick={() => setSearchQuery('')}
                                    data-testid="chat-search-close"
                                >✕</button>
                            )}
                        </div>
                        {/* FTS5 server-side search results (replaces normal sections when active) */}
                        {isServerSearchActive ? (
                            <div data-testid="chat-search-results">
                                <div className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium mb-1">
                                    🔍 Search Results
                                    <span className="text-[10px]">({searchResults!.length}{searchTotal != null && searchTotal > searchResults!.length ? ` of ${searchTotal}` : ''})</span>
                                </div>
                                {searchQuery.length === 1 && (
                                    <div className="text-[10px] text-[#848484] dark:text-[#bbb] italic" data-testid="chat-search-min-chars-hint">
                                        Type 2+ characters to search all conversations
                                    </div>
                                )}
                                {searchResults!.length === 0 && !searchLoading && (
                                    <div className="text-[10px] text-[#848484] dark:text-[#bbb]" data-testid="chat-search-no-results">
                                        No matching chats found
                                    </div>
                                )}
                                <div className={cn("flex flex-col mt-1", isDense ? "gap-0.5" : "gap-1")}>
                                    {searchResults!.map(task => (
                                        <Card
                                            key={task.id}
                                            className={cn(
                                                isDense ? "px-2 py-2.5 md:py-1 cursor-pointer" : "p-2 cursor-pointer",
                                                isSelected(task.id) && "ring-2 ring-[#0078d4]"
                                            )}
                                            onClick={() => onSelectTask(task.id, task)}
                                            data-task-id={task.id}
                                            data-testid="chat-search-result-item"
                                        >
                                            <div className="flex items-center justify-between gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                                                <span className="flex items-center gap-1 min-w-0 truncate">
                                                    <span className="truncate" title={task.displayName || task.title || 'Chat'}>
                                                        {task.displayName || task.title || 'Chat'}
                                                    </span>
                                                    {task.status === 'failed' && <span className="shrink-0">❌</span>}
                                                </span>
                                                <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                                                    {(task.completedAt ?? task.endTime) ? formatRelativeTime(new Date(task.completedAt ?? task.endTime).toISOString()) : ''}
                                                </span>
                                            </div>
                                            {!isDense && task._searchSnippet && (
                                                <div
                                                    className="text-[10px] mt-0.5 truncate text-[#848484] dark:text-[#bbb] [&_mark]:bg-yellow-200 [&_mark]:dark:bg-yellow-700/50 [&_mark]:text-inherit [&_mark]:rounded-sm [&_mark]:px-px"
                                                    data-testid="chat-search-snippet"
                                                    dangerouslySetInnerHTML={{ __html: task._searchSnippet }}
                                                />
                                            )}
                                            {!isDense && !task._searchSnippet && (() => { const p = getTaskPromptPreview(task); return p ? <div className="text-[10px] mt-0.5 truncate text-[#848484] dark:text-[#bbb]" title={p}>{p}</div> : null; })()}
                                        </Card>
                                    ))}
                                </div>
                                {searchHasMore && onLoadMoreSearchResults && (
                                    <div className="px-4 py-2">
                                        <button
                                            onClick={onLoadMoreSearchResults}
                                            disabled={searchLoadingMore}
                                            className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                                            data-testid="chat-search-load-more-btn"
                                        >
                                            {searchLoadingMore ? 'Loading…' : 'Load more results'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* Normal pinned/unpinned/archived sections */
                            <>
                                {chatAllItems.pinned.length > 0 && (
                                    <div>
                                        <div className="text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium mb-1">📌 Pinned</div>
                                        <div className="flex flex-col gap-1">
                                            {chatAllItems.pinned.map(task => {
                                                const isUnseen = unseenProcessIds?.has(task.id) ?? false;
                                                const hasDraft = !!getDraft(task.id);
                                                const isRunning = running.some(t => t.id === task.id);
                                                return (
                                                    <Card
                                                        key={task.id}
                                                        className={cn(
                                                            'p-2 cursor-pointer border-l-2 border-l-amber-400 dark:border-l-amber-500',
                                                            isSelected(task.id) && 'ring-2 ring-[#0078d4]'
                                                        )}
                                                        onClick={() => onSelectTask(task.id, task)}
                                                        onContextMenu={e => handleTaskContextMenu(e, task.id, isRunning ? 'running' : 'completed')}
                                                        data-task-id={task.id}
                                                        data-pinned="true"
                                                    >
                                                        <div className="flex items-center justify-between gap-1.5 text-xs">
                                                            <span className="flex items-center gap-1 min-w-0 truncate">
                                                                {isUnseen && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]" />}
                                                                {!isRunning && task.status === 'failed' && <span className="shrink-0">❌</span>}
                                                                <span className={cn('truncate', isUnseen && 'font-semibold')} title={getChatTitle(task)}>{getChatTitle(task)}</span>
                                                                {hasDraft && <span className="shrink-0 text-[10px] text-[#848484]" title="Unsent draft" data-testid="draft-badge">✏️</span>}
                                                                {(() => { const cat = getSessionCategory(task); const m = cat ? SESSION_CATEGORY_LABELS[cat] : undefined; return m ? <span className={cn("shrink-0 text-[10px] font-medium", m.color)} data-testid="session-category-badge">{m.icon}</span> : null; })()}
                                                            </span>
                                                            <span className="text-[10px] text-[#848484] dark:text-[#999] shrink-0 whitespace-nowrap tabular-nums">
                                                                {isRunning ? <span className="inline-flex items-center gap-1" data-testid="thinking-indicator"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#0078d4] animate-pulse" />{statusLabel('running', task.type)}</span> : (task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt) ? formatRelativeTime(new Date(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt).toISOString()) : ''}
                                                            </span>
                                                        </div>
                                                        {(() => { const p = getTaskPromptPreview(task); return p ? <div className={cn('text-[10px] mt-0.5 truncate', isUnseen ? 'text-[#1e1e1e] dark:text-[#cccccc]' : 'text-[#848484] dark:text-[#999]')} title={p}>{p}</div> : null; })()}
                                                    </Card>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {chatAllItems.unpinned.length > 0 && (
                                    <div>
                                        <div className="text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium mb-1">💬 Recently</div>
                                        <div className="flex flex-col gap-1">
                                            {chatAllItems.unpinned.map(task => {
                                                const isUnseen = unseenProcessIds?.has(task.id) ?? false;
                                                const hasDraft = !!getDraft(task.id);
                                                const isRunning = running.some(t => t.id === task.id);
                                                return (
                                                    <SwipeableHistoryItem key={task.id} isMobile={isMobile} onArchive={() => onArchiveChat(task.id)} onUnarchive={() => onUnarchiveChat(task.id)}>
                                                    <Card
                                                        className={cn(
                                                            'p-2 cursor-pointer',
                                                            isSelected(task.id) && 'ring-2 ring-[#0078d4]'
                                                        )}
                                                        onClick={() => onSelectTask(task.id, task)}
                                                        onContextMenu={e => handleTaskContextMenu(e, task.id, isRunning ? 'running' : 'completed')}
                                                        data-task-id={task.id}
                                                    >
                                                        <div className="flex items-center justify-between gap-1.5 text-xs">
                                                            <span className="flex items-center gap-1 min-w-0 truncate">
                                                                {isUnseen && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]" />}
                                                                {!isRunning && task.status === 'failed' && <span className="shrink-0">❌</span>}
                                                                <span className={cn('truncate', isUnseen && 'font-semibold')} title={getChatTitle(task)}>{getChatTitle(task)}</span>
                                                                {hasDraft && <span className="shrink-0 text-[10px] text-[#848484]" title="Unsent draft" data-testid="draft-badge">✏️</span>}
                                                                {(() => { const cat = getSessionCategory(task); const m = cat ? SESSION_CATEGORY_LABELS[cat] : undefined; return m ? <span className={cn("shrink-0 text-[10px] font-medium", m.color)} data-testid="session-category-badge">{m.icon}</span> : null; })()}
                                                            </span>
                                                            <span className="text-[10px] text-[#848484] dark:text-[#999] shrink-0 whitespace-nowrap tabular-nums">
                                                                {isRunning ? <span className="inline-flex items-center gap-1" data-testid="thinking-indicator"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#0078d4] animate-pulse" />{statusLabel('running', task.type)}</span> : (task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt) ? formatRelativeTime(new Date(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt).toISOString()) : ''}
                                                            </span>
                                                        </div>
                                                        {(() => { const p = getTaskPromptPreview(task); return p ? <div className={cn('text-[10px] mt-0.5 truncate', isUnseen ? 'text-[#1e1e1e] dark:text-[#cccccc]' : 'text-[#848484] dark:text-[#999]')} title={p}>{p}</div> : null; })()}
                                                    </Card>
                                                    </SwipeableHistoryItem>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {chatAllItems.unpinned.length === 0 && chatAllItems.pinned.length === 0 && !searchQuery && (
                                    <div className="text-center text-xs text-[#848484] py-4">No chat sessions yet</div>
                                )}
                                {chatAllItems.unpinned.length === 0 && chatAllItems.pinned.length === 0 && chatAllItems.archived.length === 0 && searchQuery && (
                                    <div className="text-center text-xs text-[#848484] py-4" data-testid="chat-search-empty-state">No chats matching &ldquo;{searchQuery}&rdquo;</div>
                                )}
                                {chatAllItems.archived.length > 0 && (
                                    <div>
                                        <button
                                            className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors mb-1"
                                            onClick={() => setShowArchived(!showArchived)}
                                            data-testid="chat-archived-toggle"
                                        >
                                            {showArchived ? '▼' : '▶'} 📦 Archived ({chatAllItems.archived.length})
                                        </button>
                                        {showArchived && (
                                            <div className="flex flex-col gap-1">
                                                {chatAllItems.archived.map(task => (
                                                    <SwipeableHistoryItem key={task.id} isMobile={isMobile} onUnarchive={() => onUnarchiveChat(task.id)} isArchived>
                                                    <Card
                                                        className={cn('p-2 cursor-pointer opacity-60', isSelected(task.id) && 'ring-2 ring-[#0078d4]')}
                                                        onClick={() => onSelectTask(task.id, task)}
                                                        onContextMenu={e => handleTaskContextMenu(e, task.id, 'completed')}
                                                        data-task-id={task.id}
                                                        data-archived="true"
                                                    >
                                                        <div className="flex items-center justify-between gap-1.5 text-xs">
                                                            <span className="flex items-center gap-1 min-w-0 truncate">
                                                                <span className="truncate" title={getChatTitle(task)}>{getChatTitle(task)}</span>
                                                                {(() => { const cat = getSessionCategory(task); const m = cat ? SESSION_CATEGORY_LABELS[cat] : undefined; return m ? <span className={cn("shrink-0 text-[10px] font-medium", m.color)} data-testid="session-category-badge">{m.icon}</span> : null; })()}
                                                            </span>
                                                            <span className="text-[10px] text-[#848484] dark:text-[#999] shrink-0 whitespace-nowrap tabular-nums">
                                                                {(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt) ? formatRelativeTime(new Date(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt).toISOString()) : ''}
                                                            </span>
                                                        </div>
                                                        {(() => { const p = getTaskPromptPreview(task); return p ? <div className="text-[10px] mt-0.5 truncate text-[#848484] dark:text-[#999]" title={p}>{p}</div> : null; })()}
                                                    </Card>
                                                    </SwipeableHistoryItem>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}

                {/* ── Tasks tab: queue-style sections ── */}
                {activeTab !== 'chats' && (<>
                {isPaused && (
                    <div className="rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 px-3 py-1.5 text-xs flex items-center gap-2" data-testid="queue-paused-banner">
                        <span className="flex-1">
                            {pauseReason
                                ? <>⏸ Queue paused — <strong>{pauseReason.displayName}</strong> failed at {new Date(pauseReason.failedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</>
                                : <>⏸ Queue is paused — new tasks will not start.</>
                            }
                        </span>
                        {pauseReason && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onSelectTask(pauseReason.taskId)}
                                data-testid="queue-banner-view-task-btn"
                            >
                                View Task
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" disabled={isPauseResumeLoading} onClick={onPauseResume} data-testid="queue-banner-resume-btn">
                            ▶ Resume
                        </Button>
                    </div>
                )}
                {isAutopilotPaused && (
                    <div
                        className="rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-1.5 text-xs flex items-center gap-2"
                        data-testid="autopilot-paused-banner"
                    >
                        <span className="flex-1">🤖⏸ Autopilot is paused — queued autopilot tasks will not start.</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={isAutopilotPauseLoading}
                            onClick={onPauseResumeAutopilot}
                            data-testid="autopilot-banner-resume-btn"
                        >
                            🤖▶ Resume
                        </Button>
                    </div>
                )}
                <div className={cn('flex items-center gap-2 mb-3')}>
                    {availableFilters.length >= 1 && (
                        <FilterDropdown
                            items={availableFilters}
                            excludedValues={excludedTypes}
                            onChange={setExcludedTypes}
                            data-testid="queue-filter-dropdown"
                        />
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
                        {!isRefreshing && (
                            <span className={(isAdmitting || isTaskSubmitting) ? 'inline-block animate-spin' : 'inline-block'}>
                                ↺
                            </span>
                        )}
                    </Button>
                    <div
                        className="flex items-center text-xs rounded border border-[#e0e0e0] dark:border-[#474749] overflow-hidden"
                        data-testid="pause-toggle-group"
                    >
                        <button
                            disabled={isPauseResumeLoading}
                            onClick={onPauseResume}
                            title={isPaused ? 'Resume all tasks' : 'Pause all tasks'}
                            data-testid="repo-pause-resume-btn"
                            className={cn(
                                'flex items-center gap-1 px-2 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                                isPaused
                                    ? 'bg-[#0078d4]/10 text-[#0078d4] dark:bg-[#0078d4]/20'
                                    : 'text-[#606060] dark:text-[#9d9d9d] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            )}
                        >
                            {isPaused ? '▶' : '⏸'} All
                        </button>
                        {onPauseResumeAutopilot && (
                            <>
                                <div className="w-px self-stretch bg-[#e0e0e0] dark:bg-[#474749]" />
                                <button
                                    disabled={isAutopilotPauseLoading}
                                    onClick={onPauseResumeAutopilot}
                                    title={isAutopilotPaused ? 'Resume autopilot tasks' : 'Pause autopilot tasks'}
                                    data-testid="autopilot-pause-resume-btn"
                                    className={cn(
                                        'flex items-center gap-1 px-2 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                                        isAutopilotPaused
                                            ? 'bg-[#0078d4]/10 text-[#0078d4] dark:bg-[#0078d4]/20'
                                            : 'text-[#606060] dark:text-[#9d9d9d] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                                    )}
                                >
                                    {isAutopilotPaused ? '▶' : '⏸'} AP
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {((!activeTab || activeTab === 'tasks') ? searchVisible : true) && (
                    <div className="flex items-center gap-1.5 px-1 py-1 rounded border border-[#e0e0e0] dark:border-[#474749] bg-[#fafafa] dark:bg-[#1e1e1e] text-xs">
                        <span className="text-[#848484]">🔍</span>
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search all conversations…"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="flex-1 bg-transparent outline-none text-xs placeholder:text-[#848484]"
                            data-testid="queue-search-input"
                        />
                        {searchLoading && (
                            <span className="text-[#848484] animate-pulse" data-testid="search-loading-indicator">⏳</span>
                        )}
                        {searchQuery && !searchLoading && (
                            <span className="text-[#848484] tabular-nums" data-testid="search-result-count">
                                {isServerSearchActive
                                    ? searchTotal ?? 0
                                    : tabFilteredRunning.length + tabFilteredQueued.filter((t: any) => t.kind !== 'pause-marker').length + tabFilteredHistory.length}
                            </span>
                        )}
                        <button
                            className="text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] leading-none"
                            onClick={() => { setSearchQuery(''); if (!activeTab || activeTab === 'tasks') setSearchVisible(false); }}
                            data-testid="queue-search-close"
                        >✕</button>
                    </div>
                )}

                {tabFilteredRunning.length > 0 && (
                    <div>
                        <button
                            className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors mb-1"
                            onClick={() => setShowRunning(!showRunning)}
                            data-testid="running-tasks-section-toggle"
                        >
                            {showRunning ? '▼' : '▶'} Running Tasks <span className="text-[10px]">({tabFilteredRunning.length})</span>
                        </button>
                        {showRunning && (
                            <div className={cn("flex flex-col", isDense ? "gap-0.5" : "gap-1")}>
                                {tabFilteredRunning.map(task => (
                                    <QueueTaskItem
                                        key={task.id}
                                        task={task}
                                        status="running"
                                        now={now}
                                        selected={isSelected(task.id)}
                                        isPinned={pinnedChatIds?.has(task.id) ?? false}
                                        isAutopilotPaused={isAutopilotPaused}
                                        dense={isDense}
                                        onClick={() => onSelectTask(task.id, task)}
                                        onContextMenu={e => handleTaskContextMenu(e, task.id, 'running')}
                                        onLongPress={(x, y) => handleTaskContextMenu({ clientX: x, clientY: y, preventDefault: () => {}, stopPropagation: () => {}, shiftKey: false } as any, task.id, 'running')}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tabFilteredQueued.length > 0 && (
                    <div>
                        <button
                            className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors mb-1"
                            onClick={() => setShowQueued(!showQueued)}
                            data-testid="queued-tasks-section-toggle"
                        >
                            {showQueued ? '▼' : '▶'} Queued Tasks <span className="text-[10px]">({tabFilteredQueued.filter((t: any) => t.kind !== 'pause-marker').length})</span>
                        </button>
                        {showQueued && (
                            <div className={cn("flex flex-col", isDense ? "gap-0.5" : "gap-1")}>
                                {!isMobile && (
                                    <PauseInsertZone
                                        index={-1}
                                        active={insertingPauseAt === -1}
                                        onMouseEnter={() => setInsertingPauseAt(-1)}
                                        onMouseLeave={() => setInsertingPauseAt(null)}
                                        onClick={() => handleInsertPauseMarker(-1)}
                                    />
                                )}
                                {tabFilteredQueued.map((item: any, index: number) => {
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
                                                    selected={isSelected(item.id)}
                                                    isAutopilotPaused={isAutopilotPaused}
                                                    dense={isDense}
                                                    onClick={() => onSelectTask(item.id, item)}
                                                    onContextMenu={e => handleTaskContextMenu(e, item.id, 'queued')}
                                                    onLongPress={(x, y) => handleTaskContextMenu({ clientX: x, clientY: y, preventDefault: () => {}, stopPropagation: () => {}, shiftKey: false } as any, item.id, 'queued')}
                                                    cancelLongPress={!!activeDraggedTaskId}
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
                        )}
                    </div>
                )}

                {isServerSearchActive ? (
                    /* ── Server-side search results ── */
                    <div>
                        <div className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium mb-1">
                            🔍 Search Results
                            <span className="text-[10px]">({searchResults!.length}{searchTotal != null && searchTotal > searchResults!.length ? ` of ${searchTotal}` : ''})</span>
                        </div>
                        {searchQuery.length === 1 && (
                            <div className="text-[10px] text-[#848484] dark:text-[#bbb] italic" data-testid="search-min-chars-hint">
                                Type 2+ characters to search all conversations
                            </div>
                        )}
                        {searchResults!.length === 0 && !searchLoading && (
                            <div className="text-[10px] text-[#848484] dark:text-[#bbb]" data-testid="search-no-results">
                                No matching conversations found
                            </div>
                        )}
                        <div className={cn("flex flex-col mt-1", isDense ? "gap-0.5" : "gap-1")}>
                            {searchResults!.map(task => (
                                <Card
                                    key={task.id}
                                    className={cn(
                                        isDense ? "px-2 py-2.5 md:py-1 cursor-pointer" : "p-2 cursor-pointer",
                                        isSelected(task.id) && "ring-2 ring-[#0078d4]"
                                    )}
                                    onClick={() => onSelectTask(task.id, task)}
                                    data-task-id={task.id}
                                    data-testid="search-result-item"
                                >
                                    <div className="flex items-center justify-between gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                                        <span className="flex items-center gap-1 min-w-0 truncate">
                                            <span className="shrink-0">
                                                {getTaskTypeIcon(task)}{task.status === 'completed' ? ' ✅' : task.status === 'failed' ? ' ❌' : task.status === 'cancelled' ? ' 🚫' : ''}
                                            </span>
                                            <span className="truncate" title={task.displayName || task.title || task.type || 'Task'}>
                                                {task.displayName || task.title || task.type || 'Task'}
                                            </span>
                                        </span>
                                        <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                                            {(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt) ? formatRelativeTime(new Date(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt).toISOString()) : ''}
                                        </span>
                                    </div>
                                    {!isDense && task._searchSnippet && (
                                        <div
                                            className="text-[10px] mt-0.5 truncate text-[#848484] dark:text-[#bbb] [&_mark]:bg-yellow-200 [&_mark]:dark:bg-yellow-700/50 [&_mark]:text-inherit [&_mark]:rounded-sm [&_mark]:px-px"
                                            data-testid="search-snippet"
                                            dangerouslySetInnerHTML={{ __html: task._searchSnippet }}
                                        />
                                    )}
                                    {!isDense && !task._searchSnippet && (() => { const p = getTaskPromptPreview(task); return p ? <div className="text-[10px] mt-0.5 truncate text-[#848484] dark:text-[#bbb]" title={p}>{p}</div> : null; })()}
                                </Card>
                            ))}
                        </div>
                        {searchHasMore && onLoadMoreSearchResults && (
                            <div className="px-4 py-2">
                                <button
                                    onClick={onLoadMoreSearchResults}
                                    disabled={searchLoadingMore}
                                    className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                                    data-testid="search-load-more-btn"
                                >
                                    {searchLoadingMore ? 'Loading…' : 'Load more results'}
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    /* ── Normal history view (pinned + unpinned + archived + load more) ── */
                    <>
                {(filteredPinned.length > 0 || pinnedRunningCount > 0) && (
                    <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <button
                                className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                                onClick={() => setShowPinned(!showPinned)}
                                data-testid="pinned-chats-section-toggle"
                            >
                                {showPinned ? '▼' : '▶'} 📌 Pinned ({filteredPinned.length + pinnedRunningCount})
                                {unseenProcessIds && (() => {
                                    const count = filteredPinned.filter(t => unseenProcessIds.has(t.id)).length;
                                    return count > 0 ? (
                                        <span className="ml-1 text-[9px] bg-[#0078d4] text-white px-1.5 py-px rounded-full" data-testid="unseen-pinned-count-badge">{count}</span>
                                    ) : null;
                                })()}
                            </button>
                            {onMarkAllRead && unseenProcessIds && filteredPinned.some(t => unseenProcessIds.has(t.id)) && (
                                <button
                                    className="text-[10px] text-[#0078d4] dark:text-[#3794ff] hover:underline transition-colors"
                                    onClick={() => onMarkAllRead(filteredPinned)}
                                    data-testid="mark-all-read-pinned-btn"
                                >
                                    Mark all read
                                </button>
                            )}
                        </div>
                        {showPinned && (
                            <div className={cn("flex flex-col", isDense ? "gap-0.5" : "gap-1")}>
                                {filteredPinned.map(task => {
                                    const isUnseen = unseenProcessIds?.has(task.id) ?? false;
                                    const hasPinnedDraft = !!getDraft(task.id);
                                    const isHistorySelected = selectedHistoryIds.has(task.id);
                                    return (
                                        <SwipeableHistoryItem key={task.id} isMobile={isMobile} onArchive={() => onArchiveChat(task.id)} onUnarchive={() => onUnarchiveChat(task.id)}>
                                        <Card
                                            className={cn(
                                                isDense ? "px-2 py-2.5 md:py-1 cursor-pointer border-l-2 border-l-amber-400 dark:border-l-amber-500" : "p-2 cursor-pointer border-l-2 border-l-amber-400 dark:border-l-amber-500",
                                                isHistorySelected
                                                    ? "bg-[#0078d4]/10 dark:bg-[#3794ff]/10 outline outline-1 outline-[#0078d4]/40 dark:outline-[#3794ff]/40"
                                                    : isSelected(task.id) && "ring-2 ring-[#0078d4]",
                                                selectedHistoryIds.size > 0 && "select-none"
                                            )}
                                            onClick={e => {
                                                if (historyLongPress.didLongPress()) return;
                                                handleHistoryItemClick(e, task, filteredPinned);
                                            }}
                                            onContextMenu={e => handleTaskContextMenu(e, task.id, 'completed')}
                                            onTouchStart={e => { historyLongPressTaskRef.current = task.id; historyLongPress.onTouchStart(e); }}
                                            onTouchEnd={historyLongPress.onTouchEnd}
                                            onTouchMove={historyLongPress.onTouchMove}
                                            data-task-id={task.id}
                                            data-pinned="true"
                                            data-unseen={isUnseen || undefined}
                                            data-selected={isHistorySelected || undefined}
                                        >
                                            <div className="flex items-center justify-between gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                                                <span className="flex items-center gap-1 min-w-0 truncate">
                                                    {isHistorySelected && <span className="shrink-0 text-[#0078d4] dark:text-[#3794ff] text-[10px]" data-testid="selection-checkbox">☑</span>}
                                                    {isUnseen && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]" data-testid="unseen-dot" />}
                                                    <span className="shrink-0">
                                                        {getTaskTypeIcon(task)}{task.status === 'completed' ? ' ✅' : task.status === 'failed' ? ' ❌' : task.status === 'cancelled' ? ' 🚫' : ''}
                                                    </span>
                                                    <span className={cn("truncate", isUnseen && "font-semibold")} title={task.displayName || task.title || task.type || 'Task'}>
                                                        {task.displayName || task.title || task.type || 'Task'}
                                                    </span>
                                                    {hasPinnedDraft && <span className="shrink-0 text-[10px] text-[#848484] dark:text-[#bbb]" title="Unsent draft" data-testid="draft-badge">✏️</span>}
                                                </span>
                                                <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                                                    {(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt) ? formatRelativeTime(new Date(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt).toISOString()) : ''}
                                                </span>
                                            </div>
                                            {!isDense && (() => { const p = getTaskPromptPreview(task); return p ? <div className={cn("text-[10px] mt-0.5 truncate", isUnseen ? "text-[#1e1e1e] dark:text-[#cccccc]" : "text-[#848484] dark:text-[#bbb]")} title={p}>{p}</div> : null; })()}
                                            {!isDense && task.error && (
                                                <div className="text-[10px] text-red-500 mt-0.5 truncate">
                                                    {task.error.length > 80 ? task.error.substring(0, 77) + '...' : task.error}
                                                </div>
                                            )}
                                        </Card>
                                        </SwipeableHistoryItem>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {filteredUnpinned.length > 0 && (
                    <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <button
                                className="flex items-center gap-1 min-w-0 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                                onClick={() => { setShowHistory(!showHistory); setSelectedHistoryIds(new Set()); setAnchorHistoryId(null); }}
                            >
                                {showHistory ? '▼' : '▶'} Completed Tasks ({filteredUnpinned.length})
                                {unseenProcessIds && (() => {
                                    const count = filteredUnpinned.filter(t => unseenProcessIds.has(t.id)).length;
                                    return count > 0 ? (
                                        <span className="ml-1 text-[9px] bg-[#0078d4] text-white px-1.5 py-px rounded-full" data-testid="unseen-count-badge">{count}</span>
                                    ) : null;
                                })()}
                            </button>
                            {onMarkAllRead && unseenProcessIds && filteredUnpinned.some(t => unseenProcessIds.has(t.id)) && (
                                <button
                                    className="text-[10px] text-[#0078d4] dark:text-[#3794ff] hover:underline transition-colors"
                                    onClick={() => onMarkAllRead(filteredUnpinned)}
                                    data-testid="mark-all-read-btn"
                                >
                                    Mark all read
                                </button>
                            )}
                            {selectedHistoryIds.size >= 2 && (
                                <span className="inline-flex items-center gap-1 text-[10px] bg-[#0078d4]/15 text-[#0078d4] dark:bg-[#3794ff]/15 dark:text-[#3794ff] px-2 py-0.5 rounded-full" data-testid="selection-count-pill">
                                    {selectedHistoryIds.size} selected
                                    <button className="leading-none hover:text-red-500" onClick={() => { setSelectedHistoryIds(new Set()); setAnchorHistoryId(null); }} data-testid="selection-clear-btn">✕</button>
                                </span>
                            )}
                        </div>
                        {showHistory && (
                            <div className={cn("flex flex-col mt-1", isDense ? "gap-0.5" : "gap-1")}>
                                {groupedUnpinned ? groupedUnpinned.map(entry => {
                                    if (entry.kind === 'group') {
                                        // Expanded by default if group has unseen items; user toggle overrides
                                        const expanded = !collapsedGroups.has(entry.planFilePath);
                                        return (
                                            <div key={entry.planFilePath} data-testid="history-group">
                                                <HistoryGroupHeader
                                                    group={entry}
                                                    isExpanded={expanded}
                                                    onToggle={() => toggleGroup(entry.planFilePath)}
                                                    onContextMenu={e => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        const ids = entry.children.map(c => c.id);
                                                        setSelectedHistoryIds(new Set(ids));
                                                        setContextMenu({ x: e.clientX, y: e.clientY, taskId: ids[0], taskStatus: 'completed', bulkIds: ids });
                                                    }}
                                                    isDense={isDense}
                                                />
                                                {expanded && (
                                                    <div className={cn("flex flex-col pl-4 border-l-2 border-gray-200 dark:border-gray-700 ml-1", isDense ? "gap-0.5 mt-0.5" : "gap-1 mt-1")}>
                                                        {entry.children.map(task => renderHistoryCard(task))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }
                                    return renderHistoryCard(entry);
                                }) : filteredUnpinned.map(task => renderHistoryCard(task))}
                            </div>
                        )}
                    </div>
                )}
            {filteredArchived.length > 0 && (
                <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors"
                            onClick={() => setShowArchived(!showArchived)}
                            data-testid="archived-chats-section-toggle"
                        >
                            {showArchived ? '▼' : '▶'} 📦 Archived ({filteredArchived.length})
                            {unseenProcessIds && (() => {
                                const count = filteredArchived.filter(t => unseenProcessIds.has(t.id)).length;
                                return count > 0 ? (
                                    <span className="ml-1 text-[9px] bg-[#0078d4] text-white px-1.5 py-px rounded-full" data-testid="unseen-archived-count-badge">{count}</span>
                                ) : null;
                            })()}
                        </button>
                        {onMarkAllRead && unseenProcessIds && filteredArchived.some(t => unseenProcessIds.has(t.id)) && (
                            <button
                                className="text-[10px] text-[#0078d4] dark:text-[#3794ff] hover:underline transition-colors"
                                onClick={() => onMarkAllRead(filteredArchived)}
                                data-testid="mark-all-read-archived-btn"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>
                    {showArchived && (
                        <div className={cn("flex flex-col", isDense ? "gap-0.5" : "gap-1")}>
                            {filteredArchived.map(task => {
                                const isUnseen = unseenProcessIds?.has(task.id) ?? false;
                                return (
                                    <SwipeableHistoryItem key={task.id} isMobile={isMobile} onUnarchive={() => onUnarchiveChat(task.id)} isArchived>
                                    <Card
                                        className={cn(
                                            isDense ? "px-2 py-2.5 md:py-1 cursor-pointer opacity-70" : "p-2 cursor-pointer opacity-70",
                                            isSelected(task.id) && "ring-2 ring-[#0078d4]"
                                        )}
                                        onClick={() => {
                                            if (historyLongPress.didLongPress()) return;
                                            onSelectTask(task.id, task);
                                        }}
                                        onContextMenu={e => handleTaskContextMenu(e, task.id, 'completed')}
                                        onTouchStart={e => { historyLongPressTaskRef.current = task.id; historyLongPress.onTouchStart(e); }}
                                        onTouchEnd={historyLongPress.onTouchEnd}
                                        onTouchMove={historyLongPress.onTouchMove}
                                        data-task-id={task.id}
                                        data-archived="true"
                                    >
                                        <div className="flex items-center justify-between gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                                            <span className="flex items-center gap-1 min-w-0 truncate">
                                                {isUnseen && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]" data-testid="unseen-dot" />}
                                                <span className="shrink-0">
                                                    {getTaskTypeIcon(task)}{task.status === 'completed' ? ' ✅' : task.status === 'failed' ? ' ❌' : task.status === 'cancelled' ? ' 🚫' : ''}
                                                </span>
                                                <span className={cn("truncate", isUnseen && "font-semibold")} title={task.displayName || task.title || task.type || 'Task'}>
                                                    {task.displayName || task.title || task.type || 'Task'}
                                                </span>
                                            </span>
                                            <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                                                {(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt) ? formatRelativeTime(new Date(task.completedAt ?? task.endTime ?? task.startedAt ?? task.startTime ?? task.createdAt).toISOString()) : ''}
                                            </span>
                                        </div>
                                        {!isDense && (() => { const p = getTaskPromptPreview(task); return p ? <div className={cn("text-[10px] mt-0.5 truncate", isUnseen ? "text-[#1e1e1e] dark:text-[#cccccc]" : "text-[#848484] dark:text-[#bbb]")} title={p}>{p}</div> : null; })()}
                                    </Card>
                                    </SwipeableHistoryItem>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            {hasMore && onLoadMore && (
                <div className="px-4 py-2">
                    <button
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                        data-testid="activity-load-more-btn"
                    >
                        {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
                    </>
                )}
                </>)}
        </div>
        {contextMenu && (
            <ContextMenu
                position={{ x: contextMenu.x, y: contextMenu.y }}
                items={contextMenuItems}
                onClose={closeContextMenu}
            />
        )}
        <SummarizeChatDialog
            open={summarizeDialogOpen}
            chatCount={summarizeDialogIds.length}
            onClose={() => setSummarizeDialogOpen(false)}
            onConfirm={async (userPrompt) => {
                const res = await fetch(getApiBase() + '/queue/summarize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ processIds: summarizeDialogIds, workspaceId, userPrompt: userPrompt || undefined }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || `Request failed (${res.status})`);
                }
                const data = await res.json();
                setSummarizeDialogOpen(false);
                if (data.task?.id) {
                    onSelectTask(data.task.id);
                }
                fetchQueue();
            }}
        />
        <RenameDialog
            open={!!renameTarget}
            currentTitle={renameTarget?.title ?? ''}
            onConfirm={handleRenameConfirm}
            onCancel={() => setRenameTarget(null)}
        />
        {isMobile && onNewChat && (
            <button
                className="mobile-fab"
                onClick={onNewChat}
                data-testid="mobile-new-chat-fab"
                aria-label="New chat"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
            </button>
        )}
    </>
    );
}

export function QueueTaskItem({ task, status, now, selected, isPinned, isAutopilotPaused, dense, onClick, onContextMenu, onLongPress, cancelLongPress }: {
    task: any;
    status: 'running' | 'queued';
    now: number;
    selected?: boolean;
    isPinned?: boolean;
    isAutopilotPaused?: boolean;
    dense?: boolean;
    onClick?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onLongPress?: (x: number, y: number) => void;
    cancelLongPress?: boolean;
}){
    const name = task.displayName || task.type || 'Task';
    const icon = getTaskTypeIcon(task);
    const promptPreview = getTaskPromptPreview(task);
    const showProgress = task.type === 'run-workflow' && status === 'running' && !task.payload?.workItemId;
    const progress = useWorkflowProgress(showProgress ? (task.processId || task.id) : null);
    const hasDraft = !!getDraft(task.id);
    const isHeld = isAutopilotPaused === true
        && status === 'queued'
        && task.payload?.mode === 'autopilot'
        && !task.admitted;
    const isAdmitted = isAutopilotPaused === true
        && status === 'queued'
        && task.payload?.mode === 'autopilot'
        && !!task.admitted;
    let elapsed = '';
    if (status === 'running' && task.startedAt) {
        elapsed = formatDuration(now - new Date(task.startedAt).getTime());
    } else if (task.createdAt) {
        elapsed = formatRelativeTime(new Date(task.createdAt).toISOString());
    }

    const longPress = useLongPress(
        onLongPress ?? (() => {}),
        { cancelSignal: cancelLongPress },
    );

    const handleClick = () => {
        if (longPress.didLongPress()) return;
        onClick?.();
    };

    return (
        <Card
            className={cn(dense ? "px-2 py-2.5 md:py-1 cursor-pointer" : "p-2 cursor-pointer", selected && "ring-2 ring-[#0078d4]", task.frozen && "task-frozen", isPinned && "border-l-2 border-l-amber-400 dark:border-l-amber-500", isHeld && !isPinned && "border-l-2 border-l-amber-500 dark:border-l-amber-400 opacity-60", isAdmitted && !isPinned && "border-l-2 border-l-green-500 dark:border-l-green-400")}
            onClick={handleClick}
            onContextMenu={onContextMenu}
            onTouchStart={longPress.onTouchStart}
            onTouchEnd={longPress.onTouchEnd}
            onTouchMove={longPress.onTouchMove}
            data-task-id={task.id}
        >
            <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] min-w-0">
                    <span className="shrink-0">{task.frozen ? '❄️' : isAdmitted ? '🚀' : isHeld ? '🤖⏸' : icon}</span>
                    <span className="truncate" title={name}>{name}</span>
                    {isPinned && <span className="shrink-0 text-[10px]" data-testid="running-pin-badge">📌</span>}
                    {isHeld && (
                        <span
                            className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400 font-medium"
                            data-testid="held-badge"
                        >
                            [held]
                        </span>
                    )}
                    {isAdmitted && (
                        <span
                            className="shrink-0 text-[10px] text-green-600 dark:text-green-400 font-medium"
                            data-testid="admitted-badge"
                        >
                            [scheduled]
                        </span>
                    )}
                    {hasDraft && <span className="shrink-0 text-[10px] text-[#848484] dark:text-[#bbb]" title="Unsent draft" data-testid="draft-badge">✏️</span>}
                </div>
                {elapsed && (
                    <span className="text-[10px] text-[#848484] dark:text-[#bbb] shrink-0 whitespace-nowrap tabular-nums">
                        {elapsed}
                    </span>
                )}
            </div>
            {!dense && promptPreview && (
                <div className="text-[10px] text-[#848484] dark:text-[#bbb] mt-0.5 truncate" title={promptPreview}>{promptPreview}</div>
            )}
            {!dense && showProgress && progress && progress.total > 0 && (
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
