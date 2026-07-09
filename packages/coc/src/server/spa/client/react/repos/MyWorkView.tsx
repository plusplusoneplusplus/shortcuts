/**
 * MyWorkView — landing page for the "My Work" virtual workspace.
 *
 * Renders a single-row header with title, tab buttons, and action buttons,
 * matching the RepoDetail layout pattern.
 * Activity reuses RepoChatTab; Notes reuses NotesView.
 */

import { useState, useCallback, useMemo } from 'react';
import { NotesView } from '../features/notes/NotesView';
import { RepoChatTab } from '../features/chat/RepoChatTab';
import { NotesGitTab } from '../features/notes/NotesGitTab';
import { RepoSchedulesTab } from '../features/schedules/RepoSchedulesTab';
import { RepoSettingsTab } from '../features/repo-settings/RepoSettingsTab';
import { useSchedulesInScheduledSlideEnabled } from '../hooks/feature-flags/useSchedulesInScheduledSlideEnabled';
import { useApp } from '../contexts/AppContext';
import { cn } from '../ui';
import type { RepoSubTab } from '../types/dashboard';
import type { RepoData } from './repoGrouping';
import { generateMyWorkSummary, syncMyWork } from './repositoryService';
import { DockedStatusFooter } from '../layout/DockedStatusFooter';

export const MY_WORK_WORKSPACE_ID = 'my_work';

const MY_WORK_TABS: { key: RepoSubTab; label: string; shortcut?: string }[] = [
    { key: 'notes', label: 'Notes', shortcut: 'Alt+N' },
    { key: 'activity', label: 'Activity', shortcut: 'Alt+A' },
    { key: 'git', label: 'Git', shortcut: 'Alt+G' },
    { key: 'schedules', label: 'Schedules', shortcut: 'Alt+S' },
    { key: 'settings', label: 'Settings', shortcut: 'Alt+C' },
];

const VIRTUAL_REPO: RepoData = {
    workspace: { id: MY_WORK_WORKSPACE_ID, rootPath: '', color: undefined, description: undefined, remoteUrl: undefined },
};

