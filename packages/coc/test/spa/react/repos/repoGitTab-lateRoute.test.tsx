/**
 * Regression: the Git tab of a REMOTE clone whose route resolves after the tab
 * first renders.
 *
 * Remote aggregation can finish after first paint, so on a reload the tab's
 * first render sees no route and talks to the page-origin server, which does
 * not know the workspace (404 "Workspace not found"). The tab must reload
 * against the remote server once the route resolves — previously its hooks kept
 * the origin client, so the error survived Retry and every page reload.
 *
 * Uses the REAL cloneRouting/cloneRegistry modules; only the two transports are
 * faked, so the test exercises the actual subscription + remount wiring.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const REMOTE_URL = 'http://127.0.0.1:4100';

/**
 * A fake CocClient: the Git endpoints this test asserts on are explicit; every
 * other namespace/method the tab's children touch resolves to an empty object.
 */
function makeClient(listCommits: ReturnType<typeof vi.fn>) {
    const git = {
        listCommits,
        getBranchRange: vi.fn().mockResolvedValue({ onDefaultBranch: true, branchName: 'main', baseRef: 'origin/main' }),
        getRepoState: vi.fn().mockResolvedValue(null),
    };
    // `then` stays undefined so a namespace is never mistaken for a promise.
    const isStub = (key: string | symbol): key is string => typeof key === 'string' && key !== 'then';
    const anyMethod = () => new Proxy({} as Record<string, unknown>, {
        get: (target, key) => (isStub(key) ? (target[key] ??= vi.fn().mockResolvedValue({})) : undefined),
    });
    const namespaces: Record<string, unknown> = { git: Object.assign(anyMethod(), git) };
    return new Proxy(namespaces, {
        get: (target, key) => {
            if (!isStub(key)) return undefined;
            return (target[key] ??= key === 'request' ? vi.fn().mockResolvedValue({}) : anyMethod());
        },
    }) as { git: typeof git };
}

// The page-origin server does not know the remote workspace.
const originClient = makeClient(vi.fn().mockRejectedValue(new Error('Workspace not found')));
const remoteClient = makeClient(vi.fn().mockResolvedValue({
    commits: [{ hash: 'abc123', subject: 'remote commit', author: 'a', date: '', refs: [] }],
    unpushedCount: 0,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getSpaCocClient: () => originClient,
    getCocClientFor: (baseUrl?: string) => (baseUrl === REMOTE_URL ? remoteClient : originClient),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: () => {},
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { workspaces: [], selectedGitCommitHash: null, selectedGitFilePath: null },
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
    CommitList: ({ commits }: { commits?: Array<{ hash: string }> }) => (
        <div data-testid="stub-commit-list" data-count={commits?.length ?? 0} />
    ),
    isTouchOnly: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitDetail', () => ({
    CommitDetail: () => <div data-testid="stub-commit-detail" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({
    FileDiffPanel: () => <div data-testid="stub-file-diff" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/GitPanelHeader', () => ({
    GitPanelHeader: () => <div data-testid="stub-git-header" />,
}));

import { RepoGitTab } from '../../../../src/server/spa/client/react/features/git/RepoGitTab';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { clearCommitsCache } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitsCache';
import { clearBranchRangeCache } from '../../../../src/server/spa/client/react/features/git/hooks/useBranchRangeCache';

const WS = 'ws-remote-1';

beforeEach(() => {
    resetCloneRegistryForTests();
    clearCommitsCache(WS);
    clearBranchRangeCache(WS);
    originClient.git.listCommits.mockClear();
    remoteClient.git.listCommits.mockClear();
});

afterEach(() => {
    resetCloneRegistryForTests();
});

describe('RepoGitTab — remote route resolving after first render', () => {
    it('reloads from the remote server once the route resolves, clearing the origin 404', async () => {
        render(<RepoGitTab workspaceId={WS} />);

        // First render has no route: the origin server rejects the unknown workspace.
        await waitFor(() => expect(screen.getByTestId('git-tab-error').textContent).toContain('Workspace not found'));
        expect(originClient.git.listCommits).toHaveBeenCalledWith(WS, expect.anything());

        act(() => registerCloneBaseUrls([{ workspaceId: WS, baseUrl: REMOTE_URL }]));

        await waitFor(() => expect(screen.getByTestId('stub-commit-list').getAttribute('data-count')).toBe('1'));
        expect(remoteClient.git.listCommits).toHaveBeenCalledWith(WS, expect.anything());
        expect(screen.queryByTestId('git-tab-error')).toBeNull();
    });

    it('never touches the origin when the route is already resolved at mount', async () => {
        registerCloneBaseUrls([{ workspaceId: WS, baseUrl: REMOTE_URL }]);
        render(<RepoGitTab workspaceId={WS} />);

        await waitFor(() => expect(screen.getByTestId('stub-commit-list').getAttribute('data-count')).toBe('1'));
        expect(remoteClient.git.listCommits).toHaveBeenCalledTimes(1);
        expect(originClient.git.listCommits).not.toHaveBeenCalled();
    });
});
