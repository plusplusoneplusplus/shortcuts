/**
 * ReposView — top-level two-pane layout for the Repos tab.
 * Left: ReposGrid (sidebar). Right: RepoDetail (when a repo is selected).
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { fetchApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { ReposGrid } from './ReposGrid';
import { RepoDetail } from './RepoDetail';
import { cn } from '../shared';
import { countTasks } from './repoGrouping';
import { fetchPipelines } from './pipeline-api';
import type { RepoData } from './repoGrouping';

export function ReposView() {
    const { state, dispatch } = useApp();
    const [repos, setRepos] = useState<RepoData[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchRepos = useCallback(async () => {
        try {
            const wsRes = await fetchApi('/workspaces');
            const workspaces = wsRes?.workspaces || wsRes || [];
            if (!Array.isArray(workspaces)) {
                setRepos([]);
                setLoading(false);
                return;
            }

            // Update global workspace list
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });

            // Enrich each workspace in parallel
            const enriched: RepoData[] = await Promise.all(
                workspaces.map(async (ws: any) => {
                    const [gitInfo, pipelinesRes, tasksRes] = await Promise.all([
                        fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/git-info`).catch(() => null),
                        fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/pipelines`).catch(() => null),
                        fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/tasks`).catch(() => null),
                    ]);

                    const processRes = await fetchApi(`/processes?workspace=${encodeURIComponent(ws.id)}&limit=200`).catch(() => null);
                    const processes = processRes?.processes || [];
                    const stats = { success: 0, failed: 0, running: 0 };
                    for (const p of processes) {
                        if (p.status === 'completed') stats.success++;
                        else if (p.status === 'failed') stats.failed++;
                        else if (p.status === 'running') stats.running++;
                    }

                    return {
                        workspace: ws,
                        gitInfo: gitInfo || undefined,
                        pipelines: pipelinesRes?.pipelines || [],
                        stats,
                        taskCount: countTasks(tasksRes),
                    };
                })
            );

            setRepos(enriched);

            // Clear selection if repo was removed
            if (state.selectedRepoId && !enriched.find(r => r.workspace.id === state.selectedRepoId)) {
                dispatch({ type: 'SET_SELECTED_REPO', id: null });
            }
        } catch {
            setRepos([]);
        }
        setLoading(false);
    }, [dispatch, state.selectedRepoId]);

    // Targeted pipeline refresh for a single workspace
    const refreshPipelinesForWorkspace = useCallback(async (wsId: string) => {
        try {
            const updated = await fetchPipelines(wsId);
            setRepos(prev => prev.map(r =>
                r.workspace.id === wsId ? { ...r, pipelines: updated } : r
            ));
        } catch { /* fire-and-forget */ }
    }, []);

    // WebSocket: auto-refresh pipelines on mutation events
    const { connect, disconnect } = useWebSocket({
        onMessage: useCallback((msg: any) => {
            if (msg.type === 'pipelines-changed' && msg.workspaceId) {
                refreshPipelinesForWorkspace(msg.workspaceId);
            }
        }, [refreshPipelinesForWorkspace]),
    });

    useEffect(() => {
        fetchRepos();
        connect();
        return () => disconnect();
    }, []);

    const selectedRepo = repos.find(r => r.workspace.id === state.selectedRepoId) || null;

    if (loading && repos.length === 0) {
        return (
            <div id="view-repos" className="flex items-center justify-center h-[calc(100vh-48px)] text-sm text-[#848484]">
                Loading repositories...
            </div>
        );
    }

    return (
        <div id="view-repos" className="flex h-[calc(100vh-48px)] overflow-hidden">
            {/* Left: sidebar */}
            <aside
                id="repos-sidebar"
                data-testid="repos-sidebar"
                aria-hidden={state.reposSidebarCollapsed}
                className={cn(
                    'shrink-0 min-h-0 flex flex-col overflow-hidden transition-[width,min-width] duration-150 ease-out border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]',
                    state.reposSidebarCollapsed
                        ? 'w-0 min-w-0 border-r-0'
                        : 'w-[280px] min-w-[240px]'
                )}
            >
                <ReposGrid repos={repos} onRefresh={fetchRepos} />
            </aside>

            {/* Right: detail */}
            <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                {selectedRepo ? (
                    <RepoDetail repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-sm text-[#848484]">
                        👈 Select a repository to view details
                    </div>
                )}
            </main>
        </div>
    );
}
