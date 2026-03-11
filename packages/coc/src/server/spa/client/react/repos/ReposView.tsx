/**
 * ReposView — top-level two-pane layout for the Repos tab.
 * Left: ReposGrid (sidebar). Right: RepoDetail (when a repo is selected).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { fetchApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { ReposGrid } from './ReposGrid';
import { MiniReposSidebar } from './MiniReposSidebar';
import { RepoDetail } from './RepoDetail';
import { ResponsiveSidebar } from '../shared/ResponsiveSidebar';
import { cn } from '../shared';
import { countTasks } from './repoGrouping';
import { fetchWorkflows } from './workflow-api';
import { computeUnseenCount } from '../hooks/useUnseenActivity';
import type { RepoData } from './repoGrouping';


export function ReposView() {
    const { state, dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const isTablet = breakpoint === 'tablet';
    const hasSelection = state.selectedRepoId !== null;
    const heightClass = isMobile
        ? 'h-[calc(100vh-40px-56px)]'
        : 'h-[calc(100vh-48px)]';
    const [repos, setRepos] = useState<RepoData[]>([]);
    const [loading, setLoading] = useState(true);
    const selectedRepoIdRef = useRef(state.selectedRepoId);
    selectedRepoIdRef.current = state.selectedRepoId;
    const processThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gitInfoAbortRef = useRef<AbortController | null>(null);

    // Temporary hover-expand state (transient, no persistence)
    const [tempExpanded, setTempExpanded] = useState(false);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleMiniHoverStart = useCallback(() => {
        hoverTimerRef.current = setTimeout(() => setTempExpanded(true), 3000);
    }, []);

    const handleMiniHoverEnd = useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        setTempExpanded(false);
    }, []);

    const isCollapsed = state.reposSidebarCollapsed && !tempExpanded;

    // Dynamic collapsed width: fit the longest repo name (dot + gap + text + padding).
    const collapsedSidebarWidth = useMemo(() => {
        if (!repos.length) return 120;
        const longestName = repos.reduce((max, r) => {
            const name = r.workspace.name || '';
            return name.length > max.length ? name : max;
        }, '');
        // 10px dot + 6px gap + text (≈7.5px/char at 12px) + 24px padding + 3px selected border
        return Math.max(80, Math.ceil(10 + 6 + longestName.length * 7.5 + 24 + 3));
    }, [repos]);

    // Bump this counter whenever the user marks tasks as read/unread so the
    // useMemo below re-evaluates (localStorage changes don't update queueState).
    const [seenVersion, setSeenVersion] = useState(0);
    useEffect(() => {
        const handler = () => setSeenVersion(v => v + 1);
        window.addEventListener('coc-seen-updated', handler);
        return () => window.removeEventListener('coc-seen-updated', handler);
    }, []);

    // Compute per-repo unseen counts for the mini sidebar badge.
    const unseenCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const [repoId, repoQueue] of Object.entries(queueState.repoQueueMap)) {
            const count = computeUnseenCount(repoId, repoQueue.history ?? []);
            if (count > 0) counts[repoId] = count;
        }
        return counts;
    }, [queueState.repoQueueMap, seenVersion]);

    const handleBack = useCallback(() => {
        dispatch({ type: 'SET_SELECTED_REPO', id: null });
        if (location.hash.startsWith('#repo')) {
            location.hash = '#repos';
        }
    }, [dispatch]);

    const fetchRepos = useCallback(async () => {
        try {
            const wsRes = await fetchApi('/workspaces');
            const workspaces = wsRes?.workspaces || wsRes || [];
            if (!Array.isArray(workspaces)) {
                setRepos([]);
                setLoading(false);
                return;
            }

            // Hide virtual workspaces (e.g. global workspace) from repos grid
            const visibleWorkspaces = workspaces.filter((ws: any) => !ws.virtual);

            // Update global workspace list
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });

            // Phase 1: Fetch workflows/tasks/processes (fast) in parallel — skip git-info
            const enriched: RepoData[] = await Promise.all(
                visibleWorkspaces.map(async (ws: any) => {
                    const [pipelinesRes, tasksRes] = await Promise.all([
                        fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/workflows`).catch(() => null),
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
                        gitInfoLoading: true,
                        workflows: pipelinesRes?.workflows || [],
                        stats,
                        taskCount: countTasks(tasksRes),
                    };
                })
            );

            // Render cards immediately (git-info still loading)
            setRepos(enriched);
            setLoading(false);

            // Seed per-repo queue stats for card badges
            seedRepoQueueStats(enriched);

            // Clear selection if repo was removed
            if (selectedRepoIdRef.current && !enriched.find(r => r.workspace.id === selectedRepoIdRef.current)) {
                dispatch({ type: 'SET_SELECTED_REPO', id: null });
            }

            // Phase 2: Fetch git-info for all workspaces in a single batch request
            gitInfoAbortRef.current?.abort();
            const abortController = new AbortController();
            gitInfoAbortRef.current = abortController;

            const wsIds = enriched.map(r => r.workspace.id);
            fetchApi('/git-info/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceIds: wsIds }),
                signal: abortController.signal,
            }).then((data: any) => {
                if (abortController.signal.aborted) return;
                const results = data?.results || {};
                setRepos(prev => prev.map(r => ({
                    ...r,
                    gitInfo: results[r.workspace.id] || undefined,
                    gitInfoLoading: false,
                })));
            }).catch((err) => {
                if (err.name === 'AbortError') return;
                setRepos(prev => prev.map(r => ({ ...r, gitInfoLoading: false })));
            });
        } catch {
            setRepos([]);
            setLoading(false);
        }
    }, [dispatch]);

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
                    type: 'REPO_QUEUE_STATS_UPDATED',
                    repoId,
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
                });
            }
        } catch { /* fire-and-forget */ }
    }, [queueDispatch]);

    // Targeted workflow refresh for a single workspace
    const refreshPipelinesForWorkspace = useCallback(async (wsId: string) => {
        try {
            const updated = await fetchWorkflows(wsId);
            setRepos(prev => prev.map(r =>
                r.workspace.id === wsId ? { ...r, workflows: updated } : r
            ));
        } catch { /* fire-and-forget */ }
    }, []);

    // Targeted git-info refresh for a single workspace (triggered by WebSocket)
    const refreshGitInfoForWorkspace = useCallback((wsId: string) => {
        fetchApi(`/workspaces/${encodeURIComponent(wsId)}/git-info`)
            .catch(() => null)
            .then((gitInfo: any) => {
                setRepos(prev => prev.map(r =>
                    r.workspace.id === wsId
                        ? { ...r, gitInfo: gitInfo || undefined, gitInfoLoading: false }
                        : r
                ));
            });
    }, []);

    // WebSocket: auto-refresh on mutation events (pipelines, processes, git)
    const { connect, disconnect } = useWebSocket({
        onMessage: useCallback((msg: any) => {
            if (msg.type === 'workflows-changed' && msg.workspaceId) {
                refreshPipelinesForWorkspace(msg.workspaceId);
            }
            if (msg.type === 'git-changed' && msg.workspaceId) {
                refreshGitInfoForWorkspace(msg.workspaceId);
            }
            // Throttle process events: at most one fetchRepos per 10 seconds
            if (msg.type === 'process-added' || msg.type === 'process-updated' || msg.type === 'process-removed') {
                if (!processThrottleRef.current) {
                    processThrottleRef.current = setTimeout(() => {
                        processThrottleRef.current = null;
                        fetchRepos();
                    }, 10_000);
                }
            }
        }, [refreshPipelinesForWorkspace, refreshGitInfoForWorkspace, fetchRepos]),
    });

    useEffect(() => {
        fetchRepos();
        connect();
        return () => {
            disconnect();
            if (processThrottleRef.current) {
                clearTimeout(processThrottleRef.current);
                processThrottleRef.current = null;
            }
            if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
            }
        };
    }, []);

    if (loading && repos.length === 0) {
        return (
            <div id="view-repos" className={`flex items-center justify-center ${heightClass} text-sm text-[#848484]`}>
                Loading repositories...
            </div>
        );
    }

    const selectedRepo = repos.find(r => r.workspace.id === state.selectedRepoId) || null;

    return (
        <div id="view-repos" className={`flex ${heightClass} overflow-hidden`}>
            {isMobile ? (
                // ── Mobile: master-detail ──
                hasSelection && selectedRepo ? (
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                        <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                            <RepoDetail repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                        </main>
                    </div>
                ) : (
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#f3f3f3] dark:bg-[#252526] overflow-hidden">
                        <ReposGrid repos={repos} onRefresh={fetchRepos} />
                    </div>
                )
            ) : isTablet ? (
                // ── Tablet: collapsible sidebar via ResponsiveSidebar ──
                <>
                    <ResponsiveSidebar isOpen={false} onClose={() => {}} width={260} tabletWidth={260}>
                        <ReposGrid repos={repos} onRefresh={fetchRepos} />
                    </ResponsiveSidebar>
                    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                        {selectedRepo ? (
                            <RepoDetail repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                        ) : (
                            <div id="repo-detail-empty" data-testid="repo-detail-empty" className="flex-1 flex items-center justify-center text-sm text-[#848484]">
                                👈 Select a repository to view details
                            </div>
                        )}
                    </main>
                </>
            ) : (
                // ── Desktop: existing aside with collapse to MiniReposSidebar ──
                <>
                    <aside
                        id="repos-sidebar"
                        data-testid="repos-sidebar"
                        className={cn(
                            'shrink-0 min-h-0 flex flex-col overflow-hidden transition-[width,min-width,opacity] duration-150 ease-out border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]',
                            isCollapsed ? '' : 'w-[280px] min-w-[240px]'
                        )}
                        style={isCollapsed ? { width: collapsedSidebarWidth, minWidth: collapsedSidebarWidth } : undefined}
                        onMouseLeave={state.reposSidebarCollapsed ? handleMiniHoverEnd : undefined}
                    >
                        {isCollapsed ? (
                            <MiniReposSidebar repos={repos} onRefresh={fetchRepos} onItemHoverStart={handleMiniHoverStart} onItemHoverEnd={handleMiniHoverEnd} unseenCounts={unseenCounts} />
                        ) : (
                            <ReposGrid repos={repos} onRefresh={fetchRepos} />
                        )}
                    </aside>
                    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                        {selectedRepo ? (
                            <RepoDetail repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                        ) : (
                            <div id="repo-detail-empty" data-testid="repo-detail-empty" className="flex-1 flex items-center justify-center text-sm text-[#848484]">
                                👈 Select a repository to view details
                            </div>
                        )}
                    </main>
                </>
            )}
        </div>
    );
}
