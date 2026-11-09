/**
 * useRepoGitSelection — right-panel selection for the Git tab.
 *
 * Owns which detail surface is showing (`RightPanelView`), the hunk a file
 * navigation should land on, and the "opened by SHA" commit that direct lookup
 * produces. Every navigation goes through one of the `select*` callbacks,
 * which only ever touch this component's own state — addressing lives
 * entirely with the host: `RepoGitTab` reports each resulting view upward
 * through its own `onViewChange` prop (see its "Report what the detail
 * shows" effect), and a host that owns a `coc://git` page
 * (`useSplitGitPanel`) turns that into the page's own address.
 *
 * A host restores a previously addressed view by passing `restore` to
 * `hydrateFromInitialLoad` (mount time) or by bumping `viewScopeKey` and
 * calling `switchViewScope` (an external open while already mounted — see
 * `RepoGitTab`'s `viewScopeKey` effect). A commit outside the loaded page
 * falls back to a direct `getCommit` lookup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { isGitCommitLookupEnabled } from '../../../utils/config';
import type { GitCommitItem } from '../commits/CommitList';
import { knownCommitFor } from './knownCommit';
import { selectedHashesOf } from './selectionModel';
import type { HunkTarget, PersistedGitView, RightPanelView } from './types';

/** A 7–40 char hex string is the only thing worth sending to `getCommit`. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

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
    /** The workspace whose git data this panel shows. */
    workspaceId: string;
    /** The loaded commit page — searched before falling back to direct lookup. */
    commits: GitCommitItem[];
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
    selectWorkingTreeAll: () => void;
    selectWorkingTreeComments: () => void;
    selectBranchRangeComments: () => void;
    /** Mobile "back to list" — clears the detail so the list shows again. */
    clearSelection: () => void;
    // Direct SHA lookup
    commitLookupLoading: boolean;
    commitLookupError: string | null;
    clearCommitLookupError: () => void;
    lookupCommit: (sha: string) => Promise<void>;
    /** Truthy for a commit-ish view — drives CommitList's initial expansion. */
    initialCommitHash: string | null;
    /**
     * Resolve the view the tab mounted with, once the first commit page has
     * landed: `restore` — a view a host persisted (e.g. the right panel's
     * Git page address) — is refetched; commits by hash, everything else
     * re-read from current state. With no `restore`, plain history shows.
     */
    hydrateFromInitialLoad: (loaded: GitCommitItem[], restore?: PersistedGitView | null) => void;
    /** Set when a restored view's commit no longer exists; cleared by any selection. */
    restoreNotFound: string | null;
    /**
     * The host's view scope changed — e.g. an external open changed the right
     * panel's Git page address while this tab was already mounted: drop the
     * current view and every pending lookup, then refetch `restore` or show
     * nothing.
     */
    switchViewScope: (restore: PersistedGitView | null) => void;
}

