/**
 * Render tests for RepoGitTab's split-workspace portal contract.
 *
 * In split-workspace mode the tab renders ONLY its list in place and portals
 * the detail pane into a parent-provided container, gated on `detailActive`, so
 * chat and git never show two detail panes in the one shared region (AC-04).
 * The hoisted toolbar must portal OUTSIDE the list's capture wrapper, or a
 * Pull/refresh click would mark git last-clicked and steal the shared pane.
 *
 * These assert the rendered tree rather than the source text, so a future
 * refactor that keeps the markup but breaks the portal wiring still fails.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const client = {
    request: vi.fn().mockResolvedValue({ skills: [] }),
    git: {
        listCommits: vi.fn().mockResolvedValue({ commits: [], unpushedCount: 0 }),
        getBranchRange: vi.fn().mockResolvedValue({ onDefaultBranch: true, branchName: 'main', baseRef: 'origin/main' }),
        getRepoState: vi.fn().mockResolvedValue(null),
        getLatestOperation: vi.fn().mockResolvedValue(null),
        getOperation: vi.fn().mockResolvedValue(null),
        getWorkingTreeChanges: vi.fn().mockResolvedValue({ changes: [] }),
        getAutoPullStatus: vi.fn().mockResolvedValue({ enabled: false }),
        getCommit: vi.fn(),
    },
    preferences: { getRepo: vi.fn().mockResolvedValue({}), patchRepo: vi.fn().mockResolvedValue({}) },
    queue: { enqueue: vi.fn() },
};

vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => client,
    useCloneWsUrl: () => (p: string) => p,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => client,
    lookupCloneBaseUrl: () => undefined,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: () => {},
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { workspaces: [{ id: 'ws-1', rootPath: '/repo' }], selectedGitCommitHash: null, selectedGitFilePath: null },
        dispatch: vi.fn(),
    }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/GitReviewPopOutContext', () => ({
    useGitReviewPopOut: () => ({ markPoppedOut: vi.fn() }),
    gitReviewPopOutKey: (a: string, b: string) => `${a}:${b}`,
}));

// Heavy children are irrelevant to the portal contract — stub them to markers.
vi.mock('../../../../src/server/spa/client/react/features/git/branches/BranchChanges', () => ({
    BranchChanges: () => <div data-testid="stub-branch-changes" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorkingTree', () => ({
    WorkingTree: () => <div data-testid="stub-working-tree" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorktreeList', () => ({
    WorktreeList: () => <div data-testid="stub-worktree-list" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitList', () => ({
    // Exposes just enough to drive and observe selection: a button that selects
    // a commit, and the currently-selected hash reflected back into the DOM.
    CommitList: ({ onSelect, selectedHash, selectedFile, onFileSelect }: {
        onSelect?: (c: unknown) => void;
        selectedHash?: string;
        selectedFile?: { hash: string; filePath: string } | null;
        onFileSelect?: (hash: string, filePath: string) => void;
    }) => (
        <div
            data-testid="stub-commit-list"
            data-selected={selectedHash ?? 'none'}
            data-selected-file={selectedFile ? `${selectedFile.hash}:${selectedFile.filePath}` : 'none'}
        >
            <button
                data-testid="stub-commit-select"
                onClick={() => onSelect?.({ hash: 'abc123', subject: 'a commit', author: 'a', date: '', refs: [] })}
            >select commit</button>
            <button
                data-testid="stub-commit-file-select"
                onClick={() => onFileSelect?.('abc123', 'src/a.ts')}
            >select commit file</button>
        </div>
    ),
    isTouchOnly: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitDetail', () => ({
    CommitDetail: ({ hash }: { hash: string }) => <div data-testid="stub-commit-detail" data-hash={hash} />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    // A file diff whose "next file" button walks to a fixed sibling, the way the
    // real panel's hunk navigation crosses a file boundary.
    FileDiffPanel: ({ filePath, onNavigateToFile, initialHunkTarget }: {
        filePath: string;
        onNavigateToFile?: (fp: string, target: 'first' | 'last') => void;
        initialHunkTarget?: string;
    }) => (
        <div data-testid="stub-file-diff" data-file={filePath} data-hunk-target={initialHunkTarget ?? 'none'}>
            <button data-testid="stub-file-diff-next" onClick={() => onNavigateToFile?.('src/b.ts', 'first')}>next file</button>
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/GitPanelHeader', () => ({
    GitPanelHeader: ({ onRefresh, repositorySelector }: { onRefresh: () => void; repositorySelector?: ReactNode }) => (
        <div data-testid="stub-git-header">
            {repositorySelector}
            <button data-testid="stub-git-header-refresh" onClick={onRefresh}>refresh</button>
        </div>
    ),
}));

import { RepoGitTab } from '../../../../src/server/spa/client/react/features/git/RepoGitTab';
import {
    MobileWorkspacePaneProvider,
    useMobileWorkspacePaneState,
} from '../../../../src/server/spa/client/react/features/repo-detail/mobileWorkspacePane';

/** Wait past the initial load so the tab renders its panes rather than the spinner. */
async function renderTab(props: Record<string, unknown>) {
    const result = render(<RepoGitTab workspaceId="ws-1" {...props} />);
    await waitFor(() => expect(screen.queryByTestId('git-tab-loading')).toBeNull());
    return result;
}

