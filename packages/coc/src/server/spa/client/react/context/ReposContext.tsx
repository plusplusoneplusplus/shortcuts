/**
 * ReposContext — shared repository state for TopBar (tab strip) and ReposView.
 * Moves repo fetching, WebSocket subscriptions, and unseen count computation
 * out of ReposView so they are available to the full app shell.
 */

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useRef,
    useMemo,
    type ReactNode,
} from 'react';
import { useApp } from './AppContext';
import { useQueue } from './QueueContext';
import { fetchApi } from '../hooks/useApi';
import { fetchUnseenCount } from '../hooks/seenStateApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { countTasks } from '../repos/repoGrouping';

import type { RepoData } from '../repos/repoGrouping';

// ── Context shape ──────────────────────────────────────────────────────

export interface ReposContextValue {
    repos: RepoData[];
    loading: boolean;
    fetchRepos: () => Promise<void>;
    unseenCounts: Record<string, number>;
    refreshUnseenCounts: (wsIds: string[]) => Promise<void>;
}

const ReposContext = createContext<ReposContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────

export function ReposProvider({ children }: { children: ReactNode }) {
    const { dispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();

    const [repos, setRepos] = useState<RepoData[]>([]);
    const [loading, setLoading] = useState(true);

    const selectedRepoIdRef = useRef<string | null>(null);

    // Keep selectedRepoId in a ref so fetchRepos doesn't recreate on every selection change
    const { state: appState } = useApp();
    selectedRepoIdRef.current = appState.selectedRepoId;

    const processThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gitInfoAbortRef = useRef<AbortController | null>(null);

    // Per-repo unseen counts, fetched from the server.
    const [unseenCounts, setUnseenCounts] = useState<Record<string, number>>({});

    // Seed repoQueueMap from /api/queue/repos (single call for all repos)
    const seedRepoQueueStats = useCallback(async (enriched: RepoData[]) => {
        try {
            const queueReposRes = await fetchApi('/queue/repos');
            const queueRepos = queueReposRes?.repos || [];
            for (const qr of queueRepos) {
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

    // Fetch per-repo unseen counts from the server
    const refreshUnseenCounts = useCallback(async (wsIds: string[]) => {
        try {
            const counts: Record<string, number> = {};
            await Promise.all(wsIds.map(async (id) => {
                try {
                    counts[id] = await fetchUnseenCount(id);
                } catch { counts[id] = 0; }
            }));
            setUnseenCounts(prev => ({ ...prev, ...counts }));
        } catch { /* fire-and-forget */ }
    }, []);

    const fetchRepos = useCallback(async () => {
        try {
            // Fetch workspaces and all process summaries in parallel
            const [wsRes, processRes] = await Promise.all([
                fetchApi('/workspaces'),
                fetchApi('/processes/summaries?limit=200').catch(() => null),
            ]);
            const workspaces = wsRes?.workspaces || wsRes || [];
            if (!Array.isArray(workspaces)) {
                setRepos([]);
                setLoading(false);
                return;
            }

            // Extract all summaries and seed AppContext (replaces App.tsx bootstrap responsibility)
            const allSummaries: any[] = processRes?.summaries || processRes?.processes || (Array.isArray(processRes) ? processRes : []);
            dispatch({ type: 'SET_PROCESSES', processes: allSummaries });

            // Hide virtual workspaces (e.g. global workspace) from repos grid
            const visibleWorkspaces = workspaces.filter((ws: any) => !ws.virtual);

            // Update global workspace list
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });

            // Per-workspace: fetch summary only; derive process stats from global data
            const enriched: RepoData[] = await Promise.all(
                visibleWorkspaces.map(async (ws: any) => {
                    const summaryRes = await fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/summary`).catch(() => null);

                    // Derive process stats by filtering global summaries
                    const wsProcesses = allSummaries.filter((p: any) => p.workspaceId === ws.id);
                    const stats = { success: 0, failed: 0, running: 0 };
                    for (const p of wsProcesses) {
                        if (p.status === 'completed') stats.success++;
                        else if (p.status === 'failed') stats.failed++;
                        else if (p.status === 'running') stats.running++;
                    }

                    return {
                        workspace: ws,
                        gitInfo: { isGitRepo: !!ws.isGitRepo, branch: null, dirty: false },
                        gitInfoLoading: true,
                        workflows: summaryRes?.workflows || [],
                        stats,
                        taskCount: countTasks(summaryRes?.tasks ?? null),
                    };
                })
            );

            // Render cards immediately (git-info still loading)
            setRepos(enriched);
            setLoading(false);

            // Seed per-repo queue stats for card badges
            seedRepoQueueStats(enriched);

            // Fetch per-repo unseen counts from server
            refreshUnseenCounts(enriched.map(r => r.workspace.id));

            // Clear selection if repo was removed.
            // Check against the full workspaces list (not enriched) so virtual
            // workspaces like My Work / My Life don't get deselected on refresh.
            if (selectedRepoIdRef.current && !workspaces.find((ws: any) => ws.id === selectedRepoIdRef.current)) {
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

    // Targeted workflow refresh for a single workspace
    const refreshPipelinesForWorkspace = useCallback(async (wsId: string) => {
        try {
            const summaryRes = await fetchApi(`/workspaces/${encodeURIComponent(wsId)}/summary`);
            const updated = summaryRes?.workflows ?? [];
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
        };
    }, []);

    const value = useMemo<ReposContextValue>(
        () => ({ repos, loading, fetchRepos, unseenCounts, refreshUnseenCounts }),
        [repos, loading, fetchRepos, unseenCounts, refreshUnseenCounts]
    );

    return <ReposContext.Provider value={value}>{children}</ReposContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useRepos(): ReposContextValue {
    const ctx = useContext(ReposContext);
    if (!ctx) throw new Error('useRepos must be used within ReposProvider');
    return ctx;
}
