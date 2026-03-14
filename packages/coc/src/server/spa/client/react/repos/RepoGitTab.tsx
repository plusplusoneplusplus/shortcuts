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
import { BranchPickerModal } from './BranchPickerModal';
import { AmendMessageModal } from './AmendMessageModal';
import { useApp } from '../context/AppContext';
import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu';
import type { GitCommitItem } from './CommitList';
import type { BranchRangeInfo } from './BranchChanges';

interface RepoGitTabProps {
    workspaceId: string;
}

type RightPanelView =
    | { type: 'commit'; commit: GitCommitItem }
    | { type: 'commit-file'; hash: string; filePath: string }
    | { type: 'branch-file'; filePath: string }
    | { type: 'working-tree-file'; filePath: string; stage: 'staged' | 'unstaged' | 'untracked' };

export function RepoGitTab({ workspaceId }: RepoGitTabProps) {
    const { state, dispatch } = useApp();
    const { width: sidebarWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 320,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'git-sidebar-width',
    });
    const initialCommitHash = state.selectedGitCommitHash;
    const initialFilePath = state.selectedGitFilePath;
    const [commits, setCommits] = useState<GitCommitItem[]>([]);
    const [unpushedCount, setUnpushedCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [pushing, setPushing] = useState(false);
    const pullJobRef = useRef<string | null>(null);
    const pullPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [rightPanelView, setRightPanelView] = useState<RightPanelView | null>(null);

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

    const fetchCommits = useCallback((refresh = false) => {
        const qs = refresh ? '&refresh=true' : '';
        return fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits?limit=50${qs}`)
            .then(data => {
                const loaded = data.commits || [];
                setCommits(loaded);
                setUnpushedCount(data.unpushedCount || 0);
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
                }
            })
            .catch(() => {
                setOnDefaultBranch(true);
                setBranchRangeData(null);
            });
    }, [workspaceId]);

    // Initial load
    useEffect(() => {
        setLoading(true);
        setError(null);
        Promise.all([fetchCommits(), fetchBranchRange()])
            .then(([loaded]) => {
                const target = initialCommitHash
                    ? loaded.find((c: GitCommitItem) => c.hash.startsWith(initialCommitHash))
                    : null;
                if (target && initialFilePath) {
                    setRightPanelView({ type: 'commit-file', hash: target.hash, filePath: initialFilePath });
                } else if (target) {
                    setRightPanelView({ type: 'commit', commit: target });
                } else {
                    // On mobile (<lg), start with list visible; on desktop auto-select first commit
                    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;
                    const first = loaded.length > 0 ? loaded[0] : null;
                    setRightPanelView(isDesktop && first ? { type: 'commit', commit: first } : null);
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

    // Refresh all data (non-blocking, keeps current content visible)
    const refreshAll = useCallback(() => {
        if (refreshing) return;
        setRefreshing(true);
        setRefreshError(null);
        const prevSelectedHash = rightPanelView?.type === 'commit' ? rightPanelView.commit.hash : rightPanelView?.type === 'commit-file' ? rightPanelView.hash : null;
        Promise.all([fetchCommits(true), fetchBranchRange(true)])
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
                } else if (rightPanelView?.type === 'branch-file' || rightPanelView?.type === 'working-tree-file') {
                    // Keep the branch-file / working-tree-file view as-is during refresh
                } else if (rightPanelView === null) {
                    // No prior selection — keep list visible (preserves mobile back state)
                } else if (loaded.length > 0) {
                    setRightPanelView({ type: 'commit', commit: loaded[0] });
                }
            })
            .catch(err => setRefreshError(err.message || 'Refresh failed'))
            .finally(() => setRefreshing(false));
    }, [refreshing, rightPanelView, fetchCommits, fetchBranchRange]);

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

    const handleSelect = useCallback((commit: GitCommitItem) => {
        setRightPanelView({ type: 'commit', commit });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + commit.hash;
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: commit.hash });
        dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
    }, [workspaceId, dispatch]);

    const handleFileSelect = useCallback((filePath: string) => {
        setRightPanelView({ type: 'branch-file', filePath });
    }, []);

    const handleCommitFileSelect = useCallback((hash: string, filePath: string) => {
        setRightPanelView({ type: 'commit-file', hash, filePath });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + hash + '/' + encodeURIComponent(filePath);
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [workspaceId, dispatch]);

    const handleWorkingTreeFileSelect = useCallback((filePath: string, stage: 'staged' | 'unstaged' | 'untracked') => {
        setRightPanelView({ type: 'working-tree-file', filePath, stage });
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
    }, [contextMenu, skills, handleEnqueueSkill, handleSelect, handleHardReset, handleCherryPick, commits, closeContextMenu]);

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

    const commitListPanel = (
        <CommitList
            title="History"
            commits={commits}
            unpushedCount={unpushedCount}
            selectedHash={selectedCommit?.hash}
            selectedFile={selectedCommitFile}
            onSelect={handleSelect}
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
                    fetching={fetching}
                    pulling={pulling}
                    pushing={pushing}
                />
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
                />
                <WorkingTree
                    workspaceId={workspaceId}
                    onRefresh={refreshAll}
                    onFileSelect={handleWorkingTreeFileSelect}
                    selectedFilePath={selectedWorkingTreeFile}
                />
                {commitListPanel}
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
                className="fixed bottom-4 right-4 z-[10010] px-4 py-2.5 rounded-md shadow-lg text-xs text-white bg-[#0078d4] dark:bg-[#1a6bbf] max-w-xs"
                data-testid="enqueue-toast"
            >
                {enqueueToast}
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
