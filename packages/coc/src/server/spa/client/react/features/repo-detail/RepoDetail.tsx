/**
 * RepoDetail — right panel showing sub-tabs for the selected repo.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useWorkItems, loadUnseenWorkItemIds } from '../../contexts/WorkItemContext';
import { useUiLayoutMode } from '../../hooks/preferences/useUiLayoutMode';
import { Button, cn } from '../../ui';
import { getRepoDisplayName } from './RepoTabStrip';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { RepoInfoTab } from './RepoInfoTab';
import { TemplatesTab } from '../templates/TemplatesTab';
import { RepoChatTab } from '../chat/RepoChatTab';
import { RepoSchedulesTab } from '../schedules/RepoSchedulesTab';
import { RepoGitTab } from '../git/RepoGitTab';
import { RepoWikiTab } from './RepoWikiTab';
import { RepoSettingsTab } from '../repo-settings/RepoSettingsTab';
import { ExplorerPanel } from './explorer/ExplorerPanel';
import { PullRequestsTab } from '../pull-requests/PullRequestsTab';
import { WorkItemsTab } from '../work-items/WorkItemsTab';
import { WorkflowDetailView } from '../../processes/dag';
import { TerminalView } from '../terminal/TerminalView';
import { NotesView } from '../notes/NotesView';
import { DreamsPanel } from '../dreams/DreamsPanel';
import { NativeCliSessionsPanel } from '../native-copilot-sessions/NativeCopilotSessionsPanel';
import { AddRepoDialog } from '../../repos/AddRepoDialog';
import { ErrorBoundary } from '../../ui/ErrorBoundary';

import { GenerateTaskDialog } from '../../tasks/GenerateTaskDialog';
import { TasksPanel } from '../../tasks/TasksPanel';
import { fetchApi } from '../../hooks/useApi';
import { getSpaCocClient } from '../../api/cocClient';
import { useRepoQueueStats } from '../../queue/hooks/useRepoQueueStats';
import { useGitInfo } from '../git/hooks/useGitInfo';
import { useTerminalEnabled } from '../../hooks/feature-flags/useTerminalEnabled';
import { useNotesEnabled } from '../notes/hooks/useNotesEnabled';
import { useWorkflowsEnabled } from '../../hooks/feature-flags/useWorkflowsEnabled';
import { usePullRequestsEnabled } from '../../hooks/feature-flags/usePullRequestsEnabled';
import { useDreamsEnabled } from '../../hooks/feature-flags/useDreamsEnabled';
import { useNativeCliSessionsEnabled } from '../../hooks/feature-flags/useNativeCliSessionsEnabled';
import { MobileTabBar } from '../../layout/MobileTabBar';
import { buildRepoSubTabSuffix } from '../../layout/Router';
import { SHOW_WIKI_TAB } from '../../layout/TopBar';
import type { RepoData } from '../../repos/repoGrouping';
import type { RepoSubTab, TasksPanelNavState } from '../../types/dashboard';
import { isSessionContextAttachmentsEnabled } from '../../utils/config';
import {
    dataTransferHasSessionContext,
    readSessionContextDropPayload,
    useConversationRetrievalCapability,
    validateSessionContextDrop,
} from '../chat/sessionContextDrop';

interface RepoDetailProps {
    repo: RepoData;
    repos: RepoData[];
    onRefresh: () => void;
}

export const SUB_TABS: { key: RepoSubTab; label: string; shortcut?: string }[] = [
    { key: 'chats', label: 'Chats', shortcut: 'Alt+A' },
    { key: 'git', label: 'Git', shortcut: 'Alt+G' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'work-items', label: 'Work Items', shortcut: 'Alt+I' },
    { key: 'dreams', label: 'Dreams', shortcut: 'Alt+D' },
    { key: 'cli-sessions', label: 'CLI Sessions' },
    { key: 'pull-requests', label: 'Pull Requests', shortcut: 'Alt+R' },
    { key: 'explorer', label: 'Explorer', shortcut: 'Alt+E' },
    { key: 'workflows', label: 'Workflows', shortcut: 'Alt+W' },
    { key: 'schedules', label: 'Schedules', shortcut: 'Alt+S' },
    { key: 'tasks', label: 'Tasks (Dep.)', shortcut: 'Alt+T' },
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
    { key: 'settings', label: 'Settings', shortcut: 'Alt+C' },
    { key: 'wiki', label: 'Wiki' },
];

/** Tabs actually rendered in the UI — wiki is hidden behind a feature flag. */
export const VISIBLE_SUB_TABS = SHOW_WIKI_TAB
    ? SUB_TABS
    : SUB_TABS.filter(t => t.key !== 'wiki');

/**
 * Logical group buckets for the desktop tab strip — used to render thin
 * vertical dividers between adjacent tabs that belong to different groups.
 * Group identity is purely visual and does not affect functionality.
 */
const TAB_GROUP_INDEX: Record<string, number> = {
    'chats': 1, 'activity': 1, 'git': 1, 'terminal': 1,
    'work-items': 2, 'dreams': 2, 'cli-sessions': 2, 'copilot-sessions': 2, 'pull-requests': 2, 'tasks': 2,
    'explorer': 3, 'workflows': 3, 'schedules': 3,
    'notes': 4, 'settings': 4, 'wiki': 4,
};

