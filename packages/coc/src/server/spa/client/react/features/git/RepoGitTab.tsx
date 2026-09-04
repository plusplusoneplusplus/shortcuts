/**
 * RepoGitTab — Git commit history tab with left/right split layout.
 *
 * Left panel: GitPanelHeader + scenario banner + scrollable commit list
 * (UNPUSHED + HISTORY sections).
 * Right panel: detail view for the selected commit (metadata, files, diff).
 * Falls back to stacked vertical layout on narrow viewports (<1024px).
 *
 * This component is a composition shell. The behaviour lives in focused hooks
 * under `./repoGitTab/`:
 *   - `useRepoGitData`          commits, branch range, repo state, caches, refresh
 *   - `useRepoGitSelection`     right-panel routing, URL/AppContext sync, deep links
 *   - `useGitOperationActions`  fetch/pull/push/rewrite/conflict actions + pollers
 *   - `useGitAutoPullController` the per-repo auto-pull setting + server status
 *   - `useGitSkillActions`      skill runs, Ask AI launches, queue-backed rewrites
 *   - `buildGitContextMenuItems` the right-click menu, as a pure model
 * and the three presentational panes (`RepoGitListPane`, `RepoGitDetailPane`,
 * `RepoGitOverlays`). What stays here is composition: the local UI state that
 * only the shell needs (open modals, search visibility, touch selection,
 * context-menu position), the keyboard shortcuts, and the two layouts.
 *
 * The clone-routed `workspaceId` is passed explicitly into every hook, so all
 * Git, queue and preferences traffic targets the selected clone's server (AC-07).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { GitPatchApplyResponse } from '@plusplusoneplusplus/coc-client';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { useCocClient } from '../../repos/cloneRouting';
import { lookupCloneBaseUrl } from '../../repos/cloneRegistry';
import { Spinner } from '../../ui';
import { isTouchOnly } from './commits/CommitList';
import type { GitCommitItem } from './commits/CommitList';
import { GitPanelHeader } from './GitPanelHeader';
import { clearBranchRangeCache } from './hooks/useBranchRangeCache';
import { useApp } from '../../contexts/AppContext';
import { useGitReviewPopOut, gitReviewPopOutKey } from '../../contexts/GitReviewPopOutContext';
import { buildGitReviewPopOutUrl } from '../../layout/Router';
import { buildFixupGroups } from './fixup-utils';
import { isGitCrossCloneCherryPickEnabled } from '../../utils/config';
import { useCommitClassificationStatus } from './hooks/useCommitClassificationStatus';
import { useScopedFindShortcut } from '../../hooks/useScopedFindShortcut';
import { popOutOpened } from '../../utils/popOutWindow';
import { matchCommitsByIdentity } from './repoGitTab/commitIdentity';
import { useTransientToast } from './repoGitTab/useTransientToast';
import { useRepoGitData } from './repoGitTab/useRepoGitData';
import { useRepoGitSelection } from './repoGitTab/useRepoGitSelection';
import { useGitOperationActions, rebindCommitChat } from './repoGitTab/useGitOperationActions';
import { useGitAutoPullController } from './repoGitTab/useGitAutoPullController';
import { useGitSkillActions } from './repoGitTab/useGitSkillActions';
import { buildGitContextMenuItems } from './repoGitTab/gitContextMenuModel';
import { RepoGitListPane } from './repoGitTab/RepoGitListPane';
import { RepoGitDetailPane } from './repoGitTab/RepoGitDetailPane';
import { RepoGitOverlays } from './repoGitTab/RepoGitOverlays';
import type { GitContextMenuState, SkillMenuContext } from './repoGitTab/types';

export { matchCommitsByIdentity } from './repoGitTab/commitIdentity';
export { buildBranchRangeSkillPrompt } from './repoGitTab/gitPrompts';

/** Debounce for the `git-changed` websocket event — bursts arrive per-file. */
const GIT_CHANGED_DEBOUNCE_MS = 500;

