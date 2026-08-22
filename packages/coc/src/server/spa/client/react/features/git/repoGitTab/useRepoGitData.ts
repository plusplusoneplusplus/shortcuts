/**
 * useRepoGitData — commit list, branch range, and repo state for the Git tab.
 *
 * Owns every read of git data the tab renders: paginated/searchable commits,
 * the branch range (with its base-mode toggle), in-progress merge/rebase state,
 * the client-side caches for the first commit page and the branch range, and
 * the `lastRefreshedAt` stamp.
 *
 * All requests go through the clone-routed client for `workspaceId` (AC-07), so
 * a multi-repo view never reads one clone's history against another's server.
 *
 * Selection is NOT owned here. `refreshAll` decides which commit should stay
 * selected via the pure `reconcileSelectionAfterRefresh` model and hands the
 * result to the caller-supplied `selection` bridge, so data loading and right-
 * panel routing stay independently testable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import type { GitCommitItem } from '../commits/CommitList';
import type { BranchRangeInfo } from '../branches/BranchChanges';
import { clearCacheForHash } from '../hooks/useCommitDiffCache';
import { getBranchRangeCache, setBranchRangeCache, clearBranchRangeCache } from '../hooks/useBranchRangeCache';
import { getCommitsCache, setCommitsCache, clearCommitsCache } from '../hooks/useCommitsCache';
import { useBranchRangeBaseMode } from '../hooks/useBranchRangeBaseMode';
import { reconcileSelectionAfterRefresh, selectedCommitHashOf } from './selectionModel';
import type { GitRepoStateInfo, RefreshSelectionOptions, RightPanelView } from './types';

/** Commits requested per page; also the "there may be more" threshold. */
export const COMMIT_PAGE_SIZE = 50;

/** How `refreshAll` reads and writes the right-panel selection it must reconcile. */
export interface RepoGitDataSelectionBridge {
    /** The view as of *now* — read at call time, not captured at hook creation. */
    getView: () => RightPanelView | null;
    /** Apply a reconciled view. Only called when the model says it changed. */
    setView: (view: RightPanelView | null) => void;
}

export interface UseRepoGitDataOptions {
    workspaceId: string;
    selection: RepoGitDataSelectionBridge;
    /**
     * Called once per successful initial load (and per retry / workspace switch)
     * with the first commit page. The selection hook uses it to hydrate a deep
     * link, which is why data loading does not choose the initial view itself.
     */
    onInitialLoad?: (loaded: GitCommitItem[]) => void;
}

export interface UseRepoGitDataReturn {
    // Commits
    commits: GitCommitItem[];
    unpushedCount: number;
    hasMore: boolean;
    isLoadingMore: boolean;
    loadMore: () => void;
    // Search
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    // Load / error state
    loading: boolean;
    error: string | null;
    retry: () => void;
    refreshing: boolean;
    refreshError: string | null;
    setRefreshError: (message: string | null) => void;
    // Branch range
    branchRangeData: BranchRangeInfo | null;
    branchRangeFiles: any[];
    resolvedBaseRef: string | null;
    onDefaultBranch: boolean;
    branchName: string;
    setBranchName: (name: string) => void;
    ahead: number;
    behind: number;
    baseMode: GitRangeBaseMode;
    setBaseModeAndRefetch: (mode: GitRangeBaseMode) => void;
    // Repo state / freshness
    repoState: GitRepoStateInfo | null;
    lastRefreshedAt: number | null;
    workingChangesRefreshKey: number;
    // Refresh
    refreshAll: (options?: RefreshSelectionOptions) => void;
    /** Re-fetch commits + branch range from scratch (branch switch). */
    reloadAfterBranchSwitch: () => void;
    /** Raw commit fetch — exposed for the websocket rewrite-rebind path. */
    fetchCommits: (refresh?: boolean, skipOffset?: number, search?: string) => Promise<GitCommitItem[]>;
    /** Raw branch-range fetch — exposed for the websocket refresh path. */
    fetchBranchRange: (refresh?: boolean, modeOverride?: GitRangeBaseMode) => Promise<BranchRangeInfo | null>;
    /** Stamp a successful out-of-band refresh (websocket) as fresh. */
    markRefreshed: () => void;
    /** Bump the working-tree/worktree refresh key without a full refresh. */
    bumpWorkingChanges: () => void;
    /** Commit hashes currently rendered — the classification-badge query set. */
    visibleCommitHashes: string[];
    /** Reorder preview: the pending order, or null when not reordering. */
    pendingReorder: GitCommitItem[] | null;
    setPendingReorder: (order: GitCommitItem[] | null) => void;
}

