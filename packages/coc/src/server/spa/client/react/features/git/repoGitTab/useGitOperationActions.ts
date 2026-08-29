/**
 * useGitOperationActions — every mutating git action the tab can run.
 *
 * Fetch, pull, push, push-to-commit, rebase autosquash, hard reset, amend,
 * reword, drop, cherry-pick (same clone), reorder, and conflict continue/abort
 * all live here, together with the four async-job pollers they need. Keeping
 * them in one hook means the in-flight flags, the single `actionError` banner
 * and the poller lifecycle are owned in one place: a poll can no longer outlive
 * a workspace switch, and no handler can leave a spinner stuck on.
 *
 * All calls route through the clone-aware client for `workspaceId` (AC-07).
 * The hook never refreshes data itself — it calls the injected `refreshAll`,
 * so data loading stays the data hook's responsibility.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { useCocClient } from '../../../repos/cloneRouting';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import type { GitCommitItem } from '../commits/CommitList';
import { useGitOperationPoller, type UseGitOperationPollerReturn } from '../hooks/useGitOperationPoller';
import type { GitRepoStateInfo, RefreshSelectionOptions } from './types';

/** A failed pull recovered on mount is only worth surfacing this recently. */
export const PULL_FAILURE_TTL_MS = 5 * 60 * 1000;

/**
 * Best-effort rebind of commit-chat binding when a hash changes.
 * Fires and forgets — failure is silent (the old binding simply orphans).
 */
export async function rebindCommitChat(
    workspaceId: string,
    oldHash: string,
    newHash: string
): Promise<void> {
    if (oldHash === newHash) return;
    try {
        await getCocClientForWorkspace(workspaceId).git.rebindCommitChatBinding(workspaceId, oldHash, newHash);
    } catch {
        // Best-effort — binding may not exist; ignore errors
    }
}

export interface UseGitOperationActionsOptions {
    workspaceId: string;
    /** Re-read all git data after a mutation lands. */
    refreshAll: (options?: RefreshSelectionOptions) => void;
    /** Bottom-right toast for non-blocking success/failure reports. */
    showToast: (message: string, durationMs?: number) => void;
    /** In-progress operation, needed by the conflict continue/abort actions. */
    repoState: GitRepoStateInfo | null;
    /** Newest-first commit list — the index space reorder works in. */
    commits: GitCommitItem[];
    unpushedCount: number;
    /** Reorder preview state, owned by the data hook so the list can render it. */
    pendingReorder: GitCommitItem[] | null;
    setPendingReorder: (order: GitCommitItem[] | null) => void;
    /** Restart the auto-pull countdown, so a manual pull doesn't double-pull. */
    onManualPull: () => void;
}

export interface UseGitOperationActionsReturn {
    actionError: string | null;
    setActionError: (message: string | null) => void;
    fetching: boolean;
    pulling: boolean;
    setPulling: (value: boolean) => void;
    pushing: boolean;
    rebasing: boolean;
    /** Shared with the auto-pull controller so both pull paths use one poller. */
    pullPoller: UseGitOperationPollerReturn;
    startPullPolling: (jobId: string) => void;
    stopPullPolling: () => void;
    // Remote sync
    fetch: () => Promise<void>;
    pull: () => Promise<void>;
    push: () => Promise<void>;
    pushToCommit: (commit: GitCommitItem) => Promise<void>;
    rebaseAutosquash: () => Promise<void>;
    // History rewriting
    hardReset: (commit: GitCommitItem) => Promise<void>;
    amend: (commit: GitCommitItem, title: string, body: string) => Promise<void>;
    reword: (commit: GitCommitItem, title: string) => Promise<void>;
    dropCommit: (commit: GitCommitItem) => Promise<void>;
    cherryPickToBranch: (commits: GitCommitItem[], targetBranch: string) => Promise<void>;
    // Reorder
    applyReorder: () => Promise<void>;
    cancelReorder: () => void;
    // Conflict resolution
    conflictContinue: () => Promise<void>;
    conflictAbort: () => Promise<void>;
    /** Sort a selection oldest-first using the loaded list's ordering. */
    orderOldestFirst: (selected: GitCommitItem[]) => GitCommitItem[];
}

