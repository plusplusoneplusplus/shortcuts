/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CocClient, GitInfoResponse, GitWorkingTreeChangesResponse } from '@plusplusoneplusplus/coc-client';
import { SplitWorkspacePanel, splitWorkspaceGitCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { GroupRailGit, RepoRailGit } from '../../../../src/server/spa/client/react/features/repo-detail/RailGitSummary';
import type { RepoGroupMember } from '../../../../src/server/spa/client/react/repos/repoGroupService';

import { clearExplorerDirty, setExplorerInstanceDirty } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';

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
        git: {
            getWorkingTreeChanges: vi.fn(async () => changes),
            listBranches: vi.fn(async () => ({ local: { branches: [
                { name: 'feature/search-panel', isCurrent: true, isRemote: false },
                { name: 'main', isCurrent: false, isRemote: false },
            ], hasMore: false } })),
            switchBranch: vi.fn(async () => ({ success: true })),
        },
    };
    return client as typeof client & CocClient;
}

function panel(railGit: React.ReactNode, workspaceId = 'ws-alpha') {
    return <SplitWorkspacePanel workspaceId={workspaceId} runningCount={2} queuedCount={1} railGit={railGit}
        chatList={<div>Chats</div>} gitList={<div data-testid="working-tree">Working tree</div>} detail={<div>Detail</div>} />;
}

