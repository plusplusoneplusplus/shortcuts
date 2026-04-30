/**
 * RepoDetail — right panel showing sub-tabs for the selected repo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import type { AppContextState } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useWorkItems, loadUnseenWorkItemIds } from '../../contexts/WorkItemContext';
import { useUiLayoutMode } from '../../hooks/preferences/useUiLayoutMode';
import { Button, cn } from '../../ui';
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
import { AddRepoDialog } from '../../repos/AddRepoDialog';
import { ErrorBoundary } from '../../ui/ErrorBoundary';

import { GenerateTaskDialog } from '../../tasks/GenerateTaskDialog';
import { TasksPanel } from '../../tasks/TasksPanel';
import { getApiBase } from '../../utils/config';
import { fetchApi } from '../../hooks/useApi';
import { useRepoQueueStats } from '../../queue/hooks/useRepoQueueStats';
import { useGitInfo } from '../git/hooks/useGitInfo';
import { useTerminalEnabled } from '../../hooks/feature-flags/useTerminalEnabled';
import { useNotesEnabled } from '../notes/hooks/useNotesEnabled';
import { useWorkflowsEnabled } from '../../hooks/feature-flags/useWorkflowsEnabled';
import { usePullRequestsEnabled } from '../../hooks/feature-flags/usePullRequestsEnabled';
import { useNotesAutoCommit } from '../notes/hooks/useNotesAutoCommit';
import { MobileTabBar } from '../../layout/MobileTabBar';
import { SHOW_WIKI_TAB } from '../../layout/TopBar';
import type { RepoData } from '../../repos/repoGrouping';
import type { RepoSubTab } from '../../types/dashboard';
import { getRepoTabsForLayout } from './repoLayoutModeConfig';

interface RepoDetailProps {
    repo: RepoData;
    repos: RepoData[];
    onRefresh: () => void;
}

export const SUB_TABS: { key: RepoSubTab; label: string; shortcut?: string }[] = [
    { key: 'chats', label: 'Chats', shortcut: 'Alt+A' },
    { key: 'git', label: 'Git', shortcut: 'Alt+G' },
    { key: 'work-items', label: 'Work Items', shortcut: 'Alt+I' },
    { key: 'schedules', label: 'Schedules', shortcut: 'Alt+S' },
    { key: 'explorer', label: 'Explorer', shortcut: 'Alt+E' },
    { key: 'workflows', label: 'Workflows', shortcut: 'Alt+W' },
    { key: 'pull-requests', label: 'Pull Requests', shortcut: 'Alt+R' },
    { key: 'tasks', label: 'Tasks (Dep.)', shortcut: 'Alt+T' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
    { key: 'settings', label: 'Settings', shortcut: 'Alt+C' },
    { key: 'wiki', label: 'Wiki' },
];

/** Tabs actually rendered in the UI — wiki is hidden behind a feature flag. */
export const VISIBLE_SUB_TABS = SHOW_WIKI_TAB
    ? SUB_TABS
    : SUB_TABS.filter(t => t.key !== 'wiki');