export function useGitOperationActions({
    workspaceId, refreshAll, showToast, repoState, commits, unpushedCount,
    pendingReorder, setPendingReorder, onManualPull,
}: UseGitOperationActionsOptions): UseGitOperationActionsReturn {
    // AC-07: every mutation targets the selected clone's server.
    const cloneClient = useCocClient(workspaceId);

    const [actionError, setActionError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(false);
    const [pulling, setPulling] = useState(false);
    const [pushing, setPushing] = useState(false);
    const [rebasing, setRebasing] = useState(false);

    // Lifecycle-aware pollers for async git jobs (pull/rebase/drop/reorder). Each
    // owns its interval and clears it on unmount / repo switch.
    const pullPoller = useGitOperationPoller(workspaceId);
    const rebasePoller = useGitOperationPoller(workspaceId);
    const dropPoller = useGitOperationPoller(workspaceId);
    const reorderPoller = useGitOperationPoller(workspaceId);

    // ── Pull job polling ──────────────────────────────────────────────────────
    // Delegate interval lifecycle to the shared poller, keep the pull-specific
    // `pulling` flag and error handling here.
    const stopPullPolling = useCallback(() => {
        pullPoller.stop();
        setPulling(false);
    }, [pullPoller]);

    const startPullPolling = useCallback((jobId: string) => {
        setPulling(true);
        pullPoller.start(jobId, {
            // A missing job falls back to onSuccess → refreshAll, matching prior behavior.
            onSuccess: () => { setPulling(false); refreshAll(); },
            onFailure: (error) => { setPulling(false); setActionError(error || 'Pull failed'); },
            onError: () => { setPulling(false); },
        });
    }, [pullPoller, refreshAll]);

    // Stable refs so mount-recovery effect doesn't re-fire on callback identity changes
    const startPullPollingRef = useRef(startPullPolling);
    startPullPollingRef.current = startPullPolling;
    const stopPullPollingRef = useRef(stopPullPolling);
    stopPullPollingRef.current = stopPullPolling;

    // Recover pull status on mount (page refresh recovery)
    useEffect(() => {
        cloneClient.git.getLatestOperation(workspaceId, { op: 'pull' })
            .then((job: any) => {
                if (!job) return;
                if (job.status === 'running') {
                    startPullPollingRef.current(job.id);
                } else if (job.status === 'failed' && job.finishedAt) {
                    const elapsed = Date.now() - new Date(job.finishedAt).getTime();
                    if (elapsed < PULL_FAILURE_TTL_MS) {
                        setActionError(job.error || 'Pull failed');
                    }
                }
            })
            .catch(() => {});
        return () => { stopPullPollingRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    // ── Remote sync ───────────────────────────────────────────────────────────

    const fetch = useCallback(async () => {
        if (fetching) return;
        setFetching(true);
        setActionError(null);
        try {
            const result = await cloneClient.git.fetch(workspaceId, { currentBranchOnly: true });
            if (result.success === false) throw new Error(result.error || 'Fetch failed');
            refreshAll();
        } catch (err: any) {
            setActionError(err.message || 'Fetch failed');
        } finally {
            setFetching(false);
        }
    }, [fetching, workspaceId, refreshAll]);

    const pull = useCallback(async () => {
        if (pulling) return;
        onManualPull(); // a manual pull changes the repo's last-pull picture
        setPulling(true);
        setActionError(null);
        try {
            const result = await cloneClient.git.pull(workspaceId, { rebase: true, currentBranchOnly: true });
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
    }, [pulling, workspaceId, refreshAll, startPullPolling, onManualPull]);

    const push = useCallback(async () => {
        if (pushing) return;
        setPushing(true);
        setActionError(null);
        try {
            const result = await cloneClient.git.push(workspaceId);
            if (result.success === false) throw new Error(result.error || 'Push failed');
            refreshAll();
        } catch (err: any) {
            setActionError(err.message || 'Push failed');
        } finally {
            setPushing(false);
        }
    }, [pushing, workspaceId, refreshAll]);

    const pushToCommit = useCallback(async (commit: GitCommitItem) => {
        setPushing(true);
        setActionError(null);
        try {
            const result = await cloneClient.git.pushTo(workspaceId, commit.hash);
            if (result.success === false) throw new Error(result.error || 'Push failed');
            refreshAll();
        } catch (err: any) {
            setActionError(err.message || 'Push failed');
        } finally {
            setPushing(false);
        }
    }, [workspaceId, refreshAll]);

    const rebaseAutosquash = useCallback(async () => {
        if (rebasing) return;
        setRebasing(true);
        setActionError(null);
        try {
            const result = await cloneClient.git.rebaseAutosquash(workspaceId);
            if (result.jobId) {
                // Async rebase — poll for job completion (missing job → onSuccess → refreshAll)
                rebasePoller.start(result.jobId, {
                    onSuccess: () => { setRebasing(false); refreshAll(); },
                    onFailure: (error) => { setRebasing(false); setActionError(error || 'Rebase failed'); },
                    onError: () => { setRebasing(false); },
                });
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
    }, [rebasing, workspaceId, refreshAll, rebasePoller]);

    // ── History rewriting ─────────────────────────────────────────────────────

    const hardReset = useCallback(async (commit: GitCommitItem) => {
        const shortHash = commit.hash.slice(0, 7);
        if (!window.confirm(`Reset to ${shortHash}? This will discard all uncommitted changes.`)) return;
        setActionError(null);
        try {
            const result = await cloneClient.git.reset(workspaceId, commit.hash, 'hard');
            if (result.success === false) throw new Error(result.error || 'Reset failed');
            refreshAll();
        } catch (err: any) {
            setActionError(err.message || 'Reset failed');
        }
    }, [workspaceId, refreshAll]);

    const amend = useCallback(async (commit: GitCommitItem, title: string, body: string) => {
        setActionError(null);
        try {
            const result = await cloneClient.git.amend(workspaceId, title, body);
            if (result.error) throw new Error(result.error);
            // Rebind commit-chat if the amend produced a new hash
            if (result.hash && result.hash !== commit.hash) {
                rebindCommitChat(workspaceId, commit.hash, result.hash);
            }
            refreshAll({ selectHash: result.hash, selectFallbackToHead: true });
            showToast('Commit message amended.');
        } catch (err: any) {
            setActionError(err.message || 'Amend failed');
        }
    }, [workspaceId, refreshAll, showToast]);

    const reword = useCallback(async (commit: GitCommitItem, title: string) => {
        setActionError(null);
        try {
            const result = await cloneClient.git.reword(workspaceId, commit.hash, title);
            if (result.error) throw new Error(result.error);
            refreshAll();
            showToast('Commit title amended.');
        } catch (err: any) {
            setActionError(err.message || 'Reword failed');
        }
    }, [workspaceId, refreshAll, showToast]);

    const dropCommit = useCallback(async (commit: GitCommitItem) => {
        setActionError(null);
        try {
            const result = await cloneClient.git.dropCommit(workspaceId, commit.hash);
            if (result.jobId) {
                // Async drop — poll for completion (missing job → onSuccess → refreshAll)
                dropPoller.start(result.jobId, {
                    onSuccess: () => refreshAll({ selectFallbackToHead: true }),
                    onFailure: (error) => setActionError(error || 'Drop commit failed'),
                });
                return;
            }
            if (result.error) throw new Error(result.error);
            refreshAll({ selectFallbackToHead: true });
        } catch (err: any) {
            setActionError(err.message || 'Drop commit failed');
        }
    }, [workspaceId, refreshAll, dropPoller]);

    const cherryPickToBranch = useCallback(async (selected: GitCommitItem[], targetBranch: string) => {
        if (!selected.length) return;
        const hashes = selected.map(commit => commit.hash);
        const primaryHash = hashes[0];
        setActionError(null);
        try {
            const result = await cloneClient.git.cherryPick(workspaceId, primaryHash, {
                hashes,
                targetBranch,
            });
            if (result.conflicts) {
                throw new Error(result.error || result.message || 'Cherry-pick failed; changes were aborted and branch restored.');
            }
            if (result.success === false) {
                throw new Error(result.error || result.message || 'Cherry-pick failed');
            }
            refreshAll();
            const toastHash = hashes.length === 1 ? selected[0].shortHash : `${hashes.length} commits`;
            showToast(`Cherry-picked ${toastHash} onto ${targetBranch}`);
        } catch (error) {
            const message = getSpaCocClientErrorMessage(error, 'Cherry-pick failed');
            setActionError(message);
            throw new Error(message);
        }
    }, [workspaceId, refreshAll, showToast]);

    // ── Reorder ───────────────────────────────────────────────────────────────

    const orderOldestFirst = useCallback((selected: GitCommitItem[]) => {
        const indexByHash = new Map(commits.map((commit, index) => [commit.hash, index]));
        return [...selected].sort((left, right) => {
            const leftIndex = indexByHash.get(left.hash);
            const rightIndex = indexByHash.get(right.hash);
            if (leftIndex === undefined && rightIndex === undefined) return 0;
            if (leftIndex === undefined) return 1;
            if (rightIndex === undefined) return -1;
            return rightIndex - leftIndex;
        });
    }, [commits]);

    const applyReorder = useCallback(async () => {
        if (!pendingReorder) return;
        // Extract unpushed commits in the new display order, reversed to oldest-first for the API
        const reorderedUnpushed = pendingReorder.slice(0, unpushedCount);
        const commitHashes = [...reorderedUnpushed].reverse().map(c => c.hash);
        try {
            const resp = await cloneClient.git.rebaseReorder(workspaceId, commitHashes);
            showToast('Reorder started');
            setPendingReorder(null);
            // Poll for completion — reorder is terminal only on explicit success/failed
            // and refreshes on both, so a missing job keeps polling.
            if (resp?.jobId) {
                reorderPoller.start(resp.jobId, {
                    isComplete: (job) => job?.status === 'success' || job?.status === 'failed',
                    onSuccess: () => refreshAll(),
                    onFailure: (error) => { setActionError(error || 'Reorder failed'); refreshAll(); },
                });
            }
        } catch (err: any) {
            setActionError(`Reorder failed: ${err.message || 'Unknown error'}`);
            setPendingReorder(null);
        }
    }, [pendingReorder, unpushedCount, workspaceId, refreshAll, reorderPoller, showToast, setPendingReorder]);

    const cancelReorder = useCallback(() => setPendingReorder(null), [setPendingReorder]);

    // ── Conflict resolution ───────────────────────────────────────────────────

    const conflictContinue = useCallback(async () => {
        if (!repoState || repoState.operation === 'none') return;
        try {
            if (repoState.operation === 'merge') {
                await cloneClient.git.mergeContinue(workspaceId);
            } else {
                await cloneClient.git.rebaseContinue(workspaceId);
            }
            showToast(`${repoState.operation} continue started`);
            setTimeout(refreshAll, 2000);
        } catch (err: any) {
            setActionError(`Continue failed: ${err.message || 'Unknown error'}`);
        }
    }, [repoState, workspaceId, refreshAll, showToast]);

    const conflictAbort = useCallback(async () => {
        if (!repoState || repoState.operation === 'none') return;
        if (!confirm(`Abort the in-progress ${repoState.operation}? This will discard conflict resolutions.`)) return;
        try {
            if (repoState.operation === 'merge') {
                await cloneClient.git.mergeAbort(workspaceId);
            } else {
                await cloneClient.git.rebaseAbort(workspaceId);
            }
            refreshAll();
        } catch (err: any) {
            setActionError(`Abort failed: ${err.message || 'Unknown error'}`);
        }
    }, [repoState, workspaceId, refreshAll]);

    return {
        actionError, setActionError,
        fetching, pulling, setPulling, pushing, rebasing,
        pullPoller, startPullPolling, stopPullPolling,
        fetch, pull, push, pushToCommit, rebaseAutosquash,
        hardReset, amend, reword, dropCommit, cherryPickToBranch,
        applyReorder, cancelReorder,
        conflictContinue, conflictAbort, orderOldestFirst,
    };
}
