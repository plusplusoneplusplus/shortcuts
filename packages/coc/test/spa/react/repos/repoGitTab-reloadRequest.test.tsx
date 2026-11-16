/**
 * Regression: the right panel Git page's Reload never reached the repo, so the
 * working-changes view kept showing the old list and diff. `RepoGitTab` now
 * runs its ordinary refresh for each host reload request while the host shows
 * its detail, and every refresh re-reads working changes — even while a slow
 * history refresh is still in flight.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

// Git calls return an empty repo; every other client call resolves to `{}`.
const isStub = (key: string | symbol): key is string => typeof key === 'string' && key !== 'then';
const anyMethod = () => new Proxy({} as Record<string, unknown>, {
    get: (target, key) => (isStub(key) ? (target[key] ??= vi.fn().mockResolvedValue({})) : undefined),
});
const git = Object.assign(anyMethod(), {
    listCommits: vi.fn(),
    getBranchRange: vi.fn().mockResolvedValue({ onDefaultBranch: true, branchName: 'main', baseRef: 'origin/main' }),
    getRepoState: vi.fn().mockResolvedValue(null),
    fetch: vi.fn(), pull: vi.fn(), push: vi.fn(),
});
const client = new Proxy({ git } as Record<string, unknown>, {
    get: (target, key) => {
        if (!isStub(key)) return undefined;
        return (target[key] ??= key === 'request' ? vi.fn().mockResolvedValue({}) : anyMethod());
    },
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getSpaCocClient: () => client,
    getCocClientFor: () => client,
}));
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: () => {},
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: [{ id: 'ws-a', rootPath: '/repo' }] }, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/GitReviewPopOutContext', () => ({
    useGitReviewPopOut: () => ({ markPoppedOut: vi.fn() }),
    gitReviewPopOutKey: (a: string, b: string) => `${a}:${b}`,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/branches/BranchChanges', () => ({
    BranchChanges: () => <div data-testid="stub-branch-changes" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorkingTree', () => ({
    WorkingTree: ({ refreshKey }: { refreshKey?: number }) => <div data-testid="stub-working-tree" data-refresh={refreshKey} />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorktreeList', () => ({
    WorktreeList: () => <div data-testid="stub-worktree-list" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitList', () => ({
    CommitList: () => <div data-testid="stub-commit-list" />,
    isTouchOnly: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitDetail', () => ({
    CommitDetail: () => <div data-testid="stub-commit-detail" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeAllFilesDiff', () => ({
    WorkingTreeAllFilesDiff: ({ refreshKey, workspaceId, attachmentDestinationId }: { refreshKey?: number; workspaceId: string; attachmentDestinationId?: string }) => (
        <div data-testid="stub-working-diff" data-refresh={refreshKey} data-workspace={workspaceId} data-owner={attachmentDestinationId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/GitPanelHeader', () => ({
    GitPanelHeader: () => <div data-testid="stub-git-header" />,
}));

import { RepoGitTab } from '../../../../src/server/spa/client/react/features/git/RepoGitTab';
import { resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const page = { commits: [], unpushedCount: 0 };
let host: HTMLDivElement;

beforeEach(() => {
    resetCloneRegistryForTests();
    git.listCommits.mockReset().mockResolvedValue(page);
    host = document.createElement('div');
    document.body.append(host);
});

afterEach(() => {
    resetCloneRegistryForTests();
    document.body.innerHTML = '';
});

function tab(reloadRequest: number, detailOpen = true, sourceSelectionId = 'remote:srv:ws-a') {
    return <RepoGitTab workspaceId="ws-a" sourceSelectionId={sourceSelectionId} detailContainer={host} detailActive
        detailOpen={detailOpen} reloadRequest={reloadRequest}
        restoreView={{ type: 'working-tree-all' }} />;
}
const diffRefresh = () => screen.getByTestId('stub-working-diff').getAttribute('data-refresh');
const listRefresh = () => screen.getByTestId('stub-working-tree').getAttribute('data-refresh');

describe('RepoGitTab — host reload request', () => {
    it('refreshes the working changes list and open diff of its exact owner on each request, never at mount', async () => {
        const view = render(tab(4));
        await waitFor(() => expect(screen.getByTestId('stub-working-diff')).toBeTruthy());
        expect(screen.getByTestId('stub-working-diff').dataset).toMatchObject({ workspace: 'ws-a', owner: 'remote:srv:ws-a' });
        expect(diffRefresh()).toBe('0');
        const reads = git.listCommits.mock.calls.length;

        view.rerender(tab(5));
        await waitFor(() => expect(diffRefresh()).toBe('1'));
        expect(listRefresh()).toBe('1');
        await waitFor(() => expect(git.listCommits.mock.calls.length).toBe(reads + 1));
        expect(git.listCommits.mock.calls.at(-1)![0]).toBe('ws-a');
        // Refresh is local reads only.
        expect(git.fetch).not.toHaveBeenCalled();
        expect(git.pull).not.toHaveBeenCalled();
    });

    it('ignores requests while the host shows another detail', async () => {
        const view = render(tab(0, false));
        await waitFor(() => expect(screen.getByTestId('stub-working-tree')).toBeTruthy());
        const reads = git.listCommits.mock.calls.length;
        view.rerender(tab(1, false));
        await act(async () => {});
        expect(listRefresh()).toBe('0');
        expect(git.listCommits.mock.calls.length).toBe(reads);
    });

    it('re-reads working changes on every request while one history refresh is still in flight', async () => {
        const view = render(tab(0));
        await waitFor(() => expect(screen.getByTestId('stub-working-diff')).toBeTruthy());
        let finish!: (value: typeof page) => void;
        git.listCommits.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const reads = git.listCommits.mock.calls.length;

        view.rerender(tab(1));
        await waitFor(() => expect(diffRefresh()).toBe('1'));
        view.rerender(tab(2));
        await waitFor(() => expect(diffRefresh()).toBe('2'));
        expect(listRefresh()).toBe('2');
        expect(git.listCommits.mock.calls.length).toBe(reads + 1);

        await act(async () => { finish(page); });
        view.rerender(tab(3));
        await waitFor(() => expect(diffRefresh()).toBe('3'));
        await waitFor(() => expect(git.listCommits.mock.calls.length).toBe(reads + 2));
    });
});