function getTabSuffix(tab: RepoSubTab, state: AppContextState): string {
    if (tab === 'settings') return '/settings/' + state.settingsSection;
    if (tab === 'git') {
        if (state.selectedGitCommitHash) {
            const hash = encodeURIComponent(state.selectedGitCommitHash);
            const file = state.selectedGitFilePath
                ? '/' + encodeURIComponent(state.selectedGitFilePath)
                : '';
            return '/git/' + hash + file;
        }
        return '/git';
    }
    if (tab === 'notes') {
        if (state.selectedNotePath) {
            return '/notes/' + state.selectedNotePath.split('/').map(encodeURIComponent).join('/');
        }
        return '/notes';
    }
    return '/' + tab;
}

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
    const color = ws.color || '#848484';
    const activeSubTab = state.activeRepoSubTab;
    const taskCount = repo.taskCount || 0;
    const { running: queueRunningCount, queued: queueQueuedCount } = useRepoQueueStats(ws.id);
    const { ahead: gitAhead, behind: gitBehind } = useGitInfo(ws.id);
    const notesAutoCommit = useNotesAutoCommit(ws.id);
    const isGitRepo = !!repo.gitInfo?.isGitRepo;
    const terminalEnabled = useTerminalEnabled();
    const notesEnabled = useNotesEnabled();
    const workflowsEnabled = useWorkflowsEnabled();
    const pullRequestsEnabled = usePullRequestsEnabled();

    // Notes chat panel — per-workspace state so it persists across tab switches
    const [notesChatPanelOpen, setNotesChatPanelOpen] = useState(() => {
        try { return localStorage.getItem(`coc-notes-chat-panel-open-${ws.id}`) === 'true'; }
        catch { return false; }
    });
    useEffect(() => {
        try { localStorage.setItem(`coc-notes-chat-panel-open-${ws.id}`, String(notesChatPanelOpen)); }
        catch { /* ignore */ }
    }, [notesChatPanelOpen, ws.id]);

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

    const visibleSubTabs = useMemo(() => {
        let tabs = VISIBLE_SUB_TABS;
        if (!isGitRepo) tabs = tabs.filter(t => t.key !== 'git' && t.key !== 'pull-requests');
        if (!terminalEnabled) tabs = tabs.filter(t => t.key !== 'terminal');
        if (!notesEnabled) tabs = tabs.filter(t => t.key !== 'notes');
        if (!workflowsEnabled) tabs = tabs.filter(t => t.key !== 'workflows');
        if (!pullRequestsEnabled) tabs = tabs.filter(t => t.key !== 'pull-requests');
        const layoutModeForVisibleTabs = uiLayoutMode === 'notes-centric' ? 'dev-workflow' : uiLayoutMode;
        return getRepoTabsForLayout(tabs, layoutModeForVisibleTabs);
    }, [isGitRepo, terminalEnabled, notesEnabled, workflowsEnabled, pullRequestsEnabled, uiLayoutMode]);

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
        location.hash = '#repos/' + encodeURIComponent(ws.id) + getTabSuffix(tab, state);
    };

    const handleNavigateToTask = useCallback((taskId: string) => {
        switchSubTab('tasks');
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: taskId, repoId: ws.id });
    }, [ws.id, queueDispatch]);

    const handleOpenGenerateDialog = useCallback((targetFolder?: string) => {
        setGenerateDialog({ open: true, minimized: false, targetFolder });
    }, []);

    const handleRemove = async () => {
        if (!confirm('Remove this repo from the dashboard? Processes will be preserved.')) return;
        await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(ws.id), { method: 'DELETE' });
        dispatch({ type: 'SET_SELECTED_REPO', id: null });
        location.hash = '';
        onRefresh();
    };

    return (
        <div id="repo-detail-content" className="flex flex-col h-full min-h-0 min-w-0">
            {/* Header */}
            <div className={cn(
                'repo-detail-header px-4 border-b border-[#e0e0e0] dark:border-[#3c3c3c]',
                isMobile ? 'flex flex-col' : 'flex flex-row items-center'
            )}>
                {isMobile ? (
                    // Mobile: compact title row (actions moved to MobileTabBar)
                    <div className="flex gap-3 items-center py-1">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span
                                className="inline-block w-3 h-3 md:w-3.5 md:h-3.5 rounded-full flex-shrink-0"
                                style={{ background: color }}
                            />
                            <button
                                className="flex items-center gap-1.5 min-w-0 flex-1 text-left group"
                                onClick={() => { dispatch({ type: 'SET_SELECTED_REPO', id: null }); location.hash = ''; }}
                                aria-label="Back to repos"
                                data-testid="repo-name-back"
                            >
                                <h1 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate group-active:opacity-70">{ws.name}</h1>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 flex-shrink-0 text-[#999999] dark:text-[#666666]">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                                </svg>
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Title */}
                        <div className="flex items-center gap-3 min-w-0 max-w-[180px] flex-shrink-0">
                            <span
                                className="inline-block w-3 h-3 md:w-3.5 md:h-3.5 rounded-full flex-shrink-0"
                                style={{ background: color }}
                            />
                            <h1 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex-1 truncate">{ws.name}</h1>
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
                                className="flex pl-2 overflow-x-auto scrollbar-hide"
                                style={{ WebkitOverflowScrolling: 'touch' }}
                                data-testid="repo-sub-tab-strip"
                            >
                            {visibleSubTabs.map(t => (
                                <button
                                    key={t.key}
                                    data-subtab={t.key}
                                    title={t.shortcut}
                                    className={cn(
                                        'repo-sub-tab text-xs font-medium transition-colors relative whitespace-nowrap shrink-0',
                                        'px-3 py-2',
                                        activeSubTab === t.key
                                            ? 'active text-[#0078d4] dark:text-[#3794ff]'
                                            : 'text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                                    )}
                                    onClick={() => switchSubTab(t.key)}
                                >
                                    {t.label}
                                    {t.key === 'git' && (gitAhead > 0 || gitBehind > 0) && (
                                        <span className="ml-1 font-mono text-[10px] opacity-70" data-testid="git-ahead-behind-badge">
                                            {gitAhead > 0 && <span data-testid="git-ahead-count">↑{gitAhead}</span>}
                                            {gitBehind > 0 && <span data-testid="git-behind-count">↓{gitBehind}</span>}
                                        </span>
                                    )}
                                    {t.key === 'tasks' && taskCount > 0 && (
                                        <span className="ml-1 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full">{taskCount}</span>
                                    )}
                                    {t.key === 'chats' && queueRunningCount > 0 && (
                                        <span className="ml-1 text-[10px] bg-[#16825d] text-white px-1 py-px rounded-full" data-testid="activity-running-badge" title="Running">{queueRunningCount}</span>
                                    )}
                                    {t.key === 'chats' && queueQueuedCount > 0 && (
                                        <span className="ml-1 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="activity-queued-badge" title="Queued">{queueQueuedCount}</span>
                                    )}
                                    {t.key === 'activity' && queueRunningCount > 0 && (
                                        <span className="ml-1 text-[10px] bg-[#16825d] text-white px-1 py-px rounded-full" data-testid="activity-running-badge" title="Running">{queueRunningCount}</span>
                                    )}
                                    {t.key === 'activity' && queueQueuedCount > 0 && (
                                        <span className="ml-1 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="activity-queued-badge" title="Queued">{queueQueuedCount}</span>
                                    )}
                                    {t.key === 'work-items' && unseenWorkItemCount > 0 && (
                                        <span className="ml-1 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="work-items-new-badge" title="Work items with updates">{unseenWorkItemCount}</span>
                                    )}
                                    {t.key === 'wiki' && wikiGeneratingCount > 0 && (
                                        <span className="ml-1 text-[10px] bg-[#16825d] text-white px-1 py-px rounded-full animate-pulse" data-testid="wiki-generating-badge" title="Generating">⟳</span>
                                    )}
                                    {t.key === 'wiki' && wikiWarningCount > 0 && wikiGeneratingCount === 0 && (
                                        <span
                                            className="ml-1 w-2 h-2 rounded-full bg-[#f59e0b] inline-block"
                                            data-testid="wiki-warning-badge"
                                            title="Needs attention"
                                        />
                                    )}
                                    {t.key === 'notes' && notesAutoCommit.autoCommitEnabled && (
                                        <span className="ml-1 text-[10px] bg-amber-600 text-white px-1 py-px rounded-full"
                                              data-testid="notes-autocommit-badge" title="Auto-commit active">
                                            ⏰
                                        </span>
                                    )}
                                    {activeSubTab === t.key && (
                                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
                                    )}
                                </button>
                            ))}
                            </div>
                        </div>
                        {/* Vertical splitter between tabs and action buttons */}
                        <div className="w-px self-stretch bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-2 my-1 flex-shrink-0" data-testid="repo-header-splitter" />
                        {/* Action buttons */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {(activeSubTab === 'chats' || activeSubTab === 'tasks') && isRepoPaused && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={isPauseResumeLoading}
                                    onClick={handleResumeQueue}
                                    data-testid="repo-header-resume-btn"
                                >
                                    ▶ Resume Queue
                                </Button>
                            )}
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={isLaunchingCli}
                                onClick={handleLaunchCli}
                                title="Open CLI in terminal"
                                data-testid="repo-launch-cli-btn"
                            >
                                &gt;_ Launch CLI
                            </Button>
                            {uiLayoutMode === 'classic' && (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id })}
                                    title="Queue a new AI task (Alt+Q)"
                                    data-testid="repo-queue-task-btn"
                                >
                                    🤖 Queue Task
                                </Button>
                            )}
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => queueDispatch({ type: 'OPEN_SCRIPT_DIALOG', workspaceId: ws.id })}
                                title="Run a prompt or script in this repo"
                                data-testid="repo-run-script-btn"
                            >
                                🛠️ Prompt & Script
                            </Button>
                            {uiLayoutMode === 'classic' && (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id, mode: 'ask' })}
                                    title="Ask AI a question (read-only)"
                                    data-testid="repo-ask-btn"
                                >
                                    💡 Ask
                                </Button>
                            )}
                            {uiLayoutMode === 'classic' && (
                                <Button variant="primary" size="sm" id="repo-generate-btn" data-testid="repo-generate-btn" onClick={() => handleOpenGenerateDialog()} className="relative">
                                    📋 Generate Plan
                                    {generateDialog.open && generateDialog.minimized && (
                                        <span data-testid="generate-minimized-badge" className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#0078d4] border-2 border-white dark:border-[#252526]" />
                                    )}
                                </Button>
                            )}

                        </div>
                    </>
                )}
            </div>

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
            <div id="repo-sub-tab-content" className={cn("flex-1 min-h-0 min-w-0 overflow-hidden")}>
                {activeSubTab === 'work-items' ? (
                    <WorkItemsTab key={ws.id} workspaceId={ws.id} onNavigateToTasksTab={handleNavigateToTask} />
                ) : activeSubTab === 'tasks' ? (
                    <div className="h-full min-w-0 overflow-hidden">
                        {uiLayoutMode === 'classic' ? (
                            <TasksPanel
                                key={ws.id}
                                wsId={ws.id}
                                repos={repos}
                                onOpenGenerateDialog={handleOpenGenerateDialog}
                                initialNavState={state.repoSubTabNavState?.[ws.id]}
                                onNavStateChange={(ns) => dispatch({ type: 'SET_TASKS_NAV_STATE', repoId: ws.id, navState: ns })}
                            />
                        ) : (
                            <RepoChatTab key={`${ws.id}-tasks`} workspaceId={ws.id} mode="tasks" />
                        )}
                    </div>
                ) : (
                    <div className={cn("h-full min-w-0", activeSubTab === 'activity' || activeSubTab === 'chats' || activeSubTab === 'schedules' || activeSubTab === 'explorer' || activeSubTab === 'pull-requests' || activeSubTab === 'terminal' || activeSubTab === 'notes' ? "overflow-hidden" : "overflow-y-auto")}>
                        {activeSubTab === 'settings' && <RepoSettingsTab key={ws.id} workspaceId={ws.id} repo={repo} />}
                        {activeSubTab === 'workflows' && <TemplatesTab key={ws.id} repo={repo} />}
                        {uiLayoutMode === 'classic' && (
                            <div style={{ display: activeSubTab === 'activity' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                                <RepoChatTab key={`${ws.id}-activity`} workspaceId={ws.id} />
                            </div>
                        )}
                        {uiLayoutMode === 'dev-workflow' && (
                            <div style={{ display: activeSubTab === 'chats' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                                <RepoChatTab key={`${ws.id}-chats`} workspaceId={ws.id} mode="chats" />
                            </div>
                        )}
                        {activeSubTab === 'schedules' && <RepoSchedulesTab key={ws.id} workspaceId={ws.id} />}
                        {isGitRepo && <div style={{ display: activeSubTab === 'git' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                            <RepoGitTab key={ws.id} workspaceId={ws.id} />
                        </div>}
                        {activeSubTab === 'wiki' && <RepoWikiTab key={ws.id} workspaceId={ws.id} workspacePath={ws.rootPath} initialWikiId={state.selectedRepoWikiId} initialTab={state.repoWikiInitialTab} initialAdminTab={state.repoWikiInitialAdminTab} initialComponentId={state.repoWikiInitialComponentId} />}
                        <div style={{ display: activeSubTab === 'explorer' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                            <ExplorerPanel key={ws.id} workspaceId={ws.id} />
                        </div>
                        {isGitRepo && <div style={{ display: activeSubTab === 'pull-requests' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                            <PullRequestsTab
                                repoId={ws.id}
                                workspaceId={ws.id}
                                remoteUrl={ws.remoteUrl ?? undefined}
                            />
                        </div>}
                        {terminalEnabled && (
                            <div style={{ display: activeSubTab === 'terminal' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                                <TerminalView key={ws.id} workspaceId={ws.id} />
                            </div>
                        )}
                        {notesEnabled && (
                            <div style={{ display: activeSubTab === 'notes' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                                <NotesView
                                    key={ws.id}
                                    workspaceId={ws.id}
                                    initialNotePath={state.selectedNotePath}
                                    chatPanelOpen={notesChatPanelOpen}
                                    onToggleChatPanel={() => setNotesChatPanelOpen(v => !v)}
                                    defaultScope="per-note"
                                />
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