export function RepoDetail({ repo, repos, onRefresh }: RepoDetailProps) {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { isMobile } = useBreakpoint();
    const [editOpen, setEditOpen] = useState(false);
    const [generateDialog, setGenerateDialog] = useState<{
        open: boolean;
        minimized: boolean;
        targetFolder: string | undefined;
    }>({ open: false, minimized: false, targetFolder: undefined });
    const [uiLayoutMode, setUiLayoutMode] = useUiLayoutMode();
    const ws = repo.workspace;
    const tasksNavStateKey = `${ws.id}::tasks`;
    const color = ws.color || '#848484';
    const activeSubTab = state.activeRepoSubTab;
    const taskCount = repo.taskCount || 0;

    // Track which secondary sub-tabs have ever been visible for this workspace,
    // so we only mount their (often slow) data-fetching hooks on first activation
    // rather than for every repo switch. Without this guard, opening any repo
    // would synchronously hammer endpoints like /api/repos/:id/tree,
    // /workspaces/:id/notes/tree, /workspaces/:id/work-items, and the various
    // git endpoints — blocking the Node event loop for many seconds on large
    // repos and starving the chat tab's /queue + /history requests behind them.
    const [visitedSubTabs, setVisitedSubTabs] = useState<Set<string>>(() => new Set(activeSubTab ? [activeSubTab] : []));
    const visitTab = useCallback((tab: string | undefined | null) => {
        if (!tab) return;
        setVisitedSubTabs(prev => {
            if (prev.has(tab)) return prev;
            const next = new Set(prev);
            next.add(tab);
            return next;
        });
    }, []);
    useEffect(() => { visitTab(activeSubTab); }, [activeSubTab, visitTab]);
    const wasVisited = (tab: string): boolean => visitedSubTabs.has(tab);
    const { running: queueRunningCount, queued: queueQueuedCount } = useRepoQueueStats(ws.id);
    const { ahead: gitAhead, behind: gitBehind } = useGitInfo(ws.id);
    const isGitRepo = !!repo.gitInfo?.isGitRepo;
    const terminalEnabled = useTerminalEnabled();
    const notesEnabled = useNotesEnabled();
    const workflowsEnabled = useWorkflowsEnabled();
    const pullRequestsEnabled = usePullRequestsEnabled();
    const dreamsEnabled = useDreamsEnabled();
    const nativeCliSessionsEnabled = useNativeCliSessionsEnabled();
    const sessionContextAttachmentsEnabled = isSessionContextAttachmentsEnabled();
    const canRetrieveConversations = useConversationRetrievalCapability(ws.id, sessionContextAttachmentsEnabled);
    const [headerContextDropTarget, setHeaderContextDropTarget] = useState<'task' | 'ask' | null>(null);
    const [headerContextDropFeedback, setHeaderContextDropFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    // Work items: load for this repo if not yet in context (for badge)
    const { state: workItemState, dispatch: workItemDispatch } = useWorkItems();
    useEffect(() => {
        if (workItemState.workItemsByRepo[ws.id] !== undefined) return;
        fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/work-items?limit=20`)
            .then(data => {
                if (data) {
                    workItemDispatch({ type: 'SET_WORK_ITEMS', repoId: ws.id, items: data.items || [], total: data.total ?? 0, hasMore: data.hasMore ?? false });
                    const ids = loadUnseenWorkItemIds(ws.id);
                    workItemDispatch({ type: 'LOAD_UNSEEN_WORK_ITEMS', repoId: ws.id, ids });
                }
            })
            .catch(() => {});
    }, [ws.id]);
    const unseenWorkItemCount = (workItemState.unseenByRepo[ws.id] || []).length;

    // Track previous feature-flag values so redirects only fire on true→false
    // transitions, not on the initial mount (defense-in-depth for deep links).
    const prevTerminalEnabled = useRef(terminalEnabled);
    const prevNotesEnabled = useRef(notesEnabled);
    const prevWorkflowsEnabled = useRef(workflowsEnabled);
    const prevPullRequestsEnabled = useRef(pullRequestsEnabled);
    const prevDreamsEnabled = useRef(dreamsEnabled);
    const prevNativeCliSessionsEnabled = useRef(nativeCliSessionsEnabled);

    const visibleSubTabs = useMemo(() => {
        let tabs = VISIBLE_SUB_TABS;
        if (!isGitRepo) tabs = tabs.filter(t => t.key !== 'git' && t.key !== 'pull-requests');
        if (!terminalEnabled) tabs = tabs.filter(t => t.key !== 'terminal');
        if (!notesEnabled) tabs = tabs.filter(t => t.key !== 'notes');
        if (!workflowsEnabled) tabs = tabs.filter(t => t.key !== 'workflows');
        if (!pullRequestsEnabled) tabs = tabs.filter(t => t.key !== 'pull-requests');
        if (!dreamsEnabled) tabs = tabs.filter(t => t.key !== 'dreams');
        if (!nativeCliSessionsEnabled) tabs = tabs.filter(t => t.key !== 'cli-sessions' && t.key !== 'copilot-sessions');
        // Layout mode filtering
        if (uiLayoutMode === 'classic') {
            // Classic: replace Chats with Activity, relabel Tasks as Plans
            tabs = tabs
                .map(t => t.key === 'chats' ? { ...t, key: 'activity' as RepoSubTab, label: 'Activity' } : t)
                .map(t => t.key === 'tasks' ? { ...t, label: 'Plans (Dep.)' } : t);
        } else {
            // Dev-workflow: relabel and reorder tabs
            const devWorkflowRelabels: Record<string, string> = {
                'schedules': 'Jobs',
                'pull-requests': 'Full Requests',
            };
            const devWorkflowOrder: RepoSubTab[] = [
                'chats', 'work-items', 'dreams', 'cli-sessions', 'schedules', 'explorer',
                'workflows', 'git', 'terminal', 'pull-requests', 'tasks', 'settings',
            ];
            const tabMap = new Map(tabs.map(t => [t.key, t]));
            const ordered: typeof tabs = [];
            for (const key of devWorkflowOrder) {
                const tab = tabMap.get(key);
                if (tab) {
                    const newLabel = devWorkflowRelabels[key];
                    ordered.push(newLabel ? { ...tab, label: newLabel } : tab);
                    tabMap.delete(key);
                }
            }
            // Append dynamic tabs (notes, wiki) that aren't in the fixed order
            for (const [, tab] of tabMap) {
                ordered.push(tab);
            }
            tabs = ordered;
        }
        return tabs;
    }, [isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled, pullRequestsEnabled, dreamsEnabled, nativeCliSessionsEnabled, uiLayoutMode]);

    // Redirect away from git/pull-requests tab when switching to a non-git repo
    useEffect(() => {
        if ((activeSubTab === 'git' || activeSubTab === 'pull-requests') && !isGitRepo) {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        }
    }, [activeSubTab, isGitRepo, dispatch]);

    // Redirect away from terminal tab only when the feature transitions to disabled
    useEffect(() => {
        if (activeSubTab === 'terminal' && !terminalEnabled && prevTerminalEnabled.current) {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        }
        prevTerminalEnabled.current = terminalEnabled;
    }, [activeSubTab, terminalEnabled, dispatch]);

    // Redirect away from notes tab only when the feature transitions to disabled
    useEffect(() => {
        if (activeSubTab === 'notes' && !notesEnabled && prevNotesEnabled.current) {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        }
        prevNotesEnabled.current = notesEnabled;
    }, [activeSubTab, notesEnabled, dispatch]);

    // Redirect away from workflows tab only when the feature transitions to disabled
    useEffect(() => {
        if (activeSubTab === 'workflows' && !workflowsEnabled && prevWorkflowsEnabled.current) {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        }
        prevWorkflowsEnabled.current = workflowsEnabled;
    }, [activeSubTab, workflowsEnabled, dispatch]);

    // Redirect away from pull-requests tab only when the feature transitions to disabled
    useEffect(() => {
        if (activeSubTab === 'pull-requests' && !pullRequestsEnabled && prevPullRequestsEnabled.current) {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        }
        prevPullRequestsEnabled.current = pullRequestsEnabled;
    }, [activeSubTab, pullRequestsEnabled, dispatch]);

    // Redirect away from dreams tab only when the feature transitions to disabled
    useEffect(() => {
        if (activeSubTab === 'dreams' && !dreamsEnabled && prevDreamsEnabled.current) {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        }
        prevDreamsEnabled.current = dreamsEnabled;
    }, [activeSubTab, dreamsEnabled, dispatch]);

    // Redirect away from CLI sessions tab only when the feature transitions to disabled
    useEffect(() => {
        if ((activeSubTab === 'cli-sessions' || activeSubTab === 'copilot-sessions') && !nativeCliSessionsEnabled && prevNativeCliSessionsEnabled.current) {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        }
        prevNativeCliSessionsEnabled.current = nativeCliSessionsEnabled;
    }, [activeSubTab, nativeCliSessionsEnabled, dispatch]);

    // Redirect when switching layout modes
    useEffect(() => {
        if (uiLayoutMode === 'classic' && activeSubTab === 'chats') {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        } else if (uiLayoutMode === 'dev-workflow' && activeSubTab === 'activity') {
            dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });
        }
    }, [uiLayoutMode, activeSubTab, dispatch]);

    const repoWikis = useMemo(() =>
        state.wikis.filter((w: any) => w.repoPath === ws.rootPath),
        [state.wikis, ws.rootPath]
    );
    const wikiGeneratingCount = repoWikis.filter((w: any) => w.status === 'generating').length;
    const wikiWarningCount = repoWikis.filter((w: any) => w.status === 'error' || w.status === 'pending').length;

    const isRepoPaused = useMemo(() => {
        return !!queueState.repoQueueMap[ws.id]?.stats?.isPaused;
    }, [queueState.repoQueueMap[ws.id]?.stats?.isPaused]);
    const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
    const [isLaunchingCli, setIsLaunchingCli] = useState(false);
    const tabStripRef = useRef<HTMLDivElement>(null);
    const [tabScrollState, setTabScrollState] = useState<{ canScrollLeft: boolean; canScrollRight: boolean }>({ canScrollLeft: false, canScrollRight: false });
    const [overflowOpen, setOverflowOpen] = useState(false);
    const overflowContainerRef = useRef<HTMLDivElement>(null);

    // Track tab strip scroll state for gradient affordance
    const updateTabScrollState = useCallback(() => {
        const el = tabStripRef.current;
        if (!el) return;
        setTabScrollState({
            canScrollLeft: el.scrollLeft > 2,
            canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
        });
    }, []);

    useEffect(() => {
        const el = tabStripRef.current;
        if (!el) return;
        updateTabScrollState();
        el.addEventListener('scroll', updateTabScrollState, { passive: true });
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateTabScrollState) : null;
        ro?.observe(el);
        return () => {
            el.removeEventListener('scroll', updateTabScrollState);
            ro?.disconnect();
        };
    }, [updateTabScrollState]);

    // Auto-scroll active tab into view when sub-tab changes
    useEffect(() => {
        if (!tabStripRef.current) return;
        const activeBtn = tabStripRef.current.querySelector(
            `[data-subtab="${activeSubTab}"]`
        ) as HTMLElement | null;
        if (activeBtn) {
            activeBtn.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center',
            });
        }
    }, [activeSubTab]);

    // Close the action overflow popover when the user clicks outside or hits Escape.
    useEffect(() => {
        if (!overflowOpen) return;
        const onPointerDown = (e: MouseEvent) => {
            if (overflowContainerRef.current && !overflowContainerRef.current.contains(e.target as Node)) {
                setOverflowOpen(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOverflowOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [overflowOpen]);

    useEffect(() => {
        if (!headerContextDropFeedback) return;
        const timer = window.setTimeout(() => setHeaderContextDropFeedback(null), 4000);
        return () => window.clearTimeout(timer);
    }, [headerContextDropFeedback]);

    function setHeaderDropFeedback(type: 'success' | 'error', message: string) {
        setHeaderContextDropFeedback({ type, message });
    }

    function handleHeaderContextDragOver(mode: 'task' | 'ask') {
        return (e: React.DragEvent<HTMLElement>) => {
            e.preventDefault();
            if (sessionContextAttachmentsEnabled && dataTransferHasSessionContext(e.dataTransfer)) {
                e.dataTransfer.dropEffect = 'copy';
                setHeaderContextDropTarget(mode);
                return;
            }
            e.dataTransfer.dropEffect = 'none';
            if (headerContextDropTarget === mode) {
                setHeaderContextDropTarget(null);
            }
        };
    }

    function handleHeaderContextDragLeave(mode: 'task' | 'ask') {
        return (e: React.DragEvent<HTMLElement>) => {
            const nextTarget = e.relatedTarget as Node | null;
            if (nextTarget && e.currentTarget.contains(nextTarget)) return;
            setHeaderContextDropTarget(current => current === mode ? null : current);
        };
    }

    function handleHeaderContextDrop(mode: 'task' | 'ask') {
        return (e: React.DragEvent<HTMLElement>) => {
            e.preventDefault();
            e.stopPropagation();
            setHeaderContextDropTarget(null);
            const validation = validateSessionContextDrop({
                payload: readSessionContextDropPayload(e.dataTransfer),
                featureEnabled: sessionContextAttachmentsEnabled,
                activeWorkspaceId: ws.id,
                currentProcessId: null,
                existingItems: [],
                canRetrieveConversations,
            });
            if (!validation.ok) {
                setHeaderDropFeedback('error', validation.error);
                return;
            }
            queueDispatch({
                type: 'OPEN_DIALOG',
                workspaceId: ws.id,
                mode,
                attachedContext: [validation.payload],
            });
            setHeaderDropFeedback(
                'success',
                mode === 'ask'
                    ? 'Context attached to an Ask draft.'
                    : 'Context attached to a Queue Task draft.',
            );
        };
    }

    function headerContextDropClass(mode: 'task' | 'ask'): string {
        return cn(
            'rounded-md transition-[box-shadow,background-color]',
            headerContextDropTarget === mode && 'ring-2 ring-[#0969da] ring-offset-1 ring-offset-white dark:ring-[#3794ff] dark:ring-offset-[#1e1e1e] bg-[#ddf4ff]/60 dark:bg-[#3794ff]/15',
        );
    }

    async function handleResumeQueue() {
        setIsPauseResumeLoading(true);
        try {
            await fetchApi('/queue/resume?repoId=' + encodeURIComponent(ws.id), { method: 'POST' });
        } finally {
            setIsPauseResumeLoading(false);
        }
    }

    async function handleLaunchCli() {
        setIsLaunchingCli(true);
        try {
            await fetchApi('/chat/launch-terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workingDirectory: ws.rootPath }),
            });
        } finally {
            setIsLaunchingCli(false);
        }
    }

    // Seed repo queue map on first render if not yet populated with task-level data
    useEffect(() => {
        const existing = queueState.repoQueueMap[ws.id];
        if (existing && (existing.running.length > 0 || existing.queued.length > 0)) return;
        fetchApi('/queue?repoId=' + encodeURIComponent(ws.id))
            .then(data => {
                if (data) queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: ws.id, queue: data });
            })
            .catch(() => {});
    }, [ws.id]);

    const switchSubTab = (tab: RepoSubTab) => {
        if (tab === 'work-items') workItemDispatch({ type: 'MARK_WORK_ITEMS_SEEN', repoId: ws.id });
        dispatch({ type: 'SET_REPO_SUB_TAB', tab });
        const selectedTaskId = queueState.selectedTaskIdByRepo[ws.id] ?? queueState.selectedTaskId;
        location.hash = '#repos/' + encodeURIComponent(ws.id) + buildRepoSubTabSuffix(tab, state, selectedTaskId);
    };

    const handleNavigateToTask = useCallback((taskId: string) => {
        switchSubTab('tasks');
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: taskId, repoId: ws.id });
    }, [ws.id, queueDispatch]);

    const handleTasksNavStateChange = useCallback((navState: TasksPanelNavState) => {
        dispatch({ type: 'SET_TASKS_NAV_STATE', repoId: ws.id, navState });
    }, [dispatch, ws.id]);

    const handleOpenGenerateDialog = useCallback((targetFolder?: string) => {
        setGenerateDialog({ open: true, minimized: false, targetFolder });
    }, []);

    const handleRemove = async () => {
        if (!confirm('Remove this repo from the dashboard? Processes will be preserved.')) return;
        await getSpaCocClient().workspaces.delete(ws.id);
        dispatch({ type: 'SET_SELECTED_REPO', id: null });
        location.hash = '';
        onRefresh();
    };

    const mobileLeadingSlot = isMobile ? (
        <button
            className="flex items-center gap-1 min-w-0 w-full text-left group touch-target"
            onClick={() => { dispatch({ type: 'SET_SELECTED_REPO', id: null }); location.hash = ''; }}
            aria-label="Back to repos"
            data-testid="repo-name-back"
        >
            <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: color }}
            />
            <h1 className="text-[10px] font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate group-active:opacity-70 min-w-0">{getRepoDisplayName(ws)}</h1>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 flex-shrink-0 text-[#999999] dark:text-[#666666]">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
        </button>
    ) : undefined;

    return (
        <div id="repo-detail-content" className="flex flex-col h-full min-h-0 min-w-0">
            {/* Header — desktop only; on mobile the repo name lives in MobileTabBar leadingSlot */}
            {!isMobile && (
            <div
                className="repo-detail-header px-3 border-b border-[#d0d7de] dark:border-[#3c3c3c] flex flex-row items-center bg-white dark:bg-[#1e1e1e] gap-2"
                style={{ minHeight: 44 }}
            >
                <>
                    {/* Title — original styling: color dot + bold name */}
                        <div className="flex items-center gap-3 min-w-0 max-w-[180px] flex-shrink-0">
                            <span
                                className="inline-block w-3 h-3 md:w-3.5 md:h-3.5 rounded-full flex-shrink-0"
                                style={{ background: color }}
                            />
                            <h1 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex-1 truncate">{getRepoDisplayName(ws)}</h1>
                        </div>
                        {/* Sub-tab bar */}
                        <div className="relative flex-1 min-w-0" data-testid="repo-sub-tab-strip-container">
                            {/* Left scroll fade */}
                            {tabScrollState.canScrollLeft && (
                                <div
                                    className="absolute left-0 top-0 bottom-0 w-6 pointer-events-none z-10 bg-gradient-to-r from-white dark:from-[#1e1e1e] to-transparent"
                                    data-testid="tab-scroll-fade-left"
                                />
                            )}
                            {/* Right scroll fade */}
                            {tabScrollState.canScrollRight && (
                                <div
                                    className="absolute right-0 top-0 bottom-0 w-6 pointer-events-none z-10 bg-gradient-to-l from-white dark:from-[#1e1e1e] to-transparent"
                                    data-testid="tab-scroll-fade-right"
                                />
                            )}
                            <div
                                ref={tabStripRef}
                                className="flex items-center gap-0.5 pl-1.5 pr-0 overflow-x-auto scrollbar-hide border-l border-[#d8dee4] dark:border-[#3c3c3c]"
                                style={{ WebkitOverflowScrolling: 'touch' }}
                                data-testid="repo-sub-tab-strip"
                            >
                            {visibleSubTabs.map((t, i) => {
                                const prev = i > 0 ? visibleSubTabs[i - 1] : undefined;
                                const groupChanged = !!prev && (TAB_GROUP_INDEX[prev.key] ?? 0) !== (TAB_GROUP_INDEX[t.key] ?? 0);
                                const isActive = activeSubTab === t.key;
                                return (
                                <Fragment key={t.key}>
                                    {groupChanged && (
                                        <span className="flex-shrink-0 inline-block w-px h-[18px] mx-1 bg-[#d8dee4] dark:bg-[#3c3c3c]" data-testid="repo-sub-tab-divider" aria-hidden />
                                    )}
                                    <button
                                        data-subtab={t.key}
                                        title={t.shortcut}
                                        aria-current={isActive ? 'page' : undefined}
                                        className={cn(
                                            'repo-sub-tab relative inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-md text-[13px] whitespace-nowrap shrink-0 transition-colors',
                                            isActive
                                                ? 'active bg-[#ddf4ff] dark:bg-[#3794ff]/20 text-[#0969da] dark:text-[#79c0ff] font-bold ring-1 ring-inset ring-[#0969da]/30 dark:ring-[#3794ff]/40'
                                                : 'font-semibold text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]'
                                        )}
                                        onClick={() => switchSubTab(t.key)}
                                    >
                                        {t.label}
                                        {t.key === 'git' && (gitAhead > 0 || gitBehind > 0) && (
                                            <span className="font-mono text-[10px] opacity-70" data-testid="git-ahead-behind-badge">
                                                {gitAhead > 0 && <span data-testid="git-ahead-count">↑{gitAhead}</span>}
                                                {gitBehind > 0 && <span data-testid="git-behind-count">↓{gitBehind}</span>}
                                            </span>
                                        )}
                                        {t.key === 'tasks' && taskCount > 0 && (
                                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 py-px rounded-full">{taskCount}</span>
                                        )}
                                        {t.key === 'chats' && queueRunningCount > 0 && (
                                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#16825d] text-white px-1 py-px rounded-full" data-testid="activity-running-badge" title="Running">{queueRunningCount}</span>
                                        )}
                                        {t.key === 'chats' && queueQueuedCount > 0 && (
                                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="activity-queued-badge" title="Queued">{queueQueuedCount}</span>
                                        )}
                                        {t.key === 'activity' && queueRunningCount > 0 && (
                                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#16825d] text-white px-1 py-px rounded-full" data-testid="activity-running-badge" title="Running">{queueRunningCount}</span>
                                        )}
                                        {t.key === 'activity' && queueQueuedCount > 0 && (
                                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="activity-queued-badge" title="Queued">{queueQueuedCount}</span>
                                        )}
                                        {t.key === 'work-items' && unseenWorkItemCount > 0 && (
                                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="work-items-new-badge" title="Work items with updates">{unseenWorkItemCount}</span>
                                        )}
                                        {t.key === 'wiki' && wikiGeneratingCount > 0 && (
                                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[17px] text-[10px] font-mono bg-[#16825d] text-white px-1 py-px rounded-full animate-pulse" data-testid="wiki-generating-badge" title="Generating">⟳</span>
                                        )}
                                        {t.key === 'wiki' && wikiWarningCount > 0 && wikiGeneratingCount === 0 && (
                                            <span
                                                className="ml-1 w-2 h-2 rounded-full bg-[#f59e0b] inline-block"
                                                data-testid="wiki-warning-badge"
                                                title="Needs attention"
                                            />
                                        )}
                                        {isActive && (
                                            <span className="absolute left-1.5 right-1.5 -bottom-[5px] h-[3px] rounded-sm bg-[#0969da] dark:bg-[#3794ff]" />
                                        )}
                                    </button>
                                </Fragment>
                                );
                            })}
                            </div>
                        </div>
                        {/* Vertical splitter between tabs and action buttons */}
                        <div className="w-px self-stretch bg-[#d8dee4] dark:bg-[#3c3c3c] mx-1 my-2 flex-shrink-0" data-testid="repo-header-splitter" />
                        {/* Action buttons */}
                        <div ref={overflowContainerRef} className="flex items-center gap-1 flex-shrink-0 relative">
                            {/* Classic-mode primary visible buttons (mirror reference layout). */}
                            {uiLayoutMode === 'classic' && (
                                <>
                                    <div
                                        className={headerContextDropClass('task')}
                                        onDragEnter={handleHeaderContextDragOver('task')}
                                        onDragOver={handleHeaderContextDragOver('task')}
                                        onDragLeave={handleHeaderContextDragLeave('task')}
                                        onDrop={handleHeaderContextDrop('task')}
                                        data-testid="repo-queue-task-drop-target"
                                    >
                                        <Button
                                            variant="success"
                                            size="sm"
                                            onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id })}
                                            title="Queue a new AI task (Alt+Q). Drop CoC context here to attach it first."
                                            data-testid="repo-queue-task-btn"
                                            className="!h-[30px] !rounded-md !px-2.5 !text-[13px] !font-semibold !min-h-0 !shadow-[0_1px_0_rgba(31,35,40,0.1)]"
                                        >
                                            Queue Task
                                        </Button>
                                    </div>
                                    <div
                                        className={headerContextDropClass('ask')}
                                        onDragEnter={handleHeaderContextDragOver('ask')}
                                        onDragOver={handleHeaderContextDragOver('ask')}
                                        onDragLeave={handleHeaderContextDragLeave('ask')}
                                        onDrop={handleHeaderContextDrop('ask')}
                                        data-testid="repo-ask-drop-target"
                                    >
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id, mode: 'ask' })}
                                            title="Ask AI a question (read-only). Drop CoC context here to attach it first."
                                            data-testid="repo-ask-btn"
                                            className="!h-[30px] !rounded-md !px-2.5 !text-[13px] !font-semibold !min-h-0 !bg-yellow-500 hover:!bg-yellow-600 dark:!bg-yellow-400 dark:hover:!bg-yellow-300 !text-[#1e1e1e] !border-transparent !shadow-[0_1px_0_rgba(31,35,40,0.1)]"
                                        >
                                            Ask
                                        </Button>
                                    </div>
                                </>
                            )}
                            {headerContextDropFeedback && (
                                <div
                                    className={cn(
                                        'absolute right-0 top-full z-30 mt-1 max-w-[260px] rounded-md border px-2 py-1 text-[11px] shadow-sm',
                                        headerContextDropFeedback.type === 'error'
                                            ? 'border-[#f14c4c]/40 bg-[#fff1f1] text-[#b42318] dark:bg-[#3b1d1d] dark:text-[#ffb4a9]'
                                            : 'border-[#1f883d]/40 bg-[#dafbe1] text-[#116329] dark:bg-[#16351f] dark:text-[#7ee787]',
                                    )}
                                    data-testid="repo-header-context-drop-feedback"
                                    role="status"
                                >
                                    {headerContextDropFeedback.message}
                                </div>
                            )}
                            {/*
                              Container for "deferred" actions whose placement depends on layout
                              mode. In classic mode this becomes the popover surface revealed by
                              the "..." overflow toggle; in dev-workflow mode the same buttons
                              render inline alongside the title row. Keeping them in a single JSX
                              block ensures each data-testid appears exactly once in the DOM and
                              that source order is preserved (Launch CLI before Run Prompt / Script).
                            */}
                            {(() => {
                                const isOverflow = uiLayoutMode === 'classic';
                                const containerCls = isOverflow
                                    ? 'absolute top-full right-0 mt-1 z-20 flex flex-col items-stretch gap-0.5 min-w-[200px] rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-lg p-1.5'
                                    : 'flex items-center gap-1';
                                const secondaryItemCls = isOverflow
                                    ? '!font-semibold !w-full !justify-start !min-h-[34px] !h-[34px] !px-2 !rounded-md !bg-transparent !border-transparent !text-[#1f2328] dark:!text-[#cccccc] hover:!bg-[#f6f8fa] dark:hover:!bg-[#2d2d2d]'
                                    : '!font-semibold !h-[30px] !rounded-md !px-2.5 !text-[13px] !min-h-0 !bg-[#f6f8fa] dark:!bg-[#2a2a2a] !border-[#d0d7de] dark:!border-[#3c3c3c] !text-[#1f2328] dark:!text-[#cccccc] hover:!bg-[#eaeef2] dark:hover:!bg-[#333]';
                                const primaryItemCls = isOverflow
                                    ? secondaryItemCls
                                    : '!font-semibold !h-[30px] !rounded-md !px-2.5 !text-[13px] !min-h-0 !bg-[#1f883d] hover:!bg-[#1a7f37] dark:!bg-[#238636] dark:hover:!bg-[#2ea043] !text-white !border-transparent !shadow-[0_1px_0_rgba(31,35,40,0.1)]';
                                return (
                                <div
                                    className={containerCls}
                                    style={isOverflow ? { display: overflowOpen ? 'flex' : 'none' } : undefined}
                                    role={isOverflow ? 'menu' : undefined}
                                    data-testid={isOverflow ? 'repo-overflow-popover' : undefined}
                                >
                                    <Button
                                        className={secondaryItemCls}
                                        size="sm"
                                        title="Open CLI in terminal"
                                        onClick={() => { setOverflowOpen(false); void handleLaunchCli(); }}
                                        disabled={isLaunchingCli}
                                        variant="secondary"
                                        data-testid="repo-launch-cli-btn"
                                    >
                                        Launch CLI
                                    </Button>
                                    <Button
                                        className={primaryItemCls}
                                        size="sm"
                                        title="Run a prompt or script in this repo"
                                        onClick={() => { setOverflowOpen(false); queueDispatch({ type: 'OPEN_SCRIPT_DIALOG', workspaceId: ws.id }); }}
                                        variant="primary"
                                        data-testid="repo-run-script-btn"
                                    >
                                        Run Prompt / Script
                                    </Button>
                                    {(activeSubTab === 'chats' || activeSubTab === 'tasks') && isRepoPaused && (
                                        <Button
                                            className={secondaryItemCls}
                                            size="sm"
                                            onClick={() => { setOverflowOpen(false); void handleResumeQueue(); }}
                                            disabled={isPauseResumeLoading}
                                            variant="secondary"
                                            data-testid="repo-header-resume-btn"
                                        >
                                            Resume Queue
                                        </Button>
                                    )}
                                </div>
                                );
                            })()}
                            {/* Overflow toggle — only rendered in classic mode where extra actions are tucked away */}
                            {uiLayoutMode === 'classic' && (
                                <button
                                    type="button"
                                    onClick={() => setOverflowOpen(o => !o)}
                                    aria-label="More repository actions"
                                    aria-expanded={overflowOpen}
                                    aria-haspopup="menu"
                                    title="More actions"
                                    data-testid="repo-overflow-toggle-btn"
                                    className="inline-flex items-center justify-center h-[30px] w-[31px] rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[#656d76] dark:text-[#999] hover:bg-[#eaeef2] dark:hover:bg-[#333] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0969da]"
                                >
                                    <span className="text-[15px] leading-none -mt-1" aria-hidden>…</span>
                                </button>
                            )}
                        </div>
                </>
            </div>
            )}

            {/* Mobile tab bar */}
            {isMobile && (
                <MobileTabBar
                    activeTab={activeSubTab}
                    onTabChange={switchSubTab}
                    tabs={visibleSubTabs}
                    pinnedTabs={uiLayoutMode === 'classic' ? ['activity', 'tasks', 'git'] : undefined}
                    taskCount={taskCount}
                    activityCount={queueRunningCount + queueQueuedCount}
                    workItemCount={unseenWorkItemCount}
                    leadingSlot={mobileLeadingSlot}
                    actions={[
                        ...(uiLayoutMode === 'classic' ? [{ label: 'Queue Task', icon: '🤖', onClick: () => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id }) }] : []),
                        ...(uiLayoutMode === 'classic' ? [{ label: 'Ask', icon: '💡', onClick: () => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id, mode: 'ask' }) }] : []),
                        { label: 'Run Script', icon: '🛠️', onClick: () => queueDispatch({ type: 'OPEN_SCRIPT_DIALOG', workspaceId: ws.id }) },
                        ...(uiLayoutMode === 'classic' ? [{ label: 'Generate Plan', icon: '📋', onClick: () => handleOpenGenerateDialog() }] : []),
                        ...((activeSubTab === 'chats' || activeSubTab === 'tasks') && isRepoPaused
                            ? [{ label: 'Resume Queue', icon: '▶', onClick: handleResumeQueue }]
                            : []),
                    ]}
                />
            )}

            {/* Sub-tab content */}
            <div id="repo-sub-tab-content" className={cn("flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden")}>
                {activeSubTab === 'work-items' ? (
                    <WorkItemsTab key={ws.id} workspaceId={ws.id} onNavigateToTasksTab={handleNavigateToTask} />
                ) : activeSubTab === 'tasks' ? (
                    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                        {uiLayoutMode === 'classic' ? (
                            <TasksPanel
                                key={ws.id}
                                wsId={ws.id}
                                repos={repos}
                                onOpenGenerateDialog={handleOpenGenerateDialog}
                                initialNavState={state.repoSubTabNavState?.[tasksNavStateKey]}
                                onNavStateChange={handleTasksNavStateChange}
                            />
                        ) : (
                            <RepoChatTab key={`${ws.id}-tasks`} workspaceId={ws.id} mode="tasks" />
                        )}
                    </div>
                ) : (
                    <div className={cn("flex flex-col flex-1 min-h-0 min-w-0", activeSubTab === 'activity' || activeSubTab === 'chats' || activeSubTab === 'schedules' || activeSubTab === 'explorer' || activeSubTab === 'pull-requests' || activeSubTab === 'terminal' || activeSubTab === 'notes' || activeSubTab === 'dreams' || activeSubTab === 'cli-sessions' || activeSubTab === 'copilot-sessions' ? "overflow-hidden" : "overflow-y-auto")}>
                        {activeSubTab === 'settings' && <RepoSettingsTab key={ws.id} workspaceId={ws.id} repo={repo} />}
                        {activeSubTab === 'workflows' && <TemplatesTab key={ws.id} repo={repo} />}
                        {/*
                          The chat surface is rendered under either `activeSubTab === 'activity'`
                          (classic) or `activeSubTab === 'chats'` (dev-workflow). Accepting both
                          keys here makes the activity content render even when the URL form
                          doesn't match the user's current layout mode (e.g. classic-mode user
                          opening a `/chats/<id>` link, or a deep-link arriving before the async
                          preferences fetch settles). Without this, the hidden display:none
                          wrapper collapsed the chat detail to 0×0 → blank screen.
                        */}
                        {uiLayoutMode === 'classic' && (
                            <div style={{ display: (activeSubTab === 'activity' || activeSubTab === 'chats') ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                                <RepoChatTab key={`${ws.id}-activity`} workspaceId={ws.id} />
                            </div>
                        )}
                        {uiLayoutMode === 'dev-workflow' && (
                            <div style={{ display: (activeSubTab === 'chats' || activeSubTab === 'activity') ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                                <RepoChatTab key={`${ws.id}-chats`} workspaceId={ws.id} mode="chats" />
                            </div>
                        )}
                        {activeSubTab === 'schedules' && <RepoSchedulesTab key={ws.id} workspaceId={ws.id} />}
                        {isGitRepo && <div style={{ display: activeSubTab === 'git' ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                            {wasVisited('git') && <RepoGitTab key={ws.id} workspaceId={ws.id} />}
                        </div>}
                        {activeSubTab === 'wiki' && <RepoWikiTab key={ws.id} workspaceId={ws.id} workspacePath={ws.rootPath} initialWikiId={state.selectedRepoWikiId} initialTab={state.repoWikiInitialTab} initialAdminTab={state.repoWikiInitialAdminTab} initialComponentId={state.repoWikiInitialComponentId} />}
                        <div style={{ display: activeSubTab === 'explorer' ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                            {wasVisited('explorer') && <ExplorerPanel key={ws.id} workspaceId={ws.id} />}
                        </div>
                        {isGitRepo && <div style={{ display: activeSubTab === 'pull-requests' ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                            {wasVisited('pull-requests') && <PullRequestsTab
                                repoId={ws.id}
                                workspaceId={ws.id}
                                remoteUrl={ws.remoteUrl ?? undefined}
                            />}
                        </div>}
                        {terminalEnabled && (
                            <div style={{ display: activeSubTab === 'terminal' ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                                {wasVisited('terminal') && <TerminalView key={ws.id} workspaceId={ws.id} />}
                            </div>
                        )}
                        {notesEnabled && (
                            <div style={{ display: activeSubTab === 'notes' ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                                {wasVisited('notes') && <NotesView
                                    key={ws.id}
                                    workspaceId={ws.id}
                                    initialNotePath={state.selectedNotePath}
                                    defaultScope="per-note"
                                />}
                            </div>
                        )}
                        {dreamsEnabled && (
                            <div style={{ display: activeSubTab === 'dreams' ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                                {wasVisited('dreams') && <DreamsPanel key={ws.id} workspaceId={ws.id} />}
                            </div>
                        )}
                        {nativeCliSessionsEnabled && (
                            <div style={{ display: (activeSubTab === 'cli-sessions' || activeSubTab === 'copilot-sessions') ? undefined : 'none' }} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                                {(wasVisited('cli-sessions') || wasVisited('copilot-sessions')) && <NativeCliSessionsPanel key={ws.id} workspaceId={ws.id} />}
                            </div>
                        )}
                        {activeSubTab === 'workflow' && state.selectedWorkflowProcessId && <WorkflowDetailView key={state.selectedWorkflowProcessId} processId={state.selectedWorkflowProcessId} />}
                    </div>
                )}
            </div>

            {/* Generate Task with AI dialog */}
            {generateDialog.open && (
                <GenerateTaskDialog
                    wsId={ws.id}
                    initialFolder={generateDialog.targetFolder}
                    minimized={generateDialog.minimized}
                    onMinimize={() => setGenerateDialog(prev => ({ ...prev, minimized: true }))}
                    onRestore={() => setGenerateDialog(prev => ({ ...prev, minimized: false }))}
                    onClose={() => setGenerateDialog({ open: false, minimized: false, targetFolder: undefined })}
                    onSuccess={() => {
                        setGenerateDialog({ open: false, minimized: false, targetFolder: undefined });
                    }}
                />
            )}

            {/* Edit dialog */}
            <AddRepoDialog
                open={editOpen}
                onClose={() => setEditOpen(false)}
                editId={ws.id}
                repos={repos}
                onSuccess={() => { setEditOpen(false); onRefresh(); }}
            />
        </div>
    );
}