beforeEach(() => {
    clearExplorerDirty();
    localStorage.clear();
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'), '1');
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-beta'), '1');
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('group-product'), '1');
    Element.prototype.scrollIntoView = vi.fn();
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

    it.each([undefined, 'http://remote-b'])('switches through the popup owner %s and refreshes without navigation', async baseUrl => {
        const client = fakeClient(baseUrl);
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef={baseUrl ? 'remote:srv:ws-alpha' : 'ws-alpha'} client={client} scopeLabel="Owner" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveAccessibleName('Branch: feature/search-panel'));
        act(() => screen.getByTestId('split-workspace-left-git-branch').focus());
        fireEvent.click(screen.getByTestId('rail-git-branch'));
        await screen.findByRole('option', { name: /main/ });
        expect(screen.getByRole('option', { name: /feature\/search-panel/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: 'Open working tree' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open branch overview' })).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('branch-item-feature/search-panel'));
        expect(client.git.switchBranch).not.toHaveBeenCalled();
        const reads = client.workspaces.gitInfo.mock.calls.length;
        client.workspaces.gitInfo.mockResolvedValue(info({ branch: 'main' }));
        fireEvent.click(screen.getByTestId('branch-item-main'));
        await waitFor(() => expect(client.git.switchBranch).toHaveBeenCalledWith('ws-alpha', 'main', { force: false }));
        await waitFor(() => expect(screen.queryByTestId('branch-picker-modal')).toBeNull());
        await waitFor(() => expect(client.workspaces.gitInfo.mock.calls.length).toBeGreaterThan(reads));
        expect(screen.getByTestId('rail-git-branch')).toHaveTextContent('main');
        expect(screen.getByTestId('rail-git-branch')).toHaveFocus();
        expect(dispatch).not.toHaveBeenCalled();
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'))).toBe('1');
    });

    it('announces load errors, retries and keeps failed switches open', async () => {
        const client = fakeClient();
        client.git.listBranches.mockRejectedValueOnce(new Error('offline'));
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={client} scopeLabel="Local" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveTextContent('feature/search-panel'));
        act(() => screen.getByTestId('split-workspace-left-git-branch').focus());
        fireEvent.click(screen.getByTestId('rail-git-branch'));
        expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('offline'));
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByTestId('branch-item-main');
        client.git.switchBranch.mockRejectedValue(new Error('Workspace work is active'));
        fireEvent.click(screen.getByTestId('branch-item-main'));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Workspace work is active'));
        expect(screen.getByTestId('branch-picker-modal')).toBeInTheDocument();
        fireEvent.keyDown(screen.getByTestId('branch-picker-search'), { key: 'Escape' });
        expect(screen.queryByTestId('branch-picker-modal')).toBeNull();
        expect(screen.getByTestId('rail-git-branch')).toHaveFocus();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it.each(['ws-alpha', 'remote:srv:ws-alpha'])('preserves unsaved editor buffers for %s without a switch or discard prompt', async routingRef => {
        const client = fakeClient(routingRef.startsWith('remote:') ? 'http://remote-b' : undefined);
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef={routingRef} client={client} scopeLabel="Local" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveTextContent('feature/search-panel'));
        act(() => screen.getByTestId('split-workspace-left-git-branch').focus());
        fireEvent.click(screen.getByTestId('rail-git-branch'));
        await screen.findByTestId('branch-item-main');
        setExplorerInstanceDirty(routingRef, 'editor', true);
        fireEvent.click(screen.getByTestId('branch-item-main'));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Save your editor changes'));
        expect(client.git.switchBranch).not.toHaveBeenCalled();
        expect(screen.getByTestId('branch-picker-modal')).toBeInTheDocument();
    });

    it('ignores branch lists from a previous owner', async () => {
        const oldClient = fakeClient();
        const newClient = fakeClient('http://remote-b');
        let resolveOld!: (value: any) => void;
        oldClient.git.listBranches.mockReturnValue(new Promise(resolve => { resolveOld = resolve; }));
        const view = render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={oldClient} scopeLabel="A" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveTextContent('feature/search-panel'));
        act(() => screen.getByTestId('split-workspace-left-git-branch').focus());
        fireEvent.click(screen.getByTestId('rail-git-branch'));
        await waitFor(() => expect(oldClient.git.listBranches).toHaveBeenCalled());
        view.rerender(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="remote:srv:ws-alpha" client={newClient} scopeLabel="B" />));
        await act(async () => resolveOld({ local: { branches: [{ name: 'stale-owner', isCurrent: false }], hasMore: false } }));
        expect(screen.queryByTestId('branch-item-stale-owner')).toBeNull();
        fireEvent.click(screen.getByTestId('rail-git-branch'));
        await screen.findByTestId('branch-item-main');
        expect(newClient.git.listBranches).toHaveBeenCalledWith('ws-alpha', expect.any(Object));
    });

    it('handles keyboard selection and prevents duplicate switches while pending', async () => {
        const client = fakeClient();
        let resolveSwitch!: (value: any) => void;
        client.git.switchBranch.mockReturnValue(new Promise(resolve => { resolveSwitch = resolve; }));
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={client} scopeLabel="Local" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveTextContent('feature/search-panel'));
        act(() => screen.getByTestId('split-workspace-left-git-branch').focus());
        fireEvent.click(screen.getByTestId('rail-git-branch'));
        await screen.findByTestId('branch-item-main');
        const input = screen.getByRole('combobox', { name: 'Search branches' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input).toHaveAttribute('aria-activedescendant', screen.getByTestId('branch-item-main').id);
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.click(screen.getByTestId('branch-item-main'));
        expect(client.git.switchBranch).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('branch-picker-switching')).toHaveAttribute('role', 'status');
        await act(async () => resolveSwitch({ success: false, error: 'dirty checkout' }));
        expect(screen.getByRole('alert')).toHaveTextContent('dirty checkout');
    });

    it('searches with the raw workspace id on the supplied owner', async () => {
        const client = fakeClient('http://remote-b');
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="remote:srv:ws-alpha" client={client} scopeLabel="Remote" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-branch')).toHaveTextContent('feature/search-panel'));
        act(() => screen.getByTestId('split-workspace-left-git-branch').focus());
        fireEvent.click(screen.getByTestId('rail-git-branch'));
        await screen.findByTestId('branch-item-main');
        fireEvent.change(screen.getByRole('combobox', { name: 'Search branches' }), { target: { value: 'main' } });
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search branches' }), { key: 'Enter' });
        expect(client.git.switchBranch).not.toHaveBeenCalled();
        await waitFor(() => expect(client.git.listBranches).toHaveBeenLastCalledWith('ws-alpha', { type: 'local', limit: 50, offset: 0, search: 'main' }));
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
