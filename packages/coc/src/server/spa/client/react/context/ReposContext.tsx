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
import { useWebSocket } from '../hooks/useWebSocket';
import { countTasks } from '../repos/repoGrouping';
import { fetchWorkflows } from '../repos/workflow-api';
import { computeUnseenCount } from '../hooks/useUnseenActivity';
import type { RepoData } from '../repos/repoGrouping';

// ── Context shape ──────────────────────────────────────────────────────

export interface ReposContextValue {
    repos: RepoData[];
    loading: boolean;
    fetchRepos: () => Promise<void>;
    unseenCounts: Record<string, number>;
}

const ReposContext = createContext<ReposContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────

export function ReposProvider({ children }: { children: ReactNode }) {
    const { dispatch } = useApp();
    const { state: queueState, dispatch: queueDispatch } = useQueue();

    const [repos, setRepos] = useState<RepoData[]>([]);
    const [loading, setLoading] = useState(true);

    const selectedRepoIdRef = useRef<string | null>(null);

    // Keep selectedRepoId in a ref so fetchRepos doesn't recreate on every selection change
    const { state: appState } = useApp();
    selectedRepoIdRef.current = appState.selectedRepoId;

    const processThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gitInfoAbortRef = useRef<AbortController | null>(null);

    // Bump this counter whenever the user marks tasks as read/unread so the
    // useMemo below re-evaluates (localStorage changes don't update queueState).
    const [seenVersion, setSeenVersion] = useState(0);
    useEffect(() => {
        const handler = () => setSeenVersion(v => v + 1);
        window.addEventListener('coc-seen-updated', handler);
        return () => window.removeEventListener('coc-seen-updated', handler);
    }, []);

    // Compute per-repo unseen counts for the tab strip badge.
    const unseenCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const [repoId, repoQueue] of Object.entries(queueState.repoQueueMap)) {
            const count = computeUnseenCount(repoId, repoQueue.history ?? []);
            if (count > 0) counts[repoId] = count;
        }
        return counts;
    }, [queueState.repoQueueMap, seenVersion]);

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
        };
    }, []);

    const value = useMemo<ReposContextValue>(
        () => ({ repos, loading, fetchRepos, unseenCounts }),
        [repos, loading, fetchRepos, unseenCounts]
    );

    return <ReposContext.Provider value={value}>{children}</ReposContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useRepos(): ReposContextValue {
    const ctx = useContext(ReposContext);
    if (!ctx) throw new Error('useRepos must be used within ReposProvider');
    return ctx;
}
