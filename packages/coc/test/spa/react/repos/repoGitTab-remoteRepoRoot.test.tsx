/**
 * Regression: the Git tab of a REMOTE clone must resolve its repo root from
 * the owning server's workspace row.
 *
 * `state.workspaces` lists only page-origin workspaces, so a remote clone used
 * to get no repo root. The untracked preview then read the file by its absolute
 * path, the remote server answered 404, and the UI claimed the file no longer
 * existed on disk. Saving from the diff editor and Git skill actions shared
 * the same missing root.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { localWorkspaces, reposState } = vi.hoisted(() => ({
    localWorkspaces: [] as Array<{ id: string; rootPath: string }>,
    reposState: { value: null as null | { repos: Array<{ workspace: Record<string, unknown> }> } },
}));

// Git calls return an empty repo; every other client call resolves to `{}`.
const isStub = (key: string | symbol): key is string => typeof key === 'string' && key !== 'then';
const anyMethod = () => new Proxy({} as Record<string, unknown>, {
    get: (target, key) => (isStub(key) ? (target[key] ??= vi.fn().mockResolvedValue({})) : undefined),
});
const git = Object.assign(anyMethod(), {
    listCommits: vi.fn().mockResolvedValue({ commits: [], unpushedCount: 0 }),
    getBranchRange: vi.fn().mockResolvedValue({ onDefaultBranch: true, branchName: 'main', baseRef: 'origin/main' }),
    getRepoState: vi.fn().mockResolvedValue(null),
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
    useReposOptional: () => reposState.value,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: () => {},
}));
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { workspaces: localWorkspaces, selectedGitCommitHash: null, selectedGitFilePath: null },
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
    FileDiffPanel: (props: any) => <div data-testid="stub-file-diff" data-workspace={props.workspaceId} data-destination={props.attachmentDestinationId} />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff', () => ({
    WorkingTreeFileDiff: (props: any) => <div data-testid="stub-working-diff" data-repo-root={props.repoRoot ?? ''} />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/GitPanelHeader', () => ({
    GitPanelHeader: () => <div data-testid="stub-git-header" />,
}));


import { RepoGitTab } from '../../../../src/server/spa/client/react/features/git/RepoGitTab';
import { resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const WS = 'ws-shared-id';
const LOCAL_ROOT = '/local/shortcuts-2';
const ONE_ROOT = '/home/one/shortcuts-2';
const TWO_ROOT = '/home/two/shortcuts-2';

const localRow = { id: WS, rootPath: LOCAL_ROOT };
const remoteRow = (serverId: string, rootPath: string) => ({
    id: WS, rootPath, baseUrl: `http://${serverId}`, remote: { serverId },
});

beforeEach(() => {
    resetCloneRegistryForTests();
    localWorkspaces.length = 0;
    reposState.value = null;
});

afterEach(() => {
    resetCloneRegistryForTests();
    document.body.innerHTML = '';
});

async function renderedRepoRoot(sourceSelectionId?: string): Promise<string | null> {
    const host = document.createElement('div');
    document.body.append(host);
    render(<RepoGitTab workspaceId={WS} sourceSelectionId={sourceSelectionId} detailContainer={host} detailActive
        restoreView={{ type: 'working-tree-file', filePath: `${ONE_ROOT}/goal.md`, stage: 'untracked' }} />);
    await waitFor(() => expect(screen.getByTestId('stub-working-diff')).toBeTruthy());
    return screen.getByTestId('stub-working-diff').getAttribute('data-repo-root');
}

describe('RepoGitTab — repo root for the working-tree detail', () => {
    it('uses the remote clone root when the workspace exists only on a remote server', async () => {
        reposState.value = { repos: [{ workspace: remoteRow('one', ONE_ROOT) }] };
        expect(await renderedRepoRoot('remote:one:ws-shared-id')).toBe(ONE_ROOT);
    });

    it('picks the root of the selected server when two remotes share the workspace id', async () => {
        localWorkspaces.push(localRow);
        reposState.value = { repos: [
            { workspace: localRow },
            { workspace: remoteRow('one', ONE_ROOT) },
            { workspace: remoteRow('two', TWO_ROOT) },
        ] };
        expect(await renderedRepoRoot('remote:two:ws-shared-id')).toBe(TWO_ROOT);
    });

    it('keeps the local root for a local selection that shares an id with a remote', async () => {
        localWorkspaces.push(localRow);
        reposState.value = { repos: [{ workspace: remoteRow('one', ONE_ROOT) }, { workspace: localRow }] };
        expect(await renderedRepoRoot(WS)).toBe(LOCAL_ROOT);
        document.body.innerHTML = '';
        expect(await renderedRepoRoot()).toBe(LOCAL_ROOT);
    });

    it('falls back to the page-origin workspaces outside a repos provider', async () => {
        localWorkspaces.push(localRow);
        expect(await renderedRepoRoot()).toBe(LOCAL_ROOT);
    });
});
