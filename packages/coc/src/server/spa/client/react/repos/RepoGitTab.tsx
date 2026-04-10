/**
 * RepoGitTab — Git commit history tab with left/right split layout.
 *
 * Left panel: GitPanelHeader + scenario banner + scrollable commit list
 * (UNPUSHED + HISTORY sections).
 * Right panel: detail view for the selected commit (metadata, files, diff).
 * Auto-selects the most recent commit on load.
 * Falls back to stacked vertical layout on narrow viewports (<1024px).
 *
 * Branch-range data is fetched here and passed down to BranchChanges and
 * GitPanelHeader so both can display branch/ahead/behind information.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { getApiBase } from '../utils/config';
import { Spinner } from '../shared';
import { CommitList } from './CommitList';
import { CommitDetail } from './CommitDetail';
import { BranchRangeOverview } from './BranchRangeOverview';

import { BranchChanges } from './BranchChanges';
import { FileDiffPanel } from './FileDiffPanel';
import { createCommitDiffSource, createBranchRangeDiffSource } from './diffSource';
import { GitPanelHeader } from './GitPanelHeader';
import { WorkingTree } from './WorkingTree';
import { WorkingTreeFileDiff } from './WorkingTreeFileDiff';
import { WorkingTreeAllComments } from './WorkingTreeAllComments';
import { BranchRangeAllComments } from './BranchRangeAllComments';
import { BranchPickerModal } from './BranchPickerModal';
import { AmendMessageModal } from './AmendMessageModal';
import { clearCacheForHash } from './useCommitDiffCache';
import { getBranchRangeCache, setBranchRangeCache, clearBranchRangeCache } from './useBranchRangeCache';
import { getCommitsCache, setCommitsCache, clearCommitsCache } from './useCommitsCache';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu';
import type { GitCommitItem } from './CommitList';
import type { BranchRangeInfo } from './BranchChanges';
import { buildFixupGroups } from './fixup-utils';

/**
 * Best-effort rebind of commit-chat binding when a hash changes.
 * Fires and forgets — failure is silent (the old binding simply orphans).
 */
async function rebindCommitChat(
    workspaceId: string,
    oldHash: string,
    newHash: string
): Promise<void> {
    if (oldHash === newHash) return;
    try {
        await fetchApi(
            `/workspaces/${encodeURIComponent(workspaceId)}/commit-chat-bindings/rebind`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldHash, newHash }),
            }
        );
    } catch {
        // Best-effort — binding may not exist; ignore errors
    }
}

/**
 * Heuristic matching of old commits to new commits after a rewrite.
 * Returns an array of { oldHash, newHash } pairs where identity matched
 * but hash changed.
 *
 * Identity key: `${subject}\0${author}\0${authorEmail}\0${date}`
 *
 * Only 1:1 matches are returned — if multiple old commits share the same
 * identity key (e.g., duplicate "fix typo" commits), none of them match
 * to avoid incorrect rebinding.
 */
export function matchCommitsByIdentity(
    oldCommits: GitCommitItem[],
    newCommits: GitCommitItem[]
): Array<{ oldHash: string; newHash: string }> {
    const identityKey = (c: GitCommitItem) =>
        `${c.subject}\0${c.author}\0${c.authorEmail ?? ''}\0${c.date}`;

    const oldMap = new Map<string, GitCommitItem[]>();
    for (const c of oldCommits) {
        const key = identityKey(c);
        const arr = oldMap.get(key) || [];
        arr.push(c);
        oldMap.set(key, arr);
    }

    const newMap = new Map<string, GitCommitItem[]>();
    for (const c of newCommits) {
        const key = identityKey(c);
        const arr = newMap.get(key) || [];
        arr.push(c);
        newMap.set(key, arr);
    }

    const pairs: Array<{ oldHash: string; newHash: string }> = [];
    for (const [key, oldArr] of oldMap) {
        if (oldArr.length !== 1) continue;
        const newArr = newMap.get(key);
        if (!newArr || newArr.length !== 1) continue;
        const oldC = oldArr[0];
        const newC = newArr[0];
        if (oldC.hash !== newC.hash) {
            pairs.push({ oldHash: oldC.hash, newHash: newC.hash });
        }
    }

    return pairs;
}

interface RepoGitTabProps {
    workspaceId: string;
}

type RightPanelView =
    | { type: 'commit'; commit: GitCommitItem }
    | { type: 'commit-file'; hash: string; filePath: string }
    | { type: 'branch-range' }
    | { type: 'branch-file'; filePath: string }
    | { type: 'working-tree-file'; filePath: string; stage: 'staged' | 'unstaged' | 'untracked' }
    | { type: 'working-tree-comments' }
    | { type: 'branch-range-comments' }
    | { type: 'multi-commit'; commits: GitCommitItem[] };

