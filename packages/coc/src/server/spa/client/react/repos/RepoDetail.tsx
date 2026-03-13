/**
 * RepoDetail — right panel showing sub-tabs for the selected repo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { Button, cn } from '../shared';
import { BottomSheet } from '../shared/BottomSheet';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { RepoInfoTab } from './RepoInfoTab';
import { WorkflowsTab } from './WorkflowsTab';
import { TasksPanel } from '../tasks/TasksPanel';
import { RepoActivityTab } from './RepoActivityTab';
import { RepoSchedulesTab } from './RepoSchedulesTab';
import { RepoGitTab } from './RepoGitTab';
import { RepoWikiTab } from './RepoWikiTab';
import { RepoCopilotTab } from './RepoCopilotTab';
import { ExplorerPanel } from './explorer/ExplorerPanel';
import { PullRequestsTab } from './pull-requests/PullRequestsTab';
import { WorkflowDetailView } from '../processes/dag';
import { AddRepoDialog } from './AddRepoDialog';

import { GenerateTaskDialog } from '../tasks/GenerateTaskDialog';
import { getApiBase } from '../utils/config';
import { fetchApi } from '../hooks/useApi';
import { useRepoQueueStats } from '../hooks/useRepoQueueStats';
import { useGitInfo } from '../hooks/useGitInfo';
import { MobileTabBar } from '../layout/MobileTabBar';
import type { RepoData } from './repoGrouping';
import type { RepoSubTab } from '../types/dashboard';

interface RepoDetailProps {
    repo: RepoData;
    repos: RepoData[];
    onRefresh: () => void;
}

export const SUB_TABS: { key: RepoSubTab; label: string }[] = [
    { key: 'info', label: 'Info' },
    { key: 'git', label: 'Git' },
    { key: 'explorer', label: 'Explorer' },
    { key: 'tasks', label: 'Plans' },
    { key: 'pull-requests', label: 'Pull Requests' },
    { key: 'activity', label: 'Activity' },
    { key: 'workflows', label: 'Workflows' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'copilot', label: 'Copilot' },
];

export function RepoDetail({ repo, repos, onRefresh }: RepoDetailProps) {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { isMobile } = useBreakpoint();
    const [editOpen, setEditOpen] = useState(false);
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    const [generateDialog, setGenerateDialog] = useState<{
        open: boolean;
        minimized: boolean;
        targetFolder: string | undefined;
    }>({ open: false, minimized: false, targetFolder: undefined });
    const ws = repo.workspace;
    const color = ws.color || '#848484';
    const activeSubTab = state.activeRepoSubTab;
    const taskCount = repo.taskCount || 0;
    const { running: queueRunningCount, queued: queueQueuedCount } = useRepoQueueStats(ws.id);
    const { ahead: gitAhead, behind: gitBehind } = useGitInfo(ws.id);

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
    const moreMenuRef = useRef<HTMLDivElement>(null);
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

    // Close more-menu when clicking outside
    useEffect(() => {
        if (!moreMenuOpen || isMobile) return;
        const handler = (e: MouseEvent) => {
            if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
                setMoreMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [moreMenuOpen]);

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
        if (existing && (existing.running.length > 0 || existing.queued.length > 0 || existing.history.length > 0)) return;
        fetchApi('/queue?repoId=' + encodeURIComponent(ws.id))
            .then(data => {
                if (data) queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: ws.id, queue: data });
            })
            .catch(() => {});
    }, [ws.id]);

    const switchSubTab = (tab: RepoSubTab) => {
        dispatch({ type: 'SET_REPO_SUB_TAB', tab });
        if (tab !== 'git') {
            dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: null });
        }
        // Update hash
        const suffix = tab !== 'info' ? '/' + tab : '';
        location.hash = '#repos/' + encodeURIComponent(ws.id) + suffix;
    };

    const handleOpenGenerateDialog = useCallback((targetFolder?: string) => {
        setGenerateDialog({ open: true, minimized: false, targetFolder });
    }, []);

    const handleRemove = async () => {
        if (!confirm('Remove this repo from the dashboard? Processes will be preserved.')) return;
        await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(ws.id), { method: 'DELETE' });
        dispatch({ type: 'SET_SELECTED_REPO', id: null });
        location.hash = '#repos';
        onRefresh();
    };

    return (
        <div id="repo-detail-content" className="flex flex-col h-full min-h-0 min-w-0">
            {/* Header */}
            <div className={cn(
                'repo-detail-header flex gap-3 px-4 border-b border-[#e0e0e0] dark:border-[#3c3c3c]',
                isMobile ? 'flex-row items-center py-1' : 'items-center py-2'
            )}>
                {/* Title row */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    {isMobile && (
                        <button
                            className="text-[#616161] dark:text-[#999999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] flex-shrink-0 p-0.5 -ml-1"
                            onClick={() => { dispatch({ type: 'SET_SELECTED_REPO', id: null }); location.hash = '#repos'; }}
                            aria-label="Back to repos"
                            data-testid="repo-back-btn"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                            </svg>
                        </button>
                    )}
                    <span
                        className="inline-block w-3 h-3 md:w-3.5 md:h-3.5 rounded-full flex-shrink-0"
                        style={{ background: color }}
                    />
                    <h1 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex-1 truncate">{ws.name}</h1>
                </div>
                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {activeSubTab === 'activity' && isRepoPaused && (
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
                    {/* On mobile: collapse Queue Task, Generate, Edit, Remove into overflow menu */}
                    {isMobile ? (
                        <div className="relative" ref={moreMenuRef} data-testid="repo-more-menu-container">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setMoreMenuOpen(prev => !prev)}
                                data-testid="repo-more-menu-btn"
                                title="More actions"
                            >
                                ⋯
                            </Button>
                            {moreMenuOpen && (
                                <BottomSheet isOpen onClose={() => setMoreMenuOpen(false)} title="Actions">
                                    <div className="flex flex-col" data-testid="repo-more-menu-items">
                                        <button
                                            className="w-full text-left px-4 py-3 text-sm hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                            data-testid="repo-more-launch-cli"
                                            onClick={() => { setMoreMenuOpen(false); handleLaunchCli(); }}
                                        >
                                            &gt;_ Launch CLI
                                        </button>
                                        <button
                                            className="w-full text-left px-4 py-3 text-sm hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                            data-testid="repo-more-queue-task"
                                            onClick={() => { setMoreMenuOpen(false); queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id }); }}
                                        >
                                            + Queue Task
                                        </button>
                                        <button
                                            className="w-full text-left px-4 py-3 text-sm hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                            data-testid="repo-more-ask"
                                            onClick={() => { setMoreMenuOpen(false); queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id, mode: 'ask' }); }}
                                        >
                                            💬 Ask
                                        </button>
                                        <button
                                            className="w-full text-left px-4 py-3 text-sm hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                            data-testid="repo-more-generate"
                                            onClick={() => { setMoreMenuOpen(false); handleOpenGenerateDialog(); }}
                                        >
                                            ✨ Generate Plan
                                        </button>
                                        <button
                                            className="w-full text-left px-4 py-3 text-sm hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                            data-testid="repo-more-edit"
                                            onClick={() => { setMoreMenuOpen(false); setEditOpen(true); }}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="w-full text-left px-4 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10"
                                            data-testid="repo-more-remove"
                                            onClick={() => { setMoreMenuOpen(false); handleRemove(); }}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </BottomSheet>
                            )}
                        </div>
                    ) : (
                        <>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id })}
                                title="Queue a new task"
                                data-testid="repo-queue-task-btn"
                            >
                                + Queue Task
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id, mode: 'ask' })}
                                title="Ask AI a question (read-only)"
                                data-testid="repo-ask-btn"
                            >
                                💬 Ask
                            </Button>
                            <Button variant="primary" size="sm" id="repo-generate-btn" data-testid="repo-generate-btn" onClick={() => handleOpenGenerateDialog()} className="relative">
                                ✨ Generate Plan
                                {generateDialog.open && generateDialog.minimized && (
                                    <span data-testid="generate-minimized-badge" className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#0078d4] border-2 border-white dark:border-[#252526]" />
                                )}
                            </Button>
                            <Button variant="secondary" size="sm" id="repo-edit-btn" data-testid="repo-edit-btn" onClick={() => setEditOpen(true)}>Edit</Button>
                            <Button variant="danger" size="sm" id="repo-remove-btn" data-testid="repo-remove-btn" onClick={handleRemove}>Remove</Button>
                        </>
                    )}
                </div>
            </div>

            {/* Sub-tab bar — desktop only; mobile uses MobileTabBar */}
            {!isMobile && (
            <div className="relative" data-testid="repo-sub-tab-strip-container">
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
                    className={cn(
                        'flex border-b border-[#e0e0e0] dark:border-[#3c3c3c]',
                        isMobile ? 'px-2' : 'px-4',
                        'overflow-x-auto scrollbar-hide'
                    )}
                    style={{ WebkitOverflowScrolling: 'touch' }}
                    data-testid="repo-sub-tab-strip"
                >
                {SUB_TABS.map(t => (
                    <button
                        key={t.key}
                        data-subtab={t.key}
                        className={cn(
                            'repo-sub-tab text-xs font-medium transition-colors relative whitespace-nowrap shrink-0',
                            isMobile ? 'px-2 py-1.5' : 'px-3 py-2',
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
                        {t.key === 'activity' && queueRunningCount > 0 && (
                            <span className="ml-1 text-[10px] bg-[#16825d] text-white px-1 py-px rounded-full" data-testid="activity-running-badge" title="Running">{queueRunningCount}</span>
                        )}
                        {t.key === 'activity' && queueQueuedCount > 0 && (
                            <span className="ml-1 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="activity-queued-badge" title="Queued">{queueQueuedCount}</span>
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
                        {activeSubTab === t.key && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
                        )}
                    </button>
                ))}
                </div>
            </div>
            )}

            {/* Mobile tab bar */}
            {isMobile && (
                <MobileTabBar
                    activeTab={activeSubTab}
                    onTabChange={switchSubTab}
                    tabs={SUB_TABS}
                    taskCount={taskCount}
                    activityCount={queueRunningCount + queueQueuedCount}
                />
            )}

            {/* Sub-tab content */}
            <div id="repo-sub-tab-content" className={cn("flex-1 min-h-0 min-w-0 overflow-hidden", isMobile && activeSubTab !== 'tasks' && "pb-14")}>
                {activeSubTab === 'tasks' ? (
                    <TasksPanel
                        key={ws.id}
                        wsId={ws.id}
                        repos={repos}
                        onOpenGenerateDialog={handleOpenGenerateDialog}
                        initialNavState={state.repoSubTabNavState[`${ws.id}::tasks`]}
                        onNavStateChange={(navState) => dispatch({ type: 'SET_TASKS_NAV_STATE', repoId: ws.id, navState })}
                    />
                ) : (
                    <div className={cn("h-full min-w-0", activeSubTab === 'activity' || activeSubTab === 'schedules' || activeSubTab === 'explorer' ? "overflow-hidden" : "overflow-y-auto")}>
                        {activeSubTab === 'info' && <RepoInfoTab key={ws.id} repo={repo} />}
                        {activeSubTab === 'workflows' && <WorkflowsTab key={ws.id} repo={repo} />}
                        {activeSubTab === 'activity' && <RepoActivityTab key={ws.id} workspaceId={ws.id} />}
                        {activeSubTab === 'schedules' && <RepoSchedulesTab key={ws.id} workspaceId={ws.id} />}
                        {activeSubTab === 'git' && <RepoGitTab key={ws.id} workspaceId={ws.id} />}
                        {activeSubTab === 'wiki' && <RepoWikiTab key={ws.id} workspaceId={ws.id} workspacePath={ws.rootPath} initialWikiId={state.selectedRepoWikiId} initialTab={state.repoWikiInitialTab} initialAdminTab={state.repoWikiInitialAdminTab} initialComponentId={state.repoWikiInitialComponentId} />}
                        {activeSubTab === 'copilot' && <RepoCopilotTab key={ws.id} workspaceId={ws.id} />}
                        {activeSubTab === 'explorer' && <ExplorerPanel key={ws.id} workspaceId={ws.id} />}
                        {activeSubTab === 'pull-requests' && (
                            <PullRequestsTab
                                repoId={ws.id}
                                workspaceId={ws.id}
                                remoteUrl={ws.remoteUrl ?? undefined}
                            />
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