export function MyWorkView() {
    const { state, dispatch } = useApp();
    const [syncing, setSyncing] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);

    // Hide the standalone Schedules tab when schedule management has moved into
    // the chat-list "Scheduled" slide (feature flag). The Activity tab reuses
    // RepoChatTab, which hosts that slide, so nothing is stranded.
    const schedulesInScheduledSlideEnabled = useSchedulesInScheduledSlideEnabled();
    const visibleTabs = useMemo(
        () => schedulesInScheduledSlideEnabled ? MY_WORK_TABS.filter(t => t.key !== 'schedules') : MY_WORK_TABS,
        [schedulesInScheduledSlideEnabled],
    );

    // Default to 'notes' when the current sub-tab is not one of the visible My Work tabs
    const activeTab = visibleTabs.some(t => t.key === state.activeRepoSubTab)
        ? state.activeRepoSubTab
        : 'notes';

    const switchTab = useCallback((tab: RepoSubTab) => {
        dispatch({ type: 'SET_REPO_SUB_TAB', tab });
        location.hash = '#repos/' + MY_WORK_WORKSPACE_ID + '/' + tab;
    }, [dispatch]);

    const handleSync = useCallback(async () => {
        setSyncing(true);
        setStatusMsg(null);
        try {
            const result = await syncMyWork();
            const count = (result.actionItemCount ?? 0) + (result.followUpCount ?? 0);
            setStatusMsg(count > 0 ? `Synced ${count} items` : 'No new items');
            setTimeout(() => setStatusMsg(null), 4000);
        } catch (err: any) {
            setStatusMsg(`Sync failed: ${err.message}`);
        } finally {
            setSyncing(false);
        }
    }, []);

    const handleGenerateSummary = useCallback(async () => {
        setGenerating(true);
        setStatusMsg(null);
        try {
            const result = await generateMyWorkSummary();
            if (result.path) {
                setStatusMsg(`Summary saved to ${result.path}`);
                location.hash = `#repos/${MY_WORK_WORKSPACE_ID}/notes/${encodeURIComponent(result.path)}`;
            }
            setTimeout(() => setStatusMsg(null), 4000);
        } catch (err: any) {
            setStatusMsg(`Generation failed: ${err.message}`);
        } finally {
            setGenerating(false);
        }
    }, []);

    return (
        <div className="flex flex-col h-full" data-testid="my-work-view">
            {/* Combined header: title + tabs + action buttons */}
            <div
                className="flex items-center px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#2d2d2d] flex-shrink-0"
                data-testid="my-work-header"
            >
                <span className="text-sm font-semibold text-[#333] dark:text-[#ccc] mr-2 flex-shrink-0">
                    📋 My Work
                </span>
                {visibleTabs.map(t => (
                    <button
                        key={t.key}
                        data-subtab={t.key}
                        title={t.shortcut}
                        className={cn(
                            'text-xs font-medium transition-colors relative whitespace-nowrap shrink-0 px-3 py-2',
                            activeTab === t.key
                                ? 'text-[#0078d4] dark:text-[#3794ff]'
                                : 'text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                        )}
                        onClick={() => switchTab(t.key)}
                        data-testid={`my-work-tab-${t.key}`}
                    >
                        {t.label}
                        {activeTab === t.key && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
                        )}
                    </button>
                ))}
                <div className="flex-1" />
                {/* Vertical splitter */}
                <div className="w-px self-stretch bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-2 my-1 flex-shrink-0" data-testid="my-work-header-splitter" />
                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                        className="text-xs px-2.5 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#3c3c3c] hover:bg-[#e8e8e8] dark:hover:bg-[#4a4a4a] text-[#333] dark:text-[#ccc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        onClick={handleSync}
                        disabled={syncing}
                        data-testid="my-work-sync-btn"
                        title="Sync action items and follow-ups from Work IQ"
                    >
                        {syncing ? '⏳ Syncing…' : '🔄 Sync Work IQ'}
                    </button>
                    <button
                        className="text-xs px-2.5 py-1 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#3c3c3c] hover:bg-[#e8e8e8] dark:hover:bg-[#4a4a4a] text-[#333] dark:text-[#ccc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        onClick={handleGenerateSummary}
                        disabled={generating}
                        data-testid="my-work-generate-btn"
                        title="Generate a weekly summary from your notes and cross-repo activity"
                    >
                        {generating ? '⏳ Generating…' : '📝 Generate Summary'}
                    </button>
                    {statusMsg && (
                        <span className="text-xs text-[#666] dark:text-[#999] ml-1" data-testid="my-work-status">
                            {statusMsg}
                        </span>
                    )}
                </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <div style={{ display: activeTab === 'activity' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <RepoChatTab workspaceId={MY_WORK_WORKSPACE_ID} />
                </div>
                <div style={{ display: activeTab === 'notes' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <NotesView
                        workspaceId={MY_WORK_WORKSPACE_ID}
                        initialNotePath={state.selectedNotePath}
                        defaultScope="per-workspace"
                        active={activeTab === 'notes'}
                    />
                </div>
                <div style={{ display: activeTab === 'git' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                    <NotesGitTab workspaceId={MY_WORK_WORKSPACE_ID} />
                </div>
                {!schedulesInScheduledSlideEnabled && (
                    <div style={{ display: activeTab === 'schedules' ? undefined : 'none' }} className="h-full min-w-0 overflow-hidden">
                        <RepoSchedulesTab workspaceId={MY_WORK_WORKSPACE_ID} />
                    </div>
                )}
                {activeTab === 'settings' && <RepoSettingsTab workspaceId={MY_WORK_WORKSPACE_ID} repo={VIRTUAL_REPO} />}
            </div>

            {/* Remote-first shell: dock the status/action cluster at the bottom
                of the My Work body so it lives in this view's own chrome instead
                of the app-wide bottom band. No-ops in classic / mobile, where the
                topbar keeps the cluster. */}
            <DockedStatusFooter />
        </div>
    );
}
