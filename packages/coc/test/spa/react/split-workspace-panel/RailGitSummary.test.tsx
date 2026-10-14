/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CocClient, GitCommit, GitInfoResponse, GitWorkingTreeChangesResponse } from '@plusplusoneplusplus/coc-client';
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

const outgoing: GitCommit[] = [3, 2, 1].map(n => ({
    hash: String(n).repeat(40), shortHash: String(n).repeat(7), subject: `Outgoing change ${n}`,
    author: 'Example', date: '2026-10-01T12:00:00Z', parentHashes: [],
}));

function fakeClient(baseUrl?: string) {
    const client = {
        options: { baseUrl },
        workspaces: { gitInfo: vi.fn(async () => info()), gitInfoBatch: vi.fn() },
        git: {
            listCommits: vi.fn(async (_workspaceId: string) => ({ commits: outgoing, unpushedCount: 3 })),
            fetch: vi.fn(), pull: vi.fn(), push: vi.fn(),
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
    it('keeps hovered outgoing rows viewport-bounded without a fetch or mutation', async () => {
        const client = fakeClient();
        const width = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 196 });
        try {
            render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={client} scopeLabel="Owner" />));
            const sync = screen.getByTestId('split-workspace-left-git-sync');
            await waitFor(() => expect(sync).toHaveTextContent('↑3↓1'));
            fireEvent.pointerEnter(sync, { pointerType: 'mouse' });
            expect(client.git.listCommits).not.toHaveBeenCalled();
            await screen.findByRole('button', { name: /^Open commit 3333333/ });
            const popup = screen.getByRole('dialog');
            expect(Number.parseFloat(popup.style.maxWidth)).toBeLessThanOrEqual(180);
            expect(screen.getByTestId('rail-outgoing-list')).toHaveClass('max-h-48', 'overflow-y-auto');
            expect(client.git.fetch).not.toHaveBeenCalled();
            expect(client.git.pull).not.toHaveBeenCalled();
            expect(client.git.push).not.toHaveBeenCalled();
            expect(client.git.switchBranch).not.toHaveBeenCalled();
            expect(client.git.listBranches).not.toHaveBeenCalled();
            fireEvent.pointerDown(document.body);
            expect(screen.queryByRole('dialog')).toBeNull();
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        }
    });

    it.each([undefined, 'http://remote-b'])('lazily opens outgoing history and navigates the full SHA on owner %s', async baseUrl => {
        const client = fakeClient(baseUrl);
        const routingRef = baseUrl ? 'remote:srv:ws-alpha' : 'ws-alpha';
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef={routingRef} client={client} scopeLabel="Owner" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-sync')).toHaveTextContent('↑3↓1'));
        expect(client.git.listCommits).not.toHaveBeenCalled();
        act(() => screen.getByTestId('split-workspace-left-git-changes').focus());
        expect(client.git.listCommits).not.toHaveBeenCalled();
        act(() => screen.getByTestId('split-workspace-left-git-sync').focus());
        const rows = await screen.findAllByRole('button', { name: /^Open commit/ });
        expect(rows.map(row => row.textContent)).toEqual(outgoing.map(commit => commit.shortHash + commit.subject));
        expect(client.git.listCommits).toHaveBeenCalledWith('ws-alpha', { limit: 50, skip: undefined, refresh: true });
        expect(screen.getByRole('button', { name: 'Open branch overview' })).toBeInTheDocument();
        fireEvent.pointerDown(rows[1]);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        act(() => rows[1].focus());
        fireEvent.keyDown(rows[1], { key: 'ArrowDown' });
        expect(rows[2]).toHaveFocus();
        fireEvent.click(rows[2]);
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_GIT_ROUTE', routeWorkspaceId: 'ws-alpha', workspaceId: 'ws-alpha', commitHash: outgoing[2].hash, filePath: null,
            knownCommit: { sourceSelectionId: routingRef, commit: outgoing[2] } });
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'))).toBe('0');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(client.git.switchBranch).not.toHaveBeenCalled();
    });

    it('keeps the embedded picker keyboard owner while outgoing rows are present', async () => {
        const user = userEvent.setup();
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef="ws-alpha" client={fakeClient()} scopeLabel="Owner" />));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-sync')).toHaveTextContent('↑3↓1'));
        act(() => screen.getByTestId('split-workspace-left-git-sync').focus());
        await screen.findByRole('button', { name: /^Open commit 3333333/ });
        await user.click(screen.getByTestId('rail-git-branch'));
        const search = await screen.findByRole('combobox', { name: 'Search branches' });
        await waitFor(() => expect(search).toHaveFocus());
        await user.keyboard('{ArrowDown}{Escape}');
        expect(screen.queryByTestId('branch-picker-modal')).toBeNull();
        expect(screen.getByTestId('rail-git-branch')).toHaveFocus();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('split-workspace-left-git-sync')).toHaveFocus();
    });

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

    it.each([undefined, 'http://remote-b'])('keeps pointer and keyboard interaction inside the embedded picker on owner %s', async baseUrl => {
        const user = userEvent.setup();
        const client = fakeClient(baseUrl);
        render(panel(<RepoRailGit workspaceId="ws-alpha" routingRef={baseUrl ? 'remote:srv:ws-alpha' : 'ws-alpha'} client={client} scopeLabel="Owner" />));
        const trigger = screen.getByTestId('split-workspace-left-git-branch');
        await waitFor(() => expect(trigger).toHaveTextContent('feature/search-panel'));
        await user.hover(trigger);
        await screen.findByTestId('rail-git-branch');
        await user.click(screen.getByTestId('rail-git-branch'));
        await screen.findByTestId('branch-item-main');
        const search = screen.getByRole('combobox', { name: 'Search branches' });
        await waitFor(() => expect(search).toHaveFocus());
        await user.keyboard('{ArrowDown}');
        expect(search).toHaveFocus();
        expect(search).toHaveAttribute('aria-activedescendant', screen.getByTestId('branch-item-main').id);
        await user.keyboard('{ArrowUp}');
        expect(search).toHaveFocus();
        expect(search).toHaveAttribute('aria-activedescendant', screen.getByTestId('branch-item-feature/search-panel').id);
        await user.keyboard('{Escape}');
        expect(screen.queryByTestId('branch-picker-modal')).toBeNull();
        expect(screen.getByTestId('rail-git-branch')).toHaveFocus();
        await user.click(screen.getByTestId('rail-git-branch'));
        await screen.findByTestId('branch-item-main');
        await user.click(screen.getByTestId('branch-item-feature/search-panel'));
        expect(screen.getByTestId('branch-picker-modal')).toBeInTheDocument();
        expect(client.git.switchBranch).not.toHaveBeenCalled();
        await user.click(screen.getByTestId('branch-picker-close'));
        expect(screen.getByTestId('rail-git-branch')).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Open working tree' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open branch overview' })).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(trigger).toHaveFocus();
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

    it('keeps every member in dense rows with wrapping identity, status and a separate small Git action', async () => {
        const client = fakeClient();
        const longName = 'repository-'.repeat(20);
        const longBranch = 'feature/'.repeat(30);
        const groupMembers = Array.from({ length: 9 }, (_, i) => ({
            workspaceId: `ws-${i}`, name: i === 0 ? longName : `Repo ${i}`, stale: i === 8,
        })) as RepoGroupMember[];
        client.workspaces.gitInfoBatch.mockResolvedValue({ results: {
            'ws-0': info({ branch: longBranch }),
            'ws-1': info({ dirty: false, ahead: 0, behind: 0 }),
            'ws-2': info({ upstream: null }),
            'ws-3': info({ detached: true }),
            'ws-4': info({ isGitRepo: false }),
            'ws-5': null,
            'ws-6': info({ upstream: undefined }),
            'ws-7': info(),
        } });
        render(panel(<GroupRailGit selectionId="group-product" routingRef="group-product" client={client} members={groupMembers} scopeLabel="Local / Group" />, 'group-product'));
        const trigger = screen.getByTestId('split-workspace-left-git-changes');
        await waitFor(() => expect(trigger).toHaveTextContent('R5'));
        await act(async () => trigger.focus());
        const popup = screen.getByRole('dialog');
        const rows = within(popup).getAllByTestId('rail-git-member');
        expect(rows.map(row => row.dataset.member)).toEqual(groupMembers.map(member => member.workspaceId));
        const name = within(rows[0]).getByText(longName);
        const branch = within(rows[0]).getByText(longBranch);
        expect(name.parentElement).toBe(branch.parentElement);
        expect(name.parentElement).toHaveClass('flex', 'flex-wrap');
        expect(name).toHaveClass('break-all');
        expect(branch).toHaveClass('break-all');
        expect(rows[0]).toHaveClass('flex', 'py-1');
        const action = within(rows[0]).getByRole('button', { name: `Open ${longName} Git` });
        expect(action).toHaveTextContent(/^Git$/);
        expect(action).toHaveClass('shrink-0');
        expect(action.parentElement).toBe(rows[0]);
        expect(action.previousElementSibling).toHaveClass('min-w-0', 'flex-1');
        expect(rows[0]).toHaveTextContent('Uncommitted changes · ↑3 ↓1 vs origin/feature/search-panel');
        expect(rows[1]).toHaveTextContent('Working tree clean · ↑0 ↓0');
        expect(rows[2]).toHaveTextContent('No upstream');
        expect(rows[3]).toHaveTextContent('Detached HEAD');
        expect(rows[3]).toHaveTextContent('No upstream comparison');
        expect(rows[6]).toHaveTextContent('Sync unknown');
        for (const index of [4, 5, 8]) {
            expect(rows[index]).toHaveTextContent('Unavailable');
            expect(within(rows[index]).queryByRole('button')).toBeNull();
        }
        expect(rows[8]).toHaveTextContent('Member repository is missing or unreadable');
        const summary = within(popup).getByText(/repositories changed/).parentElement!;
        expect(summary).toHaveClass('py-1', 'text-[10px]');
        expect(summary).toHaveTextContent('compared repositories');
        expect(summary).not.toHaveTextContent('Counts are repositories');
        expect(popup).toHaveClass('overflow-auto');
        expect(Number.parseFloat(popup.style.maxHeight)).toBeGreaterThan(0);
        expect(Number.parseFloat(popup.style.maxHeight)).toBeLessThanOrEqual(window.innerHeight);
        expect(Number.parseFloat(popup.style.maxWidth)).toBeLessThanOrEqual(window.innerWidth);
        const viewportWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')!;
        try {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 180 });
            fireEvent(window, new Event('resize'));
            expect(Number.parseFloat(popup.style.maxWidth)).toBeLessThanOrEqual(180);
            expect(within(popup).getAllByTestId('rail-git-member')).toHaveLength(9);
        } finally {
            Object.defineProperty(window, 'innerWidth', viewportWidth);
        }
    });

    it.each([undefined, 'http://team-host'])('keeps keyboard entry, dismissal and member navigation on owner %s', async baseUrl => {
        const user = userEvent.setup();
        const client = fakeClient(baseUrl);
        const selectionId = baseUrl ? 'remote:team:group-product' : 'group-product';
        client.workspaces.gitInfoBatch.mockResolvedValue({ results: { 'ws-harbor': info(), 'ws-beacon': info() } });
        render(panel(<GroupRailGit selectionId={selectionId} routingRef={selectionId} client={client} members={members} scopeLabel="Group" />, 'group-product'));
        const trigger = screen.getByTestId('split-workspace-left-git-changes');
        await waitFor(() => expect(trigger).toHaveTextContent('R2'));
        act(() => trigger.focus());
        await user.keyboard('{ArrowRight}{ArrowDown}');
        expect(screen.getByRole('button', { name: 'Open Harbor Git' })).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('button', { name: 'Open Beacon Git' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(trigger).toHaveFocus();
        await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown}{Enter}');
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_GIT_ROUTE', routeWorkspaceId: selectionId, workspaceId: 'ws-beacon', commitHash: null, filePath: null });
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('group-product'))).toBe('0');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each([undefined, 'http://team-host'])('loads member outgoing commits only in Sync and retains group owner %s', async baseUrl => {
        const client = fakeClient(baseUrl);
        const selectionId = baseUrl ? 'remote:team:group-product' : 'group-product';
        client.workspaces.gitInfoBatch.mockResolvedValue({ results: {
            'ws-harbor': info(), 'ws-beacon': info({ upstream: null }),
        } });
        render(panel(<GroupRailGit selectionId={selectionId} routingRef={selectionId} client={client} members={members} scopeLabel="Group" />, 'group-product'));
        const trigger = screen.getByTestId('split-workspace-left-git-sync');
        await waitFor(() => expect(trigger).not.toHaveTextContent('…'));
        expect(client.git.listCommits).not.toHaveBeenCalled();
        act(() => trigger.focus());
        const row = await screen.findByRole('button', { name: /^Open commit 3333333/ });
        expect(client.git.listCommits).toHaveBeenCalledWith('ws-harbor', expect.any(Object));
        expect(client.git.listCommits).not.toHaveBeenCalledWith('ws-beacon', expect.any(Object));
        expect(client.git.listCommits).not.toHaveBeenCalledWith('ws-gone', expect.any(Object));
        expect(client.git.listCommits).not.toHaveBeenCalledWith(selectionId, expect.any(Object));
        expect(screen.getByText('No upstream; outgoing commits cannot be compared.')).toBeInTheDocument();
        fireEvent.click(row);
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_GIT_ROUTE', routeWorkspaceId: selectionId, workspaceId: 'ws-harbor', commitHash: outgoing[0].hash, filePath: null,
            knownCommit: { sourceSelectionId: baseUrl ? 'remote:team:ws-harbor' : 'ws-harbor', commit: outgoing[0] } });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('drops pending outgoing history when a member leaves the group', async () => {
        const client = fakeClient();
        client.workspaces.gitInfoBatch.mockResolvedValue({ results: { 'ws-harbor': info(), 'ws-beacon': info() } });
        let resolveHistory!: (value: { commits: GitCommit[]; unpushedCount: number }) => void;
        client.git.listCommits.mockImplementation(id => id === 'ws-harbor'
            ? new Promise(resolve => { resolveHistory = resolve; })
            : Promise.resolve({ commits: [], unpushedCount: 0 }));
        const body = (live: RepoGroupMember[]) => panel(<GroupRailGit selectionId="group-product" routingRef="group-product" client={client} members={live} scopeLabel="Group" />, 'group-product');
        const view = render(body(members));
        await waitFor(() => expect(screen.getByTestId('split-workspace-left-git-sync')).not.toHaveTextContent('…'));
        act(() => screen.getByTestId('split-workspace-left-git-sync').focus());
        await waitFor(() => expect(client.git.listCommits).toHaveBeenCalledWith('ws-harbor', expect.any(Object)));
        view.rerender(body(members.filter(member => member.workspaceId !== 'ws-harbor')));
        await act(async () => resolveHistory({ commits: outgoing, unpushedCount: 3 }));
        expect(screen.queryByText('Outgoing change 3')).toBeNull();
        expect(screen.queryByText('Harbor')).toBeNull();
    });

    it('keeps last-known member details and a retry action when the compact popup read fails', async () => {
        const client = fakeClient();
        client.workspaces.gitInfoBatch.mockResolvedValueOnce({ results: { 'ws-harbor': info(), 'ws-beacon': info() } });
        client.workspaces.gitInfoBatch.mockRejectedValue(new Error('offline'));
        render(panel(<GroupRailGit selectionId="group-product" routingRef="group-product" client={client} members={members} scopeLabel="Group" />, 'group-product'));
        const trigger = screen.getByTestId('split-workspace-left-git-changes');
        await waitFor(() => expect(trigger).toHaveTextContent('R2'));
        act(() => trigger.focus());
        await screen.findByText(/Latest read failed; showing last known status/);
        expect(screen.getAllByTestId('rail-git-member')[0]).toHaveTextContent('feature/search-panel');
        expect(screen.getByRole('button', { name: 'Open Harbor Git' })).toBeInTheDocument();
        client.workspaces.gitInfoBatch.mockResolvedValue({ results: { 'ws-harbor': info({ branch: 'recovered' }), 'ws-beacon': info() } });
        fireEvent.click(screen.getByRole('button', { name: 'Retry read' }));
        await screen.findByText('recovered');
        expect(screen.queryByRole('button', { name: 'Retry read' })).toBeNull();
        expect(dispatch).not.toHaveBeenCalled();
    });

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