export function RepoGitTab({ workspaceId }: RepoGitTabProps) {
    const { state, dispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const { width: sidebarWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 320,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'git-sidebar-width',
    });
    const initialCommitHash = state.selectedGitCommitHash;
    const initialFilePath = state.selectedGitFilePath;
    const consumedDeepLinkRef = useRef<string | null>(initialCommitHash);
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
    const [actionError, setActionError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [pushing, setPushing] = useState(false);
    const [rebasing, setRebasing] = useState(false);
    const pullJobRef = useRef<string | null>(null);
    const pullPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [rightPanelView, setRightPanelView] = useState<RightPanelView | null>(null);
    const [hunkTarget, setHunkTarget] = useState<'first' | 'last' | undefined>();
    const [workingChangesRefreshKey, setWorkingChangesRefreshKey] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Branch-range state (lifted from BranchChanges)
    const [branchRangeData, setBranchRangeData] = useState<BranchRangeInfo | null>(null);
    const [branchRangeFiles, setBranchRangeFiles] = useState<any[]>([]);
    const [onDefaultBranch, setOnDefaultBranch] = useState(false);
    const [branchName, setBranchName] = useState<string>('');
    const [ahead, setAhead] = useState(0);
    const [behind, setBehind] = useState(0);

    // Skills + context menu state
    const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'commit' | 'branch-range' | 'multi-commit'; commit?: GitCommitItem; commits?: GitCommitItem[] } | null>(null);
    const [enqueueToast, setEnqueueToast] = useState<string | null>(null);
    const [branchPickerOpen, setBranchPickerOpen] = useState(false);
    const [amendingCommit, setAmendingCommit] = useState<GitCommitItem | null>(null);
    const [rewordingCommit, setRewordingCommit] = useState<GitCommitItem | null>(null);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    // Repo state (merge/rebase/cherry-pick in progress)
    const [repoState, setRepoState] = useState<{ operation: string; conflictFiles: string[] } | null>(null);

    // Last-refreshed timestamp (epoch ms) — updated after any successful git data fetch
    const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

    // Reorder state: pendingReorder holds the new commit order before user confirms
    const [pendingReorder, setPendingReorder] = useState<GitCommitItem[] | null>(null);

    const fetchRepoState = useCallback(() => {
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/repo-state`)
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
        const skipQs = skipOffset > 0 ? `&skip=${skipOffset}` : '';
        const refreshQs = refresh ? '&refresh=true' : '';
        const searchQs = search ? `&search=${encodeURIComponent(search)}` : '';
        return fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits?limit=50${skipQs}${refreshQs}${searchQs}`)
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
                            hasMore: loaded.length === 50,
                        });
                    }
                }
                setHasMore(loaded.length === 50);
                return loaded;
            });
    }, [workspaceId]);

    const fetchBranchRange = useCallback((refresh = false) => {
        if (refresh) {
            clearBranchRangeCache(workspaceId);
        } else {
            const cached = getBranchRangeCache(workspaceId);
            if (cached) {
                setBranchRangeData(cached.data);
                setBranchRangeFiles(cached.files);
                setBranchName(cached.branchName);
                setOnDefaultBranch(cached.onDefaultBranch);
                setAhead(cached.ahead);
                setBehind(cached.behind);
                return Promise.resolve(cached.data);
            }
        }
        const qs = refresh ? '?refresh=true' : '';
        return fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range${qs}`)
            .then(data => {
                if (data.onDefaultBranch) {
                    setOnDefaultBranch(true);
                    setBranchRangeData(null);
                    setBranchRangeFiles([]);
                    setBranchName(data.branchName || data.defaultBranch || 'main');
                    setAhead(0);
                    setBehind(0);
                    setBranchRangeCache(workspaceId, {
                        data: null, files: [], ahead: 0, behind: 0,
                        branchName: data.branchName || data.defaultBranch || 'main',
                        onDefaultBranch: true,
                    });
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
                    };
                    const files = Array.isArray(data.files) ? data.files : [];
                    setBranchRangeData(rangeInfo);
                    setBranchRangeFiles(files);
                    setBranchName(data.branchName || data.headRef || '');
                    setAhead(data.commitCount || 0);
                    setBehind(data.behindCount || 0);
                    setBranchRangeCache(workspaceId, {
                        data: rangeInfo, files, ahead: data.commitCount || 0,
                        behind: data.behindCount || 0,
                        branchName: data.branchName || data.headRef || '',
                        onDefaultBranch: false,
                    });
                    return rangeInfo;
                }
            })
            .catch(() => {
                setOnDefaultBranch(true);
                setBranchRangeData(null);
                return null as BranchRangeInfo | null;
            });
    }, [workspaceId]);

    // Initial load
    useEffect(() => {
        setLoading(true);
        setError(null);
        setSkip(0);
        fetchRepoState();
        Promise.all([fetchCommits(), fetchBranchRange()])
            .then(([loaded, rangeInfo]) => {
                setLastRefreshedAt(Date.now());
                if (initialCommitHash === 'branch-range') {
                    // Restore branch-range deep link
                    if (initialFilePath) {
                        setRightPanelView({ type: 'branch-file', filePath: initialFilePath });
                    } else {
                        setRightPanelView({ type: 'branch-range' });
                    }
                } else {
                    const target = initialCommitHash
                        ? loaded.find((c: GitCommitItem) => c.hash.startsWith(initialCommitHash))
                        : null;
                    if (target && initialFilePath) {
                        setRightPanelView({ type: 'commit-file', hash: target.hash, filePath: initialFilePath });
                    } else if (target) {
                        setRightPanelView({ type: 'commit', commit: target });
                    } else {
                        // Default to empty right panel; user must click to open something.
                        setRightPanelView(null);
                    }
                }
            })
            .catch(err => setError(err.message || 'Failed to load commits'))
            .finally(() => setLoading(false));
    }, [workspaceId, fetchCommits, fetchBranchRange, retryKey]);

    // Deep-link navigation after mount: when state.selectedGitCommitHash changes
    // (e.g. clicking a commit link from the activity tab), select the target commit.
    useEffect(() => {
        const hash = state.selectedGitCommitHash;
        if (!hash || hash === 'branch-range' || loading) return;
        if (hash === consumedDeepLinkRef.current) return;
        consumedDeepLinkRef.current = hash;
        const target = commits.find(c => c.hash.startsWith(hash));
        if (!target) return;
        const filePath = state.selectedGitFilePath;
        if (filePath) {
            setRightPanelView({ type: 'commit-file', hash: target.hash, filePath });
        } else {
            setRightPanelView({ type: 'commit', commit: target });
        }
    }, [state.selectedGitCommitHash, state.selectedGitFilePath, loading, commits]);

    // Fetch skills once per workspace
    useEffect(() => {
        setSkills([]);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/skills`)
            .then(data => {
                if (data?.skills && Array.isArray(data.skills)) {
                    setSkills(data.skills);
                }
            })
            .catch(() => {});
    }, [workspaceId]);

    // Debounced search: when searchQuery changes, reset pagination and re-fetch
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
    const refreshAll = useCallback(() => {
        if (refreshing) return;
        setRefreshing(true);
        setRefreshError(null);
        setActionError(null);
        setSkip(0);
        setWorkingChangesRefreshKey(k => k + 1);
        fetchRepoState();
        const prevSelectedHash = rightPanelView?.type === 'commit' ? rightPanelView.commit.hash : rightPanelView?.type === 'commit-file' ? rightPanelView.hash : null;
        if (prevSelectedHash) {
            clearCacheForHash(prevSelectedHash);
        }
        Promise.all([fetchCommits(true, 0, searchQuery), fetchBranchRange(true)])
            .then(([loaded]) => {
                setLastRefreshedAt(Date.now());
                // Retain selection if the commit still exists
                if (prevSelectedHash) {
                    const found = loaded.find((c: GitCommitItem) => c.hash === prevSelectedHash);
                    if (found) {
                        // Preserve commit-file view if that's the current type
                        if (rightPanelView?.type === 'commit-file') {
                            // keep as-is
                        } else {
                            setRightPanelView({ type: 'commit', commit: found });
                        }
                    } else if (loaded.length > 0) {
                        setRightPanelView({ type: 'commit', commit: loaded[0] });
                    } else {
                        setRightPanelView(null);
                    }
                } else if (rightPanelView?.type === 'branch-file' || rightPanelView?.type === 'branch-range' || rightPanelView?.type === 'working-tree-file' || rightPanelView?.type === 'working-tree-comments' || rightPanelView?.type === 'branch-range-comments') {
                    // Keep the branch-file / branch-range / working-tree-file / working-tree-comments / branch-range-comments view as-is during refresh
                } else if (rightPanelView === null) {
                    // No prior selection — keep list visible (preserves mobile back state)
                } else if (loaded.length > 0) {
                    setRightPanelView({ type: 'commit', commit: loaded[0] });
                }
            })
            .catch(err => setRefreshError(err.message || 'Refresh failed'))
            .finally(() => setRefreshing(false));
    }, [refreshing, rightPanelView, fetchCommits, fetchBranchRange, searchQuery]);

    // Load more commits (append next page)
    const handleLoadMore = useCallback(() => {
        if (isLoadingMore || !hasMore) return;
        setIsLoadingMore(true);
        const nextSkip = skip + 50;
        fetchCommits(false, nextSkip, searchQuery)
            .then(() => setSkip(nextSkip))
            .catch(() => {})
            .finally(() => setIsLoadingMore(false));
    }, [isLoadingMore, hasMore, skip, fetchCommits, searchQuery]);

    // WebSocket: auto-refresh on git-changed events for this workspace
    const gitChangedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevCommitsRef = useRef<GitCommitItem[]>([]);

    useWebSocket({
        onMessage: useCallback((msg: any) => {
            if (msg.type === 'git-changed' && msg.workspaceId === workspaceId) {
                if (gitChangedDebounceRef.current) clearTimeout(gitChangedDebounceRef.current);
                gitChangedDebounceRef.current = setTimeout(() => {
                    gitChangedDebounceRef.current = null;
                    // Snapshot current commits before the refresh overwrites them
                    prevCommitsRef.current = commits;
                    // Re-fetch commits and working tree but NOT branch range (cached)
                    fetchCommits(true, 0, searchQuery).then((newCommits: GitCommitItem[]) => {
                        setLastRefreshedAt(Date.now());
                        // Heuristic rebind: match old→new commits by identity
                        const pairs = matchCommitsByIdentity(prevCommitsRef.current, newCommits);
                        for (const { oldHash, newHash } of pairs) {
                            rebindCommitChat(workspaceId, oldHash, newHash);
                        }
                        prevCommitsRef.current = [];
                    });
                    setWorkingChangesRefreshKey(k => k + 1);
                }, 500);
                // If we're tracking a pull job, re-fetch its status on git-changed
                if (pullJobRef.current) {
                    fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/ops/${encodeURIComponent(pullJobRef.current)}`)
                        .then((job: any) => {
                            if (job && job.status !== 'running') {
                                stopPullPolling();
                                if (job.status === 'failed') {
                                    setActionError(job.error || 'Pull failed');
                                }
                            }
                        })
                        .catch(() => {});
                }
            }
        }, [workspaceId, commits, fetchCommits, searchQuery]),
    });

    // Pull job polling helpers
    const stopPullPolling = useCallback(() => {
        if (pullPollRef.current) {
            clearInterval(pullPollRef.current);
            pullPollRef.current = null;
        }
        pullJobRef.current = null;
        setPulling(false);
    }, []);

    const startPullPolling = useCallback((jobId: string) => {
        pullJobRef.current = jobId;
        setPulling(true);
        if (pullPollRef.current) clearInterval(pullPollRef.current);
        pullPollRef.current = setInterval(async () => {
            try {
                const job = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/ops/${encodeURIComponent(jobId)}`);
                if (!job || job.status !== 'running') {
                    stopPullPolling();
                    if (job?.status === 'failed') {
                        setActionError(job.error || 'Pull failed');
                    } else {
                        refreshAll();
                    }
                }
            } catch {
                stopPullPolling();
            }
        }, 3000);
    }, [workspaceId, stopPullPolling, refreshAll]);

    // Stable refs so mount-recovery effect doesn't re-fire on callback identity changes
    const startPullPollingRef = useRef(startPullPolling);
    startPullPollingRef.current = startPullPolling;
    const stopPullPollingRef = useRef(stopPullPolling);
    stopPullPollingRef.current = stopPullPolling;

    // Recover pull status on mount (page refresh recovery)
    useEffect(() => {
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/ops/latest?op=pull`)
            .then((job: any) => {
                if (!job) return;
                if (job.status === 'running') {
                    startPullPollingRef.current(job.id);
                } else if (job.status === 'failed' && job.finishedAt) {
                    const elapsed = Date.now() - new Date(job.finishedAt).getTime();
                    if (elapsed < 5 * 60 * 1000) { // 5 min TTL
                        setActionError(job.error || 'Pull failed');
                    }
                }
            })
            .catch(() => {});
        return () => { stopPullPollingRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    // Git action handlers
    const handleFetch = useCallback(async () => {
        if (fetching) return;
        setFetching(true);
        setActionError(null);
        try {
            const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/fetch`, {
                method: 'POST',
            });
            if (result.success === false) throw new Error(result.error || 'Fetch failed');
            refreshAll();
        } catch (err: any) {
            setActionError(err.message || 'Fetch failed');
        } finally {
            setFetching(false);
        }
    }, [fetching, workspaceId, refreshAll]);

    const handlePull = useCallback(async () => {
        if (pulling) return;
        setPulling(true);
        setActionError(null);
        try {
            const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rebase: true }),
            });
            if (result.jobId) {
                // Async pull — start polling for job completion
                startPullPolling(result.jobId);
            } else if (result.success === false) {
                throw new Error(result.error || 'Pull failed');
            } else {
                refreshAll();
                setPulling(false);
            }
        } catch (err: any) {
            setActionError(err.message || 'Pull failed');
            setPulling(false);
        }
    }, [pulling, workspaceId, refreshAll, startPullPolling]);

    const handlePush = useCallback(async () => {
        if (pushing) return;
        setPushing(true);
        setActionError(null);
        try {
            const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (result.success === false) throw new Error(result.error || 'Push failed');
            refreshAll();
        } catch (err: any) {
            setActionError(err.message || 'Push failed');
        } finally {
            setPushing(false);
        }
    }, [pushing, workspaceId, refreshAll]);

    const handlePushToCommit = useCallback(async (commit: GitCommitItem) => {
        closeContextMenu();
        setPushing(true);
        setActionError(null);
        try {
            const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/push-to`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commitHash: commit.hash }),
            });
            if (result.success === false) throw new Error(result.error || 'Push failed');
            refreshAll();
        } catch (err: any) {
            setActionError(err.message || 'Push failed');
        } finally {
            setPushing(false);
        }
    }, [closeContextMenu, workspaceId, refreshAll]);

    const handleRebaseAutosquash = useCallback(async () => {
        if (rebasing) return;
        setRebasing(true);
        setActionError(null);
        try {
            const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/rebase-autosquash`, {
                method: 'POST',
            });
            if (result.jobId) {
                // Async rebase — poll for job completion
                const jobId: string = result.jobId;
                const poll = setInterval(async () => {
                    try {
                        const job = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/ops/${encodeURIComponent(jobId)}`);
                        if (!job || job.status !== 'running') {
                            clearInterval(poll);
                            setRebasing(false);
                            if (job?.status === 'failed') {
                                setActionError(job.error || 'Rebase failed');
                            } else {
                                refreshAll();
                            }
                        }
                    } catch {
                        clearInterval(poll);
                        setRebasing(false);
                    }
                }, 3000);
            } else if (result.success === false) {
                throw new Error(result.error || 'Rebase failed');
            } else {
                refreshAll();
                setRebasing(false);
            }
        } catch (err: any) {
            setActionError(err.message || 'Rebase failed');
            setRebasing(false);
        }
    }, [rebasing, workspaceId, refreshAll]);

    const handleSelect = useCallback((commit: GitCommitItem) => {
        setRightPanelView({ type: 'commit', commit });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + commit.hash;
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: commit.hash });
        dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
    }, [workspaceId, dispatch]);

    const handleMultiSelect = useCallback((selectedCommits: GitCommitItem[]) => {
        if (selectedCommits.length === 1) {
            handleSelect(selectedCommits[0]);
            return;
        }
        setRightPanelView({ type: 'multi-commit', commits: selectedCommits });
    }, [handleSelect]);

    const selectedHashes = useMemo<ReadonlySet<string>>(() => {
        if (rightPanelView?.type === 'multi-commit') {
            return new Set(rightPanelView.commits.map(c => c.hash));
        }
        if (rightPanelView?.type === 'commit') return new Set([rightPanelView.commit.hash]);
        if (rightPanelView?.type === 'commit-file') return new Set([rightPanelView.hash]);
        return new Set();
    }, [rightPanelView]);

    const handleFileSelect = useCallback((filePath: string) => {
        setHunkTarget(undefined);
        setRightPanelView({ type: 'branch-file', filePath });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/branch-range/' + encodeURIComponent(filePath);
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: 'branch-range' });
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [workspaceId, dispatch]);

    const handleNavigateToBranchFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setHunkTarget(target);
        setRightPanelView({ type: 'branch-file', filePath });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/branch-range/' + encodeURIComponent(filePath);
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: 'branch-range' });
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [workspaceId, dispatch]);

    const handleBranchRangeSelect = useCallback(() => {
        setRightPanelView({ type: 'branch-range' });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/branch-range';
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: 'branch-range' });
        dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
    }, [workspaceId, dispatch]);

    const handleCommitFileSelect = useCallback((hash: string, filePath: string) => {
        setHunkTarget(undefined);
        setRightPanelView({ type: 'commit-file', hash, filePath });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + hash + '/' + encodeURIComponent(filePath);
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [workspaceId, dispatch]);

    const handleNavigateToCommitFile = useCallback((hash: string, filePath: string, target: 'first' | 'last') => {
        setHunkTarget(target);
        setRightPanelView({ type: 'commit-file', hash, filePath });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + hash + '/' + encodeURIComponent(filePath);
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [workspaceId, dispatch]);

    const handleWorkingTreeFileSelect = useCallback((filePath: string, stage: 'staged' | 'unstaged' | 'untracked') => {
        setHunkTarget(undefined);
        setRightPanelView({ type: 'working-tree-file', filePath, stage });
    }, []);

    const handleNavigateToWorkingTreeFile = useCallback((filePath: string, target: 'first' | 'last') => {
        // Working tree navigation keeps the current stage
        const currentStage = rightPanelView?.type === 'working-tree-file' ? rightPanelView.stage : 'unstaged';
        setHunkTarget(target);
        setRightPanelView({ type: 'working-tree-file', filePath, stage: currentStage });
    }, [rightPanelView]);

    const handleAllWorkingCommentsClick = useCallback(() => {
        setRightPanelView({ type: 'working-tree-comments' });
    }, []);

    const handleAllBranchCommentsClick = useCallback(() => {
        setRightPanelView({ type: 'branch-range-comments' });
    }, []);

    const handleMobileBack = useCallback(() => {
        setRightPanelView(null);
    }, []);

    const handleHardReset = useCallback(async (commit: GitCommitItem) => {
        closeContextMenu();
        const shortHash = commit.hash.slice(0, 7);
        if (!window.confirm(`Reset to ${shortHash}? This will discard all uncommitted changes.`)) return;
        setActionError(null);
        try {
            const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hash: commit.hash, mode: 'hard' }),
            });
            if (result.success === false) throw new Error(result.error || 'Reset failed');
            refreshAll();
        } catch (err: any) {
            setActionError(err.message || 'Reset failed');
        }
    }, [closeContextMenu, workspaceId, refreshAll]);

    const handleCherryPick = useCallback(async (commit: GitCommitItem) => {
        closeContextMenu();
        const shortHash = commit.hash.slice(0, 7);
        if (!window.confirm(`Cherry pick commit ${shortHash}?`)) return;
        setActionError(null);
        try {
            const res = await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/git/cherry-pick`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hash: commit.hash }),
            });
            const result = await res.json();
            if (res.status === 409 || result.conflicts) {
                setActionError(`Cherry-pick has conflicts — resolve them and run \`git cherry-pick --continue\``);
            } else if (!res.ok || result.success === false) {
                throw new Error(result.error || 'Cherry-pick failed');
            } else {
                refreshAll();
                setEnqueueToast(`Cherry-picked ${shortHash}`);
                setTimeout(() => setEnqueueToast(null), 3000);
            }
        } catch (err: any) {
            setActionError(err.message || 'Cherry-pick failed');
        }
    }, [closeContextMenu, workspaceId, refreshAll]);

    const handleAmendConfirm = useCallback(async (title: string, body: string) => {
        if (!amendingCommit) return;
        setAmendingCommit(null);
        setActionError(null);
        try {
            const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/amend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, body }),
            });
            if (result.error) throw new Error(result.error);
            // Rebind commit-chat if the amend produced a new hash
            if (result.hash && result.hash !== amendingCommit.hash) {
                rebindCommitChat(workspaceId, amendingCommit.hash, result.hash);
            }
            refreshAll();
            setEnqueueToast('Commit message amended.');
            setTimeout(() => setEnqueueToast(null), 3000);
        } catch (err: any) {
            setActionError(err.message || 'Amend failed');
        }
    }, [amendingCommit, workspaceId, refreshAll]);

    const handleRewordConfirm = useCallback(async (title: string) => {
        if (!rewordingCommit) return;
        setRewordingCommit(null);
        setActionError(null);
        try {
            const result = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/reword`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hash: rewordingCommit.hash, title }),
            });
            if (result.error) throw new Error(result.error);
            refreshAll();
            setEnqueueToast('Commit title amended.');
            setTimeout(() => setEnqueueToast(null), 3000);
        } catch (err: any) {
            setActionError(err.message || 'Reword failed');
        }
    }, [rewordingCommit, workspaceId, refreshAll]);

    const handleCommitContextMenu = useCallback((e: React.MouseEvent, commitHash: string) => {
        if (
            rightPanelView?.type === 'multi-commit' &&
            rightPanelView.commits.some(c => c.hash === commitHash)
        ) {
            setContextMenu({ x: e.clientX, y: e.clientY, type: 'multi-commit', commits: rightPanelView.commits });
            return;
        }
        const commit = commits.find(c => c.hash === commitHash);
        if (!commit) return;
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'commit', commit });
    }, [commits, rightPanelView]);

    const handleBranchContextMenu = useCallback((e: React.MouseEvent) => {
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'branch-range' });
    }, []);

    const buildBranchReferencePrompt = useCallback((): string => {
        const branchLabel = branchRangeData?.branchName || branchRangeData?.headRef || branchName || 'current branch';
        const baseShort = (branchRangeData?.baseRef ?? 'main').replace(/^origin\//, '');
        const headShort = branchRangeData?.headRef ?? 'HEAD';
        const commitCount = branchRangeData?.commitCount ?? 0;
        const additions = branchRangeData?.additions ?? 0;
        const deletions = branchRangeData?.deletions ?? 0;
        const fileCount = branchRangeData?.fileCount ?? 0;

        let prompt = `Branch: ${branchLabel} (${baseShort}..${headShort})\nCommits: ${commitCount}  +${additions} -${deletions}\nFiles: ${fileCount}`;

        if (commits.length > 0) {
            const commitList = commits
                .map(c => `- ${c.shortHash} — ${c.subject}`)
                .join('\n');
            prompt += `\n\nCommit list:\n${commitList}`;
        }

        return prompt;
    }, [branchRangeData, branchName, commits]);

    const handleBranchAskAI = useCallback((mode: 'ask' | 'task') => {
        const initialPrompt = buildBranchReferencePrompt();
        queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode, initialPrompt, launchMode: 'floating-chat' });
    }, [workspaceId, buildBranchReferencePrompt, queueDispatch]);

    const handleEnqueueSkill = useCallback(async (skillName: string) => {
        if (!contextMenu) return;
        const snapshot = { ...contextMenu };
        closeContextMenu();

        try {
            let promptContent: string;
            if (snapshot.type === 'commit' && snapshot.commit) {
                promptContent = `<commit>${snapshot.commit.hash}</commit>`;
            } else if (snapshot.type === 'multi-commit' && snapshot.commits?.length) {
                promptContent = `<commits>\n${snapshot.commits.map(c => c.hash).join('\n')}\n</commits>`;
            } else {
                const base = (branchRangeData?.baseRef ?? 'main').replace(/^origin\//, '');
                const head = branchRangeData?.headRef ?? branchName ?? 'HEAD';
                promptContent = `<commit-range>${base}..${head}</commit-range>`;
            }

            const ws = state.workspaces.find((w: any) => w.id === workspaceId);
            const shortId =
                snapshot.type === 'commit' && snapshot.commit
                    ? snapshot.commit.shortHash
                    : snapshot.type === 'multi-commit' && snapshot.commits?.length
                        ? `${snapshot.commits.length} commits`
                        : branchName || 'branch';

            await fetch(getApiBase() + '/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    displayName: `Skill: ${skillName} — ${shortId}`,
                    payload: {
                        kind: 'chat',
                        mode: 'autopilot',
                        prompt: promptContent,
                        workingDirectory: ws?.rootPath || '',
                        context: {
                            skills: [skillName],
                        },
                    },
                }),
            });

            setEnqueueToast(`Skill "${skillName}" enqueued`);
            setTimeout(() => setEnqueueToast(null), 3000);
        } catch (err: any) {
            setEnqueueToast(`Failed to enqueue: ${err.message || 'Unknown error'}`);
            setTimeout(() => setEnqueueToast(null), 5000);
        }
    }, [contextMenu, workspaceId, branchRangeData, branchName, state.workspaces, closeContextMenu]);

    const handleSquashCommits = useCallback(async () => {
        if (!contextMenu || contextMenu.type !== 'multi-commit' || !contextMenu.commits?.length) return;
        const selectedCommits = [...contextMenu.commits];
        closeContextMenu();

        if (selectedCommits.length < 2) return;

        // Contiguity check: all selected commits must be consecutive in the unpushed list
        const indices = selectedCommits
            .map(c => {
                const idx = commits.indexOf(c);
                return idx >= 0 && idx < unpushedCount ? idx : -1;
            })
            .filter(i => i !== -1)
            .sort((a, b) => a - b);

        if (indices.length !== selectedCommits.length) {
            setEnqueueToast('Squash failed: all selected commits must be unpushed');
            setTimeout(() => setEnqueueToast(null), 5000);
            return;
        }
        for (let i = 1; i < indices.length; i++) {
            if (indices[i] !== indices[i - 1] + 1) {
                setEnqueueToast('Squash failed: selected commits must be contiguous');
                setTimeout(() => setEnqueueToast(null), 5000);
                return;
            }
        }

        // Sort oldest-first for the prompt (unpushed list is newest-first)
        const oldestFirst = [...selectedCommits].reverse();
        const commitList = oldestFirst
            .map(c => `- ${c.hash} ${c.subject}`)
            .join('\n');
        const promptContent = `Squash the following ${oldestFirst.length} commits into a single commit. Preserve the intent of all changes.\n\nCommits (oldest first):\n${commitList}\n\nWrite a clear combined commit message summarizing all changes.`;

        try {
            const ws = state.workspaces.find((w: any) => w.id === workspaceId);
            await fetch(getApiBase() + '/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    displayName: `Squash ${selectedCommits.length} commits`,
                    payload: {
                        kind: 'chat',
                        mode: 'autopilot',
                        prompt: promptContent,
                        workingDirectory: ws?.rootPath || '',
                    },
                }),
            });
            setEnqueueToast(`Squash task enqueued (${selectedCommits.length} commits)`);
            setTimeout(() => setEnqueueToast(null), 3000);
        } catch (err: any) {
            setEnqueueToast(`Failed to enqueue squash: ${err.message || 'Unknown error'}`);
            setTimeout(() => setEnqueueToast(null), 5000);
        }
    }, [contextMenu, commits, unpushedCount, workspaceId, state.workspaces, closeContextMenu]);

    // Conflict banner handlers
    const handleConflictResolveAI = useCallback(async () => {
        if (!repoState || repoState.operation === 'none') return;
        const files = repoState.conflictFiles.map(f => `- ${f}`).join('\n');
        const continueCmd = repoState.operation === 'cherry-pick'
            ? 'git cherry-pick --continue'
            : repoState.operation === 'rebase'
                ? 'git rebase --continue'
                : 'git merge --continue';
        const promptContent = `The repository has a ${repoState.operation} in progress with conflicts in the following files:\n<files>\n${files}\n</files>\n\nFor each conflicted file, resolve the conflict markers (<<<<<<< / ======= / >>>>>>>) by choosing the best resolution that preserves both sides' intent. Then stage the resolved files with \`git add\`. After staging all resolved files, run \`${continueCmd}\`. If new conflicts arise, repeat the resolution and continue cycle until the entire operation completes successfully.`;
        try {
            const ws = state.workspaces.find((w: any) => w.id === workspaceId);
            await fetch(getApiBase() + '/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    displayName: `Resolve ${repoState.operation} conflicts`,
                    payload: {
                        kind: 'chat',
                        mode: 'autopilot',
                        prompt: promptContent,
                        workingDirectory: ws?.rootPath || '',
                    },
                }),
            });
            setEnqueueToast('Conflict resolution task enqueued');
            setTimeout(() => setEnqueueToast(null), 3000);
        } catch (err: any) {
            setEnqueueToast(`Failed: ${err.message || 'Unknown error'}`);
            setTimeout(() => setEnqueueToast(null), 5000);
        }
    }, [repoState, workspaceId, state.workspaces]);

    const handleConflictContinue = useCallback(async () => {
        if (!repoState || repoState.operation === 'none') return;
        const endpoint = repoState.operation === 'merge' ? 'merge-continue' : 'rebase-continue';
        try {
            await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/${endpoint}`, {
                method: 'POST',
            });
            setEnqueueToast(`${repoState.operation} continue started`);
            setTimeout(() => setEnqueueToast(null), 3000);
            setTimeout(refreshAll, 2000);
        } catch (err: any) {
            setActionError(`Continue failed: ${err.message || 'Unknown error'}`);
        }
    }, [repoState, workspaceId, refreshAll]);

    const handleConflictAbort = useCallback(async () => {
        if (!repoState || repoState.operation === 'none') return;
        if (!confirm(`Abort the in-progress ${repoState.operation}? This will discard conflict resolutions.`)) return;
        const endpoint = repoState.operation === 'merge' ? 'merge-abort' : 'rebase-abort';
        try {
            await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/${endpoint}`, {
                method: 'POST',
            });
            refreshAll();
        } catch (err: any) {
            setActionError(`Abort failed: ${err.message || 'Unknown error'}`);
        }
    }, [repoState, workspaceId, refreshAll]);

    // Reorder handlers
    const handleReorderCommits = useCallback((newOrder: GitCommitItem[]) => {
        setPendingReorder(newOrder);
    }, []);

    const handleApplyReorder = useCallback(async () => {
        if (!pendingReorder) return;
        // Extract unpushed commits in the new display order, reversed to oldest-first for the API
        const reorderedUnpushed = pendingReorder.slice(0, unpushedCount);
        const commitHashes = [...reorderedUnpushed].reverse().map(c => c.hash);
        try {
            const resp = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/rebase-reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commits: commitHashes }),
            });
            setEnqueueToast('Reorder started');
            setTimeout(() => setEnqueueToast(null), 3000);
            setPendingReorder(null);
            // Poll for completion similar to rebase-autosquash
            if (resp?.jobId) {
                const poll = setInterval(async () => {
                    try {
                        const job = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/ops/${resp.jobId}`);
                        if (job?.status === 'success' || job?.status === 'failed') {
                            clearInterval(poll);
                            if (job.status === 'failed') {
                                setActionError(job.error || 'Reorder failed');
                            }
                            refreshAll();
                        }
                    } catch { clearInterval(poll); }
                }, 3000);
            }
        } catch (err: any) {
            setActionError(`Reorder failed: ${err.message || 'Unknown error'}`);
            setPendingReorder(null);
        }
    }, [pendingReorder, unpushedCount, workspaceId, refreshAll]);

    const handleCancelReorder = useCallback(() => {
        setPendingReorder(null);
    }, []);

    // Compute fixup groups for context menu "Rebase autosquash" option
    const fixupGroupsForMenu = useMemo(() => buildFixupGroups(commits), [commits]);

    const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
        if (!contextMenu) return [];
        const items: ContextMenuItem[] = [];

        if (contextMenu.type === 'commit' && contextMenu.commit) {
            const { commit } = contextMenu;
            const isHead = commits.length > 0 && commits[0].hash === commit.hash;
            items.push({
                label: 'Copy Hash',
                icon: '📋',
                onClick: () => { navigator.clipboard.writeText(commit.hash); },
            });
            items.push({
                label: 'View Diff',
                icon: '🔍',
                onClick: () => { handleSelect(commit); },
            });
            // "Push to Here" — only for unpushed commits
            const commitIndex = commits.findIndex(c => c.hash === commit.hash);
            const isUnpushed = commitIndex >= 0 && commitIndex < unpushedCount;
            if (isUnpushed) {
                items.push({ label: '', separator: true, onClick: () => {} });
                items.push({
                    label: 'Push to Here',
                    icon: '📤',
                    onClick: () => handlePushToCommit(commit),
                });
            }
            if (isHead) {
                items.push({ label: '', separator: true, onClick: () => {} });
                items.push({
                    label: 'Amend Message\u2026',
                    icon: '✏️',
                    onClick: () => { closeContextMenu(); setAmendingCommit(commit); },
                });
            }
            if (!isHead) {
                items.push({ label: '', separator: true, onClick: () => {} });
                items.push({
                    label: 'Amend Title\u2026',
                    icon: '✏️',
                    onClick: () => { closeContextMenu(); setRewordingCommit(commit); },
                });
            }
            // Show "Rebase autosquash from here" on target commits that have fixups
            if (fixupGroupsForMenu.targetGroups.has(commit.hash)) {
                items.push({ label: '', separator: true, onClick: () => {} });
                items.push({
                    label: 'Rebase Autosquash from Here',
                    icon: '📦',
                    onClick: () => { closeContextMenu(); handleRebaseAutosquash(); },
                });
            }
            items.push({ label: '', separator: true, onClick: () => {} });
            items.push({
                label: 'Hard Reset to Here',
                icon: '⏪',
                onClick: () => handleHardReset(commit),
            });
            items.push({
                label: 'Cherry Pick',
                icon: '🍒',
                onClick: () => handleCherryPick(commit),
            });
            items.push({ label: '', separator: true, onClick: () => {} });
            items.push({
                label: 'Ask AI',
                icon: '💡',
                onClick: () => {
                    const initialPrompt = `Commit: ${commit.hash}${commit.subject ? ` — ${commit.subject}` : ''}`;
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'ask', initialPrompt, launchMode: 'floating-chat' });
                },
            });
            items.push({
                label: 'Queue Task',
                icon: '🤖',
                onClick: () => {
                    const initialPrompt = `Commit: ${commit.hash}${commit.subject ? ` — ${commit.subject}` : ''}`;
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'task', initialPrompt, launchMode: 'floating-chat' });
                },
            });
        }

        if (contextMenu.type === 'multi-commit' && contextMenu.commits?.length) {
            const selectedCommits = contextMenu.commits;
            const commitList = selectedCommits
                .map(c => `- ${c.shortHash} — ${c.subject}`)
                .join('\n');
            const initialPrompt = `${selectedCommits.length} commits selected:\n${commitList}`;

            items.push({
                label: 'Copy Commits Info',
                icon: '📋',
                onClick: () => { navigator.clipboard.writeText(commitList); },
            });
            if (selectedCommits.length >= 2) {
                items.push({
                    label: `Squash ${selectedCommits.length} Commits`,
                    icon: '📦',
                    onClick: () => { void handleSquashCommits(); },
                });
            }
            items.push({
                label: 'Ask AI', icon: '💡', onClick: () => {
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'ask', initialPrompt, launchMode: 'floating-chat' });
                },
            });
            items.push({
                label: 'Queue Task', icon: '🤖', onClick: () => {
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'task', initialPrompt, launchMode: 'floating-chat' });
                },
            });
        }

        if (contextMenu.type === 'branch-range') {
            items.push({
                label: 'Ask AI',
                icon: '💡',
                onClick: () => { void handleBranchAskAI('ask'); },
            });
            items.push({
                label: 'Queue Task',
                icon: '🤖',
                onClick: () => { void handleBranchAskAI('task'); },
            });
        }

        if (skills.length > 0) {
            if (items.length > 0) {
                items.push({ label: '', separator: true, onClick: () => {} });
            }
            items.push({
                label: 'Use Skill',
                icon: '⚡',
                onClick: () => {},
                children: skills.map(skill => ({
                    label: skill.name,
                    onClick: () => handleEnqueueSkill(skill.name),
                })),
            });
        }

        return items;
    }, [contextMenu, skills, handleEnqueueSkill, handleSquashCommits, handleBranchAskAI, handleSelect, handleHardReset, handleCherryPick, commits, closeContextMenu, queueDispatch, workspaceId, fixupGroupsForMenu, handleRebaseAutosquash, handlePushToCommit, unpushedCount]);

    // Keyboard shortcut: R to refresh when focused in left panel
    const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'r' || e.key === 'R') {
            if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
                e.preventDefault();
                refreshAll();
            }
        }
    }, [refreshAll]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8" data-testid="git-tab-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-[#d32f2f] dark:text-[#f48771]" data-testid="git-tab-error">
                <p>{error}</p>
                <button
                    className="mt-2 px-3 py-1 text-xs rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#333] dark:text-[#ccc] hover:opacity-80"
                    onClick={() => setRetryKey(k => k + 1)}
                    data-testid="git-tab-retry"
                >
                    Retry
                </button>
            </div>
        );
    }

    const selectedCommit = rightPanelView?.type === 'commit' ? rightPanelView.commit : rightPanelView?.type === 'commit-file' ? commits.find(c => c.hash === rightPanelView.hash) ?? null : null;
    const selectedCommitFile = rightPanelView?.type === 'commit-file' ? { hash: rightPanelView.hash, filePath: rightPanelView.filePath } : null;
    const selectedBranchFile = rightPanelView?.type === 'branch-file' ? rightPanelView.filePath : null;
    const selectedWorkingTreeFile = rightPanelView?.type === 'working-tree-file' ? rightPanelView.filePath : null;

    // Scenario banner
    const scenarioBanner = (() => {
        if (onDefaultBranch) return null;
        const parts: string[] = [];
        if (ahead > 0) parts.push(`↑${ahead} commit${ahead !== 1 ? 's' : ''} ahead`);
        if (behind > 0) parts.push(`↓${behind} commit${behind !== 1 ? 's' : ''} behind`);
        if (parts.length === 0) return null;
        const isWarning = behind > 0;
        return (
            <div
                className={`px-4 py-1.5 text-xs border-b border-[#e0e0e0] dark:border-[#3c3c3c] ${
                    isWarning
                        ? 'bg-[#fff3cd] dark:bg-[#3c3520] text-[#856404] dark:text-[#ffc107]'
                        : 'bg-[#f0f9ff] dark:bg-[#1a2733] text-[#0078d4] dark:text-[#3794ff]'
                }`}
                data-testid="git-scenario-banner"
            >
                {parts.join(' · ')}
                {behind > 0 && ' — consider pulling'}
            </div>
        );
    })();

    const commitListPanel = searchQuery && commits.length === 0 ? (
        <div className="text-sm text-[#848484] py-8 text-center px-4" data-testid="git-search-empty">
            No commits match &ldquo;{searchQuery}&rdquo;
        </div>
    ) : (
        <CommitList
            title="History"
            commits={pendingReorder || commits}
            unpushedCount={searchQuery ? 0 : unpushedCount}
            selectedHash={selectedCommit?.hash}
            selectedHashes={selectedHashes}
            selectedFile={selectedCommitFile}
            initialExpandedHash={initialCommitHash ? selectedCommit?.hash : null}
            onSelect={handleSelect}
            onMultiSelect={handleMultiSelect}
            onFileSelect={handleCommitFileSelect}
            onCommitContextMenu={handleCommitContextMenu}
            workspaceId={workspaceId}
            reorderable={!searchQuery && unpushedCount > 1}
            onReorder={handleReorderCommits}
        />
    );

    const detailPanel = rightPanelView?.type === 'commit' ? (
        <CommitDetail
            key={rightPanelView.commit.hash}
            workspaceId={workspaceId}
            hash={rightPanelView.commit.hash}
            commit={rightPanelView.commit}
        />
    ) : rightPanelView?.type === 'commit-file' ? (
        <FileDiffPanel
            key={`${rightPanelView.hash}-${rightPanelView.filePath}`}
            source={createCommitDiffSource(workspaceId, rightPanelView.hash, {
                commit: commits.find(c => c.hash === rightPanelView.hash),
            })}
            workspaceId={workspaceId}
            filePath={rightPanelView.filePath}
            onNavigateToFile={(fp, target) => handleNavigateToCommitFile(rightPanelView.hash, fp, target)}
            initialHunkTarget={hunkTarget}
        />
    ) : rightPanelView?.type === 'branch-range' ? (
        <BranchRangeOverview
            workspaceId={workspaceId}
            range={branchRangeData!}
            commits={commits}
            unpushedCount={unpushedCount}
            files={branchRangeFiles}
            onFileSelect={handleFileSelect}
            onAllCommentsClick={handleAllBranchCommentsClick}
            onAskAI={() => { void handleBranchAskAI('ask'); }}
            onQueueTask={() => { void handleBranchAskAI('task'); }}
        />
    ) : rightPanelView?.type === 'branch-file' ? (
        <FileDiffPanel
            key={rightPanelView.filePath}
            source={createBranchRangeDiffSource(workspaceId, {
                files: (branchRangeFiles ?? []).map((f: { path: string }) => f.path).sort(),
            })}
            workspaceId={workspaceId}
            filePath={rightPanelView.filePath}
            onNavigateToFile={handleNavigateToBranchFile}
            initialHunkTarget={hunkTarget}
        />
    ) : rightPanelView?.type === 'working-tree-file' ? (
        <WorkingTreeFileDiff
            key={`${rightPanelView.filePath}:${rightPanelView.stage}`}
            workspaceId={workspaceId}
            filePath={rightPanelView.filePath}
            stage={rightPanelView.stage}
            onNavigateToFile={handleNavigateToWorkingTreeFile}
            initialHunkTarget={hunkTarget}
        />
    ) : rightPanelView?.type === 'working-tree-comments' ? (
        <WorkingTreeAllComments workspaceId={workspaceId} />
    ) : rightPanelView?.type === 'branch-range-comments' ? (
        <BranchRangeAllComments
            workspaceId={workspaceId}
            baseRef={branchRangeData!.baseRef}
            headRef={branchRangeData!.headRef}
            branchLabel={branchRangeData!.branchName || branchRangeData!.headRef}
        />
    ) : rightPanelView?.type === 'multi-commit' ? (
        <div className="flex flex-col h-full p-4 gap-3" data-testid="git-multi-commit-panel">
            <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc]">
                {rightPanelView.commits.length} commits selected
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto">
                {rightPanelView.commits.map(c => (
                    <div key={c.hash} className="flex items-center gap-2 text-xs py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <span className="font-mono text-[#0078d4] dark:text-[#3794ff] flex-shrink-0">{c.shortHash}</span>
                        <span className="text-[#1e1e1e] dark:text-[#ccc] truncate">{c.subject}</span>
                    </div>
                ))}
            </div>
        </div>
    ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-[#848484]" data-testid="git-detail-empty">
            Select a commit to view details
        </div>
    );

    return (
        <>
        <div className={`repo-git-tab flex flex-col lg:flex-row h-full overflow-hidden${isDragging ? ' select-none' : ''}`} data-testid="repo-git-tab">
            {/* Left panel — commit list (hidden on mobile when detail is active) */}
            <aside
                className={`w-full lg:shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526]${rightPanelView ? ' hidden lg:block' : ''}`}
                data-testid="git-commit-list-panel"
                onKeyDown={handlePanelKeyDown}
            >
                <style>{`@media (min-width: 1024px) { [data-testid="git-commit-list-panel"] { width: ${sidebarWidth}px !important; } }`}</style>
                <GitPanelHeader
                    branch={branchName || 'HEAD'}
                    ahead={ahead}
                    behind={behind}
                    refreshing={refreshing}
                    onRefresh={refreshAll}
                    onBranchClick={() => setBranchPickerOpen(true)}
                    onFetch={handleFetch}
                    onPull={handlePull}
                    onPush={handlePush}
                    onRebaseAutosquash={handleRebaseAutosquash}
                    fetching={fetching}
                    pulling={pulling}
                    pushing={pushing}
                    rebasing={rebasing}
                    lastRefreshedAt={lastRefreshedAt}
                />
                {/* Search input */}
                <div className="px-2 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="git-search-bar">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border bg-white dark:bg-[#3c3c3c] focus-within:border-[#0078d4] ${searchQuery ? 'border-[#0078d4]' : 'border-[#e0e0e0] dark:border-[#474749]'}`}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#848484]" aria-hidden="true">
                            <path d="M6.5 1a5.5 5.5 0 1 0 3.547 9.714l3.37 3.369a.75.75 0 1 0 1.06-1.06l-3.369-3.37A5.5 5.5 0 0 0 6.5 1zm-4 5.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" fill="currentColor"/>
                        </svg>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search commits…"
                            className="flex-1 bg-transparent outline-none text-sm text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#999] min-w-0"
                            data-testid="git-search-input"
                            aria-label="Search commits by message"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="shrink-0 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] leading-none"
                                data-testid="git-search-clear"
                                aria-label="Clear search"
                            >
                                ×
                            </button>
                        )}
                    </div>
                </div>
                {scenarioBanner}
                {refreshError && (
                    <div className="px-4 py-1.5 text-xs text-[#d32f2f] dark:text-[#f48771] bg-[#fdecea] dark:bg-[#3c2020] border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="git-refresh-error">
                        {refreshError}
                    </div>
                )}
                {actionError && (
                    <div className="px-4 py-1.5 text-xs text-[#d32f2f] dark:text-[#f48771] bg-[#fdecea] dark:bg-[#3c2020] border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="git-action-error">
                        {actionError}
                    </div>
                )}
                <BranchChanges
                    workspaceId={workspaceId}
                    branchRangeData={branchRangeData}
                    initialFiles={branchRangeFiles}
                    onDefaultBranch={onDefaultBranch}
                    onFileSelect={handleFileSelect}
                    selectedFile={selectedBranchFile}
                    onBranchContextMenu={handleBranchContextMenu}
                    onBranchRangeSelect={handleBranchRangeSelect}
                />
                <WorkingTree
                    workspaceId={workspaceId}
                    onRefresh={refreshAll}
                    onFileSelect={handleWorkingTreeFileSelect}
                    selectedFilePath={selectedWorkingTreeFile}
                    refreshKey={workingChangesRefreshKey}
                    onAllCommentsClick={handleAllWorkingCommentsClick}
                />
                {repoState && repoState.operation !== 'none' && (
                    <div
                        className="mx-2 my-2 p-3 rounded border border-[#e5a100] dark:border-[#cca700] bg-[#fff3cd] dark:bg-[#3d3522] text-xs"
                        data-testid="conflict-banner"
                    >
                        <div className="font-semibold text-[#856404] dark:text-[#e5c07b] mb-1">
                            ⚠️ {repoState.operation.charAt(0).toUpperCase() + repoState.operation.slice(1)} in progress
                            {repoState.conflictFiles.length > 0 && ` — ${repoState.conflictFiles.length} conflict file${repoState.conflictFiles.length !== 1 ? 's' : ''}`}
                        </div>
                        <div className="flex gap-2 mt-2 flex-wrap">
                            <button
                                onClick={handleConflictResolveAI}
                                className="px-2 py-1 rounded text-xs font-medium bg-[#007acc] text-white hover:bg-[#005fa3]"
                                data-testid="conflict-resolve-ai-btn"
                            >
                                Resolve with AI ⚡
                            </button>
                            <button
                                onClick={handleConflictContinue}
                                className="px-2 py-1 rounded text-xs font-medium bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#333] dark:text-[#ccc] hover:bg-[#ccc] dark:hover:bg-[#555]"
                                data-testid="conflict-continue-btn"
                            >
                                Continue
                            </button>
                            <button
                                onClick={handleConflictAbort}
                                className="px-2 py-1 rounded text-xs font-medium bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#d32f2f] hover:bg-[#ccc] dark:hover:bg-[#555]"
                                data-testid="conflict-abort-btn"
                            >
                                Abort
                            </button>
                        </div>
                    </div>
                )}
                {pendingReorder && (
                    <div
                        className="mx-2 my-2 p-3 rounded border border-[#0078d4] dark:border-[#3794ff] bg-[#e8f0fe] dark:bg-[#1a2744] text-xs flex items-center justify-between"
                        data-testid="reorder-confirmation-bar"
                    >
                        <span className="text-[#333] dark:text-[#ccc]">
                            Reorder {unpushedCount} unpushed commit{unpushedCount !== 1 ? 's' : ''}?
                        </span>
                        <div className="flex gap-2">
                            <button
                                onClick={handleApplyReorder}
                                className="px-2 py-1 rounded text-xs font-medium bg-[#007acc] text-white hover:bg-[#005fa3]"
                                data-testid="reorder-apply-btn"
                            >
                                Apply
                            </button>
                            <button
                                onClick={handleCancelReorder}
                                className="px-2 py-1 rounded text-xs font-medium bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#333] dark:text-[#ccc] hover:bg-[#ccc] dark:hover:bg-[#555]"
                                data-testid="reorder-cancel-btn"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
                {commitListPanel}
                {hasMore && (
                    <div className="px-4 py-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <button
                            onClick={handleLoadMore}
                            disabled={isLoadingMore}
                            className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                            data-testid="git-load-more-btn"
                        >
                            {isLoadingMore ? 'Loading…' : 'Load more'}
                        </button>
                    </div>
                )}
            </aside>
            {/* Resize handle — desktop only */}
            <div
                className="hidden lg:flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                data-testid="git-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                tabIndex={0}
            />
            {/* Right panel — commit detail (hidden on mobile when no detail selected) */}
            <main className={`flex-1 min-w-0 min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e] flex flex-col${!rightPanelView ? ' hidden lg:flex' : ''}`} data-testid="git-detail-panel">
                {/* Mobile back button */}
                {rightPanelView && (
                    <div className="lg:hidden shrink-0 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="git-mobile-back">
                        <button
                            onClick={handleMobileBack}
                            className="text-xs text-[#0078d4] dark:text-[#3794ff] flex items-center gap-1 hover:underline"
                            data-testid="git-mobile-back-btn"
                        >
                            ← Back to list
                        </button>
                    </div>
                )}
                <div className="flex-1 min-h-0 overflow-hidden">
                    {detailPanel}
                </div>
            </main>
        </div>
        {contextMenu && contextMenuItems.length > 0 && (
            <ContextMenu
                position={{ x: contextMenu.x, y: contextMenu.y }}
                items={contextMenuItems}
                onClose={closeContextMenu}
            />
        )}
        {enqueueToast && (
            <div
                className="fixed bottom-4 right-4 z-[10010] px-4 py-2.5 rounded-md shadow-lg text-xs text-white bg-[#0078d4] dark:bg-[#1a6bbf] max-w-xs flex items-center gap-2"
                data-testid="enqueue-toast"
            >
                <span className="flex-1">{enqueueToast}</span>
                <button
                    onClick={() => setEnqueueToast(null)}
                    data-testid="enqueue-toast-close"
                    aria-label="Close notification"
                    className="ml-2 text-white/80 hover:text-white text-sm leading-none"
                >
                    ×
                </button>
            </div>
        )}
        <BranchPickerModal
            workspaceId={workspaceId}
            currentBranch={branchName || 'HEAD'}
            isOpen={branchPickerOpen}
            onClose={() => setBranchPickerOpen(false)}
            onSwitched={(newBranch) => {
                setBranchName(newBranch);
                setBranchPickerOpen(false);
                setSkip(0);
                fetchBranchRange(true);
                fetchCommits(true);
            }}
        />
        {amendingCommit && (
            <AmendMessageModal
                commit={amendingCommit}
                onConfirm={handleAmendConfirm}
                onCancel={() => setAmendingCommit(null)}
            />
        )}
        {rewordingCommit && (
            <AmendMessageModal
                commit={rewordingCommit}
                titleOnly
                onConfirm={(title) => handleRewordConfirm(title)}
                onCancel={() => setRewordingCommit(null)}
            />
        )}
        </>
    );
}