export function useRepoGitSelection({
    workspaceId, commits,
}: UseRepoGitSelectionOptions): UseRepoGitSelectionReturn {
    // AC-07: direct commit lookup targets the selected clone's server.
    const cloneClient = useCocClient(workspaceId);

    const [view, setView] = useState<RightPanelView | null>(null);
    const [hunkTarget, setHunkTarget] = useState<HunkTarget>();
    const [commitLookupLoading, setCommitLookupLoading] = useState(false);
    const [commitLookupError, setCommitLookupError] = useState<string | null>(null);
    const [restoreNotFound, setRestoreNotFound] = useState<string | null>(null);

    // `refreshAll` and other async callers need the view as of *now*, not as of
    // whenever their callback was memoized.
    const viewRef = useRef(view);
    viewRef.current = view;
    const getView = useCallback(() => viewRef.current, []);

    const commitsRef = useRef(commits);
    commitsRef.current = commits;

    // ── Navigation ────────────────────────────────────────────────────────────

    const selectCommit = useCallback((commit: GitCommitItem) => {
        setHunkTarget(undefined);
        setView({ type: 'commit', commit });
    }, []);

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
    }, []);

    const navigateToCommitFile = useCallback((hash: string, filePath: string, target: 'first' | 'last') => {
        setHunkTarget(target);
        setView({ type: 'commit-file', hash, filePath });
    }, []);

    const selectBranchRange = useCallback(() => {
        setHunkTarget(undefined);
        setView({ type: 'branch-range' });
    }, []);

    const selectBranchFile = useCallback((filePath: string) => {
        setHunkTarget(undefined);
        setView({ type: 'branch-file', filePath });
    }, []);

    const navigateToBranchFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setHunkTarget(target);
        setView({ type: 'branch-file', filePath });
    }, []);

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

    const selectWorkingTreeAll = useCallback(() => {
        setHunkTarget(undefined);
        setView({ type: 'working-tree-all' });
    }, []);

    const selectWorkingTreeComments = useCallback(() => setView({ type: 'working-tree-comments' }), []);
    const selectBranchRangeComments = useCallback(() => setView({ type: 'branch-range-comments' }), []);
    const clearSelection = useCallback(() => {
        setView(null);
        setRestoreNotFound(null);
    }, []);
    const clearCommitLookupError = useCallback(() => setCommitLookupError(null), []);

    // ── Direct SHA lookup ─────────────────────────────────────────────────────

    /**
     * Monotonic request generation. Re-routing the clone client, or
     * unmounting, bumps it, so a slow `getCommit` that lands afterwards
     * cannot overwrite the new detail.
     */
    const lookupGenerationRef = useRef(0);
    useEffect(() => () => { lookupGenerationRef.current += 1; }, [workspaceId, cloneClient]);

    /**
     * Fetch a commit that isn't in the loaded page and pin the panel to it.
     * Failure leaves the current view untouched.
     */
    const openCommitBySha = useCallback((
        sha: string,
        options?: { filePath?: string | null },
    ) => {
        const generation = lookupGenerationRef.current += 1;
        const isCurrent = () => lookupGenerationRef.current === generation;
        setCommitLookupLoading(true);
        setCommitLookupError(null);
        return cloneClient.git.getCommit(workspaceId, sha)
            .then(result => {
                if (!isCurrent()) return;
                const commit = toCommitItem(result);
                // A deep-linked commit FILE keeps its file once the SHA resolves.
                setView(options?.filePath
                    ? { type: 'commit-file', hash: commit.hash, filePath: options.filePath }
                    : { type: 'commit', commit });
            })
            .catch(() => {
                if (!isCurrent()) return;
                setCommitLookupError('Commit not found or ambiguous SHA');
            })
            .finally(() => { if (isCurrent()) setCommitLookupLoading(false); });
    }, [cloneClient, workspaceId]);

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
            setCommitLookupError(null);
            return;
        }

        await openCommitBySha(normalizedSha);
    }, [selectCommit, openCommitBySha]);

    // ── Restoring a persisted view ────────────────────────────────────────────

    /**
     * Refetch a persisted view. A commit outside the loaded page is looked up
     * by hash; one that no longer exists leaves no view and a not-found notice
     * rather than a blank detail.
     */
    const restorePersistedView = useCallback((persisted: PersistedGitView, loaded: GitCommitItem[]) => {
        // A commit the opener already read counts as loaded.
        const loadedCommit = (hash: string) => loaded.find(c => c.hash === hash) ?? knownCommitFor(workspaceId, hash) ?? undefined;
        const withCommit = (hash: string, show: (commit: GitCommitItem) => RightPanelView) => {
            const found = loadedCommit(hash);
            if (found) {
                setView(show(found));
                return;
            }
            const generation = lookupGenerationRef.current += 1;
            cloneClient.git.getCommit(workspaceId, hash)
                .then(result => {
                    if (lookupGenerationRef.current !== generation || viewRef.current) return;
                    const commit = toCommitItem(result);
                    setView(show(commit));
                })
                .catch(() => {
                    if (lookupGenerationRef.current !== generation || viewRef.current) return;
                    setRestoreNotFound(`Commit ${hash.slice(0, 7)} was not found. It may have been rewritten or removed.`);
                });
        };
        switch (persisted.type) {
            case 'commit':
                withCommit(persisted.hash, commit => ({ type: 'commit', commit }));
                return;
            case 'commit-file':
                withCommit(persisted.hash, commit => ({ type: 'commit-file', hash: commit.hash, filePath: persisted.filePath }));
                return;
            case 'multi-commit': {
                const found = persisted.hashes.map(loadedCommit).filter((c): c is GitCommitItem => !!c);
                if (found.length > 1) setView({ type: 'multi-commit', commits: found });
                else withCommit(found[0]?.hash ?? persisted.hashes[0], commit => ({ type: 'commit', commit }));
                return;
            }
            default:
                setView(persisted);
        }
    }, [cloneClient, workspaceId]);

    /**
     * Resolve the view the tab mounted with: a host-persisted `restore` (e.g.
     * the right panel's Git page address), or plain history with none.
     */
    const hydrateFromInitialLoad = useCallback((loaded: GitCommitItem[], restore?: PersistedGitView | null) => {
        if (restore) restorePersistedView(restore, loaded);
    }, [restorePersistedView]);

    /**
     * The host switched to another view scope — e.g. an external open changed
     * the right panel's Git page address while this tab was already mounted
     * (see `useSplitGitPanel`'s `viewScopeKey`, and `RepoGitTab`'s effect that
     * calls this on a change): drop the current view and every pending
     * lookup, then refetch `restore` or show nothing.
     */
    const switchViewScope = useCallback((restore: PersistedGitView | null) => {
        // A lookup still in flight belongs to the scope being left.
        lookupGenerationRef.current += 1;
        setHunkTarget(undefined);
        setCommitLookupLoading(false);
        setCommitLookupError(null);
        setRestoreNotFound(null);
        setView(null);
        if (restore) restorePersistedView(restore, commitsRef.current);
    }, [restorePersistedView]);

    // Any selection supersedes a restore that came up empty.
    useEffect(() => {
        if (view) setRestoreNotFound(null);
    }, [view]);

    // ── Derived ───────────────────────────────────────────────────────────────

    const selectedHashes = useMemo(() => selectedHashesOf(view), [view]);

    const selectedCommit = useMemo(() => {
        if (view?.type === 'commit') return view.commit;
        if (view?.type === 'commit-file') return commits.find(c => c.hash === view.hash) ?? null;
        return null;
    }, [view, commits]);

    // Truthy exactly for a view with a commit-ish identity (not a working-tree
    // file or a transient comments/multi-commit view) — drives CommitList's
    // initial ancestor expansion the same way a deep-linked hash used to.
    const initialCommitHash = view?.type === 'commit' ? view.commit.hash
        : view?.type === 'commit-file' ? view.hash
        : view?.type === 'branch-range' || view?.type === 'branch-file' || view?.type === 'working-tree-all' ? view.type
        : null;

    return {
        view, setView, getView, hunkTarget, selectedHashes, selectedCommit,
        selectCommit, selectCommits, selectCommitFile, navigateToCommitFile,
        selectBranchRange, selectBranchFile, navigateToBranchFile,
        selectWorkingTreeFile, navigateToWorkingTreeFile, selectWorkingTreeAll,
        selectWorkingTreeComments, selectBranchRangeComments, clearSelection,
        commitLookupLoading, commitLookupError, clearCommitLookupError,
        lookupCommit, initialCommitHash, hydrateFromInitialLoad, restoreNotFound,
        switchViewScope,
    };
}
