import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { BranchRangeInfo } from '../../../src/server/spa/client/react/features/git/branches/BranchChanges';
import type { WorkingTreeChange } from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';

const h = vi.hoisted(() => {
    const local = { git: { getWorkingTreeChanges: vi.fn(), listDiffComments: vi.fn() } };
    const remote = { git: { getWorkingTreeChanges: vi.fn(), listDiffComments: vi.fn() } };
    return { local, remote, getClient: vi.fn(), useClient: vi.fn(), commentCounts: new Map() };
});

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({ useCocClient: h.useClient }));
vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({ getCocClientForWorkspace: h.getClient }));
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => ({
    useFilesViewMode: () => ({ mode: 'flat', setMode: vi.fn() }),
}));
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: () => h.commentCounts,
}));
vi.mock('../../../src/server/spa/client/react/features/git/commits/CommitList', () => ({ CommitList: () => null }));
vi.mock('../../../src/server/spa/client/react/features/git/working-tree/WorktreeList', () => ({ WorktreeList: () => null }));
vi.mock('../../../src/server/spa/client/react/features/git/repoGitTab/useRepoGitSelection', () => ({ isLookupCandidate: () => false }));

import { RepoGitListPane, type RepoGitListPaneProps } from '../../../src/server/spa/client/react/features/git/repoGitTab/RepoGitListPane';

const range: BranchRangeInfo = {
    baseRef: 'main', headRef: 'HEAD', mergeBase: 'abc',
    commitCount: 0, fileCount: 0, additions: 0, deletions: 0,
};
const change = (stage: WorkingTreeChange['stage']): WorkingTreeChange => ({
    filePath: `${stage}.ts`, stage, status: stage === 'untracked' ? '?' : 'M',
    repositoryRoot: '', repositoryName: 'repo',
});

function pane(compact: boolean, overrides: Partial<RepoGitListPaneProps> = {}) {
    // Unused interaction props belong to the stubbed history/worktree surfaces.
    const props = {
        workspaceId: 'local', isSplitWorkspace: compact, sidebarWidth: 300,
        branchRangeData: range, branchRangeFiles: [], baseMode: 'default-branch',
        workingChangesRefreshKey: 0, commits: [], selectedHashes: new Set(),
        panelRef: { current: null }, searchInputRef: { current: null },
        ...overrides,
    } as RepoGitListPaneProps;
    return <RepoGitListPane {...props} />;
}

beforeEach(() => {
    vi.resetAllMocks();
    for (const client of [h.local, h.remote]) {
        client.git.getWorkingTreeChanges.mockResolvedValue({ changes: [] });
        client.git.listDiffComments.mockResolvedValue({ comments: [] });
    }
    h.useClient.mockImplementation((id: string) => id === 'remote/ws' ? h.remote : h.local);
    h.getClient.mockImplementation((id: string) => id === 'remote/ws' ? h.remote : h.local);
});

