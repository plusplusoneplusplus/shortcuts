/**
 * useRepoGitSelection — right-panel routing for the Git tab.
 *
 * Owns which detail surface is showing (`RightPanelView`), the hunk a file
 * navigation should land on, and the "opened by SHA" commit that direct lookup
 * produces. Every navigation goes through one of the `select*` callbacks, so
 * the three things a selection must keep in sync — component state, the URL
 * hash, and the AppContext deep-link fields — can never drift apart the way
 * they did when each call site wrote all three by hand.
 *
 * Deep links arrive two ways and both land here: `hydrateFromInitialLoad` for
 * the link the tab mounted with, and an effect watching
 * `state.selectedGitCommitHash` for links clicked later (e.g. from the activity
 * tab). A SHA that isn't in the loaded page falls back to a direct
 * `getCommit` lookup when the `gitCommitLookup` flag is on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { useApp } from '../../../contexts/AppContext';
import { isGitCommitLookupEnabled } from '../../../utils/config';
import type { GitCommitItem } from '../commits/CommitList';
import { selectedHashesOf } from './selectionModel';
import type { HunkTarget, RightPanelView } from './types';

/** A 7–40 char hex string is the only thing worth sending to `getCommit`. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/** The sentinel `selectedGitCommitHash` uses for "the branch range", not a SHA. */
export const BRANCH_RANGE_DEEP_LINK = 'branch-range';

export function isLookupCandidate(sha: string): boolean {
    return SHA_PATTERN.test(sha);
}

/** A `getCommit` response, in the shape the list's commit item needs. */
export interface CommitLookupResult {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    authorEmail?: string;
    date: string;
    parentHashes: string[];
    body?: string;
}

/** Map a `getCommit` response onto the list's commit shape. */
export function toCommitItem(result: CommitLookupResult): GitCommitItem {
    return {
        hash: result.hash,
        shortHash: result.shortHash,
        subject: result.subject,
        author: result.author,
        authorEmail: result.authorEmail,
        date: result.date,
        parentHashes: result.parentHashes,
        body: result.body,
    };
}

export interface UseRepoGitSelectionOptions {
    workspaceId: string;
    /** The loaded commit page — searched before falling back to direct lookup. */
    commits: GitCommitItem[];
    /** Suppresses late deep-link handling while the initial load is in flight. */
    loading: boolean;
}

export interface UseRepoGitSelectionReturn {
    view: RightPanelView | null;
    setView: (view: RightPanelView | null) => void;
    /** Read the current view without capturing it in a callback's closure. */
    getView: () => RightPanelView | null;
    hunkTarget: HunkTarget;
    selectedHashes: ReadonlySet<string>;
    /** The commit the panel is pinned to, resolving `commit-file` against `commits`. */
    selectedCommit: GitCommitItem | null;
    // Navigation
    selectCommit: (commit: GitCommitItem) => void;
    selectCommits: (commits: GitCommitItem[]) => void;
    selectCommitFile: (hash: string, filePath: string) => void;
    navigateToCommitFile: (hash: string, filePath: string, target: 'first' | 'last') => void;
    selectBranchRange: () => void;
    selectBranchFile: (filePath: string) => void;
    navigateToBranchFile: (filePath: string, target: 'first' | 'last') => void;
    selectWorkingTreeFile: (filePath: string, stage: 'staged' | 'unstaged' | 'untracked') => void;
    navigateToWorkingTreeFile: (filePath: string, target: 'first' | 'last') => void;
    selectWorkingTreeComments: () => void;
    selectBranchRangeComments: () => void;
    /** Mobile "← Back to list" — clears the detail so the list shows again. */
    clearSelection: () => void;
    // Direct SHA lookup
    openedCommit: GitCommitItem | null;
    commitLookupLoading: boolean;
    commitLookupError: string | null;
    clearCommitLookupError: () => void;
    lookupCommit: (sha: string) => Promise<void>;
    /** Deep link the tab mounted with — drives CommitList's initial expansion. */
    initialCommitHash: string | null;
    /** Resolve the mount-time deep link once the first commit page has landed. */
    hydrateFromInitialLoad: (loaded: GitCommitItem[]) => void;
}

