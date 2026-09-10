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
 * TWO workspace ids, on purpose. `routeWorkspaceId` owns the PAGE (a repo
 * group, when the tab is hosted by one) and is what the hash addresses;
 * `workspaceId` owns the git DATA and is what every request, cache and
 * preference targets. They are equal for an ordinary repo. Without the split, a
 * group member's commit click would write the MEMBER's hash and quietly leave
 * the group.
 *
 * Deep links arrive two ways and both land here: `hydrateFromInitialLoad` for
 * the link the tab mounted with, and an effect watching the routed Git
 * selection for links clicked later (e.g. from the activity tab, or Back /
 * Forward). A route is only consumed when its page owner AND data member match
 * this panel, so a retained-but-hidden panel can never swallow another scope's
 * selection. A SHA that isn't in the loaded page falls back to a direct
 * `getCommit` lookup when the `gitCommitLookup` flag is on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { useApp } from '../../../contexts/AppContext';
import { buildGitRouteHash } from '../../../layout/gitRoute';
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

/**
 * Identity of one routed selection: page owner, data member, revision and file.
 * Two routes that differ in ANY of the four are different navigations, so a
 * same-SHA file change and a member switch both re-hydrate the detail.
 */
export function gitRouteIdentity(
    routeWorkspaceId: string,
    workspaceId: string,
    commitHash: string | null,
    filePath: string | null,
): string {
    return [routeWorkspaceId, workspaceId, commitHash ?? '', filePath ?? ''].join('\u0000');
}

