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
import { fetchUnseenCount } from '../hooks/preferences/seenStateApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { countTasks } from '../repos/repoGrouping';
import { isContainerMode } from '../utils/config';
import { fetchAgentApi } from '../hooks/useApi';
import {
    getWorkspaceGitInfo,
    getWorkspaceGitInfoBatch,
    getWorkspaceSummary,
    listProcessSummaries,
    listQueueRepos,
    listWorkspaces,
} from '../repos/repositoryService';
import { aggregateRemoteWorkspaces, isRemoteWorkspace } from '../repos/remoteWorkspaceAggregation';
import {
    clearPersistedRemoteSelection,
    loadPersistedRemoteSelection,
    persistRemoteSelection,
    resolvePersistedRemoteSelection,
} from '../repos/remoteSelectionPersistence';
import {
    findRepoBySelectionId,
    getRepoSelectionId,
    getWorkspaceSelectionId,
    parseRemoteCloneKey,
} from '../repos/cloneIdentity';
import { setActiveCloneForRouting } from '../repos/cloneRegistry';

import type { RepoData } from '../repos/repoGrouping';
import type { AggregatedRemoteWorkspaces } from '../repos/remoteWorkspaceAggregation';

// ── Context shape ──────────────────────────────────────────────────────

export interface ReposContextValue {
    repos: RepoData[];
    loading: boolean;
    fetchRepos: () => Promise<void>;
    unseenCounts: Record<string, number>;
    refreshUnseenCounts: (wsIds: string[]) => Promise<void>;
}

const ReposContext = createContext<ReposContextValue | null>(null);

/**
 * Build RepoData entries for aggregated remote workspaces. git-info comes from
 * the per-server batch already fetched by the aggregator (online sources); offline
 * (cached) sources have no git-info, so those rows fall back to the workspace's
 * own isGitRepo flag. Remote rows are never re-sent to the local git-info batch.
 */
