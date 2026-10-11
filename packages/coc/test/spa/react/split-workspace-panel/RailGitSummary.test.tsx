/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CocClient, GitInfoResponse, GitWorkingTreeChangesResponse } from '@plusplusoneplusplus/coc-client';
import { SplitWorkspacePanel, splitWorkspaceGitCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { GroupRailGit, RepoRailGit } from '../../../../src/server/spa/client/react/features/repo-detail/RailGitSummary';
import type { RepoGroupMember } from '../../../../src/server/spa/client/react/repos/repoGroupService';

const dispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', async importOriginal => ({
    ...(await importOriginal<object>()),
    useApp: () => ({ state: {}, dispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

const info = (patch: Partial<GitInfoResponse> = {}): GitInfoResponse => ({
    branch: 'feature/search-panel', dirty: true, ahead: 3, behind: 1, upstream: 'origin/feature/search-panel',
    detached: false, isGitRepo: true, remoteUrl: null, ...patch,
});
const changes: GitWorkingTreeChangesResponse = {
    changes: [
        { filePath: 'a.ts', status: 'M', stage: 'staged', repositoryRoot: '', repositoryName: '' },
        { filePath: 'a.ts', status: 'M', stage: 'unstaged', repositoryRoot: '', repositoryName: '' },
        { filePath: 'b.ts', status: '?', stage: 'untracked', repositoryRoot: '', repositoryName: '' },
    ],
    repoState: { operation: 'none', conflictFiles: [] },
};

function fakeClient(baseUrl?: string) {
    const client = {
        options: { baseUrl },
        workspaces: { gitInfo: vi.fn(async () => info()), gitInfoBatch: vi.fn() },
        git: { getWorkingTreeChanges: vi.fn(async () => changes) },
    };
    return client as typeof client & CocClient;
}

function panel(railGit: React.ReactNode, workspaceId = 'ws-alpha') {
    return <SplitWorkspacePanel workspaceId={workspaceId} runningCount={2} queuedCount={1} railGit={railGit}
        chatList={<div>Chats</div>} gitList={<div data-testid="working-tree">Working tree</div>} detail={<div>Detail</div>} />;
}

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'), '1');
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-beta'), '1');
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('group-product'), '1');
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    dispatch.mockClear();
});
afterEach(() => cleanup());