export interface UseRepoGitSelectionOptions {
    /** The workspace whose git data this panel shows. */
    workspaceId: string;
    /**
     * The workspace that owns the PAGE — a `group-<slug>` id when a repo group
     * hosts this panel. Defaults to `workspaceId` (an ordinary repo is its own
     * page), so single-repo call sites need no change.
     */
    routeWorkspaceId?: string;
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
    /** Mobile "back to list" — clears the detail so the list shows again. */
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
    workspaceId, routeWorkspaceId, commits, loading,
}: UseRepoGitSelectionOptions): UseRepoGitSelectionReturn {
    // AC-07: direct commit lookup targets the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    const { state, dispatch } = useApp();

    // The page owner. Equal to the data member unless a group hosts this panel.
    const pageWorkspaceId = routeWorkspaceId ?? workspaceId;

    // A route published by the router only belongs to this panel when BOTH ids
    // agree. A null scope means nobody claimed one (pop-out shells, unit tests),
    // in which case the selection fields are taken at face value as before.
    const scope = state.gitRouteScope;
    const routeIsOurs = !scope
        || (scope.routeWorkspaceId === pageWorkspaceId && scope.workspaceId === workspaceId);
    const routeCommitHash = routeIsOurs ? state.selectedGitCommitHash : null;
    const routeFilePath = routeIsOurs ? state.selectedGitFilePath : null;

    const [view, setView] = useState<RightPanelView | null>(null);
    const [hunkTarget, setHunkTarget] = useState<HunkTarget>();
    const [openedCommit, setOpenedCommit] = useState<GitCommitItem | null>(null);
    const [commitLookupLoading, setCommitLookupLoading] = useState(false);
    const [commitLookupError, setCommitLookupError] = useState<string | null>(null);

    // Seeded with the mount-time route so the "late deep link" effect doesn't
    // immediately re-handle the link the initial load is about to consume.
    const consumedRouteRef = useRef<string>(
        gitRouteIdentity(pageWorkspaceId, workspaceId, routeCommitHash, routeFilePath),
    );
    // The last routed selection actually seen in the store. The effect below
    // reacts to store TRANSITIONS, not to divergence: a locally published route
    // the store has not caught up with yet is not "the user navigated away".
    const storeRouteRef = useRef(consumedRouteRef.current);
    // The current route, readable from callbacks without re-memoizing them.
    const routeRef = useRef({ commitHash: routeCommitHash, filePath: routeFilePath });
    routeRef.current = { commitHash: routeCommitHash, filePath: routeFilePath };

    // `refreshAll` and other async callers need the view as of *now*, not as of
    // whenever their callback was memoized.
    const viewRef = useRef(view);
    viewRef.current = view;
    const getView = useCallback(() => viewRef.current, []);

    const commitsRef = useRef(commits);
    commitsRef.current = commits;

    /**
     * Write one navigation to the URL and to AppContext at once, and mark it as
     * already applied: the router echoes it straight back, and re-applying it
     * would reset the hunk this navigation is scrolling to.
     */
    const publishRoute = useCallback((commitHash: string | null, filePath: string | null) => {
        consumedRouteRef.current = gitRouteIdentity(pageWorkspaceId, workspaceId, commitHash, filePath);
        location.hash = buildGitRouteHash({
            routeWorkspaceId: pageWorkspaceId, workspaceId, commitHash, filePath,
        });
        dispatch({
            type: 'SET_GIT_ROUTE',
            routeWorkspaceId: pageWorkspaceId,
            workspaceId,
            commitHash,
            filePath,
        });
    }, [pageWorkspaceId, workspaceId, dispatch]);

    // ── Navigation ────────────────────────────────────────────────────────────

    const selectCommit = useCallback((commit: GitCommitItem) => {
        setHunkTarget(undefined);
        setView({ type: 'commit', commit });
        publishRoute(commit.hash, null);
    }, [publishRoute]);

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
        publishRoute(hash, filePath);
    }, [publishRoute]);

    const navigateToCommitFile = useCallback((hash: string, filePath: string, target: 'first' | 'last') => {
        setHunkTarget(target);
        setView({ type: 'commit-file', hash, filePath });
        publishRoute(hash, filePath);
    }, [publishRoute]);

    const selectBranchRange = useCallback(() => {
        setHunkTarget(undefined);
        setView({ type: 'branch-range' });
        publishRoute(BRANCH_RANGE_DEEP_LINK, null);
    }, [publishRoute]);

    const selectBranchFile = useCallback((filePath: string) => {
        setHunkTarget(undefined);
        setView({ type: 'branch-file', filePath });
        publishRoute(BRANCH_RANGE_DEEP_LINK, filePath);
    }, [publishRoute]);

    const navigateToBranchFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setHunkTarget(target);
        setView({ type: 'branch-file', filePath });
        publishRoute(BRANCH_RANGE_DEEP_LINK, filePath);
    }, [publishRoute]);

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
     * Monotonic request generation. Switching member, re-routing the clone
     * client, or unmounting all bump it, so a slow `getCommit` that lands
     * afterwards cannot overwrite the new detail or write an obsolete URL.
     */
    const lookupGenerationRef = useRef(0);
    useEffect(() => () => { lookupGenerationRef.current += 1; }, [workspaceId, pageWorkspaceId, cloneClient]);

    /**
     * Fetch a commit that isn't in the loaded page and pin the panel to it.
     * Failure leaves the current view (and URL) untouched.
     */
    const openCommitBySha = useCallback((
        sha: string,
        options?: { updateUrl?: boolean; filePath?: string | null },
    ) => {
        const generation = lookupGenerationRef.current += 1;
        const isCurrent = () => lookupGenerationRef.current === generation;
        setCommitLookupLoading(true);
        setCommitLookupError(null);
        return cloneClient.git.getCommit(workspaceId, sha)
            .then(result => {
                if (!isCurrent()) return;
                const commit = toCommitItem(result);
                setOpenedCommit(commit);
                // A deep-linked commit FILE keeps its file once the SHA resolves.
                setView(options?.filePath
                    ? { type: 'commit-file', hash: commit.hash, filePath: options.filePath }
                    : { type: 'commit', commit });
                if (options?.updateUrl) publishRoute(commit.hash, null);
            })
            .catch(() => {
                if (!isCurrent()) return;
                setCommitLookupError(options?.updateUrl ? 'Commit not found or ambiguous SHA' : 'Commit not found');
            })
            .finally(() => { if (isCurrent()) setCommitLookupLoading(false); });
    }, [cloneClient, workspaceId, publishRoute]);

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
     * Turn one routed selection into a detail view. Shared by mount-time
     * hydration and later navigation so both understand the same cases:
     * history (no selection), the branch range and its files, a loaded commit
     * and its files, and a SHA that needs a direct lookup.
     */
    const applyRoute = useCallback((
        commitHash: string | null,
        filePath: string | null,
        loaded: GitCommitItem[],
    ) => {
        if (!commitHash) {
            // Back to plain history: drop the detail and any lookup state with it.
            setView(null);
            setOpenedCommit(null);
            setCommitLookupError(null);
            return;
        }
        if (commitHash === BRANCH_RANGE_DEEP_LINK) {
            setView(filePath ? { type: 'branch-file', filePath } : { type: 'branch-range' });
            return;
        }
        const target = loaded.find(c => c.hash.startsWith(commitHash));
        if (target) {
            setView(filePath
                ? { type: 'commit-file', hash: target.hash, filePath }
                : { type: 'commit', commit: target });
            return;
        }
        // Deep-link SHA not in the loaded list — direct lookup if enabled.
        if (isGitCommitLookupEnabled() && isLookupCandidate(commitHash)) {
            void openCommitBySha(commitHash, { filePath });
            return;
        }
        // Default to empty right panel; user must click to open something.
        setView(null);
    }, [openCommitBySha]);

    /** Resolve the deep link the tab mounted with, once the first page landed. */
    const hydrateFromInitialLoad = useCallback((loaded: GitCommitItem[]) => {
        const { commitHash, filePath } = routeRef.current;
        const identity = gitRouteIdentity(pageWorkspaceId, workspaceId, commitHash, filePath);
        consumedRouteRef.current = identity;
        storeRouteRef.current = identity;
        applyRoute(commitHash, filePath, loaded);
    }, [applyRoute, pageWorkspaceId, workspaceId]);

    // Routed navigation after mount: Back/Forward, an activity-tab commit link,
    // a member switch, or a same-SHA file change. Every field of the route takes
    // part in the identity, so none of those look like "the same link" twice.
    useEffect(() => {
        if (loading || !routeIsOurs) return;
        const identity = gitRouteIdentity(pageWorkspaceId, workspaceId, routeCommitHash, routeFilePath);
        if (identity === storeRouteRef.current) return;
        storeRouteRef.current = identity;
        // Our own selection echoing back through the router: already applied,
        // and re-applying it would reset the hunk it is scrolling to.
        if (identity === consumedRouteRef.current) return;
        consumedRouteRef.current = identity;
        setHunkTarget(undefined);
        // The loaded page is read through a ref: a fresh `commits` array must
        // not re-run this, or a route the panel has already moved past would be
        // re-applied on every list refresh.
        applyRoute(routeCommitHash, routeFilePath, commitsRef.current);
    }, [
        routeIsOurs, routeCommitHash, routeFilePath, pageWorkspaceId, workspaceId,
        loading, applyRoute,
    ]);

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
        lookupCommit, initialCommitHash: routeCommitHash, hydrateFromInitialLoad,
    };
}
