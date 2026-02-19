/**
 * RepoDetail — right panel showing sub-tabs for the selected repo.
 */

import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button, cn } from '../shared';
import { RepoInfoTab } from './RepoInfoTab';
import { PipelinesTab } from './PipelinesTab';
import { TasksPanel } from '../tasks/TasksPanel';
import { RepoQueueTab } from './RepoQueueTab';
import { RepoSchedulesTab } from './RepoSchedulesTab';
import { AddRepoDialog } from './AddRepoDialog';
import { getApiBase } from '../utils/config';
import type { RepoData } from './repoGrouping';
import type { RepoSubTab } from '../types/dashboard';

interface RepoDetailProps {
    repo: RepoData;
    repos: RepoData[];
    onRefresh: () => void;
}

const SUB_TABS: { key: RepoSubTab; label: string }[] = [
    { key: 'info', label: 'Info' },
    { key: 'pipelines', label: 'Pipelines' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'queue', label: 'Queue' },
    { key: 'schedules', label: 'Schedules' },
];

export function RepoDetail({ repo, repos, onRefresh }: RepoDetailProps) {
    const { state, dispatch } = useApp();
    const [editOpen, setEditOpen] = useState(false);
    const ws = repo.workspace;
    const color = ws.color || '#848484';
    const activeSubTab = state.activeRepoSubTab;
    const taskCount = repo.taskCount || 0;

    const switchSubTab = (tab: RepoSubTab) => {
        dispatch({ type: 'SET_REPO_SUB_TAB', tab });
        // Update hash
        const suffix = tab !== 'info' ? '/' + tab : '';
        location.hash = '#repos/' + encodeURIComponent(ws.id) + suffix;
    };

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
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span
                    className="inline-block w-3.5 h-3.5 rounded-full flex-shrink-0"
                    style={{ background: color }}
                />
                <h1 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc] flex-1">{ws.name}</h1>
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
                <Button variant="danger" size="sm" onClick={handleRemove}>Remove</Button>
            </div>

            {/* Sub-tab bar */}
            <div className="flex border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-4">
                {SUB_TABS.map(t => (
                    <button
                        key={t.key}
                        data-subtab={t.key}
                        className={cn(
                            'repo-sub-tab px-3 py-2 text-xs font-medium transition-colors relative',
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
                        {activeSubTab === t.key && (
                            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0078d4] dark:bg-[#3794ff]" />
                        )}
                    </button>
                ))}
            </div>

            {/* Sub-tab content */}
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                {activeSubTab === 'tasks' ? (
                    <TasksPanel wsId={ws.id} />
                ) : (
                    <div className="h-full overflow-y-auto min-w-0">
                        {activeSubTab === 'info' && <RepoInfoTab repo={repo} />}
                        {activeSubTab === 'pipelines' && <PipelinesTab repo={repo} />}
                        {activeSubTab === 'queue' && <RepoQueueTab workspaceId={ws.id} />}
                        {activeSubTab === 'schedules' && <RepoSchedulesTab workspaceId={ws.id} />}
                    </div>
                )}
            </div>

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
