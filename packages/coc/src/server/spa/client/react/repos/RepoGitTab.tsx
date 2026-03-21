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

import { BranchChanges } from './BranchChanges';
import { BranchFileDiff } from './BranchFileDiff';
import { GitPanelHeader } from './GitPanelHeader';
import { WorkingTree } from './WorkingTree';
import { WorkingTreeFileDiff } from './WorkingTreeFileDiff';
import { WorkingTreeAllComments } from './WorkingTreeAllComments';
import { BranchRangeAllComments } from './BranchRangeAllComments';
import { BranchPickerModal } from './BranchPickerModal';
import { AmendMessageModal } from './AmendMessageModal';
import { clearCacheForHash } from './useCommitDiffCache';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu';
import type { GitCommitItem } from './CommitList';
import type { BranchRangeInfo } from './BranchChanges';

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
    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [skip, setSkip] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [unpushedCount, setUnpushedCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [pushing, setPushing] = useState(false);
    const [rebasing, setRebasing] = useState(false);
    const pullJobRef = useRef<string | null>(null);
    const pullPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [rightPanelView, setRightPanelView] = useState<RightPanelView | null>(null);
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
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'commit' | 'branch-range'; commit?: GitCommitItem } | null>(null);
    const [enqueueToast, setEnqueueToast] = useState<string | null>(null);
    const [branchPickerOpen, setBranchPickerOpen] = useState(false);
    const [amendingCommit, setAmendingCommit] = useState<GitCommitItem | null>(null);

    const fetchCommits = useCallback((refresh = false, skipOffset = 0, search = '') => {
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
                }
                setHasMore(loaded.length === 50);
                return loaded;
            });
    }, [workspaceId]);

    const fetchBranchRange = useCallback((refresh = false) => {
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
                    setBranchRangeData(rangeInfo);
                    setBranchRangeFiles(Array.isArray(data.files) ? data.files : []);
                    setBranchName(data.branchName || data.headRef || '');
                    setAhead(data.commitCount || 0);
                    setBehind(data.behindCount || 0);
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
        Promise.all([fetchCommits(), fetchBranchRange()])
            .then(([loaded, rangeInfo]) => {
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
                        // On mobile (<lg), start with list visible; on desktop default to branch-range
                        // overview when ahead-of-base data is available, otherwise auto-select first commit.
                        const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
                        if (isDesktop && rangeInfo && rangeInfo.commitCount > 0) {
                            setRightPanelView({ type: 'branch-range' });
                        } else {
                            const first = loaded.length > 0 ? loaded[0] : null;
                            setRightPanelView(isDesktop && first ? { type: 'commit', commit: first } : null);
                        }
                    }
                }
            })
            .catch(err => setError(err.message || 'Failed to load commits'))
            .finally(() => setLoading(false));
    }, [workspaceId, fetchCommits, fetchBranchRange]);

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
        const prevSelectedHash = rightPanelView?.type === 'commit' ? rightPanelView.commit.hash : rightPanelView?.type === 'commit-file' ? rightPanelView.hash : null;
        if (prevSelectedHash) {
            clearCacheForHash(prevSelectedHash);
        }
        Promise.all([fetchCommits(true, 0, searchQuery), fetchBranchRange(true)])
            .then(([loaded]) => {
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

    useWebSocket({
        onMessage: useCallback((msg: any) => {
            if (msg.type === 'git-changed' && msg.workspaceId === workspaceId) {
                if (gitChangedDebounceRef.current) clearTimeout(gitChangedDebounceRef.current);
                gitChangedDebounceRef.current = setTimeout(() => {
                    gitChangedDebounceRef.current = null;
                    refreshAll();
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
        }, [workspaceId, refreshAll]),
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

    // Recover pull status on mount (page refresh recovery)
    useEffect(() => {
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/ops/latest?op=pull`)
            .then((job: any) => {
                if (!job) return;
                if (job.status === 'running') {
                    startPullPolling(job.id);
                } else if (job.status === 'failed' && job.finishedAt) {
                    const elapsed = Date.now() - new Date(job.finishedAt).getTime();
                    if (elapsed < 5 * 60 * 1000) { // 5 min TTL
                        setActionError(job.error || 'Pull failed');
                    }
                }
            })
            .catch(() => {});
        return () => { stopPullPolling(); };
    }, [workspaceId, startPullPolling, stopPullPolling]);

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
        setRightPanelView({ type: 'commit-file', hash, filePath });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + hash + '/' + encodeURIComponent(filePath);
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [workspaceId, dispatch]);

    const handleWorkingTreeFileSelect = useCallback((filePath: string, stage: 'staged' | 'unstaged' | 'untracked') => {
        setRightPanelView({ type: 'working-tree-file', filePath, stage });
    }, []);

    const handleAllWorkingCommentsClick = useCallback(() => {
        setRightPanelView({ type: 'working-tree-comments' });
    }, []);

    const handleAllBranchCommentsClick = useCallback(() => {
        setRightPanelView({ type: 'branch-range-comments' });
    }, []);

    const handleMobileBack = useCallback(() => {
        setRightPanelView(null);
    }, []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

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
            refreshAll();
            setEnqueueToast('Commit message amended.');
            setTimeout(() => setEnqueueToast(null), 3000);
        } catch (err: any) {
            setActionError(err.message || 'Amend failed');
        }
    }, [amendingCommit, workspaceId, refreshAll]);

    const handleCommitContextMenu = useCallback((e: React.MouseEvent, commitHash: string) => {
        const commit = commits.find(c => c.hash === commitHash);
        if (!commit) return;
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'commit', commit });
    }, [commits]);

    const handleBranchContextMenu = useCallback((e: React.MouseEvent) => {
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'branch-range' });
    }, []);

    const MAX_BRANCH_DIFF_CHARS = 50_000;

    const buildBranchContextPrompt = useCallback((diff?: string): string => {
        const branchLabel = branchRangeData?.branchName || branchRangeData?.headRef || branchName || 'current branch';
        const baseShort = (branchRangeData?.baseRef ?? 'main').replace(/^origin\//, '');
        const headShort = branchRangeData?.headRef ?? 'HEAD';
        const commitCount = branchRangeData?.commitCount ?? 0;
        const additions = branchRangeData?.additions ?? 0;
        const deletions = branchRangeData?.deletions ?? 0;

        let prompt = `Branch: ${branchLabel} (${baseShort}..${headShort})\nCommits: ${commitCount}  +${additions} -${deletions}`;

        if (diff !== undefined) {
            if (diff.length > MAX_BRANCH_DIFF_CHARS) {
                prompt += '\n\n(Full diff omitted — exceeds size limit. Stat summary above.)';
            } else {
                prompt += `\n\n<diff>\n${diff}\n</diff>`;
            }
        }

        return prompt;
    }, [branchRangeData, branchName]);

    const handleBranchAskAI = useCallback(async (mode: 'ask' | 'task') => {
        let diff: string | undefined;
        try {
            const diffData = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/diff`);
            diff = diffData.diff || '';
        } catch { /* fall back to stat-only prompt */ }
        const initialPrompt = buildBranchContextPrompt(diff);
        queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode, initialPrompt, launchMode: 'floating-chat' });
    }, [workspaceId, buildBranchContextPrompt, queueDispatch]);

    const handleEnqueueSkill = useCallback(async (skillName: string) => {
        if (!contextMenu) return;
        const snapshot = { ...contextMenu };
        closeContextMenu();

        const MAX_LINES = 3000;
        const truncateDiff = (diff: string) => {
            const lines = diff.split('\n');
            if (lines.length <= MAX_LINES) return diff;
            return lines.slice(0, MAX_LINES).join('\n') +
                `\n[Diff truncated — showing first ${MAX_LINES} lines of ${lines.length} total]`;
        };

        try {
            let promptContent: string;
            if (snapshot.type === 'commit' && snapshot.commit) {
                const { commit } = snapshot;
                const diffData = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${commit.hash}/diff`);
                const diff = truncateDiff(diffData.diff || '');
                promptContent = `Review the following git changes.\n\nCommit: ${commit.hash} — ${commit.subject}\nAuthor: ${commit.author}\n\n<diff>\n${diff}\n</diff>`;
            } else {
                const diffData = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/branch-range/diff`);
                const diff = truncateDiff(diffData.diff || '');
                const commitCount = branchRangeData?.commitCount ?? 0;
                const base = (branchRangeData?.baseRef ?? 'main').replace(/^origin\//, '');
                promptContent = `Review the following branch changes (${commitCount} commit${commitCount !== 1 ? 's' : ''} ahead of ${base}).\n\n<diff>\n${diff}\n</diff>`;
            }

            const ws = state.workspaces.find((w: any) => w.id === workspaceId);
            const shortId = snapshot.type === 'commit' && snapshot.commit
                ? snapshot.commit.shortHash
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
            if (isHead) {
                items.push({ label: '', separator: true, onClick: () => {} });
                items.push({
                    label: 'Amend Message\u2026',
                    icon: '✏️',
                    onClick: () => { closeContextMenu(); setAmendingCommit(commit); },
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
                icon: '🤖',
                onClick: () => {
                    const initialPrompt = `Commit: ${commit.hash}${commit.subject ? ` — ${commit.subject}` : ''}`;
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'ask', initialPrompt, launchMode: 'floating-chat' });
                },
            });
            items.push({
                label: 'Queue Task',
                icon: '📋',
                onClick: () => {
                    const initialPrompt = `Commit: ${commit.hash}${commit.subject ? ` — ${commit.subject}` : ''}`;
                    queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'task', initialPrompt, launchMode: 'floating-chat' });
                },
            });
        }

        if (contextMenu.type === 'branch-range') {
            items.push({
                label: 'Ask AI',
                icon: '🤖',
                onClick: () => { void handleBranchAskAI('ask'); },
            });
            items.push({
                label: 'Queue Task',
                icon: '📋',
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
    }, [contextMenu, skills, handleEnqueueSkill, handleBranchAskAI, handleSelect, handleHardReset, handleCherryPick, commits, closeContextMenu, queueDispatch, workspaceId]);

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
                {error}
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
            commits={commits}
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
        <CommitDetail
            key={`${rightPanelView.hash}-${rightPanelView.filePath}`}
            workspaceId={workspaceId}
            hash={rightPanelView.hash}
            filePath={rightPanelView.filePath}
            commit={commits.find(c => c.hash === rightPanelView.hash)}
        />
    ) : rightPanelView?.type === 'branch-range' ? (
        <CommitDetail
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
        <BranchFileDiff
            key={rightPanelView.filePath}
            workspaceId={workspaceId}
            filePath={rightPanelView.filePath}
        />
    ) : rightPanelView?.type === 'working-tree-file' ? (
        <WorkingTreeFileDiff
            key={`${rightPanelView.filePath}:${rightPanelView.stage}`}
            workspaceId={workspaceId}
            filePath={rightPanelView.filePath}
            stage={rightPanelView.stage}
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
        </>
    );
}
