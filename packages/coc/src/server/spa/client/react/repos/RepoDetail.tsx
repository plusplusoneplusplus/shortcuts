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
import { PipelinesTab } from './PipelinesTab';
import { TasksPanel } from '../tasks/TasksPanel';
import { RepoQueueTab } from './RepoQueueTab';
import { RepoSchedulesTab } from './RepoSchedulesTab';
import { RepoChatTab } from './RepoChatTab';
import { RepoGitTab } from './RepoGitTab';
import { RepoWikiTab } from './RepoWikiTab';
import { AddRepoDialog } from './AddRepoDialog';
import { GenerateTaskDialog } from '../tasks/GenerateTaskDialog';
import { getApiBase } from '../utils/config';
import { fetchApi } from '../hooks/useApi';
import { useGlobalToast } from '../context/ToastContext';
import { useRepoQueueStats } from '../hooks/useRepoQueueStats';
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
    { key: 'pipelines', label: 'Pipelines' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'queue', label: 'Queue' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'chat', label: 'Chat' },
    { key: 'wiki', label: 'Wiki' },
];

export function RepoDetail({ repo, repos, onRefresh }: RepoDetailProps) {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { addToast } = useGlobalToast();
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
    const { running: queueRunningCount, queued: queueQueuedCount, chatPending: chatPendingCount } = useRepoQueueStats(ws.id);

    const isRepoPaused = useMemo(() => {
        return !!queueState.repoQueueMap[ws.id]?.stats?.isPaused;
    }, [queueState.repoQueueMap[ws.id]?.stats?.isPaused]);
    const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
    const [newChatTrigger, setNewChatTrigger] = useState<{ count: number; readOnly: boolean }>({ count: 0, readOnly: false });
    const newChatTriggerProcessedRef = useRef(0);
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

    // Clear chat deep-link after consuming it (one-shot signal)
    useEffect(() => {
        if (state.selectedChatSessionId && activeSubTab === 'chat') {
            dispatch({ type: 'SET_SELECTED_CHAT_SESSION', id: null });
        }
    }, [state.selectedChatSessionId, activeSubTab, dispatch]);

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

    const [newChatDropdownOpen, setNewChatDropdownOpen] = useState(false);
    const newChatDropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        if (!newChatDropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (newChatDropdownRef.current && !newChatDropdownRef.current.contains(e.target as Node)) {
                setNewChatDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [newChatDropdownOpen]);

    const handleNewChatFromTopBar = useCallback((readOnly = false) => {
        setNewChatTrigger(prev => ({ count: prev.count + 1, readOnly }));
        switchSubTab('chat');
    }, []);

    const handleLaunchInTerminal = useCallback(async () => {
        try {
            const response = await fetch(getApiBase() + '/chat/launch-terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workingDirectory: ws.rootPath }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error ?? `Launch failed (${response.status})`);
            }
        } catch (err: any) {
            addToast(err?.message ?? 'Failed to launch chat terminal', 'error');
        }
    }, [ws.rootPath, addToast]);

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
                    {activeSubTab === 'queue' && isRepoPaused && (
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
                    {/* New Chat — hidden on mobile when Chat tab is active (dedup with sidebar) */}
                    {!(isMobile && activeSubTab === 'chat') && (
                        <div className="relative inline-flex" ref={newChatDropdownRef} data-testid="repo-new-chat-split-btn">
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleNewChatFromTopBar(false)}
                                title="Start a new chat"
                                data-testid="repo-new-chat-btn"
                                className="rounded-r-none"
                            >
                                {isMobile ? '+' : '+ New Chat'}
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => setNewChatDropdownOpen(prev => !prev)}
                                data-testid="repo-new-chat-dropdown-toggle"
                                className="rounded-l-none border-l border-white/30 px-1.5"
                            >
                                ▾
                            </Button>
                            {newChatDropdownOpen && (
                                <div
                                    className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg z-50"
                                    data-testid="repo-new-chat-dropdown-menu"
                                >
                                    <button
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                        data-testid="repo-new-chat-option-normal"
                                        onClick={() => { setNewChatDropdownOpen(false); handleNewChatFromTopBar(false); }}
                                    >
                                        New Chat
                                    </button>
                                    <button
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                        data-testid="repo-new-chat-option-readonly"
                                        onClick={() => { setNewChatDropdownOpen(false); handleNewChatFromTopBar(true); }}
                                    >
                                        New Chat (Read-Only)
                                    </button>
                                    <button
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-[#0078d4]/10 text-[#1e1e1e] dark:text-[#cccccc]"
                                        data-testid="repo-new-chat-option-terminal"
                                        onClick={() => { setNewChatDropdownOpen(false); void handleLaunchInTerminal(); }}
                                    >
                                        New Chat (Terminal)
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
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
                                            data-testid="repo-more-queue-task"
                                            onClick={() => { setMoreMenuOpen(false); queueDispatch({ type: 'OPEN_DIALOG', workspaceId: ws.id }); }}
                                        >
                                            + Queue Task
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
                        {t.key === 'tasks' && taskCount > 0 && (
                            <span className="ml-1 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full">{taskCount}</span>
                        )}
                        {t.key === 'queue' && queueRunningCount > 0 && (
                            <span className="ml-1 text-[10px] bg-[#16825d] text-white px-1 py-px rounded-full" data-testid="queue-running-badge" title="Running">{queueRunningCount}</span>
                        )}
                        {t.key === 'queue' && queueQueuedCount > 0 && (
                            <span className="ml-1 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="queue-queued-badge" title="Queued">{queueQueuedCount}</span>
                        )}
                        {t.key === 'chat' && chatPendingCount > 0 && (
                            <span className="ml-1 text-[10px] bg-[#0078d4] text-white px-1 py-px rounded-full" data-testid="chat-pending-badge" title="Pending chats">{chatPendingCount}</span>
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
                    queueRunningCount={queueRunningCount}
                    queueQueuedCount={queueQueuedCount}
                    chatPendingCount={chatPendingCount}
                />
            )}

            {/* Sub-tab content */}
            <div id="repo-sub-tab-content" className="flex-1 min-h-0 min-w-0 overflow-hidden">
                {activeSubTab === 'tasks' ? (
                    <TasksPanel wsId={ws.id} repos={repos} onOpenGenerateDialog={handleOpenGenerateDialog} />
                ) : (
                    <div className="h-full overflow-y-auto min-w-0">
                        {activeSubTab === 'info' && <RepoInfoTab repo={repo} />}
                        {activeSubTab === 'pipelines' && <PipelinesTab repo={repo} />}
                        {activeSubTab === 'queue' && <RepoQueueTab workspaceId={ws.id} />}
                        {activeSubTab === 'schedules' && <RepoSchedulesTab workspaceId={ws.id} />}
                        {activeSubTab === 'chat' && <RepoChatTab workspaceId={ws.id} workspacePath={ws.rootPath} initialSessionId={state.selectedChatSessionId} newChatTrigger={newChatTrigger} newChatTriggerProcessedRef={newChatTriggerProcessedRef} />}
                        {activeSubTab === 'git' && <RepoGitTab key={ws.id} workspaceId={ws.id} />}
                        {activeSubTab === 'wiki' && <RepoWikiTab workspaceId={ws.id} workspacePath={ws.rootPath} />}
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
