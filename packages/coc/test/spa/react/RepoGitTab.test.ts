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
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoGitTab.tsx'
);

const INDEX_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'index.ts'
);

describe('RepoGitTab', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('is exported from repos/index.ts', () => {
            const indexSource = fs.readFileSync(INDEX_PATH, 'utf-8');
            expect(indexSource).toContain("export { RepoGitTab }");
            expect(indexSource).toContain("from './RepoGitTab'");
        });

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
        it('fetches from /workspaces/:id/git/commits endpoint', () => {
            expect(source).toContain('/git/commits');
        });

        it('passes limit=50 query parameter', () => {
            expect(source).toContain('limit=50');
        });

        it('imports fetchApi from hooks', () => {
            expect(source).toContain("import { fetchApi } from '../hooks/useApi'");
        });

        it('fetches branch-range data', () => {
            expect(source).toContain('/git/branch-range');
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

        it('handleFetch POSTs to /git/fetch endpoint', () => {
            const fetchBlock = source.match(/handleFetch[\s\S]*?(?=const handlePull)/);
            expect(fetchBlock).toBeTruthy();
            expect(fetchBlock![0]).toContain('/git/fetch');
        });

        it('handlePull POSTs to /git/pull endpoint', () => {
            const pullBlock = source.match(/handlePull[\s\S]*?(?=const handlePush)/);
            expect(pullBlock).toBeTruthy();
            expect(pullBlock![0]).toContain('/git/pull');
        });

        it('handlePush POSTs to /git/push endpoint', () => {
            const pushBlock = source.match(/handlePush[\s\S]*?(?=const handleSelect)/);
            expect(pushBlock).toBeTruthy();
            expect(pushBlock![0]).toContain('/git/push');
        });

        it('handlePull sends rebase: true in body', () => {
            expect(source).toContain("JSON.stringify({ rebase: true })");
        });

        it('handlePull sets Content-Type header', () => {
            expect(source).toContain("'Content-Type': 'application/json'");
        });

        it('all action handlers use POST method', () => {
            const fetchBlock = source.match(/handleFetch[\s\S]*?(?=const handlePull)/);
            const pullBlock = source.match(/handlePull[\s\S]*?(?=const handlePush)/);
            const pushBlock = source.match(/handlePush[\s\S]*?(?=const handleSelect)/);
            expect(fetchBlock![0]).toContain("method: 'POST'");
            expect(pullBlock![0]).toContain("method: 'POST'");
            expect(pushBlock![0]).toContain("method: 'POST'");
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

        it('clears actionError before each action', () => {
            expect(source).toContain('setActionError(null)');
        });

        it('shows action error toast', () => {
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
    });

    describe('scenario banner', () => {
        it('derives scenario banner from ahead/behind', () => {
            expect(source).toContain('scenarioBanner');
        });

        it('shows ahead count in banner', () => {
            expect(source).toContain('ahead > 0');
            expect(source).toMatch(/↑\$\{ahead\}/);
        });

        it('shows behind count in banner', () => {
            expect(source).toContain('behind > 0');
            expect(source).toMatch(/↓\$\{behind\}/);
        });

        it('shows "consider pulling" message when behind', () => {
            expect(source).toContain('consider pulling');
        });

        it('returns null for banner on default branch', () => {
            expect(source).toContain('if (onDefaultBranch) return null');
        });

        it('has scenario banner data-testid', () => {
            expect(source).toContain('data-testid="git-scenario-banner"');
        });

        it('uses warning styling when behind', () => {
            expect(source).toContain('bg-[#fff3cd]');
        });

        it('uses info styling when only ahead', () => {
            expect(source).toContain('bg-[#f0f9ff]');
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

        it('sets fixed width on left panel at breakpoint', () => {
            expect(source).toContain('lg:w-[320px]');
        });

        it('has empty state when no commit is selected', () => {
            expect(source).toContain('data-testid="git-detail-empty"');
            expect(source).toContain('Select a commit to view details');
        });
    });

    describe('rendering', () => {
        it('renders CommitList component', () => {
            expect(source).toContain('<CommitList');
        });

        it('renders CommitDetail component', () => {
            expect(source).toContain('<CommitDetail');
        });

        it('renders BranchFileDiff component', () => {
            expect(source).toContain('<BranchFileDiff');
        });

        it('imports CommitList', () => {
            expect(source).toContain("import { CommitList }");
        });

        it('imports CommitDetail', () => {
            expect(source).toContain("import { CommitDetail }");
        });

        it('imports BranchFileDiff', () => {
            expect(source).toContain("import { BranchFileDiff } from './BranchFileDiff'");
        });

        it('imports GitPanelHeader', () => {
            expect(source).toContain("import { GitPanelHeader } from './GitPanelHeader'");
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

        it('passes filePath to CommitDetail for per-file diff', () => {
            expect(source).toContain('filePath={rightPanelView.filePath}');
        });

        it('uses compound key for commit-file detail panel', () => {
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
    });

    describe('deep-link support', () => {
        it('imports useApp from AppContext', () => {
            expect(source).toContain("import { useApp } from '../context/AppContext'");
        });

        it('reads selectedGitCommitHash from context state', () => {
            expect(source).toContain('state.selectedGitCommitHash');
        });

        it('uses startsWith to match initial commit hash against loaded commits', () => {
            expect(source).toContain('c.hash.startsWith(initialCommitHash)');
        });

        it('falls back to first commit when deep-link hash not found', () => {
            expect(source).toContain('target ?? (loaded.length > 0 ? loaded[0] : null)');
        });

        it('handleSelect updates location.hash with commit URL', () => {
            expect(source).toContain("location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + commit.hash");
        });

        it('handleSelect dispatches SET_GIT_COMMIT_HASH action', () => {
            expect(source).toContain("dispatch({ type: 'SET_GIT_COMMIT_HASH', hash: commit.hash })");
        });

        it('handleSelect includes workspaceId and dispatch as dependencies', () => {
            expect(source).toContain('[workspaceId, dispatch]');
        });
    });

    describe('skill review context menu', () => {
        it('imports ContextMenu component', () => {
            expect(source).toContain("import { ContextMenu, type ContextMenuItem } from '../tasks/comments/ContextMenu'");
        });

        it('imports getApiBase utility', () => {
            expect(source).toContain("import { getApiBase } from '../utils/config'");
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
            expect(source).toContain("type: 'commit' | 'branch-range'");
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

        it('defines handleEnqueueSkill async callback', () => {
            expect(source).toContain('const handleEnqueueSkill = useCallback(async');
        });

        it('handleEnqueueSkill fetches commit diff for commit type', () => {
            expect(source).toContain('/git/commits/');
            expect(source).toContain('/diff');
        });

        it('handleEnqueueSkill fetches branch-range diff for branch-range type', () => {
            expect(source).toContain('/git/branch-range/diff');
        });

        it('handleEnqueueSkill enqueues follow-prompt task', () => {
            expect(source).toContain("type: 'follow-prompt'");
            expect(source).toContain("priority: 'normal'");
            expect(source).toContain('skillName');
            expect(source).toContain('promptContent');
        });

        it('handleEnqueueSkill POSTs to /queue/tasks via getApiBase', () => {
            expect(source).toContain("getApiBase() + '/queue/tasks'");
        });

        it('handleEnqueueSkill truncates large diffs at MAX_LINES', () => {
            expect(source).toContain('MAX_LINES');
            expect(source).toContain('Diff truncated');
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

        it('contextMenuItems includes Use Skill submenu when skills available', () => {
            expect(source).toContain('Use Skill');
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
    });
});
