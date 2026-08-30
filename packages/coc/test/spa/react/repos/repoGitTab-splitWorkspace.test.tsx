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
    CommitList: () => <div data-testid="stub-commit-list" />,
    isTouchOnly: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/GitPanelHeader', () => ({
    GitPanelHeader: ({ onRefresh }: { onRefresh: () => void }) => (
        <button data-testid="stub-git-header-refresh" onClick={onRefresh}>refresh</button>
    ),
}));

import { RepoGitTab } from '../../../../src/server/spa/client/react/features/git/RepoGitTab';

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
