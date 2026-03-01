/**
 * Tests for RepoGitTab component source structure.
 *
 * Validates exports, props, API usage, split layout, state management,
 * auto-selection, refresh behaviour, scenario banner, GitPanelHeader
 * integration, and rendering of the git commit history tab.
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

        it('tracks selectedCommit state', () => {
            expect(source).toContain('selectedCommit');
            expect(source).toContain('setSelectedCommit');
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
    });

    describe('auto-selection', () => {
        it('auto-selects the most recent commit on load', () => {
            expect(source).toContain('loaded[0]');
            expect(source).toContain('setSelectedCommit');
        });

        it('clears selection when no commits', () => {
            expect(source).toContain('setSelectedCommit(null)');
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
            expect(source).toContain('md-split:');
        });

        it('sets fixed width on left panel at breakpoint', () => {
            expect(source).toContain('md-split:w-[320px]');
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

        it('imports CommitList', () => {
            expect(source).toContain("import { CommitList }");
        });

        it('imports CommitDetail', () => {
            expect(source).toContain("import { CommitDetail }");
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

        it('always renders Unpushed section with showEmpty', () => {
            expect(source).toContain('title="Unpushed"');
            expect(source).toContain('showEmpty');
            expect(source).toContain("Nothing to push");
        });

        it('renders History section with defaultCollapsed when unpushed > 0', () => {
            expect(source).toContain("title=\"History\"");
            expect(source).toContain('defaultCollapsed={unpushedCount > 0}');
        });

        it('splits commits into unpushed and history based on unpushedCount', () => {
            expect(source).toContain('commits.slice(0, unpushedCount)');
            expect(source).toContain('commits.slice(unpushedCount)');
        });

        it('passes selectedHash and onSelect to CommitList', () => {
            expect(source).toContain('selectedHash=');
            expect(source).toContain('onSelect=');
        });

        it('passes subject to CommitDetail', () => {
            expect(source).toContain('subject={selectedCommit.subject}');
        });

        it('uses key prop on CommitDetail to force remount on hash change', () => {
            expect(source).toContain('key={selectedCommit.hash}');
        });

        it('passes branchRangeData to BranchChanges', () => {
            expect(source).toContain('branchRangeData={branchRangeData}');
        });

        it('passes onDefaultBranch to BranchChanges', () => {
            expect(source).toContain('onDefaultBranch={onDefaultBranch}');
        });
    });
});