export function useRepoGitSelection({
    workspaceId, commits, loading,
}: UseRepoGitSelectionOptions): UseRepoGitSelectionReturn {
    // AC-07: direct commit lookup targets the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    const { state, dispatch } = useApp();

    const initialCommitHash = state.selectedGitCommitHash;
    const initialFilePath = state.selectedGitFilePath;
    // Seeded with the mount-time hash so the "late deep link" effect doesn't
    // immediately re-handle the link the initial load already consumed.
    const consumedDeepLinkRef = useRef<string | null>(initialCommitHash);

    const [view, setView] = useState<RightPanelView | null>(null);
    const [hunkTarget, setHunkTarget] = useState<HunkTarget>();
    const [openedCommit, setOpenedCommit] = useState<GitCommitItem | null>(null);
    const [commitLookupLoading, setCommitLookupLoading] = useState(false);
    const [commitLookupError, setCommitLookupError] = useState<string | null>(null);

    // `refreshAll` and other async callers need the view as of *now*, not as of
    // whenever their callback was memoized.
    const viewRef = useRef(view);
    viewRef.current = view;
    const getView = useCallback(() => viewRef.current, []);

    const commitsRef = useRef(commits);
    commitsRef.current = commits;

    const setHash = useCallback((suffix: string) => {
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + suffix;
    }, [workspaceId]);

    // ── Navigation ────────────────────────────────────────────────────────────

    const selectCommit = useCallback((commit: GitCommitItem) => {
        setView({ type: 'commit', commit });
        setHash(commit.hash);
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: commit.hash });
        dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
    }, [setHash, dispatch]);

    const selectCommits = useCallback((selectedCommits: GitCommitItem[]) => {
        if (selectedCommits.length === 0) {
            setView(null);
            return;
        }
        if (selectedCommits.length === 1) {
            selectCommit(selectedCommits[0]);
            return;
        }
        setView({ type: 'multi-commit', commits: selectedCommits });
    }, [selectCommit]);

    const selectCommitFile = useCallback((hash: string, filePath: string) => {
        setHunkTarget(undefined);
        setView({ type: 'commit-file', hash, filePath });
        setHash(hash + '/' + encodeURIComponent(filePath));
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [setHash, dispatch]);

    const navigateToCommitFile = useCallback((hash: string, filePath: string, target: 'first' | 'last') => {
        setHunkTarget(target);
        setView({ type: 'commit-file', hash, filePath });
        setHash(hash + '/' + encodeURIComponent(filePath));
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [setHash, dispatch]);

    const selectBranchRange = useCallback(() => {
        setView({ type: 'branch-range' });
        setHash('branch-range');
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: 'branch-range' });
        dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
    }, [setHash, dispatch]);

    const selectBranchFile = useCallback((filePath: string) => {
        setHunkTarget(undefined);
        setView({ type: 'branch-file', filePath });
        setHash('branch-range/' + encodeURIComponent(filePath));
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: 'branch-range' });
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [setHash, dispatch]);

    const navigateToBranchFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setHunkTarget(target);
        setView({ type: 'branch-file', filePath });
        setHash('branch-range/' + encodeURIComponent(filePath));
        dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: 'branch-range' });
        dispatch({ type: 'SET_GIT_FILE_PATH', filePath });
    }, [setHash, dispatch]);

    const selectWorkingTreeFile = useCallback((filePath: string, stage: 'staged' | 'unstaged' | 'untracked') => {
        setHunkTarget(undefined);
        setView({ type: 'working-tree-file', filePath, stage });
    }, []);

    const navigateToWorkingTreeFile = useCallback((filePath: string, target: 'first' | 'last') => {
        // Working tree navigation keeps the current stage
        const current = viewRef.current;
        const currentStage = current?.type === 'working-tree-file' ? current.stage : 'unstaged';
        setHunkTarget(target);
        setView({ type: 'working-tree-file', filePath, stage: currentStage });
    }, []);

    const selectWorkingTreeComments = useCallback(() => setView({ type: 'working-tree-comments' }), []);
    const selectBranchRangeComments = useCallback(() => setView({ type: 'branch-range-comments' }), []);
    const clearSelection = useCallback(() => setView(null), []);
    const clearCommitLookupError = useCallback(() => setCommitLookupError(null), []);

    // ── Direct SHA lookup ─────────────────────────────────────────────────────

    /**
     * Fetch a commit that isn't in the loaded page and pin the panel to it.
     * Failure leaves the current view (and URL) untouched.
     */
    const openCommitBySha = useCallback((sha: string, options?: { updateUrl?: boolean }) => {
        setCommitLookupLoading(true);
        setCommitLookupError(null);
        return cloneClient.git.getCommit(workspaceId, sha)
            .then(result => {
                const commit = toCommitItem(result);
                setOpenedCommit(commit);
                setView({ type: 'commit', commit });
                if (options?.updateUrl) {
                    setHash(commit.hash);
                    dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: commit.hash });
                    dispatch({ type: 'CLEAR_GIT_FILE_PATH' });
                }
            })
            .catch(() => {
                setCommitLookupError(options?.updateUrl ? 'Commit not found or ambiguous SHA' : 'Commit not found');
            })
            .finally(() => setCommitLookupLoading(false));
    }, [workspaceId, setHash, dispatch]);

    /** Direct commit SHA lookup — used by search-input Enter and deep-link misses. */
    const lookupCommit = useCallback(async (sha: string) => {
        if (!isGitCommitLookupEnabled()) return;
        const normalizedSha = sha.toLowerCase().trim();
        if (!isLookupCandidate(normalizedSha)) return;

        // If already in the loaded list, just select it normally
        const existing = commitsRef.current.find(c =>
            c.hash.startsWith(normalizedSha) || normalizedSha.startsWith(c.hash.slice(0, normalizedSha.length)));
        if (existing) {
            selectCommit(existing);
            setOpenedCommit(null);
            setCommitLookupError(null);
            return;
        }

        await openCommitBySha(normalizedSha, { updateUrl: true });
    }, [selectCommit, openCommitBySha]);

    // ── Deep links ────────────────────────────────────────────────────────────

    /**
     * Resolve the deep link the tab mounted with, once the first page landed.
     * A `branch-range` sentinel opens the range (or one of its files); a SHA
     * opens the matching commit, falling back to direct lookup.
     */
    const hydrateFromInitialLoad = useCallback((loaded: GitCommitItem[]) => {
        if (initialCommitHash === BRANCH_RANGE_DEEP_LINK) {
            setView(initialFilePath
                ? { type: 'branch-file', filePath: initialFilePath }
                : { type: 'branch-range' });
            return;
        }
        const target = initialCommitHash
            ? loaded.find(c => c.hash.startsWith(initialCommitHash))
            : null;
        if (target && initialFilePath) {
            setView({ type: 'commit-file', hash: target.hash, filePath: initialFilePath });
            return;
        }
        if (target) {
            setView({ type: 'commit', commit: target });
            return;
        }
        // Deep-link SHA not found in loaded list — attempt direct lookup if enabled
        if (initialCommitHash && isGitCommitLookupEnabled() && isLookupCandidate(initialCommitHash)) {
            void openCommitBySha(initialCommitHash);
            return;
        }
        // Default to empty right panel; user must click to open something.
        setView(null);
    }, [initialCommitHash, initialFilePath, openCommitBySha]);

    // Deep-link navigation after mount: when state.selectedGitCommitHash changes
    // (e.g. clicking a commit link from the activity tab), select the target commit.
    useEffect(() => {
        const hash = state.selectedGitCommitHash;
        if (!hash || hash === BRANCH_RANGE_DEEP_LINK || loading) return;
        if (hash === consumedDeepLinkRef.current) return;
        consumedDeepLinkRef.current = hash;
        const target = commits.find(c => c.hash.startsWith(hash));
        if (!target) {
            // Commit not in loaded list — attempt direct lookup if feature enabled
            if (isGitCommitLookupEnabled() && isLookupCandidate(hash)) {
                void openCommitBySha(hash);
            }
            return;
        }
        const filePath = state.selectedGitFilePath;
        setView(filePath
            ? { type: 'commit-file', hash: target.hash, filePath }
            : { type: 'commit', commit: target });
    }, [state.selectedGitCommitHash, state.selectedGitFilePath, loading, commits, openCommitBySha]);

    // ── Derived ───────────────────────────────────────────────────────────────

    const selectedHashes = useMemo(() => selectedHashesOf(view), [view]);

    const selectedCommit = useMemo(() => {
        if (view?.type === 'commit') return view.commit;
        if (view?.type === 'commit-file') return commits.find(c => c.hash === view.hash) ?? null;
        return null;
    }, [view, commits]);

    return {
        view, setView, getView, hunkTarget, selectedHashes, selectedCommit,
        selectCommit, selectCommits, selectCommitFile, navigateToCommitFile,
        selectBranchRange, selectBranchFile, navigateToBranchFile,
        selectWorkingTreeFile, navigateToWorkingTreeFile,
        selectWorkingTreeComments, selectBranchRangeComments, clearSelection,
        openedCommit, commitLookupLoading, commitLookupError, clearCommitLookupError,
        lookupCommit, initialCommitHash, hydrateFromInitialLoad,
    };
}