function buildRemoteRepoData(aggregate: AggregatedRemoteWorkspaces): RepoData[] {
    return aggregate.workspaces.map((ws): RepoData => {
        const git = aggregate.gitInfo[getWorkspaceSelectionId(ws)] ?? aggregate.gitInfo[ws.id];
        return {
            workspace: ws,
            gitInfo: git ?? { isGitRepo: !!ws.isGitRepo, branch: null, dirty: false },
            // Offline (cached) rows never resolve git-info; online rows already have it.
            gitInfoLoading: false,
            workflows: [],
            stats: { success: 0, failed: 0, running: 0 },
            taskCount: 0,
        };
    });
}

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
            const queueReposRes = await listQueueRepos();
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
            // Fetch workspaces, process summaries, and (when features.remoteShell
            // is ON) remote-server workspaces in parallel. aggregateRemoteWorkspaces
            // returns an empty result when the flag is OFF, so the classic flow is
            // unchanged and incurs no remote fetch.
            const [workspaces, processRes, remoteAggregate] = await Promise.all([
                listWorkspaces(),
                listProcessSummaries(5000).catch(() => null),
                aggregateRemoteWorkspaces().catch(() => null),
            ]);
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
                    const summaryRes = await getWorkspaceSummary(ws.id).catch(() => null);

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
                        workflows: (summaryRes?.workflows || []) as any[],
                        stats,
                        taskCount: countTasks(summaryRes?.tasks ?? null),
                    };
                })
            );

            // Merge in remote-server workspaces (features.remoteShell only; empty
            // otherwise). Remote rows already carry git-info from the per-server
            // batch, so they render fully resolved alongside the local cards.
            const remoteRepos = remoteAggregate ? buildRemoteRepoData(remoteAggregate) : [];
            const combined = remoteRepos.length > 0 ? [...enriched, ...remoteRepos] : enriched;

            // Render cards immediately (local git-info still loading; remote resolved)
            setRepos(combined);
            setLoading(false);

            // Seed per-repo queue stats for card badges
            seedRepoQueueStats(combined);

            // Fetch per-repo unseen counts from server
            refreshUnseenCounts(combined.map(r => r.workspace.id));

            // Clear selection if repo was removed.
            // Check against the full workspaces list (not enriched) so virtual
            // workspaces like My Work / My Life don't get deselected on refresh.
            // Remote workspaces are included so a selected remote clone survives a refresh.
            const selectedId = selectedRepoIdRef.current;
            const selectionStillPresent = selectedId
                ? parseRemoteCloneKey(selectedId)
                    ? Boolean(findRepoBySelectionId(remoteRepos, selectedId))
                    : workspaces.some((ws: any) => ws.id === selectedId)
                        || Boolean(findRepoBySelectionId(remoteRepos, selectedId))
                : true;
            if (!selectionStillPresent) {
                dispatch({ type: 'SET_SELECTED_REPO', id: null });
            }

            // Restore a persisted REMOTE-clone selection across reload (AC-08).
            // The remote workspace only appears after aggregation resolves, so we
            // re-apply the selection here, matching the persisted stable
            // { serverId, workspaceId } pair against the freshly-aggregated remote
            // workspaces. Resolution is via serverId (not baseUrl), so a clone whose
            // devtunnel port/baseUrl changed still resolves. We never hijack an
            // unrelated active selection: restore only when nothing is selected (or
            // the missing selection was just cleared above) or the current selection
            // already equals the resolved id. Local selection is untouched — the
            // persisted pair only ever covers remote clones.
            const resolvedRemoteId = resolvePersistedRemoteSelection(
                loadPersistedRemoteSelection(),
                remoteRepos.map(r => r.workspace),
            );
            if (resolvedRemoteId) {
                const current = selectionStillPresent ? selectedRepoIdRef.current : null;
                if (current === null || current === resolvedRemoteId) {
                    if (selectedRepoIdRef.current !== resolvedRemoteId) {
                        dispatch({ type: 'SET_SELECTED_REPO', id: resolvedRemoteId });
                    }
                }
            }

            // Phase 2: Fetch git-info for all workspaces in a single batch request
            gitInfoAbortRef.current?.abort();
            const abortController = new AbortController();
            gitInfoAbortRef.current = abortController;

            const wsIds = enriched.map(r => r.workspace.id);

            if (isContainerMode()) {
                // In container mode, split batch by agent and proxy each
                const byAgent = new Map<string, string[]>();
                for (const r of enriched) {
                    const aid = r.workspace.agentId as string | undefined;
                    if (!aid) continue;
                    if (!byAgent.has(aid)) byAgent.set(aid, []);
                    byAgent.get(aid)!.push(r.workspace.id);
                }
                Promise.all(
                    [...byAgent.entries()].map(([agentId, ids]) =>
                        fetchAgentApi(agentId, '/git-info/batch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ workspaceIds: ids }),
                            signal: abortController.signal,
                        }).catch(() => ({ results: {} }))
                    )
                ).then((responses) => {
                    if (abortController.signal.aborted) return;
                    const merged: Record<string, any> = {};
                    for (const data of responses) Object.assign(merged, data?.results || {});
                    setRepos(prev => prev.map(r => (
                        // Remote rows are resolved by the per-server batch; leave them untouched.
                        isRemoteWorkspace(r.workspace) ? r : {
                            ...r,
                            // Preserve Phase 1 gitInfo (has isGitRepo) when batch result is absent
                            gitInfo: merged[r.workspace.id] || r.gitInfo || undefined,
                            gitInfoLoading: false,
                        }
                    )));
                }).catch((err: unknown) => {
                    if (err instanceof Error && err.name === 'AbortError') return;
                    setRepos(prev => prev.map(r => ({ ...r, gitInfoLoading: false })));
                });
            } else {
            getWorkspaceGitInfoBatch(wsIds, abortController.signal).then((data: any) => {
                if (abortController.signal.aborted) return;
                const results = data?.results || {};
                setRepos(prev => prev.map(r => (
                    // Remote rows are resolved by the per-server batch; leave them untouched.
                    isRemoteWorkspace(r.workspace) ? r : {
                        ...r,
                        gitInfo: results[r.workspace.id] || undefined,
                        gitInfoLoading: false,
                    }
                )));
            }).catch((err: unknown) => {
                if (err instanceof Error && err.name === 'AbortError') return;
                setRepos(prev => prev.map(r => ({ ...r, gitInfoLoading: false })));
            });
            }
        } catch {
            setRepos([]);
            setLoading(false);
        }
    }, [dispatch, refreshUnseenCounts, seedRepoQueueStats]);

    // Targeted workflow refresh for a single workspace
    const refreshPipelinesForWorkspace = useCallback(async (wsId: string) => {
        try {
            const summaryRes = await getWorkspaceSummary(wsId);
            const updated = (summaryRes?.workflows ?? []) as any[];
            setRepos(prev => prev.map(r =>
                r.workspace.id === wsId ? { ...r, workflows: updated } : r
            ));
        } catch { /* fire-and-forget */ }
    }, []);

    // Targeted git-info refresh for a single workspace (triggered by WebSocket)
    const refreshGitInfoForWorkspace = useCallback((wsId: string) => {
        getWorkspaceGitInfo(wsId)
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

    // Persist / clear the remote-clone selection as it changes (AC-08).
    // - Remote selection → persist the stable { serverId, workspaceId } pair.
    // - Known-LOCAL selection → clear any persisted remote pair so it can't fight
    //   the hash-restored local selection on the next reload.
    // - No selection yet, or an id not in the list yet (the cold-load window before
    //   aggregation) → do NOTHING, so the persisted pair survives for the restore
    //   step in fetchRepos. (Clearing on a null selection here would race the
    //   restore and wipe the pair before it can be read.)
    // Local behavior is otherwise unchanged: locals never write a remote pair; the
    // only extra action for a known-local selection is dropping a stale REMOTE key.
    useEffect(() => {
        const selectedId = appState.selectedRepoId;
        if (!selectedId) {
            setActiveCloneForRouting(null);
            return;
        }
        const selected = findRepoBySelectionId(repos, selectedId);
        if (!selected) {
            setActiveCloneForRouting(selectedId);
            return;
        }
        if (isRemoteWorkspace(selected.workspace)) {
            setActiveCloneForRouting(getRepoSelectionId(selected));
            persistRemoteSelection({
                serverId: selected.workspace.remote.serverId,
                workspaceId: selected.workspace.id,
            });
        } else {
            setActiveCloneForRouting(null);
            clearPersistedRemoteSelection();
        }
    }, [appState.selectedRepoId, repos]);

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

/**
 * Non-throwing variant: returns the repos context, or `null` when used outside a
 * ReposProvider (e.g. the pop-out chat window, which boots a minimal provider
 * stack). Callers degrade gracefully instead of crashing the subtree.
 */
export function useReposOptional(): ReposContextValue | null {
    return useContext(ReposContext);
}
