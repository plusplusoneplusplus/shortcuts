/**
 * ReposView — top-level two-pane layout for the Repos tab.
 * Left: ReposGrid (sidebar). Right: RepoDetail (when a repo is selected).
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { fetchApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { ReposGrid } from './ReposGrid';
import { MiniReposSidebar } from './MiniReposSidebar';
import { RepoDetail } from './RepoDetail';
import { cn } from '../shared';
import { countTasks } from './repoGrouping';
import { fetchPipelines } from './pipeline-api';
import type { RepoData } from './repoGrouping';

export function ReposView() {
    const { state, dispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();
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

            // Seed per-repo queue stats for card badges
            seedRepoQueueStats(enriched);

            // Clear selection if repo was removed
            if (state.selectedRepoId && !enriched.find(r => r.workspace.id === state.selectedRepoId)) {
                dispatch({ type: 'SET_SELECTED_REPO', id: null });
            }
        } catch {
            setRepos([]);
        }
        setLoading(false);
    }, [dispatch, state.selectedRepoId]);

    // Seed repoQueueMap from /api/queue/repos (single call for all repos)
    const seedRepoQueueStats = useCallback(async (enriched: RepoData[]) => {
        try {
            const queueReposRes = await fetchApi('/queue/repos');
            const queueRepos = queueReposRes?.repos || [];
            for (const qr of queueRepos) {
                // Match queue repo to workspace by rootPath
                const match = enriched.find(r => r.workspace.rootPath === qr.rootPath);
                const repoId = match?.workspace.id ?? qr.repoId;
                queueDispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId,
                    queue: {
                        queued: [],
                        running: [],
                        stats: {
                            queued: qr.queuedCount ?? 0,
                            running: qr.runningCount ?? 0,
                            completed: 0,
                            failed: 0,
                            cancelled: 0,
                            total: 0,
                            isPaused: qr.isPaused ?? false,
                            isDraining: false,
                        },
                    },
                });
            }
        } catch { /* fire-and-forget */ }
    }, [queueDispatch]);

    // Targeted pipeline refresh for a single workspace
    const refreshPipelinesForWorkspace = useCallback(async (wsId: string) => {
        try {
            const updated = await fetchPipelines(wsId);
            setRepos(prev => prev.map(r =>
                r.workspace.id === wsId ? { ...r, pipelines: updated } : r
            ));
        } catch { /* fire-and-forget */ }
    }, []);

    // WebSocket: auto-refresh on mutation events (pipelines, processes)
    const { connect, disconnect } = useWebSocket({
        onMessage: useCallback((msg: any) => {
            if (msg.type === 'pipelines-changed' && msg.workspaceId) {
                refreshPipelinesForWorkspace(msg.workspaceId);
            }
            if (msg.type === 'process-added' || msg.type === 'process-updated' || msg.type === 'process-removed') {
                fetchRepos();
            }
        }, [refreshPipelinesForWorkspace, fetchRepos]),
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
                className={cn(
                    'shrink-0 min-h-0 flex flex-col overflow-hidden transition-[width,min-width,opacity] duration-150 ease-out border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]',
                    state.reposSidebarCollapsed
                        ? 'w-12 min-w-[48px]'
                        : 'w-[280px] min-w-[240px]'
                )}
            >
                {state.reposSidebarCollapsed ? (
                    <MiniReposSidebar repos={repos} onRefresh={fetchRepos} />
                ) : (
                    <ReposGrid repos={repos} onRefresh={fetchRepos} />
                )}
            </aside>

            {/* Right: detail */}
            <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                {selectedRepo ? (
                    <RepoDetail repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                ) : (
                    <div id="repo-detail-empty" data-testid="repo-detail-empty" className="flex-1 flex items-center justify-center text-sm text-[#848484]">
                        👈 Select a repository to view details
                    </div>
                )}
            </main>
        </div>
    );
}