interface RepoGitTabProps {
    workspaceId: string;
    /**
     * When `'split-workspace'`, the tab renders ONLY its git list (commits +
     * working tree + branch changes, including the header stage/commit/push
     * actions) in place and portals its detail pane into `detailContainer`
     * (gated on `detailActive`), so chat + git can feed ONE shared detail region
     * — see `SplitWorkspacePanel`. Absent ⇒ the tab renders its own list + detail
     * exactly as before (strict no-op, no regression on the flag-off path).
     */
    layout?: 'split-workspace';
    /** Portal target for the detail pane when `layout === 'split-workspace'`. */
    detailContainer?: HTMLElement | null;
    /**
     * Only portal the detail when this tab holds the last click (AC-04) — so the
     * shared region never shows chat and git detail at the same time.
     */
    detailActive?: boolean;
    /** Fired when the user clicks in the git list, so the parent marks git last-clicked. */
    onActivateDetail?: () => void;
    /**
     * Portal target inside the split panel's "Git" section header. When set
     * (split-workspace only), the compact `GitPanelHeader` toolbar renders
     * there instead of as its own row, saving the toolbar's full height.
     */
    headerToolbarContainer?: HTMLElement | null;
}

export function RepoGitTab({ workspaceId, layout, detailContainer, detailActive, onActivateDetail, headerToolbarContainer }: RepoGitTabProps) {
    const isSplitWorkspace = layout === 'split-workspace';
    // Hoist the toolbar into the split panel's section header when a portal
    // target exists; everything in the list pane then uses the compact skin.
    const headerHoisted = isSplitWorkspace && !!headerToolbarContainer;
    // AC-07: ALL Git tab data (commit list, branch range, fetch/pull/push/reset,
    // operations, per-repo prefs, enqueue) targets the selected clone's server.
    const cloneClient = useCocClient(workspaceId);
    const { state } = useApp();
    const { markPoppedOut } = useGitReviewPopOut();
    const { width: sidebarWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: 320,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'git-sidebar-width',
    });

    // ── Shell-local UI state ──────────────────────────────────────────────────
    const [searchVisible, setSearchVisible] = useState(false);
    const [contextMenu, setContextMenu] = useState<GitContextMenuState | null>(null);
    const [branchPickerOpen, setBranchPickerOpen] = useState(false);
    const [amendingCommit, setAmendingCommit] = useState<GitCommitItem | null>(null);
    const [rewordingCommit, setRewordingCommit] = useState<GitCommitItem | null>(null);
    const [cherryPickTarget, setCherryPickTarget] = useState<{ commits: GitCommitItem[] } | null>(null);
    const [crossCloneCherryPickCommits, setCrossCloneCherryPickCommits] = useState<GitCommitItem[]>([]);
    const [isMobileSelecting, setIsMobileSelecting] = useState(false);
    const [mobileAnchorHash, setMobileAnchorHash] = useState<string | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLElement>(null);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);
    const { toast, showToast, clearToast } = useTransientToast();

    // ── Controllers ───────────────────────────────────────────────────────────
    // Selection is created first so the data hook can reconcile against it; the
    // deep-link hydration it needs is wired back through `onInitialLoad`, and it
    // reads commits through a ref, so there is no circular render dependency.
    const selectionRef = useRef<ReturnType<typeof useRepoGitSelection> | null>(null);

    const dataSelectionBridge = useMemo(() => ({
        getView: () => selectionRef.current?.getView() ?? null,
        setView: (view: Parameters<NonNullable<typeof selectionRef.current>['setView']>[0]) =>
            selectionRef.current?.setView(view),
    }), []);

    const hydrateRef = useRef<(loaded: GitCommitItem[]) => void>(() => {});
    const onInitialLoad = useCallback((loaded: GitCommitItem[]) => hydrateRef.current(loaded), []);

    const data = useRepoGitData({ workspaceId, selection: dataSelectionBridge, onInitialLoad });

    const selection = useRepoGitSelection({
        workspaceId,
        commits: data.commits,
        loading: data.loading,
    });
    selectionRef.current = selection;
    hydrateRef.current = selection.hydrateFromInitialLoad;

    const sourceWorkspace = useMemo(
        () => state.workspaces.find((w: any) => w.id === workspaceId),
        [state.workspaces, workspaceId],
    );
    const repoRoot = sourceWorkspace?.rootPath as string | undefined;

    // A manual pull changes what the repo's last-run row should say, so re-read
    // the server-owned auto-pull status; the schedule itself is the server's.
    const autoPullRef = useRef<{ refreshStatus: () => void }>({ refreshStatus: () => {} });
    const onManualPull = useCallback(() => autoPullRef.current.refreshStatus(), []);

    const actions = useGitOperationActions({
        workspaceId,
        refreshAll: data.refreshAll,
        showToast,
        repoState: data.repoState,
        commits: data.commits,
        unpushedCount: data.unpushedCount,
        pendingReorder: data.pendingReorder,
        setPendingReorder: data.setPendingReorder,
        onManualPull,
    });

    const autoPull = useGitAutoPullController({ workspaceId });
    autoPullRef.current = autoPull;

    const skillActions = useGitSkillActions({
        workspaceId,
        workspaceRootPath: repoRoot,
        commits: data.commits,
        unpushedCount: data.unpushedCount,
        branchRangeData: data.branchRangeData,
        branchName: data.branchName,
        resolvedBaseRef: data.resolvedBaseRef,
        repoState: data.repoState,
        showToast,
    });

    // Classification status — checked in bulk so each commit row can show a ✓ badge.
    const { classifiedHashes, refresh: refreshClassificationStatus } = useCommitClassificationStatus(
        workspaceId,
        workspaceId,
        data.visibleCommitHashes,
    );

    // ── WebSocket refresh ─────────────────────────────────────────────────────
    // A `git-changed` burst is debounced into one refresh. Commits are snapshotted
    // beforehand so a history rewrite can rebind commit-chat bindings by identity.
    const gitChangedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevCommitsRef = useRef<GitCommitItem[]>([]);
    const commitsRef = useRef(data.commits);
    commitsRef.current = data.commits;

    useWebSocket({
        onMessage: useCallback((msg: any) => {
            if (msg.type !== 'git-changed' || msg.workspaceId !== workspaceId) return;
            if (gitChangedDebounceRef.current) clearTimeout(gitChangedDebounceRef.current);
            gitChangedDebounceRef.current = setTimeout(() => {
                gitChangedDebounceRef.current = null;
                // Snapshot current commits before the refresh overwrites them
                prevCommitsRef.current = commitsRef.current;
                // Clear stale branch range cache so the next fetch returns current branch
                clearBranchRangeCache(workspaceId);
                Promise.all([
                    data.fetchCommits(true, 0, data.searchQuery),
                    data.fetchBranchRange(false),
                ]).then(([newCommits]) => {
                    data.markRefreshed();
                    // Heuristic rebind: match old→new commits by identity
                    const pairs = matchCommitsByIdentity(prevCommitsRef.current, newCommits as GitCommitItem[]);
                    for (const { oldHash, newHash } of pairs) {
                        rebindCommitChat(workspaceId, oldHash, newHash);
                    }
                    prevCommitsRef.current = [];
                });
                data.bumpWorkingChanges();
            }, GIT_CHANGED_DEBOUNCE_MS);
            // If we're tracking a pull job, re-fetch its status on git-changed
            const pullJobId = actions.pullPoller.activeJobId();
            if (pullJobId) {
                cloneClient.git.getOperation(workspaceId, pullJobId)
                    .then((job: any) => {
                        if (job && job.status !== 'running') {
                            actions.stopPullPolling();
                            if (job.status === 'failed') {
                                actions.setActionError(job.error || 'Pull failed');
                            }
                        }
                    })
                    .catch(() => {});
            }
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [workspaceId, data.fetchCommits, data.fetchBranchRange, data.searchQuery, actions.pullPoller, actions.stopPullPolling]),
    });

    // Never leave the debounce timer running past unmount / a workspace switch.
    useEffect(() => () => {
        if (gitChangedDebounceRef.current) clearTimeout(gitChangedDebounceRef.current);
        gitChangedDebounceRef.current = null;
    }, [workspaceId]);

    // ── Composed handlers ─────────────────────────────────────────────────────

    const handleOpenAsPopup = useCallback((commit: GitCommitItem) => {
        closeContextMenu();
        const url = buildGitReviewPopOutUrl(workspaceId, commit.hash, lookupCloneBaseUrl(workspaceId));
        const win = window.open(url, `coc-git-review-${commit.hash}`, 'width=1200,height=800');
        if (popOutOpened(win)) {
            markPoppedOut(gitReviewPopOutKey(workspaceId, commit.hash));
        }
    }, [workspaceId, closeContextMenu, markPoppedOut]);

    const handleMobileSelectingChange = useCallback((selecting: boolean) => {
        setIsMobileSelecting(selecting);
        if (!selecting) setMobileAnchorHash(null);
    }, []);

    const handleSwipeAction = useCallback((action: 'review' | 'ask-ai' | 'more', commitHash: string) => {
        const commit = data.commits.find(c => c.hash === commitHash);
        if (!commit) return;
        if (action === 'review') {
            selection.selectCommit(commit);
        } else if (action === 'ask-ai') {
            skillActions.askAboutCommit(commit, 'ask');
        } else if (action === 'more') {
            // Open full context menu at center of viewport
            setContextMenu({ x: window.innerWidth / 2, y: window.innerHeight / 2, type: 'commit', commit });
        }
    }, [data.commits, selection, skillActions]);

    const handleCommitContextMenu = useCallback((e: React.MouseEvent, commitHash: string) => {
        const view = selection.getView();
        if (view?.type === 'multi-commit' && view.commits.some(c => c.hash === commitHash)) {
            setContextMenu({ x: e.clientX, y: e.clientY, type: 'multi-commit', commits: view.commits });
            return;
        }
        const commit = data.commits.find(c => c.hash === commitHash);
        if (!commit) return;
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'commit', commit });
    }, [data.commits, selection]);

    const handleBranchContextMenu = useCallback((e: React.MouseEvent) => {
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'branch-range' });
    }, []);

    // Cherry-pick (same clone) — the picker collects the target branch, so the
    // menu action only stages the (oldest-first) commits.
    const handleOpenCherryPickToBranch = useCallback((selectedCommits: GitCommitItem[]) => {
        closeContextMenu();
        const orderedCommits = actions.orderOldestFirst(selectedCommits);
        if (orderedCommits.length === 0) return;
        actions.setActionError(null);
        setCherryPickTarget({ commits: orderedCommits });
    }, [closeContextMenu, actions]);

    const handleCherryPickToBranch = useCallback(async (targetBranch: string) => {
        if (!cherryPickTarget?.commits.length) return;
        await actions.cherryPickToBranch(cherryPickTarget.commits, targetBranch);
    }, [cherryPickTarget, actions]);

    const handleOpenCrossCloneCherryPick = useCallback((selectedCommits: GitCommitItem[]) => {
        closeContextMenu();
        const orderedCommits = actions.orderOldestFirst(selectedCommits);
        if (orderedCommits.length === 0) return;
        setCrossCloneCherryPickCommits(orderedCommits);
    }, [closeContextMenu, actions]);

    const handleCrossCloneCherryPickApplied = useCallback((response: GitPatchApplyResponse) => {
        data.refreshAll();
        const target = response.targetWorkspace.name || response.targetWorkspace.id;
        const commitHash = response.newCommitHash || response.targetHead;
        showToast(`Cherry-picked to ${target}${commitHash ? ` (${commitHash.slice(0, 7)})` : ''}`);
    }, [data.refreshAll, showToast]);

    const handleAmendConfirm = useCallback((title: string, body: string) => {
        const commit = amendingCommit;
        if (!commit) return;
        setAmendingCommit(null);
        void actions.amend(commit, title, body);
    }, [amendingCommit, actions]);

    const handleRewordConfirm = useCallback((title: string) => {
        const commit = rewordingCommit;
        if (!commit) return;
        setRewordingCommit(null);
        void actions.reword(commit, title);
    }, [rewordingCommit, actions]);

    const handleHardReset = useCallback((commit: GitCommitItem) => {
        closeContextMenu();
        void actions.hardReset(commit);
    }, [closeContextMenu, actions]);

    const handleDropCommit = useCallback((commit: GitCommitItem) => {
        closeContextMenu();
        void actions.dropCommit(commit);
    }, [closeContextMenu, actions]);

    const handlePushToCommit = useCallback((commit: GitCommitItem) => {
        closeContextMenu();
        void actions.pushToCommit(commit);
    }, [closeContextMenu, actions]);

    const handleSquashCommits = useCallback((selectedCommits: GitCommitItem[]) => {
        closeContextMenu();
        void skillActions.squashCommits(selectedCommits);
    }, [closeContextMenu, skillActions]);

    const handleRunSkill = useCallback((skillName: string, target: SkillMenuContext) => {
        closeContextMenu();
        skillActions.startSkillRun(skillName, target);
    }, [closeContextMenu, skillActions]);

    const handleSkillBrowserSelect = useCallback((skillName: string) => {
        const target = skillActions.skillBrowserContext;
        skillActions.closeSkillBrowser();
        if (target) skillActions.startSkillRun(skillName, target);
    }, [skillActions]);

    const handleStartMobileSelection = useCallback((commit: GitCommitItem) => {
        setIsMobileSelecting(true);
        setMobileAnchorHash(commit.hash);
        selection.selectCommits([commit]);
    }, [selection]);

    const handleExtendMobileSelection = useCallback((commit: GitCommitItem) => {
        if (!mobileAnchorHash) return;
        const anchorIdx = data.commits.findIndex(c => c.hash === mobileAnchorHash);
        const targetIdx = data.commits.findIndex(c => c.hash === commit.hash);
        if (anchorIdx === -1 || targetIdx === -1) return;
        const [start, end] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
        selection.selectCommits(data.commits.slice(start, end + 1));
    }, [mobileAnchorHash, data.commits, selection]);

    const handleBranchSwitched = useCallback((newBranch: string) => {
        data.setBranchName(newBranch);
        setBranchPickerOpen(false);
        data.reloadAfterBranchSwitch();
    }, [data]);

    // ── Context menu ──────────────────────────────────────────────────────────
    // Compute fixup groups for the context menu "Rebase autosquash" option
    const fixupGroupsForMenu = useMemo(() => buildFixupGroups(data.commits), [data.commits]);

    const contextMenuItems = useMemo(() => buildGitContextMenuItems({
        menu: contextMenu,
        commits: data.commits,
        unpushedCount: data.unpushedCount,
        fixupGroups: fixupGroupsForMenu,
        skills: skillActions.skills,
        skillUsageMap: skillActions.commitSkillUsageMap,
        crossCloneCherryPickEnabled: isGitCrossCloneCherryPickEnabled(),
        touchOnly: isTouchOnly(),
        mobileSelecting: isMobileSelecting,
        handlers: {
            selectCommit: selection.selectCommit,
            openAsPopup: handleOpenAsPopup,
            pushToCommit: handlePushToCommit,
            startAmend: setAmendingCommit,
            startReword: setRewordingCommit,
            rebaseAutosquash: () => { void actions.rebaseAutosquash(); },
            dropCommit: handleDropCommit,
            hardReset: handleHardReset,
            cherryPickToBranch: handleOpenCherryPickToBranch,
            crossCloneCherryPick: handleOpenCrossCloneCherryPick,
            squashCommits: handleSquashCommits,
            askAboutCommit: skillActions.askAboutCommit,
            askAboutCommits: skillActions.askAboutCommits,
            askAboutBranch: skillActions.askAboutBranch,
            startMobileSelection: handleStartMobileSelection,
            extendMobileSelection: handleExtendMobileSelection,
            runSkill: handleRunSkill,
            openSkillBrowser: skillActions.openSkillBrowser,
            copyToClipboard: (text: string) => { navigator.clipboard.writeText(text); },
            closeMenu: closeContextMenu,
        },
    }), [
        contextMenu, data.commits, data.unpushedCount, fixupGroupsForMenu,
        skillActions, isMobileSelecting, selection.selectCommit, handleOpenAsPopup,
        handlePushToCommit, actions, handleDropCommit, handleHardReset,
        handleOpenCherryPickToBranch, handleOpenCrossCloneCherryPick, handleSquashCommits,
        handleStartMobileSelection, handleExtendMobileSelection, handleRunSkill, closeContextMenu,
    ]);

    // ── Keyboard shortcuts ────────────────────────────────────────────────────

    // Reveal (if hidden) + focus the commit search box. Shared by the `/`
    // panel shortcut and the Ctrl+F find shortcut.
    const revealSearch = useCallback((select = false) => {
        setSearchVisible(true);
        setTimeout(() => {
            searchInputRef.current?.focus();
            if (select) searchInputRef.current?.select();
        }, 0);
    }, []);

    const hideSearch = useCallback(() => {
        setSearchVisible(false);
        data.setSearchQuery('');
    }, [data]);

    // AC-02: Ctrl+F / Cmd+F reveals + focuses the (hidden-by-default) commit
    // search box, routed by keyboard focus through the shared helper. A
    // document-level listener also catches focus on `document.body` while the
    // git tab is active (the panel-scoped `onKeyDown` below misses body focus).
    // In the split-workspace layout the chat list owns body focus, so this
    // panel only claims it when standalone.
    useScopedFindShortcut(panelRef, () => revealSearch(true), { claimsBodyFocus: !isSplitWorkspace });

    // Keyboard shortcuts:
    //   - R: refresh
    //   - /: reveal + focus the commit search input
    //   - Escape: hide + clear the search when the bar is open
    // Ignored when typing in inputs/textareas (except Escape from the search box,
    // which is handled on the input itself).
    const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
        const isTextField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (isTextField) return;
        if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            data.refreshAll();
            return;
        }
        if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            revealSearch(true);
            return;
        }
        if (e.key === 'Escape' && searchVisible) {
            e.preventDefault();
            hideSearch();
        }
    }, [data, revealSearch, hideSearch, searchVisible]);

    // ── Render ────────────────────────────────────────────────────────────────

    if (data.loading) {
        return (
            <div className="flex items-center justify-center py-8" data-testid="git-tab-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    if (data.error) {
        return (
            <div className="p-4 text-sm text-[#d32f2f] dark:text-[#f48771]" data-testid="git-tab-error">
                <p>{data.error}</p>
                <button
                    className="mt-2 px-3 py-1 text-xs rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#333] dark:text-[#ccc] hover:opacity-80"
                    onClick={data.retry}
                    data-testid="git-tab-retry"
                >
                    Retry
                </button>
            </div>
        );
    }

    const view = selection.view;
    const selectedCommitFile = view?.type === 'commit-file' ? { hash: view.hash, filePath: view.filePath } : null;
    const selectedBranchFile = view?.type === 'branch-file' ? view.filePath : null;
    const selectedWorkingTreeFile = view?.type === 'working-tree-file' ? view.filePath : null;

    const detailPanel = (
        <RepoGitDetailPane
            workspaceId={workspaceId}
            view={view}
            commits={data.commits}
            unpushedCount={data.unpushedCount}
            branchRangeData={data.branchRangeData}
            branchRangeFiles={data.branchRangeFiles}
            baseMode={data.baseMode}
            onBaseModeChange={data.setBaseModeAndRefetch}
            repoRoot={repoRoot}
            hunkTarget={selection.hunkTarget}
            onBranchFileSelect={selection.selectBranchFile}
            onNavigateToBranchFile={selection.navigateToBranchFile}
            onNavigateToCommitFile={selection.navigateToCommitFile}
            onNavigateToWorkingTreeFile={selection.navigateToWorkingTreeFile}
            onWorkingTreeFileMissing={data.bumpWorkingChanges}
            onAllBranchCommentsClick={selection.selectBranchRangeComments}
            onBranchAskAI={skillActions.askAboutBranch}
            onCommitClassified={refreshClassificationStatus}
        />
    );

    // Toolbar (branch pill + fetch/pull/push + refresh). Rendered inline at the
    // top of the list pane normally; when the split panel provides a section
    // header slot it's portaled there instead — as a sibling OUTSIDE the list's
    // onClickCapture wrapper, so toolbar clicks (Pull/refresh/…) don't mark git
    // last-clicked and steal the shared detail pane from the chat.
    const panelHeader = (
        <GitPanelHeader
            branch={data.branchName || 'HEAD'}
            ahead={data.ahead}
            behind={data.behind}
            refreshing={data.refreshing}
            onRefresh={data.refreshAll}
            onBranchClick={() => setBranchPickerOpen(true)}
            onFetch={actions.fetch}
            onPull={actions.pull}
            onPush={actions.push}
            onRebaseAutosquash={actions.rebaseAutosquash}
            fetching={actions.fetching}
            pulling={actions.pulling}
            pushing={actions.pushing}
            rebasing={actions.rebasing}
            autoPull={autoPull.autoPull}
            onAutoPullChange={autoPull.setAutoPull}
            autoPullStatus={autoPull.autoPullStatus}
            lastRefreshedAt={data.lastRefreshedAt}
            compact={headerHoisted}
        />
    );
    const hoistedHeaderPortal = headerHoisted && headerToolbarContainer
        ? createPortal(panelHeader, headerToolbarContainer)
        : null;

    const listPane = (
        <RepoGitListPane
            workspaceId={workspaceId}
            isSplitWorkspace={isSplitWorkspace}
            headerHoisted={headerHoisted}
            sidebarWidth={sidebarWidth}
            detailOpen={!!view}
            panelRef={panelRef}
            onPanelKeyDown={handlePanelKeyDown}
            header={panelHeader}
            searchVisible={searchVisible}
            searchQuery={data.searchQuery}
            searchInputRef={searchInputRef}
            onSearchQueryChange={data.setSearchQuery}
            onHideSearch={hideSearch}
            onCommitLookup={sha => { void selection.lookupCommit(sha); }}
            commitLookupLoading={selection.commitLookupLoading}
            commitLookupError={selection.commitLookupError}
            onDismissCommitLookupError={selection.clearCommitLookupError}
            behind={data.behind}
            onDefaultBranch={data.onDefaultBranch}
            refreshError={data.refreshError}
            onDismissRefreshError={() => data.setRefreshError(null)}
            actionError={actions.actionError}
            onDismissActionError={() => actions.setActionError(null)}
            branchRangeData={data.branchRangeData}
            branchRangeFiles={data.branchRangeFiles}
            baseMode={data.baseMode}
            selectedBranchFile={selectedBranchFile}
            onBranchFileSelect={selection.selectBranchFile}
            onBranchContextMenu={handleBranchContextMenu}
            onBranchRangeSelect={selection.selectBranchRange}
            workingChangesRefreshKey={data.workingChangesRefreshKey}
            onRefresh={data.refreshAll}
            selectedWorkingTreeFile={selectedWorkingTreeFile}
            onWorkingTreeFileSelect={selection.selectWorkingTreeFile}
            onAllWorkingCommentsClick={selection.selectWorkingTreeComments}
            repoState={data.repoState}
            onConflictResolveAI={() => { void skillActions.resolveConflictsWithAI(); }}
            onConflictContinue={() => { void actions.conflictContinue(); }}
            onConflictAbort={() => { void actions.conflictAbort(); }}
            pendingReorder={data.pendingReorder}
            onApplyReorder={() => { void actions.applyReorder(); }}
            onCancelReorder={actions.cancelReorder}
            openedCommit={selection.openedCommit}
            commits={data.commits}
            unpushedCount={data.unpushedCount}
            selectedCommit={selection.selectedCommit}
            selectedHashes={selection.selectedHashes}
            selectedCommitFile={selectedCommitFile}
            initialCommitHash={selection.initialCommitHash}
            onSelect={selection.selectCommit}
            onMultiSelect={selection.selectCommits}
            onCommitFileSelect={selection.selectCommitFile}
            onCommitContextMenu={handleCommitContextMenu}
            onReorder={data.setPendingReorder}
            repoRoot={repoRoot}
            isMobileSelecting={isMobileSelecting}
            onMobileSelectingChange={handleMobileSelectingChange}
            onSwipeAction={handleSwipeAction}
            classifiedHashes={classifiedHashes}
            onOpenAsPopup={handleOpenAsPopup}
            hasMore={data.hasMore}
            isLoadingMore={data.isLoadingMore}
            onLoadMore={data.loadMore}
        />
    );

    // Right panel — detail for the selected commit / file / working-tree entry.
    // In split-workspace mode this same subtree is portaled into the shared
    // detail region instead (AC-04) so chat + git never show two detail panes.
    const detailMain = (
        <main className={`flex-1 min-w-0 min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e] flex flex-col${!view ? ' hidden lg:flex' : ''}`} data-testid="git-detail-panel">
            {/* Mobile back button */}
            {view && (
                <div className="lg:hidden shrink-0 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="git-mobile-back">
                    <button
                        onClick={selection.clearSelection}
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
    );

    // Modals / toasts / context menus — overlays that must render in BOTH the
    // standalone and split-workspace layouts (portals/fixed positioning, so they
    // are layout-agnostic).
    const overlays = (
        <RepoGitOverlays
            workspaceId={workspaceId}
            branchName={data.branchName}
            contextMenu={contextMenu}
            contextMenuItems={contextMenuItems}
            onCloseContextMenu={closeContextMenu}
            toast={toast}
            onDismissToast={clearToast}
            skills={skillActions.skills}
            skillBrowserOpen={!!skillActions.skillBrowserContext}
            onSkillBrowserSelect={handleSkillBrowserSelect}
            onCloseSkillBrowser={skillActions.closeSkillBrowser}
            pendingSkillName={skillActions.pendingSkillRun?.skillName ?? null}
            pendingSkillTargetSummary={skillActions.pendingSkillTargetSummary}
            onCancelSkillRun={skillActions.cancelSkillRun}
            onConfirmSkillRun={skillActions.confirmSkillRun}
            branchPickerOpen={branchPickerOpen}
            onCloseBranchPicker={() => setBranchPickerOpen(false)}
            onBranchSwitched={handleBranchSwitched}
            cherryPickOpen={cherryPickTarget !== null}
            onCloseCherryPick={() => setCherryPickTarget(null)}
            onCherryPickToBranch={handleCherryPickToBranch}
            amendingCommit={amendingCommit}
            onAmendConfirm={handleAmendConfirm}
            onCancelAmend={() => setAmendingCommit(null)}
            rewordingCommit={rewordingCommit}
            onRewordConfirm={handleRewordConfirm}
            onCancelReword={() => setRewordingCommit(null)}
            crossCloneCommits={crossCloneCherryPickCommits}
            sourceWorkspace={sourceWorkspace}
            onCloseCrossClone={() => setCrossCloneCherryPickCommits([])}
            onCrossCloneApplied={handleCrossCloneCherryPickApplied}
        />
    );

    // Split-workspace layout (behind the `splitWorkspacePanel` flag): render ONLY
    // the git list in place and portal the detail pane into a parent-provided
    // container, so chat + git share ONE detail region. Only the last-clicked tab
    // (`detailActive`) portals, so the shared region never shows two panes
    // (AC-04). A capture-phase click anywhere in the list marks git as
    // last-clicked — this also flips the pane back to git's detail on a re-click
    // of the already-selected file/commit. The shell (`SplitWorkspacePanel`) owns
    // the width/height dividers and the narrow-width fallback, so this branch
    // keeps no resize handle or mobile split of its own.
    if (isSplitWorkspace) {
        return (
            <>
                <div
                    className="flex flex-col h-full min-h-0 overflow-hidden"
                    data-testid="git-split-workspace-list"
                    onClickCapture={() => onActivateDetail?.()}
                >
                    {listPane}
                </div>
                {/* Hoisted toolbar portal lives OUTSIDE the capture wrapper: portaled
                    React events still bubble through the React tree, so keeping it
                    inside made every Pull/refresh click steal the shared detail pane. */}
                {hoistedHeaderPortal}
                {detailActive && detailContainer
                    ? createPortal(
                        <div
                            className="h-full flex flex-col overflow-hidden bg-white dark:bg-[#1e1e1e]"
                            data-testid="git-split-workspace-detail"
                        >
                            <div className="flex-1 min-h-0 overflow-hidden">{detailPanel}</div>
                        </div>,
                        detailContainer,
                    )
                    : null}
                {overlays}
            </>
        );
    }

    return (
        <>
        <div className={`repo-git-tab flex flex-col lg:flex-row h-full overflow-hidden${isDragging ? ' select-none' : ''}`} data-testid="repo-git-tab">
            {/* Left panel — commit list (hidden on mobile when detail is active) */}
            {listPane}
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
            {detailMain}
        </div>
        {overlays}
        </>
    );
}
