/**
 * RepoDetail — right panel showing sub-tabs for the selected repo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { Button, cn } from '../shared';
import { RepoInfoTab } from './RepoInfoTab';
import { PipelinesTab } from './PipelinesTab';
import { TasksPanel } from '../tasks/TasksPanel';
import { RepoQueueTab } from './RepoQueueTab';
import { RepoSchedulesTab } from './RepoSchedulesTab';
import { RepoChatTab } from './RepoChatTab';
import { RepoGitTab } from './RepoGitTab';
import { AddRepoDialog } from './AddRepoDialog';
import { GenerateTaskDialog } from '../tasks/GenerateTaskDialog';
import { getApiBase } from '../utils/config';
import { fetchApi } from '../hooks/useApi';
import { useRepoQueueStats } from '../hooks/useRepoQueueStats';
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
];

export function RepoDetail({ repo, repos, onRefresh }: RepoDetailProps) {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const [editOpen, setEditOpen] = useState(false);
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
    const [newChatTrigger, setNewChatTrigger] = useState(0);
    const newChatTriggerProcessedRef = useRef(0);
    const tabStripRef = useRef<HTMLDivElement>(null);

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
        // Update hash
        const suffix = tab !== 'info' ? '/' + tab : '';
        location.hash = '#repos/' + encodeURIComponent(ws.id) + suffix;
    };

    const handleOpenGenerateDialog = useCallback((targetFolder?: string) => {
        setGenerateDialog({ open: true, minimized: false, targetFolder });
    }, []);

    const handleNewChatFromTopBar = useCallback(() => {
        setNewChatTrigger(prev => prev + 1);
        switchSubTab('chat');
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
            <div className="repo-detail-header flex items-center gap-3 px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span
                    className="inline-block w-3.5 h-3.5 rounded-full flex-shrink-0"
                    style={{ background: color }}
                />
                <h1 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex-1">{ws.name}</h1>
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
                <Button
                    variant="primary"
                    size="sm"
                    onClick={handleNewChatFromTopBar}
                    title="Start a new chat"
                    data-testid="repo-new-chat-btn"
                >
                    + New Chat
                </Button>
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
            </div>

            {/* Sub-tab bar */}
            <div
                ref={tabStripRef}
                className={cn(
                    'flex border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-4',
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
                            'repo-sub-tab px-3 py-2 text-xs font-medium transition-colors relative whitespace-nowrap shrink-0',
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
                        {activeSubTab === 'git' && <RepoGitTab workspaceId={ws.id} />}
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
