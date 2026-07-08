/**
 * Tests for RepoGitTab component source structure.
 *
 * Validates exports, props, API usage, split layout, state management,
 * auto-selection, refresh behaviour, scenario banner, GitPanelHeader
 * integration, commit-file view, and rendering of the git commit history tab.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'
);

describe('RepoGitTab', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports RepoGitTab as a named export', () => {
            expect(source).toContain('export function RepoGitTab');
        });
    });

    describe('component signature', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });
    });

    describe('API integration', () => {
        it('fetches commits through typed git client', () => {
            expect(source).toContain('listCommits(workspaceId');
        });

        it('passes limit=50 query parameter', () => {
            expect(source).toContain('limit: 50');
        });

        it('imports typed CoC client', () => {
            // AC-07: routes Git tab data through the clone-aware client (useCocClient).
            expect(source).toContain("import { getSpaCocClientErrorMessage } from '../../api/cocClient'");
            expect(source).toContain("import { useCocClient } from '../../repos/cloneRouting'");
        });

        it('fetches branch-range data', () => {
            expect(source).toContain('getBranchRange(workspaceId');
        });

        it('defines fetchCommits callback', () => {
            expect(source).toContain('const fetchCommits = useCallback');
        });

        it('defines fetchBranchRange callback', () => {
            expect(source).toContain('const fetchBranchRange = useCallback');
        });

        it('uses Promise.all for parallel initial fetch', () => {
            expect(source).toContain('Promise.all([fetchCommits(), fetchBranchRange()])');
        });
    });

    describe('state management', () => {
        it('tracks commits state', () => {
            expect(source).toContain('setCommits');
        });

        it('tracks unpushedCount state', () => {
            expect(source).toContain('setUnpushedCount');
        });

        it('tracks loading state', () => {
            expect(source).toContain('setLoading');
        });

        it('tracks error state', () => {
            expect(source).toContain('setError');
        });

        it('tracks rightPanelView state (discriminated union)', () => {
            expect(source).toContain('rightPanelView');
            expect(source).toContain('setRightPanelView');
        });

        it('defines RightPanelView type with commit, commit-file, and branch-file variants', () => {
            expect(source).toContain("type RightPanelView");
            expect(source).toContain("{ type: 'commit'; commit: GitCommitItem }");
            expect(source).toContain("{ type: 'commit-file'; hash: string; filePath: string }");
            expect(source).toContain("{ type: 'branch-file'; filePath: string }");
        });

        it('tracks refreshing state separately from loading', () => {
            expect(source).toContain('const [refreshing, setRefreshing] = useState(false)');
        });

        it('tracks refreshError state', () => {
            expect(source).toContain('setRefreshError');
        });

        it('tracks branchRangeData state', () => {
            expect(source).toContain('setBranchRangeData');
        });

        it('tracks onDefaultBranch state', () => {
            expect(source).toContain('setOnDefaultBranch');
        });

        it('tracks branchName state', () => {
            expect(source).toContain('setBranchName');
        });

        it('tracks ahead and behind counts', () => {
            expect(source).toContain('setAhead');
            expect(source).toContain('setBehind');
        });

        it('tracks actionError state', () => {
            expect(source).toContain('setActionError');
        });

        it('tracks fetching state', () => {
            expect(source).toContain('const [fetching, setFetching] = useState(false)');
        });

        it('tracks pulling state', () => {
            expect(source).toContain('const [pulling, setPulling] = useState(false)');
        });

        it('tracks pushing state', () => {
            expect(source).toContain('const [pushing, setPushing] = useState(false)');
        });

        it('tracks retryKey state for error retry', () => {
            expect(source).toContain('const [retryKey, setRetryKey] = useState(0)');
        });
    });

    describe('auto-selection', () => {
        it('auto-selects the most recent commit on load via rightPanelView', () => {
            expect(source).toContain('loaded[0]');
            expect(source).toContain('setRightPanelView');
        });

        it('clears selection when no commits', () => {
            expect(source).toContain('setRightPanelView(null)');
        });
    });

    describe('refresh behaviour', () => {
        it('defines refreshAll callback', () => {
            expect(source).toContain('const refreshAll = useCallback');
        });

        it('guards against concurrent refreshes', () => {
            expect(source).toContain('if (refreshing) return');
        });

        it('sets refreshing true before fetch', () => {
            expect(source).toContain('setRefreshing(true)');
        });

        it('sets refreshing false after fetch', () => {
            expect(source).toContain('setRefreshing(false)');
        });

        it('retains selected commit if hash still exists after refresh', () => {
            expect(source).toContain('prevSelectedHash');
            expect(source).toContain('loaded.find');
        });

        it('preserves branch-file view during refresh', () => {
            expect(source).toContain("rightPanelView?.type === 'branch-file'");
        });

        it('preserves commit-file view during refresh', () => {
            expect(source).toContain("rightPanelView?.type === 'commit-file'");
        });

        it('handles refresh errors without blocking', () => {
            expect(source).toContain('setRefreshError');
            expect(source).toContain("'Refresh failed'");
        });

        it('increments workingChangesRefreshKey when refreshAll fires', () => {
            expect(source).toContain('workingChangesRefreshKey');
            expect(source).toContain('setWorkingChangesRefreshKey');
            expect(source).toContain('setWorkingChangesRefreshKey(k => k + 1)');
        });

        it('clears actionError on refresh (regression: stale action banners should dismiss)', () => {
            const refreshBlock = source.match(/const refreshAll = useCallback[\s\S]*?\}, \[refreshing/);
            expect(refreshBlock).toBeTruthy();
            expect(refreshBlock![0]).toContain('setActionError(null)');
        });

        it('passes refreshKey to WorkingTree', () => {
            expect(source).toContain('refreshKey={workingChangesRefreshKey}');
        });

        it('shows refresh error toast', () => {
            expect(source).toContain('data-testid="git-refresh-error"');
        });

        it('supports R keyboard shortcut for refresh', () => {
            expect(source).toContain("e.key === 'r' || e.key === 'R'");
        });

        it('skips keyboard shortcut when focus is in input/textarea', () => {
            expect(source).toContain('HTMLInputElement');
            expect(source).toContain('HTMLTextAreaElement');
        });

        it('attaches keyDown handler to left panel', () => {
            expect(source).toContain('onKeyDown={handlePanelKeyDown}');
        });
    });

    describe('git action handlers', () => {
        it('defines handleFetch callback', () => {
            expect(source).toContain('const handleFetch = useCallback');
        });

        it('defines handlePull callback', () => {
            expect(source).toContain('const handlePull = useCallback');
        });

        it('defines handlePush callback', () => {
            expect(source).toContain('const handlePush = useCallback');
        });

        it('handleFetch calls typed fetch operation', () => {
            const fetchBlock = source.match(/handleFetch[\s\S]*?(?=const handlePull)/);
            expect(fetchBlock).toBeTruthy();
            expect(fetchBlock![0]).toContain('.git.fetch(workspaceId)');
        });

        it('handlePull calls typed pull operation', () => {
            const pullBlock = source.match(/handlePull[\s\S]*?(?=const handlePush)/);
            expect(pullBlock).toBeTruthy();
            expect(pullBlock![0]).toContain('.git.pull(workspaceId');
        });

        it('handlePush calls typed push operation', () => {
            const pushBlock = source.match(/handlePush[\s\S]*?(?=const handleSelect)/);
            expect(pushBlock).toBeTruthy();
            expect(pushBlock![0]).toContain('.git.push(workspaceId)');
        });

        it('handlePull sends rebase: true through typed client', () => {
            expect(source).toContain('{ rebase: true }');
        });

        it('delegates Content-Type handling to typed client', () => {
            expect(source).toContain('cloneClient.git.pull');
        });

        it('all action handlers use typed git methods', () => {
            const fetchBlock = source.match(/handleFetch[\s\S]*?(?=const handlePull)/);
            const pullBlock = source.match(/handlePull[\s\S]*?(?=const handlePush)/);
            const pushBlock = source.match(/handlePush[\s\S]*?(?=const handleSelect)/);
            expect(fetchBlock![0]).toContain('cloneClient.git.fetch');
            expect(pullBlock![0]).toContain('cloneClient.git.pull');
            expect(pushBlock![0]).toContain('cloneClient.git.push');
        });

        it('handleFetch guards against concurrent calls', () => {
            expect(source).toContain('if (fetching) return');
        });

        it('handlePull guards against concurrent calls', () => {
            expect(source).toContain('if (pulling) return');
        });

        it('handlePush guards against concurrent calls', () => {
            expect(source).toContain('if (pushing) return');
        });

        it('handleFetch calls refreshAll on success', () => {
            const fetchBlock = source.match(/handleFetch[\s\S]*?(?=const handlePull)/);
            expect(fetchBlock).toBeTruthy();
            expect(fetchBlock![0]).toContain('refreshAll()');
        });

        it('handlePull calls refreshAll on success', () => {
            const pullBlock = source.match(/handlePull[\s\S]*?(?=const handlePush)/);
            expect(pullBlock).toBeTruthy();
            expect(pullBlock![0]).toContain('refreshAll()');
        });

        it('handlePush calls refreshAll on success', () => {
            const pushBlock = source.match(/handlePush[\s\S]*?(?=const handleSelect)/);
            expect(pushBlock).toBeTruthy();
            expect(pushBlock![0]).toContain('refreshAll()');
        });

        it('handleFetch sets actionError on failure', () => {
            const fetchBlock = source.match(/handleFetch[\s\S]*?(?=const handlePull)/);
            expect(fetchBlock).toBeTruthy();
            expect(fetchBlock![0]).toContain('setActionError');
            expect(fetchBlock![0]).toContain("'Fetch failed'");
        });

        it('handlePull sets actionError on failure', () => {
            const pullBlock = source.match(/handlePull[\s\S]*?(?=const handlePush)/);
            expect(pullBlock).toBeTruthy();
            expect(pullBlock![0]).toContain('setActionError');
            expect(pullBlock![0]).toContain("'Pull failed'");
        });

        it('handlePush sets actionError on failure', () => {
            const pushBlock = source.match(/handlePush[\s\S]*?(?=const handleSelect)/);
            expect(pushBlock).toBeTruthy();
            expect(pushBlock![0]).toContain('setActionError');
            expect(pushBlock![0]).toContain("'Push failed'");
        });

        it('handleFetch checks result.success and throws on false', () => {
            const fetchBlock = source.match(/handleFetch[\s\S]*?(?=const handlePull)/);
            expect(fetchBlock).toBeTruthy();
            expect(fetchBlock![0]).toContain('result.success === false');
            expect(fetchBlock![0]).toContain('result.error');
        });

        it('handlePull checks result.success and throws on false', () => {
            const pullBlock = source.match(/handlePull[\s\S]*?(?=const handlePush)/);
            expect(pullBlock).toBeTruthy();
            expect(pullBlock![0]).toContain('result.success === false');
            expect(pullBlock![0]).toContain('result.error');
        });

        it('handlePush checks result.success and throws on false', () => {
            const pushBlock = source.match(/handlePush[\s\S]*?(?=const handleSelect)/);
            expect(pushBlock).toBeTruthy();
            expect(pushBlock![0]).toContain('result.success === false');
            expect(pushBlock![0]).toContain('result.error');
        });

        it('defines handlePushToCommit callback', () => {
            expect(source).toContain('const handlePushToCommit = useCallback');
        });

        it('handlePushToCommit calls typed pushTo operation', () => {
            const block = source.match(/handlePushToCommit[\s\S]*?(?=const handleRebaseAutosquash)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('.git.pushTo(workspaceId, commit.hash)');
        });

        it('handlePushToCommit sends commit hash through typed client', () => {
            const block = source.match(/handlePushToCommit[\s\S]*?(?=const handleRebaseAutosquash)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('commit.hash');
        });

        it('handlePushToCommit calls closeContextMenu', () => {
            const block = source.match(/handlePushToCommit[\s\S]*?(?=const handleRebaseAutosquash)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('closeContextMenu()');
        });

        it('handlePushToCommit calls refreshAll on success', () => {
            const block = source.match(/handlePushToCommit[\s\S]*?(?=const handleRebaseAutosquash)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('refreshAll()');
        });

        it('handlePushToCommit sets actionError on failure', () => {
            const block = source.match(/handlePushToCommit[\s\S]*?(?=const handleRebaseAutosquash)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('setActionError');
            expect(block![0]).toContain("'Push failed'");
        });

        it('clears actionError before each action', () => {
            expect(source).toContain('setActionError(null)');
        });

        it('opens a local branch picker for cherry-picking instead of immediately cherry-picking onto HEAD', () => {
            const block = source.match(/const handleCherryPick = useCallback[\s\S]*?(?=const handleOpenCrossCloneCherryPick)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('handleOpenCherryPickToBranch([commit])');
            expect(block![0]).not.toContain('.git.cherryPick(workspaceId, commit.hash)');
        });

        it('cherry-picks selected commits oldest-first onto the picked branch', () => {
            const orderBlock = source.match(/const orderOldestFirst = useCallback[\s\S]*?(?=const handleOpenCherryPickToBranch)/);
            const applyBlock = source.match(/const handleCherryPickToBranch = useCallback[\s\S]*?(?=const handleCherryPick = useCallback)/);
            expect(orderBlock).toBeTruthy();
            expect(applyBlock).toBeTruthy();
            expect(orderBlock![0]).toContain('return rightIndex - leftIndex');
            expect(applyBlock![0]).toContain('hashes');
            expect(applyBlock![0]).toContain('targetBranch');
            expect(applyBlock![0]).toContain('.git.cherryPick(workspaceId, primaryHash');
        });

        it('surfaces dirty/conflict cherry-pick errors without continue instructions', () => {
            const applyBlock = source.match(/const handleCherryPickToBranch = useCallback[\s\S]*?(?=const handleCherryPick = useCallback)/);
            expect(applyBlock).toBeTruthy();
            expect(applyBlock![0]).toContain('getSpaCocClientErrorMessage');
            expect(applyBlock![0]).not.toContain('cherry-pick --continue');
        });

        it('shows action error toast', () => {
            expect(source).toContain('data-testid="git-action-error"');
        });

        it('handleDropCommit polls async jobs via the shared poller before refreshing', () => {
            const block = source.match(/const handleDropCommit = useCallback[\s\S]*?(?=const handleCommitContextMenu)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('.git.dropCommit(workspaceId, commit.hash)');
            expect(block![0]).toContain('if (result.jobId)');
            expect(block![0]).toContain('dropPoller.start(result.jobId');
            expect(block![0]).toContain("refreshAll({ selectFallbackToHead: true })");
        });

        it('handleDropCommit shows action-error banner state when the async job fails', () => {
            const block = source.match(/const handleDropCommit = useCallback[\s\S]*?(?=const handleCommitContextMenu)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('onFailure:');
            expect(block![0]).toContain("setActionError(error || 'Drop commit failed')");
            expect(source).toContain('data-testid="git-action-error"');
        });

        it('passes onFetch to GitPanelHeader', () => {
            expect(source).toContain('onFetch={handleFetch}');
        });

        it('passes onPull to GitPanelHeader', () => {
            expect(source).toContain('onPull={handlePull}');
        });

        it('passes onPush to GitPanelHeader', () => {
            expect(source).toContain('onPush={handlePush}');
        });

        it('passes fetching state to GitPanelHeader', () => {
            expect(source).toContain('fetching={fetching}');
        });

        it('passes pulling state to GitPanelHeader', () => {
            expect(source).toContain('pulling={pulling}');
        });

        it('passes pushing state to GitPanelHeader', () => {
            expect(source).toContain('pushing={pushing}');
        });

        it('passes lastRefreshedAt to GitPanelHeader', () => {
            expect(source).toContain('lastRefreshedAt={lastRefreshedAt}');
        });
    });

    describe('lastRefreshedAt state', () => {
        it('declares lastRefreshedAt state', () => {
            expect(source).toContain('const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)');
        });

        it('updates lastRefreshedAt after initial load', () => {
            // The initial Promise.all .then should call setLastRefreshedAt(Date.now())
            expect(source).toMatch(/Promise\.all\(\[fetchCommits\(\), fetchBranchRange\(\)\]\)\s*\.then\(\(\[loaded, rangeInfo\]\) => \{[\s\S]*?setLastRefreshedAt\(Date\.now\(\)\)/);
        });

        it('updates lastRefreshedAt after refreshAll', () => {
            // refreshAll's Promise.all .then should call setLastRefreshedAt(Date.now())
            expect(source).toMatch(/fetchCommits\(true, 0, searchQuery\), fetchBranchRange\(true\)[\s\S]*?setLastRefreshedAt\(Date\.now\(\)\)/);
        });

        it('updates lastRefreshedAt after WebSocket git-changed refresh', () => {
            // The git-changed handler's fetchCommits.then should call setLastRefreshedAt
            const wsBlock = source.slice(source.indexOf('git-changed'));
            expect(wsBlock).toContain('setLastRefreshedAt(Date.now())');
        });
    });

    describe('scenario banner', () => {
        // Isolate the scenarioBanner block so assertions don't accidentally match
        // the same tokens elsewhere in this large component.
        const bannerSrc = () => source.slice(
            source.indexOf('const scenarioBanner'),
            source.indexOf('const commitListPanel'),
        );

        it('derives scenario banner from ahead/behind', () => {
            expect(source).toContain('scenarioBanner');
        });

        // Regression: the ahead count is shown by the compact badge in
        // GitPanelHeader, so the banner must NOT render an "ahead" row — doing so
        // duplicated the badge and wasted vertical space.
        it('does not duplicate the ahead count in the banner', () => {
            const banner = bannerSrc();
            expect(banner).not.toMatch(/↑\$\{ahead\}/);
            expect(banner).not.toContain('commits ahead');
            expect(banner).not.toContain('commit ahead');
        });

        it('renders no banner when only ahead (ahead is shown by the header badge)', () => {
            expect(bannerSrc()).toContain('if (behind <= 0) return null');
        });

        it('shows behind count in banner', () => {
            expect(bannerSrc()).toMatch(/↓\$\{behind\}/);
        });

        it('shows "consider pulling" message when behind', () => {
            expect(bannerSrc()).toContain('consider pulling');
        });

        it('returns null for banner on default branch', () => {
            expect(source).toContain('if (onDefaultBranch) return null');
        });

        it('has scenario banner data-testid', () => {
            expect(source).toContain('data-testid="git-scenario-banner"');
        });

        it('uses warning styling when behind', () => {
            expect(bannerSrc()).toContain('bg-[#fff3cd]');
        });
    });

    describe('split layout', () => {
        it('has left panel for commit list', () => {
            expect(source).toContain('data-testid="git-commit-list-panel"');
        });

        it('has right panel for commit detail', () => {
            expect(source).toContain('data-testid="git-detail-panel"');
        });

        it('uses aside element for commit list panel', () => {
            expect(source).toContain('<aside');
        });

        it('uses main element for detail panel', () => {
            expect(source).toContain('<main');
        });

        it('has responsive breakpoint for stacked/split layout', () => {
            expect(source).toContain('lg:');
        });

        it('sets dynamic width on left panel via useResizablePanel', () => {
            expect(source).toContain('sidebarWidth');
            expect(source).toContain('width: ${sidebarWidth}px !important');
        });

        it('has empty state when no commit is selected', () => {
            expect(source).toContain('data-testid="git-detail-empty"');
            expect(source).toContain('Select a commit to view details');
        });
    });

    describe('split-workspace layout seam (AC-04/AC-05)', () => {
        it('imports createPortal from react-dom', () => {
            expect(source).toContain("import { createPortal } from 'react-dom'");
        });

        it('declares the four optional split-workspace props', () => {
            expect(source).toContain("layout?: 'split-workspace'");
            expect(source).toContain('detailContainer?: HTMLElement | null');
            expect(source).toContain('detailActive?: boolean');
            expect(source).toContain('onActivateDetail?: () => void');
        });

        it('destructures the split-workspace props (default-absent ⇒ no-op)', () => {
            expect(source).toContain('export function RepoGitTab({ workspaceId, layout, detailContainer, detailActive, onActivateDetail, headerToolbarContainer }: RepoGitTabProps)');
        });

        it('derives isSplitWorkspace from the layout prop', () => {
            expect(source).toContain("const isSplitWorkspace = layout === 'split-workspace'");
        });

        it('gates the entire split branch on a truthy layout so the off-path is a strict no-op', () => {
            expect(source).toContain('if (isSplitWorkspace) {');
            // The standalone return still exists below the split branch.
            expect(source).toContain('data-testid="repo-git-tab"');
        });

        it('renders ONLY the reused git list in the split branch (parity via reuse — AC-05)', () => {
            expect(source).toContain('const listPane = (');
            expect(source).toContain('data-testid="git-split-workspace-list"');
            const splitBlock = source.match(/if \(isSplitWorkspace\) \{[\s\S]*?\n {4}\}/);
            expect(splitBlock).toBeTruthy();
            // The split branch mounts the shared listPane (not a forked list).
            expect(splitBlock![0]).toContain('{listPane}');
            // No resize handle / standalone <main> in the split branch.
            expect(splitBlock![0]).not.toContain('git-resize-handle');
            expect(splitBlock![0]).not.toContain('data-testid="git-detail-panel"');
        });

        it('marks git last-clicked via capture-phase click on the list wrapper (AC-04)', () => {
            expect(source).toContain('onClickCapture={() => onActivateDetail?.()}');
        });

        it('declares the optional headerToolbarContainer portal target', () => {
            expect(source).toContain('headerToolbarContainer?: HTMLElement | null');
        });

        it('hoists the compact GitPanelHeader into the section header only when split + portal target exist', () => {
            expect(source).toContain('const headerHoisted = isSplitWorkspace && !!headerToolbarContainer');
            expect(source).toContain('createPortal(panelHeader, headerToolbarContainer)');
            expect(source).toContain('compact={headerHoisted}');
        });

        // Regression: portaled React events still bubble through the REACT tree,
        // so if the hoisted toolbar portal is a child of the onClickCapture list
        // wrapper, clicking Pull/refresh in the section header marks git as
        // last-clicked and steals the shared detail pane from the chat.
        it('keeps the hoisted toolbar portal OUTSIDE the onClickCapture list wrapper', () => {
            // Portal is built once, gated on the hoist condition.
            expect(source).toContain('const hoistedHeaderPortal = headerHoisted && headerToolbarContainer');
            // The list pane only renders the toolbar inline when NOT hoisted.
            expect(source).toContain('{!headerHoisted && panelHeader}');
            // The capture wrapper (git-split-workspace-list) must not contain the
            // portal; it renders as a sibling after the wrapper closes.
            const captureWrapper = source.match(/data-testid="git-split-workspace-list"[\s\S]*?\{listPane\}\s*<\/div>/);
            expect(captureWrapper).toBeTruthy();
            expect(captureWrapper![0]).not.toContain('hoistedHeaderPortal');
            const splitBlock = source.match(/if \(isSplitWorkspace\) \{[\s\S]*?\n {4}\}/);
            expect(splitBlock).toBeTruthy();
            const wrapperEnd = splitBlock![0].indexOf('{listPane}');
            expect(splitBlock![0].indexOf('{hoistedHeaderPortal}')).toBeGreaterThan(wrapperEnd);
        });

        it('slims the search bar in split mode (shorter placeholder, tighter padding), full hint kept in aria-label', () => {
            expect(source).toContain("isSplitWorkspace ? 'Search commits…' : 'Search subject, hash, author, path…'");
            expect(source).toContain("isSplitWorkspace ? 'px-2 py-1' : 'px-2.5 py-1.5'");
            expect(source).toContain('aria-label="Search commits by subject, hash, author, or path"');
        });

        it('tightens the repo-sections grid and passes compact to both cards in split mode', () => {
            expect(source).toContain("isSplitWorkspace ? 'gap-1 px-1.5 py-1' : 'gap-2 px-2 py-2'");
            const compactPasses = source.match(/compact=\{isSplitWorkspace\}/g);
            expect(compactPasses).toBeTruthy();
            expect(compactPasses!.length).toBe(2);
        });

        it('portals the detail subtree into the parent container, gated on detailActive (AC-04 single shared pane)', () => {
            const splitBlock = source.match(/if \(isSplitWorkspace\) \{[\s\S]*?\n {4}\}/);
            expect(splitBlock).toBeTruthy();
            expect(splitBlock![0]).toContain('detailActive && detailContainer');
            expect(splitBlock![0]).toContain('createPortal(');
            expect(splitBlock![0]).toContain('detailContainer,');
            expect(splitBlock![0]).toContain('data-testid="git-split-workspace-detail"');
            // Reuses the same detail subtree the standalone layout renders.
            expect(splitBlock![0]).toContain('{detailPanel}');
        });

        it('list panel drops the fixed width style + mobile hide-toggle in split mode (shell owns layout — AC-06)', () => {
            // The width <style> is gated so the split shell controls sizing.
            expect(source).toContain('{!isSplitWorkspace && (');
            const asideBlock = source.match(/const listPane = \([\s\S]*?data-testid="git-commit-list-panel"/);
            expect(asideBlock).toBeTruthy();
            // Split className has no per-panel width / hide-on-mobile toggle.
            expect(asideBlock![0]).toContain("'w-full flex-1 min-h-0 overflow-y-auto bg-[#f3f3f3] dark:bg-[#252526]'");
        });

        it('shares the overlays (modals/toasts/context menus) across both layouts', () => {
            expect(source).toContain('const overlays = (');
            // Both returns render the shared overlays.
            const overlaysUses = source.match(/\{overlays\}/g);
            expect(overlaysUses).toBeTruthy();
            expect(overlaysUses!.length).toBe(2);
        });

        it('default layout still renders GitPanelHeader actions + resize handle (off-path unchanged)', () => {
            expect(source).toContain('<GitPanelHeader');
            expect(source).toContain('onPush={handlePush}');
            expect(source).toContain('data-testid="git-resize-handle"');
            expect(source).toContain('{detailMain}');
        });
    });

    describe('rendering', () => {
        it('renders CommitList component', () => {
            expect(source).toContain('<CommitList');
        });

        it('renders CommitDetail component', () => {
            expect(source).toContain('<CommitDetail');
        });

        it('renders FileDiffPanel for commit-file view', () => {
            expect(source).toContain('<FileDiffPanel');
        });

        it('renders FileDiffPanel for branch-file view', () => {
            // branch-file case also uses FileDiffPanel now
            expect(source).toContain('createBranchRangeDiffSource');
        });

        it('imports CommitList', () => {
            expect(source).toContain("import { CommitList, isTouchOnly }");
        });

        it('imports CommitDetail', () => {
            expect(source).toContain("import { CommitDetail }");
        });

        it('no longer imports CommitFileContent (replaced by FileDiffPanel)', () => {
            expect(source).not.toContain("import { CommitFileContent }");
        });

        it('imports FileDiffPanel and DiffSource factories', () => {
            expect(source).toContain("import { FileDiffPanel } from './diff/FileDiffPanel'");
            expect(source).toContain("import { createCommitDiffSource, createBranchRangeDiffSource } from './diff/diffSource'");
        });

        it('imports GitPanelHeader', () => {
            expect(source).toContain("import { GitPanelHeader } from './GitPanelHeader'");
        });

        it('imports BranchPickerModal', () => {
            expect(source).toContain("import { BranchPickerModal } from './branches/BranchPickerModal'");
        });

        it('renders a second BranchPickerModal for cherry-pick target selection', () => {
            expect(source).toContain('title="Cherry-pick to branch"');
            expect(source).toContain('onSelected={handleCherryPickToBranch}');
            expect(source).toContain('isOpen={cherryPickTarget !== null}');
        });

        it('imports CrossCloneCherryPickModal', () => {
            expect(source).toContain("import { CrossCloneCherryPickModal } from './CrossCloneCherryPickModal'");
        });

        it('imports the cross-clone cherry-pick runtime flag helper', () => {
            expect(source).toContain('isGitCrossCloneCherryPickEnabled');
        });

        it('renders GitPanelHeader', () => {
            expect(source).toContain('<GitPanelHeader');
        });

        it('has loading state with Spinner', () => {
            expect(source).toContain('<Spinner');
            expect(source).toContain('data-testid="git-tab-loading"');
        });

        it('has error state rendering', () => {
            expect(source).toContain('data-testid="git-tab-error"');
        });

        it('error state includes a retry button', () => {
            expect(source).toContain('data-testid="git-tab-retry"');
            expect(source).toContain('Retry');
        });

        it('retry button increments retryKey to re-trigger initial load', () => {
            expect(source).toContain('setRetryKey(k => k + 1)');
        });

        it('has root data-testid', () => {
            expect(source).toContain('data-testid="repo-git-tab"');
        });

        it('renders single unified CommitList with unpushedCount prop', () => {
            expect(source).toContain('title="History"');
            expect(source).toContain('unpushedCount={unpushedCount}');
            expect(source).not.toContain('title="Unpushed"');
        });

        it('renders unified History CommitList with all commits', () => {
            expect(source).toContain('title="History"');
            expect(source).toContain('commits={commits}');
        });

        it('passes unpushedCount to unified CommitList instead of slicing', () => {
            expect(source).toContain('unpushedCount={unpushedCount}');
            expect(source).not.toContain('commits.slice(0, unpushedCount)');
            expect(source).not.toContain('commits.slice(unpushedCount)');
        });

        it('passes selectedHash and onSelect to CommitList', () => {
            expect(source).toContain('selectedHash=');
            expect(source).toContain('onSelect=');
        });

        it('passes selectedFile to CommitList for active file highlighting', () => {
            expect(source).toContain('selectedFile={selectedCommitFile}');
        });

        it('passes onFileSelect to CommitList', () => {
            expect(source).toContain('onFileSelect={handleCommitFileSelect}');
        });

        it('passes workspaceId to CommitList', () => {
            expect(source).toContain('workspaceId={workspaceId}');
        });

        it('does NOT pass metadata props to CommitDetail for full commit view', () => {
            expect(source).not.toContain('subject={rightPanelView.commit.subject}');
            expect(source).not.toContain('author={rightPanelView.commit.author}');
            expect(source).not.toContain('date={rightPanelView.commit.date}');
            expect(source).not.toContain('parentHashes={rightPanelView.commit.parentHashes}');
            expect(source).not.toContain('body={rightPanelView.commit.body}');
        });

        it('passes filePath to FileDiffPanel for per-file diff', () => {
            expect(source).toContain('filePath={rightPanelView.filePath}');
        });

        it('uses compound key for commit-file FileDiffPanel', () => {
            expect(source).toContain('key={`${rightPanelView.hash}-${rightPanelView.filePath}`}');
        });

        it('uses key prop on CommitDetail to force remount on hash change', () => {
            expect(source).toContain('key={rightPanelView.commit.hash}');
        });

        it('passes branchRangeData to BranchChanges', () => {
            expect(source).toContain('branchRangeData={branchRangeData}');
        });

        it('passes onDefaultBranch to BranchChanges', () => {
            expect(source).toContain('onDefaultBranch={onDefaultBranch}');
        });

        it('passes onFileSelect to BranchChanges', () => {
            expect(source).toContain('onFileSelect={handleFileSelect}');
        });

        it('passes selectedFile to BranchChanges', () => {
            expect(source).toContain('selectedFile={selectedBranchFile}');
        });

        it('derives selectedCommit from rightPanelView (commit or commit-file)', () => {
            expect(source).toContain("rightPanelView?.type === 'commit'");
            expect(source).toContain("rightPanelView?.type === 'commit-file'");
        });

        it('derives selectedBranchFile from rightPanelView', () => {
            expect(source).toContain("rightPanelView?.type === 'branch-file' ? rightPanelView.filePath : null");
        });

        it('defines handleFileSelect callback for branch files', () => {
            expect(source).toContain('const handleFileSelect = useCallback');
        });

        it('defines handleCommitFileSelect callback for commit files', () => {
            expect(source).toContain('const handleCommitFileSelect = useCallback');
        });

        it('handleCommitFileSelect sets right panel to commit-file view', () => {
            expect(source).toContain("setRightPanelView({ type: 'commit-file', hash, filePath })");
        });

        it('handleFileSelect sets right panel to branch-file view', () => {
            expect(source).toContain("setRightPanelView({ type: 'branch-file', filePath })");
        });

        it('handleSelect sets right panel to commit view', () => {
            expect(source).toContain("setRightPanelView({ type: 'commit', commit })");
        });

        it('renders the cross-clone cherry-pick modal with source commit context', () => {
            expect(source).toContain('<CrossCloneCherryPickModal');
            expect(source).toContain('commits={crossCloneCherryPickCommits}');
            expect(source).toContain('sourceWorkspaceId={workspaceId}');
            expect(source).toContain('sourceWorkspace={sourceWorkspace}');
        });
    });

    describe('cross-clone cherry-pick UI', () => {
        it('tracks the commits selected for cross-clone cherry-pick', () => {
            expect(source).toContain('crossCloneCherryPickCommits');
            expect(source).toContain('setCrossCloneCherryPickCommits');
        });

        it('gates the context menu entry behind the runtime feature flag', () => {
            const menuBlock = source.match(/if \(isGitCrossCloneCherryPickEnabled\(\)\)[\s\S]*?Cherry-pick to another clone\.\.\./);
            expect(menuBlock).toBeTruthy();
        });

        it('opens the modal from the single-commit context menu', () => {
            expect(source).toContain('const handleOpenCrossCloneCherryPick = useCallback');
            expect(source).toContain('setCrossCloneCherryPickCommits([commit])');
            expect(source).toContain('onClick: () => handleOpenCrossCloneCherryPick(commit)');
        });

        it('opens the modal for a multi-commit selection ordered oldest-first', () => {
            expect(source).toContain('const handleOpenCrossCloneCherryPickMulti = useCallback');
            expect(source).toContain('orderOldestFirst(selectedCommits)');
            expect(source).toContain('onClick: () => handleOpenCrossCloneCherryPickMulti(selectedCommits)');
        });

        it('refreshes after a successful patch-transfer apply', () => {
            const block = source.match(/handleCrossCloneCherryPickApplied[\s\S]*?\}, \[refreshAll\]\)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('refreshAll()');
            expect(block![0]).toContain('Cherry-picked to');
        });
    });

    describe('drop commit context menu', () => {
        it('computes unpushed commits from commit index and unpushedCount', () => {
            expect(source).toContain('const commitIndex = commits.findIndex(c => c.hash === commit.hash)');
            expect(source).toContain('const isUnpushed = commitIndex >= 0 && commitIndex < unpushedCount');
        });

        it('shows Drop Commit only inside the unpushed context-menu gate', () => {
            const matches = source.match(/label: 'Drop Commit'/g) ?? [];
            expect(matches).toHaveLength(1);
            expect(source).toMatch(/if \(isUnpushed\) \{\s*items\.push\(\{\s*label: 'Drop Commit'[\s\S]*?handleDropCommit\(commit\)/);
        });
    });

    describe('deep-link support', () => {
        it('imports useApp from AppContext', () => {
            expect(source).toContain("import { useApp } from '../../contexts/AppContext'");
        });

        it('reads selectedGitCommitHash from context state', () => {
            expect(source).toContain('state.selectedGitCommitHash');
        });

        it('uses startsWith to match initial commit hash against loaded commits', () => {
            expect(source).toContain('c.hash.startsWith(initialCommitHash)');
        });

        it('shows empty right panel when deep-link hash not found (user must click to select)', () => {
            // No auto-selection on initial load — right panel starts empty
            expect(source).toContain('setRightPanelView(null)');
            // isDesktop / matchMedia auto-selection intentionally removed from initial load
            expect(source).not.toContain("const isDesktop = window.matchMedia('(min-width: 1024px)').matches");
            expect(source).not.toContain('const first = loaded.length > 0 ? loaded[0] : null');
        });

        it('handleSelect updates location.hash with commit URL', () => {
            expect(source).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + commit.hash");
        });

        it('handleSelect dispatches SET_GIT_COMMIT_HASH action', () => {
            expect(source).toContain("dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: commit.hash })");
        });

        it('handleSelect dispatches CLEAR_GIT_FILE_PATH to reset file selection', () => {
            expect(source).toContain("dispatch({ type: 'CLEAR_GIT_FILE_PATH' })");
        });

        it('handleSelect includes workspaceId and dispatch as dependencies', () => {
            expect(source).toContain('[workspaceId, dispatch]');
        });

        it('reads selectedGitFilePath from context state', () => {
            expect(source).toContain('state.selectedGitFilePath');
        });

        it('restores commit-file view when both initialCommitHash and initialFilePath are set', () => {
            expect(source).toContain('target && initialFilePath');
            expect(source).toContain("setRightPanelView({ type: 'commit-file', hash: target.hash, filePath: initialFilePath })");
        });

        it('handleCommitFileSelect updates location.hash with file path URL', () => {
            expect(source).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + hash + '/' + encodeURIComponent(filePath)");
        });

        it('handleCommitFileSelect dispatches SET_GIT_FILE_PATH', () => {
            expect(source).toContain("dispatch({ type: 'SET_GIT_FILE_PATH', filePath })");
        });

        it('handleCommitFileSelect includes workspaceId and dispatch as dependencies', () => {
            const handleBlock = source.match(/const handleCommitFileSelect = useCallback[\s\S]*?\}, \[([^\]]+)\]\)/);
            expect(handleBlock).toBeTruthy();
            expect(handleBlock![0]).toContain('workspaceId');
            expect(handleBlock![0]).toContain('dispatch');
        });

        it('defines handleBranchRangeSelect callback', () => {
            expect(source).toContain('const handleBranchRangeSelect = useCallback');
        });

        it('handleBranchRangeSelect updates location.hash with branch-range URL', () => {
            expect(source).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/branch-range'");
        });

        it('handleBranchRangeSelect dispatches SET_GIT_COMMIT_HASH with branch-range', () => {
            expect(source).toContain("dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: 'branch-range' })");
        });

        it('handleBranchRangeSelect dispatches CLEAR_GIT_FILE_PATH', () => {
            // handleBranchRangeSelect should clear file path when selecting the branch overview
            const block = source.match(/const handleBranchRangeSelect = useCallback[\s\S]*?\}, \[([^\]]+)\]\)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain("dispatch({ type: 'CLEAR_GIT_FILE_PATH' })");
        });

        it('handleFileSelect updates location.hash with branch-range file URL', () => {
            expect(source).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/branch-range/' + encodeURIComponent(filePath)");
        });

        it('handleFileSelect dispatches SET_GIT_COMMIT_HASH with branch-range', () => {
            const block = source.match(/const handleFileSelect = useCallback[\s\S]*?\}, \[([^\]]+)\]\)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain("dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: 'branch-range' })");
        });

        it('handleFileSelect dispatches SET_GIT_FILE_PATH', () => {
            const block = source.match(/const handleFileSelect = useCallback[\s\S]*?\}, \[([^\]]+)\]\)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain("dispatch({ type: 'SET_GIT_FILE_PATH', filePath })");
        });

        it('restores branch-range view when initialCommitHash is branch-range', () => {
            expect(source).toContain("initialCommitHash === 'branch-range'");
            expect(source).toContain("setRightPanelView({ type: 'branch-range' })");
        });

        it('restores branch-file view when initialCommitHash is branch-range with file path', () => {
            expect(source).toContain("setRightPanelView({ type: 'branch-file', filePath: initialFilePath })");
        });

        it('uses handleBranchRangeSelect for onBranchRangeSelect prop', () => {
            expect(source).toContain('onBranchRangeSelect={handleBranchRangeSelect}');
        });

        describe('post-mount deep-link navigation', () => {
            it('declares consumedDeepLinkRef initialized to initialCommitHash', () => {
                expect(source).toContain('const consumedDeepLinkRef = useRef<string | null>(initialCommitHash)');
            });

            it('has a useEffect that watches state.selectedGitCommitHash', () => {
                // The effect should depend on state.selectedGitCommitHash
                const effectPattern = /useEffect\(\(\) => \{[^}]*state\.selectedGitCommitHash[\s\S]*?\}, \[state\.selectedGitCommitHash/;
                expect(source).toMatch(effectPattern);
            });

            it('skips navigation when hash is null', () => {
                // The effect checks for falsy hash
                expect(source).toContain('if (!hash || hash === \'branch-range\' || loading) return');
            });

            it('skips navigation when hash equals branch-range', () => {
                expect(source).toContain("hash === 'branch-range'");
            });

            it('skips navigation while loading', () => {
                // loading is checked in the guard
                const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[state\.selectedGitCommitHash[^\]]*\]/);
                expect(effectBlock).toBeTruthy();
                expect(effectBlock![0]).toContain('loading');
            });

            it('skips navigation when hash matches consumedDeepLinkRef (no infinite loop)', () => {
                expect(source).toContain('if (hash === consumedDeepLinkRef.current) return');
            });

            it('updates consumedDeepLinkRef when consuming a new deep-link', () => {
                expect(source).toContain('consumedDeepLinkRef.current = hash');
            });

            it('finds target commit using startsWith matching', () => {
                const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[state\.selectedGitCommitHash[^\]]*\]/);
                expect(effectBlock).toBeTruthy();
                expect(effectBlock![0]).toContain('commits.find(c => c.hash.startsWith(hash))');
            });

            it('sets commit-file right panel view when filePath is present', () => {
                const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[state\.selectedGitCommitHash[^\]]*\]/);
                expect(effectBlock).toBeTruthy();
                expect(effectBlock![0]).toContain("setRightPanelView({ type: 'commit-file', hash: target.hash, filePath })");
            });

            it('sets commit right panel view when no filePath', () => {
                const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[state\.selectedGitCommitHash[^\]]*\]/);
                expect(effectBlock).toBeTruthy();
                expect(effectBlock![0]).toContain("setRightPanelView({ type: 'commit', commit: target })");
            });

            it('includes loading and commits in the dependency array', () => {
                const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[([^\]]*)\]/);
                expect(effectBlock).toBeTruthy();
                const deps = effectBlock![1];
                expect(deps).toContain('loading');
                expect(deps).toContain('commits');
            });

            it('includes state.selectedGitFilePath in the dependency array', () => {
                const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[([^\]]*)\]/);
                expect(effectBlock).toBeTruthy();
                expect(effectBlock![1]).toContain('state.selectedGitFilePath');
            });

            it('does not dispatch SET_GIT_COMMIT_HASH (avoids desync with URL state)', () => {
                const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[state\.selectedGitCommitHash[^\]]*\]/);
                expect(effectBlock).toBeTruthy();
                // The effect should NOT dispatch — it only updates the right panel view
                expect(effectBlock![0]).not.toContain("dispatch({ type: 'SET_GIT_COMMIT_HASH'");
            });

            it('does not clear the hash from state after consuming', () => {
                const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[state\.selectedGitCommitHash[^\]]*\]/);
                expect(effectBlock).toBeTruthy();
                expect(effectBlock![0]).not.toContain('dispatch({ type: \'SET_GIT_COMMIT_HASH\', hash: null');
            });
        });
    });

    describe('skill review context menu', () => {
        it('imports ContextMenu component', () => {
            expect(source).toContain("import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu'");
        });

        it('imports typed CoC client utility', () => {
            // AC-07: routes Git tab data through the clone-aware client (useCocClient).
            expect(source).toContain("import { getSpaCocClientErrorMessage } from '../../api/cocClient'");
            expect(source).toContain("import { useCocClient } from '../../repos/cloneRouting'");
        });

        it('imports useMemo from react', () => {
            expect(source).toContain('useMemo');
        });

        it('fetches skills from /workspaces/:id/skills endpoint', () => {
            expect(source).toContain('/skills');
            expect(source).toContain('data.skills');
        });

        it('tracks skills state', () => {
            expect(source).toContain('const [skills, setSkills]');
        });

        it('tracks contextMenu state with type discriminator', () => {
            expect(source).toContain("type: 'commit' | 'branch-range' | 'multi-commit'");
        });

        it('tracks enqueueToast state', () => {
            expect(source).toContain('enqueueToast');
            expect(source).toContain('setEnqueueToast');
        });

        it('defines handleCommitContextMenu callback', () => {
            expect(source).toContain('const handleCommitContextMenu = useCallback');
        });

        it('defines handleBranchContextMenu callback', () => {
            expect(source).toContain('const handleBranchContextMenu = useCallback');
        });

        it('defines closeContextMenu callback', () => {
            expect(source).toContain('const closeContextMenu = useCallback(() => setContextMenu(null)');
        });

        it('closeContextMenu is defined before handlePushToCommit to avoid temporal dead zone', () => {
            const closeIdx = source.indexOf('const closeContextMenu = useCallback');
            const pushToIdx = source.indexOf('const handlePushToCommit = useCallback');
            expect(closeIdx).toBeGreaterThan(-1);
            expect(pushToIdx).toBeGreaterThan(-1);
            expect(closeIdx).toBeLessThan(pushToIdx);
        });

        it('closeContextMenu is defined before handleHardReset to avoid temporal dead zone', () => {
            const closeIdx = source.indexOf('const closeContextMenu = useCallback');
            const resetIdx = source.indexOf('const handleHardReset = useCallback');
            expect(closeIdx).toBeGreaterThan(-1);
            expect(resetIdx).toBeGreaterThan(-1);
            expect(closeIdx).toBeLessThan(resetIdx);
        });

        it('closeContextMenu is defined before handleCherryPick to avoid temporal dead zone', () => {
            const closeIdx = source.indexOf('const closeContextMenu = useCallback');
            const cherryIdx = source.indexOf('const handleCherryPick = useCallback');
            expect(closeIdx).toBeGreaterThan(-1);
            expect(cherryIdx).toBeGreaterThan(-1);
            expect(closeIdx).toBeLessThan(cherryIdx);
        });

        it('closeContextMenu is defined before handleEnqueueSkill to avoid temporal dead zone', () => {
            const closeIdx = source.indexOf('const closeContextMenu = useCallback');
            const enqueueIdx = source.indexOf('const handleEnqueueSkill = useCallback');
            expect(closeIdx).toBeGreaterThan(-1);
            expect(enqueueIdx).toBeGreaterThan(-1);
            expect(closeIdx).toBeLessThan(enqueueIdx);
        });

        it('closeContextMenu is defined before handleSquashCommits to avoid temporal dead zone', () => {
            const closeIdx = source.indexOf('const closeContextMenu = useCallback');
            const squashIdx = source.indexOf('const handleSquashCommits = useCallback');
            expect(closeIdx).toBeGreaterThan(-1);
            expect(squashIdx).toBeGreaterThan(-1);
            expect(closeIdx).toBeLessThan(squashIdx);
        });

        it('handleSquashCommits does not enforce a contiguity check', () => {
            const block = source.match(/const handleSquashCommits = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).not.toContain('selected commits must be contiguous');
        });

        it('handleSquashCommits still guards against pushed commits', () => {
            const block = source.match(/const handleSquashCommits = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('all selected commits must be unpushed');
        });

        it('handleSquashCommits detects contiguity to build an appropriate prompt', () => {
            const block = source.match(/const handleSquashCommits = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('isContiguous');
        });

        it('handleSquashCommits includes interleaved commit context for non-contiguous squash', () => {
            const block = source.match(/const handleSquashCommits = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('[SQUASH]');
            expect(block![0]).toContain('[KEEP]');
            expect(block![0]).toContain('non-contiguous');
        });

        it('handleSquashCommits includes workspaceId in payload so extra skill folders are resolved', () => {
            const block = source.match(/const handleSquashCommits = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('workspaceId');
        });

        it('defines handleEnqueueSkill callback that opens dialog', () => {
            expect(source).toContain('const handleEnqueueSkill = useCallback(');
        });

        it('handleEnqueueSkill sets pendingSkillRun state instead of directly enqueuing', () => {
            const block = source.match(/const handleEnqueueSkill = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('setPendingSkillRun');
            expect(block![0]).not.toContain('/queue');
        });

        it('tracks pendingSkillRun state', () => {
            expect(source).toContain('const [pendingSkillRun, setPendingSkillRun]');
        });

        it('pendingSkillRun state includes skillName and type fields', () => {
            expect(source).toContain('skillName: string;');
            expect(source).toContain("type: 'commit' | 'multi-commit' | 'branch-range'");
        });

        it('defines pendingSkillTargetSummary via useMemo', () => {
            expect(source).toContain('const pendingSkillTargetSummary = useMemo');
        });

        it('defines handleConfirmSkillRun async callback', () => {
            expect(source).toContain('const handleConfirmSkillRun = useCallback(async');
        });

        it('handleConfirmSkillRun accepts resolved AI selection from SkillContextDialog', () => {
            expect(source).toContain('aiSelection: ResolvedModalJobAiSelection');
        });

        it('handleConfirmSkillRun uses commit hash tag for single commit', () => {
            expect(source).toContain('<commit>${pendingSkillRun.commit.hash}</commit>');
        });

        it('handleConfirmSkillRun prefixes an imperative instruction before the commit tag', () => {
            // Regression: a bare <commit> payload made the agent stall and ask
            // which commit to use; the imperative tells it to act on the tag.
            expect(source).toContain('Run the selected skill on this commit:\\n<commit>${pendingSkillRun.commit.hash}</commit>');
        });

        it('handleConfirmSkillRun uses commit-range tag for branch range', () => {
            expect(source).toContain('<commit-range>');
        });

        it('handleConfirmSkillRun enqueues chat task with skill context', () => {
            expect(source).toContain("type: 'chat'");
            expect(source).toContain("priority: 'normal'");
            expect(source).toContain('skills');
            expect(source).toContain('promptContent');
        });

        it('handleConfirmSkillRun passes provider, model, and reasoning effort to queued skill task', () => {
            const block = source.match(/const handleConfirmSkillRun = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('provider: aiSelection.provider');
            expect(block![0]).toContain('aiSelection.model');
            expect(block![0]).toContain('aiSelection.reasoningEffort');
            expect(block![0]).toContain('config');
        });

        it('handleConfirmSkillRun enqueues through typed queue client', () => {
            expect(source).toContain('cloneClient.queue.enqueue');
        });

        it('handleConfirmSkillRun appends user context to prompt when non-empty', () => {
            const block = source.match(/const handleConfirmSkillRun = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('User context:');
            expect(block![0]).toContain('userContext');
        });

        it('handleConfirmSkillRun clears pendingSkillRun after enqueue', () => {
            const block = source.match(/const handleConfirmSkillRun = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('setPendingSkillRun(null)');
        });

        it('handleConfirmSkillRun includes workspaceId in payload so extra skill folders are resolved', () => {
            const block = source.match(/const handleConfirmSkillRun = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('workspaceId');
        });

        it('renders SkillContextDialog component', () => {
            expect(source).toContain('<SkillContextDialog');
            expect(source).toContain('workspaceId={workspaceId}');
            expect(source).toContain('onConfirm={handleConfirmSkillRun}');
        });

        it('SkillContextDialog onClose clears pendingSkillRun', () => {
            expect(source).toContain('onClose={() => setPendingSkillRun(null)}');
        });

        it('handleEnqueueSkill does not fetch or embed diffs', () => {
            const block = source.match(/const handleEnqueueSkill[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).not.toContain('MAX_LINES');
            expect(block![0]).not.toContain('truncateDiff');
            expect(block![0]).not.toContain('/diff');
        });

        it('defines contextMenuItems via useMemo', () => {
            expect(source).toContain('const contextMenuItems = useMemo<ContextMenuItem[]>');
        });

        it('contextMenuItems includes Copy Hash for commit type', () => {
            expect(source).toContain('Copy Hash');
        });

        it('contextMenuItems includes View Diff for commit type', () => {
            expect(source).toContain('View Diff');
        });

        it('imports git review pop-out helpers', () => {
            expect(source).toContain("import { useGitReviewPopOut, gitReviewPopOutKey } from '../../contexts/GitReviewPopOutContext'");
            expect(source).toContain("import { buildGitReviewPopOutUrl } from '../../layout/Router'");
        });

        it('tracks popped-out git reviews from RepoGitTab', () => {
            expect(source).toContain('const { markPoppedOut } = useGitReviewPopOut()');
        });

        it('defines handleOpenAsPopup with the commit pop-out URL and window target', () => {
            const block = source.match(/const handleOpenAsPopup = useCallback[\s\S]*?\}, \[workspaceId, closeContextMenu, markPoppedOut\]\)/);
            expect(block).toBeTruthy();
            // Must pass cloneBaseUrl so remote workspaces route to the remote server.
            expect(block![0]).toContain('buildGitReviewPopOutUrl(workspaceId, commit.hash, lookupCloneBaseUrl(workspaceId))');
            expect(block![0]).toContain("window.open(url, `coc-git-review-${commit.hash}`, 'width=1200,height=800')");
            expect(block![0]).toContain('markPoppedOut(gitReviewPopOutKey(workspaceId, commit.hash))');
        });

        it('contextMenuItems includes Open as Popup only for commit type after View Diff', () => {
            const commitBlock = source.match(/if \(contextMenu\.type === 'commit' && contextMenu\.commit\)[\s\S]*?if \(contextMenu\.type === 'multi-commit'/);
            expect(commitBlock).toBeTruthy();
            const viewDiffIndex = commitBlock![0].indexOf("label: 'View Diff'");
            const openAsPopupIndex = commitBlock![0].indexOf("label: 'Open as Popup'");
            expect(viewDiffIndex).toBeGreaterThanOrEqual(0);
            expect(openAsPopupIndex).toBeGreaterThan(viewDiffIndex);
            expect(commitBlock![0]).toContain("icon: '↗'");
            expect(commitBlock![0]).toContain('onClick: () => handleOpenAsPopup(commit)');

            const multiCommitBlock = source.match(/if \(contextMenu\.type === 'multi-commit'[\s\S]*?if \(contextMenu\.type === 'branch-range'\)/);
            expect(multiCommitBlock).toBeTruthy();
            expect(multiCommitBlock![0]).not.toContain('Open as Popup');

            const branchRangeBlock = source.match(/if \(contextMenu\.type === 'branch-range'\)[\s\S]*?if \(skills\.length > 0\)/);
            expect(branchRangeBlock).toBeTruthy();
            expect(branchRangeBlock![0]).not.toContain('Open as Popup');
        });

        it('contextMenuItems dependency array includes handleOpenAsPopup', () => {
            const depsMatch = source.match(/contextMenuItems = useMemo[\s\S]*?\}, \[([^\]]+)\]/);
            expect(depsMatch).toBeTruthy();
            expect(depsMatch![1]).toContain('handleOpenAsPopup');
        });

        it('contextMenuItems includes Push to Here for unpushed commits', () => {
            expect(source).toContain("label: 'Push to Here'");
        });

        it('Push to Here is gated by isUnpushed check using unpushedCount', () => {
            const menuBlock = source.match(/const contextMenuItems = useMemo[\s\S]*?return items;\s*\}/);
            expect(menuBlock).toBeTruthy();
            expect(menuBlock![0]).toContain('isUnpushed');
            expect(menuBlock![0]).toContain('unpushedCount');
        });

        it('Push to Here calls handlePushToCommit', () => {
            const menuBlock = source.match(/const contextMenuItems = useMemo[\s\S]*?return items;\s*\}/);
            expect(menuBlock).toBeTruthy();
            expect(menuBlock![0]).toContain('handlePushToCommit');
        });

        it('contextMenuItems dependency array includes handlePushToCommit and unpushedCount', () => {
            const depsMatch = source.match(/contextMenuItems = useMemo[\s\S]*?\}, \[([^\]]+)\]/);
            expect(depsMatch).toBeTruthy();
            expect(depsMatch![1]).toContain('handlePushToCommit');
            expect(depsMatch![1]).toContain('unpushedCount');
        });

        it('contextMenuItems includes Use Skill submenu when skills available', () => {
            expect(source).toContain('Use Skill');
        });

        it('contextMenuItems includes Ask AI item for commit type', () => {
            expect(source).toContain("label: 'Ask AI'");
        });

        it('contextMenuItems includes Queue Task item for commit type', () => {
            expect(source).toContain("label: 'Queue Task'");
        });

        it('Ask AI dispatches OPEN_DIALOG with mode ask and floating-chat', () => {
            expect(source).toContain("mode: 'ask'");
            expect(source).toContain("launchMode: 'floating-chat'");
            expect(source).toContain("type: 'OPEN_DIALOG'");
        });

        it('Queue Task dispatches OPEN_DIALOG with mode task and floating-chat', () => {
            expect(source).toContain("mode: 'task'");
        });

        it('Ask AI and Queue Task use commit hash and subject in initialPrompt', () => {
            expect(source).toContain('commit.hash');
            expect(source).toContain('commit.subject');
            expect(source).toContain('initialPrompt');
        });

        it('imports useQueue from QueueContext', () => {
            expect(source).toContain("import { useQueue } from '../../contexts/QueueContext'");
        });

        it('destructures queueDispatch from useQueue', () => {
            expect(source).toContain('dispatch: queueDispatch');
        });

        it('passes onCommitContextMenu to CommitList', () => {
            expect(source).toContain('onCommitContextMenu={handleCommitContextMenu}');
        });

        it('passes onBranchContextMenu to BranchChanges', () => {
            expect(source).toContain('onBranchContextMenu={handleBranchContextMenu}');
        });

        it('renders ContextMenu when contextMenu state is set', () => {
            expect(source).toContain('<ContextMenu');
            expect(source).toContain('onClose={closeContextMenu}');
        });

        it('renders enqueue toast notification', () => {
            expect(source).toContain('data-testid="enqueue-toast"');
        });

        it('shows enqueueToast conditionally', () => {
            expect(source).toContain('{enqueueToast && (');
        });

        it('toast close button has data-testid="enqueue-toast-close"', () => {
            expect(source).toContain('data-testid="enqueue-toast-close"');
        });

        it('toast close button calls setEnqueueToast(null) on click', () => {
            expect(source).toContain('onClick={() => setEnqueueToast(null)}');
        });

        it('toast close button has accessible aria-label', () => {
            expect(source).toContain('aria-label="Close notification"');
        });

        it('toast uses flex layout to align message and close button', () => {
            expect(source).toContain('flex items-center gap-2');
            expect(source).toContain('data-testid="enqueue-toast"');
        });
    });

    describe('branch-range Ask AI / Queue Task context menu', () => {
        it('defines buildBranchReferencePrompt helper', () => {
            expect(source).toContain('const buildBranchReferencePrompt = useCallback');
        });

        it('buildBranchReferencePrompt includes branch name, base..head, commit count, stat, and file count', () => {
            expect(source).toContain('const buildBranchReferencePrompt = useCallback');
            expect(source).toContain('branchLabel');
            expect(source).toContain('baseShort');
            expect(source).toContain('headShort');
            expect(source).toContain('commitCount');
            expect(source).toContain('additions');
            expect(source).toContain('deletions');
            expect(source).toContain('fileCount');
        });

        it('buildBranchReferencePrompt includes commit list from commits array', () => {
            expect(source).toContain('Commit list:');
            expect(source).toContain('c.shortHash');
            expect(source).toContain('c.subject');
        });

        it('does not fetch branch-range diff for Ask AI', () => {
            // The old implementation fetched /git/branch-range/diff before opening the dialog.
            // The new reference-based prompt does not inline any diff content.
            // Extract the handleBranchAskAI function body (until the next top-level const)
            const handleBlock = source.match(/const handleBranchAskAI = useCallback\(([\s\S]*?)const handleEnqueueSkill/);
            expect(handleBlock).toBeTruthy();
            expect(handleBlock![1]).not.toContain('/git/branch-range/diff');
            expect(handleBlock![1]).not.toContain('fetchApi');
        });

        it('does not inline diff content in the prompt', () => {
            expect(source).not.toContain('MAX_BRANCH_DIFF_CHARS');
            expect(source).not.toContain('<diff>');
            expect(source).not.toContain('Full diff omitted');
        });

        it('handleBranchAskAI is synchronous (no async/fetch)', () => {
            const match = source.match(/const handleBranchAskAI = useCallback\(([^)]*)\)/);
            expect(match).toBeTruthy();
            expect(match![1]).not.toContain('async');
        });

        it('defines handleBranchAskAI callback', () => {
            expect(source).toContain('const handleBranchAskAI = useCallback');
        });

        it('handleBranchAskAI dispatches OPEN_DIALOG with floating-chat', () => {
            expect(source).toContain('buildBranchReferencePrompt()');
            expect(source).toContain("launchMode: 'floating-chat'");
        });

        it('contextMenuItems includes Ask AI and Queue Task for branch-range type', () => {
            const branchBlock = source.match(/if \(contextMenu\.type === 'branch-range'\)([\s\S]*?)(?=if \(skills)/);
            expect(branchBlock).toBeTruthy();
            expect(branchBlock![1]).toContain("label: 'Ask AI'");
            expect(branchBlock![1]).toContain("label: 'Queue Task'");
        });

        it('branch-range Ask AI calls handleBranchAskAI with ask mode', () => {
            const branchBlock = source.match(/if \(contextMenu\.type === 'branch-range'\)([\s\S]*?)(?=if \(skills)/);
            expect(branchBlock).toBeTruthy();
            expect(branchBlock![1]).toContain("handleBranchAskAI('ask')");
        });

        it('branch-range Queue Task calls handleBranchAskAI with task mode', () => {
            const branchBlock = source.match(/if \(contextMenu\.type === 'branch-range'\)([\s\S]*?)(?=if \(skills)/);
            expect(branchBlock).toBeTruthy();
            expect(branchBlock![1]).toContain("handleBranchAskAI('task')");
        });

        it('passes onAskAI callback to CommitDetail in branch-range view', () => {
            expect(source).toContain('onAskAI={');
        });

        it('passes onQueueTask callback to CommitDetail in branch-range view', () => {
            expect(source).toContain('onQueueTask={');
        });
    });

    describe('multi-commit context menu', () => {
        it('contextMenu state type union includes multi-commit', () => {
            expect(source).toContain("'multi-commit'");
            expect(source).toContain("commits?: GitCommitItem[]");
        });

        it('handleCommitContextMenu opens multi-commit menu when rightPanelView is multi-commit', () => {
            expect(source).toContain("rightPanelView?.type === 'multi-commit'");
            expect(source).toContain("type: 'multi-commit', commits: rightPanelView.commits");
        });

        it('handleCommitContextMenu depends on rightPanelView', () => {
            expect(source).toContain('[commits, rightPanelView]');
        });

        it('handleCommitContextMenu falls back to single commit when not in multi-commit view', () => {
            // The fallback path still creates a single-commit context menu
            const block = source.match(/const handleCommitContextMenu = useCallback[\s\S]*?\[commits, rightPanelView\]/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain("type: 'commit', commit");
        });

        it('contextMenuItems includes Ask AI and Queue Task for multi-commit type', () => {
            const re = new RegExp("if \\(contextMenu\\.type === 'multi-commit'[\\s\\S]*?(?=if \\(contextMenu\\.type === 'branch-range'\\))");
            const multiBlock = source.match(re);
            expect(multiBlock).toBeTruthy();
            expect(multiBlock![0]).toContain("label: 'Ask AI'");
            expect(multiBlock![0]).toContain("label: 'Queue Task'");
        });

        it('multi-commit context menu offers cross-clone cherry-pick behind the feature flag', () => {
            const re = new RegExp("if \\(contextMenu\\.type === 'multi-commit'[\\s\\S]*?(?=if \\(contextMenu\\.type === 'branch-range'\\))");
            const multiBlock = source.match(re);
            expect(multiBlock).toBeTruthy();
            expect(multiBlock![0]).toContain('isGitCrossCloneCherryPickEnabled()');
            expect(multiBlock![0]).toContain('Cherry-pick to another clone...');
            expect(multiBlock![0]).toContain('handleOpenCrossCloneCherryPickMulti(selectedCommits)');
        });

        it('multi-commit context menu builds initialPrompt with commit list', () => {
            const re = new RegExp("if \\(contextMenu\\.type === 'multi-commit'[\\s\\S]*?(?=if \\(contextMenu\\.type === 'branch-range'\\))");
            const multiBlock = source.match(re);
            expect(multiBlock).toBeTruthy();
            expect(multiBlock![0]).toContain('commits selected:');
            expect(multiBlock![0]).toContain('c.shortHash');
            expect(multiBlock![0]).toContain('c.subject');
        });

        it('multi-commit context menu dispatches OPEN_DIALOG with ask and task modes', () => {
            const re = new RegExp("if \\(contextMenu\\.type === 'multi-commit'[\\s\\S]*?(?=if \\(contextMenu\\.type === 'branch-range'\\))");
            const multiBlock = source.match(re);
            expect(multiBlock).toBeTruthy();
            expect(multiBlock![0]).toContain("mode: 'ask'");
            expect(multiBlock![0]).toContain("mode: 'task'");
            expect(multiBlock![0]).toContain("launchMode: 'floating-chat'");
        });

        it('handleConfirmSkillRun uses commits tag for multi-commit', () => {
            const block = source.match(/else if \(pendingSkillRun\.type === 'multi-commit'[\s\S]*?} else \{/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('<commits>');
            expect(block![0]).toContain('.map(c => c.hash)');
            expect(block![0]).toContain('Run the selected skill on these commits:');
        });

        it('handleConfirmSkillRun shortId shows commit count for multi-commit', () => {
            expect(source).toContain("pendingSkillRun.type === 'multi-commit' && pendingSkillRun.commits?.length");
            expect(source).toContain('commits`');
        });
    });

    describe('branch picker integration', () => {
        it('tracks branchPickerOpen state', () => {
            expect(source).toContain('branchPickerOpen');
            expect(source).toContain('setBranchPickerOpen');
        });

        it('passes onBranchClick to GitPanelHeader', () => {
            expect(source).toContain('onBranchClick=');
            expect(source).toContain('setBranchPickerOpen(true)');
        });

        it('renders BranchPickerModal', () => {
            expect(source).toContain('<BranchPickerModal');
        });

        it('passes workspaceId to BranchPickerModal', () => {
            expect(source).toMatch(/BranchPickerModal[\s\S]*?workspaceId=\{workspaceId\}/);
        });

        it('passes isOpen to BranchPickerModal', () => {
            expect(source).toContain('isOpen={branchPickerOpen}');
        });

        it('passes onClose to BranchPickerModal', () => {
            expect(source).toContain('setBranchPickerOpen(false)');
        });

        it('onSwitched calls fetchBranchRange and fetchCommits to refresh', () => {
            const switchedBlock = source.match(/onSwitched=\{[\s\S]*?\}\}/);
            expect(switchedBlock).toBeTruthy();
            expect(switchedBlock![0]).toContain('fetchBranchRange');
            expect(switchedBlock![0]).toContain('fetchCommits');
        });
    });

    describe('resizable split panel', () => {
        it('imports useResizablePanel hook', () => {
            expect(source).toContain("import { useResizablePanel } from '../../hooks/ui/useResizablePanel'");
        });

        it('calls useResizablePanel with git-sidebar-width storage key', () => {
            expect(source).toContain("storageKey: 'git-sidebar-width'");
        });

        it('destructures width, isDragging, handleMouseDown, handleTouchStart from hook', () => {
            expect(source).toContain('width: sidebarWidth');
            expect(source).toContain('isDragging');
            expect(source).toContain('handleMouseDown');
            expect(source).toContain('handleTouchStart');
        });

        it('applies dynamic sidebar width via style tag using media query', () => {
            expect(source).toContain('data-testid="git-commit-list-panel"');
            expect(source).toContain('width: ${sidebarWidth}px !important');
        });

        it('renders resize handle between left and right panels', () => {
            expect(source).toContain('data-testid="git-resize-handle"');
        });

        it('resize handle has correct accessibility attributes', () => {
            expect(source).toContain('role="separator"');
            expect(source).toContain('aria-orientation="vertical"');
            expect(source).toContain('aria-label="Resize sidebar"');
        });

        it('resize handle binds mouse and touch events', () => {
            const handleBlock = source.match(/<div[\s\S]*?git-resize-handle[\s\S]*?\/>/);
            expect(handleBlock).toBeTruthy();
            expect(handleBlock![0]).toContain('onMouseDown={handleMouseDown}');
            expect(handleBlock![0]).toContain('onTouchStart={handleTouchStart}');
        });

        it('resize handle uses cursor-col-resize class', () => {
            expect(source).toContain('cursor-col-resize');
        });

        it('resize handle is hidden on mobile (hidden lg:flex)', () => {
            const handleBlock = source.match(/<div[\s\S]*?git-resize-handle[\s\S]*?\/>/);
            expect(handleBlock).toBeTruthy();
            expect(handleBlock![0]).toContain('hidden lg:flex');
        });

        it('adds select-none class to container when dragging', () => {
            expect(source).toContain("isDragging ? ' select-none' : ''");
        });

        it('configures initialWidth of 320', () => {
            const hookBlock = source.match(/useResizablePanel\(\{[\s\S]*?\}\)/);
            expect(hookBlock).toBeTruthy();
            expect(hookBlock![0]).toContain('initialWidth: 320');
        });

        it('configures minWidth of 160', () => {
            const hookBlock = source.match(/useResizablePanel\(\{[\s\S]*?\}\)/);
            expect(hookBlock).toBeTruthy();
            expect(hookBlock![0]).toContain('minWidth: 160');
        });

        it('configures maxWidth of 600', () => {
            const hookBlock = source.match(/useResizablePanel\(\{[\s\S]*?\}\)/);
            expect(hookBlock).toBeTruthy();
            expect(hookBlock![0]).toContain('maxWidth: 600');
        });

        it('left panel no longer has fixed lg:w-[320px] class', () => {
            const asideBlock = source.match(/<aside[\s\S]*?data-testid="git-commit-list-panel"[\s\S]*?>/);
            expect(asideBlock).toBeTruthy();
            expect(asideBlock![0]).not.toContain('lg:w-[320px]');
        });
    });

    describe('mobile responsive layout', () => {
        it('hides left panel on mobile when detail view is active (hidden lg:block)', () => {
            expect(source).toContain("hidden lg:block");
        });

        it('hides right panel on mobile when no detail is selected (hidden lg:flex)', () => {
            expect(source).toContain("hidden lg:flex");
        });

        it('defines handleMobileBack callback that clears rightPanelView', () => {
            expect(source).toContain('const handleMobileBack = useCallback');
            expect(source).toContain('setRightPanelView(null)');
        });

        it('renders mobile back button with data-testid', () => {
            expect(source).toContain('data-testid="git-mobile-back"');
            expect(source).toContain('data-testid="git-mobile-back-btn"');
        });

        it('mobile back button is hidden on desktop (lg:hidden)', () => {
            expect(source).toContain('lg:hidden');
            expect(source).toContain('handleMobileBack');
        });

        it('mobile back button shows "← Back to list" text', () => {
            expect(source).toContain('← Back to list');
        });

        it('conditionally applies hidden class on aside based on rightPanelView', () => {
            expect(source).toContain("rightPanelView ? ' hidden lg:block' : ''");
        });

        it('conditionally applies hidden class on main based on rightPanelView', () => {
            expect(source).toContain("!rightPanelView ? ' hidden lg:flex' : ''");
        });

        it('wraps detailPanel in flex-1 container for proper sizing with back button', () => {
            expect(source).toContain('className="flex-1 min-h-0 overflow-hidden"');
        });

        it('does not auto-select first commit on initial load (any platform)', () => {
            // Auto-selection removed; right panel starts empty regardless of viewport
            expect(source).not.toContain("const isDesktop = window.matchMedia('(min-width: 1024px)').matches");
            expect(source).not.toContain('isDesktop && first');
            // null is always set when no deep-link hash
            expect(source).toContain('setRightPanelView(null)');
        });

        it('preserves null rightPanelView during refresh (mobile back state)', () => {
            // When user pressed "Back to list" on mobile, refresh should not re-open a commit
            expect(source).toContain('rightPanelView === null');
            // The null guard appears before the loaded[0] fallback
            const nullGuardIdx = source.indexOf('rightPanelView === null');
            const fallbackIdx = source.indexOf("setRightPanelView({ type: 'commit', commit: loaded[0] })", nullGuardIdx);
            expect(nullGuardIdx).toBeGreaterThan(0);
            expect(fallbackIdx).toBeGreaterThan(nullGuardIdx);
        });
    });

    describe('load more pagination', () => {
        it('tracks skip state initialised to 0', () => {
            expect(source).toContain('const [skip, setSkip] = useState(0)');
        });

        it('tracks hasMore state', () => {
            expect(source).toContain('const [hasMore, setHasMore] = useState(true)');
        });

        it('tracks isLoadingMore state', () => {
            expect(source).toContain('const [isLoadingMore, setIsLoadingMore] = useState(false)');
        });

        it('fetchCommits accepts skipOffset parameter defaulting to 0', () => {
            expect(source).toContain('skipOffset = 0');
        });

        it('fetchCommits appends commits when skipOffset > 0', () => {
            expect(source).toContain('setCommits(prev => [...prev, ...loaded])');
        });

        it('fetchCommits replaces commits when skipOffset is 0', () => {
            expect(source).toMatch(/skipOffset > 0[\s\S]*?setCommits\(prev => \[\.\.\.prev, \.\.\.loaded\]\)[\s\S]*?setCommits\(loaded\)/);
        });

        it('fetchCommits sets hasMore based on returned batch size', () => {
            expect(source).toContain('setHasMore(loaded.length === 50)');
        });

        it('fetchCommits passes skip option when skipOffset > 0', () => {
            expect(source).toContain('skip: skipOffset > 0 ? skipOffset : undefined');
        });

        it('defines handleLoadMore callback', () => {
            expect(source).toContain('const handleLoadMore = useCallback');
        });

        it('handleLoadMore guards against concurrent calls', () => {
            const block = source.match(/const handleLoadMore = useCallback[\s\S]*?\}, \[[\s\S]*?\]\)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('if (isLoadingMore || !hasMore) return');
        });

        it('handleLoadMore advances skip by 50', () => {
            expect(source).toContain('const nextSkip = skip + 50');
        });

        it('handleLoadMore calls fetchCommits with nextSkip', () => {
            expect(source).toContain('fetchCommits(false, nextSkip, searchQuery)');
        });

        it('handleLoadMore updates skip state on success', () => {
            expect(source).toContain('.then(() => setSkip(nextSkip))');
        });

        it('handleLoadMore sets isLoadingMore true before fetch and false after', () => {
            expect(source).toContain('setIsLoadingMore(true)');
            expect(source).toContain('setIsLoadingMore(false)');
        });

        it('renders Load more button with data-testid', () => {
            expect(source).toContain('data-testid="git-load-more-btn"');
        });

        it('Load more button is shown only when hasMore is true', () => {
            expect(source).toContain('{hasMore && (');
        });

        it('Load more button is disabled when isLoadingMore', () => {
            expect(source).toContain('disabled={isLoadingMore}');
        });

        it('Load more button shows "Loading…" text when loading', () => {
            expect(source).toContain("isLoadingMore ? 'Loading…' : 'Load more'");
        });

        it('Load more button calls handleLoadMore on click', () => {
            expect(source).toContain('onClick={handleLoadMore}');
        });

        it('resets skip to 0 on initial workspace load', () => {
            const effectBlock = source.match(/\/\/ Initial load[\s\S]*?}, \[workspaceId/);
            expect(effectBlock).toBeTruthy();
            expect(effectBlock![0]).toContain('setSkip(0)');
        });

        it('resets skip to 0 on refreshAll', () => {
            const refreshBlock = source.match(/const refreshAll = useCallback[\s\S]*?\}, \[refreshing/);
            expect(refreshBlock).toBeTruthy();
            expect(refreshBlock![0]).toContain('setSkip(0)');
        });

        it('resets skip to 0 when branch is switched via BranchPickerModal', () => {
            const switchedBlock = source.match(/onSwitched=\{[\s\S]*?\}\}/);
            expect(switchedBlock).toBeTruthy();
            expect(switchedBlock![0]).toContain('setSkip(0)');
        });
    });

    describe('multi-select commits', () => {
        it('adds multi-commit variant to RightPanelView union type', () => {
            expect(source).toContain("type: 'multi-commit'");
            expect(source).toContain("commits: GitCommitItem[]");
        });

        it('defines handleMultiSelect callback', () => {
            expect(source).toContain('const handleMultiSelect = useCallback');
        });

        it('handleMultiSelect delegates single-commit selection to handleSelect', () => {
            const block = source.match(/const handleMultiSelect = useCallback[\s\S]*?\}, \[handleSelect\]\)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('selectedCommits.length === 1');
            expect(block![0]).toContain('handleSelect(selectedCommits[0])');
        });

        it('handleMultiSelect sets multi-commit right panel view for >1 commit', () => {
            expect(source).toContain("setRightPanelView({ type: 'multi-commit', commits: selectedCommits })");
        });

        it('derives selectedHashes useMemo from rightPanelView', () => {
            expect(source).toContain('const selectedHashes = useMemo<ReadonlySet<string>>');
        });

        it('selectedHashes covers the multi-commit case', () => {
            expect(source).toContain("rightPanelView?.type === 'multi-commit'");
            expect(source).toContain('rightPanelView.commits.map(c => c.hash)');
        });

        it('passes selectedHashes to CommitList', () => {
            expect(source).toContain('selectedHashes={selectedHashes}');
        });

        it('passes onMultiSelect to CommitList', () => {
            expect(source).toContain('onMultiSelect={handleMultiSelect}');
        });

        it('renders multi-commit summary panel with data-testid', () => {
            expect(source).toContain('data-testid="git-multi-commit-panel"');
        });

        it('multi-commit panel shows selected count heading', () => {
            expect(source).toContain('commits selected');
        });

        it('multi-commit panel lists shortHash and subject for each commit', () => {
            expect(source).toContain('c.shortHash');
            expect(source).toContain('c.subject');
        });
    });

    describe('mount-recovery effect stability', () => {
        it('uses startPullPollingRef to avoid re-firing on callback changes', () => {
            expect(source).toContain('const startPullPollingRef = useRef(startPullPolling)');
            expect(source).toContain('startPullPollingRef.current = startPullPolling');
        });

        it('uses stopPullPollingRef to avoid re-firing on callback changes', () => {
            expect(source).toContain('const stopPullPollingRef = useRef(stopPullPolling)');
            expect(source).toContain('stopPullPollingRef.current = stopPullPolling');
        });

        it('mount-recovery effect depends only on workspaceId', () => {
            // The effect should use refs and depend only on [workspaceId]
            const recoveryBlock = source.match(/\/\/ Recover pull status on mount[\s\S]*?}, \[workspaceId\]\);/);
            expect(recoveryBlock).toBeTruthy();
            expect(recoveryBlock![0]).toContain('startPullPollingRef.current');
            expect(recoveryBlock![0]).toContain('stopPullPollingRef.current');
        });

        it('mount-recovery effect does not list startPullPolling or stopPullPolling in deps', () => {
            const recoveryBlock = source.match(/\/\/ Recover pull status on mount[\s\S]*?}, \[workspaceId\]\);/);
            expect(recoveryBlock).toBeTruthy();
            // Should not have the old deps pattern
            expect(recoveryBlock![0]).not.toContain('[workspaceId, startPullPolling, stopPullPolling]');
        });

        it('initial-load effect includes retryKey in deps', () => {
            expect(source).toContain(', [workspaceId, fetchCommits, fetchBranchRange, retryKey]');
        });
    });

    describe('git operation poller migration', () => {
        it('imports the shared useGitOperationPoller hook', () => {
            expect(source).toContain("import { useGitOperationPoller } from './hooks/useGitOperationPoller'");
        });

        it('creates a dedicated poller instance per async operation', () => {
            expect(source).toContain('const pullPoller = useGitOperationPoller(workspaceId)');
            expect(source).toContain('const rebasePoller = useGitOperationPoller(workspaceId)');
            expect(source).toContain('const dropPoller = useGitOperationPoller(workspaceId)');
            expect(source).toContain('const reorderPoller = useGitOperationPoller(workspaceId)');
        });

        it('no longer manages raw intervals inline', () => {
            expect(source).not.toContain('setInterval');
            expect(source).not.toContain('pullPollRef');
            expect(source).not.toContain('pullJobRef');
        });

        it('routes pull polling through the poller while keeping the pulling flag', () => {
            const block = source.match(/const startPullPolling = useCallback[\s\S]*?\}, \[pullPoller, refreshAll\]\);/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('pullPoller.start(jobId');
            expect(block![0]).toContain('setPulling(true)');
            expect(block![0]).toContain("setActionError(error || 'Pull failed')");
        });

        it('stopPullPolling delegates to the poller and resets the pulling flag', () => {
            const block = source.match(/const stopPullPolling = useCallback[\s\S]*?\}, \[pullPoller\]\);/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('pullPoller.stop()');
            expect(block![0]).toContain('setPulling(false)');
        });

        it('the websocket git-changed handler reads the active pull job from the poller', () => {
            expect(source).toContain('pullPoller.activeJobId()');
        });

        it('rebase autosquash starts the rebase poller', () => {
            const block = source.match(/const handleRebaseAutosquash = useCallback[\s\S]*?(?=const handleSelect)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('rebasePoller.start(result.jobId');
            expect(block![0]).toContain('setRebasing(false)');
        });

        it('reorder preserves its explicit success/failed completion rule', () => {
            const block = source.match(/const handleApplyReorder = useCallback[\s\S]*?(?=const handleCancelReorder)/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('reorderPoller.start(resp.jobId');
            expect(block![0]).toContain("isComplete: (job) => job?.status === 'success' || job?.status === 'failed'");
            expect(block![0]).toContain("setActionError(error || 'Reorder failed')");
        });
    });

    describe('redesigned search bar', () => {
        it('renders search bar wrapper with subtle background', () => {
            expect(source).toMatch(/data-testid="git-search-bar"[\s\S]*?bg-\[#f5f5f5\]/);
        });

        it('uses the redesigned placeholder copy', () => {
            expect(source).toContain('Search subject, hash, author, path…');
        });

        it('search input has a ref attached', () => {
            expect(source).toContain('ref={searchInputRef}');
        });

        it('declares the search input ref', () => {
            expect(source).toContain('const searchInputRef = useRef<HTMLInputElement>(null)');
        });

        it('shows the keyboard shortcut hint when the search is empty', () => {
            expect(source).toContain('data-testid="git-search-kbd"');
        });

        it('hides the keyboard hint while a query is typed (clear button replaces it)', () => {
            // The kbd hint is rendered in the else branch of the searchQuery ternary,
            // so it should not appear when the clear button is shown.
            expect(source).toMatch(/searchQuery \? \([\s\S]*?git-search-clear[\s\S]*?\) : \([\s\S]*?git-search-kbd/);
        });

        it('"/" keyboard shortcut focuses the search input via handlePanelKeyDown', () => {
            expect(source).toContain("e.key === '/'");
            expect(source).toContain('searchInputRef.current?.focus()');
        });

        it('ignores "/" shortcut when modifier keys are pressed', () => {
            expect(source).toMatch(/e\.key === '\/'[\s\S]*?!e\.metaKey[\s\S]*?!e\.ctrlKey[\s\S]*?!e\.altKey/);
        });

        it('Escape in the search input clears the query (or blurs when empty)', () => {
            expect(source).toMatch(/onKeyDown=\{e =>[\s\S]*?e\.key === 'Escape'[\s\S]*?setSearchQuery\(''\)[\s\S]*?searchInputRef\.current\?\.blur\(\)/);
        });

        it('search box uses rounded-md border with focus ring styling', () => {
            const m = source.match(/data-testid="git-search-bar"[\s\S]{0,400}/);
            expect(m).toBeTruthy();
            expect(m![0]).toContain('rounded-md');
            expect(m![0]).toContain('focus-within:border-[#0078d4]');
            expect(m![0]).toContain('focus-within:ring-2');
        });
    });

    describe('git commit lookup feature', () => {
        it('imports isGitCommitLookupEnabled from config utils', () => {
            expect(source).toContain('isGitCommitLookupEnabled');
            expect(source).toContain("from '../../utils/config'");
        });

        it('declares commitLookupLoading state', () => {
            expect(source).toContain('const [commitLookupLoading, setCommitLookupLoading] = useState(false)');
        });

        it('declares commitLookupError state', () => {
            expect(source).toContain('const [commitLookupError, setCommitLookupError] = useState<string | null>(null)');
        });

        it('declares openedCommit state', () => {
            expect(source).toContain('const [openedCommit, setOpenedCommit]');
        });

        it('defines handleCommitLookup callback', () => {
            expect(source).toContain('const handleCommitLookup = useCallback');
        });

        it('handleCommitLookup validates SHA pattern before lookup', () => {
            const block = source.match(/const handleCommitLookup = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('/^[0-9a-f]{7,40}$/');
        });

        it('handleCommitLookup calls getCommit API with workspaceId', () => {
            const block = source.match(/const handleCommitLookup = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('getCommit(workspaceId');
        });

        it('handleCommitLookup sets openedCommit on success', () => {
            const block = source.match(/const handleCommitLookup = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('setOpenedCommit');
        });

        it('handleCommitLookup sets commitLookupError on failure', () => {
            const block = source.match(/const handleCommitLookup = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('setCommitLookupError');
        });

        it('search onKeyDown triggers handleCommitLookup on Enter with SHA-shaped query', () => {
            expect(source).toContain('isGitCommitLookupEnabled() && /^[0-9a-f]{7,40}$/i.test(searchQuery.trim())');
            expect(source).toContain('void handleCommitLookup(searchQuery.trim())');
        });

        it('shows SHA lookup hint with data-testid when query looks like SHA and feature enabled', () => {
            expect(source).toContain('data-testid="git-commit-lookup-hint"');
            expect(source).toContain('↵ open commit');
        });

        it('shows loading indicator with data-testid during lookup', () => {
            expect(source).toContain('data-testid="git-commit-lookup-loading"');
            expect(source).toContain('Looking up…');
        });

        it('shows inline error with data-testid on lookup failure', () => {
            expect(source).toContain('data-testid="git-commit-lookup-error"');
            expect(source).toContain('{commitLookupError}');
        });

        it('shows opened commit section with data-testid when openedCommit is set', () => {
            expect(source).toContain('data-testid="git-opened-commit-section"');
        });

        it('shows opened commit row with data-testid', () => {
            expect(source).toContain('data-testid="git-opened-commit-row"');
        });

        it('opened commit row shows shortHash and subject', () => {
            const block = source.match(/data-testid="git-opened-commit-row"[\s\S]*?<\/div>/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('openedCommit.shortHash');
            expect(block![0]).toContain('openedCommit.subject');
        });

        it('opened commit row calls handleSelect when clicked', () => {
            expect(source).toContain('onClick={() => handleSelect(openedCommit)');
        });

        it('deep-link effect attempts lookup via getCommit when commit not in list', () => {
            const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[state\.selectedGitCommitHash[^\]]*\]/);
            expect(effectBlock).toBeTruthy();
            expect(effectBlock![0]).toContain('isGitCommitLookupEnabled()');
            expect(effectBlock![0]).toContain('getCommit(workspaceId');
        });

        it('deep-link lookup sets openedCommit on success', () => {
            const effectBlock = source.match(/Deep-link navigation after mount[\s\S]*?\}, \[state\.selectedGitCommitHash[^\]]*\]/);
            expect(effectBlock).toBeTruthy();
            expect(effectBlock![0]).toContain('setOpenedCommit');
        });

        it('feature flag check uses isGitCommitLookupEnabled function', () => {
            // The function must be used (not inline config check) for consistency
            expect(source).toContain('isGitCommitLookupEnabled()');
        });

        it('handleCommitLookup does not call any state-changing git commands', () => {
            const block = source.match(/const handleCommitLookup = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            // The lookup callback must only read; must not call git mutating operations
            expect(block![0]).not.toContain('.reset(');
            expect(block![0]).not.toContain('cherry-pick');
            expect(block![0]).not.toContain('.rebase(');
            expect(block![0]).not.toContain('.checkout(');
        });
    });

    describe('task payload workspaceId regression', () => {
        it('handleConfirmSkillRun includes workspaceId in queue task payload', () => {
            const block = source.match(/const handleConfirmSkillRun = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('workspaceId');
        });

        it('handleSquashCommits includes workspaceId in queue task payload', () => {
            const block = source.match(/const handleSquashCommits = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('workspaceId');
        });

        it('handleConflictResolveAI includes workspaceId in queue task payload', () => {
            const block = source.match(/const handleConflictResolveAI = useCallback[\s\S]*?\}, \[/);
            expect(block).toBeTruthy();
            expect(block![0]).toContain('workspaceId');
        });
    });
});