describe.each([false, true])('Git summary visibility (compact=%s)', compact => {
    it('hides both confirmed empty summaries after loading', async () => {
        render(pane(compact));
        expect(screen.getByTestId('working-tree-loading')).toBeTruthy();
        await waitFor(() => expect(screen.queryByTestId('working-tree-loading')).toBeNull());
        expect(screen.queryByTestId('branch-changes')).toBeNull();
        expect(screen.queryByTestId('working-tree')).toBeNull();
    });

    it.each([
        [1, 10], [1, 0], [0, 1],
    ])('keeps a %i-commit / %i-file range while hiding clean LOCAL', async (commitCount, fileCount) => {
        render(pane(compact, { branchRangeData: { ...range, commitCount, fileCount } }));
        await waitFor(() => expect(screen.queryByTestId('working-tree-loading')).toBeNull());
        expect(screen.getByTestId('branch-changes')).toBeTruthy();
        expect(screen.queryByTestId('working-tree')).toBeNull();
    });

    it.each(['staged', 'unstaged', 'untracked'] as const)('keeps %s LOCAL while hiding empty RANGE', async stage => {
        h.local.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change(stage)] });
        render(pane(compact));
        await screen.findByTestId('working-tree');
        expect(screen.queryByTestId('branch-changes')).toBeNull();
    });

    it('keeps both nonempty summaries', async () => {
        h.local.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('staged'), change('unstaged'), change('untracked')] });
        render(pane(compact, { branchRangeData: { ...range, commitCount: 1, fileCount: 10 } }));
        await screen.findByTestId('working-tree');
        expect(screen.getByTestId('branch-changes')).toBeTruthy();
    });

    it('restores and hides rows on refresh without remounting', async () => {
        const { rerender } = render(pane(compact));
        await waitFor(() => expect(screen.queryByTestId('working-tree-loading')).toBeNull());
        h.local.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('untracked')] });
        rerender(pane(compact, { workingChangesRefreshKey: 1, branchRangeData: { ...range, commitCount: 1 } }));
        await screen.findByTestId('working-tree');
        expect(screen.getByTestId('branch-changes')).toBeTruthy();
        h.local.git.getWorkingTreeChanges.mockResolvedValue({ changes: [] });
        rerender(pane(compact, { workingChangesRefreshKey: 2 }));
        await waitFor(() => expect(screen.queryByTestId('working-tree')).toBeNull());
        expect(screen.queryByTestId('branch-changes')).toBeNull();
        expect(h.local.git.getWorkingTreeChanges).toHaveBeenCalledTimes(3);
    });

    it('keeps loading and errors usable, then recovers on refresh', async () => {
        let reject!: (reason: Error) => void;
        h.local.git.getWorkingTreeChanges.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
        const { rerender } = render(pane(compact));
        expect(screen.getByTestId('working-tree-loading')).toBeTruthy();
        await act(async () => reject(new Error('Git unavailable')));
        expect(screen.getByTestId('working-tree-error').textContent).toContain('Git unavailable');
        rerender(pane(compact, { workingChangesRefreshKey: 1 }));
        await waitFor(() => expect(screen.queryByTestId('working-tree-error')).toBeNull());
        expect(screen.queryByTestId('working-tree')).toBeNull();
    });

    it('shows refresh failures even after both summaries were hidden', async () => {
        const { rerender } = render(pane(compact));
        await waitFor(() => expect(screen.queryByTestId('working-tree-loading')).toBeNull());
        h.local.git.getWorkingTreeChanges.mockRejectedValueOnce(new Error('Working tree unavailable'));
        rerender(pane(compact, { workingChangesRefreshKey: 1, refreshError: 'Range unavailable' }));
        expect((await screen.findByTestId('working-tree-error')).textContent).toContain('Working tree unavailable');
        expect(screen.getByTestId('git-refresh-error').textContent).toContain('Range unavailable');
        h.local.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('staged')] });
        rerender(pane(compact, { workingChangesRefreshKey: 2, branchRangeData: { ...range, fileCount: 1 } }));
        await screen.findByTestId('working-tree');
        expect(screen.getByTestId('branch-changes')).toBeTruthy();
        expect(screen.queryByTestId('git-refresh-error')).toBeNull();
    });

    it('does not interpret unknown counts or omitted changes as empty', async () => {
        h.local.git.getWorkingTreeChanges.mockResolvedValue({});
        render(pane(compact, { branchRangeData: { ...range, commitCount: undefined } as unknown as BranchRangeInfo }));
        await screen.findByTestId('working-tree');
        expect(screen.getByTestId('branch-changes')).toBeTruthy();
    });

    it('keeps untracked changes reported beyond the loaded list', async () => {
        h.local.git.getWorkingTreeChanges.mockResolvedValue({ changes: [], untrackedTotal: 2, untrackedTruncated: true });
        render(pane(compact));
        await screen.findByTestId('working-tree');
    });

    it('keeps files provided alongside zero range counts', async () => {
        render(pane(compact, { branchRangeFiles: [{ path: 'changed.ts', status: 'M' }] }));
        await waitFor(() => expect(screen.queryByTestId('working-tree-loading')).toBeNull());
        expect(screen.getByTestId('branch-changes')).toBeTruthy();
    });

    it('refreshes the selected remote workspace independently', async () => {
        const { rerender } = render(pane(compact, { workspaceId: 'remote/ws' }));
        await waitFor(() => expect(screen.queryByTestId('working-tree-loading')).toBeNull());
        h.remote.git.getWorkingTreeChanges.mockResolvedValue({ changes: [change('staged')] });
        rerender(pane(compact, { workspaceId: 'remote/ws', workingChangesRefreshKey: 1 }));
        await screen.findByTestId('working-tree');
        expect(h.remote.git.getWorkingTreeChanges).toHaveBeenCalledWith('remote/ws');
        expect(h.local.git.getWorkingTreeChanges).not.toHaveBeenCalled();
    });
});