export function useRepoGitData({ workspaceId, selection, onInitialLoad }: UseRepoGitDataOptions): UseRepoGitDataReturn {
    // AC-07: ALL Git tab data targets the selected clone's server.
    const cloneClient = useCocClient(workspaceId);

    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [skip, setSkip] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [unpushedCount, setUnpushedCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [workingChangesRefreshKey, setWorkingChangesRefreshKey] = useState(0);
    const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
    const [repoState, setRepoState] = useState<GitRepoStateInfo | null>(null);
    const [pendingReorder, setPendingReorder] = useState<GitCommitItem[] | null>(null);

    // Branch-range state (lifted from BranchChanges)
    const [baseMode, setBaseMode] = useBranchRangeBaseMode(workspaceId);
    const [branchRangeData, setBranchRangeData] = useState<BranchRangeInfo | null>(null);
    const [branchRangeFiles, setBranchRangeFiles] = useState<any[]>([]);
    /** Base ref the server resolved, kept even when there is no range to show. */
    const [resolvedBaseRef, setResolvedBaseRef] = useState<string | null>(null);
    const [onDefaultBranch, setOnDefaultBranch] = useState(false);
    const [branchName, setBranchName] = useState<string>('');
    const [ahead, setAhead] = useState(0);
    const [behind, setBehind] = useState(0);

    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const markRefreshed = useCallback(() => setLastRefreshedAt(Date.now()), []);
    const bumpWorkingChanges = useCallback(() => setWorkingChangesRefreshKey(k => k + 1), []);
    const retry = useCallback(() => setRetryKey(k => k + 1), []);

    const fetchRepoState = useCallback(() => {
        cloneClient.git.getRepoState(workspaceId)
            .then(data => setRepoState(data))
            .catch(() => setRepoState(null));
    }, [workspaceId]);

    const fetchCommits = useCallback((refresh = false, skipOffset = 0, search = '') => {
        // For the initial page with no search, check/update the client-side cache.
        if (skipOffset === 0 && !search) {
            if (refresh) {
                clearCommitsCache(workspaceId);
            } else {
                const cached = getCommitsCache(workspaceId);
                if (cached) {
                    setCommits(cached.commits);
                    setUnpushedCount(cached.unpushedCount);
                    setHasMore(cached.hasMore);
                    return Promise.resolve(cached.commits);
                }
            }
        }
        return cloneClient.git.listCommits(workspaceId, {
            limit: COMMIT_PAGE_SIZE,
            skip: skipOffset > 0 ? skipOffset : undefined,
            refresh,
            search: search || undefined,
        })
            .then(data => {
                const loaded = data.commits || [];
                if (skipOffset > 0) {
                    setCommits(prev => [...prev, ...loaded]);
                } else {
                    setCommits(loaded);
                    setUnpushedCount(data.unpushedCount || 0);
                    if (!search) {
                        setCommitsCache(workspaceId, {
                            commits: loaded,
                            unpushedCount: data.unpushedCount || 0,
                            hasMore: loaded.length === COMMIT_PAGE_SIZE,
                        });
                    }
                }
                setHasMore(loaded.length === COMMIT_PAGE_SIZE);
                return loaded;
            });
    }, [workspaceId]);

    // Read through a ref so switching the base mode doesn't change this callback's
    // identity (which would re-run the whole initial-load effect and reset the
    // right panel). The toggle passes the new mode explicitly instead.
    const baseModeRef = useRef(baseMode);
    baseModeRef.current = baseMode;

    const fetchBranchRange = useCallback((refresh = false, modeOverride?: GitRangeBaseMode) => {
        const mode = modeOverride ?? baseModeRef.current;
        if (refresh) {
            clearBranchRangeCache(workspaceId);
        } else {
            const cached = getBranchRangeCache(workspaceId, mode);
            if (cached) {
                setBranchRangeData(cached.data);
                setBranchRangeFiles(cached.files);
                setBranchName(cached.branchName);
                setOnDefaultBranch(cached.onDefaultBranch);
                setAhead(cached.ahead);
                setBehind(cached.behind);
                setResolvedBaseRef(cached.baseRef ?? null);
                return Promise.resolve(cached.data);
            }
        }
        return cloneClient.git.getBranchRange(workspaceId, { refresh, base: mode })
            .then(data => {
                if (data.onDefaultBranch) {
                    setOnDefaultBranch(true);
                    setBranchRangeData(null);
                    setBranchRangeFiles([]);
                    const resolvedBranchName = data.branchName || data.defaultBranch || '';
                    setBranchName(resolvedBranchName);
                    setAhead(0);
                    setBehind(0);
                    setResolvedBaseRef(data.baseRef ?? null);
                    setBranchRangeCache(workspaceId, {
                        data: null, files: [], ahead: 0, behind: 0,
                        branchName: resolvedBranchName,
                        onDefaultBranch: true,
                        baseRef: data.baseRef,
                        baseModeFallback: data.baseModeFallback,
                    }, mode);
                    return null as BranchRangeInfo | null;
                } else {
                    setOnDefaultBranch(false);
                    const rangeInfo: BranchRangeInfo = {
                        baseRef: data.baseRef,
                        headRef: data.headRef,
                        commitCount: data.commitCount,
                        additions: data.additions,
                        deletions: data.deletions,
                        mergeBase: data.mergeBase,
                        branchName: data.branchName,
                        fileCount: Array.isArray(data.files) ? data.files.length : 0,
                        baseMode: data.baseMode,
                        baseModeFallback: data.baseModeFallback,
                    };
                    const files = Array.isArray(data.files) ? data.files : [];
                    setBranchRangeData(rangeInfo);
                    setBranchRangeFiles(files);
                    setBranchName(data.branchName || data.headRef || '');
                    setAhead(data.commitCount || 0);
                    setBehind(data.behindCount || 0);
                    setResolvedBaseRef(data.baseRef ?? null);
                    setBranchRangeCache(workspaceId, {
                        data: rangeInfo, files, ahead: data.commitCount || 0,
                        behind: data.behindCount || 0,
                        branchName: data.branchName || data.headRef || '',
                        onDefaultBranch: false,
                        baseRef: data.baseRef,
                        baseModeFallback: data.baseModeFallback,
                    }, mode);
                    return rangeInfo;
                }
            })
            .catch(() => {
                setOnDefaultBranch(true);
                setBranchRangeData(null);
                return null as BranchRangeInfo | null;
            });
    }, [workspaceId]);

    /** Switch the comparison base (vs default branch ⇄ unpushed) and refetch. */
    const setBaseModeAndRefetch = useCallback((mode: GitRangeBaseMode) => {
        if (mode === baseModeRef.current) return;
        setBaseMode(mode);
        baseModeRef.current = mode;
        void fetchBranchRange(false, mode);
    }, [setBaseMode, fetchBranchRange]);

    // Debounced commit search. Each keystroke resets pagination and refetches the
    // first page; the query is also re-applied when the workspace changes.
    useEffect(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(() => {
            searchDebounceRef.current = null;
            setSkip(0);
            setCommits([]);
            fetchCommits(false, 0, searchQuery).catch(() => {});
        }, 300);
        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, workspaceId]);

    // Refresh all data (non-blocking, keeps current content visible)
    const refreshingRef = useRef(refreshing);
    refreshingRef.current = refreshing;
    const searchQueryRef = useRef(searchQuery);
    searchQueryRef.current = searchQuery;

    const refreshAll = useCallback((options?: RefreshSelectionOptions) => {
        if (refreshingRef.current) return;
        setRefreshing(true);
        setRefreshError(null);
        setSkip(0);
        bumpWorkingChanges();
        fetchRepoState();
        const viewBeforeRefresh = selection.getView();
        const prevSelectedHash = selectedCommitHashOf(viewBeforeRefresh);
        if (prevSelectedHash) {
            clearCacheForHash(prevSelectedHash);
        }
        Promise.all([fetchCommits(true, 0, searchQueryRef.current), fetchBranchRange(true)])
            .then(([loaded]) => {
                markRefreshed();
                const { changed, next } = reconcileSelectionAfterRefresh(viewBeforeRefresh, loaded, options);
                if (changed) selection.setView(next);
            })
            .catch(err => setRefreshError(err.message || 'Refresh failed'))
            .finally(() => setRefreshing(false));
    }, [selection, fetchCommits, fetchBranchRange, fetchRepoState, bumpWorkingChanges, markRefreshed]);

    // Load more commits (append next page)
    const loadMore = useCallback(() => {
        if (isLoadingMore || !hasMore) return;
        setIsLoadingMore(true);
        const nextSkip = skip + COMMIT_PAGE_SIZE;
        fetchCommits(false, nextSkip, searchQuery)
            .then(() => setSkip(nextSkip))
            .catch(() => {})
            .finally(() => setIsLoadingMore(false));
    }, [isLoadingMore, hasMore, skip, fetchCommits, searchQuery]);

    const reloadAfterBranchSwitch = useCallback(() => {
        setSkip(0);
        void fetchBranchRange(true);
        void fetchCommits(true);
    }, [fetchBranchRange, fetchCommits]);

    // Classification status is checked in bulk, so each commit row can show a
    // ✓ badge; the reorder preview is what's on screen while reordering.
    const visibleCommitHashes = useMemo(
        () => (pendingReorder || commits).map(c => c.hash),
        [pendingReorder, commits],
    );

    // Initial load — also re-runs on workspace switch and on `retry()`. The
    // deep-link hydration that follows a successful load is the caller's job
    // (`onInitialLoad`), so this effect stays purely about fetching.
    const onInitialLoadRef = useRef(onInitialLoad);
    onInitialLoadRef.current = onInitialLoad;

    useEffect(() => {
        setLoading(true);
        setError(null);
        setSkip(0);
        fetchRepoState();
        Promise.all([fetchCommits(), fetchBranchRange()])
            .then(([loaded]) => {
                markRefreshed();
                onInitialLoadRef.current?.(loaded);
            })
            .catch(err => setError(err.message || 'Failed to load commits'))
            .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId, fetchCommits, fetchBranchRange, fetchRepoState, retryKey]);

    return {
        commits, unpushedCount, hasMore, isLoadingMore, loadMore,
        searchQuery, setSearchQuery,
        loading, error, retry, refreshing, refreshError, setRefreshError,
        branchRangeData, branchRangeFiles, resolvedBaseRef, onDefaultBranch,
        branchName, setBranchName, ahead, behind, baseMode, setBaseModeAndRefetch,
        repoState, lastRefreshedAt, workingChangesRefreshKey,
        refreshAll, reloadAfterBranchSwitch,
        fetchCommits, fetchBranchRange, markRefreshed, bumpWorkingChanges,
        visibleCommitHashes, pendingReorder, setPendingReorder,
    };
}