describe('collapsed rail Git summary · repository', () => {
    it('shows changes, sync and branch tiles below the existing job controls', async () => {
        const client = fakeClient();
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={client} scopeLabel="Local / Harbor" />));
        expect(screen.getByTestId('split-workspace-left-running')).toBeInTheDocument();
        expect(screen.getByTestId('split-workspace-left-queued')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-changes')).toHaveAccessibleName('Working changes: 2 changed paths'));
        expect(screen.getByTestId('split-workspace-left-git-sync')).toHaveAccessibleName('Sync status: 3 ahead, 1 behind origin/feature/search-panel');
        expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveAccessibleName('Branch: feature/search-panel');
        expect(screen.getByTestId('split-workspace-left-git-changes')).toHaveTextContent('~2');
        expect(screen.queryByText('Workspace')).toBeNull();
        expect(client.workspaces.gitInfo).toHaveBeenCalledWith('ws-alpha');
        expect(client.git.getWorkingTreeChanges).toHaveBeenCalledWith('ws-alpha');
    });

    it('previews on focus with the comparison base and returns focus on Escape', async () => {
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={fakeClient()} scopeLabel="Local / Harbor" />));
        const sync = screen.getByTestId('split-workspace-left-git-sync');
        await waitFor(() => expect(sync).toHaveTextContent('↑3↓1'));
        act(() => sync.focus());
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Sync status');
        expect(dialog).toHaveTextContent('Local / Harbor');
        expect(dialog).toHaveTextContent('Compared with upstream origin/feature/search-panel');
        expect(dialog).toHaveTextContent('+1 staged · ~1 modified · ?1 untracked');
        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(sync).toHaveFocus();
    });

    it('opens the branch overview in the expanded sidebar with its Git half open', async () => {
        localStorage.setItem(splitWorkspaceGitCollapsedStorageKey('ws-alpha'), '1');
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={fakeClient()} scopeLabel="Local / Harbor" />));
        fireEvent.click(screen.getByTestId('split-workspace-left-git-branch'));
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_GIT_ROUTE', routeWorkspaceId: 'ws-alpha', workspaceId: 'ws-alpha', commitHash: 'branch-range', filePath: null });
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'))).toBe('0');
        expect(localStorage.getItem(splitWorkspaceGitCollapsedStorageKey('ws-alpha'))).toBe('0');
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
    });

    it('never claims clean for a failed read and keeps job controls usable', async () => {
        const client = fakeClient();
        client.workspaces.gitInfo.mockRejectedValue(new Error('offline'));
        client.git.getWorkingTreeChanges.mockRejectedValue(new Error('offline'));
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={client} scopeLabel="Local / Harbor" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-changes')).toHaveAccessibleName('Working changes: Git status unavailable'));
        expect(screen.getByTestId('split-workspace-left-git-sync')).toHaveTextContent('↕?');
        fireEvent.click(screen.getByTestId('split-workspace-left-running'));
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'))).toBe('0');
    });

    it('discards a late response after the owner changes', async () => {
        let resolveOld!: (value: GitInfoResponse) => void;
        const oldClient = fakeClient();
        oldClient.workspaces.gitInfo.mockReturnValue(new Promise(resolve => { resolveOld = resolve; }));
        const newClient = fakeClient('http://remote-b');
        newClient.workspaces.gitInfo.mockResolvedValue(info({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0 }));
        const view = render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={oldClient} scopeLabel="A" />));
        view.rerender(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={newClient} scopeLabel="B" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveAccessibleName('Branch: main'));
        await act(async () => { resolveOld(info({ branch: 'stale/branch' })); });
        expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveAccessibleName('Branch: main');
    });

    it('reads nothing for an unresolved remote owner', () => {
        const client = fakeClient();
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="remote:srv:ws-alpha" client={client} scopeLabel="Remote" />));
        expect(client.workspaces.gitInfo).not.toHaveBeenCalled();
        expect(screen.getByTestId('split-workspace-left-git-changes')).toHaveAccessibleName('Working changes: Git status unavailable');
    });

    it('does not render or read while the sidebar is expanded', () => {
        localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'), '0');
        const client = fakeClient();
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={client} scopeLabel="Local" />));
        expect(screen.queryByTestId('split-workspace-left-git-changes')).toBeNull();
        expect(client.workspaces.gitInfo).not.toHaveBeenCalled();
    });
});

describe('collapsed rail Git summary · repo group', () => {
    const members: RepoGroupMember[] = [
        { workspaceId: 'ws-harbor', name: 'Harbor', stale: false },
        { workspaceId: 'ws-beacon', name: 'Beacon', stale: false },
        { workspaceId: 'ws-gone', stale: true, staleReason: 'workspace-removed' },
    ] as RepoGroupMember[];

    it('batch-reads live members on the group owner and lists each member branch', async () => {
        const client = fakeClient('http://team-host');
        client.workspaces.gitInfoBatch.mockResolvedValue({ results: {
            'ws-harbor': info(),
            'ws-beacon': info({ branch: 'main', dirty: false, ahead: 0, behind: 0, upstream: 'origin/main' }),
        } });
        render(panel(<GroupRailGit selectionId="remote:team:group-product" routingRef="remote:team:group-product" client={client} members={members} scopeLabel="Product / Group" />, 'group-product'));
        expect(client.workspaces.gitInfoBatch).toHaveBeenCalledWith(['ws-harbor', 'ws-beacon']);
        const changes = screen.getByTestId('split-workspace-left-git-changes');
        await waitFor(() => expect(changes).toHaveTextContent('R1'));
        expect(changes).toHaveAccessibleName('Repository changes: 1 of 2 repositories changed');
        expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveTextContent('2 repos');
        expect(screen.getByTestId('split-workspace-left-git-branch')).not.toHaveTextContent('feature/search-panel');

        act(() => changes.focus());
        const rows = within(screen.getByRole('dialog')).getAllByTestId('rail-git-member');
        expect(rows.map(row => row.dataset.member)).toEqual(['ws-harbor', 'ws-beacon', 'ws-gone']);
        expect(rows[0]).toHaveTextContent('feature/search-panel');
        expect(rows[1]).toHaveTextContent('main');
        expect(rows[2]).toHaveTextContent('Unavailable');
        fireEvent.click(within(rows[1]).getByRole('button', { name: 'Open Beacon Git' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_GIT_ROUTE', routeWorkspaceId: 'remote:team:group-product', workspaceId: 'ws-beacon', commitHash: null, filePath: null });
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('group-product'))).toBe('0');
    });
});