beforeEach(() => {
    vi.clearAllMocks();
    client.git.listCommits.mockResolvedValue({ commits: [], unpushedCount: 0 });
    client.git.getBranchRange.mockResolvedValue({ onDefaultBranch: true, branchName: 'main', baseRef: 'origin/main' });
    client.git.getRepoState.mockResolvedValue(null);
    client.git.getLatestOperation.mockResolvedValue(null);
    client.preferences.getRepo.mockResolvedValue({});
    client.request.mockResolvedValue({ skills: [] });
    localStorage.clear();
});

describe('RepoGitTab — standalone layout (flag off)', () => {
    it('passes the repository selector into the Git toolbar', async () => {
        await renderTab({ repositorySelector: <select aria-label="Member repository"><option>repo-a</option></select> });
        expect(screen.getByTestId('stub-git-header').contains(screen.getByRole('combobox'))).toBe(true);
    });

    it('keeps the repository selector usable while Git data is loading', () => {
        client.git.listCommits.mockReturnValueOnce(new Promise(() => {}));
        const onChange = vi.fn();
        render(<RepoGitTab workspaceId="ws-loading" repositorySelector={
            <select aria-label="Member repository" onChange={onChange}>
                <option value="repo-a">repo-a</option><option value="repo-b">repo-b</option>
            </select>
        } />);
        expect(screen.getByTestId('git-tab-loading')).toBeTruthy();
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'repo-b' } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('keeps the repository selector usable after Git data fails to load', async () => {
        client.git.listCommits.mockRejectedValueOnce(new Error('Repo unavailable'));
        const onChange = vi.fn();
        render(<RepoGitTab workspaceId="ws-error" repositorySelector={
            <select aria-label="Member repository" onChange={onChange}>
                <option value="repo-a">repo-a</option><option value="repo-b">repo-b</option>
            </select>
        } />);
        await waitFor(() => expect(screen.getByTestId('git-tab-error')).toBeTruthy());
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'repo-b' } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('renders its own list and detail panes in place', async () => {
        await renderTab({});
        expect(screen.getByTestId('repo-git-tab')).toBeTruthy();
        expect(screen.getByTestId('git-commit-list-panel')).toBeTruthy();
        expect(screen.getByTestId('git-detail-panel')).toBeTruthy();
        // No split-workspace scaffolding leaks onto the default path.
        expect(screen.queryByTestId('git-split-workspace-list')).toBeNull();
        expect(screen.queryByTestId('git-split-workspace-detail')).toBeNull();
    });

    it('keeps its own resize handle', async () => {
        await renderTab({});
        expect(screen.getByTestId('git-resize-handle')).toBeTruthy();
    });
});

describe('RepoGitTab — split-workspace layout', () => {
    it('renders only the list in place, with no inline detail pane', async () => {
        await renderTab({ layout: 'split-workspace' });
        expect(screen.getByTestId('git-split-workspace-list')).toBeTruthy();
        expect(screen.queryByTestId('git-detail-panel')).toBeNull();
        // The shell owns the dividers, so the tab keeps no resize handle here.
        expect(screen.queryByTestId('git-resize-handle')).toBeNull();
    });

    it('does not portal the detail while another tab holds the last click', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        await renderTab({ layout: 'split-workspace', detailContainer: container, detailActive: false });
        expect(container.querySelector('[data-testid="git-split-workspace-detail"]')).toBeNull();
    });

    it('portals the detail into the shared container once git is active', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        await renderTab({ layout: 'split-workspace', detailContainer: container, detailActive: true });
        expect(container.querySelector('[data-testid="git-split-workspace-detail"]')).toBeTruthy();
    });

    it('renders nothing into a missing container even when active', async () => {
        await renderTab({ layout: 'split-workspace', detailContainer: null, detailActive: true });
        expect(screen.queryByTestId('git-split-workspace-detail')).toBeNull();
    });

    it('reports a new selection once through onViewChange and portals its detail', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onViewChange = vi.fn();
        await renderTab({ layout: 'split-workspace', detailContainer: container, detailActive: true, onViewChange });
        expect(onViewChange).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await waitFor(() => expect(onViewChange).toHaveBeenCalledTimes(1));
        expect(onViewChange.mock.calls[0][0]).toMatchObject({ type: 'commit', commit: { hash: 'abc123' } });
        expect(container.querySelector('[data-testid="stub-commit-detail"]')?.getAttribute('data-hash')).toBe('abc123');

        // Re-selecting the same commit is the same view: no second report.
        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(onViewChange).toHaveBeenCalledTimes(1);
    });

    it('clears the selection when the host closes the detail, so the same commit re-opens', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onViewChange = vi.fn();
        const props = { layout: 'split-workspace', detailContainer: container, detailActive: true, onViewChange };
        const { rerender } = await renderTab({ ...props, detailOpen: false });

        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await waitFor(() => expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected')).toBe('abc123'));
        // The host opens its tab in response; staying open keeps the selection.
        rerender(<RepoGitTab workspaceId="ws-1" {...props} detailOpen={true} />);
        expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected')).toBe('abc123');

        // The user closes the host tab: the highlight drops.
        rerender(<RepoGitTab workspaceId="ws-1" {...props} detailOpen={false} />);
        await waitFor(() => expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected')).toBe('none'));
        expect(onViewChange).toHaveBeenLastCalledWith(null);

        // Re-clicking the same commit is a new selection again, so the host reopens.
        onViewChange.mockClear();
        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await waitFor(() => expect(onViewChange).toHaveBeenCalledTimes(1));
        expect(onViewChange.mock.calls[0][0]).toMatchObject({ type: 'commit', commit: { hash: 'abc123' } });
    });

    it('navigates to the next file inside the host tab and keeps the sidebar in sync (AC-05)', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onViewChange = vi.fn();
        await renderTab({ layout: 'split-workspace', detailContainer: container, detailActive: true, detailOpen: true, onViewChange });

        fireEvent.click(screen.getByTestId('stub-commit-file-select'));
        await waitFor(() => expect(container.querySelector('[data-testid="stub-file-diff"]')?.getAttribute('data-file')).toBe('src/a.ts'));
        expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected-file')).toBe('abc123:src/a.ts');

        // Crossing the file boundary from inside the tab swaps the tab's content…
        fireEvent.click(container.querySelector('[data-testid="stub-file-diff-next"]')!);
        await waitFor(() => expect(container.querySelector('[data-testid="stub-file-diff"]')?.getAttribute('data-file')).toBe('src/b.ts'));
        expect(container.querySelector('[data-testid="stub-file-diff"]')?.getAttribute('data-hunk-target')).toBe('first');
        expect(container.querySelectorAll('[data-testid="stub-file-diff"]')).toHaveLength(1);
        // …moves the sidebar highlight to the new file…
        expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected-file')).toBe('abc123:src/b.ts');
        // …and reports the new view so the host tab's descriptor follows it.
        expect(onViewChange).toHaveBeenLastCalledWith({ type: 'commit-file', hash: 'abc123', filePath: 'src/b.ts' });
    });

    describe('restoring a persisted view (AC-03)', () => {
        const commit = { hash: 'abc123', shortHash: 'abc123', subject: 'a commit', author: 'a', date: '', parentHashes: [] };

        // Each test gets its own workspace: the commit page is cached per id.
        let restoreSeq = 0;
        let workspaceId = '';
        beforeEach(() => { workspaceId = `ws-restore-${++restoreSeq}`; });

        async function renderRestored(restoreView: unknown, onViewChange = vi.fn()) {
            const container = document.createElement('div');
            document.body.appendChild(container);
            await renderTab({ workspaceId, layout: 'split-workspace', detailContainer: container, detailActive: true, onViewChange, restoreView });
            return { container, onViewChange };
        }

        it('refetches a commit view from the loaded page', async () => {
            client.git.listCommits.mockResolvedValue({ commits: [commit], unpushedCount: 0 });
            const { container, onViewChange } = await renderRestored({ type: 'commit', hash: 'abc123' });
            await waitFor(() => expect(container.querySelector('[data-testid="stub-commit-detail"]')?.getAttribute('data-hash')).toBe('abc123'));
            expect(onViewChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'commit', commit: expect.objectContaining({ hash: 'abc123' }) }));
            expect(client.git.getCommit).not.toHaveBeenCalled();
        });

        it('looks a commit up by hash when it is outside the loaded page', async () => {
            client.git.getCommit.mockResolvedValue({ ...commit, hash: 'def456', shortHash: 'def456' });
            const { container } = await renderRestored({ type: 'commit', hash: 'def456' });
            await waitFor(() => expect(container.querySelector('[data-testid="stub-commit-detail"]')?.getAttribute('data-hash')).toBe('def456'));
            expect(client.git.getCommit).toHaveBeenCalledWith(workspaceId, 'def456');
        });

        it('shows a not-found notice, not a blank tab, when the commit is gone', async () => {
            client.git.getCommit.mockRejectedValue(new Error('404'));
            const { container, onViewChange } = await renderRestored({ type: 'commit', hash: 'deadbeef' });
            await waitFor(() => expect(container.querySelector('[data-testid="git-detail-restore-not-found"]')?.textContent)
                .toContain('deadbee'));
            expect(container.querySelector('[data-testid="git-detail-empty"]')).toBeNull();
            expect(onViewChange).not.toHaveBeenCalled();

            // A new click replaces the notice with that selection's detail.
            fireEvent.click(screen.getByTestId('stub-commit-select'));
            await waitFor(() => expect(container.querySelector('[data-testid="stub-commit-detail"]')).toBeTruthy());
            expect(container.querySelector('[data-testid="git-detail-restore-not-found"]')).toBeNull();
        });

        it('restores a non-commit view as-is', async () => {
            const { container, onViewChange } = await renderRestored({ type: 'branch-range-comments' });
            await waitFor(() => expect(onViewChange).toHaveBeenCalledWith({ type: 'branch-range-comments' }));
            // On the default branch there is no range left to show: say so, don't crash.
            expect(container.querySelector('[data-testid="git-detail-no-branch-range"]')).toBeTruthy();
        });
    });

    it('keeps a fresh selection when the host was never open', async () => {
        await renderTab({ layout: 'split-workspace', detailOpen: false });
        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await waitFor(() => expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected')).toBe('abc123'));
    });

    it('marks git last-clicked when the user clicks in the list', async () => {
        const onActivateDetail = vi.fn();
        await renderTab({ layout: 'split-workspace', onActivateDetail });
        fireEvent.click(screen.getByTestId('git-commit-list-panel'));
        expect(onActivateDetail).toHaveBeenCalled();
    });

    it('portals the toolbar into the section header slot instead of the list', async () => {
        const headerSlot = document.createElement('div');
        document.body.appendChild(headerSlot);
        await renderTab({ layout: 'split-workspace', headerToolbarContainer: headerSlot });
        expect(headerSlot.querySelector('[data-testid="stub-git-header-refresh"]')).toBeTruthy();
        expect(screen.getByTestId('git-commit-list-panel')
            .querySelector('[data-testid="stub-git-header-refresh"]')).toBeNull();
    });

    it('does not steal the shared detail pane when the hoisted toolbar is clicked', async () => {
        // Regression: the toolbar portal must live OUTSIDE the capture wrapper —
        // portaled React events still bubble through the React tree.
        const headerSlot = document.createElement('div');
        document.body.appendChild(headerSlot);
        const onActivateDetail = vi.fn();
        await renderTab({ layout: 'split-workspace', headerToolbarContainer: headerSlot, onActivateDetail });

        fireEvent.click(headerSlot.querySelector('[data-testid="stub-git-header-refresh"]')!);
        expect(onActivateDetail).not.toHaveBeenCalled();
    });

    it('keeps the toolbar inline when no header slot is provided', async () => {
        await renderTab({ layout: 'split-workspace' });
        expect(screen.getByTestId('git-commit-list-panel')
            .querySelector('[data-testid="stub-git-header-refresh"]')).toBeTruthy();
    });

    it('renders layout-agnostic overlays in both layouts', async () => {
        // The skill-context / branch-picker dialogs mount closed in both branches;
        // what matters is that the split branch renders the overlay subtree at all.
        const { unmount } = await renderTab({ layout: 'split-workspace' });
        expect(screen.getByTestId('git-split-workspace-list')).toBeTruthy();
        unmount();
        await renderTab({});
        expect(screen.getByTestId('repo-git-tab')).toBeTruthy();
    });
});

/**
 * AC-02 — on the mobile Workspace panel the shell owns the full-screen detail
 * push. RepoGitTab has no `mobileShowDetail` of its own, so it drives the shell
 * straight off its selection: picking a commit pushes the detail, and popping
 * the detail (Back) clears the selection so the same commit can be re-picked.
 */
describe('RepoGitTab — mobile Workspace detail push', () => {
    function Harness() {
        const pane = useMobileWorkspacePaneState('ws-1');
        return (
            <MobileWorkspacePaneProvider value={pane}>
                <div data-testid="harness" data-detail-open={pane.detailOpen ? 'true' : 'false'} />
                <button data-testid="harness-back" onClick={() => pane.setDetailOpen(false)}>back</button>
                <RepoGitTab workspaceId="ws-1" layout="split-workspace" />
            </MobileWorkspacePaneProvider>
        );
    }

    async function renderHarness() {
        const result = render(<Harness />);
        await waitFor(() => expect(screen.queryByTestId('git-tab-loading')).toBeNull());
        return result;
    }

    it('starts on the list, with the detail not pushed', async () => {
        await renderHarness();
        expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('false');
    });

    it('pushes the shell detail when a commit is selected', async () => {
        await renderHarness();
        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await waitFor(() =>
            expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('true'));
        expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected')).toBe('abc123');
    });

    it('clears the selection when the shell pops the detail, so the same commit re-opens', async () => {
        await renderHarness();
        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await waitFor(() =>
            expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('true'));

        fireEvent.click(screen.getByTestId('harness-back'));
        await waitFor(() =>
            expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected')).toBe('none'));
        expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('false');

        // Re-tapping the same commit pushes the detail again rather than being
        // swallowed by a stale selection.
        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await waitFor(() =>
            expect(screen.getByTestId('harness').getAttribute('data-detail-open')).toBe('true'));
    });

    it('leaves the selection alone outside the mobile Workspace panel', async () => {
        await renderTab({ layout: 'split-workspace' });
        fireEvent.click(screen.getByTestId('stub-commit-select'));
        await waitFor(() =>
            expect(screen.getByTestId('stub-commit-list').getAttribute('data-selected')).toBe('abc123'));
    });
});
